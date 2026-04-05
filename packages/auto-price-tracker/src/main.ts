/**
 * main.ts — Entry point for the Turkish Auto Price Tracker
 *
 * Flow (per vehicle spec):
 *   1. Build search URLs for each requested platform
 *   2. Scrape up to maxListingsPerPlatform from each
 *   3. Normalize all listings to PriceRecord schema
 *   4. Push individual PriceRecords to dataset
 *   5. Compute PriceSummary via aggregator
 *   6. Push PriceSummary to dataset
 *
 * Anti-detection:
 *   - PlaywrightCrawler with stealth plugin
 *   - TR residential proxies
 *   - maxConcurrency 1 for Sahibinden, 3 for Arabam
 *   - Extended delays 3–12 seconds
 */

import { Actor } from 'apify';
import { PlaywrightCrawler, log, LogLevel, Dataset } from 'crawlee';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { InputSchema } from './types.js';
import type { Input, VehicleSpec, PriceRecord, Platform, RunSummary } from './types.js';
import { aggregate } from './aggregator.js';
import {
  buildArabamUrl,
  scrapeArabamPage,
  toArabamPriceRecord,
} from './platforms/arabam.js';
import {
  buildSahibindenUrl,
  scrapeSahibindenPage,
  toSahibindenPriceRecord,
} from './platforms/sahibinden.js';
import {
  buildOtomotoUrl,
  scrapeOtomotoPage,
  toOtomotoPriceRecord,
} from './platforms/otomoto.js';
import { SahibindenStealth } from '@workspace/shared/sahibinden-stealth';

// ─── Constants ────────────────────────────────────────────────────────────────

const PLATFORM_CONCURRENCY: Record<Platform, number> = {
  arabam: 3,
  sahibinden: 1,
  otomoto: 2,
};

// ─── Per-platform scraping orchestration ─────────────────────────────────────

interface PlatformResult {
  platform: Platform;
  records: PriceRecord[];
  blocked: boolean;
  unavailable: boolean;
  message: string | null;
}

/**
 * Scrape all pages for a single platform + vehicle spec combo.
 * Handles pagination until maxListings reached or no more results.
 *
 * Uses PlaywrightCrawler internally — each call creates a short-lived crawler.
 */
