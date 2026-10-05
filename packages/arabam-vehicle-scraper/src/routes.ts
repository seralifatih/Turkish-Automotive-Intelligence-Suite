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

// arabam.com's central masked contact number — shown on every listing's "tel:"
// link regardless of seller, not the actual seller's phone. Never present this
// as seller contact info.
const ARABAM_MASKED_PHONE = '+908507599000';

/**
 * Drop images that belong to a *different* listing than the one we're on.
 * arabam.com's detail page carousel can include "similar listings" thumbnails
 * whose <img> tags share the same arbstorage.mncdn.com CDN host, so the
 * generic image-gallery selector picks them up too. Every genuine own-listing
 * image URL contains the listingId as its own path segment:
 *   /ilanfotograflari/{yyyy}/{mm}/{dd}/{listingId}/{uuid}_..._{size}.jpg
 * Keep only URLs whose path contains `/{listingId}/`.
 */
function filterOwnListingImages(imageUrls: string[], listingId: string): string[] {
  if (!listingId) return imageUrls;
  const marker = `/${listingId}/`;
  return imageUrls.filter((url) => url.includes(marker));
}

// Shared state for tracking progress across requests
interface CrawlerState {
  totalPushed: number;
  /** Detail requests actually added to the queue (not merely attempted). */
  totalEnqueued: number;
  maxListings: number;
  /** Listing IDs seen on any SEARCH page so far, used to detect stuck/duplicate pagination. */
  seenListingIds: Set<string>;
  /** Human-readable reasons collected whenever we fall short of maxListings. */
  shortfallReasons: string[];
}

const state: CrawlerState = {
  totalPushed: 0,
  totalEnqueued: 0,
  maxListings: 200,
  seenListingIds: new Set(),
  shortfallReasons: [],
};

export function setMaxListings(max: number): void {
  state.maxListings = max;
}

export function getState(): Readonly<CrawlerState> {
  return state;
}

