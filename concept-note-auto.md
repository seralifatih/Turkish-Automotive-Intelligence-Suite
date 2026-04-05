# Concept Note: Turkish Automotive Intelligence Suite
## Apify Actor Cluster 2 — Build Plan & Prompts

---

## 1. Executive Summary

This is the second cluster in your Turkish data intelligence portfolio. While Cluster 1 targets e-commerce (Trendyol, Hepsiburada, N11), Cluster 2 targets the **Turkish automotive market** — a massive vertical where used car transactions exceed $30B+ annually.

The three actors:

1. **Arabam.com Vehicle Scraper** — Comprehensive vehicle listing extraction from Turkey's largest dedicated auto marketplace
2. **Turkish Auto Price Tracker** — Cross-platform price aggregation from Arabam, Sahibinden Vasıta, and OtoMoto, producing statistical valuation reports
3. **Turkish Auto Dealer Intelligence** — Dealer profiles, inventory analytics, and reputation data

### Why This Cluster Wins After Cluster 1

- **Portfolio effect:** You're now the "Turkish data specialist" on Apify — 6 actors across 2 verticals builds serious credibility.
- **Cross-promotion flywheel:** Every Cluster 1 user sees your Cluster 2 actors in "Also by this developer."
- **Shared infrastructure:** Turkish text utils, TRY price normalization, proxy config, and stealth modules all carry over — you're not starting from scratch.
- **Higher price points:** Automotive data commands premium pricing (insurance companies, banks, fleet managers pay well for valuation data).
- **Technical moat:** Sahibinden's Cloudflare protection is notoriously difficult. Once you solve it, competitors face the same 6-month engineering wall.

---

## 2. Market Analysis

### Competitive Landscape (April 2026)

**Arabam.com scrapers on Apify:**
- `tyegen/arabam-scraper` — exists, basic vehicle listing extraction, ~$6/1K
- 1-2 other basic scrapers
- **Gap:** No comprehensive scraper with full specs, paint condition, damage history, and dealer type extraction. No filter-based input (most require URLs).

**Sahibinden Vasıta (vehicle) scrapers on Apify:**
- `tyegen/sahibinden-car-scraper` and `evohaus/sahibinden-scraper-puppeteer-js` exist
- Both require session cookies and break frequently due to Cloudflare changes
- **Gap:** All existing scrapers are fragile and poorly documented. A reliable, well-documented alternative with clear cookie setup instructions wins.

**Cross-platform auto price tracker:**
- **Does not exist.** This is the biggest gap. No actor aggregates prices across platforms.
- External competitors: Some Turkish startups offer valuation APIs, but nothing on Apify.

**Dealer intelligence:**
- **Near-zero coverage.** No actor focuses on dealer/galeri profiles and inventory analysis.

### Revenue Projections

| Actor | Price / Event | Monthly Runs (est.) | Monthly Revenue |
|-------|--------------|---------------------|-----------------|
| Arabam Vehicle Scraper | $6 / 1K listings | 300 | $180-500 |
| Auto Price Tracker | $10 / report | 200 | $200-600 |
| Dealer Intelligence | $8-12 / 1K dealers | 100 | $80-300 |
| **Total Cluster 2** | | | **$460-1,400** |
| **Total Both Clusters** | | | **$730-2,220** |

The Price Tracker has the highest individual revenue potential because insurance and lending companies need frequent valuations and will pay premium rates.

---

## 3. Technical Architecture

### Anti-Detection Stack

This is the most technically challenging aspect of Cluster 2. The stack:

```
Playwright (non-headless)
  └─ playwright-extra + stealth plugin
      └─ TR residential proxies (Apify RESIDENTIAL group, countryCode: TR)
          └─ Session cookie injection (user-provided, Sahibinden only)
              └─ Randomized delays (5-15s), viewport rotation, UA rotation
                  └─ Mouse movement simulation
```

### Platform Difficulty Ranking

| Platform | Difficulty | Proxy Requirement | Cookies Needed | Rendering |
|----------|-----------|-------------------|----------------|-----------|
| Arabam.com | Medium | Residential recommended | No | JS (Playwright) |
| OtoMoto Turkey | Low-Medium | Datacenter okay | No | SSR + some JS |
| Sahibinden Vasıta | Very High | Residential required (TR) | Yes (session) | JS + Cloudflare |

### Vehicle Fingerprinting

Cross-platform matching uses a normalized fingerprint:

```
{make}-{model}-{year}-{fuelType}-{transmission}
Example: "volkswagen-passat-2019-dizel-otomatik"
```

