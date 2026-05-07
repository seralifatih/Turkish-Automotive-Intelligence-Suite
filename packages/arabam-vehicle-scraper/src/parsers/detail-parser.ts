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
 *
 * Performance: a single page.evaluate() pulls everything (specs/images/seller/location/
 * misc/damageReport + filtered <script> texts). Avoids page.content() DOM serialization
 * and collapses what used to be 7 CDP round-trips down to 1.
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

interface RawPageData {
  scripts: string[];
  specs: Record<string, string>;
  imageUrls: string[];
  seller: { name: string | null; memberType: string; phone: string | null };
  location: { city: string | null; district: string | null; rawText: string };
  misc: {
    title: string | null;
    priceText: string | null;
    negotiable: boolean;
    swapAvailable: boolean;
    description: string | null;
    listingDateText: string | null;
  };
  damageReport: string | null;
}

interface CollectDataIdentity {
  brand: string | null;
  model: string | null;
  serial: string | null;
}

// ─── Single-evaluate page extraction ──────────────────────────────────────────

/**
 * One CDP round-trip pulls every DOM-derived field plus the few script texts we
 * need to scan in Node. This is significantly cheaper than page.content() + N
 * separate evaluates, especially when the container is CPU-bound.
 */
async function extractAllPageData(page: Page): Promise<RawPageData> {
  return page.evaluate((): RawPageData => {
    const norm = (value: string | null | undefined): string =>
      (value ?? '').replace(/\s+/g, ' ').trim();

    const cleanValue = (value: string | null | undefined): string =>
      (value ?? '')
        .replace(/Kopyala(?:ndı|n)?/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

    // ── Script texts (only those we'll parse: GTM + collectData) ────────────
    const scripts: string[] = [];
    document.querySelectorAll('script').forEach((s) => {
      const t = s.textContent ?? '';
      if (!t) return;
      if (t.includes('setTargeting(') || t.includes('collectDataObject')) {
        scripts.push(t);
      }
    });

    // ── Specs table ─────────────────────────────────────────────────────────
    const specs: Record<string, string> = {};
    document.querySelectorAll('.property-item').forEach((item) => {
      const keyRaw =
        item.querySelector('.property-key')?.textContent ??
        item.querySelector('dt')?.textContent ??
        '';
      const valueRaw =
        item.querySelector('.property-value')?.textContent ??
        item.querySelector('dd')?.textContent ??
        '';
      const key = norm(keyRaw);
      const value = cleanValue(valueRaw);
      if (key && value) specs[key] = value;
    });
    if (Object.keys(specs).length === 0) {
      document.querySelectorAll('table.properties tr').forEach((row) => {
        const cells = row.querySelectorAll('td, th');
        if (cells.length >= 2) {
          const key = norm(cells[0].textContent);
          const value = cleanValue(cells[1].textContent);
          if (key && value) specs[key] = value;
        }
      });
    }

    // ── Images (Swiper gallery → arbstorage.mncdn.com) ───────────────────────
    const seenImg = new Set<string>();
    const imageUrls: string[] = [];
    const imgSelectors =
      '.swiper-slide img, .slider-container img, .gallery img, [class*="gallery"] img';
    document.querySelectorAll<HTMLImageElement>(imgSelectors).forEach((img) => {
      const src =
        img.getAttribute('data-src') ??
        img.getAttribute('data-lazy') ??
        img.src ??
        '';
      if (!src || !src.includes('arbstorage')) return;
      const fullSize = src.replace(/_\d+x\d+\./, '_1920x1080.');
      if (!seenImg.has(fullSize)) {
        seenImg.add(fullSize);
        imageUrls.push(fullSize);
      }
    });

    // ── Seller ───────────────────────────────────────────────────────────────
    const sellerContainer =
      document.querySelector('.advert-owner-container') ??
      document.querySelector('[class*="advert-owner"]') ??
      document.querySelector('[class*="seller"]');

    let sellerName: string | null = null;
    let sellerMemberType = '';
    let sellerPhone: string | null = null;
    if (sellerContainer) {
      sellerName =
        norm(sellerContainer.querySelector('.advert-owner-name')?.textContent) ||
        norm(sellerContainer.querySelector('[class*="owner-name"]')?.textContent) ||
        null;
      sellerMemberType = (
        norm(sellerContainer.querySelector('.advert-owner-memberType')?.textContent) ||
        norm(sellerContainer.querySelector('.advert-owner-badge')?.textContent) ||
        ''
      ).toLowerCase();
      const phoneEl =
        sellerContainer.querySelector('a[href^="tel:"]') ??
        document.querySelector('a[href^="tel:"]');
      sellerPhone =
        phoneEl?.getAttribute('href')?.replace('tel:', '').trim() || null;
    }

    // ── Location ─────────────────────────────────────────────────────────────
    const locEl =
      document.querySelector('.product-location') ??
      document.querySelector('[class*="product-location"]') ??
      document.querySelector('[class*="location-info"]');
    const locText = norm(locEl?.textContent);

    let locCity: string | null = null;
    let locDistrict: string | null = null;
    if (locText.includes(',')) {
      const parts = locText.split(',').map((s) => s.trim()).filter(Boolean);
      locCity = parts[parts.length - 1] ?? null;
      const districtPart = parts[parts.length - 2] ?? null;
      if (districtPart) {
        const tokens = districtPart
          .split(/\s+/)
          .filter((t) => !/^(Mh\.?|Mahallesi|Merkez)$/i.test(t));
        locDistrict = tokens.length > 0 ? tokens[tokens.length - 1] : null;
      }
    } else if (locText.includes('/')) {
      const parts = locText.split('/').map((s) => s.trim());
      locCity = parts[0] ?? null;
      locDistrict = parts[1] ?? null;
    } else if (locText) {
      const breadcrumb = Array.from(
        document.querySelectorAll('[class*="breadcrumb"] a, nav.breadcrumb a'),
      ).find((el) => {
        const href = el.getAttribute('href') ?? '';
        return href.includes('/il/') || href.includes('/sehir/');
      });
      locCity = norm(breadcrumb?.textContent) || locText;
    }

    // ── Misc fields (title/price/flags/desc/date) ────────────────────────────
    const title =
      norm(
        document.querySelector(
          'h1.product-title, h1[class*="title"], .product-detail h1',
        )?.textContent,
      ) || null;

    const priceEl =
      document.querySelector(
        '.desktop-information-price, .product-price-wrapper .price, [class*="product-price"] strong',
      ) ?? document.querySelector('[class*="price-value"], [class*="fiyat"]');
    const priceText = norm(priceEl?.textContent) || null;

    const fullText = document.body?.textContent ?? '';
    const negotiable =
      fullText.includes('Pazarlık') ||
      fullText.includes('pazarlık') ||
      fullText.includes('Fiyatı Müzakere');
    const swapAvailable =
      fullText.includes('Takasa Uygun') ||
      fullText.includes('takasa uygun') ||
      !!document.querySelector('[class*="takas"]');

    const descEl =
      document.querySelector('#tab-description .tab-content-wrapper') ??
      document.querySelector('#tab-description') ??
      document.querySelector('[class*="description-content"]');
    const description = norm(descEl?.textContent) || null;

    const dateEl = document.querySelector(
      '.listing-date, [class*="ilan-tarihi"], [class*="listing-date"]',
    );
    const listingDateText = norm(dateEl?.textContent) || null;

    // ── Damage / tramer report ───────────────────────────────────────────────
    let damageReport: string | null = null;
    const tramSection =
      document.querySelector('[class*="tramer"]') ??
      document.querySelector('[class*="hasar"]') ??
      document.querySelector('[class*="accident"]');
    if (tramSection) {
      damageReport = norm(tramSection.textContent) || null;
    } else {
      const items = document.querySelectorAll('.property-item');
      for (const item of Array.from(items)) {
        const k = (item.querySelector('.property-key')?.textContent ?? '')
          .toLowerCase()
          .trim();
        if (k.includes('tramer') || k.includes('hasar')) {
          damageReport =
            norm(item.querySelector('.property-value')?.textContent) || null;
          break;
        }
      }
    }

    return {
      scripts,
      specs,
      imageUrls,
      seller: { name: sellerName, memberType: sellerMemberType, phone: sellerPhone },
      location: { city: locCity, district: locDistrict, rawText: locText },
      misc: { title, priceText, negotiable, swapAvailable, description, listingDateText },
      damageReport,
    };
  });
}

// ─── Script-text parsers (run in Node on returned script bodies) ─────────────

/**
 * arabam.com embeds structured data via Google Tag Manager's setTargeting calls.
 * Pattern: googletag.pubads().setTargeting('key', 'value');
 */
function extractGtmTargeting(scripts: string[]): Record<string, string> {
  const targeting: Record<string, string> = {};
  const pattern = /setTargeting\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\)/g;
  for (const script of scripts) {
    if (!script.includes('setTargeting(')) continue;
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(script)) !== null) {
      targeting[match[1]] = match[2];
    }
  }
  return targeting;
}

