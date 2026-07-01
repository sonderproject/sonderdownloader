# Sonder Real Estate Downloader

Paste a Zillow listing → get every photo at max resolution as a zip.
Built for feeding AI video generators (Kling, Higgsfield).

## The two flows

Zillow blocks server-side scrapers by IP. Your browser doesn't get
blocked — so the extraction happens in your browser instead.

### 1. Paste HTML (works everywhere, no setup)

1. Open the Zillow listing in a normal browser tab
2. Right-click → **View Page Source** (or Ctrl/Cmd + U)
3. Select all → copy → paste into the "Paste HTML" box on this app
4. Click **Extract Photos**, then **Download Archive**

The tool regexes photo URLs client-side and rebuilds them at max
resolution (`cc_ft_1536`). Zip generation happens server-side because
the `photos.zillowstatic.com` CDN is unprotected — that hop is fine.

### 2. Bookmarklet (one click on any Zillow tab)

Drag the **"↴ Sonder — Zillow Photos"** button from the app to your
bookmarks bar. On any Zillow listing, click the bookmark — a new tab
opens with all photos already extracted and ready to download.

### 3. URL fallback

Type/paste a Zillow URL. This tries `POST /api/extract`, which walks a
strategy pipeline (Wayback snapshot → scraping service if a key is
set). Often blocked by PerimeterX on Vercel's IPs; kept only as a
fallback for users who set up a service key.

## Zip download

`POST /api/download` fetches each photo server-side and streams a
`<address-slug>.zip`. A `Referer` header pointing at the listing is
sent so the CDN doesn't refuse. This works fine even without any API
key because `photos.zillowstatic.com` is a plain CDN.

## Local dev

```bash
npm install
npm run dev
```

Open http://localhost:3000. Both Paste and Bookmarklet flows work
locally with zero configuration.

## Deploying on Vercel

- Push to GitHub, import into Vercel.
- Both API routes are set to `maxDuration = 60`. Vercel Hobby caps
  serverless functions at 10s and silently clamps this — the URL
  fallback needs Vercel Pro to work reliably. The Paste and Bookmarklet
  flows are unaffected because their extraction runs in the browser;
  they only touch `/api/download`, which finishes in a few seconds.

## Project layout

```
app/
  page.tsx              # single-screen UI (Paste / URL tabs + bookmarklet)
  layout.tsx
  globals.css           # sonderproject.co design tokens
  api/
    extract/route.ts    # URL fallback pipeline (Wayback + scraping svc)
    download/route.ts   # fetches + streams the zip
```