This allows grouping the same vehicle specification across Arabam, Sahibinden, and OtoMoto for price comparison. Mileage is NOT part of the fingerprint (it varies per listing) but is used for bucketed analysis.

---

## 4. Build Prompts

### Prompt 1: Extend the Shared Module for Automotive

```
Extend the shared module from the Turkish E-Commerce Intelligence Suite to support automotive data.

Add a new file: packages/shared/src/auto-normalizer.ts

Implement:

1. parseMileage(text: string): number | null
   - Handle Turkish formats: "150.000 km", "150000km", "150,000 km", "150.000"
   - Return value in km as integer
   - Return null for "0 km" (brand new) — flag separately

2. parseEngineSize(text: string): number | null
   - Handle: "1.6", "1600 cc", "1,6 L", "2.0 TDI", "1598 cc"
   - Return value in cc as integer

3. parseModelYear(text: string): number | null
   - Handle: "2019", "2019 Model", "Model: 2019"
   - Validate range: 1970-current year
   - Return null if invalid

4. normalizeFuelType(text: string): FuelType | null
   - Map Turkish terms: "Benzin", "Dizel", "LPG", "Hybrid", "Elektrik", "Benzin & LPG"
   - Also handle English equivalents
   - Type: 'benzin' | 'dizel' | 'lpg' | 'hybrid' | 'elektrik' | 'benzin_lpg'

5. normalizeTransmission(text: string): TransmissionType | null
   - Map: "Manuel", "Otomatik", "Yarı Otomatik", "Düz Vites", "Tiptronic"
   - Type: 'manuel' | 'otomatik' | 'yarı_otomatik'

6. normalizeBodyType(text: string): BodyType | null
   - Map: "Sedan", "Hatchback", "Station Wagon", "SUV", "Coupe", "Cabrio/Roadster", "MPV", "Pick-up"
   - Type: 'sedan' | 'hatchback' | 'station_wagon' | 'suv' | 'coupe' | 'cabrio' | 'minivan' | 'pickup'

7. vehicleFingerprint(make, model, year, fuel, transmission): string
   - Lowercase, Turkish-aware, hyphen-separated
   - Example: "volkswagen-passat-2019-dizel-otomatik"

8. parsePaintCondition(text: string): { originalText: string; paintedPanels: number; replacedPanels: number; isOriginal: boolean }
   - Parse Turkish paint condition descriptions:
     "Boyasız" → { paintedPanels: 0, replacedPanels: 0, isOriginal: true }
     "Tamamı orjinal" → same as above
     "3 boya 1 değişen" → { paintedPanels: 3, replacedPanels: 1, isOriginal: false }
     "2 boyalı" → { paintedPanels: 2, replacedPanels: 0, isOriginal: false }
   - Always preserve original Turkish text

Also add a new file: packages/shared/src/sahibinden-stealth.ts

Implement a helper class SahibindenStealth that:
- Takes Playwright browser context
- Injects session cookies from user input
- Sets realistic viewport (randomized from a list of common desktop sizes)
- Rotates User-Agent strings (20+ modern Chrome UAs on Windows/Mac)
- Adds random mouse movements before page interactions
- Implements a wait function with random delay between min and max seconds
- Provides a method to check if Cloudflare challenge page is displayed

Write comprehensive Jest tests for auto-normalizer.ts covering edge cases:
- Empty strings, null values
- Turkish number formatting (dots as thousands, commas as decimals)
- Various paint condition phrasings
- Mixed Turkish/English fuel type names
```

---

### Prompt 2: Build Actor 1 — Arabam.com Vehicle Scraper

