import type { FuelType, TransmissionType, BodyType } from '@workspace/shared/auto-normalizer';
import { z } from 'zod';

// ─── Input Schema ─────────────────────────────────────────────────────────────

export const FiltersSchema = z.object({
  make: z.string().optional(),
  model: z.string().optional(),
  yearMin: z.number().int().min(1970).max(2030).optional(),
  yearMax: z.number().int().min(1970).max(2030).optional(),
  priceMin: z.number().int().positive().optional(),
  priceMax: z.number().int().positive().optional(),
  mileageMax: z.number().int().positive().optional(),
  fuelType: z.enum(['benzin', 'dizel', 'lpg', 'hybrid', 'elektrik', 'benzin_lpg']).optional(),
  transmission: z.enum(['manuel', 'otomatik', 'yarı_otomatik']).optional(),
  city: z.string().optional(),
  bodyType: z.enum(['sedan', 'hatchback', 'station_wagon', 'suv', 'coupe', 'cabrio', 'minivan', 'pickup']).optional(),
});

export type Filters = z.infer<typeof FiltersSchema>;

const ARABAM_URL_PATTERN = /^https?:\/\/(www\.)?arabam\.com\//;

export const InputSchema = z
  .object({
    searchUrls: z
      .array(
        z.string().url('Each searchUrl must be a valid URL').refine(
          (u) => ARABAM_URL_PATTERN.test(u),
          { message: 'searchUrls must be arabam.com URLs (e.g. https://www.arabam.com/ikinci-el/otomobil/volkswagen-passat)' },
        ),
      )
      .optional()
      .default([]),

    listingUrls: z
      .array(
        z.string().url('Each listingUrl must be a valid URL').refine(
          (u) => ARABAM_URL_PATTERN.test(u),
          { message: 'listingUrls must be arabam.com URLs (e.g. https://www.arabam.com/ilan/.../12345)' },
        ),
      )
      .optional()
      .default([]),

    filters: FiltersSchema.optional(),

    maxListings: z
      .number({ invalid_type_error: 'maxListings must be a number' })
      .int('maxListings must be an integer')
      .min(1, 'maxListings must be at least 1')
      .max(10000, 'maxListings cannot exceed 10,000')
      .default(200),

    scrapeDetails: z.boolean().default(true),

    proxyConfig: z
      .object({
        useApifyProxy: z.boolean().optional(),
        apifyProxyGroups: z.array(z.string()).optional(),
        countryCode: z.string().optional(),
        proxyUrls: z.array(z.string().url('Each proxyUrl must be a valid URL')).optional(),
      })
      .optional(),
  })
  .refine(
    (data) =>
      data.searchUrls.length > 0 ||
      data.listingUrls.length > 0 ||
      (data.filters && (data.filters.make || data.filters.model)),
    {
      message:
        'Provide at least one of: searchUrls, listingUrls, or filters.make/filters.model. ' +
        'Example filters: { "make": "volkswagen", "model": "passat", "yearMin": 2018 }',
    },
  );

export type Input = z.infer<typeof InputSchema>;

// ─── Output Schema ────────────────────────────────────────────────────────────

const PriceSchema = z.object({
  amount: z.number(),
  currency: z.literal('TRY'),
});

const PaintConditionSchema = z.object({
  originalText: z.string(),
  paintedPanels: z.number().int().min(0),
  replacedPanels: z.number().int().min(0),
  isOriginal: z.boolean(),
});

export const ArabamVehicleSchema = z.object({
  // Identification
  listingId: z.string(),
  title: z.string(),
  url: z.string().url(),

  // Vehicle identity
  make: z.string(),
  model: z.string(),
  variant: z.string().nullable(),
  year: z.number().int().min(1970).max(2030).nullable(),
  bodyType: z.string().nullable(),

  // Specs
  mileage: z.number().int().min(0).nullable(),
  fuelType: z.string().nullable(),
  transmission: z.string().nullable(),
  engineSize: z.number().int().nullable(),
  horsePower: z.number().int().nullable(),
  drivetrain: z.string().nullable(),
  color: z.string().nullable(),
  doors: z.number().int().nullable(),

  // Pricing
  price: PriceSchema.nullable(),
  negotiable: z.boolean(),

  // Condition
  paintCondition: PaintConditionSchema.nullable(),
  accidentHistory: z.string().nullable(),
  swapAvailable: z.boolean(),

  // Location
  city: z.string().nullable(),
  district: z.string().nullable(),

  // Seller
  sellerType: z.enum(['galeri', 'sahibinden', 'yetkili_bayi']).nullable(),
  sellerName: z.string().nullable(),
  sellerPhone: z.string().nullable(),

  // Listing metadata
  listingDate: z.string().nullable(),
  imageUrls: z.array(z.string()),
  imageCount: z.number().int().min(0),
  featured: z.boolean(),

  // Detail page fields
  description: z.string().nullable(),
  specifications: z.record(z.string(), z.string()),
  damageReport: z.string().nullable(),

  // Scrape metadata
  scrapedAt: z.string(),
  sourceUrl: z.string(),
});

export type ArabamVehicle = z.infer<typeof ArabamVehicleSchema>;

// ─── Router Labels ────────────────────────────────────────────────────────────

export const LABEL = {
  SEARCH: 'SEARCH',
  DETAIL: 'DETAIL',
} as const;

export type Label = (typeof LABEL)[keyof typeof LABEL];

// ─── Arabam filter → query param mappings ─────────────────────────────────────

/**
 * Arabam.com uses numeric IDs for fuel and transmission filters.
 * Determined from GTM targeting data on the live site.
 */
export const FUEL_TO_ID: Record<FuelType, string> = {
  benzin: '1',
  dizel: '2',
  lpg: '3',
  benzin_lpg: '4',
  hybrid: '5',
  elektrik: '6',
};

export const TRANSMISSION_TO_ID: Record<TransmissionType, string> = {
  manuel: '1',
  otomatik: '2',
  yarı_otomatik: '3',
};

export const BODY_TO_SLUG: Record<BodyType, string> = {
  sedan: 'sedan',
  hatchback: 'hatchback',
  station_wagon: 'stationwagon',
  suv: 'suv',
  coupe: 'coupe',
  cabrio: 'cabrio-roadster',
  minivan: 'mpv',
  pickup: 'pickup',
};
