/**
 * listing-parser.ts
 * Parses arabam.com search result pages.
 *
 * Strategy (fastest to slowest):
 * 1. Parse `insiderArray` from embedded <script> — gives id, name, price, url, image.
 * 2. Parse `.listing-list-item` DOM cards — gives year, mileage from card text.
 * 3. Merge both sources to produce a complete ListingCard per vehicle.
 */

import type { Page } from 'playwright';
import {
  normalizeFuelType,
  normalizeTransmission,
} from '@workspace/shared/auto-normalizer';
import { log } from 'crawlee';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InsiderProduct {
  id: string;
  name: string;
  taxonomy: string[];
  currency: string;
  unit_price: number;
  unit_sale_price: number;
  url: string;
  product_image_url: string;
}

export interface ListingCard {
  listingId: string;
  title: string;
  url: string;
  price: { amount: number; currency: 'TRY' } | null;
  year: number | null;
  mileage: number | null;
  fuelType: string | null;
  transmission: string | null;
  thumbnailUrl: string | null;
  sellerType: 'galeri' | 'sahibinden' | 'yetkili_bayi' | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  city: string | null;
  paintConditionText: string | null;
  featured: boolean;
}

// ─── insiderArray extraction ──────────────────────────────────────────────────

/**
 * Extracts the `insiderArray` JSON blob embedded in a <script> tag.
 * This gives us id, name, price, url, and one image per listing — fast and reliable.
 */
export function extractInsiderArray(html: string): InsiderProduct[] {
  try {
    const match = html.match(/var\s+insiderArray\s*=\s*(\[[\s\S]*?\])(?:\s*;|\s*\n)/);
    if (!match) return [];
    return JSON.parse(match[1]) as InsiderProduct[];
  } catch (err) {
    log.debug(`extractInsiderArray parse error: ${err}`);
    return [];
  }
}

/**
 * Infer make/model/variant from the taxonomy array.
 * taxonomy = ["Otomobil", "Volkswagen", "Passat", "1.5 TSi", "Business"]
 */
function taxonomyToIdentity(taxonomy: string[]): { make: string | null; model: string | null; variant: string | null } {
  // taxonomy[0] is usually "Otomobil" (vehicle type)
  const make = taxonomy[1] ?? null;
  const model = taxonomy[2] ?? null;
  // Variant is everything from index 3 onward joined
  const variantParts = taxonomy.slice(3).filter(Boolean);
  const variant = variantParts.length > 0 ? variantParts.join(' ') : null;
  return { make, model, variant };
}

/**
 * Infer seller type from the URL slug.
 * URL pattern: /ilan/{galeriden|sahibinden|yetkili-bayiden}-satilik-.../{id}
 */
function sellerTypeFromUrl(url: string): 'galeri' | 'sahibinden' | 'yetkili_bayi' | null {
  const lower = url.toLowerCase();
  if (lower.includes('yetkili-bayiden') || lower.includes('yetkili_bayiden')) return 'yetkili_bayi';
  if (lower.includes('galeriden')) return 'galeri';
  if (lower.includes('sahibinden')) return 'sahibinden';
  return null;
}

/**
 * Builds a canonical absolute URL from a possibly-relative path.
 */
function toAbsoluteUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `https://www.arabam.com${path.startsWith('/') ? path : `/${path}`}`;
}

// ─── DOM card extraction ──────────────────────────────────────────────────────

export interface DomCardData {
  listingId: string;
  year: number | null;
  mileage: number | null;
  fuelType: string | null;
  transmission: string | null;
  city: string | null;
  paintConditionText: string | null;
  featured: boolean;
  priceText: string | null;
  thumbnailUrl: string | null;
}

/**
 * Evaluates in the browser context to extract per-card data from the DOM.
 * Returns an array of DomCardData objects, one per listing card.
 *
 * arabam.com DOM structure for listing cards (as of 2024):
 *   li.listing-list-item[data-id]
 *     a.listing-item-link[href]
 *       div.listing-facade-grid (or .listing-grid-area)
 *         img.listing-image
 *         div.listing-properties
 *           span.listing-title / h3 .listing-modelname
 *           div.listing-specs-container (or .listing-text)
 *             span with year (e.g. "2021")
 *             span with km (e.g. "134.000 km")
 *             span with fuel type
 *             span with transmission
 *           div.listing-price-container
 *             span.listing-price
 *           span.listing-location
 */