```
Build the Arabam.com Vehicle Scraper at packages/arabam-vehicle-scraper/.
Reference the CLAUDE.md for the full output schema and technical notes.

IMPORTANT — Before writing scraping code, investigate arabam.com:
1. Visit https://www.arabam.com and search for a vehicle (e.g., Volkswagen Passat)
2. Open DevTools → Network tab. Look for XHR/fetch calls returning JSON data.
   Arabam.com likely has an internal API (check for api.arabam.com endpoints or 
   GraphQL). If found, this is FAR preferable to HTML parsing.
3. Check search result pages: are they SSR or CSR?
4. Check the filter system: how do URL parameters change when filters are applied?
5. Visit a vehicle detail page. Inspect:
   - Where is the specs table? (marka, model, yıl, yakıt, vites, km, renk, etc.)
   - Where is paint condition (boya durumu)?
   - Where is accident history / Tramer record?
   - Where is seller info and contact?
   - Where are images?
6. Check pagination: page parameter? infinite scroll?

Based on your findings, implement:

1. .actor/input_schema.json — Two input modes:
   a) Filter-based search (make, model, year range, price range, fuel, transmission, city)
   b) Direct URLs (searchUrls for result pages, listingUrls for detail pages)
   Plus: maxListings, scrapeDetails, proxyConfig

2. src/main.ts — Entry point using PlaywrightCrawler:
   - Validate input with Zod
   - Configure Playwright with stealth plugin
   - Set up TR residential proxy
   - Build search URLs from filters OR use provided URLs
   - Handle Actor migration

3. src/routes.ts — Router with handlers:
   - SEARCH: Parse listing grid, extract vehicle cards, enqueue detail pages, handle pagination
   - DETAIL: Full vehicle detail extraction

4. src/parsers/listing-parser.ts — From search results extract:
   - Title, price, year, mileage, fuel, transmission
   - Thumbnail image URL
   - Listing URL for detail page
   - Seller type (galeri/sahibinden/yetkili bayi)
   - Quick paint condition if shown in listing card

5. src/parsers/detail-parser.ts — From detail pages extract ALL fields:
   - Full specs table (every row as key-value)
   - Paint condition (boya durumu) — USE parsePaintCondition from shared module
   - Tramer/accident history
   - All image URLs
   - Seller info (name, phone, type)
   - Description text
   - Swap availability (takas)
   - Location (city, district)

6. README.md — Apify Store listing:
   - Title: "Arabam.com Vehicle Scraper — Turkish Auto Marketplace Data API"
   - Turkish SEO: include "arabam veri çekme", "araba fiyat", "ikinci el otomobil"
   - Input/output examples
   - Link to Cluster 1 actors in "Also by this developer"
   - Pricing: $6 / 1,000 listings

Use auto-normalizer for all vehicle data normalization.
Use Zod to validate each scraped record before pushing to dataset.
Log warnings for missing optional fields. Never crash on null data.
```

---

### Prompt 3: Build Actor 2 — Turkish Auto Price Tracker

```
Build the Turkish Auto Price Tracker at packages/auto-price-tracker/.
Reference the CLAUDE.md for the full output schema.

This is the PREMIUM actor in the cluster. It takes a vehicle spec (make/model/year/fuel/transmission), 
searches multiple Turkish auto platforms, and produces a statistical price report.

IMPORTANT — Before coding:
1. Identify the search URL patterns for each platform:
   - Arabam.com: how to construct a filtered search URL
   - Sahibinden: how to construct a vasıta (vehicle) search URL  
   - OtoMoto Turkey: investigate otomoto.com.tr URL structure
2. For Sahibinden: confirm that session cookies are required and document the process
3. For OtoMoto: check if it exists as a separate Turkish domain or is part of olx.com.tr

Implement:

1. .actor/input_schema.json:
   - vehicles: array of { make, model, yearMin, yearMax, fuelType?, transmission? }
   - platforms: enum array, default all
   - city: optional city filter
   - maxListingsPerPlatform: default 50
   - proxyConfig
   - sahibindenCookies: optional array (only needed if Sahibinden is in platforms list)

2. src/main.ts — Entry point:
   - For each vehicle spec in input:
     a) Build search URLs for each platform
     b) Scrape listings from each platform
     c) Normalize all listings to PriceRecord schema using auto-normalizer
     d) Compute PriceSummary statistics
     e) Push both individual PriceRecords and PriceSummary to dataset

3. src/platforms/arabam.ts — Reuse scraping logic from Actor 1:
   - Build filtered search URL from vehicle spec
   - Extract: price, mileage, year, fuel, transmission, seller type, city
   - Return array of PriceRecord

4. src/platforms/sahibinden.ts:
   - Build search URL for Sahibinden vasıta section
   - Use SahibindenStealth from shared module
   - Handle cookie requirement — if no cookies provided, skip with warning
   - Extract same fields as arabam
   - Handle Cloudflare challenge detection — if challenged, log and skip

5. src/platforms/otomoto.ts:
   - Build search URL for OtoMoto Turkey
   - Lighter anti-bot, may work with Cheerio or basic Playwright
   - Extract same fields

6. src/aggregator.ts — Statistical analysis:
   - Takes array of PriceRecord for a single vehicle spec
   - Computes: average, median, min, max, standard deviation
   - Computes percentiles: p10, p25, p50, p75, p90
   - Buckets by mileage: 0-50K, 50K-100K, 100K-150K, 150K+
   - Buckets by seller type: galeri vs sahibinden
   - Per-platform breakdown
   - Returns PriceSummary object

7. README.md:
   - Title: "Turkish Auto Price Tracker — Arabam, Sahibinden & OtoMoto Price Comparison"
   - Emphasize: "The only cross-platform vehicle valuation tool for Turkey"
   - Use case: Insurance valuation, loan collateral assessment, dealer pricing research
   - Show a sample PriceSummary output — this is the selling point
   - Be honest about Sahibinden limitations (cookie requirement)
   - Pricing: $10 per vehicle report

The aggregator is the core value. Make the statistics robust:
- Remove outliers (prices below p5 or above p95) before computing averages
- Handle cases where a platform returns zero results gracefully
- Minimum 5 listings required per platform to include it in the summary
```

