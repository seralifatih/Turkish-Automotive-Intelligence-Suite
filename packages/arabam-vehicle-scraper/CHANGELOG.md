# Changelog

All notable changes to the Arabam.com Vehicle Scraper are documented here.

## 1.1.0

This is a **breaking release**. Consumers reading dataset records or the run
summary should review every item below before upgrading.

### ⚠️ Breaking changes

- **`RUN_SUMMARY` moved from the default dataset to the key-value store.** It is no longer a dataset row with `type: "RUN_SUMMARY"`. Read it from the run's key-value store under the key `RUN_SUMMARY` instead (Console: *Storage → Key-value store → RUN_SUMMARY*; API: `GET /v2/key-value-stores/{storeId}/records/RUN_SUMMARY`). **Action required:** if you filtered the dataset for `type == 'RUN_SUMMARY'` (including the old Apify Console "Run Summary" dataset view, which has been removed since it would now always be empty), switch to reading the key-value store record instead.
- **`paintCondition.paintedPanels` / `replacedPanels` / `isOriginal` are now nullable** (`number | null`, `boolean | null`). They are `null` whenever paint condition is unspecified or unparseable — previously this was reported as a confirmed `0`/`false`, which misrepresented "we don't know" as "no paint work." **Action required:** any code doing `if (record.paintCondition.isOriginal)` or arithmetic on `paintedPanels`/`replacedPanels` must null-check first.
- **`transmission` matching is now exact-value/exact-token only, never substring.** This mainly affects values that previously *shouldn't* have matched but could have via substring overlap (e.g. a value embedding "manuel" as part of a longer word). If you depended on fuzzy/partial transmission text matching outside this scraper, re-verify against the new `transmissionRaw` field.
- **New required-shaped fields added to every vehicle record:** `transmissionRaw`, `engineSizeMin`, `engineSizeMax`, `horsePowerMin`, `horsePowerMax`. Existing consumers with strict schema validation (e.g. `additionalProperties: false`) will need to update their schema to allow these.
- **`engineSize` / `horsePower` are `null` for range specs** (e.g. `"1401 - 1600 cm3"`, `"101 - 125 HP"`) where they previously held a fabricated midpoint value. **Action required:** any code reading `engineSize`/`horsePower` as always-present numbers for range-spec listings must now handle `null` and fall back to `engineSizeMin`/`Max` (`horsePowerMin`/`Max`) if an estimate is acceptable for your use case.

### Fixed

