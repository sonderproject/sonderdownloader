import { NextRequest, NextResponse } from "next/server";
import chromiumPack from "@sparticuz/chromium-min";
// playwright-extra wraps playwright-core so we can attach the stealth
// plugin from the puppeteer-extra ecosystem (they share the same plugin
// interface). This adds ~20 evasions on top of what we can do by hand.
import { chromium as extraChromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext, Page } from "playwright-core";

extraChromium.use(StealthPlugin());

export const runtime = "nodejs";
// Vercel Hobby caps at 10s; extraction (browser boot + PerimeterX-safe
// render/wait) routinely takes 20–40s, so Vercel Pro is required.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const DEFAULT_CHROMIUM_PACK =
  "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar";

const ZILLOW_HOST_RE = /(^|\.)zillow\.com$/i;

// Dedup key = photo hash. Size suffix is captured only so we can pick
// the largest observed for logging; we always rebuild at cc_ft_1536.
const PHOTO_URL_RE =
  /photos\.zillowstatic\.com\\?\/fp\\?\/([a-zA-Z0-9]+)-cc_ft_(\d+)\.(?:jpg|webp)/g;

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// PerimeterX and other challenge markers we can detect from the page.
const CHALLENGE_MARKERS = [
  "px-captcha",
  "perimeterx",
  "Please verify you are a human",
  "captcha-delivery",
  "/_Incapsula_Resource",
  "Access to this page has been denied",
];

function slugFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const match = u.pathname.match(/\/homedetails\/([^/]+)/i);
    const raw =
      match?.[1] ?? u.pathname.split("/").filter(Boolean).pop() ?? "listing";
    return (
      raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "listing"
    );
  } catch {
    return "listing";
  }
}

async function launchBrowser(): Promise<Browser> {
  const isLocal = !process.env.VERCEL && !process.env.AWS_REGION;

  const stealthArgs = [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process,Translate",
    "--disable-dev-shm-usage",
    "--no-default-browser-check",
    "--no-first-run",
  ];

  if (isLocal) {
    const localPath =
      process.env.CHROMIUM_EXECUTABLE_PATH ||
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      undefined;
    return (await extraChromium.launch({
      headless: true,
      executablePath: localPath,
      args: stealthArgs,
    })) as unknown as Browser;
  }

  const packUrl = process.env.CHROMIUM_PACK_URL || DEFAULT_CHROMIUM_PACK;
  const executablePath = await chromiumPack.executablePath(packUrl);
  return (await extraChromium.launch({
    args: [...chromiumPack.args, ...stealthArgs],
    executablePath,
    headless: true,
  })) as unknown as Browser;
}

type PhotoRecord = { hash: string; maxSize: number };

function ingestMatches(source: string, sink: Map<string, PhotoRecord>) {
  for (const m of source.matchAll(PHOTO_URL_RE)) {
    const hash = m[1];
    const size = Number(m[2]) || 0;
    const existing = sink.get(hash);
    if (!existing || size > existing.maxSize) {
      sink.set(hash, { hash, maxSize: Math.max(size, existing?.maxSize ?? 0) });
    }
  }
}

async function humanNudge(page: Page) {
  // Cheap human-like sequence: mouse jitter, small scroll, brief pause.
  try {
    await page.mouse.move(220, 340, { steps: 8 });
    await page.mouse.move(520, 260, { steps: 12 });
    await page.waitForTimeout(400);
    await page.evaluate(() =>
      window.scrollBy({ top: 600, left: 0, behavior: "instant" as ScrollBehavior }),
    );
    await page.waitForTimeout(600);
  } catch {}
}

async function pageLooksBlocked(page: Page): Promise<boolean> {
  try {
    const html = (await page.content()).slice(0, 30_000);
    return CHALLENGE_MARKERS.some((m) => html.includes(m));
  } catch {
    return false;
  }
}

