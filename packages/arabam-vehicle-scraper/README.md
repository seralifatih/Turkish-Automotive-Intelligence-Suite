# Arabam.com Vehicle Scraper — Turkish Auto Marketplace Data API

**arabam veri çekme | araba fiyat | ikinci el otomobil**

Extract comprehensive vehicle listing data from [arabam.com](https://www.arabam.com) — Turkey's largest dedicated automotive marketplace with 400,000+ active listings. Supports filter-based search and direct URL scraping.

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

Each record is pushed to the default dataset. Two record types:

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
  "engineSize": 1498,
  "horsePower": 150,
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

### Run summary (always appended at end)

```json
{
  "type": "RUN_SUMMARY",
  "totalRecords": 187,
  "durationSeconds": 420,
  "errors": 2,
  "warnings": ["Failed: https://..."],
  "inputSummary": {
    "maxListings": 200,
    "scrapeDetails": true,
    "initialRequests": 1
  }
}
```

---

## Paint Condition (Boya Durumu)

Paint condition is the most important vehicle condition signal in the Turkish used-car market. This scraper always extracts and parses it:

| Turkish text | paintedPanels | replacedPanels | isOriginal |
|--------------|--------------|----------------|------------|
| `Boyasız` | 0 | 0 | `true` |
| `Tamamı orjinal` | 0 | 0 | `true` |
| `2 boyalı` | 2 | 0 | `false` |
| `3 boya 1 değişen` | 3 | 1 | `false` |

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

The scraper uses arabam.com's `skip`/`take` pagination system. Each search page returns up to 20 listings. The scraper automatically paginates until `maxListings` is reached.

---

## Pricing

**$6 per 1,000 vehicle listings**

Charged on successful records pushed to the dataset. Run summary records are free.

---

## FAQ

**Why is `sellerPhone` null?**
Arabam.com hides phone numbers until a user clicks "Telefonu Göster." The phone reveal requires authentication and is not scrappable without a logged-in session.

**Can I scrape all listings without filters?**
Yes — use `https://www.arabam.com/ikinci-el/otomobil` as a `searchUrls` entry. Set `maxListings` to control volume.

**How fresh is the data?**
This actor scrapes in real-time — data is as fresh as your run. Arabam listings change frequently. For daily monitoring, schedule the actor to run daily.

**What if the scraper gets blocked?**
- Ensure you're using TR residential proxies
- If still blocked, try reducing `maxConcurrency` by setting it lower (contact support)

---

## Also by this developer

### Turkish E-Commerce Intelligence Suite

- **N11.com Product Scraper** — Turkey's third-largest e-commerce platform
- **Turkish Marketplace Seller Intelligence** — Cross-platform seller analytics
- **Turkish Product Review Aggregator** — Customer review data at scale

### Turkish Automotive Intelligence Suite

- **Turkish Auto Price Tracker** — Cross-platform price comparison (Arabam + Sahibinden + OtoMoto)
- **Turkish Auto Dealer Intelligence** — Dealer/galeri profiles and inventory analytics

---

*Building the definitive data intelligence toolkit for Turkey. Specializing in Turkish e-commerce and automotive market data. 6 actors | 2 verticals | Pay-per-event pricing.*
