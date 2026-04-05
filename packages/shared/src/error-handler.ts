/**
 * error-handler.ts
 * Shared error detection and reporting utilities for all three Cluster 2 actors.
 *
 * Handles:
 *   - Cloudflare challenge detection (multiple CF variants)
 *   - Session expiry detection (sahibinden.com login redirects)
 *   - Empty results detection with helpful suggestions
 *   - Partial failure tracking for run summaries
 */

import type { Page } from 'playwright';

// ─── Detection results ────────────────────────────────────────────────────────

export type BlockReason =
  | 'cloudflare_challenge'
  | 'login_required'
  | 'session_expired'
  | 'access_denied'
  | 'not_found'
  | 'server_error';

export interface BlockDetectionResult {
  blocked: boolean;
  reason: BlockReason | null;
  message: string;
  actionSuggestion: string;
}

// ─── Cloudflare & auth detection ─────────────────────────────────────────────

const CF_TITLE_PATTERNS = [
  'just a moment',
  'attention required',
  'cloudflare',
  'ddos-guard',
  'one more step',
];

const CF_BODY_PATTERNS = [
  'cf-browser-verification',
  '__cf_chl',
  'cf-spinner',
  'challenge-platform',
  'cf_chl_opt',
  'Tarayıcınız kontrol ediliyor',  // "Your browser is being checked"
  'Sizi robot olmadığınızı doğrulayın', // "Verify you are not a robot"
];

const LOGIN_URL_PATTERNS = [
  'secure.sahibinden.com/giris',
  'secure.sahibinden.com/login',
  '/login?',
  '/giris?',
];

const SESSION_EXPIRY_BODY_PATTERNS = [
  'üye girişi yapın',
  'oturum süreniz doldu',
  'giriş yapmanız gerekiyor',
  'session expired',
  'oturumunuz sona erdi',
];

/**
 * Detect if a page is showing a Cloudflare challenge, login wall, or other block.
 * Call after navigation, before attempting to parse content.
 */
export async function detectBlock(page: Page): Promise<BlockDetectionResult> {
  try {
    const title = (await page.title()).toLowerCase();
    const url = page.url().toLowerCase();

    // 404
    if (url.includes('sayfa-bulunamadi') || title.includes('sayfa bulunamadı') || title.includes('404')) {
      return {
        blocked: true,
        reason: 'not_found',
        message: 'Page not found (404)',
        actionSuggestion: 'Check that the URL is still valid — the dealer may have been removed.',
      };
    }

    // Cloudflare via title
    if (CF_TITLE_PATTERNS.some((p) => title.includes(p))) {
      return {
        blocked: true,
        reason: 'cloudflare_challenge',
        message: `Cloudflare challenge detected (title: "${title}")`,
        actionSuggestion:
          'Switch to TR residential proxies (Apify RESIDENTIAL group, countryCode: TR). ' +
          'Ensure headless: false in Playwright config.',
      };
    }

    // Login redirect
    if (LOGIN_URL_PATTERNS.some((p) => url.includes(p))) {
      return {
        blocked: true,
        reason: 'login_required',
        message: 'Login redirect detected — session cookies missing or expired',
        actionSuggestion:
          'Re-export your sahibinden.com session cookies using EditThisCookie (Chrome) or ' +
          'Cookie-Editor (Firefox) and update the sahibindenCookies input.',
      };
    }

    // Read body content for deeper checks
    const bodyText = await page.evaluate(
      () => document.body?.innerHTML?.slice(0, 2000) ?? '',
    );

    // Cloudflare via body
    if (CF_BODY_PATTERNS.some((p) => bodyText.includes(p))) {
      return {
        blocked: true,
        reason: 'cloudflare_challenge',
        message: 'Cloudflare challenge detected in page body',
        actionSuggestion:
          'Cloudflare is blocking the request. Use TR residential proxies and ensure ' +
          'playwright-extra stealth plugin is active.',
      };
    }

    // Session expiry
    if (SESSION_EXPIRY_BODY_PATTERNS.some((p) => bodyText.toLowerCase().includes(p))) {
      return {
        blocked: true,
        reason: 'session_expired',
        message: 'Session expiry wall detected',
        actionSuggestion:
          'Your sahibinden.com session has expired. Log in fresh, re-export cookies, ' +
          'and update sahibindenCookies in the actor input.',
      };
    }

    // HTTP 403 check via response status if accessible
    // (Playwright doesn't expose this directly here, but we catch it via body patterns above)

    return { blocked: false, reason: null, message: '', actionSuggestion: '' };
  } catch (err) {
    // If page evaluation fails, don't block — let the caller handle gracefully
    return { blocked: false, reason: null, message: `Detection error: ${err}`, actionSuggestion: '' };
  }
}

// ─── Empty results detection ─────────────────────────────────────────────────

export interface EmptyResultsInfo {
  isEmpty: boolean;
  totalCount: number | null;
  suggestion: string;
}

/**
 * Check if a search results page returned zero listings and suggest next steps.
 */