async function scrapeOnePlatform(
  platform: Platform,
  spec: VehicleSpec,
  input: Input,
  proxyConfiguration: Awaited<ReturnType<typeof Actor.createProxyConfiguration>>,
): Promise<PlatformResult> {
  const maxListings = input.maxListingsPerPlatform;
  const allRecords: PriceRecord[] = [];
  let blocked = false;
  let unavailable = false;
  let blockMessage: string | null = null;
  let offset = 0;
  const pageSize = 20;

  while (allRecords.length < maxListings) {
    let url: string | null = null;

    if (platform === 'arabam') {
      url = buildArabamUrl(spec, input.city, offset, pageSize);
    } else if (platform === 'sahibinden') {
      if (!input.sahibindenCookies?.length) {
        log.warning(`[Sahibinden] No session cookies provided — skipping`);
        blocked = true;
        blockMessage = 'No session cookies provided. Export cookies from sahibinden.com and pass via sahibindenCookies input.';
        break;
      }
      url = buildSahibindenUrl(spec, input.city, offset);
    } else if (platform === 'otomoto') {
      url = buildOtomotoUrl(spec, input.city, Math.floor(offset / pageSize) + 1);
      if (!url) {
        unavailable = true;
        blockMessage = 'OtoMoto Turkey (otomoto.com.tr) is currently inactive.';
        break;
      }
    }

    if (!url) break;

    log.info(`[${platform}] Scraping page offset=${offset}: ${url}`);

    // Short-lived crawler for one page at a time
    let pageRecords: PriceRecord[] = [];
    let hasMore = false;

    await new Promise<void>((resolve) => {
      const crawler = new PlaywrightCrawler({
        headless: platform !== 'sahibinden', // non-headless for Sahibinden (better CF bypass)
        launchContext: {
          launcher: chromium as never,
          launchOptions: {
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-blink-features=AutomationControlled',
              '--lang=tr-TR,tr',
            ],
          },
        },
        proxyConfiguration,
        maxConcurrency: PLATFORM_CONCURRENCY[platform],
        maxRequestRetries: 2,
        requestHandlerTimeoutSecs: 90,
        navigationTimeoutSecs: 60,
        preNavigationHooks: [
          async ({ page, request }) => {
            await page.setExtraHTTPHeaders({
              'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8',
            });

            const currentPlatform = (request.userData as { platform: Platform }).platform;
            if (currentPlatform === 'sahibinden') {
              const stealth = new SahibindenStealth(page.context());
              await stealth.setup(input.sahibindenCookies ?? []);
              await stealth.applyPageViewport(page);
              return;
            }

            const viewports = [
              { width: 1920, height: 1080 },
              { width: 1440, height: 900 },
              { width: 1366, height: 768 },
            ];
            const vp = viewports[Math.floor(Math.random() * viewports.length)];
            await page.setViewportSize(vp);
          },
        ],
        postNavigationHooks: [
          async ({ page, request }) => {
            // Platform-specific delays
            const currentPlatform = (request.userData as { platform: Platform }).platform;
            const minDelay = currentPlatform === 'sahibinden' ? 5000 : 3000;
            const maxDelay = currentPlatform === 'sahibinden' ? 12000 : 7000;
            const delay = minDelay + Math.floor(Math.random() * (maxDelay - minDelay));

            if (currentPlatform === 'sahibinden') {
              const stealth = new SahibindenStealth(page.context());
              await stealth.randomMouseMovement(page, 3);
            }

            await page.waitForTimeout(delay);
          },
        ],
        async requestHandler({ page, request }) {
          const ctx = request.userData as {
            platform: Platform;
            spec: VehicleSpec;
          };

          if (ctx.platform === 'arabam') {
            const result = await scrapeArabamPage(page, ctx.spec);
            pageRecords = result.listings
              .filter((l) => l.price)
              .map((l) => toArabamPriceRecord(l, ctx.spec));
            hasMore = result.hasMore;

          } else if (ctx.platform === 'sahibinden') {
            const result = await scrapeSahibindenPage(
              page,
              page.context(),
              ctx.spec,
              input.sahibindenCookies,
            );
            if (result.blocked) {
              blocked = true;
              blockMessage = result.blockReason;
            } else {
              pageRecords = result.listings
                .filter((l) => l.price)
                .map((l) => toSahibindenPriceRecord(l, ctx.spec));
              hasMore = result.hasMore;
            }

          } else if (ctx.platform === 'otomoto') {
            const result = await scrapeOtomotoPage(page, ctx.spec);
            if (result.platformUnavailable) {
              unavailable = true;
              blockMessage = result.unavailableMessage;
            } else {
              pageRecords = result.listings
                .filter((l) => l.price)
                .map((l) => toOtomotoPriceRecord(l, ctx.spec));
              hasMore = result.hasMore;
            }
          }

          resolve();
        },
        failedRequestHandler({ request }) {
          log.error(`[${platform}] Request failed: ${request.url}`);
          resolve();
        },
      });

      crawler
        .run([{ url: url!, userData: { platform, spec } }])
        .then(() => resolve())
        .catch((err) => {
          log.error(`[${platform}] Crawler error: ${err}`);
          resolve();
        });
    });

    allRecords.push(...pageRecords);

    if (blocked || unavailable || !hasMore || pageRecords.length === 0) break;

    offset += pageSize;

    // Safety: avoid infinite pagination
    if (offset > 10 * pageSize) {
      log.warning(`[${platform}] Pagination safety limit reached`);
      break;
    }
  }

  return {
    platform,
    records: allRecords.slice(0, maxListings),
    blocked,
    unavailable,
    message: blockMessage,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

await Actor.init();

try {
  const rawInput = (await Actor.getInput<Record<string, unknown>>()) ?? {};
  const parseResult = InputSchema.safeParse(rawInput);

  if (!parseResult.success) {
    const errors = parseResult.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid input:\n${errors}`);
  }

  const input: Input = parseResult.data;

  log.setLevel(LogLevel.INFO);
  log.info('Turkish Auto Price Tracker starting', {
    vehicles: input.vehicles.length,
    platforms: input.platforms,
    maxListingsPerPlatform: input.maxListingsPerPlatform,
    hasSahibindenCookies: (input.sahibindenCookies?.length ?? 0) > 0,
  });

  if (input.platforms.includes('sahibinden') && !(input.sahibindenCookies?.length)) {
    log.warning(
      '[Sahibinden] No session cookies provided. Sahibinden will be skipped while the remaining platforms continue.',
    );
  }

  // ── Proxy configuration ────────────────────────────────────────────────────
  chromium.use(StealthPlugin());

  const proxyConfiguration = input.proxyConfig?.useApifyProxy
    ? await Actor.createProxyConfiguration({
        groups: input.proxyConfig.apifyProxyGroups ?? ['RESIDENTIAL'],
        countryCode: input.proxyConfig.countryCode ?? 'TR',
      })
    : input.proxyConfig?.proxyUrls?.length
      ? await Actor.createProxyConfiguration({ proxyUrls: input.proxyConfig.proxyUrls })
      : undefined;

  if (!proxyConfiguration) {
    log.warning('No proxy configured. TR residential proxies are strongly recommended.');
  }

  // ── Run tracking ───────────────────────────────────────────────────────────
  const startTime = Date.now();
  const platformCounts: Record<Platform, number> = { arabam: 0, sahibinden: 0, otomoto: 0 };
  const blockedPlatforms: Platform[] = [];
  const unavailablePlatforms: Platform[] = [];
  const warnings: string[] = [];
  let errorCount = 0;

  // ── Process each vehicle spec ──────────────────────────────────────────────
  for (const spec of input.vehicles) {
    log.info(`Processing: ${spec.make} ${spec.model} ${spec.yearMin ?? ''}–${spec.yearMax ?? ''}`);

    const allRecords: PriceRecord[] = [];

    // Scrape each platform sequentially per vehicle spec
    // (avoid hammering all platforms at once for a single query)
    for (const platform of input.platforms) {
      try {
        const result = await scrapeOnePlatform(
          platform,
          spec,
          input,
          proxyConfiguration as Awaited<ReturnType<typeof Actor.createProxyConfiguration>>,
        );

        if (result.unavailable) {
          if (!unavailablePlatforms.includes(platform)) {
            unavailablePlatforms.push(platform);
          }
          const msg = `[${platform}] Platform unavailable: ${result.message}`;
          log.warning(msg);
          warnings.push(msg);
          continue;
        }

        if (result.blocked) {
          if (!blockedPlatforms.includes(platform)) {
            blockedPlatforms.push(platform);
          }
          const msg = `[${platform}] Blocked: ${result.message}`;
          log.warning(msg);
          warnings.push(msg);
          continue;
        }

        log.info(`[${platform}] Collected ${result.records.length} price records`);
        allRecords.push(...result.records);
        platformCounts[platform] += result.records.length;

        // Push individual PriceRecords immediately
        for (const record of result.records) {
          await Dataset.pushData(record);
        }

      } catch (err) {
        const errMsg = `[${platform}] Error scraping ${spec.make} ${spec.model}: ${err}`;
        log.error(errMsg);
        warnings.push(errMsg);
        errorCount++;
      }
    }

    // ── Compute and push PriceSummary ────────────────────────────────────────
    if (allRecords.length === 0) {
      log.warning(`No listings found for ${spec.make} ${spec.model} — skipping summary`);
      warnings.push(`No listings found for ${spec.make} ${spec.model}`);
      continue;
    }

    const summary = aggregate(allRecords, spec, input.platforms);
    await Dataset.pushData(summary);

    log.info(
      `[Summary] ${spec.make} ${spec.model}: ` +
      `avg=${summary.overall.averagePrice.toLocaleString()} TRY, ` +
      `median=${summary.overall.medianPrice.toLocaleString()} TRY, ` +
      `n=${summary.totalListingsUsed}`,
    );
  }

  // ── Run summary ────────────────────────────────────────────────────────────
  const durationSeconds = Math.round((Date.now() - startTime) / 1000);
  const totalRecords = Object.values(platformCounts).reduce((a, b) => a + b, 0);

  const runSummary: RunSummary = {
    type: 'RUN_SUMMARY',
    totalVehicleSpecs: input.vehicles.length,
    totalPriceRecords: totalRecords,
    platformResults: platformCounts,
    blockedPlatforms,
    unavailablePlatforms,
    durationSeconds,
    errors: errorCount,
    warnings: warnings.slice(0, 50),
  };

  await Dataset.pushData(runSummary);

  log.info(
    `Run complete: ${totalRecords} price records in ${durationSeconds}s | ` +
    `arabam=${platformCounts.arabam}, sahibinden=${platformCounts.sahibinden}, ` +
    `otomoto=${platformCounts.otomoto}`,
  );

} finally {
  await Actor.exit();
}
