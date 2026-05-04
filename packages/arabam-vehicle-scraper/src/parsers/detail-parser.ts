/**
 * detail-parser.ts
 * Parses arabam.com vehicle detail pages.
 *
 * arabam.com detail page structure (confirmed via live site inspection, 2024):
 *
 * Specs:     .property-item → .property-key + .property-value
 * Images:    .swiper-slide img[src] (arbstorage.mncdn.com)
 * Seller:    .advert-owner-container → .advert-owner-name, .advert-owner-memberType, .advert-owner-badge
 * Location:  .product-location (or GTM targeting data)
 * Price:     .product-price-wrapper → .desktop-information-price
 * Desc:      #tab-description .tab-content-wrapper
 * GTM:       googletag.pubads().setTargeting(...) — reliable structured data fallback
 */

import type { Page } from 'playwright';
import {
  parseMileage,
  parseModelYear,
  parseEngineSize,
  parseHorsePower,
  normalizeFuelType,
  normalizeTransmission,
  normalizeBodyType,
  parsePaintCondition,
  type PaintConditionResult,
} from '@workspace/shared/auto-normalizer';
import { log } from 'crawlee';
import { parsePrice } from './listing-parser.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DetailData {
  // Identity
  title: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;

  // Specs
  mileage: number | null;
  fuelType: string | null;
  transmission: string | null;
  engineSize: number | null;
  horsePower: number | null;
  color: string | null;
  bodyType: string | null;
  drivetrain: string | null;
  doors: number | null;

  // Pricing
  price: { amount: number; currency: 'TRY' } | null;
  negotiable: boolean;

  // Condition
  paintCondition: PaintConditionResult | null;
  accidentHistory: string | null;
  swapAvailable: boolean;
  damageReport: string | null;

  // Location
  city: string | null;
  district: string | null;

  // Seller
  sellerName: string | null;
  sellerType: 'galeri' | 'sahibinden' | 'yetkili_bayi' | null;
  sellerPhone: string | null;

  // Listing metadata
  imageUrls: string[];
  listingDate: string | null;
  description: string | null;
  specifications: Record<string, string>;
}

// ─── GTM targeting data extraction ───────────────────────────────────────────

/**
 * arabam.com embeds structured data via Google Tag Manager's setTargeting calls.
 * This is the most reliable source for make, model, year, city, fuel, transmission.
 *
 * Pattern: googletag.pubads().setTargeting('key', 'value');
 */
function extractGtmTargeting(html: string): Record<string, string> {
  const targeting: Record<string, string> = {};
  const pattern = /setTargeting\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    targeting[match[1]] = match[2];
  }
  return targeting;
}

interface CollectDataIdentity {
  brand: string | null;
  model: string | null;
  serial: string | null;
}

function extractCollectDataIdentity(html: string): CollectDataIdentity {
  const marker = 'var collectDataObject = ';
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) {
    return { brand: null, model: null, serial: null };
  }

  try {
    let start = markerIndex + marker.length;
    while (start < html.length && /\s/.test(html[start])) start++;
    if (html[start] !== '{') {
      return { brand: null, model: null, serial: null };
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
        if (depth === 0) break;
      }
    }

    const objectLiteral = html.slice(start, end + 1);
    const parsed = JSON.parse(objectLiteral) as {
      Brand?: string;
      Model?: string;
      Serial?: string;
    };

    return {
      brand: parsed.Brand ?? null,
      model: parsed.Model ?? null,
      serial: parsed.Serial ?? null,
    };
  } catch (err) {
    log.debug(`extractCollectDataIdentity parse error: ${err}`);
    return { brand: null, model: null, serial: null };
  }
}

function deriveVariant(
  candidates: Array<string | null | undefined>,
  make: string | null,
  model: string | null,
): string | null {
  for (const candidate of candidates) {
    let value = candidate?.trim();
    if (!value) continue;
    if (make && model) {
      const fullPrefix = `${make} ${model} `;
      if (value.toLowerCase().startsWith(fullPrefix.toLowerCase())) {
        value = value.slice(fullPrefix.length).trim();
      }
    }
    if (model) {
      const modelPrefix = `${model} `;
      if (value.toLowerCase().startsWith(modelPrefix.toLowerCase())) {
        value = value.slice(modelPrefix.length).trim();
      }
    }
    if (model && value.toLowerCase() === model.toLowerCase()) continue;
    if (make && value.toLowerCase() === make.toLowerCase()) continue;
    return value;
  }

  return null;
}