export function analyzeEmptyResults(
  listingCount: number,
  totalCount: number | null,
  filterDescription: string,
): EmptyResultsInfo {
  if (listingCount > 0) {
    return { isEmpty: false, totalCount, suggestion: '' };
  }

  const suggestions: string[] = [
    `No listings found for: ${filterDescription}.`,
    'Try broadening the search:',
    '  • Remove fuelType or transmission filters',
    '  • Expand yearMin/yearMax range (e.g. ±2 years)',
    '  • Remove city filter to search nationwide',
    '  • Check that make/model spelling matches arabam.com slugs',
  ];

  if (totalCount === 0) {
    suggestions.push(
      '  • The platform returned 0 total results — this spec may not exist in Turkey.',
    );
  }

  return {
    isEmpty: true,
    totalCount,
    suggestion: suggestions.join('\n'),
  };
}

// ─── Partial failure tracker ──────────────────────────────────────────────────

export class FailureTracker {
  private readonly errors: string[] = [];
  private readonly warnings: string[] = [];
  private successCount = 0;
  private failureCount = 0;

  recordSuccess(): void {
    this.successCount++;
  }

  recordFailure(context: string, error: unknown): void {
    this.failureCount++;
    const msg = `FAIL [${context}]: ${error instanceof Error ? error.message : String(error)}`;
    this.errors.push(msg);
  }

  recordWarning(message: string): void {
    this.warnings.push(message);
  }

  getErrors(): readonly string[] {
    return this.errors;
  }

  getWarnings(): readonly string[] {
    return this.warnings;
  }

  getSummary(): { succeeded: number; failed: number; errorMessages: string[] } {
    return {
      succeeded: this.successCount,
      failed: this.failureCount,
      errorMessages: this.errors.slice(0, 50),
    };
  }

  get totalErrors(): number {
    return this.failureCount;
  }

  /** All messages (errors + warnings) for the RUN_SUMMARY warnings array */
  getAllMessages(): string[] {
    return [...this.errors, ...this.warnings].slice(0, 50);
  }
}

// ─── URL domain validation ────────────────────────────────────────────────────

const PLATFORM_DOMAINS: Record<string, string[]> = {
  arabam: ['arabam.com'],
  sahibinden: ['sahibinden.com', 'secure.sahibinden.com'],
  otomoto: ['otomoto.com.tr'],
};

export interface UrlValidationResult {
  valid: boolean;
  platform: string | null;
  error: string | null;
}

/**
 * Validate that a URL belongs to the expected platform domain.
 */
export function validatePlatformUrl(
  url: string,
  expectedPlatform: string,
): UrlValidationResult {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const allowedDomains = PLATFORM_DOMAINS[expectedPlatform] ?? [];

    const matchesDomain = allowedDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
    if (!matchesDomain) {
      return {
        valid: false,
        platform: expectedPlatform,
        error: `URL "${url}" does not belong to ${expectedPlatform} (expected domain: ${allowedDomains.join(' or ')})`,
      };
    }

    return { valid: true, platform: expectedPlatform, error: null };
  } catch {
    return { valid: false, platform: null, error: `Invalid URL: "${url}"` };
  }
}

/**
 * Auto-detect which platform a URL belongs to.
 */
export function detectPlatformFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    for (const [platform, domains] of Object.entries(PLATFORM_DOMAINS)) {
      if (domains.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
        return platform;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Sahibinden cookie validation ─────────────────────────────────────────────

export interface CookieValidationResult {
  valid: boolean;
  warnings: string[];
}

/**
 * Basic sanity check on provided sahibinden cookies.
 * Does not validate values (can't without hitting the server),
 * but checks for obviously missing cookies.
 */
export function validateSahibindenCookies(
  cookies: Array<{ name: string; value: string }> | undefined,
): CookieValidationResult {
  if (!cookies || cookies.length === 0) {
    return {
      valid: false,
      warnings: [
        'No sahibinden.com session cookies provided.',
        'Sahibinden will be skipped. To enable it:',
        '  1. Log in to sahibinden.com in Chrome or Firefox',
        '  2. Install EditThisCookie (Chrome) or Cookie-Editor (Firefox)',
        '  3. Export all cookies as JSON',
        '  4. Paste the array into the sahibindenCookies input field',
      ],
    };
  }

  const warnings: string[] = [];
  const names = cookies.map((c) => c.name.toLowerCase());

  // sahibinden.com typically uses SID / SIDd / PHPSESSID
  const hasSessionCookie = names.some((n) =>
    ['sid', 'sidd', 'phpsessid', '__cf_bm', 'cf_clearance'].includes(n),
  );

  if (!hasSessionCookie) {
    warnings.push(
      'Session cookie (SID, SIDd, or PHPSESSID) not found in provided cookies. ' +
      'The cookies may be incomplete — re-export all cookies from sahibinden.com.',
    );
  }

  const emptyCookies = cookies.filter((c) => !c.value || c.value.trim() === '');
  if (emptyCookies.length > 0) {
    warnings.push(
      `${emptyCookies.length} cookie(s) have empty values: ${emptyCookies.map((c) => c.name).join(', ')}`,
    );
  }

  return { valid: warnings.length === 0, warnings };
}
