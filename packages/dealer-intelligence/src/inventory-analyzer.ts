/**
 * inventory-analyzer.ts
 * Computes summary statistics from a dealer's inventory listing array.
 *
 * Used by both Arabam and Sahibinden platform modules.
 */

import type { InventoryItem, InventorySummary } from './types.js';

// ─── Math helpers ─────────────────────────────────────────────────────────────

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function median(sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0;
  const mid = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? Math.round((sortedValues[mid - 1] + sortedValues[mid]) / 2)
    : sortedValues[mid];
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Analyze a dealer's inventory and return summary statistics.
 *
 * @param items - Raw inventory listings from the dealer's listing pages
 * @returns InventorySummary with price stats, top makes, mileage/year averages,
 *          and fuel type breakdown
 */
export function analyzeInventory(items: InventoryItem[]): InventorySummary {
  const totalListings = items.length;

  // ── Prices ─────────────────────────────────────────────────────────────────
  const prices = items.map((i) => i.price).filter((p): p is number => p !== null && p > 0);
  const sortedPrices = sorted(prices);

  const averagePrice = mean(sortedPrices);
  const medianPrice = median(sortedPrices);
  const priceRange =
    sortedPrices.length > 0
      ? { min: sortedPrices[0], max: sortedPrices[sortedPrices.length - 1] }
      : null;

  // ── Top makes ──────────────────────────────────────────────────────────────
  const makeCounts = new Map<string, number>();
  for (const item of items) {
    if (!item.make) continue;
    const normalized = item.make.trim();
    makeCounts.set(normalized, (makeCounts.get(normalized) ?? 0) + 1);
  }
  const topMakes = [...makeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([make, count]) => ({ make, count }));

  // ── Mileage ────────────────────────────────────────────────────────────────
  const mileages = items
    .map((i) => i.mileage)
    .filter((m): m is number => m !== null && m > 0);
  const averageMileage = mileages.length > 0 ? mean(mileages) : null;

  // ── Year ───────────────────────────────────────────────────────────────────
  const years = items
    .map((i) => i.year)
    .filter((y): y is number => y !== null && y >= 1970);
  const averageYear = years.length > 0 ? Math.round(mean(years)) : null;

  // ── Fuel type breakdown ────────────────────────────────────────────────────
  const listingsByFuelType: Record<string, number> = {};
  for (const item of items) {
    if (!item.fuelType) {
      listingsByFuelType['bilinmiyor'] = (listingsByFuelType['bilinmiyor'] ?? 0) + 1;
      continue;
    }
    listingsByFuelType[item.fuelType] = (listingsByFuelType[item.fuelType] ?? 0) + 1;
  }

  return {
    totalListings,
    averagePrice,
    medianPrice,
    priceRange,
    topMakes,
    averageMileage,
    averageYear,
    listingsByFuelType,
  };
}
