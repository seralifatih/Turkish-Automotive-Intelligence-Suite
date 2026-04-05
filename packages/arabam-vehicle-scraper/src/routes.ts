/**
 * routes.ts
 * Crawlee router handlers for the Arabam.com Vehicle Scraper.
 *
 * Labels:
 *   SEARCH — listing/search result pages (pagination + card extraction)
 *   DETAIL — individual vehicle detail pages (full extraction)
 */

import { createPlaywrightRouter, Dataset, log } from 'crawlee';
import type { PlaywrightCrawlingContext } from 'crawlee';
import { LABEL } from './types.js';
import type { Input } from './types.js';
import { ArabamVehicleSchema } from './types.js';
import {
  extractInsiderArray,
  extractDomCards,
  mergeListingData,
  extractTotalCount,
  buildNextPageUrl,
} from './parsers/listing-parser.js';
import { parseDetailPage } from './parsers/detail-parser.js';
import { parsePaintCondition } from '@workspace/shared/auto-normalizer';
import type { ZodError } from 'zod';

// Shared state for tracking progress across requests
interface CrawlerState {
  totalPushed: number;
  maxListings: number;
}

const state: CrawlerState = { totalPushed: 0, maxListings: 200 };

export function setMaxListings(max: number): void {
  state.maxListings = max;
}

