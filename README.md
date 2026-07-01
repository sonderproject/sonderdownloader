# Sonder Real Estate Downloader

Paste a Zillow listing URL → get every photo at max resolution as a
single zip. Built for feeding AI video generators (Kling, Higgsfield).

## Setup (2 minutes, one-time)

Zillow is protected by PerimeterX, and Vercel's serverless functions
egress from AWS IPs that get blocked at the network layer. The only
reliable way to get through is via a scraping service — someone else's
residential-IP infra doing the anti-bot bypass. **ScrapingBee** has the
easiest signup and a generous free tier.

1. **Sign up free** at https://app.scrapingbee.com/register (1000
   free credits — plenty for personal use)
2. **Copy your API key** from the ScrapingBee dashboard
3. **On Vercel** → Project → Settings → Environment Variables → add
   `SCRAPINGBEE_API_KEY` = your key. Apply to Production.
4. **Redeploy** (or push any commit) and try a listing.

That's it. You're set.

### Alt scraping services

`SCRAPINGBEE_API_KEY` is the recommended one, but the extractor also
picks up `ZENROWS_API_KEY` (https://app.zenrows.com/register — 1000
free credits) or `SCRAPERAPI_KEY` (https://www.scraperapi.com/signup —
5000 free credits/month) if you'd rather use those.

## How it works

`POST /api/extract` runs a strategy pipeline, first hit wins:

1. **Wayback Machine (existing snapshot).** Free bonus round: if
   archive.org already has a snapshot of the listing, we regex the
   photo hashes out of it. Zillow hashes don't rotate, so archived
   hashes still resolve on `photos.zillowstatic.com` today. Works for
   popular listings; misses low-traffic ones.
2. **ScrapingBee → ZenRows → ScraperAPI.** Whichever key is set, we
   route the request through the service with `stealth_proxy=true` /
   `antibot=true`. Residential IP, real anti-bot bypass. This is the
   reliable path.

Whichever step returns photo hashes wins. Each hash is rebuilt at max
resolution (`cc_ft_1536`) and returned to the browser, which shows a
lazy-loaded thumbnail grid.

On **Download Archive (.zip)**, `POST /api/download` streams each photo
server-side into a zip named `<address-slug>.zip`. A `Referer` header
pointing at the original listing is sent with each image request so
CDNs don't refuse.

## Local dev

```bash
npm install
cp .env.example .env.local   # add your SCRAPINGBEE_API_KEY here
npm run dev
```

## Vercel deploy notes

- `/api/extract` and `/api/download` are both configured with
  `maxDuration = 60`. Vercel Hobby caps functions at 10s and silently
  clamps this back — you need **Vercel Pro** (or higher) for the
  timeouts to actually apply. The extract call can take 10–30s during
  the anti-bot round trip.
- No Chromium binary or heavy deps to bundle — this used to try running
  headless Chromium on Vercel via `@sparticuz/chromium-min` and it was
  a nightmare (fragile launch, IP blocks anyway). The scraping-service
  path is far simpler and actually works.

## Project layout

```
app/
  page.tsx              # one-screen UI (sonderproject.co design tokens)
  layout.tsx
  globals.css
  api/
    extract/route.ts    # strategy pipeline → returns photo URLs
    download/route.ts   # fetches + streams zip of photos
```
