// Multi-site listing extraction. Each source knows how to find its
// CDN photo URLs in raw page source, rebuild them at max resolution,
// and recover the listing's slug + canonical URL.
//
// Runs client-side on pasted page source — same trick as the original
// Zillow flow: the user's browser already got past the bot wall, we
// just regex what it saw.

export type SourceKey = "zillow" | "redfin" | "realtor";

export const SOURCE_LABEL: Record<SourceKey, string> = {
  zillow: "Zillow",
  redfin: "Redfin",
  realtor: "Realtor.com",
};

export type ExtractedListing = {
  source: SourceKey;
  photos: string[]; // full-res photo URLs, deduped, in page order
  slug: string;
  sourceUrl?: string;
};

function dedupe(urls: string[]): string[] {
  return Array.from(new Set(urls));
}

function sanitizeSlug(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "listing"
  );
}

function extractZillow(html: string): ExtractedListing | null {
  const re =
    /photos\.zillowstatic\.com\/fp\/([a-zA-Z0-9]{8,})-cc_ft_\d+\.(?:jpg|webp)/g;
  const seen = new Set<string>();
  const photos: string[] = [];
  for (const m of html.matchAll(re)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      photos.push(`https://photos.zillowstatic.com/fp/${m[1]}-cc_ft_1536.jpg`);
    }
  }
  if (photos.length === 0) return null;

  const slugM = html.match(/\/homedetails\/([a-zA-Z0-9-]+)/);
  const srcM = html.match(/\/homedetails\/([a-zA-Z0-9-]+)\/(\d+)_zpid/);
  return {
    source: "zillow",
    photos,
    slug: slugM ? sanitizeSlug(slugM[1]) : "listing",
    sourceUrl: srcM
      ? `https://www.zillow.com/homedetails/${srcM[1]}/${srcM[2]}_zpid/`
      : undefined,
  };
}

function extractRedfin(html: string): ExtractedListing | null {
  // Redfin's full-size photos live under /photo/<mls>/bigphoto/…
  const re =
    /https:\/\/ssl\.cdn-redfin\.com\/photo\/\d+\/bigphoto\/[A-Za-z0-9_./-]+\.jpg/gi;
  const photos = dedupe(Array.from(html.matchAll(re), (m) => m[0]));
  if (photos.length === 0) return null;

  const canonical = html.match(
    /https:\/\/www\.redfin\.com\/[A-Z]{2}\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/home\/\d+/,
  );
  let slug = "listing";
  if (canonical) {
    const segs = new URL(canonical[0]).pathname.split("/").filter(Boolean);
    // /CA/San-Diego/123-Main-St-92101/home/12345 → address segment
    if (segs.length >= 3) slug = sanitizeSlug(segs[2]);
  }
  return {
    source: "redfin",
    photos,
    slug,
    sourceUrl: canonical ? canonical[0] : undefined,
  };
}

function extractRealtor(html: string): ExtractedListing | null {
  // rdcpix URLs end in -m<photoId><size-letters>[-w…_h…].jpg; the
  // "od" size suffix is the original upload.
  const re =
    /https:\/\/[a-z0-9-]+\.rdcpix\.com\/[A-Za-z0-9_/-]+?-m(\d+)[a-z]{1,3}(?:-w\d+_h\d+(?:_q\d+)?)?\.jpg/gi;
  const seen = new Set<string>();
  const photos: string[] = [];
  for (const m of html.matchAll(re)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    photos.push(
      m[0].replace(
        /-m(\d+)[a-z]{1,3}(?:-w\d+_h\d+(?:_q\d+)?)?\.jpg$/i,
        "-m$1od.jpg",
      ),
    );
  }
  if (photos.length === 0) return null;

  const canonical = html.match(
    /https:\/\/www\.realtor\.com\/realestateandhomes-detail\/([A-Za-z0-9_-]+)/,
  );
  return {
    source: "realtor",
    photos,
    slug: canonical ? sanitizeSlug(canonical[1]) : "listing",
    sourceUrl: canonical ? canonical[0] : undefined,
  };
}

// Detect which listing site the pasted source came from and extract.
// If a page somehow matches several sources, the one with the most
// photos wins — that's the listing's own gallery.
export function extractListing(raw: string): ExtractedListing | null {
  // Photo URLs inside embedded JSON have escaped slashes.
  const html = raw.replace(/\\\//g, "/");
  const candidates = [
    extractZillow(html),
    extractRedfin(html),
    extractRealtor(html),
  ].filter((c): c is ExtractedListing => c !== null);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.photos.length - a.photos.length);
  return candidates[0];
}
