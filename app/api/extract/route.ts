import { NextRequest, NextResponse } from "next/server";
import chromium from "@sparticuz/chromium-min";
import {
  chromium as playwrightChromium,
  type Browser,
  type BrowserContext,
} from "playwright-core";

export const runtime = "nodejs";
// NOTE: Vercel Hobby caps serverless functions at 10s. The extract flow
// (Chromium cold boot + PerimeterX-friendly render/wait cycle) routinely
// takes 20–40s, so this route requires Vercel Pro (or higher) in prod.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const DEFAULT_CHROMIUM_PACK =
  "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar";

const ZILLOW_HOST_RE = /(^|\.)zillow\.com$/i;

// Match any Zillow static-photo URL. We capture the hash (unique per
// photo) and the size suffix. We accept .jpg AND .webp because Zillow
// serves both, and we've also seen the size suffix vary — dedup by hash.
const PHOTO_URL_RE =
  /photos\.zillowstatic\.com\\?\/fp\\?\/([a-zA-Z0-9]+)-cc_ft_(\d+)\.(?:jpg|webp)/g;

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

// Stealth patches — quiet the loudest "I'm a headless bot" signals
// PerimeterX looks for. Not a full stealth plugin, but enough to get
// past the first-tier automated checks.
const STEALTH_INIT = `
(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  } catch {}
  try {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  } catch {}
  try {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'PDF Viewer' },
        { name: 'Chrome PDF Viewer' },
        { name: 'Chromium PDF Viewer' },
        { name: 'Microsoft Edge PDF Viewer' },
        { name: 'WebKit built-in PDF' },
      ],
    });
  } catch {}
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  } catch {}
  try {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  } catch {}
  try {
    window.chrome = window.chrome || { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  } catch {}
  try {
    const origQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (origQuery) {
      window.navigator.permissions.query = (params) =>
        params && params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(params);
    }
  } catch {}
  try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.apply(this, [parameter]);
    };
  } catch {}
})();
`;

async function launchBrowser(): Promise<Browser> {
  const isLocal = !process.env.VERCEL && !process.env.AWS_REGION;

  // Extra args that specifically defeat headless-detection. We add
  // these on top of whatever @sparticuz/chromium-min already ships.
  const stealthArgs = [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--no-default-browser-check",
  ];

  if (isLocal) {
    const localPath =
      process.env.CHROMIUM_EXECUTABLE_PATH ||
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      undefined;

    return await playwrightChromium.launch({
      headless: true,
      executablePath: localPath,
      args: stealthArgs,
    });
  }

  const packUrl = process.env.CHROMIUM_PACK_URL || DEFAULT_CHROMIUM_PACK;
  const executablePath = await chromium.executablePath(packUrl);

  return await playwrightChromium.launch({
    args: [...chromium.args, ...stealthArgs],
    executablePath,
    headless: true,
  });
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

async function extractPhotos(
  context: BrowserContext,
  targetUrl: string,
): Promise<{ hashes: string[]; addressSlug: string | null }> {
  const page = await context.newPage();
  const sink = new Map<string, PhotoRecord>();

  page.on("response", (response) => {
    const u = response.url();
    if (u.includes("photos.zillowstatic.com")) {
      ingestMatches(u, sink);
    }
  });

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });

  // Give PerimeterX + hydration a beat, then coax lazy-loaded galleries
  // by scrolling to the bottom, back up, and simulating a small mouse move.
  await page.waitForTimeout(4_000);
  await page.mouse.move(200, 300);
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" as ScrollBehavior }),
  );
  await page.waitForTimeout(2_000);
  await page.evaluate(() =>
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }),
  );
  await page.waitForTimeout(1_500);

  const html = await page.content();
  ingestMatches(html, sink);

  // Scan every script tag independently — some ship as raw JSON blobs
  // (__NEXT_DATA__, hdpApolloPreloadedData, hdpApolloState) that only
  // contain photo URLs inside stringified data with escaped slashes.
  const scriptTexts: string[] = await page
    .$$eval("script", (nodes) => nodes.map((n) => n.textContent || ""))
    .catch(() => []);
  for (const text of scriptTexts) {
    if (text.includes("photos.zillowstatic.com")) {
      ingestMatches(text, sink);
    }
  }

  // Best-effort: pull the listing address from JSON-LD if present.
  let addressSlug: string | null = null;
  try {
    addressSlug = await page.$$eval("script[type='application/ld+json']", (nodes) => {
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
    });
  } catch {}

  const hashes = Array.from(sink.values()).map((r) => r.hash);
  return { hashes, addressSlug };
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

  let browser: Browser | null = null;

  try {
    browser = await launchBrowser();
    const context = await browser.newContext({
      userAgent: DESKTOP_USER_AGENT,
      viewport: { width: 1400, height: 1000 },
      locale: "en-US",
      timezoneId: "America/Los_Angeles",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Ch-Ua":
          '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        "Upgrade-Insecure-Requests": "1",
      },
    });
    await context.addInitScript(STEALTH_INIT);

    const { hashes, addressSlug } = await extractPhotos(
      context,
      parsed.toString(),
    );

    if (hashes.length === 0) {
      return NextResponse.json(
        {
          error:
            "Zillow blocked this request — try again in a minute, or paste the URL again.",
        },
        { status: 502 },
      );
    }

    const photos = hashes.map(
      (h) => `https://photos.zillowstatic.com/fp/${h}-cc_ft_1536.jpg`,
    );

    let slug = slugFromUrl(parsed.toString());
    if (addressSlug) {
      const s = addressSlug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (s.length > 0) slug = s;
    }

    return NextResponse.json({
      photos,
      slug,
      sourceUrl: parsed.toString(),
    });
  } catch (err) {
    console.error("extract error:", err);
    return NextResponse.json(
      {
        error:
          "Zillow blocked this request — try again in a minute, or paste the URL again.",
      },
      { status: 502 },
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}