export async function extractDomCards(page: Page): Promise<DomCardData[]> {
  return page.evaluate((): DomCardData[] => {
    const cards = Array.from(document.querySelectorAll('tr.listing-list-item, li.listing-list-item, div.listing-item'));

    return cards.map((card): DomCardData => {
      const id =
        (card as HTMLElement).dataset.id ??
        card.getAttribute('data-id') ??
        card.querySelector('[data-id]')?.getAttribute('data-id') ??
        '';

      // Price
      const priceEl =
        card.querySelector('.listing-price') ??
        card.querySelector('[class*="price"]');
      const priceText = priceEl?.textContent?.trim() ?? null;

      // Image
      const imgEl = card.querySelector('img.listing-image, img[class*="listing"]') as HTMLImageElement | null;
      const thumbnailUrl = imgEl?.src ?? imgEl?.getAttribute('data-src') ?? null;

      // Specs row — year, km, fuel, transmission are usually in consecutive spans
      const specSpans = Array.from(
        card.querySelectorAll(
          '.listing-text span, .listing-specs span, .listing-text td, ' +
          '.listing-prop span, td.listing-text',
        ),
      ).map((el) => el.textContent?.trim() ?? '');

      // Year: 4-digit number between 1970 and current year
      const yearText = specSpans.find((s) => /^(19[7-9]\d|20\d{2})$/.test(s)) ?? null;
      const year = yearText ? parseInt(yearText, 10) : null;

      // Mileage: contains "km" or matches Turkish thousands format
      const kmText = specSpans.find((s) => /\d.*km/i.test(s) || /^\d[\d.]{2,}$/.test(s)) ?? null;

      // Fuel: contains known fuel keywords
      const fuelKeywords = ['benzin', 'dizel', 'lpg', 'elektrik', 'hibrit', 'hybrid'];
      const fuelText = specSpans.find((s) =>
        fuelKeywords.some((kw) => s.toLowerCase().includes(kw)),
      ) ?? null;

      // Transmission: contains known keywords
      const gearKeywords = ['manuel', 'otomatik', 'yarı otomatik', 'düz', 'tiptronic'];
      const gearText = specSpans.find((s) =>
        gearKeywords.some((kw) => s.toLowerCase().includes(kw)),
      ) ?? null;

      // Location
      const locationEl =
        card.querySelector('.listing-location') ??
        card.querySelector('[class*="location"]') ??
        card.querySelector('.listing-text td:last-child');
      const city = locationEl?.textContent?.trim() ?? null;

      // Paint condition — sometimes shown as a small badge on listing cards
      const paintEl =
        card.querySelector('[class*="boya"]') ??
        card.querySelector('[class*="paint"]') ??
        card.querySelector('.listing-condition');
      const paintConditionText = paintEl?.textContent?.trim() ?? null;

      // Featured/promoted badge
      const featured = !!(
        card.querySelector('.listing-featured') ??
        card.querySelector('[class*="sponsored"]') ??
        card.querySelector('[class*="vitrin"]') ??
        card.querySelector('.listing-badge-promoted')
      );

      const mileage = kmText
        ? Number.parseInt(kmText.toLowerCase().replace(/km/g, '').replace(/[^\d]/g, ''), 10) || null
        : null;

      return {
        listingId: id,
        year,
        mileage,
        fuelType: fuelText,
        transmission: gearText,
        city,
        paintConditionText,
        featured,
        priceText,
        thumbnailUrl,
      };
    });
  });
}

// ─── Price parsing ────────────────────────────────────────────────────────────

/**
 * Parse arabam price text: "1.915.000 TL" → { amount: 1915000, currency: "TRY" }
 */