// ─── Specs table extraction ───────────────────────────────────────────────────

/**
 * Extracts all key-value pairs from the vehicle specs table.
 * Returns a flat Record<string, string> with original Turkish keys.
 *
 * DOM structure:
 *   .property-item
 *     .property-key (e.g. "Yakıt Tipi")
 *     .property-value (e.g. "Benzin")
 */
async function extractSpecsTable(page: Page): Promise<Record<string, string>> {
  return page.evaluate((): Record<string, string> => {
    const specs: Record<string, string> = {};

    const cleanValue = (raw: string): string => {
      // Drop "Kopyalandı" tooltip and similar "Kopya..." UI text, collapse whitespace.
      return raw
        .replace(/Kopyala(?:ndı|n)?/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // Primary: .property-item containers
    const items = document.querySelectorAll('.property-item');
    items.forEach((item) => {
      const keyRaw =
        item.querySelector('.property-key')?.textContent?.trim() ??
        item.querySelector('dt')?.textContent?.trim() ??
        '';
      const valueRaw =
        item.querySelector('.property-value')?.textContent ??
        item.querySelector('dd')?.textContent ??
        '';
      const key = keyRaw.replace(/\s+/g, ' ').trim();
      const value = cleanValue(valueRaw);
      if (key && value) specs[key] = value;
    });

    // Fallback: definition list or table rows if .property-item not found
    if (Object.keys(specs).length === 0) {
      document.querySelectorAll('table.properties tr').forEach((row) => {
        const cells = row.querySelectorAll('td, th');
        if (cells.length >= 2) {
          const key = (cells[0].textContent ?? '').replace(/\s+/g, ' ').trim();
          const value = cleanValue(cells[1].textContent ?? '');
          if (key && value) specs[key] = value;
        }
      });
    }

    return specs;
  });
}

/** Case-insensitive spec lookup — handles "Boya-değişen" vs "Boya-Değişen" mismatches. */
function getSpec(specs: Record<string, string>, ...keys: string[]): string | null {
  const lowerMap = new Map<string, string>();
  for (const [k, v] of Object.entries(specs)) {
    lowerMap.set(k.toLowerCase(), v);
  }
  for (const key of keys) {
    const v = lowerMap.get(key.toLowerCase());
    if (v) return v;
  }
  return null;
}

// ─── Image extraction ─────────────────────────────────────────────────────────

/**
 * Extract all full-size image URLs from the Swiper gallery.
 * arabam hosts images at arbstorage.mncdn.com/ilanfotograflari/...
 *
 * Strategy:
 * 1. Get all .swiper-slide img[src] that point to arbstorage.mncdn.com
 * 2. Filter out duplicates (Swiper clones slides)
 * 3. Replace thumbnail size suffix with the 1920x1080 version
 */
async function extractImageUrls(page: Page): Promise<string[]> {
  return page.evaluate((): string[] => {
    const seen = new Set<string>();
    const urls: string[] = [];

    // Primary gallery
    const imgs = document.querySelectorAll(
      '.swiper-slide img, .slider-container img, .gallery img, [class*="gallery"] img',
    ) as NodeListOf<HTMLImageElement>;

    imgs.forEach((img) => {
      const src =
        img.getAttribute('data-src') ??
        img.getAttribute('data-lazy') ??
        img.src ??
        '';
      if (!src || !src.includes('arbstorage') || seen.has(src)) return;
      // Normalize to full size: replace any size suffix (e.g. _800x600) with _1920x1080
      const fullSize = src.replace(/_\d+x\d+\./, '_1920x1080.');
      if (!seen.has(fullSize)) {
        seen.add(fullSize);
        urls.push(fullSize);
      }
    });

    // Fallback: look for image URLs in script tags (JSON-LD or insiderArray)
    if (urls.length === 0) {
      const scripts = document.querySelectorAll('script');
      scripts.forEach((script) => {
        const text = script.textContent ?? '';
        const matches = text.matchAll(/["'](https:\/\/arbstorage\.mncdn\.com\/[^"']+)["']/g);
        for (const m of matches) {
          const url = m[1].replace(/_\d+x\d+\./, '_1920x1080.');
          if (!seen.has(url)) {
            seen.add(url);
            urls.push(url);
          }
        }
      });
    }

    return urls;
  });
}

// ─── Seller extraction ────────────────────────────────────────────────────────

interface SellerInfo {
  name: string | null;
  type: 'galeri' | 'sahibinden' | 'yetkili_bayi' | null;
  phone: string | null;
}

async function extractSeller(page: Page): Promise<SellerInfo> {
  return page.evaluate((): SellerInfo => {
    const container =
      document.querySelector('.advert-owner-container') ??
      document.querySelector('[class*="advert-owner"]') ??
      document.querySelector('[class*="seller"]');

    if (!container) return { name: null, type: null, phone: null };

    const name =
      container.querySelector('.advert-owner-name')?.textContent?.trim() ??
      container.querySelector('[class*="owner-name"]')?.textContent?.trim() ??
      null;

    const memberTypeText =
      container.querySelector('.advert-owner-memberType')?.textContent?.trim()?.toLowerCase() ??
      container.querySelector('.advert-owner-badge')?.textContent?.trim()?.toLowerCase() ??
      '';

    let type: 'galeri' | 'sahibinden' | 'yetkili_bayi' | null = null;
    if (memberTypeText.includes('yetkili') || memberTypeText.includes('bayi')) {
      type = 'yetkili_bayi';
    } else if (memberTypeText.includes('galeri') || memberTypeText.includes('galeriden')) {
      type = 'galeri';
    } else if (
      memberTypeText.includes('sahibinden') ||
      memberTypeText.includes('bireysel') ||
      memberTypeText.includes('özel')
    ) {
      type = 'sahibinden';
    }

    // Phone: may be in a tel: link or masked (shown after click in real site)
    const phoneEl =
      container.querySelector('a[href^="tel:"]') ??
      document.querySelector('a[href^="tel:"]');
    const phone = phoneEl?.getAttribute('href')?.replace('tel:', '').trim() ?? null;

    return { name, type, phone };
  });
}

// ─── Location extraction ──────────────────────────────────────────────────────

interface LocationInfo {
  city: string | null;
  district: string | null;
}

async function extractLocation(page: Page): Promise<LocationInfo> {
  return page.evaluate((): LocationInfo => {
    const locEl =
      document.querySelector('.product-location') ??
      document.querySelector('[class*="product-location"]') ??
      document.querySelector('[class*="location-info"]');

    const locText = (locEl?.textContent ?? '').replace(/\s+/g, ' ').trim();

    // arabam common forms:
    //   "Karacaahmet Mh. Şehitkamil, Gaziantep"   → district=Şehitkamil, city=Gaziantep
    //   "Merkez Torbalı, İzmir"                    → district=Torbalı, city=İzmir
    //   "İstanbul / Kadıköy"                       → city=İstanbul, district=Kadıköy
    //   "İstanbul"                                 → city=İstanbul

    if (locText.includes(',')) {
      const parts = locText.split(',').map((s) => s.trim()).filter(Boolean);
      const city = parts[parts.length - 1] ?? null;
      const districtPart = parts[parts.length - 2] ?? null;
      // Strip leading neighborhood (e.g. "Mh." abbreviation) — keep last word as district.
      let district: string | null = null;
      if (districtPart) {
        const tokens = districtPart.split(/\s+/).filter((t) => !/^(Mh\.?|Mahallesi|Merkez)$/i.test(t));
        district = tokens.length > 0 ? tokens[tokens.length - 1] : null;
      }
      return { city, district };
    }

    if (locText.includes('/')) {
      const parts = locText.split('/').map((s) => s.trim());
      return { city: parts[0] ?? null, district: parts[1] ?? null };
    }

    const breadcrumbs = Array.from(document.querySelectorAll('[class*="breadcrumb"] a, nav.breadcrumb a'));
    const cityBreadcrumb = breadcrumbs.find((el) => {
      const href = el.getAttribute('href') ?? '';
      return href.includes('/il/') || href.includes('/sehir/');
    });

    if (cityBreadcrumb) {
      return { city: cityBreadcrumb.textContent?.trim() ?? null, district: null };
    }

    return { city: locText || null, district: null };
  });
}

// ─── Misc field extraction ────────────────────────────────────────────────────

async function extractMiscFields(page: Page): Promise<{
  title: string | null;
  price: { amount: number; currency: 'TRY' } | null;
  negotiable: boolean;
  swapAvailable: boolean;
  description: string | null;
  listingDate: string | null;
}> {
  return page.evaluate(() => {
    // Title
    const title =
      document.querySelector('h1.product-title, h1[class*="title"], .product-detail h1')
        ?.textContent?.trim() ?? null;

    // Price
    const priceEl =
      document.querySelector('.desktop-information-price, .product-price-wrapper .price, [class*="product-price"] strong') ??
      document.querySelector('[class*="price-value"], [class*="fiyat"]');
    const priceText = priceEl?.textContent?.trim() ?? null;

    // Negotiable: "Pazarlık Payı Var" / "Fiyatı Müzakere Et"
    const fullText = document.body.textContent ?? '';
    const negotiable =
      fullText.includes('Pazarlık') ||
      fullText.includes('pazarlık') ||
      fullText.includes('Fiyatı Müzakere');

    // Swap
    const swapAvailable =
      fullText.includes('Takasa Uygun') ||
      fullText.includes('takasa uygun') ||
      !!document.querySelector('[class*="takas"]');

    // Description
    const descEl =
      document.querySelector('#tab-description .tab-content-wrapper') ??
      document.querySelector('#tab-description') ??
      document.querySelector('[class*="description-content"]');
    const description = descEl?.textContent?.trim() ?? null;

    // Listing date
    const dateEl =
      document.querySelector('.listing-date, [class*="ilan-tarihi"], [class*="listing-date"]');
    const listingDate = dateEl?.textContent?.trim() ?? null;

    return { title, priceText, negotiable, swapAvailable, description, listingDate };
  }).then(({ title, priceText, negotiable, swapAvailable, description, listingDate }) => ({
    title,
    price: parsePrice(priceText),
    negotiable,
    swapAvailable,
    description,
    listingDate,
  }));
}

// ─── Accent/tramer report ─────────────────────────────────────────────────────

async function extractDamageReport(page: Page): Promise<string | null> {
  return page.evaluate((): string | null => {
    // Tramer section might be in specs table or dedicated section
    const tramSection =
      document.querySelector('[class*="tramer"]') ??
      document.querySelector('[class*="hasar"]') ??
      document.querySelector('[class*="accident"]');

    if (tramSection) return tramSection.textContent?.trim() ?? null;

    // Look for "Tramer" keyword in specs
    const propertyItems = document.querySelectorAll('.property-item');
    for (const item of propertyItems) {
      const key = item.querySelector('.property-key')?.textContent?.trim()?.toLowerCase() ?? '';
      if (key.includes('tramer') || key.includes('hasar')) {
        return item.querySelector('.property-value')?.textContent?.trim() ?? null;
      }
    }

    return null;
  });
}

// ─── Main parse function ──────────────────────────────────────────────────────

/**
 * Full extraction from a rendered arabam.com detail page.
 * Combines DOM extraction with GTM targeting data for maximum reliability.
 */
export async function parseDetailPage(page: Page): Promise<DetailData> {
  const html = await page.content();
  const gtm = extractGtmTargeting(html);
  const collectIdentity = extractCollectDataIdentity(html);

  // Run parallel extractions
  const [specs, images, seller, location, misc, damageReport] = await Promise.all([
    extractSpecsTable(page),
    extractImageUrls(page),
    extractSeller(page),
    extractLocation(page),
    extractMiscFields(page),
    extractDamageReport(page),
  ]);

  // ── Resolve fields with fallback chain: specs table → GTM → URL slug ──────

  // Make/model/year — GTM and collectData are more reliable than the specs table here.
  const make =
    gtm['brand'] ??
    collectIdentity.brand ??
    getSpec(specs, 'Marka', 'Araç Markası') ??
    gtm['marka'] ??
    null;
  const model =
    gtm['model'] ??
    collectIdentity.serial ??
    getSpec(specs, 'Seri', 'Araç Modeli', 'Model') ??
    null;
  const variant = deriveVariant(
    [
      getSpec(specs, 'Versiyon'),
      getSpec(specs, 'Paket'),
      collectIdentity.model,
      gtm['modelGroup'],
      getSpec(specs, 'Model'),
    ],
    make,
    model,
  );

  const yearRaw = getSpec(specs, 'Yıl', 'Model Yılı') ?? gtm['year'] ?? null;
  const year = yearRaw ? parseModelYear(yearRaw) : null;

  // Specs
  const kmRaw = getSpec(specs, 'Kilometre', 'km') ?? gtm['km'] ?? null;
  const mileage = kmRaw ? parseMileage(kmRaw) : null;

  const fuelRaw = getSpec(specs, 'Yakıt Tipi', 'Yakıt') ?? gtm['fuel'] ?? null;
  const fuelType = fuelRaw ? normalizeFuelType(fuelRaw) : null;

  const gearRaw = getSpec(specs, 'Vites Tipi', 'Vites') ?? gtm['gear'] ?? null;
  const transmission = gearRaw ? normalizeTransmission(gearRaw) : null;

  const engineRaw = getSpec(specs, 'Motor Hacmi', 'Motor', 'cc');
  const engineSize = engineRaw ? parseEngineSize(engineRaw) : null;

  const hpRaw = getSpec(specs, 'Motor Gücü', 'Beygir Gücü');
  const horsePower = parseHorsePower(hpRaw);

  const color = getSpec(specs, 'Renk', 'Dış Renk') ?? gtm['color'] ?? null;

  const bodyRaw = getSpec(specs, 'Kasa Tipi', 'Kasa') ?? gtm['bodyType'] ?? null;
  const bodyType = bodyRaw ? normalizeBodyType(bodyRaw) : null;

  const drivetrain = getSpec(specs, 'Çekiş');

  const doorsRaw = getSpec(specs, 'Kapı Sayısı');
  const doors = doorsRaw ? parseInt(doorsRaw.replace(/\D/g, ''), 10) || null : null;

  // Paint condition — arabam uses lowercase ğ in "Boya-değişen"
  const paintRaw = getSpec(specs, 'Boya-değişen', 'Boya Değişen', 'Boya Durumu', 'Boyalı');
  const paintCondition = paintRaw ? parsePaintCondition(paintRaw) : null;

  // Accident history — boolean-ish field from "Ağır Hasarlı" spec.
  // damageReport holds the tramer text (separate field).
  const accidentHistory =
    getSpec(specs, 'Ağır Hasarlı', 'Ağır Hasar Kaydı', 'Hasar Kaydı', 'Kaza Kaydı') ?? null;

  // City fallback: GTM has city if DOM location not found
  const city = location.city ?? gtm['city'] ?? null;

  // Seller type fallback from title/page text
  let sellerType = seller.type;
  if (!sellerType) {
    const pageTitle = (misc.title ?? '').toLowerCase();
    if (pageTitle.includes('yetkili') || pageTitle.includes('bayi')) sellerType = 'yetkili_bayi';
    else if (pageTitle.includes('galeriden')) sellerType = 'galeri';
    else if (pageTitle.includes('sahibinden')) sellerType = 'sahibinden';
  }

  // Listing date — prefer specs table "İlan Tarihi" over DOM scrape.
  const listingDateRaw = getSpec(specs, 'İlan Tarihi', 'Tarih') ?? misc.listingDate;
  let listingDate: string | null = listingDateRaw;
  if (listingDate) {
    const normalized = normalizeTurkishDate(listingDate);
    if (normalized) listingDate = normalized;
  }

  return {
    title: misc.title,
    make,
    model,
    variant,
    year,
    mileage,
    fuelType,
    transmission,
    engineSize,
    horsePower,
    color,
    bodyType,
    drivetrain,
    doors,
    price: misc.price,
    negotiable: misc.negotiable,
    paintCondition,
    accidentHistory,
    swapAvailable: misc.swapAvailable,
    damageReport: damageReport ?? null,
    city,
    district: location.district ?? null,
    sellerName: seller.name,
    sellerType,
    sellerPhone: seller.phone,
    imageUrls: images,
    listingDate,
    description: misc.description,
    specifications: specs,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TURKISH_MONTHS: Record<string, string> = {
  ocak: '01', şubat: '02', mart: '03', nisan: '04',
  mayıs: '05', haziran: '06', temmuz: '07', ağustos: '08',
  eylül: '09', ekim: '10', kasım: '11', aralık: '12',
};

/**
 * Convert "12 Ocak 2024" → "2024-01-12"
 */
function normalizeTurkishDate(text: string): string | null {
  const clean = text.trim().toLowerCase();
  // Format: "12 ocak 2024"
  const match = clean.match(/^(\d{1,2})\s+([a-zçğışöü]+)\s+(\d{4})$/);
  if (!match) return null;
  const day = match[1].padStart(2, '0');
  const month = TURKISH_MONTHS[match[2]];
  const year = match[3];
  if (!month) return null;
  return `${year}-${month}-${day}`;
}
