# Turkish Auto Dealer Intelligence — Galeri Profiles & Inventory Analysis

**galeri profili | oto galeri veri | bayi analizi | ikinci el otomobil galeri**

Scrape dealer (galeri/mağaza) profiles from Arabam.com and Sahibinden.com — Turkey's two largest used car platforms. Extract dealer identity, metrics, trust signals, and contact info. Enable inventory analysis to see what each dealer sells, at what price points, and with what mileage distribution.

---

## Use Cases

**Brand network evaluation** — An automotive OEM wants to audit its dealer network in Istanbul. Feed in `searchByCity: "istanbul"` and `searchByMake: "BMW"` to get every BMW galeri's listing count, member age, and rating in one dataset.

**Competitor dealer research** — A galeri owner wants to benchmark against competitors in their district. Run with `includeInventory: true` to compare average asking prices, top-stocked makes, and mileage profiles.

**Buyer dealer reputation check** — Before visiting a galeri, check how long they've been a member, their rating, verification badges, and total listing history.

**Fleet/fleet manager sourcing** — Identify high-volume dealers (activeListingCount > 100) in a city that specialize in a specific make.

---

## Input

### Mode 1: Direct dealer URLs (fastest)

```json
{
  "platforms": ["arabam"],
  "dealerUrls": [
    "https://www.arabam.com/galeri/reform-motors",
    "https://www.arabam.com/galeri/gap-auto-istanbul",
    "https://www.arabam.com/galeri/varli-otomotiv"
  ],
  "includeInventory": true,
  "proxyConfig": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "countryCode": "TR"
  }
}
```

### Mode 2: Discover dealers by city / make

