import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ZILLOW_HOST_RE = /(^|\.)zillow\.com$/i;

// Photo hash is the durable ID; size suffix is interchangeable.
// Zillow never rotates hashes, so archived hashes still resolve today.
const PHOTO_URL_RE =
  /photos\.zillowstatic\.com\\?\/fp\\?\/([a-zA-Z0-9]{8,})-cc_ft_\d+\.(?:jpg|webp)/g;

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

function collectHashes(source: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const m of source.matchAll(PHOTO_URL_RE)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      ordered.push(m[1]);
    }
  }
  return ordered;
}

// ─── STRATEGY 1: Wayback Machine — existing snapshot ──────────────
async function tryWaybackExisting(target: string) {
  const availRes = await fetch(
    "https://archive.org/wayback/available?url=" + encodeURIComponent(target),
    {
      headers: { "User-Agent": DESKTOP_USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!availRes.ok) return { hashes: [], note: `avail-${availRes.status}` };
  const avail = (await availRes.json()) as {
    archived_snapshots?: {
      closest?: { available: boolean; url?: string; timestamp?: string };
    };
  };
  const closest = avail?.archived_snapshots?.closest;
  if (!closest?.available || !closest.timestamp) {
    return { hashes: [], note: "no-snapshot" };
  }
  const rawUrl = `https://web.archive.org/web/${closest.timestamp}id_/${target}`;
  const rawRes = await fetch(rawUrl, {
    headers: { "User-Agent": DESKTOP_USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!rawRes.ok) return { hashes: [], note: `raw-${rawRes.status}` };
  const html = await rawRes.text();
  return { hashes: collectHashes(html), note: `wayback-${closest.timestamp}` };
}

// ─── STRATEGY 2: ScrapingBee — the actually-works path ────────────
// Free tier: 1000 credits. Sign up at https://app.scrapingbee.com/register
// Set SCRAPINGBEE_API_KEY on Vercel. `stealth_proxy=true` routes through
// residential IPs with anti-bot bypass — this is what actually gets past
// PerimeterX on Zillow.
async function tryScrapingBee(target: string) {
  const key = process.env.SCRAPINGBEE_API_KEY;
  if (!key) return { hashes: [], note: "scrapingbee-no-key" };

  const params = new URLSearchParams({
    api_key: key,
    url: target,
    render_js: "true",
    premium_proxy: "true",
    stealth_proxy: "true",
    country_code: "us",
    wait: "3000",
  });
  const res = await fetch("https://app.scrapingbee.com/api/v1/?" + params, {
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("scrapingbee non-ok:", res.status, body.slice(0, 200));
    return { hashes: [], note: `scrapingbee-${res.status}` };
  }
  const html = await res.text();
  return { hashes: collectHashes(html), note: "scrapingbee" };
}

// ─── STRATEGY 3: ZenRows — alt scraping service ────────────────────
// Free tier: 1000 credits. Sign up at https://app.zenrows.com/register
// Set ZENROWS_API_KEY. Also advertises PerimeterX bypass.
async function tryZenRows(target: string) {
  const key = process.env.ZENROWS_API_KEY;
  if (!key) return { hashes: [], note: "zenrows-no-key" };

  const params = new URLSearchParams({
    url: target,
    apikey: key,
    js_render: "true",
    premium_proxy: "true",
    antibot: "true",
    wait: "3000",
  });
  const res = await fetch("https://api.zenrows.com/v1/?" + params, {
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("zenrows non-ok:", res.status, body.slice(0, 200));
    return { hashes: [], note: `zenrows-${res.status}` };
  }
  const html = await res.text();
  return { hashes: collectHashes(html), note: "zenrows" };
}

// ─── STRATEGY 4: ScraperAPI — another alt ──────────────────────────
async function tryScraperAPI(target: string) {
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) return { hashes: [], note: "scraperapi-no-key" };

  const params = new URLSearchParams({
    api_key: key,
    url: target,
    render: "true",
    premium: "true",
    country_code: "us",
  });
  const res = await fetch("https://api.scraperapi.com/?" + params, {
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("scraperapi non-ok:", res.status, body.slice(0, 200));
    return { hashes: [], note: `scraperapi-${res.status}` };
  }
  const html = await res.text();
  return { hashes: collectHashes(html), note: "scraperapi" };
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

  // Attempted in order, first hit wins.
  const strategies = [tryWaybackExisting, tryScrapingBee, tryZenRows, tryScraperAPI];
  for (const s of strategies) {
    try {
      const r = await s(target);
      notes.push(r.note);
      if (r.hashes.length > 0) return respond(r.hashes, target, notes);
    } catch (err) {
      console.warn(`${s.name} threw:`, err);
      notes.push(`${s.name}-throw`);
    }
  }

  const hasAnyKey =
    !!process.env.SCRAPINGBEE_API_KEY ||
    !!process.env.ZENROWS_API_KEY ||
    !!process.env.SCRAPERAPI_KEY;

  console.error("all strategies failed:", notes.join(","));
  return NextResponse.json(
    {
      error: hasAnyKey
        ? "The scraping service could not fetch this listing. It may be rate-limited or the URL may be invalid."
        : "This listing has no Wayback snapshot, and no scraping-service API key is set. Add SCRAPINGBEE_API_KEY to your Vercel project (free tier: 1000 requests — sign up at scrapingbee.com/register).",
      needsApiKey: !hasAnyKey,
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
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }
  return handle(body.url?.trim());
}

export async function GET(req: NextRequest) {
  return handle(req.nextUrl.searchParams.get("url") ?? undefined);
}
