# Turkish Automotive Intelligence Suite

Open-source APIs and Apify Actors for Turkey's used-car market.

This repository contains three production-oriented Actors/APIs built around the two biggest Turkish automotive marketplaces, plus a shared TypeScript utility package used across the stack.

The suite is designed for teams that need:

- listing-level vehicle data
- market valuation and price tracking
- dealer discovery and dealer intelligence
- a deployable monorepo structure for Apify

## What Is In This Repo

There are three user-facing Actors:

1. **Arabam.com Vehicle Scraper - Turkish Auto Marketplace Data API**
   Extracts structured used-car listings from Arabam.com, including price, mileage, specs, seller details, location, condition data, and optional detail-page enrichment.

2. **Turkish Auto Price Tracker - Arabam and Sahibinden Valuation API**
   Searches Arabam.com and Sahibinden.com for matching vehicles and returns listing-level price records plus statistical valuation summaries, percentiles, mileage buckets, and seller-type breakdowns.

3. **Turkish Auto Dealer Intelligence - Dealer Profiles and Inventory Analysis**
   Scrapes Turkish used-car dealer profiles from Arabam.com and Sahibinden.com, including identity, contact details, trust signals, and optional inventory-level pricing analysis.

There is also one internal shared package:

- **`packages/shared`**
  Shared normalization, stealth, error-handling, and utility code used by all three Actors.

## Why This Exists

Turkey's automotive market has a lot of public data, but not many clean interfaces for developers, analysts, insurers, lenders, fleet operators, or automotive businesses.

This repo splits the problem into three focused products:

- **raw marketplace extraction** with the Arabam scraper
- **pricing and valuation** with the price tracker
- **dealer and inventory intelligence** with the dealer intelligence actor

That separation keeps each Actor easier to understand, easier to monetize, and easier to integrate into other systems.

## Repository Structure

```text
.
+-- packages/
|   +-- arabam-vehicle-scraper/
|   |   +-- .actor/
|   |   +-- src/
|   |   +-- Dockerfile
|   |   `-- README.md
|   +-- auto-price-tracker/
|   |   +-- .actor/
|   |   +-- src/
|   |   +-- Dockerfile
|   |   `-- README.md
|   +-- dealer-intelligence/
|   |   +-- .actor/
|   |   +-- src/
|   |   +-- Dockerfile
|   |   `-- README.md
|   `-- shared/
|       +-- src/
|       +-- tests/
|       `-- package.json
+-- concept-note-auto.md
+-- .dockerignore
`-- .gitignore
```

## Actor Overview

### 1. Arabam Vehicle Scraper

Package: [`packages/arabam-vehicle-scraper`](./packages/arabam-vehicle-scraper)

Best for:

- collecting listing-level vehicle data
- tracking supply for a specific make/model
- building downstream datasets and analytics pipelines
- scraping Arabam search pages or direct listing URLs

Typical output includes:

- listing ID
- title
- make/model/year
- price
- mileage
- fuel type
- transmission
- city
- seller type
- paint or condition data when detail scraping is enabled

### 2. Auto Price Tracker

Package: [`packages/auto-price-tracker`](./packages/auto-price-tracker)

Best for:

- insurance valuation
- loan collateral assessment
- dealer pricing research
- buyer/seller fair-value checks

Typical output includes:

- `PRICE_RECORD` listing rows
- `PRICE_SUMMARY` valuation reports
- `RUN_SUMMARY` operational totals

It is built to answer questions like:

- What is a 2020 diesel Passat worth right now?
- How wide is the market range?
- How do dealer prices compare to owner-listed prices?

### 3. Dealer Intelligence

Package: [`packages/dealer-intelligence`](./packages/dealer-intelligence)

Best for:

- dealer discovery by city
- dealer profile enrichment
- market mapping by district or city
- optional inventory analysis per dealer

Typical output includes:

- dealer profile identity and contact info
- platform and location
- trust/profile signals
- optional nested inventory summary with listing count and pricing ranges

## Shared Package

Package: [`packages/shared`](./packages/shared)

The shared package centralizes logic that should not be duplicated across Actors, including:

- Turkish auto normalization
- shared type-safe helpers
- Sahibinden stealth/session helpers
- reusable parsing and error-handling primitives

## Current State

This repo has already been structured for Apify monorepo deployment:

- each Actor has its own `Dockerfile`
- each Actor has its own `.actor/actor.json`
- each Actor has input schema and output schema definitions
- shared code is packaged via `file:../shared`
- dataset views are defined for the most important outputs

The repo has also been smoke-tested on Apify for the core Arabam flows:

- Arabam vehicle search and detail scraping
- Arabam-backed price tracking
- Arabam dealer profile scraping
- Arabam dealer discovery
- Arabam dealer inventory summary