async function extractOnce(
  context: BrowserContext,
  targetUrl: string,
): Promise<{ hashes: string[]; addressSlug: string | null; blocked: boolean }> {
  const page = await context.newPage();
  const sink = new Map<string, PhotoRecord>();

  page.on("response", (response) => {
    const u = response.url();
    if (u.includes("photos.zillowstatic.com")) ingestMatches(u, sink);
  });

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });

  // First-pass wait then human nudge, then a real settling wait.
  await page.waitForTimeout(3_500);
  await humanNudge(page);
  await page
    .waitForLoadState("networkidle", { timeout: 12_000 })
    .catch(() => undefined);

  // Bottom scroll to fully coax the gallery lazy-load, then back up.
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" as ScrollBehavior }),
  );
  await page.waitForTimeout(2_000);
  await page.evaluate(() =>
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }),
  );
  await page.waitForTimeout(1_200);

  const blocked = await pageLooksBlocked(page);
  const html = await page.content();
  ingestMatches(html, sink);

  const scriptTexts: string[] = await page
    .$$eval("script", (nodes) => nodes.map((n) => n.textContent || ""))
    .catch(() => []);
  for (const text of scriptTexts) {
    if (text.includes("photos.zillowstatic.com")) ingestMatches(text, sink);
  }

  let addressSlug: string | null = null;
  try {
    addressSlug = await page.$$eval(
      "script[type='application/ld+json']",
      (nodes) => {
        for (const n of nodes) {
          try {
            const data = JSON.parse(n.textContent || "");
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
              const addr = item?.address;
              if (addr && (addr.streetAddress || addr.addressLocality)) {
                const parts = [
                  addr.streetAddress,
                  addr.addressLocality,
                  addr.addressRegion,
                  addr.postalCode,
                ].filter(Boolean);
                return parts.join(" ");
              }
            }
          } catch {}
        }
        return null;
      },
    );
  } catch {}

  await page.close().catch(() => undefined);
  return {
    hashes: Array.from(sink.values()).map((r) => r.hash),
    addressSlug,
    blocked,
  };
}

function buildContextOptions(): Parameters<Browser["newContext"]>[0] {
  return {
    userAgent: DESKTOP_USER_AGENT,
    viewport: { width: 1400, height: 1000 },
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    javaScriptEnabled: true,
    bypassCSP: true,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif," +
        "image/webp,image/apng,*/*;q=0.8",
      "Sec-Ch-Ua":
        '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    },
  };
}

export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const rawUrl = body.url?.trim();
  if (!rawUrl) {
    return NextResponse.json(
      { error: "Please paste a Zillow listing URL." },
      { status: 400 },
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return NextResponse.json(
      { error: "That doesn't look like a valid URL." },
      { status: 400 },
    );
  }
  if (!ZILLOW_HOST_RE.test(parsed.hostname)) {
    return NextResponse.json(
      { error: "Only zillow.com listing URLs are supported." },
      { status: 400 },
    );
  }

  // Strip tracking params — they don't help scraping and may trip
  // referral checks.
  for (const k of Array.from(parsed.searchParams.keys())) {
    if (k.startsWith("utm_") || k === "fbclid" || k === "gclid") {
      parsed.searchParams.delete(k);
    }
  }
  const target = parsed.toString();

  let browser: Browser | null = null;

  try {
    browser = await launchBrowser();

    // First attempt on the canonical URL.
    let ctx = await browser.newContext(buildContextOptions());
    let result = await extractOnce(ctx, target);
    await ctx.close().catch(() => undefined);

    // If we got nothing but the page didn't look blocked, try one retry
    // with a fresh context and slightly different UA fingerprint.
    if (result.hashes.length === 0) {
      ctx = await browser.newContext({
        ...buildContextOptions(),
        userAgent: DESKTOP_USER_AGENT.replace("10_15_7", "10_15_8"),
      });
      const retry = await extractOnce(ctx, target);
      await ctx.close().catch(() => undefined);
      if (retry.hashes.length > result.hashes.length) {
        result = retry;
      }
    }

    if (result.hashes.length === 0) {
      return NextResponse.json(
        {
          error: result.blocked
            ? "Zillow blocked this request. Wait a minute and try again — the challenge usually clears fast."
            : "No photos found on that page. Double-check the listing URL and try again.",
        },
        { status: 502 },
      );
    }

    const photos = result.hashes.map(
      (h) => `https://photos.zillowstatic.com/fp/${h}-cc_ft_1536.jpg`,
    );

    let slug = slugFromUrl(target);
    if (result.addressSlug) {
      const s = result.addressSlug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (s.length > 0) slug = s;
    }

    return NextResponse.json({ photos, slug, sourceUrl: target });
  } catch (err) {
    console.error("extract error:", err);
    return NextResponse.json(
      {
        error:
          "Zillow blocked this request. Wait a minute and try again — the challenge usually clears fast.",
      },
      { status: 502 },
    );
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}
