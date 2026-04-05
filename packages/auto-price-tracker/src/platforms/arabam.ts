/**
 * platforms/arabam.ts
 * Arabam.com price extraction for the Turkish Auto Price Tracker.
 *
 * The site-side numeric fuel / transmission filters have proven brittle, so we
 * keep the search URL broad and apply fuel / transmission matching in our own
 * normalization layer instead.
 */

import type { Page } from 'playwright';
import {
  normalizeFuelType,
  normalizeTransmission,
  vehicleFingerprint,
} from '@workspace/shared/auto-normalizer';
import type { VehicleSpec, RawListing, PriceRecord } from '../types.js';

function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function buildArabamUrl(
  spec: VehicleSpec,
  city: string | undefined,
  skip = 0,
  take = 20,
): string {
  const pageNumber = Math.floor(skip / Math.max(take, 1)) + 1;
  const makeSlug = slugify(spec.make);
  const modelSlug = slugify(spec.model);
  const url = new URL(`https://www.arabam.com/ikinci-el/otomobil/${makeSlug}-${modelSlug}`);

  url.searchParams.set('take', String(take));
  if (pageNumber > 1) {
    url.searchParams.set('page', String(pageNumber));
  }

  if (spec.yearMin) url.searchParams.set('minYear', String(spec.yearMin));
  if (spec.yearMax) url.searchParams.set('maxYear', String(spec.yearMax));
  if (city) url.searchParams.set('city', slugify(city));

  return url.toString();
}

interface InsiderProduct {
  id: string;
  name: string;
  taxonomy: Array<string | { Name?: string | null }>;
  unit_price: number;
  url: string;
  product_image_url?: string;
}

interface DomCardData {
  listingId: string;
  title: string | null;
  url: string | null;
  year: number | null;
  mileage: number | null;
  fuelType: string | null;
  transmission: string | null;
  city: string | null;
  priceText: string | null;
}

interface MergedArabamListing {
  title: string;
  url: string;
  price: number | null;
  year: number | null;
  mileage: number | null;
  fuelType: string | null;
  transmission: string | null;
  city: string | null;
  sellerType: 'galeri' | 'sahibinden' | 'yetkili_bayi' | null;
  variant: string | null;
}

function toAbsoluteUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `https://www.arabam.com${path.startsWith('/') ? path : `/${path}`}`;
}

function sellerTypeFromUrl(url: string): 'galeri' | 'sahibinden' | 'yetkili_bayi' | null {
  const lower = url.toLowerCase();
  if (lower.includes('yetkili-bayiden') || lower.includes('yetkili_bayiden')) return 'yetkili_bayi';
  if (lower.includes('galeriden')) return 'galeri';
  if (lower.includes('sahibinden')) return 'sahibinden';
  return null;
}

function parsePriceAmount(text: string | null): number | null {
  if (!text) return null;
  const clean = text.replace(/TL|\u20ba|\s/g, '').replace(/\./g, '');
  const value = Number.parseInt(clean, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function taxonomyToIdentity(
  taxonomy: Array<string | { Name?: string | null }>,
): { make: string | null; model: string | null; variant: string | null } {
  const names = taxonomy
    .map((item) => (typeof item === 'string' ? item : item?.Name ?? null))
    .filter((item): item is string => Boolean(item));

  const make = names[1] ?? null;
  const model = names[2] ?? null;
  const variantParts = names.slice(3).filter(Boolean);
  const variant = variantParts.length > 0 ? variantParts.join(' ') : null;

  return { make, model, variant };
}

function extractInsiderPushBlocks(html: string): string[] {
  const blocks: string[] = [];
  const marker = 'insiderArray.push(';
  let cursor = 0;

  while (cursor < html.length) {
    const markerIndex = html.indexOf(marker, cursor);
    if (markerIndex === -1) break;

    let start = markerIndex + marker.length;
    while (start < html.length && /\s/.test(html[start])) start++;
    if (html[start] !== '{') {
      cursor = start;
      continue;
    }

    let depth = 0;
    let quoteChar: '"' | "'" | null = null;
    let escaped = false;
    let end = start;

    for (; end < html.length; end++) {
      const ch = html[end];

      if (quoteChar) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === quoteChar) {
          quoteChar = null;
        }
        continue;
      }

      if (ch === '"' || ch === '\'') {
        quoteChar = ch;
        continue;
      }

      if (ch === '{') {
        depth++;
        continue;
      }

      if (ch === '}') {
        depth--;
        if (depth === 0) {
          blocks.push(html.slice(start, end + 1));
          cursor = end + 1;
          break;
        }
      }
    }

    if (end >= html.length) break;
  }

  return blocks;
}

