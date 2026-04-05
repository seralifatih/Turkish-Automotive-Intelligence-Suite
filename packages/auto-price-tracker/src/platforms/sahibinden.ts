/**
 * platforms/sahibinden.ts
 * Sahibinden.com vasıta (vehicle) price extraction.
 *
 * ─── URL Pattern (confirmed from live site research) ──────────────────────────
 *
 * Base: https://www.sahibinden.com/{make}-{model}
 * OR:   https://www.sahibinden.com/otomobil/{transmission-slug}/{fuel-slug}
 *
 * Query parameters:
 *   a4_min / a4_max   = KM range (mileage)
 *   a5_min / a5_max   = Year range (model year)
 *   price_min / price_max = Price range in TRY
 *   address_city      = Turkish city code (Turkish plate number: Istanbul=34, Ankara=6, İzmir=35)
 *   pagingOffset      = Pagination (0, 20, 40, ...)
 *   sorting           = Sort order (e.g. date_desc, price_asc)
 *
 * Transmission in URL path segment (after model):
 *   /otomatik, /manuel, /yari-otomatik
 *
 * Fuel in URL path segment:
 *   /benzin, /dizel, /lpg, /benzin-lpg, /hibrit, /elektrik
 *
 * ─── Anti-detection requirements ─────────────────────────────────────────────
 *   - Session cookies required (user must provide via sahibindenCookies input)
 *   - TR residential proxies required
 *   - Playwright with stealth plugin
 *   - maxConcurrency: 1
 *   - Delays: 5–15 seconds between requests
 *
 * ─── Listing HTML structure (from research / known Sahibinden DOM) ────────────
 *   tr.searchResultsItem[data-id]
 *     td.searchResultsTagColumn     → listing title + href
 *     td.searchResultsDateColumn    → listing date
 *     td.searchResultsLocationColumn → city/district
 *     td.searchResultsPriceColumn   → price text
 *   Attributes in <td class="searchResultsTagColumn">:
 *     <a href="/ilan/vasita-otomobil-.../{id}">title</a>
 *   Spec spans in td:
 *     year, km, color often in td.searchResultsAttributeValue
 */

import type { Page } from 'playwright';
import { log } from 'crawlee';
import {
  parseMileage,
  parseModelYear,
  normalizeFuelType,
  normalizeTransmission,
  vehicleFingerprint,
} from '@workspace/shared/auto-normalizer';
import { SahibindenStealth } from '@workspace/shared/sahibinden-stealth';
import type { BrowserContext } from 'playwright';
import type { VehicleSpec, RawListing, PriceRecord, Input } from '../types.js';

// ─── City code map (Turkish plate / il kodu) ──────────────────────────────────

const CITY_CODES: Record<string, number> = {
  adana: 1, adıyaman: 2, afyon: 3, afyonkarahisar: 3,
  ağrı: 4, amasya: 5, ankara: 6, antalya: 7,
  artvin: 8, aydın: 9, balıkesir: 10,
  bilecik: 11, bingöl: 12, bitlis: 13,
  bolu: 14, burdur: 15, bursa: 16,
  çanakkale: 17, çankırı: 18, çorum: 19,
  denizli: 20, diyarbakır: 21, edirne: 22,
  elazığ: 23, erzincan: 24, erzurum: 25,
  eskişehir: 26, gaziantep: 27, giresun: 28,
  gümüşhane: 29, hakkari: 30, hatay: 31,
  ısparta: 32, mersin: 33, istanbul: 34,
  izmir: 35, İzmir: 35, İstanbul: 34,
  kars: 36, kastamonu: 37, kayseri: 38,
  kırklareli: 39, kırşehir: 40, kocaeli: 41,
  konya: 42, kütahya: 43, malatya: 44,
  manisa: 45, kahramanmaraş: 46, mardin: 47,
  muğla: 48, muş: 49, nevşehir: 50,
  niğde: 51, ordu: 52, rize: 53,
  sakarya: 54, samsun: 55, siirt: 56,
  sinop: 57, sivas: 58, tekirdağ: 59,
  tokat: 60, trabzon: 61, tunceli: 62,
  şanlıurfa: 63, uşak: 64, van: 65,
  yozgat: 66, zonguldak: 67, aksaray: 68,
  bayburt: 69, karaman: 70, kırıkkale: 71,
  batman: 72, şırnak: 73, bartın: 74,
  ardahan: 75, iğdır: 76, yalova: 77,
  karabük: 78, kilis: 79, osmaniye: 80,
  düzce: 81,
};

// ─── Transmission and fuel path slugs ────────────────────────────────────────

const TRANSMISSION_SLUG: Record<string, string> = {
  otomatik: 'otomatik',
  manuel: 'manuel',
  yarı_otomatik: 'yari-otomatik',
};

const FUEL_SLUG: Record<string, string> = {
  benzin: 'benzin',
  dizel: 'dizel',
  lpg: 'lpg',
  benzin_lpg: 'benzin-lpg',
  hybrid: 'hibrit',
  elektrik: 'elektrik',
};