/** Record a reason we may come up short of maxListings, for RUN_SUMMARY visibility. */
export function recordShortfallReason(reason: string): void {
  state.shortfallReasons.push(reason);
  log.warning(`[SHORTFALL] ${reason}`);
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const router = createPlaywrightRouter();

// ── SEARCH handler ────────────────────────────────────────────────────────────

router.addHandler(LABEL.SEARCH, async ({ request, page, enqueueLinks, crawler }: PlaywrightCrawlingContext) => {
  const input = request.userData.input as Input;

  log.info(`[SEARCH] ${request.url}`);

  // Wait for listing cards to be rendered — short timeout, DOM extraction handles fallback
  await page.waitForSelector(
    '.listing-list-item, .listing-item, table[class*="listing"]',
    { timeout: 5_000 },
  ).catch(() => log.warning('[SEARCH] Listing cards selector timed out — page may have changed structure'));

  const html = await page.content();

  // ── Extract listings ──────────────────────────────────────────────────────

  const insiderProducts = extractInsiderArray(html);
  const domCards = await extractDomCards(page);
  const listings = mergeListingData(insiderProducts, domCards);

  log.info(`[SEARCH] Extracted ${insiderProducts.length} insider items and ${domCards.length} DOM cards; merged ${listings.length} listings`);
  log.info(`[SEARCH] listingIds on this page: ${listings.map((l) => l.listingId).join(', ')}`);

  // ── Detect stuck pagination (page returns listings we've already seen) ───
  // Safety net, kept even after switching pagination to the confirmed-correct
  // `page` param (see buildNextPageUrl): if arabam.com ever serves a
  // duplicate page again — a transient glitch, a future site change, or a
  // malformed searchUrl supplied via input — we catch it here and stop
  // cleanly instead of silently re-enqueuing URLs that Crawlee just dedupes.
  const newListings = listings.filter((l) => !state.seenListingIds.has(l.listingId));
  const duplicateCount = listings.length - newListings.length;

  if (listings.length > 0 && newListings.length === 0) {
    recordShortfallReason(
      `Pagination stuck: page ${request.url} returned ${listings.length} listings, all already seen on a prior page ` +
      `(duplicate page — check the page param is advancing correctly). Stopping pagination.`,
    );
    return;
  }

  if (duplicateCount > 0) {
    log.warning(`[SEARCH] ${duplicateCount}/${listings.length} listings on this page were already seen on a prior page (partial overlap)`);
  }

  for (const l of listings) state.seenListingIds.add(l.listingId);

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

  if (input.scrapeDetails) {
    // Use totalEnqueued (requests actually added to the queue), not totalPushed
    // (records actually written). totalPushed only advances once a DETAIL
    // request completes, so computing "remaining" from it under-counts work
    // that's already queued but still in flight — and, combined with the
    // concurrent crawler, can cause this page to think it has more "remaining"
    // slots than it really does.
    const remaining = state.maxListings - state.totalEnqueued;
    const toEnqueue = newListings.slice(0, remaining).filter((listing) => {
      if (!listing.url) {
        log.warning(`[SEARCH] Listing ${listing.listingId} has no URL — skipping`);
        return false;
      }
      return true;
    });

    let actuallyNew = 0;
    if (toEnqueue.length > 0) {
      // crawler.addRequests() is batched: the returned `addedRequests` only
      // covers what was added synchronously. Opt into waiting for the full
      // batch so `wasAlreadyPresent` reflects every URL we just submitted —
      // otherwise a same-tick duplicate could be miscounted as "new".
      const result = await crawler.addRequests(
        toEnqueue.map((listing) => ({
          url: listing.url,
          label: LABEL.DETAIL,
          userData: {
            input,
            listingCard: listing,
          },
        })),
        { waitForAllRequestsToBeAdded: true },
      );
      const processed = await result.waitForAllRequestsToBeAdded;
      actuallyNew = processed.filter((r) => !r.wasAlreadyPresent).length;
      const alreadyPresent = processed.length - actuallyNew;
      if (alreadyPresent > 0) {
        log.warning(`[SEARCH] ${alreadyPresent}/${toEnqueue.length} detail URLs on this page were already in the queue (duplicate URLs across pages)`);
      }
      if (processed.length < toEnqueue.length) {
        recordShortfallReason(`${toEnqueue.length - processed.length} detail requests on ${request.url} were not processed by the queue (possible rate limiting)`);
      }
    }

    state.totalEnqueued += actuallyNew;
    log.info(`[SEARCH] Enqueued ${actuallyNew} new detail pages (of ${toEnqueue.length} candidates; ${toEnqueue.length - actuallyNew} were duplicates)`);

    if (listings.length > 0 && actuallyNew === 0 && newListings.length > 0) {
      // We had new listingIds but every single one produced a URL already in the
      // queue — almost certainly the same listings reachable via a different
      // query string (e.g. pagination param not actually changing the result set).
      recordShortfallReason(
        `Page ${request.url} had ${newListings.length} "new" listingIds but all their detail URLs were already queued — ` +
        `pagination likely isn't advancing the result set.`,
      );
    }

    if (state.totalEnqueued >= state.maxListings) {
      log.info('[SEARCH] Enough detail URLs enqueued for maxListings, stopping pagination');
      return;
    }
  } else {
    // Push listing-card data directly without detail page visit.
    // Only push listings we haven't already pushed from a prior (overlapping) page.
    const remaining = state.maxListings - state.totalPushed;
    let pushedThisPage = 0;
    for (const listing of newListings.slice(0, remaining)) {
      if (state.totalPushed >= state.maxListings) break;

      const now = new Date().toISOString();
      const record = buildRecordFromCard(listing, request.url, now);
      const result = validateAndPush(record);
      if (result) {
        state.totalPushed++;
        pushedThisPage++;
      }
    }
    log.info(`[SEARCH] Pushed ${pushedThisPage} listing-card records`);
  }

  // ── Pagination ────────────────────────────────────────────────────────────

  // In scrapeDetails mode, "enough work queued" is totalEnqueued; otherwise
  // it's totalPushed. Checking the wrong counter here would keep paginating
  // past the point where enough detail pages are already queued (or vice versa).
  const satisfied = input.scrapeDetails
    ? state.totalEnqueued >= state.maxListings
    : state.totalPushed >= state.maxListings;

  if (satisfied) {
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

  // No selector wait: specs table is in the initial HTML, and the parser falls
  // back to GTM/collectDataObject script texts when DOM specs are missing.
  // Waiting just burns time on CPU-saturated containers.

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

  // Drop carousel images belonging to other listingIds (see filterOwnListingImages).
  const ownImageUrls = filterOwnListingImages(detail.imageUrls, listingId);
  if (ownImageUrls.length < detail.imageUrls.length) {
    log.warning(
      `[DETAIL] Dropped ${detail.imageUrls.length - ownImageUrls.length} image(s) not belonging to listing ${listingId} ` +
      `(likely a "similar listings" carousel contamination)`,
    );
  }

  // arabam's "tel:" link is always its own central masked number, not the
  // seller's — never present it as seller contact info.
  const sellerPhone = detail.sellerPhone === ARABAM_MASKED_PHONE ? null : detail.sellerPhone ?? null;

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
    transmissionRaw: detail.transmissionRaw ?? null,
    engineSize: detail.engineSize ?? null,
    engineSizeMin: detail.engineSizeMin ?? null,
    engineSizeMax: detail.engineSizeMax ?? null,
    horsePower: detail.horsePower ?? null,
    horsePowerMin: detail.horsePowerMin ?? null,
    horsePowerMax: detail.horsePowerMax ?? null,
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
    sellerPhone,

    listingDate: detail.listingDate ?? null,
    imageUrls: ownImageUrls,
    imageCount: ownImageUrls.length,
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

  let detail;
  try {
    detail = await parseDetailPage(page);
  } catch (err) {
    log.error(`[DEFAULT] Parse error: ${err}`);
    return;
  }

  const now = new Date().toISOString();
  const ownImageUrls = filterOwnListingImages(detail.imageUrls, listingId);
  const sellerPhone = detail.sellerPhone === ARABAM_MASKED_PHONE ? null : detail.sellerPhone ?? null;

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
    transmissionRaw: detail.transmissionRaw ?? null,
    engineSize: detail.engineSize ?? null,
    engineSizeMin: detail.engineSizeMin ?? null,
    engineSizeMax: detail.engineSizeMax ?? null,
    horsePower: detail.horsePower ?? null,
    horsePowerMin: detail.horsePowerMin ?? null,
    horsePowerMax: detail.horsePowerMax ?? null,
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
    sellerPhone,
    listingDate: detail.listingDate ?? null,
    imageUrls: ownImageUrls,
    imageCount: ownImageUrls.length,
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
    // Card data has no raw "Vites Tipi" text and no engine/HP spec at all —
    // only the detail page carries those.
    transmissionRaw: null,
    engineSize: null,
    engineSizeMin: null,
    engineSizeMax: null,
    horsePower: null,
    horsePowerMin: null,
    horsePowerMax: null,
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
