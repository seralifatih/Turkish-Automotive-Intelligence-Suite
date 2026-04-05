/**
 * platforms/sahibinden.ts
 * Sahibinden.com dealer (mağaza) profile scraping.
 *
 * ─── URL structure ────────────────────────────────────────────────────────────
 * Mağaza (store) profile:  https://www.sahibinden.com/magaza/{slug}
 *                       or https://www.sahibinden.com/magaza/{id}
 * Mağaza listings:         https://www.sahibinden.com/magaza/{slug}/ilanlar
 *
 * Discovery (by city):     https://www.sahibinden.com/otomobil/{transmission}?
 *                          address_city={cityCode}&pagingOffset=0
 *   → Extract unique magaza URLs from listing row seller links
 *
 * ─── DOM structure (sahibinden mağaza pages) ─────────────────────────────────
 * Sahibinden's store pages use a more traditional server-rendered layout:
 *
 *   .store-header / .mağaza-header
 *     img.store-logo
 *     h1.store-name / .mağaza-adı
 *     .store-location → city/district
 *     .store-stats → listing count, member since
 *
 *   .store-badges / .trust-badges
 *     span.badge → "Pro Mağaza", "Güvenilir", etc.
 *
 *   .store-info
 *     .response-time → response metrics
 *
 *   Listings: same table format as search results (tr.searchResultsItem)
 *
 * ─── Anti-detection ───────────────────────────────────────────────────────────
 * - Session cookies required (same as price tracker)
 * - TR residential proxies required
 * - SahibindenStealth from shared module
 * - maxConcurrency: 1
 * - Delays: 5–15s
 */

import type { Page, BrowserContext } from 'playwright';
import { log } from 'crawlee';
import {
  parseMileage,
  normalizeFuelType,
  normalizeTransmission,
} from '@workspace/shared/auto-normalizer';
import { SahibindenStealth } from '@workspace/shared/sahibinden-stealth';
import type { DealerProfile, InventoryItem, Input } from '../types.js';
import { analyzeInventory } from '../inventory-analyzer.js';

// ─── City codes (same as price tracker) ──────────────────────────────────────

const CITY_CODES: Record<string, number> = {
  adana: 1, ankara: 6, antalya: 7, bursa: 16,
  denizli: 20, diyarbakır: 21, eskişehir: 26,
  gaziantep: 27, istanbul: 34, izmir: 35,
  İstanbul: 34, İzmir: 35, kayseri: 38,
  kocaeli: 41, konya: 42, mersin: 33,
  samsun: 55, trabzon: 61,
};

// ─── URL builders ─────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Build discovery URL to find mağaza slugs from listing search results.
 * sahibinden.com listing rows contain the seller's store link.
 */
export function buildDiscoveryUrl(
  searchByCity: string | undefined,
  _searchByMake: string | undefined,
  offset = 0,
): string {
  const url = new URL('https://www.sahibinden.com/otomobil/galeriden');
  if (searchByCity) {
    const normalized = searchByCity.toLowerCase().replace(/i̇/g, 'i');
    const cityCode = CITY_CODES[normalized] ?? CITY_CODES[slugify(searchByCity)];
    if (cityCode) url.searchParams.set('address_city', String(cityCode));
  }
  url.searchParams.set('pagingOffset', String(offset));
  url.searchParams.set('sorting', 'date_desc');
  return url.toString();
}

export function buildMagazaUrl(slug: string): string {
  return `https://www.sahibinden.com/magaza/${slug}`;
}

export function buildMagazaListingsUrl(slug: string, offset = 0): string {
  const url = new URL(`https://www.sahibinden.com/magaza/${slug}/ilanlar`);
  url.searchParams.set('pagingOffset', String(offset));
  return url.toString();
}

// ─── Discovery: extract mağaza slugs from listing page ───────────────────────

/**
 * Extract unique mağaza (store) slugs from a sahibinden listing page.
 * Each listing row in sahibinden shows the seller/store link.
 */
