# CLAUDE.md — Turkish Automotive Intelligence Suite

## Project Overview

This is the second actor cluster from the same developer behind the Turkish E-Commerce Intelligence Suite. It targets the Turkish automotive market — one of the largest in Europe by transaction volume — across three complementary data products.

### The Three Actors

| # | Actor Name | Target | Competition Level |
|---|-----------|--------|-------------------|
| 1 | **Arabam.com Vehicle Scraper** | arabam.com listings, specs, pricing | 1-2 basic actors exist, fragile |
| 2 | **Turkish Auto Price Tracker** | Cross-platform price aggregation from Arabam, Sahibinden Vasıta, and Otomoto Turkey | No cross-platform actor exists |
| 3 | **Turkish Auto Dealer Intelligence** | Dealer/galeri profiles, inventory, and reputation across Arabam and Sahibinden | Near-zero coverage |

### Why Automotive (Not Another E-Commerce Vertical)

- Turkey is Europe's #1 automotive producer by volume and has one of the continent's largest used car markets.
- **Arabam.com** has 400K+ active vehicle listings and minimal Apify coverage (1-2 actors, both basic).
- **Sahibinden Vasıta** (vehicle section) has existing scrapers but they break constantly due to Cloudflare — a better-engineered solution wins.
- **No cross-platform price tracker** exists. Buyers, dealers, and insurance companies all need this.
- Leverages the same shared module from Cluster 1 (Turkish text utils, TRY price normalization, proxy config).

### Buyer Persona

- **Used car dealers (galeriler)** researching pricing and sourcing inventory
- **Insurance and leasing companies** needing vehicle valuation data
- **Fleet management companies** tracking market prices for depreciation modeling
- **Individual buyers/sellers** wanting fair-market-value data
- **Automotive journalists and researchers** analyzing Turkish car market trends
- **Fintech/lending companies** building collateral valuation models

---

## Tech Stack

Identical to Cluster 1 for maximum code reuse:

- **Runtime:** Node.js 20+
- **Framework:** Apify SDK v3 + Crawlee
- **Scraping:** Playwright (primary — both Arabam and Sahibinden are heavily JS-rendered and Cloudflare-protected)
- **Language:** TypeScript
- **Testing:** Jest for unit tests
- **Shared module:** `@workspace/shared` from Cluster 1 (types, normalizer, turkish-utils, proxy-config, rate-limiter, error-handler)

### Key Difference from Cluster 1

Cluster 1 could use Cheerio for most tasks. This cluster **requires Playwright** as the primary crawler because:
- Sahibinden uses aggressive Cloudflare protection + mandatory login walls
- Arabam.com uses JavaScript rendering for listing pages
- Both require residential Turkish proxies and stealth techniques

---

## Project Structure

```
turkish-auto-suite/
├── CLAUDE.md
├── packages/
│   ├── shared/                        # Symlink or npm dependency to Cluster 1's shared module
│   │
│   ├── arabam-vehicle-scraper/        # Actor 1
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── routes.ts              # Search, category, detail page routes
│   │   │   ├── parsers/
│   │   │   │   ├── listing-parser.ts  # Parse search/category listing grids
│   │   │   │   └── detail-parser.ts   # Parse individual vehicle detail pages
│   │   │   ├── stealth.ts             # Anti-detection helpers
│   │   │   └── types.ts
│   │   ├── .actor/
│   │   │   ├── actor.json
│   │   │   └── input_schema.json
│   │   ├── README.md
│   │   └── package.json
│   │
│   ├── auto-price-tracker/            # Actor 2
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── routes.ts
│   │   │   ├── platforms/
│   │   │   │   ├── arabam.ts          # Arabam.com price extraction
│   │   │   │   ├── sahibinden.ts      # Sahibinden vasıta price extraction
│   │   │   │   └── otomoto.ts         # OtoMoto Turkey price extraction
│   │   │   ├── aggregator.ts          # Cross-platform price merging & stats
│   │   │   └── types.ts
│   │   ├── .actor/
│   │   │   ├── actor.json
│   │   │   └── input_schema.json
│   │   ├── README.md
│   │   └── package.json
│   │
│   └── dealer-intelligence/           # Actor 3
│       ├── src/
│       │   ├── main.ts
│       │   ├── routes.ts
│       │   ├── platforms/
│       │   │   ├── arabam.ts          # Arabam dealer/galeri profiles
│       │   │   └── sahibinden.ts      # Sahibinden dealer profiles
│       │   ├── inventory-analyzer.ts  # Dealer inventory summary stats
│       │   └── types.ts
│       ├── .actor/
│       │   ├── actor.json
│       │   └── input_schema.json
│       ├── README.md
│       └── package.json
│
├── tsconfig.base.json
└── package.json
```