- **fix(transmission):** `"Vites Tipi: Düz"` (bare "Düz", not "Düz Vites") normalized to `null` instead of `manuel`. Audited and fixed the full transmission map so bare `Düz`/`Otomatik`/`Yarı Otomatik` values all map correctly. Any value that still doesn't match a known transmission type is now preserved in a new `transmissionRaw` field instead of being dropped. (listings 44612039, 44548102)
- **fix(transmission):** the bare `"el"`/`"duz"` keywords are matched as an exact whole normalized value or an exact whole whitespace-delimited token — never as a substring. Values like `"Elektrik"`, `"ManuelX"`, `"Submanuel"`, `"Automanuel"`, `"Duzensiz"` now correctly return `null` instead of risking a false match.
- **fix(engine-specs):** `engineSize`/`horsePower` no longer fabricate a midpoint when arabam reports a range (e.g. `"1401 - 1600 cm3"` → previously `1501`, `"101 - 125 HP"` → previously `113`). Ranges now set `engineSize`/`horsePower` to `null` and populate new `engineSizeMin`/`engineSizeMax` and `horsePowerMin`/`horsePowerMax` fields. Exact specs (`"1598 CC"`, `"120 HP"`) still set the exact field, with `Min`/`Max` both equal to it.
- **fix(images):** `imageUrls` could include images from unrelated listings pulled in by arabam's "similar listings" carousel sharing the same gallery markup (listing 44583261: 15 own + 10 contaminant images). Now filtered to only URLs whose path contains `/{listingId}/`; `imageCount` is recomputed after filtering.
- **fix(seller-phone):** `sellerPhone` was always arabam's central masked contact number (`+908507599000`), never the actual seller's. Now set to `null` when it equals that number.
- **fix(paint-condition):** `"Boya-Değişen: Belirtilmemiş"` (unspecified) was reported as `paintedPanels: 0, replacedPanels: 0, isOriginal: false` — presenting "not specified" as a confirmed zero/not-original. Now `null` for all three fields whenever paint condition is unspecified **or genuinely unparseable, or the input is empty/missing** — a confirmed `0`/`true` is only returned for text that actually says "no paint work" (e.g. `"Boyasız"`, `"Tamamı orjinal"`).
- **fix(output):** `RUN_SUMMARY` moved from the default dataset to the run's key-value store (key `RUN_SUMMARY`). It was previously pushed as a dataset record, which the platform bills like any other row despite being run metadata, not vehicle data. (See Breaking changes above.)
- **fix(crawler-stop):** the crawler never stopped once `maxListings` was reached — it kept paginating and fetching detail pages until the run's 600s timeout aborted it. `crawler.stop()` is now called as soon as the budget is satisfied, which lets `crawler.run()` resolve normally (run finishes SUCCEEDED, not timed out) instead of draining the rest of the queue. A `preNavigationHooks` guard also skips navigation entirely (no page load at all) for a DETAIL request that was already dequeued in the brief window around `stop()` but is no longer needed.
- **fix(enqueue-cap):** `totalEnqueued` (requests actually added to the queue) is now capped with `Math.min(..., maxListings)` as a hard backstop, and the enqueue-counting bug below being fixed makes the cap actually take effect page-to-page (previously every page re-enqueued a full batch regardless of how much budget remained).
- **fix(addRequests-counting):** every page was logging `"Enqueued 0 new detail pages (... 20 were duplicates)"` and a false "not processed by the queue (possible rate limiting)" shortfall warning, even though those exact requests were later fetched and pushed successfully. Root cause: `crawler.addRequests()` (→ `addRequestsBatched()` in crawlee 3.16) returns `{ addedRequests, waitForAllRequestsToBeAdded }` — `addedRequests` holds the full result when `waitForAllRequestsToBeAdded: true` is passed and the batch fits in one chunk (true for our ≤20-URL calls), while `waitForAllRequestsToBeAdded` resolves to `[]` in that same case (it only covers chunks *beyond* the first). The code was reading the latter. Fixed to read `result.addedRequests`; verified against a real (non-mocked) crawlee `RequestQueue`. Shortfall warnings now only fire on an actual shortfall.

### Changed

- Output schema: added `transmissionRaw`, `engineSizeMin`, `engineSizeMax`, `horsePowerMin`, `horsePowerMax`. `paintCondition.paintedPanels`/`replacedPanels`/`isOriginal` are now nullable. See README for the updated output schema and examples.
- `.actor/actor.json`: removed the dead `runSummary` dataset view (filtered on `type == 'RUN_SUMMARY'`, which can no longer match anything).
- `.actor/output_schema.json`: `runSummary` entry now links to the key-value store record instead of the old dataset view.
- Actor version bumped `1.0.0` → `1.1.0` (`package.json` and `.actor/actor.json`) to reflect the breaking changes above.
- RUN_SUMMARY is now written on `Actor.on('migrating', ...)` and `Actor.on('aborting', ...)`, and in a top-level `catch` for any unexpected error — not only on normal completion — so a migrated, aborted, or crashed run still leaves a RUN_SUMMARY reflecting progress up to that point. (The one case nothing in-process can catch is a hard run-timeout kill, where the container is terminated with no further code execution — but that failure mode itself should no longer occur now that the crawler stops cleanly once `maxListings` is reached.)

## Previous

- fix: arabam scraper pagination advanced via `skip` (which arabam.com ignores) instead of `page` (the param the site's own pagination links actually use); switched to `page`, kept the already-seen-listingId overlap guard as a safety net, and made `maxListings` shortfalls loud in `RUN_SUMMARY` instead of silently under-reporting.
- fix: arabam scraper run timeout on 300s default
- fix: arabam detail parser field extraction bugs
- fix: arabam scraper concurrency stuck at 1 on apify
- fix: arabam scraper timeout on apify containers
