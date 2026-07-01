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

// Listing facts scraped from embedded JSON/JSON-LD. Everything is a
// display string and everything is optional — extraction is
// best-effort and the UI lets the user edit each field.
export type ListingFacts = {
  address?: string;
  price?: string;
  beds?: string;
  baths?: string;
  sqft?: string;
  description?: string;
};

export type ExtractedListing = {
  source: SourceKey;
  photos: string[]; // full-res photo URLs, deduped, in page order
  slug: string;
  sourceUrl?: string;
  facts: ListingFacts;
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

function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/\\n/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\s+/g, " ")
    .trim();
}

// Best-effort listing facts from the embedded JSON all three sites
// ship (JSON-LD and/or their own state blobs). Field names differ per
// site, so each fact tries a small set of known keys. Every value is
// sanity-checked; anything that doesn't parse is simply omitted and
// the user can fill it in by hand.
function extractFacts(html: string, slug: string): ListingFacts {
  const facts: ListingFacts = {};

  const street = html.match(/"streetAddress"\s*:\s*"([^"]{3,80})"/);
  const city = html.match(/"addressLocality"\s*:\s*"([^"]{2,40})"/);
  const region = html.match(/"addressRegion"\s*:\s*"([A-Z]{2})"/);
  const zip = html.match(/"postalCode"\s*:\s*"(\d{5}(?:-\d{4})?)"/);
  if (street) {
    facts.address = [
      unescapeJsonString(street[1]),
      city ? unescapeJsonString(city[1]) : undefined,
      [region?.[1], zip?.[1]].filter(Boolean).join(" ") || undefined,
    ]
      .filter(Boolean)
      .join(", ");
  } else if (slug !== "listing") {
    facts.address = titleCaseSlug(slug);
  }

  const price = html.match(
    /"(?:price|listPrice|priceValue)"\s*:\s*"?\$?([\d,]{4,12})(?:\.\d+)?"?/i,
  );
  if (price) {
    const n = Number(price[1].replace(/,/g, ""));
    if (n >= 10_000 && n <= 500_000_000) {
      facts.price = `$${n.toLocaleString("en-US")}`;
    }
  }

  const beds = html.match(
    /"(?:bedrooms|beds|numBedrooms)"\s*:\s*"?(\d{1,2})(?:\.\d+)?"?/i,
  );
  if (beds && Number(beds[1]) > 0) facts.beds = beds[1];

  const baths = html.match(
    /"(?:bathrooms|baths|bathsTotal|numBathrooms)"\s*:\s*"?(\d{1,2}(?:\.\d+)?)"?/i,
  );
  if (baths && Number(baths[1]) > 0) facts.baths = baths[1];

  const sqft = html.match(
    /"(?:livingArea|livingAreaValue|sqFt|squareFootage|floorSize)"\s*:\s*"?([\d,]{3,7})"?/i,
  );
  if (sqft) {
    const n = Number(sqft[1].replace(/,/g, ""));
    if (n >= 100 && n <= 100_000) facts.sqft = n.toLocaleString("en-US");
  }

  const desc = html.match(/"description"\s*:\s*"((?:[^"\\]|\\.){60,2000}?)"/);
  if (desc) {
    const text = unescapeJsonString(desc[1]);
    // Reject blobs that are clearly markup or JSON, not prose.
    if (!/[<{}]/.test(text.slice(0, 120))) {
      facts.description = text.slice(0, 600);
    }
  }

  return facts;
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
  const slug = slugM ? sanitizeSlug(slugM[1]) : "listing";
  return {
    source: "zillow",
    photos,
    slug,
    sourceUrl: srcM
      ? `https://www.zillow.com/homedetails/${srcM[1]}/${srcM[2]}_zpid/`
      : undefined,
    facts: extractFacts(html, slug),
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
    facts: extractFacts(html, slug),
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
  const slug = canonical ? sanitizeSlug(canonical[1]) : "listing";
  return {
    source: "realtor",
    photos,
    slug,
    sourceUrl: canonical ? canonical[0] : undefined,
    facts: extractFacts(html, slug),
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