---

## Shared Module Extensions

This cluster reuses `@workspace/shared` from Cluster 1 but adds automotive-specific utilities:

### `auto-normalizer.ts` — Vehicle Data Normalization

```typescript
// Normalize mileage strings: "150.000 km", "150000km", "150,000" → 150000
function parseMileage(text: string): number | null;

// Normalize engine displacement: "1.6", "1600 cc", "1,6 L" → 1600
function parseEngineSize(text: string): number | null;

// Normalize year: "2019", "2019 Model" → 2019
function parseModelYear(text: string): number | null;

// Normalize fuel type to enum
type FuelType = 'benzin' | 'dizel' | 'lpg' | 'hybrid' | 'elektrik' | 'benzin_lpg';
function normalizeFuelType(text: string): FuelType | null;

// Normalize transmission
type TransmissionType = 'manuel' | 'otomatik' | 'yarı_otomatik';
function normalizeTransmission(text: string): TransmissionType | null;

// Normalize body type
type BodyType = 'sedan' | 'hatchback' | 'station_wagon' | 'suv' | 'coupe' | 'cabrio' | 'minivan' | 'pickup';
function normalizeBodyType(text: string): BodyType | null;

// Generate a vehicle fingerprint for cross-platform matching
// "volkswagen-passat-2019-dizel-otomatik" format
function vehicleFingerprint(make: string, model: string, year: number, fuel: FuelType, transmission: TransmissionType): string;
```

### `sahibinden-stealth.ts` — Sahibinden Anti-Detection

Sahibinden.com is the hardest target in this cluster. Specific techniques needed:
- **Session cookie injection** — Users must provide their own Sahibinden session cookies (exported via EditThisCookie or similar). The actor never stores these.
- **Playwright stealth plugin** — `playwright-extra` with `stealth` plugin.
- **TR residential proxies only** — Datacenter IPs are instantly blocked.
- **maxConcurrency: 1-3** — Aggressive rate limiting required.
- **Random delays: 5-15 seconds** — Much slower than Cluster 1 targets.
- **Non-headless mode** — Better Cloudflare bypass.
- **User-Agent + viewport rotation** — Realistic browser fingerprints.

Arabam.com is moderately easier — JS rendering required but less aggressive anti-bot.

---

## Actor 1: Arabam.com Vehicle Scraper

### Purpose

Extract vehicle listing data from arabam.com — Turkey's dedicated automotive marketplace with 400K+ active listings. Existing actors are basic and unreliable. This actor provides comprehensive vehicle data extraction with proper anti-detection.

### Input Schema

```json
{
  "searchUrls": ["https://www.arabam.com/ikinci-el/otomobil/volkswagen-passat"],
  "filters": {
    "make": "Volkswagen",
    "model": "Passat",
    "yearMin": 2018,
    "yearMax": 2024,
    "priceMin": 500000,
    "priceMax": 1500000,
    "fuelType": "dizel",
    "transmission": "otomatik",
    "mileageMax": 100000,
    "city": "istanbul"
  },
  "listingUrls": ["https://www.arabam.com/ilan/..."],
  "maxListings": 200,
  "scrapeDetails": true,
  "proxyConfig": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"], "countryCode": "TR" }
}
```

### Output Schema (per vehicle)

