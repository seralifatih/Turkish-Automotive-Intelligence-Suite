/**
 * main.ts — Entry point for the Turkish Auto Dealer Intelligence actor.
 *
 * Flow:
 *   1. Validate input
 *   2. Seed request queue:
 *      a) Direct dealerUrls → enqueue as GALERI_PROFILE or MAGAZA_PROFILE
 *      b) searchByCity / searchByMake → discover dealer slugs first,
 *         then enqueue profile pages
 *   3. PlaywrightCrawler processes each profile
 *   4. If includeInventory: scrape up to 100 listings per dealer
 *   5. Push RUN_SUMMARY
 */

import { Actor } from 'apify';
import { PlaywrightCrawler, log, LogLevel, Dataset } from 'crawlee';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { InputSchema, LABEL } from './types.js';
import type { Input, Platform, RunSummary } from './types.js';
import {
  buildDiscoveryUrl as arabamDiscoveryUrl,
  buildGaleriUrl,
  extractGaleriSlugs,
  scrapeGaleriProfile,
} from './platforms/arabam.js';
import {
  buildDiscoveryUrl as sahibindenDiscoveryUrl,
  buildMagazaUrl,
  extractMagazaSlugs,
  scrapeMagazaProfile,
} from './platforms/sahibinden.js';
import { SahibindenStealth } from '@workspace/shared/sahibinden-stealth';

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
  log.info('Turkish Auto Dealer Intelligence starting', {
    platforms: input.platforms,
    dealerUrls: input.dealerUrls.length,
    searchByCity: input.searchByCity,
    searchByMake: input.searchByMake,
    maxDealers: input.maxDealers,
    includeInventory: input.includeInventory,
    hasCookies: (input.sahibindenCookies?.length ?? 0) > 0,
  });

  // Validate Sahibinden requirements
  if (input.platforms.includes('sahibinden') && !(input.sahibindenCookies?.length)) {
    log.warning(
      '[Sahibinden] No session cookies provided. Sahibinden profiles will be skipped. ' +
      'Export cookies from sahibinden.com via EditThisCookie and pass via sahibindenCookies.',
    );
  }

  // Validate that at least one input source is provided
  const hasDealerUrls = input.dealerUrls.length > 0;
  const hasSearch = !!input.searchByCity || !!input.searchByMake;
  if (!hasDealerUrls && !hasSearch) {
    throw new Error(
      'No input provided. Supply at least one of: dealerUrls, searchByCity, or searchByMake.',
    );
  }

  // ── Proxy ────────────────────────────────────────────────────────────────────
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
    log.warning('No proxy configured. TR residential proxies strongly recommended.');
  }

  // ── State tracking ────────────────────────────────────────────────────────────
  const startTime = Date.now();
  const platformCounts: Record<Platform, number> = { arabam: 0, sahibinden: 0 };
  const blockedPlatforms = new Set<Platform>();
  const warnings: string[] = [];
  let errorCount = 0;
  let totalDiscovered = 0;

  // ── Dealer URL discovery ──────────────────────────────────────────────────────

  const dealerJobQueue: Array<{ url: string; platform: Platform }> = [];

  // Direct URLs — classify by domain
  for (const url of input.dealerUrls) {
    if (url.includes('arabam.com')) {
      dealerJobQueue.push({ url, platform: 'arabam' });
    } else if (url.includes('sahibinden.com')) {
      dealerJobQueue.push({ url, platform: 'sahibinden' });
    } else {
      log.warning(`Unrecognized platform URL: ${url} — skipping`);
    }
  }

  // Discovery via search
  if (hasSearch) {
    log.info(`Discovering dealers: city=${input.searchByCity ?? 'any'}, make=${input.searchByMake ?? 'any'}`);

    // Arabam discovery
    if (input.platforms.includes('arabam')) {
      const discoveredSlugs = new Set<string>();
      let skip = 0;

      const discoveryRunner = new PlaywrightCrawler({
        headless: true,
        launchContext: { launcher: chromium as never },
        proxyConfiguration,
        maxConcurrency: 2,
        maxRequestRetries: 2,
        async requestHandler({ page }) {
          await page.waitForSelector('.listing-list-item, [class*="listing"]', { timeout: 20_000 })
            .catch(() => {});

          const slugs = await extractGaleriSlugs(page);
          log.info(`[Arabam Discovery] Found ${slugs.length} galeri slugs`);
          for (const slug of slugs) {
            if (!discoveredSlugs.has(slug) && discoveredSlugs.size < input.maxDealers) {
              discoveredSlugs.add(slug);
              dealerJobQueue.push({ url: buildGaleriUrl(slug), platform: 'arabam' });
            }
          }
          totalDiscovered = discoveredSlugs.size;
        },
        failedRequestHandler({ request }) {
          log.warning(`[Arabam Discovery] Failed: ${request.url}`);
        },
      });

      // Paginate discovery until we have enough dealers
      const discoveryUrls: string[] = [];
      while (discoveredSlugs.size < input.maxDealers && skip <= 20 * 20) {
        discoveryUrls.push(arabamDiscoveryUrl(input.searchByCity, input.searchByMake, skip));
        skip += 20;
        // Run in batches of 3 pages
        if (discoveryUrls.length >= 3) {
          await discoveryRunner.run(discoveryUrls.splice(0, 3).map((u) => ({ url: u })));
        }
      }
      if (discoveryUrls.length > 0) {
        await discoveryRunner.run(discoveryUrls.map((u) => ({ url: u })));
      }

      log.info(`[Arabam Discovery] Total unique galeri slugs: ${discoveredSlugs.size}`);
    }

    // Sahibinden discovery
    if (input.platforms.includes('sahibinden') && (input.sahibindenCookies?.length ?? 0) > 0) {
      const discoveredSlugs = new Set<string>();
      let offset = 0;

      const sahibindenDiscovery = new PlaywrightCrawler({
        headless: false,
        launchContext: { launcher: chromium as never },
        proxyConfiguration,
        maxConcurrency: 1,
        maxRequestRetries: 2,
        preNavigationHooks: [
          async ({ page }) => {
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });
            const stealth = new SahibindenStealth(page.context());
            await stealth.setup(input.sahibindenCookies ?? []);
            await stealth.applyPageViewport(page);
          },
        ],
        postNavigationHooks: [
          async ({ page }) => {
            const stealth = new SahibindenStealth(page.context());
            await stealth.randomMouseMovement(page, 3);
            await page.waitForTimeout(5000 + Math.floor(Math.random() * 5000));
          },
        ],
        async requestHandler({ page }) {
          const slugs = await extractMagazaSlugs(page);
          for (const slug of slugs) {
            if (!discoveredSlugs.has(slug) && discoveredSlugs.size < input.maxDealers) {
              discoveredSlugs.add(slug);
              dealerJobQueue.push({ url: buildMagazaUrl(slug), platform: 'sahibinden' });
            }
          }
        },
        failedRequestHandler({ request }) {
          log.warning(`[Sahibinden Discovery] Failed: ${request.url}`);
        },
      });

      const discoveryUrls: string[] = [];
      while (discoveredSlugs.size < input.maxDealers && offset <= 20 * 20) {
        discoveryUrls.push(sahibindenDiscoveryUrl(input.searchByCity, input.searchByMake, offset));
        offset += 20;
        if (discoveryUrls.length >= 2) {
          await sahibindenDiscovery.run(discoveryUrls.splice(0, 2).map((u) => ({ url: u })));
        }
      }
      if (discoveryUrls.length > 0) {
        await sahibindenDiscovery.run(discoveryUrls.map((u) => ({ url: u })));
      }
    } else if (input.platforms.includes('sahibinden')) {
      log.warning('[Sahibinden Discovery] Skipped — no session cookies provided');
      warnings.push('Sahibinden discovery skipped: no session cookies');
    }
  }

  log.info(`Total dealer profiles to scrape: ${dealerJobQueue.length}`);

  // Limit to maxDealers
  const deduplicated = [...new Map(dealerJobQueue.map((j) => [j.url, j])).values()];
  const jobs = deduplicated.slice(0, input.maxDealers);

  // ── Scrape each dealer profile ──────────────────────────────────────────────

  // Process arabam dealers
  const arabamJobs = jobs.filter((j) => j.platform === 'arabam');
  if (arabamJobs.length > 0) {
    const arabamCrawler = new PlaywrightCrawler({
      headless: false,
      launchContext: {
        launcher: chromium as never,
        launchOptions: {
          args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--lang=tr-TR'],
        },
      },
      proxyConfiguration,
      maxConcurrency: 3,
      maxRequestRetries: 2,
      requestHandlerTimeoutSecs: input.includeInventory ? 300 : 90,
      navigationTimeoutSecs: 60,
      preNavigationHooks: [
        async ({ page }) => {
          await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });
          const viewports = [
            { width: 1920, height: 1080 },
            { width: 1440, height: 900 },
            { width: 1366, height: 768 },
          ];
          await page.setViewportSize(viewports[Math.floor(Math.random() * viewports.length)]);
        },
      ],
      postNavigationHooks: [
        async ({ page }) => {
          await page.waitForTimeout(2000 + Math.floor(Math.random() * 4000));
        },
      ],
      async requestHandler({ request, page }) {
        const url = request.url;
        try {
          const profile = await scrapeGaleriProfile(page, url, input.includeInventory);
          if (!profile) {
            warnings.push(`No data extracted from ${url}`);
            return;
          }
          await Dataset.pushData(profile);
          platformCounts.arabam++;
          log.info(`[Arabam] Scraped dealer: ${profile.dealerName} (${platformCounts.arabam})`);
        } catch (err) {
          const msg = `[Arabam] Error on ${url}: ${err}`;
          log.error(msg);
          warnings.push(msg);
          errorCount++;
        }
      },
      failedRequestHandler({ request }) {
        const msg = `[Arabam] Failed: ${request.url}`;
        log.error(msg);
        warnings.push(msg);
        errorCount++;
      },
    });
    await arabamCrawler.run(arabamJobs.map((j) => ({ url: j.url })));
  }

  // Process sahibinden dealers
  const sahibindenJobs = jobs.filter((j) => j.platform === 'sahibinden');
  if (sahibindenJobs.length > 0) {
    if (!(input.sahibindenCookies?.length)) {
      log.warning('[Sahibinden] Skipping all sahibinden dealer profiles — no cookies');
      blockedPlatforms.add('sahibinden');
      warnings.push('Sahibinden profiles skipped: no session cookies');
    } else {
      const sahibindenCrawler = new PlaywrightCrawler({
        headless: false,
        launchContext: {
          launcher: chromium as never,
          launchOptions: {
            args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--lang=tr-TR'],
          },
        },
        proxyConfiguration,
        maxConcurrency: 1, // conservative for sahibinden
        maxRequestRetries: 2,
        requestHandlerTimeoutSecs: input.includeInventory ? 400 : 120,
        navigationTimeoutSecs: 60,
        preNavigationHooks: [
          async ({ page }) => {
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });
            const stealth = new SahibindenStealth(page.context());
            await stealth.setup(input.sahibindenCookies ?? []);
            await stealth.applyPageViewport(page);
          },
        ],
        postNavigationHooks: [
          async ({ page }) => {
            // sahibinden needs longer delays
            const stealth = new SahibindenStealth(page.context());
            await stealth.randomMouseMovement(page, 3);
            await page.waitForTimeout(5000 + Math.floor(Math.random() * 7000));
          },
        ],
        async requestHandler({ request, page }) {
          const url = request.url;
          try {
            const profile = await scrapeMagazaProfile(
              page,
              page.context(),
              url,
              input.sahibindenCookies,
              input.includeInventory,
            );
            if (!profile) {
              warnings.push(`No data or blocked on ${url}`);
              blockedPlatforms.add('sahibinden');
              return;
            }
            await Dataset.pushData(profile);
            platformCounts.sahibinden++;
            log.info(`[Sahibinden] Scraped dealer: ${profile.dealerName} (${platformCounts.sahibinden})`);
          } catch (err) {
            const msg = `[Sahibinden] Error on ${url}: ${err}`;
            log.error(msg);
            warnings.push(msg);
            errorCount++;
          }
        },
        failedRequestHandler({ request }) {
          const msg = `[Sahibinden] Failed: ${request.url}`;
          log.error(msg);
          warnings.push(msg);
          errorCount++;
        },
      });
      await sahibindenCrawler.run(sahibindenJobs.map((j) => ({ url: j.url })));
    }
  }

  // ── Run summary ─────────────────────────────────────────────────────────────
  const durationSeconds = Math.round((Date.now() - startTime) / 1000);
  const totalRecords = platformCounts.arabam + platformCounts.sahibinden;

  const runSummary: RunSummary = {
    type: 'RUN_SUMMARY',
    totalRecords,
    platformResults: platformCounts,
    blockedPlatforms: [...blockedPlatforms],
    durationSeconds,
    errors: errorCount,
    warnings: warnings.slice(0, 50),
  };

  await Dataset.pushData(runSummary);

  log.info(
    `Run complete: ${totalRecords} dealer profiles in ${durationSeconds}s | ` +
    `arabam=${platformCounts.arabam}, sahibinden=${platformCounts.sahibinden}`,
  );

} finally {
  await Actor.exit();
}
