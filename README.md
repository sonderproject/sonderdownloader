# Sonder Real Estate Downloader

Paste a listing from **Zillow, Redfin, or Realtor.com** → get every
photo at max resolution as a zip, auto-labeled by room, ordered into a
walkthrough, with AI-video prompts included. Built for feeding AI
video generators (Kling, Higgsfield, Runway).

## The three flows

Listing sites block server-side scrapers by IP. Your browser doesn't
get blocked — so the extraction happens in your browser instead. You
can also skip extraction entirely and upload your own photos.

### 1. Paste HTML (works everywhere, no setup)

1. Open the listing in a normal browser tab
2. Right-click → **View Page Source** (or Ctrl/Cmd + U)
3. Select all → copy → paste **anywhere on this app's page**

Extraction runs the instant you paste — a confirmation flash shows the
photo count and the grid scrolls into view. The app auto-detects the
source site (`lib/sources.ts`): Zillow photos are rebuilt at
`cc_ft_1536`, Redfin at `bigphoto`, Realtor.com at the `od` original
rendition. A bare Zillow URL pasted instead of source is routed to the
URL fallback pipeline. The listing's canonical URL is also pulled from
the source so the zip's `Referer` points at the real listing.

A server-side fallback ladder retries smaller renditions for photos
that don't exist at max size — nothing gets silently dropped.

### 2. Bookmarklet (one click on any Zillow tab)

Drag the **"↴ Sonder — Zillow Photos"** button from the app to your
bookmarks bar. On any Zillow listing, click the bookmark — a new tab
opens with all photos already extracted, plus the listing URL so the
zip download sends an accurate `Referer`.

### 3. URL fallback

Type/paste a Zillow URL. This tries `POST /api/extract`, which walks a
strategy pipeline (Wayback snapshot → scraping service if a key is
set). Often blocked by PerimeterX on Vercel's IPs; kept only as a
fallback for users who set up a service key.

### 3. Upload your own photos

Bring photos you already have — the upload card on the landing page
(or "Add Photos" on an existing set) pulls them into the same
pipeline: classify, video, cover, captions, simulator. Uploads are
`blob:` object URLs that never leave the browser; they're excluded
from session/history persistence since they can't survive a reload.

## Property Simulator (staging)

"Send to Simulator" stages the current photo set + listing facts in
`sessionStorage` and opens `/simulator`, where photos can be
included/excluded per-click. The simulation engine itself plugs into
`lib/simulator.ts` (`SIMULATOR_PROMPT` + `runSimulation()`) — the
page's Generate button is already wired to it and self-enables once
a prompt is configured.

## The production kit

- **Classify & Sort** — one click runs in-browser CLIP over every
  photo (~150 MB model, one-time download, cached in IndexedDB),
  labels each room, and drops the set straight into canonical
  walkthrough order.
- **× to remove junk** — floor plans, plat maps, duplicate angles.
  Removals are undoable until the next extraction and excluded from
  the zip and video.
- **Room-labeled zip** — files are named `03_kitchen.jpg` once
  classified, and every zip includes a `prompts.txt` pairing each
  photo with its Kling/Higgsfield/Runway camera-move prompt.
- **Recent listings** — the last 8 extracted listings (order + labels
  included) live in `localStorage`; one click flips between
  properties.

## Zip download

The zip is assembled **in the browser** (fflate): uploaded photos are
read directly, CDN photos come through `/api/img` (which owns the
Referer + size-ladder logic, validated against the allowlist in
`lib/photoHosts.ts`). Includes `prompts.txt`, `captions.txt`, and
`listing.txt`. Client-side assembly means no serverless time limit —
big listings zip fine on Vercel Hobby. (`POST /api/download` remains
as a server-side fallback endpoint.)

## Other seamlessness details

- **Session restore** — photos, drag order, and room labels persist in
  `sessionStorage`, so an accidental refresh doesn't lose your work.
- **`/api/img` proxy** — thumbnails fall back to it when a size is
  missing, and the Ken-Burns renderer and classifier load all frames
  through it so canvas pixel access never hits a CORS wall.
- The bookmarklet is Zillow-only for now; Redfin and Realtor.com go
  through the paste flow.

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
    download/route.ts   # fetches + streams the zip (+ prompts.txt)
    img/route.ts        # same-origin image proxy (CORS + size ladder)
lib/
  sources.ts            # multi-site extraction (Zillow/Redfin/Realtor)
  photoHosts.ts         # server-side CDN allowlist + Referer + ladders
  rooms.ts              # room taxonomy, walkthrough order, prompts
  classify.ts           # in-browser CLIP zero-shot room classifier
  video.ts              # Ken-Burns canvas/MediaRecorder renderer
```