```typescript
interface ArabamVehicle extends BaseRecord {
  listingId: string;
  title: string;
  url: string;

  // Vehicle identity
  make: string;                    // "Volkswagen"
  model: string;                   // "Passat"
  variant: string | null;          // "1.6 TDI BlueMotion Highline"
  year: number;
  bodyType: BodyType | null;

  // Specs
  mileage: number;                 // in km
  fuelType: FuelType;
  transmission: TransmissionType;
  engineSize: number | null;       // in cc
  horsePower: number | null;
  drivetrain: string | null;       // "FWD", "AWD", "RWD"
  color: string | null;
  doors: number | null;

  // Pricing
  price: { amount: number; currency: string };
  negotiable: boolean;

  // Condition
  paintCondition: string | null;    // "Boyasız", "3 boya", etc. (critical in Turkish market)
  accidentHistory: string | null;   // "Kazasız" or description
  swapAvailable: boolean;           // "Takas" availability

  // Location
  city: string;
  district: string | null;

  // Seller
  sellerType: 'galeri' | 'sahibinden' | 'yetkili_bayi'; // dealer, owner, authorized dealer
  sellerName: string;
  sellerPhone: string | null;

  // Listing metadata
  listingDate: string;             // ISO 8601
  imageUrls: string[];
  imageCount: number;
  featured: boolean;               // promoted listing
  
  // Detail page fields (only if scrapeDetails=true)
  description: string | null;
  specifications: Record<string, string>;  // Full specs table
  damageReport: string | null;      // Tramer/expertise report text if available
}
```

### Technical Notes — Arabam.com

- **URL patterns:** Search results at `arabam.com/ikinci-el/otomobil/{make}-{model}` with query params for filters.
- **Rendering:** JavaScript-rendered listing cards. Playwright required.
- **Pagination:** Scroll-based or page parameter — investigate via network tab.
- **API endpoints:** Check for XHR calls returning JSON listing data at `api.arabam.com` or similar. If available, this is dramatically faster than HTML parsing.
- **Anti-bot:** Moderate. Residential proxies recommended but not strictly required for light use.
- **Special fields:** `paintCondition` (boya durumu) and `accidentHistory` (kaza durumu) are critical buying signals in the Turkish market — always extract these.
- **Tramer record:** Some listings show insurance damage history — extract if visible.

### Pricing Strategy
- Pay-per-event: $6 per 1,000 vehicle listings.
- Premium justified by comprehensive specs and condition data.

---

## Actor 2: Turkish Auto Price Tracker

### Purpose

Cross-platform vehicle price aggregator. Given a vehicle specification (make, model, year, fuel, transmission), this actor searches Arabam.com, Sahibinden Vasıta, and OtoMoto Turkey, then returns a unified price report with market statistics.

**This actor does not exist anywhere on Apify.** It's the highest-value product in this cluster.

### Input Schema

```json
{
  "vehicles": [
    {
      "make": "Volkswagen",
      "model": "Passat",
      "yearMin": 2018,
      "yearMax": 2020,
      "fuelType": "dizel",
      "transmission": "otomatik"
    },
    {
      "make": "Toyota",
      "model": "Corolla",
      "yearMin": 2020,
      "yearMax": 2023
    }
  ],
  "platforms": ["arabam", "sahibinden", "otomoto"],
  "city": null,
  "maxListingsPerPlatform": 50,
  "proxyConfig": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"], "countryCode": "TR" },
  "sahibindenCookies": []
}
```

### Output Schema

Two output types — individual listings AND an aggregated summary:

```typescript
// Per-listing record
interface PriceRecord extends BaseRecord {
  make: string;
  model: string;
  year: number;
  fuelType: FuelType;
  transmission: TransmissionType;
  mileage: number;
  price: { amount: number; currency: string };
  sellerType: string;
  city: string;
  paintCondition: string | null;
  listingUrl: string;
  vehicleFingerprint: string;      // For cross-platform matching
}

// Aggregated summary (one per vehicle spec queried)
interface PriceSummary {
  type: "PRICE_SUMMARY";
  vehicleSpec: {
    make: string;
    model: string;
    yearRange: string;
    fuelType: string | null;
    transmission: string | null;
  };
  totalListingsFound: number;
  platformBreakdown: {
    arabam: { count: number; avgPrice: number; medianPrice: number };
    sahibinden: { count: number; avgPrice: number; medianPrice: number };
    otomoto: { count: number; avgPrice: number; medianPrice: number };
  };
  overall: {
    averagePrice: number;
    medianPrice: number;
    minPrice: number;
    maxPrice: number;
    stdDeviation: number;
    pricePercentiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
  };
  priceByMileageBucket: {
    "0-50k": { avg: number; count: number } | null;
    "50k-100k": { avg: number; count: number } | null;
    "100k-150k": { avg: number; count: number } | null;
    "150k+": { avg: number; count: number } | null;
  };
  priceBySellerType: {
    galeri: { avg: number; count: number } | null;
    sahibinden: { avg: number; count: number } | null;
  };
  generatedAt: string;
}
```