---

### Prompt 4: Build Actor 3 — Turkish Auto Dealer Intelligence

```
Build the Turkish Auto Dealer Intelligence actor at packages/dealer-intelligence/.
Reference the CLAUDE.md for the full output schema.

This actor scrapes dealer (galeri) profiles from Arabam and Sahibinden. 
The differentiator is the inventory analysis — not just who the dealer is, 
but what they sell and at what price points.

IMPORTANT — Before coding, investigate dealer pages:
1. Arabam.com: Visit https://www.arabam.com/magaza/ pages
   - How are dealer profiles structured?
   - What stats are visible (listing count, member since, rating)?
   - Can you list all dealers in a city or by make?
   - Is there a dealer search/directory page?
2. Sahibinden: Visit https://www.sahibinden.com/magaza/ pages
   - What dealer metrics are shown?
   - Badges and verification status
   - Can you browse dealers by location?

Implement:

1. .actor/input_schema.json:
   - platforms: ["arabam", "sahibinden"]
   - dealerUrls: direct dealer page URLs
   - searchByCity: find dealers in a specific city
   - searchByMake: find dealers specializing in a make
   - maxDealers: default 50
   - includeInventory: boolean (default false — setting to true adds inventory analysis but is slower/more expensive)
   - proxyConfig
   - sahibindenCookies: optional

2. src/main.ts — Entry point:
   - Validate input
   - Route to appropriate platform handler
   - If searchByCity or searchByMake: first discover dealer URLs, then scrape each profile
   - If includeInventory: also scrape dealer's active listings (up to 100)

3. src/platforms/arabam.ts — Arabam dealer scraping:
   - Parse dealer profile page
   - Extract: name, logo, city, phone, active listing count, rating, member since
   - If includeInventory: paginate through dealer's listings, extract price/make/model/year/mileage
   - Compute inventory stats: avg price, top makes, mileage distribution

4. src/platforms/sahibinden.ts — Sahibinden dealer scraping:
   - Parse dealer store page (with stealth)
   - Extract: name, city, rating, listing count, response time, badges
   - If includeInventory: same as arabam module
   - Handle cookie requirement

5. src/inventory-analyzer.ts:
   - Takes array of vehicle listings from a single dealer
   - Computes:
     - totalListings, averagePrice, medianPrice, priceRange
     - topMakes (top 5 by listing count)
     - averageMileage, averageYear
     - listingsByFuelType breakdown
   - Returns the inventory summary object

6. README.md:
   - Title: "Turkish Auto Dealer Intelligence — Galeri Profiles & Inventory Analysis"
   - Use cases: brand network evaluation, competitor dealer research, buyer dealer reputation check
   - Show sample DealerProfile output with and without inventory
   - Pricing: $8/1K dealers (basic), $12/1K (with inventory analysis)

The inventory analysis is the premium feature. Make it optional because:
- Without it: 1 request per dealer (fast, cheap)
- With it: 10-50 requests per dealer (slow, expensive, but highly valuable)
```

---

### Prompt 5: Polish, Test & Cross-Promote