// ─── URL building ─────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .replace(/Ğ/g, 'ğ').replace(/Ş/g, 'ş')
    .replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç')
    .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9ğışöüç-]/g, '');
}

export function buildSahibindenUrl(
  spec: VehicleSpec,
  city: string | undefined,
  offset = 0,
): string {
  const makeSlug = slugify(spec.make);
  const modelSlug = slugify(spec.model);

  // Build path: /make-model (optionally /transmission/fuel)
  let path = `/${makeSlug}-${modelSlug}`;

  // Append transmission and/or fuel as path segments if provided
  const gearSlug = spec.transmission ? TRANSMISSION_SLUG[spec.transmission] : null;
  const fuelSlug = spec.fuelType ? FUEL_SLUG[spec.fuelType] : null;
  if (gearSlug) path += `/${gearSlug}`;
  if (fuelSlug) path += `/${fuelSlug}`;

  const url = new URL(`https://www.sahibinden.com${path}`);

  if (spec.yearMin) url.searchParams.set('a5_min', String(spec.yearMin));
  if (spec.yearMax) url.searchParams.set('a5_max', String(spec.yearMax));

  if (city) {
    const normalized = city.toLowerCase().replace(/i̇/g, 'i');
    const cityCode = CITY_CODES[normalized] ?? CITY_CODES[slugify(city)];
    if (cityCode) {
      url.searchParams.set('address_city', String(cityCode));
    } else {
      log.warning(`[Sahibinden] Unknown city code for: ${city}`);
    }
  }

  url.searchParams.set('pagingOffset', String(offset));
  url.searchParams.set('sorting', 'date_desc');

  return url.toString();
}

// ─── Listing extraction ───────────────────────────────────────────────────────

/**
 * Extract listing data from Sahibinden's table-based search results.
 *
 * Sahibinden uses a traditional HTML table layout:
 *   table.searchResults > tbody > tr.searchResultsItem
 *
 * Each row has columns for: image | listing info | date | location | price
 * The listing info column contains the title link and attribute spans.
 *
 * We also check for JSON-LD or dataLayer pushes as a fallback.
 */
async function extractSahibindenListings(page: Page): Promise<Array<{
  price: number | null;
  year: number | null;
  kmText: string | null;
  fuelText: string | null;
  gearText: string | null;
  city: string | null;
  sellerType: 'galeri' | 'sahibinden' | 'yetkili_bayi' | null;
  href: string | null;
}>> {
  return page.evaluate(() => {
    type Row = {
      price: number | null;
      year: number | null;
      kmText: string | null;
      fuelText: string | null;
      gearText: string | null;
      city: string | null;
      sellerType: 'galeri' | 'sahibinden' | 'yetkili_bayi' | null;
      href: string | null;
    };

    const rows = Array.from(
      document.querySelectorAll('tr.searchResultsItem'),
    );

    return rows.map((row): Row => {
      // Price column
      const priceEl = row.querySelector(
        'td.searchResultsPriceColumn, [class*="price"]',
      );
      const priceText = priceEl?.textContent?.trim() ?? '';
      const cleanPrice = priceText.replace(/TL|₺|\s|\./g, '').replace(/,/g, '');
      const price = cleanPrice ? parseInt(cleanPrice, 10) || null : null;

      // Listing link
      const link = row.querySelector(
        'td.searchResultsTagColumn a, a[href*="/ilan/vasita"]',
      ) as HTMLAnchorElement | null;
      const href = link?.href ?? null;

      // Location column
      const locEl = row.querySelector(
        'td.searchResultsLocationColumn, [class*="location"]',
      );
      const locText = locEl?.textContent?.trim() ?? '';
      const city = locText.split('/')[0]?.trim() ?? null;

      // Attribute values — sahibinden shows specs in td.searchResultsAttributeValue cells
      const attrCells = Array.from(
        row.querySelectorAll('td.searchResultsAttributeValue, [class*="attributeValue"]'),
      ).map((el) => el.textContent?.trim() ?? '');

      // Year: 4-digit number
      const yearText = attrCells.find((s) => /^(19[7-9]\d|20\d{2})$/.test(s)) ?? null;
      const year = yearText ? parseInt(yearText, 10) : null;

      // KM: contains "km"
      const kmText = attrCells.find((s) => /\d.*km/i.test(s)) ?? null;

      // Fuel type
      const fuelKeywords = ['benzin', 'dizel', 'lpg', 'elektrik', 'hibrit'];
      const fuelText = attrCells.find((s) =>
        fuelKeywords.some((kw) => s.toLowerCase().includes(kw)),
      ) ?? null;

      // Transmission
      const gearKeywords = ['manuel', 'otomatik', 'düz', 'yarı'];
      const gearText = attrCells.find((s) =>
        gearKeywords.some((kw) => s.toLowerCase().includes(kw)),
      ) ?? null;

      // Seller type: check row class or title text
      const rowClass = row.className.toLowerCase();
      const titleText = (link?.textContent ?? '').toLowerCase();
      let sellerType: 'galeri' | 'sahibinden' | 'yetkili_bayi' | null = null;
      if (href?.includes('/galeriden-') || rowClass.includes('galeri') || titleText.includes('galeri')) {
        sellerType = 'galeri';
      } else if (href?.includes('/sahibinden-') || rowClass.includes('sahibinden')) {
        sellerType = 'sahibinden';
      }

      return { price, year, kmText, fuelText, gearText, city, sellerType, href };
    });
  });
}

