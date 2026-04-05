import { z } from 'zod';

export const PlatformEnum = z.enum(['arabam', 'sahibinden']);
export type Platform = z.infer<typeof PlatformEnum>;

const ARABAM_URL_PATTERN = /^https?:\/\/(www\.)?arabam\.com\//;
const SAHIBINDEN_URL_PATTERN = /^https?:\/\/(www\.)?sahibinden\.com\//;

export const InputSchema = z
  .object({
    platforms: z
      .array(
        PlatformEnum,
        { invalid_type_error: 'platforms must be an array of platform names ("arabam", "sahibinden")' },
      )
      .min(1, 'At least one platform must be selected')
      .default(['arabam', 'sahibinden']),

    dealerUrls: z
      .array(
        z.string().url('Each dealerUrl must be a valid URL').refine(
          (u) => ARABAM_URL_PATTERN.test(u) || SAHIBINDEN_URL_PATTERN.test(u),
          {
            message:
              'dealerUrls must be arabam.com or sahibinden.com URLs ' +
              '(e.g. https://www.arabam.com/galeri/reform-motors or ' +
              'https://www.sahibinden.com/magaza/dealer-name)',
          },
        ),
      )
      .optional()
      .default([]),

    searchByCity: z.string().min(1, 'searchByCity cannot be empty if provided').optional(),
    searchByMake: z.string().min(1, 'searchByMake cannot be empty if provided').optional(),

    maxDealers: z
      .number({ invalid_type_error: 'maxDealers must be a number' })
      .int('maxDealers must be an integer')
      .min(1, 'maxDealers must be at least 1')
      .max(500, 'maxDealers cannot exceed 500')
      .default(50),

    includeInventory: z.boolean().default(false),

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
  })
  .superRefine((data, ctx) => {
    const hasUrls = data.dealerUrls.length > 0;
    const hasSearch = data.searchByCity || data.searchByMake;
    if (!hasUrls && !hasSearch) {
      ctx.addIssue({
        code: 'custom',
        path: ['dealerUrls'],
        message:
          'Provide at least one of: dealerUrls, searchByCity, or searchByMake. ' +
          'Example: { "searchByCity": "istanbul", "searchByMake": "BMW" }',
      });
    }
  });

export type Input = z.infer<typeof InputSchema>;

export interface InventoryItem {
  make: string | null;
  model: string | null;
  year: number | null;
  mileage: number | null;
  price: number | null;
  fuelType: string | null;
  transmission: string | null;
  listingUrl: string;
}

export interface InventorySummary {
  totalListings: number;
  averagePrice: number;
  medianPrice: number;
  priceRange: { min: number; max: number } | null;
  topMakes: { make: string; count: number }[];
  averageMileage: number | null;
  averageYear: number | null;
  listingsByFuelType: Record<string, number>;
}

export interface DealerProfile {
  type: 'DEALER_PROFILE';
  dealerId: string;
  platform: Platform;
  dealerName: string;
  dealerUrl: string;
  dealerSlug: string;
  logo: string | null;
  city: string | null;
  district: string | null;
  fullAddress: string | null;
  phone: string | null;
  website: string | null;
  activeListingCount: number | null;
  totalSalesCount: number | null;
  memberSince: string | null;
  rating: number | null;
  reviewCount: number | null;
  verified: boolean;
  badges: string[];
  responseTime: string | null;
  inventory: InventorySummary | null;
  companyType: string | null;
  taxId: string | null;
  scrapedAt: string;
  sourceUrl: string;
}

export interface RunSummary {
  type: 'RUN_SUMMARY';
  totalRecords: number;
  platformResults: Record<Platform, number>;
  blockedPlatforms: Platform[];
  durationSeconds: number;
  errors: number;
  warnings: string[];
}

export const LABEL = {
  DISCOVER_ARABAM: 'DISCOVER_ARABAM',
  DISCOVER_SAHIBINDEN: 'DISCOVER_SAHIBINDEN',
  GALERI_PROFILE: 'GALERI_PROFILE',
  GALERI_INVENTORY: 'GALERI_INVENTORY',
  MAGAZA_PROFILE: 'MAGAZA_PROFILE',
  MAGAZA_INVENTORY: 'MAGAZA_INVENTORY',
} as const;

export type Label = (typeof LABEL)[keyof typeof LABEL];