function parseJsonStringField(block: string, fieldName: string): string | null {
  const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`"${escapedField}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`));
  if (!match) return null;
  return JSON.parse(match[1]) as string;
}

function parseTaxonomyField(block: string): Array<string | { Name?: string | null }> {
  const match = block.match(/"taxonomy"\s*:\s*(\[[\s\S]*?\])\s*,\s*"currency"/);
  if (!match) return [];

  try {
    return JSON.parse(match[1]) as Array<string | { Name?: string | null }>;
  } catch {
    return [];
  }
}

function parseNumericExpressionField(block: string, fieldName: string): number {
  const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fromStringMatch = block.match(
    new RegExp(`"${escapedField}"\\s*:\\s*parseFloat\\(\\(("(?:\\\\.|[^"\\\\])*")\\)`),
  );

  if (fromStringMatch) {
    const raw = JSON.parse(fromStringMatch[1]) as string;
    const parsed = Number.parseInt(raw.replace(/[^\d]/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const numericMatch = block.match(new RegExp(`"${escapedField}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`));
  if (!numericMatch) return 0;

  const parsed = Number.parseFloat(numericMatch[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseUrlField(block: string): string | null {
  const relativeMatch = block.match(/"url"\s*:\s*window\.location\.origin\s*\+\s*("(?:\\.|[^"\\])*")/);
  if (relativeMatch) {
    const path = JSON.parse(relativeMatch[1]) as string;
    return toAbsoluteUrl(path);
  }

  const absoluteMatch = block.match(/"url"\s*:\s*("(?:\\.|[^"\\])*")/);
  if (!absoluteMatch) return null;
  return JSON.parse(absoluteMatch[1]) as string;
}

function parseInsiderPushBlock(block: string): InsiderProduct | null {
  const id = parseJsonStringField(block, 'id');
  const name = parseJsonStringField(block, 'name');
  const taxonomy = parseTaxonomyField(block);
  const unitPrice = parseNumericExpressionField(block, 'unit_price');
  const url = parseUrlField(block);
  const productImageUrl = parseJsonStringField(block, 'product_image_url') ?? undefined;

  if (!id || !name || !url) return null;

  return {
    id,
    name,
    taxonomy,
    unit_price: unitPrice,
    url,
    product_image_url: productImageUrl,
  };
}

function extractInsiderArray(html: string): InsiderProduct[] {
  try {
    const match = html.match(/var\s+insiderArray\s*=\s*(\[[\s\S]*?\])(?:\s*;|\s*\n)/);
    if (match) {
      const parsed = JSON.parse(match[1]) as InsiderProduct[];
      if (parsed.length > 0) return parsed;
    }

    return extractInsiderPushBlocks(html)
      .map(parseInsiderPushBlock)
      .filter((item): item is InsiderProduct => item !== null);
  } catch {
    return [];
  }
}

async function extractDomCards(page: Page): Promise<DomCardData[]> {
  return page.evaluate((): DomCardData[] => {
    const cards = Array.from(
      document.querySelectorAll('tr.listing-list-item, li.listing-list-item, div.listing-item'),
    );

    return cards.map((card): DomCardData => {
      const normalizeText = (value: string | null | undefined): string =>
        value?.replace(/\s+/g, ' ').trim() ?? '';

      const firstListingLink = card.querySelector('a[href*="/ilan/"]') as HTMLAnchorElement | null;
      const href = firstListingLink?.getAttribute('href') ?? null;
      const absoluteUrl = href ? new URL(href, window.location.origin).toString() : null;
      const hrefListingId = href?.match(/\/(\d+)(?:[/?#]|$)/)?.[1] ?? null;

      const overlayListingId = Array.from(card.querySelectorAll('[class*="overlay-"], [id^="compare-container"]'))
        .map((element) => {
          const className = (element as HTMLElement).className || '';
          const overlayMatch = className.match(/overlay-(\d+)/);
          if (overlayMatch) return overlayMatch[1];
          return element.id.match(/compare-container(\d+)/)?.[1] ?? null;
        })
        .find((value): value is string => Boolean(value));

      const listingId =
        (card as HTMLElement).dataset.id ??
        card.getAttribute('data-id') ??
        card.querySelector('[data-id]')?.getAttribute('data-id') ??
        hrefListingId ??
        overlayListingId ??
        '';

      const title = normalizeText(
        (
          card.querySelector('.listing-modelname .listing-text-new') ??
          card.querySelector('.listing-modelname') ??
          card.querySelector('.listing-title-lines') ??
          card.querySelector('h2') ??
          card.querySelector('h3')
        )?.textContent,
      ) || null;

      const priceText = normalizeText(
        (card.querySelector('.listing-price') ?? card.querySelector('[class*="price"]'))?.textContent,
      ) || null;

      const specSpans = Array.from(
        card.querySelectorAll(
          'td.listing-text, .listing-text span, .listing-specs span, .listing-text td, .listing-prop span, td.listing-text',
        ),
      )
        .map((element) => normalizeText(element.textContent))
        .filter(Boolean);

      const yearText = specSpans.find((value) => /^(19[7-9]\d|20\d{2})$/.test(value)) ?? null;
      const year = yearText ? Number.parseInt(yearText, 10) : null;

      const kmText = specSpans.find((value) =>
        value !== yearText && (
          /\d.*km/i.test(value) ||
          /^\d{4,6}$/.test(value) ||
          /^\d{1,3}(?:[.\s]\d{3})+$/.test(value)
        ),
      ) ?? null;

      const fuelKeywords = ['benzin', 'dizel', 'lpg', 'elektrik', 'hibrit', 'hybrid'];
      const fuelText = specSpans.find((value) =>
        fuelKeywords.some((keyword) => value.toLowerCase().includes(keyword)),
      ) ?? null;

      const transmissionKeywords = ['manuel', 'otomatik', 'yari otomatik', 'yarı otomatik', 'duz', 'tiptronic'];
      const transmissionText = specSpans.find((value) => {
        const lower = value.toLowerCase();
        return transmissionKeywords.some((keyword) => lower.includes(keyword));
      }) ?? null;

      const locationParts = Array.from(card.querySelectorAll('td.listing-text span[title]'))
        .map((element) => normalizeText(element.textContent))
        .filter(Boolean);
      const locationText = normalizeText(
        (
          card.querySelector('.listing-location') ??
          card.querySelector('[class*="location"]') ??
          card.querySelector('.listing-text td:last-child')
        )?.textContent,
      );
      const city = locationParts[0] ?? (locationText || null);

      const mileage = kmText
        ? Number.parseInt(kmText.toLowerCase().replace(/km/g, '').replace(/[^\d]/g, ''), 10) || null
        : null;

      return {
        listingId,
        title,
        url: absoluteUrl,
        year,
        mileage,
        fuelType: fuelText,
        transmission: transmissionText,
        city,
        priceText,
      };
    });
  });
}

function mergeListingData(
  insiderProducts: InsiderProduct[],
  domCards: DomCardData[],
): MergedArabamListing[] {
  const domById = new Map<string, DomCardData>(domCards.map((card) => [card.listingId, card]));

  if (insiderProducts.length > 0) {
    return insiderProducts.map((product): MergedArabamListing => {
      const dom = domById.get(product.id);
      const { variant } = taxonomyToIdentity(product.taxonomy);

      return {
        title: product.name,
        url: dom?.url ?? toAbsoluteUrl(product.url),
        price: product.unit_price > 0 ? product.unit_price : parsePriceAmount(dom?.priceText ?? null),
        year: dom?.year ?? null,
        mileage: dom?.mileage ?? null,
        fuelType: dom?.fuelType ? normalizeFuelType(dom.fuelType) : null,
        transmission: dom?.transmission ? normalizeTransmission(dom.transmission) : null,
        city: dom?.city ?? null,
        sellerType: sellerTypeFromUrl(product.url),
        variant,
      };
    });
  }

  return domCards
    .filter((card) => card.listingId && card.url)
    .map((card): MergedArabamListing => ({
      title: card.title ?? '',
      url: card.url ?? '',
      price: parsePriceAmount(card.priceText),
      year: card.year,
      mileage: card.mileage,
      fuelType: card.fuelType ? normalizeFuelType(card.fuelType) : null,
      transmission: card.transmission ? normalizeTransmission(card.transmission) : null,
      city: card.city,
      sellerType: card.url ? sellerTypeFromUrl(card.url) : null,
      variant: null,
    }));
}

function inferFuelType(listing: MergedArabamListing): RawListing['fuelType'] {
  const haystack = [listing.variant, listing.title, listing.url].filter(Boolean).join(' ');
  const normalized = normalizeFuelType(haystack);
  if (normalized) return normalized;

  const lower = haystack.toLowerCase();

  if (/(^|[\s/-])(tdi|hdi|dci|cdi|crdi|multijet|bluehdi|d-4d)([\s/-]|$)/i.test(lower)) {
    return 'dizel';
  }

  if (/(^|[\s/-])(tsi|tfsi|fsi|mpi|gdi|ecoboost|tce|benzin)([\s/-]|$)/i.test(lower)) {
    return 'benzin';
  }

  if (/(^|[\s/-])(lpg|cng)([\s/-]|$)/i.test(lower)) {
    return 'lpg';
  }

  if (/(^|[\s/-])(hybrid|hibrit|e-hybrid)([\s/-]|$)/i.test(lower)) {
    return 'hybrid';
  }

  if (/(^|[\s/-])(electric|elektrik|ev)([\s/-]|$)/i.test(lower)) {
    return 'elektrik';
  }

  return null;
}

function inferTransmission(listing: MergedArabamListing): RawListing['transmission'] {
  return normalizeTransmission([listing.variant, listing.title, listing.url].filter(Boolean).join(' '));
}

function cityMatches(listingCity: string | null, expectedCity: string | undefined): boolean {
  if (!expectedCity) return true;
  if (!listingCity) return false;

  const normalizedListingCity = slugify(listingCity);
  const normalizedExpectedCity = slugify(expectedCity);
  return normalizedListingCity.includes(normalizedExpectedCity);
}

function toFilteredRawListing(
  listing: MergedArabamListing,
  spec: VehicleSpec,
): RawListing | null {
  if (listing.price === null) return null;

  if (spec.yearMin && (listing.year === null || listing.year < spec.yearMin)) return null;
  if (spec.yearMax && (listing.year === null || listing.year > spec.yearMax)) return null;

  const normalizedFuelType = listing.fuelType ?? inferFuelType(listing);
  if (spec.fuelType && normalizedFuelType !== spec.fuelType) return null;

  const normalizedTransmission = listing.transmission ?? inferTransmission(listing);
  if (spec.transmission && normalizedTransmission !== spec.transmission) return null;

  return {
    title: listing.title,
    variant: listing.variant,
    price: listing.price,
    year: listing.year,
    mileage: listing.mileage,
    fuelType: normalizedFuelType,
    transmission: normalizedTransmission,
    sellerType: listing.sellerType,
    city: listing.city,
    paintCondition: null,
    listingUrl: listing.url,
  };
}

export async function scrapeArabamPage(
  page: Page,
  spec: VehicleSpec,
  city?: string,
): Promise<{ listings: RawListing[]; hasMore: boolean }> {
  const html = await page.content();
  const insiderProducts = extractInsiderArray(html);
  const domCards = await extractDomCards(page);

  const merged = mergeListingData(insiderProducts, domCards)
    .filter((listing) => cityMatches(listing.city, city));

  const listings = merged
    .map((listing) => toFilteredRawListing(listing, spec))
    .filter((listing): listing is RawListing => listing !== null);

  const hasMore = merged.length >= 20;
  return { listings, hasMore };
}

export function toArabamPriceRecord(
  listing: RawListing,
  spec: VehicleSpec,
): PriceRecord {
  const fuel = (listing.fuelType ?? spec.fuelType) as string | null;
  const gear = (listing.transmission ?? spec.transmission) as string | null;
  const year = listing.year ?? (
    spec.yearMin && spec.yearMax
      ? Math.floor((spec.yearMin + spec.yearMax) / 2)
      : spec.yearMin ?? spec.yearMax ?? null
  );

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