### Technical Notes — Cross-Platform

**Arabam.com:** Use the same scraping logic as Actor 1. Extract make/model/year/price/mileage.

**Sahibinden Vasıta (Vehicle section):**
- URL pattern: `sahibinden.com/otomobil/{make}` or search URLs
- Requires session cookies + residential TR proxy + Playwright stealth
- The hardest platform to scrape reliably. Always document limitations.
- Consider making Sahibinden support optional (enabled only when user provides session cookies).

**OtoMoto Turkey:**
- Part of OLX Group's automotive vertical
- URL: `otomoto.com.tr` (Turkey-specific domain)
- Investigate if this is SSR or JS-rendered
- Lower anti-bot protection than Sahibinden
- Smaller inventory but still relevant for price comparison

**Cross-platform matching:** Use `vehicleFingerprint` (make-model-year-fuel-transmission) to group listings across platforms. Mileage buckets provide fair comparison since a 50K km car shouldn't be compared to a 150K km car.

### Pricing Strategy
- Pay-per-event: $10 per price report (per vehicle spec queried).
- Premium pricing justified by multi-platform aggregation + statistical analysis.
- This is the highest-margin actor in the cluster.

---

## Actor 3: Turkish Auto Dealer Intelligence

### Purpose

Scrape dealer (galeri) profiles from Arabam.com and Sahibinden. Extract dealer identity, inventory size, active listing count, pricing patterns, customer ratings, and contact information. Serves brands evaluating dealer networks, competitors doing market research, and buyers assessing dealer reputation.

### Input Schema

```json
{
  "platforms": ["arabam", "sahibinden"],
  "dealerUrls": ["https://www.arabam.com/magaza/..."],
  "searchByCity": "istanbul",
  "searchByMake": "BMW",
  "maxDealers": 50,
  "includeInventory": true,
  "proxyConfig": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"], "countryCode": "TR" },
  "sahibindenCookies": []
}
```

### Output Schema (per dealer)

```typescript
interface DealerProfile extends BaseRecord {
  dealerId: string;
  dealerName: string;
  dealerUrl: string;
  logo: string | null;

  // Location
  city: string;
  district: string | null;
  fullAddress: string | null;

  // Contact
  phone: string | null;
  website: string | null;

  // Metrics
  activeListingCount: number;
  totalSalesCount: number | null;     // if available
  memberSince: string | null;         // ISO date
  rating: number | null;              // 0-5 normalized
  reviewCount: number | null;

  // Trust signals
  verified: boolean;                   // platform-verified dealer
  badges: string[];                    // "Güvenilir Galeri", "Yetkili Bayi", etc.
  responseTime: string | null;

  // Inventory analysis (only if includeInventory=true)
  inventory: {
    totalListings: number;
    averagePrice: number;
    medianPrice: number;
    priceRange: { min: number; max: number };
    topMakes: { make: string; count: number }[];
    averageMileage: number;
    averageYear: number;
    listingsByFuelType: Record<string, number>;
  } | null;

  // Business info
  companyType: string | null;         // "Galeri", "Yetkili Bayi", "Oto Ekspertiz"
  taxId: string | null;               // if publicly shown
}
```

### Technical Notes — Dealer Pages

**Arabam.com Dealers:**
- URL pattern: `arabam.com/magaza/{dealer-slug}`
- Dealer pages list active inventory with sorting options
- Check for dealer API endpoint (e.g., `api.arabam.com/dealers/{id}`)
- Dealer rating and review count visible on profile page
- Can discover dealers by browsing category pages and extracting unique seller IDs

**Sahibinden Dealers:**
- URL pattern: `sahibinden.com/magaza/{dealer-name}`
- Dealer pages show active listing count, member since date, response metrics
- Same anti-detection requirements as Actor 2 (cookies + stealth + residential proxy)
- Dealer badges ("Pro Mağaza", etc.) are important trust signals

**Inventory analysis:** When `includeInventory: true`, the actor scrapes the dealer's active listings (up to 100) and computes summary statistics: average price, top makes, mileage distribution, etc. This adds significant value for anyone evaluating dealers.

### Pricing Strategy
- Pay-per-event: $8 per 1,000 dealer profiles.
- $12 per 1,000 if inventory analysis is included.

