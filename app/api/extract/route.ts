import { NextRequest, NextResponse } from "next/server";
import chromiumPack from "@sparticuz/chromium-min";
import {
  chromium as playwrightChromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";

export const runtime = "nodejs";
// Vercel Hobby caps at 10s; extraction (browser boot + render + waits)
// routinely takes 20–40s. Vercel Pro is required in production.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const DEFAULT_CHROMIUM_PACK =
  "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar";

const ZILLOW_HOST_RE = /(^|\.)zillow\.com$/i;

// The photo hash is the only durable ID; the size suffix is
// interchangeable. Zillow never rotates hashes, so archived pages'
// hashes still resolve today.
const PHOTO_URL_RE =
  /photos\.zillowstatic\.com\\?\/fp\\?\/([a-zA-Z0-9]{8,})-cc_ft_\d+\.(?:jpg|webp)/g;

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CHALLENGE_MARKERS = [
  "px-captcha",
  "perimeterx",
  "captcha-delivery",
  "Please verify you are a human",
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

function collectHashes(source: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const m of source.matchAll(PHOTO_URL_RE)) {
    const h = m[1];
    if (!seen.has(h)) {
      seen.add(h);
      ordered.push(h);
    }
  }
  return ordered;
}

// ─── STRATEGY 1: Wayback Machine ────────────────────────────────────
// Zero bot detection. Photo hashes in the archived HTML still resolve
// on photos.zillowstatic.com today because Zillow doesn't rotate them.
async function tryWayback(
  targetUrl: string,
): Promise<{ hashes: string[]; note: string }> {
  const availUrl =
    "https://archive.org/wayback/available?url=" + encodeURIComponent(targetUrl);
  const availRes = await fetch(availUrl, {
    headers: { "User-Agent": DESKTOP_USER_AGENT },
    signal: AbortSignal.timeout(8_000),
  });
  if (!availRes.ok) return { hashes: [], note: "avail-http-" + availRes.status };
  const avail = (await availRes.json()) as {
    archived_snapshots?: { closest?: { available: boolean; url?: string; timestamp?: string } };
  };
  const closest = avail?.archived_snapshots?.closest;
  if (!closest?.available || !closest.timestamp) {
    return { hashes: [], note: "no-snapshot" };
  }

  // "id_" identifier delivers the raw archived response (unwrapped by
  // archive.org's toolbar frame), so photo URLs sit in the HTML clean.
  const rawUrl = `https://web.archive.org/web/${closest.timestamp}id_/${targetUrl}`;
  const rawRes = await fetch(rawUrl, {
    headers: { "User-Agent": DESKTOP_USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!rawRes.ok) return { hashes: [], note: "raw-http-" + rawRes.status };
  const html = await rawRes.text();
  const hashes = collectHashes(html);
  return { hashes, note: `wayback-${closest.timestamp}` };
}

// ─── STRATEGY 2: ZenRows (only if API key set) ─────────────────────
// Residential/premium proxy + native anti-bot bypass. ZenRows advertises
// PerimeterX bypass explicitly. Free tier: 1000 requests. Set
// ZENROWS_API_KEY on Vercel to enable.
async function tryZenRows(
  targetUrl: string,
): Promise<{ hashes: string[]; note: string }> {
  const key = process.env.ZENROWS_API_KEY;
  if (!key) return { hashes: [], note: "no-key" };

  const params = new URLSearchParams({
    url: targetUrl,
    apikey: key,
    js_render: "true",
    premium_proxy: "true",
    antibot: "true",
    wait: "4000",
  });
  const res = await fetch(
    "https://api.zenrows.com/v1/?" + params.toString(),
    { signal: AbortSignal.timeout(45_000) },
  );
  if (!res.ok) return { hashes: [], note: "zenrows-http-" + res.status };
  const html = await res.text();
  return { hashes: collectHashes(html), note: "zenrows" };
}

// ─── STRATEGY 3: Playwright with manual stealth ────────────────────
// The last-resort direct scrape. Loud on datacenter IPs but sometimes
// works — especially outside peak PerimeterX challenge periods.
const STEALTH_INIT = `
(() => {
  try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch {}
  try { Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] }); } catch {}
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
  try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }); } catch {}
  try { Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 }); } catch {}
  try {
    window.chrome = window.chrome || { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  } catch {}
  try {
    const q = window.navigator.permissions && window.navigator.permissions.query;
    if (q) {
      window.navigator.permissions.query = (p) =>
        p && p.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : q(p);
    }
  } catch {}
  try {
    const gp = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p) {
      if (p === 37445) return 'Intel Inc.';
      if (p === 37446) return 'Intel Iris OpenGL Engine';
      return gp.apply(this, [p]);
    };
  } catch {}
})();
`;

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
    return playwrightChromium.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_EXECUTABLE_PATH ||
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        undefined,
      args: stealthArgs,
    });
  }

  const packUrl = process.env.CHROMIUM_PACK_URL || DEFAULT_CHROMIUM_PACK;
  const executablePath = await chromiumPack.executablePath(packUrl);
  return playwrightChromium.launch({
    args: [...chromiumPack.args, ...stealthArgs],
    executablePath,
    headless: true,
  });
}

