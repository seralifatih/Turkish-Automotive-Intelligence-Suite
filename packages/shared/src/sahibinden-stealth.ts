/**
 * sahibinden-stealth.ts
 * Anti-detection helper for scraping Sahibinden.com.
 *
 * Sahibinden uses aggressive Cloudflare protection. This class handles:
 *   - Session cookie injection from user-provided cookies
 *   - Viewport randomization
 *   - User-Agent rotation (20+ modern Chrome UAs)
 *   - Random mouse movements before page interactions
 *   - Randomized wait delays
 *   - Cloudflare challenge page detection
 *
 * Usage:
 *   const stealth = new SahibindenStealth(context);
 *   await stealth.setup(userCookies);
 *   const page = await context.newPage();
 *   await stealth.randomMouseMovement(page);
 *   await stealth.wait(5, 10);
 */

import type { BrowserContext, Page } from 'playwright';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

interface Viewport {
  width: number;
  height: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SAHIBINDEN_DOMAIN = '.sahibinden.com';

const VIEWPORTS: Viewport[] = [
  { width: 1920, height: 1080 },
  { width: 1680, height: 1050 },
  { width: 1600, height: 900 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1280, height: 720 },
  { width: 2560, height: 1440 },
  { width: 1920, height: 1200 },
  { width: 1536, height: 864 },
];

const USER_AGENTS: string[] = [
  // Chrome on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  // Chrome on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 12_7_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Chrome on Linux (less common but still real)
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  // Edge on Windows (same Chromium engine, common in Turkey)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
];

// Cloudflare challenge page detection patterns
const CLOUDFLARE_INDICATORS = [
  'cf-browser-verification',
  'cf_chl_opt',
  'Checking your browser',
  'Ray ID',
  'cloudflare',
  'cf-spinner',
  '__cf_chl',
  'challenge-platform',
  'Tarayıcınız kontrol ediliyor', // Turkish: "Your browser is being checked"
];

// ─── SahibindenStealth class ─────────────────────────────────────────────────

export class SahibindenStealth {
  private readonly context: BrowserContext;
  private currentUserAgent: string;
  private currentViewport: Viewport;

  constructor(context: BrowserContext) {
    this.context = context;
    this.currentUserAgent = this.pickRandom(USER_AGENTS);
    this.currentViewport = this.pickRandom(VIEWPORTS);
  }

  // ── Setup ────────────────────────────────────────────────────────────────

  /**
   * Full setup: inject cookies, set viewport and User-Agent headers.
   * Call once after creating the BrowserContext.
   */
  async setup(cookies: SessionCookie[] = []): Promise<void> {
    if (cookies.length > 0) {
      await this.injectCookies(cookies);
    }
    await this.applyViewport();
    await this.rotateUserAgent();
  }

  // ── Cookie injection ─────────────────────────────────────────────────────

  /**
   * Inject user-provided session cookies into the browser context.
   * Cookies without an explicit domain default to .sahibinden.com.
   * Never logs or stores cookie values.
   */
  async injectCookies(cookies: SessionCookie[]): Promise<void> {
    const normalized = cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain ?? SAHIBINDEN_DOMAIN,
      path: c.path ?? '/',
      expires: c.expires,
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? true,
      sameSite: c.sameSite ?? ('Lax' as const),
    }));

    await this.context.addCookies(normalized);
  }

  // ── Viewport ─────────────────────────────────────────────────────────────

  /**
   * Set a random realistic desktop viewport on the context.
   */
  async applyViewport(): Promise<void> {
    this.currentViewport = this.pickRandom(VIEWPORTS);
    // Playwright contexts don't expose setViewportSize directly —
    // viewport is applied when new pages are created. We store it
    // so callers can pass it to newPage() options if needed.
  }

  /** The currently selected viewport (pass to page.setViewportSize if needed). */
  getViewport(): Viewport {
    return { ...this.currentViewport };
  }

  /**
   * Apply the currently selected viewport to a page before navigation.
   */
  async applyPageViewport(page: Page): Promise<void> {
    await page.setViewportSize(this.currentViewport);
  }

  // ── User-Agent ───────────────────────────────────────────────────────────

  /**
   * Rotate to a new random User-Agent and apply it as an extra HTTP header.
   * Call before navigating to a new listing category.
   */
  async rotateUserAgent(): Promise<void> {
    this.currentUserAgent = this.pickRandom(USER_AGENTS);
    await this.context.setExtraHTTPHeaders({
      'User-Agent': this.currentUserAgent,
    });
  }

  /** The currently selected User-Agent string. */
  getUserAgent(): string {
    return this.currentUserAgent;
  }

  // ── Mouse movement ───────────────────────────────────────────────────────

  /**
   * Perform a short sequence of random mouse movements on the page to simulate
   * a real user before clicking or interacting with an element.
   *
   * @param page - Playwright Page instance
   * @param steps - Number of intermediate mouse positions (default 4–8)
   */
  async randomMouseMovement(page: Page, steps?: number): Promise<void> {
    const { width, height } = this.currentViewport;
    const numSteps = steps ?? this.randomInt(4, 8);

    for (let i = 0; i < numSteps; i++) {
      const x = this.randomInt(50, width - 50);
      const y = this.randomInt(50, height - 50);
      await page.mouse.move(x, y, { steps: this.randomInt(5, 15) });
      // Short pause between movements
      await this.wait(0.05, 0.2);
    }
  }

  // ── Timing ───────────────────────────────────────────────────────────────

  /**
   * Wait for a random duration between minSeconds and maxSeconds.
   *
   * @param minSeconds - Minimum wait in seconds (default 5)
   * @param maxSeconds - Maximum wait in seconds (default 15)
   */
  async wait(minSeconds = 5, maxSeconds = 15): Promise<void> {
    const ms = this.randomInt(Math.round(minSeconds * 1000), Math.round(maxSeconds * 1000));
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  // ── Cloudflare detection ─────────────────────────────────────────────────

  /**
   * Check if the current page is showing a Cloudflare challenge.
   * Inspects both page title and body content.
   *
   * @param page - Playwright Page instance
   * @returns true if Cloudflare challenge is detected
   */
  async isCloudflareChallenge(page: Page): Promise<boolean> {
    try {
      const title = await page.title();
      if (
        title.toLowerCase().includes('just a moment') ||
        title.toLowerCase().includes('attention required') ||
        title.toLowerCase().includes('cloudflare')
      ) {
        return true;
      }

      const bodyText = await page.evaluate(() => document.body?.innerHTML ?? '');
      for (const indicator of CLOUDFLARE_INDICATORS) {
        if (bodyText.includes(indicator)) {
          return true;
        }
      }

      return false;
    } catch {
      // If we can't read the page, assume it might be challenged
      return false;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