```
Final polish for all three actors in the Turkish Automotive Intelligence Suite.

1. INPUT VALIDATION (all actors):
   - Zod schemas with clear error messages
   - If Sahibinden is selected but no cookies provided: warn (don't error), skip platform
   - URL validation: check domain matches expected platform
   - Reasonable limits: maxListings between 1-10000

2. ERROR HANDLING:
   - Cloudflare challenge detected → log warning, mark platform as blocked, continue with remaining platforms
   - Session expired → log, suggest user refresh cookies
   - Empty results → log which filters returned nothing, suggest broadening search
   - Partial failures → report how many succeeded vs failed in run summary

3. RUN SUMMARY record at end of each run:
   {
     type: "RUN_SUMMARY",
     totalRecords: number,
     platformResults: { arabam: number, sahibinden: number, otomoto: number },
     blockedPlatforms: string[],
     durationSeconds: number,
     errors: number,
     warnings: string[]
   }

4. CROSS-CLUSTER PROMOTION — Update ALL 6 actor READMEs:
   
   For Cluster 1 actors (N11 Scraper, Seller Intelligence, Review Aggregator):
   - Add section: "🚗 Also check out our Turkish Automotive Intelligence Suite"
   - Link to all 3 Cluster 2 actors

   For Cluster 2 actors:
   - Add section: "🛒 Also check out our Turkish E-Commerce Intelligence Suite"
   - Link to all 3 Cluster 1 actors

   Developer bio update:
   "Building the definitive data intelligence toolkit for Turkey. 
    Specializing in Turkish e-commerce and automotive market data. 
    6 actors | 2 verticals | Pay-per-event pricing."

5. ICON DESIGN:
   - Cluster 1: Use a consistent shopping/cart themed icon style
   - Cluster 2: Use a consistent car/automotive themed icon style
   - Same color palette across both clusters for brand recognition

6. TAGS for Cluster 2 actors (in addition to platform-specific tags):
   - Common: turkey, turkish, automotive, car, vehicle, otomobil, araba
   - Actor 1: arabam, used-car, ikinci-el, listing, fiyat
   - Actor 2: price-tracker, valuation, comparison, fiyat-karşılaştırma, sigorta
   - Actor 3: dealer, galeri, inventory, bayi, mağaza

7. TESTING CHECKLIST per actor:
   - Run with minimal input (1 vehicle, 5 results max)
   - Validate output against Zod schema
   - Confirm no null required fields
   - Confirm Turkish characters (İ, ğ, ş, ö, ü, ç) render correctly in output
   - Test with Sahibinden DISABLED (cookies not provided) — should gracefully skip
   - Test with Sahibinden ENABLED (provide test cookies) — should work or fail with clear error
```

---

## 5. Launch Strategy

### Week 1: Extend Shared Module
- Run Prompt 1 (auto-normalizer + stealth utilities)
- Test thoroughly — this is the foundation for all 3 actors

### Week 2-3: Arabam Vehicle Scraper
- Run Prompt 2
- Publish on Apify Store
- Write dev.to article: "Scraping Turkey's Used Car Market: Building an Arabam.com Data Extractor"

### Week 4-5: Auto Price Tracker
- Run Prompt 3
- This is the most complex actor — allow extra time for multi-platform integration
- Publish on Apify Store
- Write LinkedIn article: "How Cross-Platform Auto Price Intelligence is Changing Turkish Vehicle Valuation"

### Week 6-7: Dealer Intelligence
- Run Prompt 4
- Publish on Apify Store

### Week 8: Cross-Promote & Polish
- Run Prompt 5
- Update all 6 actor READMEs with cross-links
- Update developer profile/bio
- Share on Turkish developer communities, Reddit r/turkey, automotive forums

### Ongoing
- Weekly test runs (critical — Sahibinden selectors change frequently)
- Monitor Cloudflare bypass effectiveness
- Respond to issues within 24 hours
- Track which actor generates the most revenue → double down on content marketing for it

---

## 6. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Sahibinden blocks all scrapers | High | Make Sahibinden support optional; Arabam + OtoMoto still work without it |
| Arabam.com adds Cloudflare | Medium | Stealth stack is already built; upgrade to residential proxies if needed |
| Session cookies expire quickly | Medium | Document clearly; suggest browser extensions for easy re-export |
| Low initial user count | Low | Cross-promotion from 3 existing Cluster 1 actors drives discovery |
| Competitor publishes similar actor | Low | Your 6-actor portfolio + Turkish language expertise is a moat |
| Legal/ToS complaints | Low | Only scrape public data; document ethical scraping in README; comply with KVKK (Turkish data protection law) |

---

## 7. Differentiation Checklist

What makes this cluster stand out:

- [ ] **Cross-platform price tracker** — Does not exist on Apify
- [ ] **Dealer inventory analysis** — Unique premium feature
- [ ] **Paint condition parsing** — Domain-specific logic no competitor has
- [ ] **6-actor portfolio** — Strongest Turkish data presence on the entire Apify Store
- [ ] **Honest about limitations** — Sahibinden cookie requirement clearly documented
- [ ] **Statistical valuation reports** — Percentiles, mileage buckets, seller type breakdown
- [ ] **Vehicle fingerprinting** — Cross-platform matching via normalized identifiers
- [ ] **Turkish language SEO** — Both English and Turkish keywords in listings
- [ ] **Consistent branding** — Recognizable icon style across all 6 actors
- [ ] **Premium pricing justified** — Automotive data is genuinely more valuable than generic e-commerce scraping
