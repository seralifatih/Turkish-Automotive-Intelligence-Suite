/**
 * main.ts — Entry point for the Arabam.com Vehicle Scraper
 *
 * Flow:
 * 1. Read and validate input (Zod)
 * 2. Configure PlaywrightCrawler with stealth plugin + TR residential proxy
 * 3. Seed the request queue:
 *    a) Filter-based: build arabam.com search URLs
 *    b) Direct searchUrls: enqueue as SEARCH
 *    c) Direct listingUrls: enqueue as DETAIL
 * 4. Crawl until maxListings reached or queue exhausted
 * 5. Push RUN_SUMMARY record to dataset
 */

import { Actor } from 'apify';
import { PlaywrightCrawler, log, LogLevel } from 'crawlee';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { router, setMaxListings, getState } from './routes.js';
import { InputSchema, LABEL, FUEL_TO_ID, TRANSMISSION_TO_ID } from './types.js';
import type { Input, Filters } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'https://www.arabam.com';
const DEFAULT_TAKE = 20;

// ─── URL building ─────────────────────────────────────────────────────────────

/**
 * Slugify a vehicle make/model string for use in arabam.com URLs.
 * "Volkswagen" → "volkswagen", "Land Rover" → "land-rover"
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .replace(/Ğ/g, 'ğ')
    .replace(/Ş/g, 'ş')
    .replace(/Ü/g, 'ü')
    .replace(/Ö/g, 'ö')
    .replace(/Ç/g, 'ç')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9ğışöüç-]/g, '');
}

/**
 * Build arabam.com search URL(s) from filter input.
 *
 * URL pattern:
 *   /ikinci-el/otomobil/{make}-{model}
 *   ?take=20&skip=0
 *   &minYear=X&maxYear=Y
 *   &minPrice=X&maxPrice=Y
 *   &fuel=X&gear=X
 *   &city=X
 *
 * Returns an array — city filter may produce multiple URLs if city is not
 * supported as a URL param (some cities need breadcrumb navigation).
 */
