# Arabam.com Vehicle Scraper — Turkish Auto Marketplace Data API

**arabam veri çekme | araba fiyat | ikinci el otomobil**

Extract comprehensive vehicle listing data from [arabam.com](https://www.arabam.com) — Turkey's largest dedicated automotive marketplace with 400,000+ active listings. Supports filter-based search and direct URL scraping.

---

## ⚠️ Breaking changes in v1.1.0

If you're upgrading from `1.0.0`, review these before you deploy:

1. **`RUN_SUMMARY` moved from the default dataset to the key-value store.** It's no longer a dataset row — read it from the run's key-value store under the key `RUN_SUMMARY` instead. Any code filtering the dataset for `type == 'RUN_SUMMARY'` must switch to a key-value store read.
2. **`paintCondition.paintedPanels` / `replacedPanels` / `isOriginal` are now nullable.** They're `null` whenever paint condition is unspecified or unparseable, instead of the previous (misleading) `0`/`false`. Null-check before using these in a boolean check or arithmetic.
3. **`transmission` matching is now exact-value/exact-token only, never substring.** Fixes a class of potential false-positive matches. If you relied on partial/fuzzy transmission text matching elsewhere, re-check against the new `transmissionRaw` field.
4. **Five new fields on every vehicle record:** `transmissionRaw`, `engineSizeMin`, `engineSizeMax`, `horsePowerMin`, `horsePowerMax`. Update any strict/`additionalProperties: false` schema validation on your side.
5. **`engineSize` / `horsePower` are `null` for range specs** (e.g. `"1401 - 1600 cm3"`) where they previously held a fabricated midpoint. Use `engineSizeMin`/`Max` (`horsePowerMin`/`Max`) if you need a range-based estimate.

Full details in [CHANGELOG.md](./CHANGELOG.md).

---

## What You Get

Each vehicle record includes:

- **Full specifications**: year, mileage, fuel type, transmission, engine size, horsepower, color, body type, drivetrain
- **Condition data**: paint condition (boya durumu — panels painted/replaced), accident/Tramer history
- **Pricing**: amount in TRY, negotiability flag, swap (takas) availability
- **Seller info**: dealer vs. private owner vs. authorized dealer, name, phone
- **Location**: city, district
- **All images**: full-resolution URLs from arabam's CDN
- **Description**: full listing text
- **Complete specs table**: every field as key-value pairs

---

## Input

Two modes — use either filters or direct URLs:

### Mode 1: Filter-based search

```json
{
  "filters": {
    "make": "volkswagen",
    "model": "passat",
    "yearMin": 2018,
    "yearMax": 2023,
    "priceMin": 500000,
    "priceMax": 2000000,
    "fuelType": "dizel",
    "transmission": "otomatik",
    "city": "istanbul"
  },
  "maxListings": 200,
  "scrapeDetails": true,
  "proxyConfig": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "countryCode": "TR"
  }
}
```

### Mode 2: Direct URLs

```json
{
  "searchUrls": [
    "https://www.arabam.com/ikinci-el/otomobil/toyota-corolla",
    "https://www.arabam.com/ikinci-el/otomobil/bmw-3-serisi"
  ],
  "listingUrls": [
    "https://www.arabam.com/ilan/galeriden-satilik-volkswagen-passat/39355250"
  ],
  "maxListings": 500,
  "scrapeDetails": true
}
```

### Input parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `filters.make` | string | — | Vehicle make slug (e.g. `volkswagen`, `toyota`, `bmw`) |
| `filters.model` | string | — | Vehicle model slug (e.g. `passat`, `corolla`) |
| `filters.yearMin` | integer | — | Minimum model year |
| `filters.yearMax` | integer | — | Maximum model year |
| `filters.priceMin` | integer | — | Minimum price in TRY |
| `filters.priceMax` | integer | — | Maximum price in TRY |
| `filters.mileageMax` | integer | — | Maximum mileage in km |
| `filters.fuelType` | enum | — | `benzin`, `dizel`, `lpg`, `hybrid`, `elektrik`, `benzin_lpg` |
| `filters.transmission` | enum | — | `manuel`, `otomatik`, `yarı_otomatik` |
| `filters.city` | string | — | City in Turkish (e.g. `istanbul`, `ankara`) |
| `searchUrls` | array | `[]` | Direct search result page URLs |
| `listingUrls` | array | `[]` | Direct vehicle detail page URLs |
| `maxListings` | integer | `200` | Maximum records to scrape (1–10,000) |
| `scrapeDetails` | boolean | `true` | Visit detail pages for full specs (slower, comprehensive) |
| `proxyConfig` | object | — | Proxy settings (residential TR recommended) |

---

## Output

Vehicle records are pushed to the default dataset (billed per record — see Pricing). The run summary is **not** a dataset record; it's written to the run's key-value store under the `RUN_SUMMARY` key, so it's never billed and never mixed into your vehicle data.

### Vehicle record (`scrapeDetails: true`)

```json
{
  "listingId": "39355250",
  "title": "Volkswagen Passat 1.5 TSi Business",
  "url": "https://www.arabam.com/ilan/galeriden-satilik-volkswagen-passat-1-5-tsi-business/39355250",
  "make": "Volkswagen",
  "model": "Passat",
  "variant": "1.5 TSi Business",
  "year": 2021,
  "bodyType": "sedan",
  "mileage": 134000,
  "fuelType": "benzin",
  "transmission": "otomatik",
  "transmissionRaw": null,
  "engineSize": 1498,
  "engineSizeMin": 1498,
  "engineSizeMax": 1498,
  "horsePower": 150,
  "horsePowerMin": 150,
  "horsePowerMax": 150,
  "drivetrain": "FWD",
  "color": "Siyah",
  "doors": 4,
  "price": { "amount": 1915000, "currency": "TRY" },
  "negotiable": false,
  "paintCondition": {
    "originalText": "Boyasız",
    "paintedPanels": 0,
    "replacedPanels": 0,
    "isOriginal": true
  },
  "accidentHistory": "Kazasız",
  "swapAvailable": true,
  "city": "Amasya",
  "district": "Merkez",
  "sellerType": "galeri",
  "sellerName": "ABC Otomotiv",
  "sellerPhone": null,
  "listingDate": "2024-03-15",
  "imageUrls": [
    "https://arbstorage.mncdn.com/ilanfotograflari/2024/03/15/39355250/abc_1920x1080.jpg"
  ],
  "imageCount": 12,
  "featured": false,
  "description": "Aracımız tam bakımlıdır, hasarsız, boyasızdır...",
  "specifications": {
    "Marka": "Volkswagen",
    "Model": "Passat",
    "Yıl": "2021",
    "Kilometre": "134.000 km",
    "Yakıt Tipi": "Benzin",
    "Vites Tipi": "Otomatik",
    "Kasa Tipi": "Sedan",
    "Renk": "Siyah",
    "Motor Hacmi": "1498 cc",
    "Motor Gücü": "150 hp",
    "Boya-Değişen": "Boyasız"
  },
  "damageReport": null,
  "scrapedAt": "2024-04-01T10:30:00.000Z",
  "sourceUrl": "https://www.arabam.com/ilan/..."
}
```

**Engine size / horsepower ranges:** arabam sometimes shows a bucketed range instead of an exact value (e.g. `"1401 - 1600 cm3"`, `"101 - 125 HP"`). When that happens, `engineSize`/`horsePower` are `null` — **never** a fabricated midpoint — and `engineSizeMin`/`engineSizeMax` (`horsePowerMin`/`horsePowerMax`) carry the range instead. For an exact spec (`"1598 CC"`, `"120 HP"`), `engineSize`/`horsePower` are set and `Min`/`Max` both equal that value.

**Unmapped transmission values:** if arabam's "Vites Tipi" value doesn't match a known `manuel`/`otomatik`/`yarı_otomatik` type, `transmission` is `null` and the raw text is kept in `transmissionRaw` instead of being silently dropped.

**Image URLs:** `imageUrls` only ever contains images belonging to this listing. arabam's detail page can render a "similar listings" carousel using the same gallery markup, which would otherwise leak other listings' photos into this one; they're filtered out by listingId before `imageCount` is computed.

### Run summary (key-value store, key `RUN_SUMMARY`)

```json
{
  "type": "RUN_SUMMARY",
  "totalRecords": 187,
  "durationSeconds": 420,
  "errors": 2,
  "warnings": ["Failed: https://...", "Requested 200, got 187: ..."],
  "inputSummary": {
    "maxListings": 200,
    "scrapeDetails": true,
    "initialRequests": 1
  }
}
```

If `totalRecords` is less than `maxListings`, `warnings` always includes a `"Requested X, got Y: <reason>"` entry explaining the shortfall — this is never silent.

---

## Paint Condition (Boya Durumu)

Paint condition is the most important vehicle condition signal in the Turkish used-car market. This scraper always extracts and parses it:

| Turkish text | paintedPanels | replacedPanels | isOriginal |
|--------------|--------------|----------------|------------|
| `Boyasız` | 0 | 0 | `true` |
| `Tamamı orjinal` | 0 | 0 | `true` |
| `2 boyalı` | 2 | 0 | `false` |
| `3 boya 1 değişen` | 3 | 1 | `false` |
| `Belirtilmemiş` (unspecified) | `null` | `null` | `null` |
| unparseable/unrecognized text | `null` | `null` | `null` |
| missing/empty spec | `null` | `null` | `null` |

A confirmed `0`/`true` (or counted panel numbers) is only returned when the text actually says something — "no paint work," or a specific count. Anything else — unspecified, unrecognized, or missing — is reported as `null`, never guessed as `0`/`false`.

---

## Technical Notes

### Proxy Requirements

Turkish residential proxies are strongly recommended. Arabam.com uses JavaScript rendering and may restrict datacenter IPs.

Configure via `proxyConfig`:
```json
{
  "proxyConfig": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "countryCode": "TR"
  }
}
```

### Scrape Modes

| Mode | Speed | Data Completeness | Cost |
|------|-------|-------------------|------|
| `scrapeDetails: false` | Fast | Basic (no specs table, no images) | ~1 compute unit / 1K listings |
| `scrapeDetails: true` | Slower | Full (all fields) | ~5 compute units / 1K listings |

### Pagination

The scraper paginates using arabam.com's `page` query param (confirmed against the site's own "next page" link — `skip`/`take` are present in the URL but don't advance the result set on their own). Each search page returns up to 20 listings. The scraper automatically paginates until `maxListings` is reached, and detects/stops on a duplicate page rather than silently re-requesting the same listings.

---

## Pricing

**$6 per 1,000 vehicle listings**

Charged on successful vehicle records pushed to the dataset. The run summary is stored in the key-value store, not the dataset, so it's never billed.

---

## FAQ

**Why is `sellerPhone` null?**
Two separate reasons, both resulting in `null`:
1. Arabam.com hides phone numbers until a user clicks "Telefonu Göster." The phone reveal requires authentication and is not scrapeable without a logged-in session.
2. When a number **is** present in the page markup, it's almost always arabam's own central masked contact number (`+908507599000`) shown on every listing regardless of seller — not the actual seller's phone. This scraper detects that exact number and reports `null` instead of presenting it as seller contact info. A different, non-masked number (if arabam ever renders one) is passed through as-is.

**Can I scrape all listings without filters?**
Yes — use `https://www.arabam.com/ikinci-el/otomobil` as a `searchUrls` entry. Set `maxListings` to control volume.

**How fresh is the data?**
This actor scrapes in real-time — data is as fresh as your run. Arabam listings change frequently. For daily monitoring, schedule the actor to run daily.

**What if the scraper gets blocked?**
- Ensure you're using TR residential proxies
- If still blocked, try reducing `maxConcurrency` by setting it lower (contact support)

---

### Turkish E-Commerce Intelligence Suite

- **N11.com Product Scraper** — Turkey's third-largest e-commerce platform
- **Turkish Marketplace Seller Intelligence** — Cross-platform seller analytics
- **Turkish Product Review Aggregator** — Customer review data at scale

### Turkish Automotive Intelligence Suite

- **Turkish Auto Price Tracker** — Cross-platform price comparison (Arabam + Sahibinden + OtoMoto)
- **Turkish Auto Dealer Intelligence** — Dealer/galeri profiles and inventory analytics

---

## 🇹🇷 Turkish Data Intelligence Portfolio

This actor is part of a suite of 9 specialized Turkish market data tools:

**E-Commerce Intelligence:**
- N11 Product Scraper — Turkey's third-largest marketplace
- Turkish Marketplace Seller Intelligence — Trendyol, Hepsiburada, N11 seller profiles
- Turkish E-Commerce Review Aggregator — Cross-platform reviews with sentiment analysis

**Automotive Intelligence:**
- Arabam.com Vehicle Scraper — Used car listings with paint condition data
- Turkish Auto Price Tracker — Cross-platform vehicle valuation
- Turkish Auto Dealer Intelligence — Galeri profiles and inventory analytics

**Real Estate Intelligence:**
- Emlakjet Property Scraper — Zero-competition property data
- Turkish Property Valuation Engine — Cross-platform pricing with rental yield analysis
- Turkish Real Estate Agency Scraper — Emlak ofisi profiles and portfolios

All actors share consistent output schemas, Turkish language support, and transparent 
pay-per-event pricing. Built and maintained by [your username].


This actor is part of a suite of 9 specialized Turkish market data tools:

**E-Commerce Intelligence:**
- N11 Product Scraper ? Turkey's third-largest marketplace
- Turkish Marketplace Seller Intelligence ? Trendyol, Hepsiburada, N11 seller profiles
- Turkish E-Commerce Review Aggregator ? Cross-platform reviews with sentiment analysis

**Automotive Intelligence:**
- Arabam.com Vehicle Scraper ? Used car listings with paint condition data
- Turkish Auto Price Tracker ? Cross-platform vehicle valuation
- Turkish Auto Dealer Intelligence ? Galeri profiles and inventory analytics

**Real Estate Intelligence:**
- Emlakjet Property Scraper ? Zero-competition property data
- Turkish Property Valuation Engine ? Cross-platform pricing with rental yield analysis
- Turkish Real Estate Agency Scraper ? Emlak ofisi profiles and portfolios

All actors share consistent output schemas, Turkish language support, and transparent 
pay-per-event pricing. Built and maintained by [your username].

This actor is part of a suite of 9 specialized Turkish market data tools:

**E-Commerce Intelligence:**
- N11 Product Scraper ? Turkey's third-largest marketplace
- Turkish Marketplace Seller Intelligence ? Trendyol, Hepsiburada, N11 seller profiles
- Turkish E-Commerce Review Aggregator ? Cross-platform reviews with sentiment analysis

**Automotive Intelligence:**
- Arabam.com Vehicle Scraper ? Used car listings with paint condition data
- Turkish Auto Price Tracker ? Cross-platform vehicle valuation
- Turkish Auto Dealer Intelligence ? Galeri profiles and inventory analytics

**Real Estate Intelligence:**
- Emlakjet Property Scraper ? Zero-competition property data
- Turkish Property Valuation Engine ? Cross-platform pricing with rental yield analysis
- Turkish Real Estate Agency Scraper ? Emlak ofisi profiles and portfolios

All actors share consistent output schemas, Turkish language support, and transparent 
pay-per-event pricing. Built and maintained by [your username].
Zero-competition property data
- Turkish Property Valuation Engine ? Cross-platform pricing with rental yield analysis
- Turkish Real Estate Agency Scraper ? Emlak ofisi profiles and portfolios

All actors share consistent output schemas, Turkish language support, and transparent 
pay-per-event pricing. Built and maintained by [your username].

This actor is part of a suite of 9 specialized Turkish market data tools:

**E-Commerce Intelligence:**
- N11 Product Scraper ? Turkey's third-largest marketplace
- Turkish Marketplace Seller Intelligence ? Trendyol, Hepsiburada, N11 seller profiles
- Turkish E-Commerce Review Aggregator ? Cross-platform reviews with sentiment analysis

**Automotive Intelligence:**
- Arabam.com Vehicle Scraper ? Used car listings with paint condition data
- Turkish Auto Price Tracker ? Cross-platform vehicle valuation
- Turkish Auto Dealer Intelligence ? Galeri profiles and inventory analytics

**Real Estate Intelligence:**
- Emlakjet Property Scraper ? Zero-competition property data
- Turkish Property Valuation Engine ? Cross-platform pricing with rental yield analysis
- Turkish Real Estate Agency Scraper ? Emlak ofisi profiles and portfolios

All actors share consistent output schemas, Turkish language support, and transparent 
pay-per-event pricing. Built and maintained by [your username].
