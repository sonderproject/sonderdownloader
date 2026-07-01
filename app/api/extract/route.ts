import { NextRequest, NextResponse } from "next/server";
import chromium from "@sparticuz/chromium-min";
import { chromium as playwrightChromium, type Browser } from "playwright-core";

export const runtime = "nodejs";
// NOTE: Vercel Hobby caps serverless functions at 10s. Extraction with a
// headless browser round trip typically needs 20–40s, so this project
// requires Vercel Pro (or higher) to run reliably in production.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Remote-hosted Chromium pack matching @sparticuz/chromium-min v131.
// Overridable via CHROMIUM_PACK_URL for pinning / regional mirrors.
const DEFAULT_CHROMIUM_PACK =
  "https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar";

const ZILLOW_HOST_RE = /(^|\.)zillow\.com$/i;
const PHOTO_URL_RE =
  /https:\/\/photos\.zillowstatic\.com\/fp\/([a-zA-Z0-9]+)-cc_ft_\d+\.jpg/g;

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function slugFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const match = u.pathname.match(/\/homedetails\/([^/]+)/i);
    const raw = match?.[1] ?? u.pathname.split("/").filter(Boolean).pop() ?? "listing";
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "listing";
  } catch {
    return "listing";
  }
}

async function launchBrowser(): Promise<Browser> {
  const isLocal = !process.env.VERCEL && !process.env.AWS_REGION;

  if (isLocal) {
    // Local dev: try to use whatever system Chromium exists.
    const localPath =
      process.env.CHROMIUM_EXECUTABLE_PATH ||
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      undefined;

    return await playwrightChromium.launch({
      headless: true,
      executablePath: localPath,
    });
  }

  const packUrl = process.env.CHROMIUM_PACK_URL || DEFAULT_CHROMIUM_PACK;
  const executablePath = await chromium.executablePath(packUrl);

  return await playwrightChromium.launch({
    args: chromium.args,
    executablePath,
    headless: true,
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
    });
    const page = await context.newPage();

    await page.goto(parsed.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    // Give PerimeterX + hydration a moment, then trigger lazy loads.
    await page.waitForTimeout(4_000);
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await page.waitForTimeout(1_500);

    const html = await page.content();

    const hashes = new Set<string>();
    const orderedHashes: string[] = [];
    for (const match of html.matchAll(PHOTO_URL_RE)) {
      const hash = match[1];
      if (!hashes.has(hash)) {
        hashes.add(hash);
        orderedHashes.push(hash);
      }
    }

    const photos = orderedHashes.map(
      (hash) => `https://photos.zillowstatic.com/fp/${hash}-cc_ft_1536.jpg`,
    );

    if (photos.length === 0) {
      return NextResponse.json(
        { error: "Zillow blocked this request — try again in a minute." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      photos,
      slug: slugFromUrl(parsed.toString()),
      sourceUrl: parsed.toString(),
    });
  } catch (err) {
    console.error("extract error:", err);
    return NextResponse.json(
      { error: "Zillow blocked this request — try again in a minute." },
      { status: 502 },
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}