function buildSearchUrls(filters: Filters): string[] {
  const parts: string[] = [BASE_URL, 'ikinci-el', 'otomobil'];

  if (filters.make) {
    const makeSlug = slugify(filters.make);
    if (filters.model) {
      parts.push(`${makeSlug}-${slugify(filters.model)}`);
    } else {
      parts.push(makeSlug);
    }
  }

  const url = new URL(parts.join('/'));
  url.searchParams.set('take', String(DEFAULT_TAKE));
  url.searchParams.set('skip', '0');

  if (filters.yearMin) url.searchParams.set('minYear', String(filters.yearMin));
  if (filters.yearMax) url.searchParams.set('maxYear', String(filters.yearMax));
  if (filters.priceMin) url.searchParams.set('minPrice', String(filters.priceMin));
  if (filters.priceMax) url.searchParams.set('maxPrice', String(filters.priceMax));
  if (filters.mileageMax) url.searchParams.set('maxKm', String(filters.mileageMax));

  if (filters.fuelType) {
    const fuelId = FUEL_TO_ID[filters.fuelType];
    if (fuelId) url.searchParams.set('fuel', fuelId);
  }

  if (filters.transmission) {
    const gearId = TRANSMISSION_TO_ID[filters.transmission];
    if (gearId) url.searchParams.set('gear', gearId);
  }

  if (filters.city) {
    // arabam.com city filter: lowercase Turkish city name
    url.searchParams.set('city', slugify(filters.city));
  }

  return [url.toString()];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

await Actor.init();

try {
  // ── Input validation ────────────────────────────────────────────────────────

  const rawInput = (await Actor.getInput<Record<string, unknown>>()) ?? {};
  const parseResult = InputSchema.safeParse(rawInput);

  if (!parseResult.success) {
    const errors = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid input:\n${errors}`);
  }

  const input: Input = parseResult.data;

  log.setLevel(LogLevel.INFO);
  log.info('Arabam.com Vehicle Scraper starting', {
    maxListings: input.maxListings,
    scrapeDetails: input.scrapeDetails,
    hasFilters: !!input.filters,
    searchUrlCount: input.searchUrls?.length ?? 0,
    listingUrlCount: input.listingUrls?.length ?? 0,
  });

  setMaxListings(input.maxListings);

  // ── Validate that we have at least one input source ─────────────────────────

  const hasSearchUrls = (input.searchUrls?.length ?? 0) > 0;
  const hasListingUrls = (input.listingUrls?.length ?? 0) > 0;
  const hasFilters = !!input.filters && (!!input.filters.make || !!input.filters.model);

  if (!hasSearchUrls && !hasListingUrls && !hasFilters) {
    throw new Error(
      'No input provided. Supply at least one of: searchUrls, listingUrls, or filters.make/model.',
    );
  }

  // ── Configure stealth ───────────────────────────────────────────────────────

  chromium.use(StealthPlugin());

  // ── Proxy configuration ─────────────────────────────────────────────────────

  const proxyConfiguration = input.proxyConfig?.useApifyProxy
    ? await Actor.createProxyConfiguration({
        groups: input.proxyConfig.apifyProxyGroups ?? ['RESIDENTIAL'],
        countryCode: input.proxyConfig.countryCode ?? 'TR',
      })
    : input.proxyConfig?.proxyUrls?.length
      ? await Actor.createProxyConfiguration({ proxyUrls: input.proxyConfig.proxyUrls })
      : undefined;

  if (!proxyConfiguration) {
    log.warning('No proxy configured. Arabam.com may block direct requests. Consider using TR residential proxies.');
  }

  // ── Build initial request list ──────────────────────────────────────────────

  const initialRequests: Array<{ url: string; label: string; userData: Record<string, unknown> }> = [];

  // Filter-based search URLs
  if (hasFilters && !hasSearchUrls) {
    const searchUrls = buildSearchUrls(input.filters!);
    for (const url of searchUrls) {
      initialRequests.push({ url, label: LABEL.SEARCH, userData: { input } });
    }
    log.info(`Built ${searchUrls.length} filter-based search URL(s): ${searchUrls.join(', ')}`);
  }

  // Direct search page URLs
  if (hasSearchUrls) {
    for (const url of input.searchUrls!) {
      if (!url.includes('arabam.com')) {
        log.warning(`Skipping non-arabam.com search URL: ${url}`);
        continue;
      }
      // Ensure take/skip params are present
      const normalized = new URL(url);
      if (!normalized.searchParams.has('take')) normalized.searchParams.set('take', String(DEFAULT_TAKE));
      if (!normalized.searchParams.has('skip')) normalized.searchParams.set('skip', '0');
      initialRequests.push({ url: normalized.toString(), label: LABEL.SEARCH, userData: { input } });
    }
  }

  // Direct listing URLs
  if (hasListingUrls) {
    for (const url of input.listingUrls!) {
      if (!url.includes('arabam.com')) {
        log.warning(`Skipping non-arabam.com listing URL: ${url}`);
        continue;
      }
      initialRequests.push({ url, label: LABEL.DETAIL, userData: { input } });
    }
  }

  log.info(`Seeding queue with ${initialRequests.length} initial request(s)`);

  // ── Crawler configuration ───────────────────────────────────────────────────

  const startTime = Date.now();
  const errors: string[] = [];

  const crawler = new PlaywrightCrawler({
    // Headless is required on Apify containers — non-headless hangs or isn't supported
    headless: true,

    launchContext: {
      launcher: chromium as never,
      launchOptions: {
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--lang=tr-TR,tr',
          '--accept-lang=tr-TR,tr,en-US,en',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      },
    },

    browserPoolOptions: {
      useFingerprints: true,
      fingerprintOptions: {
        fingerprintGeneratorOptions: {
          browsers: ['chrome'],
          operatingSystems: ['windows', 'macos'],
          devices: ['desktop'],
          locales: ['tr-TR'],
        },
      },
    },

    proxyConfiguration,

    minConcurrency: 3,
    maxConcurrency: 5,
    maxRequestRetries: 2,

    requestHandlerTimeoutSecs: 90,
    navigationTimeoutSecs: 30,

    autoscaledPoolOptions: {
      systemStatusOptions: {
        maxCpuOverloadedRatio: 0.9,
      },
    },

    preNavigationHooks: [
      async ({ page, request }, gotoOptions) => {
        const pageWithRouteFlag = page as typeof page & { __arabamRouteSetup?: boolean };
        const isDetailPage = request.url.includes('/ilan/');

        gotoOptions.waitUntil = 'domcontentloaded';
        gotoOptions.timeout = isDetailPage ? 25_000 : 20_000;

        if (!pageWithRouteFlag.__arabamRouteSetup) {
          await page.route('**/*', async (route) => {
            const resourceType = route.request().resourceType();
            const url = route.request().url();

            if (resourceType === 'image' || resourceType === 'media' || resourceType === 'font') {
              await route.abort();
              return;
            }

            if (
              url.includes('googletagmanager.com') ||
              url.includes('google-analytics.com') ||
              url.includes('doubleclick.net') ||
              url.includes('facebook.net') ||
              url.includes('creativecdn.com')
            ) {
              await route.abort();
              return;
            }

            await route.continue();
          });
          pageWithRouteFlag.__arabamRouteSetup = true;
        }

        await page.setExtraHTTPHeaders({
          'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        });

        const viewports = [
          { width: 1920, height: 1080 },
          { width: 1440, height: 900 },
          { width: 1366, height: 768 },
          { width: 1600, height: 900 },
        ];
        const vp = viewports[Math.floor(Math.random() * viewports.length)];
        await page.setViewportSize(vp);
      },
    ],

    postNavigationHooks: [
      async ({ page, request }) => {
        const isDetailPage = request.url.includes('/ilan/');

        // Shorter delays — enough to avoid rate limits but not blowing the run budget
        const delay = isDetailPage
          ? 300 + Math.floor(Math.random() * 400)
          : 500 + Math.floor(Math.random() * 500);
        await page.waitForTimeout(delay);
      },
    ],

    requestHandler: router,

    failedRequestHandler: async ({ request }) => {
      const errMsg = `Failed: ${request.url} — ${request.errorMessages?.join(', ')}`;
      log.error(errMsg);
      errors.push(errMsg);
    },
  });

  await crawler.addRequests(initialRequests);
  await crawler.run();

  // ── Run summary ─────────────────────────────────────────────────────────────

  const finalState = getState();
  const durationSeconds = Math.round((Date.now() - startTime) / 1000);

  const runSummary = {
    type: 'RUN_SUMMARY',
    totalRecords: finalState.totalPushed,
    durationSeconds,
    errors: errors.length,
    warnings: errors.slice(0, 20), // First 20 errors as warnings
    inputSummary: {
      maxListings: input.maxListings,
      scrapeDetails: input.scrapeDetails,
      initialRequests: initialRequests.length,
    },
  };

  log.info(`Run complete: ${finalState.totalPushed} records in ${durationSeconds}s`);
  await Actor.pushData(runSummary);

} finally {
  await Actor.exit();
}
