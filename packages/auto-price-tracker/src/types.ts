import { z } from 'zod';

export const VehicleSpecSchema = z
  .object({
    make: z
      .string({ required_error: 'make is required (e.g. "Volkswagen", "Toyota")' })
      .min(1, 'make cannot be empty'),
    model: z
      .string({ required_error: 'model is required (e.g. "Passat", "Corolla")' })
      .min(1, 'model cannot be empty'),
    yearMin: z
      .number().int()
      .min(1970, 'yearMin must be 1970 or later')
      .max(2030, 'yearMin must be 2030 or earlier')
      .optional(),
    yearMax: z
      .number().int()
      .min(1970, 'yearMax must be 1970 or later')
      .max(2030, 'yearMax must be 2030 or earlier')
      .optional(),
    fuelType: z
      .enum(['benzin', 'dizel', 'lpg', 'hybrid', 'elektrik', 'benzin_lpg'], {
        errorMap: () => ({ message: 'fuelType must be one of: benzin, dizel, lpg, hybrid, elektrik, benzin_lpg' }),
      })
      .optional(),
    transmission: z
      .enum(['manuel', 'otomatik', 'yarı_otomatik'], {
        errorMap: () => ({ message: 'transmission must be one of: manuel, otomatik, yarı_otomatik' }),
      })
      .optional(),
  })
  .refine(
    (v) => !v.yearMin || !v.yearMax || v.yearMin <= v.yearMax,
    { message: 'yearMin cannot be greater than yearMax' },
  );

export type VehicleSpec = z.infer<typeof VehicleSpecSchema>;

export const PlatformEnum = z.enum(['arabam', 'sahibinden', 'otomoto']);
export type Platform = z.infer<typeof PlatformEnum>;

export const InputSchema = z.object({
  vehicles: z
    .array(VehicleSpecSchema, { required_error: 'vehicles array is required' })
    .min(1, 'At least one vehicle spec is required')
    .max(20, 'Maximum 20 vehicle specs per run (to avoid very long run times)'),

  platforms: z
    .array(
      PlatformEnum,
      { invalid_type_error: 'platforms must be an array of platform names' },
    )
    .min(1, 'At least one platform must be selected')
    .default(['arabam', 'sahibinden']),

  city: z.string().optional(),

  maxListingsPerPlatform: z
    .number({ invalid_type_error: 'maxListingsPerPlatform must be a number' })
    .int('maxListingsPerPlatform must be an integer')
    .min(5, 'maxListingsPerPlatform must be at least 5 (fewer produces unreliable statistics)')
    .max(500, 'maxListingsPerPlatform cannot exceed 500')
    .default(50),

  proxyConfig: z
    .object({
      useApifyProxy: z.boolean().optional(),
      apifyProxyGroups: z.array(z.string()).optional(),
      countryCode: z.string().optional(),
      proxyUrls: z.array(z.string().url('Each proxyUrl must be a valid URL')).optional(),
    })
    .optional(),

  sahibindenCookies: z
    .array(
      z.object({
        name: z.string().min(1, 'Cookie name cannot be empty'),
        value: z.string(),
        domain: z.string().optional(),
        path: z.string().optional(),
        expires: z.number().optional(),
        httpOnly: z.boolean().optional(),
        secure: z.boolean().optional(),
      }),
    )
    .optional()
    .default([]),
});

export type Input = z.infer<typeof InputSchema>;

export const PriceRecordSchema = z.object({
  type: z.literal('PRICE_RECORD'),
  platform: PlatformEnum,
  make: z.string(),
  model: z.string(),
  year: z.number().int().nullable(),
  fuelType: z.string().nullable(),
  transmission: z.string().nullable(),
  mileage: z.number().int().nullable(),
  price: z.number().positive(),
  currency: z.literal('TRY'),
  sellerType: z.enum(['galeri', 'sahibinden', 'yetkili_bayi']).nullable(),
  city: z.string().nullable(),
  paintCondition: z.string().nullable(),
  listingUrl: z.string().url(),
  vehicleFingerprint: z.string(),
  scrapedAt: z.string(),
});

export type PriceRecord = z.infer<typeof PriceRecordSchema>;

interface BucketStat {
  avg: number;
  median: number;
  count: number;
}

export interface PlatformBreakdown {
  count: number;
  avgPrice: number;
  medianPrice: number;
  minPrice: number;
  maxPrice: number;
  included: boolean;
  skipReason: string | null;
}

export interface PriceSummary {
  type: 'PRICE_SUMMARY';
  vehicleSpec: {
    make: string;
    model: string;
    yearRange: string;
    fuelType: string | null;
    transmission: string | null;
  };
  totalListingsFound: number;
  totalListingsUsed: number;
  platformBreakdown: Record<Platform, PlatformBreakdown>;
  overall: {
    averagePrice: number;
    medianPrice: number;
    minPrice: number;
    maxPrice: number;
    stdDeviation: number;
    pricePercentiles: {
      p5: number;
      p10: number;
      p25: number;
      p50: number;
      p75: number;
      p90: number;
      p95: number;
    };
  };
  priceByMileageBucket: {
    '0-50k': BucketStat | null;
    '50k-100k': BucketStat | null;
    '100k-150k': BucketStat | null;
    '150k+': BucketStat | null;
  };
  priceBySellerType: {
    galeri: BucketStat | null;
    sahibinden: BucketStat | null;
  };
  generatedAt: string;
}

export interface RunSummary {
  type: 'RUN_SUMMARY';
  totalVehicleSpecs: number;
  totalPriceRecords: number;
  platformResults: Record<Platform, number>;
  blockedPlatforms: Platform[];
  unavailablePlatforms: Platform[];
  durationSeconds: number;
  errors: number;
  warnings: string[];
}

export interface RawListing {
  price: number | null;
  year: number | null;
  mileage: number | null;
  fuelType: string | null;
  transmission: string | null;
  sellerType: 'galeri' | 'sahibinden' | 'yetkili_bayi' | null;
  city: string | null;
  paintCondition: string | null;
  listingUrl: string;
}
