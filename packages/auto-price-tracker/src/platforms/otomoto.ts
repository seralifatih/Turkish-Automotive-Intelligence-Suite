/**
 * platforms/otomoto.ts
 * OtoMoto Turkey module.
 *
 * ─── IMPORTANT: Platform Status ──────────────────────────────────────────────
 *
 * otomoto.com.tr was investigated during development (April 2026) and confirmed
 * to redirect to a domain squatter (domaine.com.tr). The platform does not
 * currently operate in Turkey under this domain.
 *
 * The OLX Group automotive vertical operates in Turkey as OtoPlus (letgo.com.tr
 * automotive section), but does not offer a scrapable public listing API.
 *
 * This module is implemented as a well-structured stub that:
 * 1. Attempts to connect to the configured OTOMOTO_BASE_URL
 * 2. Returns an empty result with PLATFORM_UNAVAILABLE status if the domain is
 *    unreachable or redirects to a non-automotive page
 * 3. Will be activated when/if a viable Turkish third platform becomes available
 *
 * To activate this module for a different platform, update OTOMOTO_BASE_URL and
 * the URL builder function below.
 *
 * ─── Planned implementation (when platform becomes available) ─────────────────
 * Based on OtoMoto's pan-European platform (Poland, Czech Republic, etc.):
 * - Search URL: /oferty/osobowe/{make}/{model}?search[filter_float_year:from]=X
 * - SSR page, Cheerio-compatible
 * - Lower anti-bot than Sahibinden
 */

import type { Page } from 'playwright';
import { log } from 'crawlee';
import {
  parseMileage,
  normalizeFuelType,
  normalizeTransmission,
  vehicleFingerprint,
} from '@workspace/shared/auto-normalizer';
import type { VehicleSpec, RawListing, PriceRecord } from '../types.js';

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * Primary URL to attempt. Update when the platform becomes available.
 * Set to empty string to always skip this platform gracefully.
 */
const OTOMOTO_BASE_URL = ''; // otomoto.com.tr is currently inactive

const PLATFORM_UNAVAILABLE_MESSAGE =
  'OtoMoto Turkey (otomoto.com.tr) is currently inactive — the domain redirects ' +
  'to a non-automotive site. This platform will be activated when a viable ' +
  'Turkish third auto marketplace is identified. Current data is from Arabam.com ' +
  'and Sahibinden.com only.';

// ─── URL building ─────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Build OtoMoto Turkey search URL.
 * Template based on the pan-European OtoMoto platform format.
 * Unused until platform is activated.
 */
export function buildOtomotoUrl(
  spec: VehicleSpec,
  _city: string | undefined,
  page = 1,
): string | null {
  if (!OTOMOTO_BASE_URL) return null;

  const makeSlug = slugify(spec.make);
  const modelSlug = slugify(spec.model);
  const url = new URL(`${OTOMOTO_BASE_URL}/oferty/osobowe/${makeSlug}/${modelSlug}`);

  if (spec.yearMin) url.searchParams.set('search[filter_float_year:from]', String(spec.yearMin));
  if (spec.yearMax) url.searchParams.set('search[filter_float_year:to]', String(spec.yearMax));
  if (page > 1) url.searchParams.set('page', String(page));

  return url.toString();
}

// ─── Platform availability check ─────────────────────────────────────────────

/**
 * Check if the OtoMoto platform is accessible and serving automotive listings.
 * Returns false if the domain redirects to a non-automotive site or is unreachable.
 */
async function isPlatformAvailable(page: Page): Promise<boolean> {
  if (!OTOMOTO_BASE_URL) return false;

  try {
    const url = page.url();
    const title = (await page.title()).toLowerCase();

    // Domain squatter detection
    if (
      url.includes('domaine.com.tr') ||
      url.includes('parking') ||
      title.includes('domain') ||
      title.includes('parked')
    ) {
      return false;
    }

    // Minimal content check — a real automotive site should have car listings
    const hasListings = await page.evaluate(() => {
      return !!(
        document.querySelector('[class*="listing"]') ||
        document.querySelector('[class*="offer"]') ||
        document.querySelector('[class*="araba"]') ||
        document.querySelector('[class*="otomobil"]')
      );
    });

    return hasListings;
  } catch {
    return false;
  }
}

// ─── Listing extraction (template) ───────────────────────────────────────────

