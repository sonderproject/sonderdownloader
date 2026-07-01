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

1. You paste a Zillow listing URL.
2. `POST /api/extract` renders the page in a real headless Chromium,
   waits for lazy-loaded photo elements, and pulls every URL matching
   `photos.zillowstatic.com/fp/<hash>-cc_ft_<n>.jpg`.
3. Each hash is rebuilt at max resolution (`cc_ft_1536`) and returned to
   the browser. The frontend shows a lazy-loaded thumbnail grid.
4. On **Download All (.zip)**, `POST /api/download` streams the photos
   server-side into a zip named `<address-slug>.zip`. A `Referer` header
   pointing at the original listing is sent with each image request so
   CDNs don't refuse.

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
