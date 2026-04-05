/**
 * platforms/arabam.ts
 * Arabam.com dealer (galeri) profile scraping.
 *
 * ─── URL structure (confirmed via live research) ──────────────────────────────
 *
 * Galeri directory:   https://www.arabam.com/galeriler
 * Galeri profile:     https://www.arabam.com/galeri/{dealer-slug}
 * Galeri by city:     https://www.arabam.com/ikinci-el/otomobil-{city}-galeriden
 *                     → Each listing card links back to the galeri profile
 * Galeri by make:     https://www.arabam.com/ikinci-el/otomobil/{make}-galeriden
 *
 * Page title format:  "{Dealer Name} - {City} {District} Oto Galeri"
 *   → Parsed to extract name, city, district
 *
 * ─── Content strategy ────────────────────────────────────────────────────────
 * arabam.com galeri pages are Alpine.js-rendered. Static HTTP fetches return
 * only CSS + framework JS. We use Playwright and wait for content to render,
 * then target:
 *
 *   Dealer name:     h1, .galeri-name, [class*="dealer-name"], page title parse
 *   Stats:           .galeri-stats span, [class*="ilan-count"], [class*="member"]
 *   Rating:          [class*="rating"] or .star-count
 *   Logo:            img[class*="galeri-logo"], img[class*="dealer-logo"]
 *   Phone:           a[href^="tel:"]
 *   Inventory cards: .listing-list-item, same as Actor 1 (reuse insiderArray)
 *
 * Fallback for name/city/district:  parse from window.document.title
 *   Format: "Reform Motors - İstanbul Bağcılar Oto Galeri"
 *            ^name^          ^city^  ^district^
 */

import type { Page } from 'playwright';
import { log } from 'crawlee';
import {
  parseMileage,
  parseModelYear,
  normalizeFuelType,
  normalizeTransmission,
} from '@workspace/shared/auto-normalizer';
import type { DealerProfile, InventoryItem, Input } from '../types.js';
import { analyzeInventory } from '../inventory-analyzer.js';

// ─── URL builders ─────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .replace(/Ğ/g, 'ğ').replace(/Ş/g, 'ş')
    .replace(/Ü/g, 'ü').replace(/Ö/g, 'ö').replace(/Ç/g, 'ç')
    .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9ğışöüç-]/g, '');
}

/**
 * Build discovery URL to find dealer slugs in a city or by make.
 *
 * arabam.com listing search pages show "Galeriden" listings with hrefs
 * containing the galeri slug. We extract unique slugs from those hrefs.
 *
 * URL patterns (confirmed from live research):
 *   By city:  /ikinci-el/otomobil-{city}-galeriden
 *   By make:  /ikinci-el/otomobil/{make}-galeriden
 *   Both:     /ikinci-el/otomobil/{make}-{city}-galeriden (arabam supports this)
 */
export function buildDiscoveryUrl(
  searchByCity: string | undefined,
  searchByMake: string | undefined,
  skip = 0,
): string {
  let path = '/ikinci-el/otomobil';

  if (searchByMake && searchByCity) {
    path += `/${slugify(searchByMake)}-${slugify(searchByCity)}-galeriden`;
  } else if (searchByCity) {
    path += `-${slugify(searchByCity)}-galeriden`;
  } else if (searchByMake) {
    path += `/${slugify(searchByMake)}-galeriden`;
  } else {
    path += '-galeriden';
  }

  const url = new URL(`https://www.arabam.com${path}`);
  url.searchParams.set('take', '20');
  url.searchParams.set('skip', String(skip));
  return url.toString();
}

/**
 * Build URL for a dealer's galeri profile.
 */
export function buildGaleriUrl(slug: string): string {
  return `https://www.arabam.com/galeri/${slug}`;
}

// ─── Dealer slug extraction from discovery page ───────────────────────────────

/**
 * Extract unique galeri slugs from a listing search page.
 * Each listing card has a dealer link in the format:
 *   /galeri/{slug} or via .advert-owner-name href
 *
 * arabam.com listing cards show the galeri profile link in the seller section.
 * We also look for "galeriden" in listing hrefs and extract the galeri URL.
 */