---

## Development Guidelines

### Build Order
1. **Arabam Vehicle Scraper first** — Easiest target, validates shared auto-normalizer, no cookie requirements.
2. **Auto Price Tracker second** — Reuses Arabam scraper code, adds Sahibinden (hardest) and OtoMoto.
3. **Dealer Intelligence last** — Builds on all existing platform modules.

### Anti-Detection Priority List

This cluster faces much harder anti-bot than Cluster 1. Engineering priorities:

1. **Playwright + stealth plugin** — Required for all three platforms.
2. **Turkish residential proxies** — Non-negotiable for Sahibinden, recommended for Arabam.
3. **Session cookie management** — Sahibinden actors must accept user-provided cookies via input. Never store or log cookies.
4. **Ultra-conservative concurrency** — maxConcurrency: 1 for Sahibinden, 3 for Arabam.
5. **Extended random delays** — 5-15 seconds between requests (not 2-5 like Cluster 1).
6. **Viewport + User-Agent rotation** — Realistic desktop viewport sizes + modern Chrome UAs.
7. **Mouse movement simulation** — Slight random mouse movements before clicks to appear human.
8. **Cookie persistence** — Maintain cookies across requests within a session to avoid re-triggering Cloudflare.

### Domain-Specific Data Quality Rules

Turkish automotive has specific data conventions that must be handled:

- **Paint condition (Boya Durumu):** This is the #1 most important vehicle condition field in Turkey. Values like "Boyasız" (no paint), "Tamamı orjinal" (all original), "3 boya 1 değişen" (3 panels painted, 1 replaced). Always extract and preserve the original Turkish text.
- **Tramer record:** Insurance damage history. Extract the amount if visible (e.g., "Tramer kaydı: 45.000 TL").
- **Takas (Swap):** Whether the seller accepts a vehicle trade-in. Boolean field.
- **Kimden (From whom):** "Sahibinden" (owner), "Galeriden" (dealer), "Yetkili Bayiden" (authorized dealer). This affects pricing by 5-15%.
- **Plaka/Uyruk:** License plate origin. "Türkiye (TR) Plakalı" means Turkish registration. Some listings are for imported vehicles.
- **Expertise report:** Some listings reference a professional inspection report. Extract the link or reference if present.

### README Template (Store Listing)

Each actor's README should include:
1. **One-liner** in English + Turkish SEO phrase
2. **Use cases:** 3-4 with concrete scenarios
3. **Input example:** Minimal JSON
4. **Output example:** One complete record
5. **Anti-detection note:** Honest about Sahibinden cookie requirement
6. **"Also from this developer"** section linking to all 6 actors (Cluster 1 + Cluster 2)
7. **Pricing table**
8. **FAQ** addressing: proxy requirements, Sahibinden limitations, data freshness

### Cross-Cluster Promotion

- Each Cluster 2 actor links to all 3 Cluster 1 actors (and vice versa).
- Profile bio mentions: "Developer of the Turkish E-Commerce and Automotive Intelligence suites."
- Consistent icon design across all 6 actors (same color scheme, automotive-themed for this cluster).

### Monitoring & Maintenance

- **Weekly test runs** — Critical because Sahibinden and Arabam change selectors frequently.
- **Selector versioning** — Store CSS selectors in a config file, not hardcoded, for quick updates.
- **Cloudflare bypass monitoring** — If bypass stops working, investigate within 48 hours (users will complain fast).
- **Price sanity checks** — Log warnings if scraped prices seem unreasonable (e.g., 2020 Passat for 10,000 TL).

---

## Deployment Checklist (per actor)

- [ ] All unit tests pass (including auto-normalizer tests)
- [ ] Integration test with 10 real URLs succeeds
- [ ] Playwright stealth bypass works on target platform
- [ ] TR residential proxy confirmed working
- [ ] Input schema validates in Apify console
- [ ] README is complete with Turkish SEO keywords
- [ ] Pricing configured (pay-per-event)
- [ ] Tags: turkey, turkish, arabam, sahibinden, automotive, car, vehicle, auto, otomobil, araba, galeri, fiyat
- [ ] Cross-references to all sibling actors (both clusters)
- [ ] Sahibinden cookie requirement clearly documented
- [ ] Actor published as public
- [ ] Test run from clean account
