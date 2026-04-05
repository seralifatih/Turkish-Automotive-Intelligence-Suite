/**
 * platforms/arabam.ts
 * Arabam.com price extraction for the Turkish Auto Price Tracker.
 *
 * Reuses the same scraping strategy as Actor 1 (arabam-vehicle-scraper):
 * - insiderArray extraction from embedded <script> for id/price/url
 * - DOM card extraction for year/km/fuel/transmission
 * - URL pattern: /ikinci-el/otomobil/{make}-{model}?take=20&skip=0&...
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
import type { VehicleSpec, RawListing, PriceRecord } from '../types.js';

// ─── URL building ─────────────────────────────────────────────────────────────

const FUEL_TO_ID: Record<string, string> = {
  benzin: '1', dizel: '2', lpg: '3', benzin_lpg: '4', hybrid: '5', elektrik: '6',
};
const TRANSMISSION_TO_ID: Record<string, string> = {
  manuel: '1', otomatik: '2', yarı_otomatik: '3',
};

function slugify(text: string): string {
  return text
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .replace(/Ğ/g, 'ğ').replace(/Ş/g, 'ş')
    .replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9ğışöüç-]/g, '');
}

export function buildArabamUrl(
  spec: VehicleSpec,
  city: string | undefined,
  skip = 0,
  take = 20,
): string {
  const makeSlug = slugify(spec.make);
  const modelSlug = slugify(spec.model);
  const url = new URL(`https://www.arabam.com/ikinci-el/otomobil/${makeSlug}-${modelSlug}`);

  url.searchParams.set('take', String(take));
  url.searchParams.set('skip', String(skip));

  if (spec.yearMin) url.searchParams.set('minYear', String(spec.yearMin));
  if (spec.yearMax) url.searchParams.set('maxYear', String(spec.yearMax));
  if (spec.fuelType) {
    const id = FUEL_TO_ID[spec.fuelType];
    if (id) url.searchParams.set('fuel', id);
  }
  if (spec.transmission) {
    const id = TRANSMISSION_TO_ID[spec.transmission];
    if (id) url.searchParams.set('gear', id);
  }
  if (city) url.searchParams.set('city', slugify(city));

  return url.toString();
}

// ─── insiderArray extraction (same as Actor 1) ────────────────────────────────

interface InsiderProduct {
  id: string;
  name: string;
  taxonomy: string[];
  unit_price: number;
  url: string;
}

function extractInsiderArray(html: string): InsiderProduct[] {
  try {
    const match = html.match(/var\s+insiderArray\s*=\s*(\[[\s\S]*?\])(?:\s*;|\s*\n)/);
    if (!match) return [];
    return JSON.parse(match[1]) as InsiderProduct[];
  } catch {
    return [];
  }
}

// ─── DOM card extraction ──────────────────────────────────────────────────────

interface DomCard {
  id: string;
  priceText: string | null;
  year: number | null;
  kmText: string | null;
  fuelText: string | null;
  gearText: string | null;
  city: string | null;
  sellerTypeHint: string | null;
  href: string | null;
}

async function extractDomCards(page: Page): Promise<DomCard[]> {
  return page.evaluate((): DomCard[] => {
    const cards = Array.from(
      document.querySelectorAll('tr.listing-list-item, li.listing-list-item, div.listing-item'),
    );

    return cards.map((card): DomCard => {
      const id = (card as HTMLElement).dataset.id ?? card.getAttribute('data-id') ?? '';

      const priceEl = card.querySelector('.listing-price, [class*="price"]');
      const priceText = priceEl?.textContent?.trim() ?? null;

      const link = card.querySelector('a[href*="/ilan/"]') as HTMLAnchorElement | null;
      const href = link?.href ?? null;

      const specSpans = Array.from(
        card.querySelectorAll('.listing-text span, .listing-specs span, td.listing-text span'),
      ).map((el) => el.textContent?.trim() ?? '');

      const yearText = specSpans.find((s) => /^(19[7-9]\d|20\d{2})$/.test(s)) ?? null;
      const year = yearText ? parseInt(yearText, 10) : null;

      const kmText = specSpans.find((s) => /\d.*km/i.test(s)) ?? null;

      const fuelKeywords = ['benzin', 'dizel', 'lpg', 'elektrik', 'hibrit'];
      const fuelText = specSpans.find((s) =>
        fuelKeywords.some((kw) => s.toLowerCase().includes(kw)),
      ) ?? null;

      const gearKeywords = ['manuel', 'otomatik', 'düz'];
      const gearText = specSpans.find((s) =>
        gearKeywords.some((kw) => s.toLowerCase().includes(kw)),
      ) ?? null;

      const locEl = card.querySelector('.listing-location, [class*="location"]');
      const city = locEl?.textContent?.trim() ?? null;

      // Seller type from href slug
      const sellerTypeHint = href
        ? href.includes('galeriden')
          ? 'galeri'
          : href.includes('yetkili')
            ? 'yetkili_bayi'
            : href.includes('sahibinden')
              ? 'sahibinden'
              : null
        : null;

      return { id, priceText, year, kmText, fuelText, gearText, city, sellerTypeHint, href };
    });
  });
}

// ─── Price parsing ────────────────────────────────────────────────────────────

function parsePrice(text: string | null): number | null {
  if (!text) return null;
  const clean = text.replace(/TL|₺|\s/g, '').replace(/\./g, '');
  const val = parseInt(clean, 10);
  return isNaN(val) || val <= 0 ? null : val;
}

// ─── Main scraper function ────────────────────────────────────────────────────

/**
 * Scrape price listings from a single arabam.com search page.
 * Returns RawListing array — caller handles pagination.
 */