export async function extractMagazaSlugs(page: Page): Promise<string[]> {
  return page.evaluate((): string[] => {
    const slugs = new Set<string>();

    // Method 1: direct /magaza/ links
    document.querySelectorAll('a[href*="/magaza/"]').forEach((el) => {
      const href = el.getAttribute('href') ?? '';
      const match = href.match(/\/magaza\/([^/?#]+)/);
      if (match && match[1] !== 'ilanlar') slugs.add(match[1]);
    });

    // Method 2: seller column in search result rows
    document.querySelectorAll('tr.searchResultsItem').forEach((row) => {
      row.querySelectorAll('a').forEach((el) => {
        const href = el.getAttribute('href') ?? '';
        const match = href.match(/\/magaza\/([^/?#]+)/);
        if (match) slugs.add(match[1]);
      });
    });

    return [...slugs];
  });
}

// ─── Block detection ──────────────────────────────────────────────────────────

async function isBlocked(page: Page): Promise<{ blocked: boolean; reason: string }> {
  const title = (await page.title()).toLowerCase();
  const url = page.url().toLowerCase();
  if (title.includes('just a moment') || title.includes('attention required')) {
    return { blocked: true, reason: 'Cloudflare challenge' };
  }
  if (url.includes('secure.sahibinden.com/giris') || url.includes('/login')) {
    return { blocked: true, reason: 'Login redirect — session cookies expired or invalid' };
  }
  const body = await page.evaluate(() => document.body?.textContent?.slice(0, 300) ?? '');
  if (body.includes('cf-browser-verification') || body.includes('üye girişi')) {
    return { blocked: true, reason: 'Auth wall or Cloudflare' };
  }
  return { blocked: false, reason: '' };
}

// ─── Mağaza profile extraction ────────────────────────────────────────────────

/**
 * Extract all dealer data from a rendered sahibinden mağaza page.
 *
 * Sahibinden store pages are more SSR-friendly than arabam.
 * They typically include:
 *   - Store name in h1.store-header-name or .store-name
 *   - City/district in .store-location
 *   - Listing count in .store-stats (e.g. "47 aktif ilan")
 *   - Member since in .store-info
 *   - Badges like "Pro Mağaza" in .store-badge
 *   - Rating/score in .rating-score
 *   - Response time in .response-time
 */
async function extractMagazaProfile(
  page: Page,
): Promise<Omit<DealerProfile, 'type' | 'dealerId' | 'platform' | 'dealerUrl' | 'dealerSlug' | 'inventory' | 'scrapedAt' | 'sourceUrl'>> {
  const pageTitle = await page.title();

  return page.evaluate((pageTitle) => {
    const allText = document.body?.textContent ?? '';

    // ── Name ──────────────────────────────────────────────────────────────────
    const nameEl =
      document.querySelector('h1.store-header-name, h1[class*="store-name"], h1[class*="mağaza"]') ??
      document.querySelector('.store-header h1, .mağaza-header h1') ??
      document.querySelector('h1');
    const dealerName = nameEl?.textContent?.trim() ?? pageTitle.split('|')[0]?.trim() ?? '';

    // ── Logo ──────────────────────────────────────────────────────────────────
    const logoEl =
      document.querySelector('img.store-logo, img[class*="store-logo"], img[class*="mağaza-logo"]') as HTMLImageElement | null;
    const logo = logoEl?.src ?? null;

    // ── Location ──────────────────────────────────────────────────────────────
    const locEl =
      document.querySelector('.store-location, [class*="store-city"], [class*="mağaza-lokasyon"]') ??
      document.querySelector('[class*="location-info"]');
    const locText = locEl?.textContent?.trim() ?? '';
    const locParts = locText.split(/[/,]/).map((s) => s.trim());
    const city = locParts[0] || null;
    const district = locParts[1] || null;

    // ── Address ───────────────────────────────────────────────────────────────
    const addressEl = document.querySelector('[class*="store-address"], [class*="full-address"]');
    const fullAddress = addressEl?.textContent?.trim() ?? null;

    // ── Stats ─────────────────────────────────────────────────────────────────
    const activeMatch = allText.match(/(\d[\d.]*)\s*aktif\s*i[li]an/i) ??
      allText.match(/aktif\s*i[li]an[:\s]+(\d[\d.]*)/i);
    const activeListingCount = activeMatch
      ? parseInt((activeMatch[1] ?? activeMatch[2] ?? '').replace(/\./g, ''), 10)
      : null;

    const memberMatch = allText.match(/üye(?:lik)?\s*(?:tarihi|olundu|oldu)[:\s]+([^\n.]+)/i) ??
      allText.match(/(\d{4})\s*yılından\s*beri/i);
    const memberSince = memberMatch ? memberMatch[1].trim() : null;

    const salesMatch = allText.match(/(\d[\d.]*)\s*satış/i);
    const totalSalesCount = salesMatch
      ? parseInt(salesMatch[1].replace(/\./g, ''), 10)
      : null;

    // ── Rating ────────────────────────────────────────────────────────────────
    const ratingEl =
      document.querySelector('[class*="rating-score"], [class*="puan-value"], .store-rating') ??
      document.querySelector('[class*="score"]');
    const ratingText = ratingEl?.textContent?.trim().replace(',', '.') ?? '';
    const rating = ratingText ? parseFloat(ratingText) || null : null;

    const reviewMatch = allText.match(/(\d+)\s*değerlendirme/i);
    const reviewCount = reviewMatch ? parseInt(reviewMatch[1], 10) : null;

    // ── Contact ───────────────────────────────────────────────────────────────
    const phoneEl = document.querySelector('a[href^="tel:"]') as HTMLAnchorElement | null;
    const phone = phoneEl?.getAttribute('href')?.replace('tel:', '').trim() ?? null;

    const websiteEl = document.querySelector('a.store-website, a[class*="web-site"]') as HTMLAnchorElement | null;
    const website = websiteEl?.href ?? null;

    // ── Response time ─────────────────────────────────────────────────────────
    const responseEl = document.querySelector('[class*="response-time"], [class*="yanıt-süresi"]');
    const responseTime = responseEl?.textContent?.trim() ?? null;

    // ── Badges ────────────────────────────────────────────────────────────────
    const badgeEls = Array.from(
      document.querySelectorAll('[class*="store-badge"], [class*="trust-badge"], [class*="mağaza-rozet"]'),
    );
    const badges = badgeEls
      .map((el) => el.textContent?.trim())
      .filter((b): b is string => !!b && b.length > 0 && b.length < 80);

    const verified =
      badges.some((b) =>
        ['onaylı', 'doğrulanmış', 'pro', 'güvenilir', 'yetkili'].some((kw) =>
          b.toLowerCase().includes(kw),
        ),
      ) || !!document.querySelector('[class*="verified"], [class*="onaylı"]');

    return {
      dealerName,
      logo,
      city,
      district,
      fullAddress,
      phone,
      website,
      activeListingCount,
      totalSalesCount,
      memberSince,
      rating: rating !== null && !isNaN(rating) ? rating : null,
      reviewCount,
      verified,
      badges,
      responseTime,
      companyType: null,
      taxId: null,
    };
  }, pageTitle);
}

// ─── Inventory extraction ─────────────────────────────────────────────────────

/**
 * Extract dealer inventory from sahibinden mağaza listings.
 * Uses the same table-row extraction as the price tracker.
 */
export async function extractInventoryFromMagaza(
  page: Page,
  slug: string,
  maxItems = 100,
): Promise<InventoryItem[]> {
  const items: InventoryItem[] = [];
  let offset = 0;
  const pageSize = 20;

  while (items.length < maxItems) {
    const rows = await page.evaluate((): Array<{
      priceText: string | null;
      title: string | null;
      year: number | null;
      kmText: string | null;
      fuelText: string | null;
      gearText: string | null;
      href: string | null;
    }> => {
      return Array.from(document.querySelectorAll('tr.searchResultsItem')).map((row) => {
        const priceEl = row.querySelector('td.searchResultsPriceColumn');
        const priceText = priceEl?.textContent?.trim() ?? null;
        const link = row.querySelector('td.searchResultsTagColumn a') as HTMLAnchorElement | null;
        const title = link?.textContent?.trim() ?? null;
        const href = link?.href ?? null;
        const attrs = Array.from(row.querySelectorAll('td.searchResultsAttributeValue')).map(
          (el) => el.textContent?.trim() ?? '',
        );
        const yearText = attrs.find((s) => /^(19[7-9]\d|20\d{2})$/.test(s)) ?? null;
        const kmText = attrs.find((s) => /\d.*km/i.test(s)) ?? null;
        const fuelKeywords = ['benzin', 'dizel', 'lpg', 'elektrik', 'hibrit'];
        const fuelText = attrs.find((s) => fuelKeywords.some((kw) => s.toLowerCase().includes(kw))) ?? null;
        const gearKeywords = ['manuel', 'otomatik', 'düz', 'yarı'];
        const gearText = attrs.find((s) => gearKeywords.some((kw) => s.toLowerCase().includes(kw))) ?? null;
        return { priceText, title, year: yearText ? parseInt(yearText, 10) : null, kmText, fuelText, gearText, href };
      });
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      if (!row.href) continue;
      // Infer make/model from title: "Volkswagen Passat 1.6 TDI" → make=Volkswagen, model=Passat
      const titleTokens = (row.title ?? '').split(' ');
      const make = titleTokens[0] ?? null;
      const model = titleTokens[1] ?? null;

      const priceClean = (row.priceText ?? '').replace(/TL|₺|\s|\./g, '');
      const price = parseInt(priceClean, 10) || null;

      items.push({
        make,
        model,
        year: row.year,
        mileage: row.kmText ? parseMileage(row.kmText) : null,
        price,
        fuelType: row.fuelText ? normalizeFuelType(row.fuelText) : null,
        transmission: row.gearText ? normalizeTransmission(row.gearText) : null,
        listingUrl: row.href,
      });
    }

    if (rows.length < pageSize || items.length >= maxItems) break;

    offset += pageSize;
    const nextUrl = buildMagazaListingsUrl(slug, offset);
    try {
      await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(5000 + Math.floor(Math.random() * 5000));
    } catch {
      log.warning(`[Sahibinden Inventory] Navigation failed at offset=${offset}`);
      break;
    }
    if (offset > 10 * pageSize) break;
  }

  return items.slice(0, maxItems);
}

// ─── Full dealer scrape ───────────────────────────────────────────────────────

export async function scrapeMagazaProfile(
  page: Page,
  context: BrowserContext,
  url: string,
  cookies: Input['sahibindenCookies'],
  includeInventory: boolean,
): Promise<DealerProfile | null> {
  // Inject cookies
  if (cookies && cookies.length > 0) {
    const stealth = new SahibindenStealth(context);
    await stealth.injectCookies(cookies);
  }

  await page.waitForSelector(
    'h1, [class*="store-name"], [class*="mağaza"], tr.searchResultsItem',
    { timeout: 25_000 },
  ).catch(() => log.debug('[Sahibinden Magaza] Content selector timed out'));

  const blockCheck = await isBlocked(page);
  if (blockCheck.blocked) {
    log.warning(`[Sahibinden Magaza] Blocked on ${url}: ${blockCheck.reason}`);
    return null;
  }

  const slugMatch = url.match(/\/magaza\/([^/?#]+)/);
  const dealerSlug = slugMatch ? slugMatch[1] : url.split('/').pop() ?? '';

  const profileData = await extractMagazaProfile(page);

  let inventory = null;
  if (includeInventory) {
    // Navigate to listings subpage
    const listingsUrl = buildMagazaListingsUrl(dealerSlug);
    try {
      await page.goto(listingsUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(5000 + Math.floor(Math.random() * 5000));
      const blockCheckListings = await isBlocked(page);
      if (!blockCheckListings.blocked) {
        const inventoryItems = await extractInventoryFromMagaza(page, dealerSlug, 100);
        if (inventoryItems.length > 0) {
          inventory = analyzeInventory(inventoryItems);
          log.info(`[Sahibinden Magaza] Analyzed ${inventoryItems.length} inventory items for ${profileData.dealerName}`);
        }
      }
    } catch (err) {
      log.warning(`[Sahibinden Magaza] Inventory fetch failed for ${dealerSlug}: ${err}`);
    }
  }

  return {
    type: 'DEALER_PROFILE',
    dealerId: `sahibinden-${dealerSlug}`,
    platform: 'sahibinden',
    dealerUrl: url,
    dealerSlug,
    ...profileData,
    inventory,
    scrapedAt: new Date().toISOString(),
    sourceUrl: url,
  };
}