/**
 * Extract listings from OtoMoto-style SSR page.
 * This is a template implementation ready for activation.
 *
 * Based on OtoMoto's listing structure:
 *   article.offer-item[data-id]
 *     header.offer-item__header
 *       a.offer-title__link[href]
 *     div.offer-price
 *       span.offer-price__number
 *     ul.parameter-list
 *       li[data-code="year"] → year
 *       li[data-code="mileage"] → km
 *       li[data-code="fuel_type"] → fuel
 *       li[data-code="gearbox"] → transmission
 */
async function extractOtomotoListings(page: Page): Promise<Array<{
  price: number | null;
  year: number | null;
  kmText: string | null;
  fuelText: string | null;
  gearText: string | null;
  city: string | null;
  href: string | null;
}>> {
  return page.evaluate(() => {
    const articles = Array.from(
      document.querySelectorAll('article[data-id], article.offer-item, [class*="offer-item"]'),
    );

    return articles.map((article) => {
      // Price
      const priceEl = article.querySelector(
        '[class*="offer-price__number"], [class*="price"]',
      );
      const priceText = priceEl?.textContent?.trim().replace(/\s/g, '') ?? '';
      const priceClean = priceText.replace(/[^\d]/g, '');
      const price = priceClean ? parseInt(priceClean, 10) || null : null;

      // Title/href
      const link = article.querySelector('a[href*="/oferty/"]') as HTMLAnchorElement | null;
      const href = link?.href ?? null;

      // Parameter list
      const params: Record<string, string> = {};
      article.querySelectorAll('[data-code]').forEach((el) => {
        const code = el.getAttribute('data-code') ?? '';
        params[code] = el.textContent?.trim() ?? '';
      });

      // Fallback: look for span texts
      const allSpans = Array.from(article.querySelectorAll('li, span')).map(
        (el) => el.textContent?.trim() ?? '',
      );
      const yearText =
        params['year'] ??
        allSpans.find((s) => /^(19[7-9]\d|20\d{2})$/.test(s)) ??
        null;

      const city =
        params['city_id'] ??
        article.querySelector('[class*="location"]')?.textContent?.trim() ??
        null;

      return {
        price,
        year: yearText ? parseInt(yearText, 10) : null,
        kmText: params['mileage'] ?? allSpans.find((s) => /\d.*km/i.test(s)) ?? null,
        fuelText: params['fuel_type'] ?? null,
        gearText: params['gearbox'] ?? null,
        city,
        href,
      };
    });
  });
}

// ─── Main scraper function ────────────────────────────────────────────────────

export interface OtomotoScrapeResult {
  listings: RawListing[];
  platformUnavailable: boolean;
  unavailableMessage: string | null;
  hasMore: boolean;
}

/**
 * Attempt to scrape OtoMoto Turkey.
 * Returns platformUnavailable=true if the domain is not serving automotive listings.
 */
export async function scrapeOtomotoPage(
  page: Page,
  spec: VehicleSpec,
): Promise<OtomotoScrapeResult> {
  // Platform is configured as inactive
  if (!OTOMOTO_BASE_URL) {
    return {
      listings: [],
      platformUnavailable: true,
      unavailableMessage: PLATFORM_UNAVAILABLE_MESSAGE,
      hasMore: false,
    };
  }

  const available = await isPlatformAvailable(page);
  if (!available) {
    return {
      listings: [],
      platformUnavailable: true,
      unavailableMessage: PLATFORM_UNAVAILABLE_MESSAGE,
      hasMore: false,
    };
  }

  const rows = await extractOtomotoListings(page);

  const listings: RawListing[] = rows
    .filter((r) => r.price && r.href)
    .map((r) => ({
      price: r.price!,
      year: r.year,
      mileage: r.kmText ? parseMileage(r.kmText) : null,
      fuelType: r.fuelText ? normalizeFuelType(r.fuelText) : null,
      transmission: r.gearText ? normalizeTransmission(r.gearText) : null,
      sellerType: null,
      city: r.city,
      paintCondition: null,
      listingUrl: r.href!,
    }));

  return {
    listings,
    platformUnavailable: false,
    unavailableMessage: null,
    hasMore: rows.length >= 32, // OtoMoto typically shows 32/page
  };
}

// ─── Convert RawListing → PriceRecord ────────────────────────────────────────

export function toOtomotoPriceRecord(
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
    platform: 'otomoto',
    make: spec.make,
    model: spec.model,
    year,
    fuelType: fuel,
    transmission: gear,
    mileage: listing.mileage,
    price: listing.price!,
    currency: 'TRY',
    sellerType: null,
    city: listing.city,
    paintCondition: null,
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
