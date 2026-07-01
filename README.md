# Sonder — Real Estate Downloader

A one-screen web tool that turns a Zillow listing URL into a zip of every
listing photo at max resolution. Built for feeding AI video generators
(Kling, Higgsfield, etc.).

- Next.js 14 (App Router) + TypeScript + Tailwind
- `playwright-core` + `@sparticuz/chromium-min` for serverless-friendly
  headless rendering (needed because Zillow uses PerimeterX bot detection)
- Stateless — no auth, no database, nothing kept server-side after each
  request

## How it works

`POST /api/extract` runs a **three-strategy pipeline**, first hit wins:

1. **Wayback Machine.** Query `archive.org/wayback/available` for the
   closest snapshot, then fetch the raw archived HTML via the `id_`
   identifier and regex out every `photos.zillowstatic.com/fp/<hash>`
   URL. Zero bot detection, no browser cold-start, works from anywhere.
   Photo hashes don't rotate, so archived hashes still resolve today.
2. **ZenRows** (only if `ZENROWS_API_KEY` env var is set on Vercel).
   Routes the request through residential/premium IPs with native
   PerimeterX bypass. Free tier is 1000 requests. This is the reliable
   path when Vercel's datacenter IP gets blocked.
3. **Playwright direct.** Boots `@sparticuz/chromium-min` on serverless
   with stealth patches and manual headers. Often blocked on Vercel's
   AWS IP by PerimeterX — kept as a last-resort fallback.

Whichever strategy returns hashes wins. Hashes are rebuilt at max
resolution (`cc_ft_1536`) and returned to the browser, which shows a
lazy-loaded thumbnail grid.

On **Download Archive (.zip)**, `POST /api/download` streams the photos
server-side into a zip named `<address-slug>.zip`. A `Referer` header
pointing at the original listing is sent with each image request so CDNs
don't refuse.

### The Vercel datacenter-IP problem

PerimeterX (now HUMAN) flags AWS/Vercel IP ranges aggressively, so even
perfect browser stealth often gets blocked. That's why Wayback is the
first strategy: it doesn't hit Zillow from your IP. For listings without
snapshots, add `ZENROWS_API_KEY` on Vercel to unlock the residential-IP
path — signup is free at https://app.zenrows.com/register.

## Local setup

```bash
npm install
cp .env.example .env.local   # optional overrides
npm run dev
```

Local dev uses whatever system Chromium you have. If Playwright can't
find one, either install a Chromium binary or set
`CHROMIUM_EXECUTABLE_PATH` in `.env.local` to point at one.

## Deploying to Vercel

> **Vercel Pro (or higher) is required.**
>
> Extraction routinely takes 20–40 seconds — headless browser boot plus
> the render/wait cycle. The Hobby tier caps serverless functions at
> 10 seconds, so you'll get timeouts on the extract route. Both API
> routes are configured with `maxDuration = 60` (`app/api/extract/route.ts`
> and `app/api/download/route.ts`); on Hobby, Vercel silently clamps this
> back to 10s and requests will fail.

Steps:

1. Push this repo to GitHub.
2. Import it into Vercel.
3. Confirm the project is on the **Pro** plan (or above).
4. Deploy. No env vars are required for defaults; override
   `CHROMIUM_PACK_URL` only if you want to pin/mirror the Chromium pack.

## Notes on scraping

- Zillow ships `photos.zillowstatic.com` URLs with a size suffix
  (`cc_ft_384`, `cc_ft_768`, `cc_ft_1152`, `cc_ft_1536`). The extractor
  dedupes by hash and rewrites every URL to `cc_ft_1536` for max
  resolution. Individual image files aren't bot-checked — only the
  listing page itself is.
- If extraction returns zero photos, the API responds with
  `"Zillow blocked this request — try again in a minute."` — usually a
  transient PerimeterX challenge. Retry, or wait a beat.
- No rate limiter is baked in beyond the frontend loading state that
  disables the submit button until the request finishes. This is a
  personal utility, not a public service.

## Project layout

```
app/
  page.tsx              # single-screen UI
  layout.tsx
  globals.css
  api/
    extract/route.ts    # headless-browser scrape → photo URL list
    download/route.ts   # fetches + streams a zip of photos
```

## License

Personal use. Respect Zillow's terms and use responsibly.
