# Turkish Auto Price Tracker - Arabam and Sahibinden Price Comparison

**arabam fiyat karşılaştırma | ikinci el otomobil değerleme | araç fiyat analizi**

**Vehicle valuation for Turkey across Arabam and Sahibinden.**

Given a vehicle specification (make, model, year range, fuel type, transmission), this actor searches Arabam and Sahibinden and returns a comprehensive statistical price report - average, median, percentiles, mileage buckets, and seller-type analysis. Built for insurance companies, banks, dealers, and anyone who needs reliable Turkish used-car valuations.

---

## Use Cases

**Insurance valuation** — Before writing a comprehensive policy, insurers need the current market value. Feed in the vehicle spec, get a median price with percentile confidence bands in seconds.

**Loan collateral assessment** — Banks and finance companies need LTV ratios based on realistic market prices, not list prices. The mileage-bucketed analysis accounts for depreciation accurately.

**Dealer pricing research** — Know what your inventory is worth today. Compare your asking price against the galeri average vs. private-seller (sahibinden) average — they typically differ by 5–15%.

**Individual buyers/sellers** — Find out if that 2020 Passat for 1,850,000 TRY is a good deal or overpriced by looking at the p25–p75 range.

---

## Input

```json
{
  "vehicles": [
    {
      "make": "Volkswagen",
      "model": "Passat",
      "yearMin": 2018,
      "yearMax": 2022,
      "fuelType": "dizel",
      "transmission": "otomatik"
    },
    {
      "make": "Toyota",
      "model": "Corolla",
      "yearMin": 2019,
      "yearMax": 2023,
      "fuelType": "benzin"
    }
  ],
  "platforms": ["arabam", "sahibinden"],
  "city": "istanbul",
  "maxListingsPerPlatform": 50,
  "sahibindenCookies": [
    { "name": "SID", "value": "your-session-id" }
  ],
  "proxyConfig": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "countryCode": "TR"
  }
}
```

### Input parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `vehicles` | array | required | 1–20 vehicle specs to price |
| `vehicles[].make` | string | required | Make in any case (e.g. `Volkswagen`, `toyota`) |
| `vehicles[].model` | string | required | Model (e.g. `Passat`, `3 Serisi`) |
| `vehicles[].yearMin` | integer | — | Minimum model year |
| `vehicles[].yearMax` | integer | — | Maximum model year |
| `vehicles[].fuelType` | enum | — | `benzin`, `dizel`, `lpg`, `hybrid`, `elektrik`, `benzin_lpg` |
| `vehicles[].transmission` | enum | — | `manuel`, `otomatik`, `yarı_otomatik` |
| `platforms` | array | `["arabam","sahibinden"]` | Platforms to include |
| `city` | string | — | City filter (Turkish name, e.g. `istanbul`) |
| `maxListingsPerPlatform` | integer | `50` | Listings per platform per vehicle (5–500) |
| `sahibindenCookies` | array | `[]` | Optional, but required to actually scrape Sahibinden. Without them, the actor warns and skips that platform. |
| `proxyConfig` | object | — | Proxy settings |

---

## Output

Two record types per vehicle spec:

### 1. Individual price records (`type: "PRICE_RECORD"`)

One record per listing found across all platforms.

```json
{
  "type": "PRICE_RECORD",
  "platform": "arabam",
  "make": "Volkswagen",
  "model": "Passat",
  "year": 2020,
  "fuelType": "dizel",
  "transmission": "otomatik",
  "mileage": 87000,
  "price": 1750000,
  "currency": "TRY",
  "sellerType": "galeri",
  "city": "İstanbul",
  "paintCondition": "Boyasız",
  "listingUrl": "https://www.arabam.com/ilan/...",
  "vehicleFingerprint": "volkswagen-passat-2020-dizel-otomatik",
  "scrapedAt": "2026-04-05T10:30:00.000Z"
}
```

### 2. Price summary (`type: "PRICE_SUMMARY"`)

**This is the core value.** One summary per vehicle spec queried.