export async function scrapeArabamPage(
  page: Page,
  spec: VehicleSpec,
): Promise<{ listings: RawListing[]; hasMore: boolean }> {
  const html = await page.content();

  // Extract insiderArray (gives price and URL for free)
  const insiderProducts = extractInsiderArray(html);

  // Extract DOM cards (gives year, km, fuel, gear)
  const domCards = await extractDomCards(page);
  const domById = new Map(domCards.map((c) => [c.id, c]));

  const listings: RawListing[] = [];

  if (insiderProducts.length > 0) {
    for (const p of insiderProducts) {
      const dom = domById.get(p.id);
      const price = p.unit_price > 0 ? p.unit_price : parsePrice(dom?.priceText ?? null);
      if (!price) continue;

      const url = p.url.startsWith('http') ? p.url : `https://www.arabam.com${p.url}`;

      listings.push({
        price,
        year: dom?.year ?? null,
        mileage: dom?.kmText ? parseMileage(dom.kmText) : null,
        fuelType: dom?.fuelText ? normalizeFuelType(dom.fuelText) : null,
        transmission: dom?.gearText ? normalizeTransmission(dom.gearText) : null,
        sellerType: (dom?.sellerTypeHint as 'galeri' | 'sahibinden' | 'yetkili_bayi' | null) ?? null,
        city: dom?.city ?? null,
        paintCondition: null,
        listingUrl: url,
      });
    }
  } else {
    // DOM-only fallback
    for (const dom of domCards) {
      const price = parsePrice(dom.priceText);
      if (!price || !dom.href) continue;

      listings.push({
        price,
        year: dom.year,
        mileage: dom.kmText ? parseMileage(dom.kmText) : null,
        fuelType: dom.fuelText ? normalizeFuelType(dom.fuelText) : null,
        transmission: dom.gearText ? normalizeTransmission(dom.gearText) : null,
        sellerType: (dom.sellerTypeHint as 'galeri' | 'sahibinden' | 'yetkili_bayi' | null),
        city: dom.city,
        paintCondition: null,
        listingUrl: dom.href,
      });
    }
  }

  const hasMore = listings.length >= 20; // arabam returns 20 per page
  return { listings, hasMore };
}

// ─── Convert RawListing → PriceRecord ────────────────────────────────────────

export function toArabamPriceRecord(
  listing: RawListing,
  spec: VehicleSpec,
): PriceRecord {
  const fuel = (listing.fuelType ?? spec.fuelType) as string | null;
  const gear = (listing.transmission ?? spec.transmission) as string | null;
  const year = listing.year ?? ((spec.yearMin && spec.yearMax)
    ? Math.floor((spec.yearMin + spec.yearMax) / 2)
    : spec.yearMin ?? spec.yearMax ?? null);

  return {
    type: 'PRICE_RECORD',
    platform: 'arabam',
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