```json
{
  "platforms": ["arabam", "sahibinden"],
  "searchByCity": "istanbul",
  "searchByMake": "BMW",
  "maxDealers": 50,
  "includeInventory": false,
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
| `platforms` | array | `["arabam","sahibinden"]` | Platforms to scrape |
| `dealerUrls` | array | `[]` | Direct `/galeri/` or `/magaza/` page URLs |
| `searchByCity` | string | — | Discover dealers in this city |
| `searchByMake` | string | — | Discover dealers listing this make |
| `maxDealers` | integer | `50` | Max profiles to scrape (1–500) |
| `includeInventory` | boolean | `false` | Scrape dealer's listings for inventory analysis |
| `sahibindenCookies` | array | `[]` | Optional, but required to actually scrape Sahibinden. Without them, the actor warns and skips that platform. |
| `proxyConfig` | object | — | Proxy settings |

---

## Output

### Basic profile (`includeInventory: false`)

```json
{
  "type": "DEALER_PROFILE",
  "dealerId": "arabam-reform-motors",
  "platform": "arabam",
  "dealerName": "Reform Motors",
  "dealerUrl": "https://www.arabam.com/galeri/reform-motors",
  "dealerSlug": "reform-motors",
  "logo": "https://arbstorage.mncdn.com/galeri/reform-motors/logo.jpg",
  "city": "İstanbul",
  "district": "Bağcılar",
  "fullAddress": null,
  "phone": null,
  "website": null,
  "activeListingCount": 47,
  "totalSalesCount": 1240,
  "memberSince": "Mart 2018",
  "rating": 4.7,
  "reviewCount": 83,
  "verified": true,
  "badges": ["Güvenilir Galeri", "Pro Üye"],
  "responseTime": "1 saatten kısa",
  "inventory": null,
  "companyType": "Galeri",
  "taxId": null,
  "scrapedAt": "2026-04-05T14:30:00.000Z",
  "sourceUrl": "https://www.arabam.com/galeri/reform-motors"
}
```

### With inventory analysis (`includeInventory: true`)

```json
{
  "type": "DEALER_PROFILE",
  "dealerName": "Gap Auto İstanbul",
  "platform": "arabam",
  "city": "İstanbul",
  "district": "Gaziosmanpaşa",
  "activeListingCount": 62,
  "rating": 4.5,
  "verified": true,
  "badges": ["Pro Üye"],
  "inventory": {
    "totalListings": 62,
    "averagePrice": 1840000,
    "medianPrice": 1720000,
    "priceRange": { "min": 950000, "max": 3200000 },
    "topMakes": [
      { "make": "Volkswagen", "count": 14 },
      { "make": "Toyota", "count": 11 },
      { "make": "BMW", "count": 9 },
      { "make": "Renault", "count": 8 },
      { "make": "Ford", "count": 7 }
    ],
    "averageMileage": 87000,
    "averageYear": 2019,
    "listingsByFuelType": {
      "benzin": 28,
      "dizel": 26,
      "lpg": 5,
      "hybrid": 3
    }
  }
}
```

### Run summary

```json
{
  "type": "RUN_SUMMARY",
  "totalRecords": 48,
  "platformResults": { "arabam": 45, "sahibinden": 3 },
  "blockedPlatforms": [],
  "durationSeconds": 420,
  "errors": 0,
  "warnings": []
}
```

---

## How Discovery Works

When `searchByCity` or `searchByMake` is provided:

1. The actor searches arabam.com's listing pages filtered by city/make and "galeriden" seller type
2. Each listing card contains a link back to the dealer's galeri profile
3. Unique galeri slugs are extracted and deduplicated
4. Profile pages are then scraped for each discovered dealer

URL patterns used:
- `arabam.com/ikinci-el/otomobil-{city}-galeriden` — all dealers in a city
- `arabam.com/ikinci-el/otomobil/{make}-galeriden` — dealers by make
- `arabam.com/ikinci-el/otomobil/{make}-{city}-galeriden` — combined

---

## Inventory Analysis Details

When `includeInventory: true`, the actor scrapes the dealer's current active listings (up to 100) and computes:

| Metric | Description |
|--------|-------------|
| `totalListings` | Total active listings at scrape time |
| `averagePrice` | Mean price across all listings (TRY) |
| `medianPrice` | Median price (more robust to outliers) |
| `priceRange` | Min and max asking price |
| `topMakes` | Top 5 vehicle makes by listing count |
| `averageMileage` | Mean mileage across inventory (km) |
| `averageYear` | Mean model year — proxy for inventory age |
| `listingsByFuelType` | Breakdown: benzin / dizel / lpg / hybrid / elektrik |

**Cost impact:**
- Basic (no inventory): 1 request per dealer
- With inventory: 5–50 requests per dealer depending on listing count

---

## Sahibinden Requirements

Sahibinden.com requires authenticated session cookies. Without them, Sahibinden profiles are skipped and the run summary reports `blockedPlatforms: ["sahibinden"]`.

**How to export cookies:**
1. Log into [sahibinden.com](https://www.sahibinden.com)
2. Install **EditThisCookie** (Chrome) or **Cookie-Editor** (Firefox)
3. Export all cookies as JSON
4. Paste into `sahibindenCookies`

Arabam.com works without cookies.

---

## Pricing

| Mode | Price |
|------|-------|
| Basic profiles (no inventory) | **$8 per 1,000 dealers** |
| With inventory analysis | **$12 per 1,000 dealers** |

Pay-per-event: charged on `DEALER_PROFILE` records pushed to dataset.

---

## FAQ

**Can I scrape all dealers in Turkey?**
arabam.com has thousands of registered galeriler. Set `maxDealers: 500` and omit city/make filters to get a broad sample, or use city/make to focus on a market segment.

**Why is `phone` null?**
Both arabam and sahibinden gate phone numbers behind clicks/authentication to prevent spam. Phone numbers are not available in static page scraping without special handling.

**How often should I re-run?**
For monitoring inventory changes, weekly runs are sufficient. For active market research, daily runs capture price changes and new listings.

---

## Also by this developer

### Turkish Automotive Intelligence Suite

- **Arabam.com Vehicle Scraper** — Full listing extraction with specs and condition data
- **Turkish Auto Price Tracker** — Cross-platform vehicle valuation (the only one on Apify)

### Turkish E-Commerce Intelligence Suite

- **N11.com Product Scraper** — Turkey's third-largest e-commerce platform
- **Turkish Marketplace Seller Intelligence** — Cross-platform seller analytics
- **Turkish Product Review Aggregator** — Customer review data at scale

---

*Building the definitive data intelligence toolkit for Turkey. Specializing in Turkish e-commerce and automotive market data. 6 actors | 2 verticals | Pay-per-event pricing.*