function contextOptions(): Parameters<Browser["newContext"]>[0] {
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

async function scrapeWithPage(
  ctx: BrowserContext,
  targetUrl: string,
): Promise<{ hashes: string[]; blocked: boolean }> {
  const page: Page = await ctx.newPage();
  const seen = new Set<string>();

  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("photos.zillowstatic.com")) {
      for (const m of u.matchAll(PHOTO_URL_RE)) seen.add(m[1]);
    }
  });

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForTimeout(3_500);
  try {
    await page.mouse.move(220, 340, { steps: 8 });
    await page.mouse.move(520, 260, { steps: 12 });
  } catch {}
  await page
    .waitForLoadState("networkidle", { timeout: 12_000 })
    .catch(() => undefined);
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" as ScrollBehavior }),
  );
  await page.waitForTimeout(2_000);
  await page.evaluate(() =>
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }),
  );
  await page.waitForTimeout(1_200);

  const html = await page.content();
  const blocked = CHALLENGE_MARKERS.some((m) => html.includes(m));
  for (const h of collectHashes(html)) seen.add(h);

  const scriptTexts = await page
    .$$eval("script", (ns) => ns.map((n) => n.textContent || ""))
    .catch(() => []);
  for (const t of scriptTexts) {
    if (t.includes("photos.zillowstatic.com")) {
      for (const h of collectHashes(t)) seen.add(h);
    }
  }

  await page.close().catch(() => undefined);
  return { hashes: Array.from(seen), blocked };
}

async function tryPlaywright(
  targetUrl: string,
): Promise<{ hashes: string[]; note: string }> {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const ctx = await browser.newContext(contextOptions());
    await ctx.addInitScript(STEALTH_INIT);
    const first = await scrapeWithPage(ctx, targetUrl);
    await ctx.close().catch(() => undefined);
    if (first.hashes.length > 0) {
      return { hashes: first.hashes, note: "playwright" };
    }
    return {
      hashes: [],
      note: first.blocked ? "playwright-blocked" : "playwright-empty",
    };
  } catch (err) {
    console.error("playwright error:", err);
    return { hashes: [], note: "playwright-error" };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

async function handle(rawUrl: string | undefined) {
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
  for (const k of Array.from(parsed.searchParams.keys())) {
    if (k.startsWith("utm_") || k === "fbclid" || k === "gclid") {
      parsed.searchParams.delete(k);
    }
  }
  const target = parsed.toString();

  const notes: string[] = [];

  // 1. Wayback — fastest, most reliable, no bot check.
  try {
    const r = await tryWayback(target);
    notes.push(r.note);
    if (r.hashes.length > 0) {
      return respond(r.hashes, target, notes);
    }
  } catch (err) {
    console.warn("wayback failed:", err);
    notes.push("wayback-throw");
  }

  // 2. ZenRows if key set.
  try {
    const r = await tryZenRows(target);
    if (r.note !== "no-key") notes.push(r.note);
    if (r.hashes.length > 0) {
      return respond(r.hashes, target, notes);
    }
  } catch (err) {
    console.warn("zenrows failed:", err);
    notes.push("zenrows-throw");
  }

  // 3. Playwright direct — the last resort. Often blocked on Vercel IPs.
  try {
    const r = await tryPlaywright(target);
    notes.push(r.note);
    if (r.hashes.length > 0) {
      return respond(r.hashes, target, notes);
    }
  } catch (err) {
    console.warn("playwright throw:", err);
    notes.push("playwright-throw");
  }

  console.error("all strategies failed:", notes.join(","));
  return NextResponse.json(
    {
      error:
        "Zillow blocked this request and no fallback found photos. Try again in a minute, or set a ZENROWS_API_KEY on Vercel for a residential-IP path.",
      strategies: notes,
    },
    { status: 502 },
  );
}

function respond(hashes: string[], target: string, notes: string[]) {
  const photos = hashes.map(
    (h) => `https://photos.zillowstatic.com/fp/${h}-cc_ft_1536.jpg`,
  );
  console.log(`extract ok via ${notes[notes.length - 1]}: ${photos.length} photos`);
  return NextResponse.json({
    photos,
    slug: slugFromUrl(target),
    sourceUrl: target,
    strategies: notes,
  });
}

export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  return handle(body.url?.trim());
}

// GET is accepted only for ergonomic testing / linkable debug via
// `?url=<encoded zillow url>`. No side effects; same output as POST.
export async function GET(req: NextRequest) {
  return handle(req.nextUrl.searchParams.get("url") ?? undefined);
}