Sahibinden support exists, but it depends on valid session cookies and is operationally stricter than Arabam.

## Prerequisites

For local development you should have:

- Node.js 20+
- npm
- Playwright-compatible environment
- an Apify account if you want to deploy remotely

Recommended for live production runs:

- Apify residential proxies with `countryCode: TR`
- valid Sahibinden cookies for Sahibinden-backed runs

## Local Development

This repository does **not** currently use a root workspace package manager setup. Each package is installed independently.

### Install dependencies

Install shared first:

```powershell
cd packages/shared
npm install
```

Then install each Actor:

```powershell
cd ..\arabam-vehicle-scraper
npm install

cd ..\auto-price-tracker
npm install

cd ..\dealer-intelligence
npm install
```

### Build packages

```powershell
cd packages/shared
npm run build

cd ..\arabam-vehicle-scraper
npm run build

cd ..\auto-price-tracker
npm run build

cd ..\dealer-intelligence
npm run build
```

### Run in development mode

Each Actor exposes a `dev` script:

```powershell
cd packages/arabam-vehicle-scraper
npm run dev
```

```powershell
cd packages/auto-price-tracker
npm run dev
```

```powershell
cd packages/dealer-intelligence
npm run dev
```

### Tests

Shared tests live in `packages/shared`:

```powershell
cd packages/shared
npm test
```

## Deploying To Apify

This repository is set up as a public Git-based monorepo deployment.

Use these Git source URLs in Apify:

- `https://github.com/seralifatih/Turkish-Automotive-Intelligence-Suite.git#master:packages/arabam-vehicle-scraper`
- `https://github.com/seralifatih/Turkish-Automotive-Intelligence-Suite.git#master:packages/auto-price-tracker`
- `https://github.com/seralifatih/Turkish-Automotive-Intelligence-Suite.git#master:packages/dealer-intelligence`

Each Actor package contains:

- `.actor/actor.json`
- `.actor/input_schema.json`
- `.actor/output_schema.json`

The `.actor/actor.json` files use a repo-root Docker build context, which is required because the Actor packages depend on the shared package in `packages/shared`.

### Apify deployment flow

1. Create an empty Actor in Apify.
2. Switch the source type to `Git repository`.
3. Paste the appropriate monorepo URL from the list above.
4. Save the source.
5. Build the Actor.
6. Run a small smoke test from the `Input` tab.

## Output Schema Support

All three Actors now define output schemas for Apify's `Output` tab and API consumers.

That means each run exposes structured output URLs such as:

- default dataset listings or records
- summary-focused dataset views
- run summary views
- dealer inventory-focused views where applicable

This is especially useful for:

- API consumers
- AI agents using Apify Actors through MCP
- downstream automation that needs predictable output endpoints

## Monetization Notes

The suite is designed to support Apify `pay-per-event` monetization, but pricing should reflect actual proxy and browser cost per actor.

Broadly:

- the Arabam scraper is the lowest-friction data-acquisition product
- the price tracker is the highest leverage valuation product
- dealer intelligence is the most naturally B2B product

Pricing should be revisited with real usage data, especially for browser-heavy and proxy-heavy runs.

## Open Source And Contributions

This project is open source, and contributions are welcome.

If you want to help, useful contribution areas include:

- parser hardening when marketplace HTML changes
- better field coverage for Arabam and Sahibinden
- richer dealer inventory analytics
- stronger normalization for Turkish vehicle data
- improved output schemas and dataset views
- docs, examples, and deployment polish

If you plan to contribute:

1. Open an issue or start a discussion for larger changes.
2. Keep changes scoped to one package when possible.
3. Avoid unrelated formatting churn.
4. Include real-world examples or screenshots when fixing parser breakage.

## Roadmap Ideas

Likely next improvements:

- stronger Sahibinden operational coverage
- richer dealer inventory summaries
- more valuation-specific charge events for Apify monetization
- better packaging and root workspace tooling
- additional Turkish automotive marketplaces

## Legal And Platform Notes

This repository is not affiliated with Arabam.com or Sahibinden.com.

If you use these Actors in production:

- respect marketplace terms and robots expectations
- use conservative concurrency
- use Turkish residential proxies where appropriate
- provide valid session cookies only for accounts you control

## Package READMEs

For actor-specific usage and input examples, see:

- [`packages/arabam-vehicle-scraper/README.md`](./packages/arabam-vehicle-scraper/README.md)
- [`packages/auto-price-tracker/README.md`](./packages/auto-price-tracker/README.md)
- [`packages/dealer-intelligence/README.md`](./packages/dealer-intelligence/README.md)

## License

Add your preferred license here before publishing broadly.