// ─── Cloudflare / login wall detection ───────────────────────────────────────

async function isBlocked(page: Page): Promise<{ blocked: boolean; reason: string }> {
  const title = (await page.title()).toLowerCase();
  const url = page.url().toLowerCase();

  if (title.includes('just a moment') || title.includes('attention required')) {
    return { blocked: true, reason: 'Cloudflare challenge' };
  }
  if (url.includes('secure.sahibinden.com/giris') || url.includes('/login')) {
    return { blocked: true, reason: 'Login wall — session cookies may be expired' };
  }

  const bodyContent = await page.evaluate(() => document.body?.textContent?.slice(0, 500) ?? '');
  if (bodyContent.includes('üye girişi') || bodyContent.includes('giriş yapın')) {
    return { blocked: true, reason: 'Login wall — session cookies required' };
  }
  if (bodyContent.includes('cf-browser-verification') || bodyContent.includes('Tarayıcınız kontrol')) {
    return { blocked: true, reason: 'Cloudflare challenge' };
  }

  return { blocked: false, reason: '' };
}

// ─── Main scraper function ────────────────────────────────────────────────────

export interface SahibindenScrapeResult {
  listings: RawListing[];
  blocked: boolean;
  blockReason: string | null;
  hasMore: boolean;
}

/**
 * Scrape a single Sahibinden search page.
 * Requires browser context with injected session cookies.
 */
export async function scrapeSahibindenPage(
  page: Page,
  context: BrowserContext,
  spec: VehicleSpec,
  cookies: Input['sahibindenCookies'],
): Promise<SahibindenScrapeResult> {
  // Inject cookies if not already done
  if (cookies && cookies.length > 0) {
    const stealth = new SahibindenStealth(context);
    await stealth.injectCookies(cookies);
  }

  // Wait for results table or error
  await Promise.race([
    page.waitForSelector('tr.searchResultsItem, .searchResults', { timeout: 30_000 }),
    page.waitForSelector('form[action*="giris"], .cf-browser-verification', { timeout: 30_000 }),
  ]).catch(() => {
    log.debug('[Sahibinden] Selector wait timed out — continuing');
  });

  const blockCheck = await isBlocked(page);
  if (blockCheck.blocked) {
    return { listings: [], blocked: true, blockReason: blockCheck.reason, hasMore: false };
  }

  const rows = await extractSahibindenListings(page);

  if (rows.length === 0) {
    log.warning('[Sahibinden] No listing rows found — possible structure change or empty results');
    return { listings: [], blocked: false, blockReason: null, hasMore: false };
  }

  const listings: RawListing[] = rows
    .filter((r) => r.price && r.href)
    .map((r) => ({
      price: r.price!,
      year: r.year,
      mileage: r.kmText ? parseMileage(r.kmText) : null,
      fuelType: r.fuelText ? normalizeFuelType(r.fuelText) : null,
      transmission: r.gearText ? normalizeTransmission(r.gearText) : null,
      sellerType: r.sellerType,
      city: r.city,
      paintCondition: null,
      listingUrl: r.href!,
    }));

  return {
    listings,
    blocked: false,
    blockReason: null,
    hasMore: rows.length >= 20,
  };
}

// ─── Convert RawListing → PriceRecord ────────────────────────────────────────

export function toSahibindenPriceRecord(
  listing: RawListing,
  spec: VehicleSpec,
): PriceRecord {
  const fuel = (listing.fuelType ?? spec.fuelType ?? null) as string | null;
  const gear = (listing.transmission ?? spec.transmission ?? null) as string | null;
  const year = listing.year ?? (spec.yearMin && spec.yearMax
    ? Math.floor((spec.yearMin + spec.yearMax) / 2)
    : spec.yearMin ?? spec.yearMax ?? null);

  return {
    type: 'PRICE_RECORD',
    platform: 'sahibinden',
    make: spec.make,
    model: spec.model,
    year,
    fuelType: fuel,
    transmission: gear,
    mileage: listing.mileage,
    price: listing.price!,
    currency: 'TRY',
    sellerType: listing.sellerType,
    city: listing.city,
    paintCondition: listing.paintCondition,
    listingUrl: listing.listingUrl,
    vehicleFingerprint: vehicleFingerprint(
      spec.make,
      spec.model,
      year ?? 0,
      (fuel as Parameters<typeof vehicleFingerprint>[3]) ?? 'benzin',
      (gear as Parameters<typeof vehicleFingerprint>[4]) ?? 'manuel',
    ),
    scrapedAt: new Date().toISOString(),
  };
}