function extractCollectDataIdentity(scripts: string[]): CollectDataIdentity {
  const marker = 'var collectDataObject = ';
  for (const script of scripts) {
    const markerIndex = script.indexOf(marker);
    if (markerIndex === -1) continue;

    try {
      let start = markerIndex + marker.length;
      while (start < script.length && /\s/.test(script[start])) start++;
      if (script[start] !== '{') continue;

      let depth = 0;
      let quoteChar: '"' | "'" | null = null;
      let escaped = false;
      let end = start;

      for (; end < script.length; end++) {
        const ch = script[end];

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

      const objectLiteral = script.slice(start, end + 1);
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
    }
  }
  return { brand: null, model: null, serial: null };
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

function sellerTypeFromMember(
  memberType: string,
): 'galeri' | 'sahibinden' | 'yetkili_bayi' | null {
  if (!memberType) return null;
  if (memberType.includes('yetkili') || memberType.includes('bayi')) return 'yetkili_bayi';
  if (memberType.includes('galeri') || memberType.includes('galeriden')) return 'galeri';
  if (
    memberType.includes('sahibinden') ||
    memberType.includes('bireysel') ||
    memberType.includes('özel')
  ) {
    return 'sahibinden';
  }
  return null;
}

// ─── Main parse function ──────────────────────────────────────────────────────

/**
 * Full extraction from a rendered arabam.com detail page.
 * One CDP round-trip pulls everything; remaining work is pure CPU in Node.
 */
export async function parseDetailPage(page: Page): Promise<DetailData> {
  const raw = await extractAllPageData(page);

  const gtm = extractGtmTargeting(raw.scripts);
  const collectIdentity = extractCollectDataIdentity(raw.scripts);
  const { specs, imageUrls, seller, location, misc, damageReport } = raw;

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
  const accidentHistory =
    getSpec(specs, 'Ağır Hasarlı', 'Ağır Hasar Kaydı', 'Hasar Kaydı', 'Kaza Kaydı') ?? null;

  // City fallback: GTM has city if DOM location not found
  const city = location.city ?? gtm['city'] ?? null;

  // Seller type fallback from title/page text
  let sellerType = sellerTypeFromMember(seller.memberType);
  if (!sellerType) {
    const pageTitle = (misc.title ?? '').toLowerCase();
    if (pageTitle.includes('yetkili') || pageTitle.includes('bayi')) sellerType = 'yetkili_bayi';
    else if (pageTitle.includes('galeriden')) sellerType = 'galeri';
    else if (pageTitle.includes('sahibinden')) sellerType = 'sahibinden';
  }

  // Listing date — prefer specs table "İlan Tarihi" over DOM scrape.
  const listingDateRaw = getSpec(specs, 'İlan Tarihi', 'Tarih') ?? misc.listingDateText;
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
    price: parsePrice(misc.priceText),
    negotiable: misc.negotiable,
    paintCondition,
    accidentHistory,
    swapAvailable: misc.swapAvailable,
    damageReport,
    city,
    district: location.district,
    sellerName: seller.name,
    sellerType,
    sellerPhone: seller.phone,
    imageUrls,
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
  const match = clean.match(/^(\d{1,2})\s+([a-zçğışöü]+)\s+(\d{4})$/);
  if (!match) return null;
  const day = match[1].padStart(2, '0');
  const month = TURKISH_MONTHS[match[2]];
  const year = match[3];
  if (!month) return null;
  return `${year}-${month}-${day}`;
}