```json
{
  "type": "PRICE_SUMMARY",
  "vehicleSpec": {
    "make": "Volkswagen",
    "model": "Passat",
    "yearRange": "2018–2022",
    "fuelType": "dizel",
    "transmission": "otomatik"
  },
  "totalListingsFound": 94,
  "totalListingsUsed": 86,
  "platformBreakdown": {
    "arabam": {
      "count": 62,
      "avgPrice": 1823000,
      "medianPrice": 1795000,
      "minPrice": 1450000,
      "maxPrice": 2250000,
      "included": true,
      "skipReason": null
    },
    "sahibinden": {
      "count": 32,
      "avgPrice": 1741000,
      "medianPrice": 1720000,
      "minPrice": 1390000,
      "maxPrice": 2100000,
      "included": true,
      "skipReason": null
    },
    "otomoto": {
      "count": 0,
      "avgPrice": 0,
      "medianPrice": 0,
      "minPrice": 0,
      "maxPrice": 0,
      "included": false,
      "skipReason": "Platform currently inactive (otomoto.com.tr)"
    }
  },
  "overall": {
    "averagePrice": 1796000,
    "medianPrice": 1770000,
    "minPrice": 1390000,
    "maxPrice": 2250000,
    "stdDeviation": 142000,
    "pricePercentiles": {
      "p5": 1480000,
      "p10": 1550000,
      "p25": 1680000,
      "p50": 1770000,
      "p75": 1900000,
      "p90": 1985000,
      "p95": 2080000
    }
  },
  "priceByMileageBucket": {
    "0-50k": { "avg": 1980000, "median": 1960000, "count": 11 },
    "50k-100k": { "avg": 1820000, "median": 1800000, "count": 38 },
    "100k-150k": { "avg": 1680000, "median": 1660000, "count": 29 },
    "150k+": { "avg": 1540000, "median": 1520000, "count": 8 }
  },
  "priceBySellerType": {
    "galeri": { "avg": 1840000, "median": 1820000, "count": 61 },
    "sahibinden": { "avg": 1720000, "median": 1700000, "count": 25 }
  },
  "generatedAt": "2026-04-05T10:32:00.000Z"
}
```

### 3. Run summary (`type: "RUN_SUMMARY"`)

Appended at the end of every run.

```json
{
  "type": "RUN_SUMMARY",
  "totalVehicleSpecs": 2,
  "totalPriceRecords": 156,
  "platformResults": { "arabam": 112, "sahibinden": 44, "otomoto": 0 },
  "blockedPlatforms": [],
  "unavailablePlatforms": ["otomoto"],
  "durationSeconds": 380,
  "errors": 0,
  "warnings": ["[otomoto] Platform currently inactive"]
}
```

---

## Statistical Methodology

The aggregator follows a robust approach to avoid distorted averages:

1. **Outlier removal**: Prices below p5 and above p95 are excluded before computing averages. This eliminates data-entry errors (e.g. 15,000 TRY instead of 1,500,000) and unrealistic asking prices.
2. **Minimum platform threshold**: A platform needs ≥5 listings to be included in the summary. Fewer listings produce unreliable statistics.
3. **Mileage buckets**: Vehicles are grouped by 0–50K, 50K–100K, 100K–150K, and 150K+ km. This accurately reflects mileage-based depreciation.
4. **Seller type split**: Galeri (dealer) vs. sahibinden (private owner) prices are reported separately. The gap is typically 5–15% and matters for valuation models.

---

## Sahibinden Requirements

Sahibinden.com uses aggressive Cloudflare protection and requires authenticated session cookies.

**How to get session cookies:**

1. Log into [sahibinden.com](https://www.sahibinden.com) in your browser
2. Install the **EditThisCookie** extension (Chrome) or **Cookie-Editor** (Firefox)
3. Export all cookies from sahibinden.com as JSON
4. Paste the array into the `sahibindenCookies` input field

**Cookie lifetime**: Sahibinden session cookies typically last 7–30 days. If scraping stops working, refresh your cookies.

**Without cookies**: The actor still works using Arabam.com only. The price summary will note Sahibinden as "skipped" with the reason.

---

## OtoMoto Turkey Note

`otomoto.com.tr` was investigated during development (April 2026) and confirmed to redirect to an unrelated domain. The platform does not currently operate in Turkey. The OtoMoto module is implemented and ready — when a viable third Turkish platform is identified, it will be activated in a future update.

---

## Pricing

**$10 per vehicle price report**

Each vehicle spec in `vehicles[]` counts as one report. Running 5 vehicle specs = $50.

Pay-per-event: charged only on successful `PRICE_SUMMARY` records pushed to the dataset.

---

## FAQ

**How many listings should I use for reliable statistics?**
For a narrow spec (single model, 2-year range), 30+ listings per platform is sufficient. Broader queries (all years, all fuel types) benefit from 100+ listings.

**Can I run this daily for price monitoring?**
Yes — schedule the actor via Apify scheduler. Arabam prices change frequently. We recommend weekly runs for monitoring and daily runs for active trading desks.

**What if Sahibinden is blocked?**
The actor continues with available platforms. The run summary reports `blockedPlatforms: ["sahibinden"]`. Check that your session cookies haven't expired and that you're using TR residential proxies.

**Can I get city-level breakdowns?**
Currently, the city filter narrows which listings are collected. A future version will add per-city price breakdown within the summary.

---

## Also by this developer

### Turkish Automotive Intelligence Suite

- **Arabam.com Vehicle Scraper** — Full listing extraction with specs, condition, and seller data
- **Turkish Auto Dealer Intelligence** — Dealer profiles and inventory analytics

### Turkish E-Commerce Intelligence Suite

- **N11.com Product Scraper** — Turkey's third-largest e-commerce platform
- **Turkish Marketplace Seller Intelligence** — Cross-platform seller analytics
- **Turkish Product Review Aggregator** — Customer review data at scale

---

*Building the definitive data intelligence toolkit for Turkey. Specializing in Turkish e-commerce and automotive market data. 6 actors | 2 verticals | Pay-per-event pricing.*