function parsePrice(text: string | null): { amount: number; currency: 'TRY' } | null {
  if (!text) return null;
  // Remove currency symbols and normalize
  const clean = text.replace(/TL|₺|\s/g, '').replace(/\./g, '');
  const val = parseInt(clean, 10);
  if (isNaN(val) || val <= 0) return null;
  return { amount: val, currency: 'TRY' };
}

// ─── Main parse function ──────────────────────────────────────────────────────

/**
 * Combine insiderArray data with DOM card data to produce full ListingCard objects.
 * If a listing exists in insiderArray but not DOM (or vice versa), it is still included.
 */
export function mergeListingData(
  insiderProducts: InsiderProduct[],
  domCards: DomCardData[],
): ListingCard[] {
  // Index DOM cards by listing ID for quick lookup
  const domById = new Map<string, DomCardData>(domCards.map((c) => [c.listingId, c]));

  // If we have insiderArray data, use it as the source of truth for IDs
  if (insiderProducts.length > 0) {
    return insiderProducts.map((product): ListingCard => {
      const dom = domById.get(product.id);
      const { make, model, variant } = taxonomyToIdentity(product.taxonomy);
      const url = toAbsoluteUrl(product.url);

      const priceAmount = product.unit_price > 0 ? product.unit_price : null;
      const price = priceAmount ? { amount: priceAmount, currency: 'TRY' as const } : (parsePrice(dom?.priceText ?? null));

      return {
        listingId: product.id,
        title: product.name,
        url,
        price,
        year: dom?.year ?? null,
        mileage: dom?.mileage ?? null,
        fuelType: dom?.fuelType ? normalizeFuelType(dom.fuelType) : null,
        transmission: dom?.transmission ? normalizeTransmission(dom.transmission) : null,
        thumbnailUrl: product.product_image_url || dom?.thumbnailUrl || null,
        sellerType: sellerTypeFromUrl(product.url),
        make,
        model,
        variant,
        city: dom?.city ?? null,
        paintConditionText: dom?.paintConditionText ?? null,
        featured: dom?.featured ?? false,
      };
    });
  }

  // Fallback: use DOM cards only
  return domCards
    .filter((c) => c.listingId)
    .map((c): ListingCard => ({
      listingId: c.listingId,
      title: '',
      url: '',
      price: parsePrice(c.priceText),
      year: c.year,
      mileage: c.mileage,
      fuelType: c.fuelType ? normalizeFuelType(c.fuelType) : null,
      transmission: c.transmission ? normalizeTransmission(c.transmission) : null,
      thumbnailUrl: c.thumbnailUrl,
      sellerType: null,
      make: null,
      model: null,
      variant: null,
      city: c.city,
      paintConditionText: c.paintConditionText,
      featured: c.featured,
    }));
}

// ─── Pagination ───────────────────────────────────────────────────────────────

/**
 * Extract total listing count from the page.
 * arabam shows e.g. "1.245 ilan bulundu" (1,245 listings found).
 */
export async function extractTotalCount(page: Page): Promise<number | null> {
  try {
    const text = await page.evaluate(() => {
      const el =
        document.querySelector('.listing-count') ??
        document.querySelector('[class*="result-count"]') ??
        document.querySelector('[class*="ilan-count"]') ??
        document.querySelector('h1.category-title') ??
        document.querySelector('.search-title');
      return el?.textContent ?? null;
    });

    if (!text) return null;
    // Extract first number from text like "1.245 ilan bulundu"
    const match = text.replace(/\./g, '').match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

/**
 * Build the next page URL by incrementing skip by take.
 * arabam.com pagination: ?take=20&skip=0, ?take=20&skip=20, etc.
 */
export function buildNextPageUrl(currentUrl: string, take = 20): string | null {
  try {
    const url = new URL(currentUrl);
    const currentSkip = parseInt(url.searchParams.get('skip') ?? '0', 10);
    const currentTake = parseInt(url.searchParams.get('take') ?? String(take), 10);
    url.searchParams.set('skip', String(currentSkip + currentTake));
    url.searchParams.set('take', String(currentTake));
    return url.toString();
  } catch {
    return null;
  }
}

export { parsePrice };