export function getState(): Readonly<CrawlerState> {
  return state;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const router = createPlaywrightRouter();

// ── SEARCH handler ────────────────────────────────────────────────────────────

router.addHandler(LABEL.SEARCH, async ({ request, page, enqueueLinks, crawler }: PlaywrightCrawlingContext) => {
  const input = request.userData.input as Input;

  log.info(`[SEARCH] ${request.url}`);

  // Wait for listing cards to be rendered
  await page.waitForSelector(
    '.listing-list-item, .listing-item, table[class*="listing"]',
    { timeout: 30_000 },
  ).catch(() => log.warning('[SEARCH] Listing cards selector timed out — page may have changed structure'));

  const html = await page.content();

  // ── Extract listings ──────────────────────────────────────────────────────

  const insiderProducts = extractInsiderArray(html);
  const domCards = await extractDomCards(page);
  const listings = mergeListingData(insiderProducts, domCards);

  log.info(`[SEARCH] Extracted ${insiderProducts.length} insider items and ${domCards.length} DOM cards; merged ${listings.length} listings`);

  if (listings.length === 0) {
    log.warning('[SEARCH] No listings found. Possible causes: Cloudflare block, page structure change, or empty results.');

    // Check if we hit a Cloudflare challenge
    const bodyText = await page.evaluate(() => document.body?.textContent ?? '');
    if (bodyText.includes('Checking your browser') || bodyText.includes('cf-browser-verification')) {
      log.error('[SEARCH] Cloudflare challenge detected. Try using TR residential proxies.');
      return;
    }
    return;
  }

  // ── Enqueue detail pages (if scrapeDetails is enabled) ───────────────────

  const remaining = state.maxListings - state.totalPushed;

  if (input.scrapeDetails) {
    const toEnqueue = listings.slice(0, remaining);
    for (const listing of toEnqueue) {
      if (!listing.url) {
        log.warning(`[SEARCH] Listing ${listing.listingId} has no URL — skipping`);
        continue;
      }
      await crawler.addRequests([
        {
          url: listing.url,
          label: LABEL.DETAIL,
          userData: {
            input,
            listingCard: listing,
          },
        },
      ]);
    }
    log.info(`[SEARCH] Enqueued ${Math.min(toEnqueue.length, remaining)} detail pages`);
  } else {
    // Push listing-card data directly without detail page visit
    for (const listing of listings.slice(0, remaining)) {
      if (state.totalPushed >= state.maxListings) break;

      const now = new Date().toISOString();
      const record = buildRecordFromCard(listing, request.url, now);
      const result = validateAndPush(record);
      if (result) state.totalPushed++;
    }
    log.info(`[SEARCH] Pushed ${Math.min(listings.length, remaining)} listing-card records`);
  }

  // ── Pagination ────────────────────────────────────────────────────────────

  if (state.totalPushed >= state.maxListings) {
    log.info(`[SEARCH] Reached maxListings (${state.maxListings}), stopping pagination`);
    return;
  }

  // Check total count to avoid over-paginating
  const totalCount = await extractTotalCount(page);
  if (totalCount !== null) {
    log.info(`[SEARCH] Total listings on platform: ${totalCount}`);
  }

  const nextUrl = buildNextPageUrl(request.url);
  if (nextUrl && nextUrl !== request.url) {
    // Only paginate if current page had results
    if (listings.length > 0) {
      await crawler.addRequests([
        {
          url: nextUrl,
          label: LABEL.SEARCH,
          userData: request.userData,
        },
      ]);
      log.info(`[SEARCH] Enqueued next page: ${nextUrl}`);
    } else {
      log.info('[SEARCH] No listings on page — pagination stopped');
    }
  }
});

// ── DETAIL handler ────────────────────────────────────────────────────────────

router.addHandler(LABEL.DETAIL, async ({ request, page }: PlaywrightCrawlingContext) => {
  if (state.totalPushed >= state.maxListings) return;

  const input = request.userData.input as Input;
  const listingCard = request.userData.listingCard as {
    listingId?: string;
    make?: string | null;
    model?: string | null;
    variant?: string | null;
    sellerType?: string;
    featured?: boolean;
    thumbnailUrl?: string;
  } | undefined;

  log.info(`[DETAIL] ${request.url}`);

  // Extract listing ID from URL: /ilan/.../{id}
  const listingId = extractListingId(request.url) ?? listingCard?.listingId ?? '';

  // Wait for the specs table to render
  await page.waitForSelector(
    '.property-item, .product-properties, [class*="property"]',
    { timeout: 30_000 },
  ).catch(() => log.warning(`[DETAIL] Specs table selector timed out on ${request.url}`));

  // Check for Cloudflare challenge
  const title = await page.title();
  if (title.toLowerCase().includes('just a moment') || title.toLowerCase().includes('attention required')) {
    log.warning(`[DETAIL] Cloudflare challenge on ${request.url} — skipping`);
    return;
  }

  let detail;
  try {
    detail = await parseDetailPage(page);
  } catch (err) {
    log.error(`[DETAIL] Parse error on ${request.url}: ${err}`);
    return;
  }

  const now = new Date().toISOString();
  const resolvedMake = detail.make ?? listingCard?.make ?? '';
  const resolvedModel = detail.model ?? listingCard?.model ?? '';
  const resolvedVariant = resolveVariant(detail.variant, listingCard?.variant, resolvedMake, resolvedModel);

  // Merge card data with detail data (card is faster, detail is authoritative)
  const record = {
    listingId,
    title: detail.title ?? '',
    url: request.url,

    make: resolvedMake,
    model: resolvedModel,
    variant: resolvedVariant,
    year: detail.year ?? null,
    bodyType: detail.bodyType ?? null,

    mileage: detail.mileage ?? null,
    fuelType: detail.fuelType ?? null,
    transmission: detail.transmission ?? null,
    engineSize: detail.engineSize ?? null,
    horsePower: detail.horsePower ?? null,
    drivetrain: detail.drivetrain ?? null,
    color: detail.color ?? null,
    doors: detail.doors ?? null,

    price: detail.price ?? null,
    negotiable: detail.negotiable,

    paintCondition: detail.paintCondition ?? null,
    accidentHistory: detail.accidentHistory ?? null,
    swapAvailable: detail.swapAvailable,

    city: detail.city ?? null,
    district: detail.district ?? null,

    sellerType: detail.sellerType ?? (listingCard?.sellerType as 'galeri' | 'sahibinden' | 'yetkili_bayi' | null) ?? null,
    sellerName: detail.sellerName ?? null,
    sellerPhone: detail.sellerPhone ?? null,

    listingDate: detail.listingDate ?? null,
    imageUrls: detail.imageUrls,
    imageCount: detail.imageUrls.length,
    featured: listingCard?.featured ?? false,

    description: detail.description ?? null,
    specifications: detail.specifications,
    damageReport: detail.damageReport ?? null,

    scrapedAt: now,
    sourceUrl: request.url,
  };

  // Warn about missing important optional fields
  if (!record.year) log.warning(`[DETAIL] Missing year for listing ${listingId}`);
  if (!record.mileage) log.warning(`[DETAIL] Missing mileage for listing ${listingId}`);
  if (!record.fuelType) log.warning(`[DETAIL] Missing fuelType for listing ${listingId}`);
  if (!record.paintCondition) log.debug(`[DETAIL] No paint condition for listing ${listingId}`);

  const pushed = validateAndPush(record);
  if (pushed) {
    state.totalPushed++;
    log.info(`[DETAIL] Pushed listing ${listingId} (${state.totalPushed}/${state.maxListings})`);
  }
});

// ── Default handler ───────────────────────────────────────────────────────────

router.addDefaultHandler(async ({ request, page }: PlaywrightCrawlingContext) => {
  log.warning(`[DEFAULT] Unhandled URL: ${request.url} — treating as DETAIL`);

  const listingId = extractListingId(request.url) ?? '';
  if (!listingId) {
    log.warning(`[DEFAULT] Cannot determine listing ID from ${request.url}`);
    return;
  }

  // Re-route through detail handler logic
  const input = request.userData.input as Input;
  await page.waitForSelector('.property-item', { timeout: 20_000 }).catch(() => {});

  let detail;
  try {
    detail = await parseDetailPage(page);
  } catch (err) {
    log.error(`[DEFAULT] Parse error: ${err}`);
    return;
  }

  const now = new Date().toISOString();
  const record = {
    listingId,
    title: detail.title ?? '',
    url: request.url,
    make: detail.make ?? '',
    model: detail.model ?? '',
    variant: detail.variant ?? null,
    year: detail.year ?? null,
    bodyType: detail.bodyType ?? null,
    mileage: detail.mileage ?? null,
    fuelType: detail.fuelType ?? null,
    transmission: detail.transmission ?? null,
    engineSize: detail.engineSize ?? null,
    horsePower: detail.horsePower ?? null,
    drivetrain: detail.drivetrain ?? null,
    color: detail.color ?? null,
    doors: detail.doors ?? null,
    price: detail.price ?? null,
    negotiable: detail.negotiable,
    paintCondition: detail.paintCondition ?? null,
    accidentHistory: detail.accidentHistory ?? null,
    swapAvailable: detail.swapAvailable,
    city: detail.city ?? null,
    district: detail.district ?? null,
    sellerType: detail.sellerType ?? null,
    sellerName: detail.sellerName ?? null,
    sellerPhone: detail.sellerPhone ?? null,
    listingDate: detail.listingDate ?? null,
    imageUrls: detail.imageUrls,
    imageCount: detail.imageUrls.length,
    featured: false,
    description: detail.description ?? null,
    specifications: detail.specifications,
    damageReport: detail.damageReport ?? null,
    scrapedAt: now,
    sourceUrl: request.url,
  };

  const pushed = validateAndPush(record);
  if (pushed) state.totalPushed++;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract listing ID from arabam.com URL.
 * Pattern: /ilan/.../{numeric-id}
 */
function extractListingId(url: string): string | null {
  const matches = [...url.matchAll(/\/(\d+)(?=[/?#]|$)/g)];
  return matches.length > 0 ? (matches[matches.length - 1]?.[1] ?? null) : null;
}

/**
 * Build a minimal record from listing-card data (no detail page visit).
 */
function buildRecordFromCard(
  listing: ReturnType<typeof mergeListingData>[number],
  sourceUrl: string,
  now: string,
) {
  return {
    listingId: listing.listingId,
    title: listing.title,
    url: listing.url || sourceUrl,
    make: listing.make ?? '',
    model: listing.model ?? '',
    variant: listing.variant ?? null,
    year: listing.year ?? null,
    bodyType: null,
    mileage: listing.mileage ?? null,
    fuelType: listing.fuelType ?? null,
    transmission: listing.transmission ?? null,
    engineSize: null,
    horsePower: null,
    drivetrain: null,
    color: null,
    doors: null,
    price: listing.price ?? null,
    negotiable: false,
    paintCondition: listing.paintConditionText ? parsePaintCondition(listing.paintConditionText) : null,
    accidentHistory: null,
    swapAvailable: false,
    city: listing.city ?? null,
    district: null,
    sellerType: listing.sellerType ?? null,
    sellerName: null,
    sellerPhone: null,
    listingDate: null,
    imageUrls: listing.thumbnailUrl ? [listing.thumbnailUrl] : [],
    imageCount: listing.thumbnailUrl ? 1 : 0,
    featured: listing.featured,
    description: null,
    specifications: {},
    damageReport: null,
    scrapedAt: now,
    sourceUrl,
  };
}

function resolveVariant(
  detailVariant: string | null | undefined,
  cardVariant: string | null | undefined,
  make: string | null | undefined,
  model: string | null | undefined,
): string | null {
  const trimmedDetail = detailVariant?.trim() || null;
  const trimmedCard = cardVariant?.trim() || null;
  if (!trimmedDetail) return trimmedCard;

  const fullPrefix = make && model ? `${make} ${model} ` : null;
  if (fullPrefix && trimmedDetail.toLowerCase().startsWith(fullPrefix.toLowerCase())) {
    return trimmedCard ?? (trimmedDetail.slice(fullPrefix.length).trim() || null);
  }

  const modelPrefix = model ? `${model} ` : null;
  if (modelPrefix && trimmedDetail.toLowerCase().startsWith(modelPrefix.toLowerCase())) {
    return trimmedCard ?? (trimmedDetail.slice(modelPrefix.length).trim() || null);
  }

  if (model && trimmedDetail.toLowerCase() === model.toLowerCase()) {
    return trimmedCard;
  }

  return trimmedDetail;
}

/**
 * Validate record against Zod schema and push to dataset.
 * Logs warnings for validation errors but never throws.
 * Returns true if pushed successfully.
 */
function validateAndPush(record: unknown): boolean {
  const result = ArabamVehicleSchema.safeParse(record);
  if (!result.success) {
    const issues = (result.error as ZodError).issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    log.warning(`[VALIDATE] Schema validation failed for listing. Issues: ${issues.join('; ')}`);
    // Push anyway with whatever data we have — never crash on null data
    return false;
  }
  Dataset.pushData(result.data).catch((err) => log.error(`[DATASET] Push error: ${err}`));
  return true;
}