export async function extractGaleriSlugs(page: Page): Promise<string[]> {
  return page.evaluate((): string[] => {
    const slugs = new Set<string>();

    // Method 1: Explicit galeri links (shown in detail pages and listing cards)
    document.querySelectorAll('a[href*="/galeri/"]').forEach((el) => {
      const href = el.getAttribute('href') ?? '';
      const match = href.match(/\/galeri\/([^/?#]+)/);
      if (match) slugs.add(match[1]);
    });

    // Method 2: Seller name container in listing cards
    // arabam shows advert-owner with a galeri link
    document.querySelectorAll('[class*="advert-owner"] a, [class*="seller"] a').forEach((el) => {
      const href = el.getAttribute('href') ?? '';
      const match = href.match(/\/galeri\/([^/?#]+)/);
      if (match) slugs.add(match[1]);
    });

    // Method 3: insiderArray listing URLs — vendor info not in array,
    // but we can fall back to extracting from listing hrefs
    document.querySelectorAll('a[href*="/ilan/galeriden-"]').forEach((el) => {
      const text = el.closest('[class*="listing"], tr, li')
        ?.querySelector('[class*="owner"], [class*="galeri"], [class*="seller"]')
        ?.getAttribute('href') ?? '';
      const match = text.match(/\/galeri\/([^/?#]+)/);
      if (match) slugs.add(match[1]);
    });

    return [...slugs];
  });
}

// ─── Galeri profile extraction ────────────────────────────────────────────────

/**
 * Parse dealer name, city, district from the page title.
 * Format: "Reform Motors - İstanbul Bağcılar Oto Galeri"
 */
function parseTitleForDealer(title: string): {
  name: string | null;
  city: string | null;
  district: string | null;
} {
  // Strip " Oto Galeri" suffix
  const withoutSuffix = title.replace(/\s*[-–]\s*Oto\s+Galeri\s*$/i, '').trim();
  // Split on " - "
  const parts = withoutSuffix.split(/\s*[-–]\s/);
  if (parts.length >= 2) {
    const name = parts[0].trim();
    // Location part: "İstanbul Bağcılar" or just "İstanbul"
    const locationPart = parts[1].trim();
    const locationTokens = locationPart.split(/\s+/);
    const city = locationTokens[0] ?? null;
    const district = locationTokens.slice(1).join(' ') || null;
    return { name, city, district };
  }
  return { name: withoutSuffix || null, city: null, district: null };
}

/**
 * Extract full dealer profile from a rendered galeri page.
 */
export async function extractGaleriProfile(page: Page, url: string): Promise<Omit<DealerProfile,
  'type' | 'dealerId' | 'platform' | 'dealerUrl' | 'dealerSlug' | 'inventory' | 'scrapedAt' | 'sourceUrl'
>> {
  const pageTitle = await page.title();
  const { name: titleName, city: titleCity, district: titleDistrict } = parseTitleForDealer(pageTitle);

  return page.evaluate(({ titleName, titleCity, titleDistrict }) => {
    // ── Dealer name ──────────────────────────────────────────────────────────
    const nameEl =
      document.querySelector('h1.galeri-name, h1[class*="galeri"], h1[class*="dealer-name"]') ??
      document.querySelector('.galeri-header h1, .dealer-header h1') ??
      document.querySelector('h1');
    const dealerName = nameEl?.textContent?.trim() ?? titleName ?? '';

    // ── Logo ─────────────────────────────────────────────────────────────────
    const logoEl =
      document.querySelector('img.galeri-logo, img[class*="galeri-logo"], img[class*="dealer-logo"]') ??
      document.querySelector('.galeri-header img, .dealer-logo img') as HTMLImageElement | null;
    const logo = (logoEl as HTMLImageElement | null)?.src ?? null;

    // ── Location ─────────────────────────────────────────────────────────────
    const locationEl =
      document.querySelector('.galeri-location, [class*="galeri-city"], [class*="dealer-location"]') ??
      document.querySelector('[class*="location-info"], .city-info');
    const locationText = locationEl?.textContent?.trim() ?? '';
    const locationParts = locationText.split(/[/,]/).map((s) => s.trim());
    const city = locationParts[0] || titleCity || null;
    const district = locationParts[1] || titleDistrict || null;

    // ── Stats ─────────────────────────────────────────────────────────────────
    // arabam galeri pages show stats like:
    //   "Aktif İlan: 47", "Üye Oldu: Mart 2018", "Toplam İlan: 1.240"
    const allText = document.body?.textContent ?? '';

    // Active listing count
    const activeMatch = allText.match(/aktif\s*i[li]an[:\s]+(\d[\d.]*)/i);
    const activeListingCount = activeMatch
      ? parseInt(activeMatch[1].replace(/\./g, ''), 10)
      : null;

    // Member since
    const memberMatch = allText.match(/üye\s+oldu[:\s]+([^.|\n]+)/i);
    const memberSince = memberMatch ? memberMatch[1].trim() : null;

    // Rating — look for star/puan text
    const ratingEl =
      document.querySelector('[class*="rating-score"], [class*="puan"], .galeri-rating') ??
      document.querySelector('[class*="star-count"]');
    const ratingText = ratingEl?.textContent?.trim().replace(',', '.') ?? '';
    const rating = ratingText ? parseFloat(ratingText) || null : null;

    // Review count
    const reviewMatch = allText.match(/(\d+)\s*değerlendirme|(\d+)\s*yorum/i);
    const reviewCount = reviewMatch
      ? parseInt(reviewMatch[1] ?? reviewMatch[2], 10)
      : null;

    // Total sales
    const salesMatch = allText.match(/toplam\s*(satış|ilan)[:\s]+(\d[\d.]*)/i);
    const totalSalesCount = salesMatch
      ? parseInt(salesMatch[2].replace(/\./g, ''), 10)
      : null;

    // ── Contact ───────────────────────────────────────────────────────────────
    const phoneEl = document.querySelector('a[href^="tel:"]') as HTMLAnchorElement | null;
    const phone = phoneEl?.getAttribute('href')?.replace('tel:', '').trim() ?? null;

    const websiteEl = document.querySelector('a[href^="http"][class*="website"], a[class*="web-site"]') as HTMLAnchorElement | null;
    const website = websiteEl?.href ?? null;

    // ── Address ───────────────────────────────────────────────────────────────
    const addressEl =
      document.querySelector('[class*="galeri-address"], [class*="address"]') ??
      document.querySelector('[itemtype*="PostalAddress"]');
    const fullAddress = addressEl?.textContent?.trim() ?? null;

    // ── Trust signals ─────────────────────────────────────────────────────────
    const badgeEls = Array.from(
      document.querySelectorAll('[class*="badge"], [class*="verified-badge"], [class*="galeri-badge"]'),
    );
    const badges = badgeEls
      .map((el) => el.textContent?.trim())
      .filter((b): b is string => !!b && b.length > 0 && b.length < 80);

    const verified =
      badges.some((b) => b.toLowerCase().includes('onay') || b.toLowerCase().includes('doğrula') || b.toLowerCase().includes('yetkili')) ||
      !!document.querySelector('[class*="verified"], [class*="onaylı"]');

    // ── Response time ─────────────────────────────────────────────────────────
    const responseMatch = allText.match(/yanıt\s*süresi[:\s]+([^\n.]+)/i);
    const responseTime = responseMatch ? responseMatch[1].trim() : null;

    // ── Business type ─────────────────────────────────────────────────────────
    const companyTypeEl = document.querySelector('[class*="company-type"], [class*="galeri-type"]');
    const companyType = companyTypeEl?.textContent?.trim() ?? null;

    // Tax ID — rarely shown publicly
    const taxMatch = allText.match(/vergi\s*no[:\s]+(\d{10,11})/i);
    const taxId = taxMatch ? taxMatch[1] : null;

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
      companyType,
      taxId,
    };
  }, { titleName, titleCity, titleDistrict });
}

// ─── Inventory extraction ─────────────────────────────────────────────────────

/**
 * Extract the dealer's active vehicle listings for inventory analysis.
 *
 * arabam.com shows dealer inventory on the galeri profile page itself.
 * The listing grid uses the same structure as the main search results
 * (insiderArray + .listing-list-item DOM cards).
 *
 * Pagination: the galeri page may have a "Tüm İlanları Gör" (see all) link
 * that leads to a filtered listing search. We follow that pattern.
 */
export async function extractInventoryFromGaleri(
  page: Page,
  dealerSlug: string,
  maxItems = 100,
): Promise<InventoryItem[]> {
  const items: InventoryItem[] = [];
  let skip = 0;
  const take = 20;

  while (items.length < maxItems) {
    const html = await page.content();

    // Extract insiderArray from current page
    const insiderMatch = html.match(/var\s+insiderArray\s*=\s*(\[[\s\S]*?\])(?:\s*;|\s*\n)/);
    if (insiderMatch) {
      try {
        const products = JSON.parse(insiderMatch[1]) as Array<{
          id: string;
          name: string;
          taxonomy: string[];
          unit_price: number;
          url: string;
        }>;

        for (const p of products) {
          const make = p.taxonomy[1] ?? null;
          const model = p.taxonomy[2] ?? null;
          items.push({
            make,
            model,
            year: null,
            mileage: null,
            price: p.unit_price > 0 ? p.unit_price : null,
            fuelType: null,
            transmission: null,
            listingUrl: p.url.startsWith('http') ? p.url : `https://www.arabam.com${p.url}`,
          });
        }
      } catch {
        // fallback to DOM
      }
    }

    // Supplement from DOM cards for year/km/fuel
    const domItems = await page.evaluate((): Array<{
      priceText: string | null;
      year: number | null;
      kmText: string | null;
      fuelText: string | null;
      gearText: string | null;
      href: string | null;
    }> => {
      return Array.from(document.querySelectorAll('tr.listing-list-item, li.listing-list-item')).map((card) => {
        const priceEl = card.querySelector('.listing-price');
        const link = card.querySelector('a[href*="/ilan/"]') as HTMLAnchorElement | null;
        const specSpans = Array.from(card.querySelectorAll('.listing-text span')).map((el) => el.textContent?.trim() ?? '');
        const yearText = specSpans.find((s) => /^(19[7-9]\d|20\d{2})$/.test(s)) ?? null;
        const kmText = specSpans.find((s) => /\d.*km/i.test(s)) ?? null;
        const fuelText = specSpans.find((s) =>
          ['benzin', 'dizel', 'lpg', 'elektrik', 'hibrit'].some((kw) => s.toLowerCase().includes(kw))
        ) ?? null;
        const gearText = specSpans.find((s) =>
          ['manuel', 'otomatik', 'düz'].some((kw) => s.toLowerCase().includes(kw))
        ) ?? null;
        return {
          priceText: priceEl?.textContent?.trim() ?? null,
          year: yearText ? parseInt(yearText, 10) : null,
          kmText,
          fuelText,
          gearText,
          href: link?.href ?? null,
        };
      });
    });

    // Merge DOM data into items where we have URL match
    for (const dom of domItems) {
      if (!dom.href) continue;
      const existing = items.find((it) => it.listingUrl && dom.href && it.listingUrl.includes(dom.href.split('/').pop() ?? ''));
      if (existing) {
        existing.year = existing.year ?? dom.year;
        existing.mileage = existing.mileage ?? (dom.kmText ? parseMileage(dom.kmText) : null);
        existing.fuelType = existing.fuelType ?? (dom.fuelText ? normalizeFuelType(dom.fuelText) : null);
        existing.transmission = existing.transmission ?? (dom.gearText ? normalizeTransmission(dom.gearText) : null);
      } else {
        // Item not in insiderArray (can happen) — add from DOM
        const priceClean = (dom.priceText ?? '').replace(/TL|₺|\s|\./g, '');
        const price = parseInt(priceClean, 10) || null;
        items.push({
          make: null,
          model: null,
          year: dom.year,
          mileage: dom.kmText ? parseMileage(dom.kmText) : null,
          price,
          fuelType: dom.fuelText ? normalizeFuelType(dom.fuelText) : null,
          transmission: dom.gearText ? normalizeTransmission(dom.gearText) : null,
          listingUrl: dom.href,
        });
      }
    }

    if (domItems.length < take || items.length >= maxItems) break;

    // Navigate to next page of dealer listings
    skip += take;
    const nextUrl = new URL(page.url());
    nextUrl.searchParams.set('skip', String(skip));
    nextUrl.searchParams.set('take', String(take));

    try {
      await page.goto(nextUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2000 + Math.floor(Math.random() * 2000));
    } catch {
      log.warning(`[Arabam Inventory] Failed to navigate to page skip=${skip}`);
      break;
    }

    // Safety: don't paginate forever
    if (skip > 10 * take) break;
  }

  return items.slice(0, maxItems);
}

// ─── Full dealer scrape ───────────────────────────────────────────────────────

/**
 * Scrape a complete dealer profile from a rendered arabam.com galeri page.
 */
export async function scrapeGaleriProfile(
  page: Page,
  url: string,
  includeInventory: boolean,
): Promise<DealerProfile | null> {
  // Wait for page to render (Alpine.js content)
  await page.waitForSelector(
    'h1, .galeri-name, [class*="galeri"], .listing-list-item',
    { timeout: 25_000 },
  ).catch(() => log.debug('[Arabam Galeri] Content selector timed out'));

  // Check for 404 or error page
  const title = await page.title();
  if (title.toLowerCase().includes('sayfa bulunamadı') || title.toLowerCase().includes('404')) {
    log.warning(`[Arabam Galeri] Page not found: ${url}`);
    return null;
  }

  // Extract slug from URL
  const slugMatch = url.match(/\/galeri\/([^/?#]+)/);
  const dealerSlug = slugMatch ? slugMatch[1] : url.split('/').pop() ?? '';

  const profileData = await extractGaleriProfile(page, url);

  let inventory = null;
  if (includeInventory) {
    const inventoryItems = await extractInventoryFromGaleri(page, dealerSlug, 100);
    if (inventoryItems.length > 0) {
      inventory = analyzeInventory(inventoryItems);
      log.info(`[Arabam Galeri] Analyzed ${inventoryItems.length} inventory items for ${profileData.dealerName}`);
    } else {
      log.warning(`[Arabam Galeri] No inventory items found for ${profileData.dealerName}`);
    }
  }

  return {
    type: 'DEALER_PROFILE',
    dealerId: `arabam-${dealerSlug}`,
    platform: 'arabam',
    dealerUrl: url,
    dealerSlug,
    ...profileData,
    inventory,
    scrapedAt: new Date().toISOString(),
    sourceUrl: url,
  };
}
