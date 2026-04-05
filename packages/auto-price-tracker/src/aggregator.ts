/**
 * aggregator.ts
 * Statistical price analysis for the Turkish Auto Price Tracker.
 *
 * Core algorithm:
 * 1. Remove outliers (prices below p5 or above p95)
 * 2. Compute full distribution statistics on the cleaned set
 * 3. Segment by mileage bucket and seller type
 * 4. Produce per-platform breakdowns
 *
 * Minimum 5 listings required per platform to include it in the summary.
 */

import type { PriceRecord, PriceSummary, Platform, PlatformBreakdown, VehicleSpec } from './types.js';

const MIN_LISTINGS_PER_PLATFORM = 5;

// ─── Core math ────────────────────────────────────────────────────────────────

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/**
 * Percentile using linear interpolation (same as numpy default).
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const idx = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (idx - lower);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(sortedValues: number[]): number {
  return percentile(sortedValues, 50);
}

function stdDev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.round(Math.sqrt(variance));
}

function round(n: number): number {
  return Math.round(n);
}

// ─── Outlier removal ──────────────────────────────────────────────────────────

/**
 * Remove prices below p5 and above p95 to eliminate spam listings and
 * data-entry errors before computing averages.
 */
function removeOutliers(prices: number[]): number[] {
  if (prices.length < 10) return prices; // not enough data to safely remove outliers
  const s = sorted(prices);
  const p5 = percentile(s, 5);
  const p95 = percentile(s, 95);
  return prices.filter((p) => p >= p5 && p <= p95);
}

// ─── Bucket helpers ───────────────────────────────────────────────────────────

type MileageBucket = '0-50k' | '50k-100k' | '100k-150k' | '150k+';

function mileageBucket(km: number | null): MileageBucket | null {
  if (km === null) return null;
  if (km < 50_000) return '0-50k';
  if (km < 100_000) return '50k-100k';
  if (km < 150_000) return '100k-150k';
  return '150k+';
}

interface BucketStat {
  avg: number;
  median: number;
  count: number;
}

function bucketStat(prices: number[]): BucketStat | null {
  if (prices.length === 0) return null;
  const s = sorted(prices);
  const avg = mean(s);
  return { avg: round(avg), median: round(median(s)), count: s.length };
}

// ─── Platform breakdown ───────────────────────────────────────────────────────

function computePlatformBreakdown(
  records: PriceRecord[],
  platform: Platform,
): PlatformBreakdown {
  const platformRecords = records.filter((r) => r.platform === platform);
  const prices = platformRecords.map((r) => r.price);

  if (prices.length < MIN_LISTINGS_PER_PLATFORM) {
    return {
      count: prices.length,
      avgPrice: 0,
      medianPrice: 0,
      minPrice: 0,
      maxPrice: 0,
      included: false,
      skipReason:
        prices.length === 0
          ? 'No listings found'
          : `Only ${prices.length} listings (minimum ${MIN_LISTINGS_PER_PLATFORM} required)`,
    };
  }

  const clean = removeOutliers(prices);
  const s = sorted(clean);
  const avg = mean(s);

  return {
    count: prices.length,
    avgPrice: round(avg),
    medianPrice: round(median(s)),
    minPrice: s[0],
    maxPrice: s[s.length - 1],
    included: true,
    skipReason: null,
  };
}

// ─── Main aggregator ──────────────────────────────────────────────────────────

export function aggregate(
  records: PriceRecord[],
  spec: VehicleSpec,
  requestedPlatforms: Platform[],
): PriceSummary {
  const now = new Date().toISOString();

  // ── Platform breakdown ────────────────────────────────────────────────────
  const platformBreakdown = {} as Record<Platform, PlatformBreakdown>;
  for (const platform of (['arabam', 'sahibinden', 'otomoto'] as Platform[])) {
    platformBreakdown[platform] = computePlatformBreakdown(records, platform);
  }

  // ── Overall statistics (only from platforms with enough data) ─────────────
  const includedRecords = records.filter(
    (r) => platformBreakdown[r.platform].included,
  );

  // If no platform has enough data, fall back to all records
  const workingRecords = includedRecords.length > 0 ? includedRecords : records;
  const allPrices = workingRecords.map((r) => r.price);

  let overall: PriceSummary['overall'];

  if (allPrices.length === 0) {
    overall = {
      averagePrice: 0,
      medianPrice: 0,
      minPrice: 0,
      maxPrice: 0,
      stdDeviation: 0,
      pricePercentiles: { p5: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0 },
    };
  } else {
    const cleanPrices = removeOutliers(allPrices);
    const s = sorted(cleanPrices);
    const avg = mean(s);

    overall = {
      averagePrice: round(avg),
      medianPrice: round(median(s)),
      minPrice: s[0],
      maxPrice: s[s.length - 1],
      stdDeviation: stdDev(s, avg),
      pricePercentiles: {
        p5: round(percentile(s, 5)),
        p10: round(percentile(s, 10)),
        p25: round(percentile(s, 25)),
        p50: round(percentile(s, 50)),
        p75: round(percentile(s, 75)),
        p90: round(percentile(s, 90)),
        p95: round(percentile(s, 95)),
      },
    };
  }

  // ── Mileage buckets ───────────────────────────────────────────────────────
  const buckets: Record<MileageBucket, number[]> = {
    '0-50k': [],
    '50k-100k': [],
    '100k-150k': [],
    '150k+': [],
  };

  for (const r of workingRecords) {
    const bucket = mileageBucket(r.mileage);
    if (bucket) buckets[bucket].push(r.price);
  }

  // ── Seller type buckets ───────────────────────────────────────────────────
  const galeriPrices = workingRecords
    .filter((r) => r.sellerType === 'galeri' || r.sellerType === 'yetkili_bayi')
    .map((r) => r.price);
  const sahibindenPrices = workingRecords
    .filter((r) => r.sellerType === 'sahibinden')
    .map((r) => r.price);

  // ── Vehicle spec description ───────────────────────────────────────────────
  const yearRange =
    spec.yearMin && spec.yearMax
      ? `${spec.yearMin}–${spec.yearMax}`
      : spec.yearMin
        ? `${spec.yearMin}+`
        : spec.yearMax
          ? `≤${spec.yearMax}`
          : 'Tüm yıllar';

  return {
    type: 'PRICE_SUMMARY',
    vehicleSpec: {
      make: spec.make,
      model: spec.model,
      yearRange,
      fuelType: spec.fuelType ?? null,
      transmission: spec.transmission ?? null,
    },
    totalListingsFound: records.length,
    totalListingsUsed: workingRecords.length,
    platformBreakdown,
    overall,
    priceByMileageBucket: {
      '0-50k': bucketStat(buckets['0-50k']),
      '50k-100k': bucketStat(buckets['50k-100k']),
      '100k-150k': bucketStat(buckets['100k-150k']),
      '150k+': bucketStat(buckets['150k+']),
    },
    priceBySellerType: {
      galeri: bucketStat(galeriPrices),
      sahibinden: bucketStat(sahibindenPrices),
    },
    generatedAt: now,
  };
}
