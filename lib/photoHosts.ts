// Server-side allowlist of listing-photo CDNs. Both /api/download and
// /api/img validate every URL against these rules so neither route can
// be used as an open proxy. Each rule carries the Referer its CDN
// expects and a candidate ladder to try when the requested size is
// missing.

export type PhotoHostRule = {
  // The photo URL must match this exactly.
  urlRe: RegExp;
  // Listing-site origin; a client-supplied sourceUrl is only used as
  // Referer when it matches.
  siteRe: RegExp;
  fallbackReferer: string;
  candidates: (url: string) => string[];
};

const ZILLOW_SIZES = ["cc_ft_1536", "cc_ft_960", "cc_ft_576"];

export const PHOTO_HOST_RULES: PhotoHostRule[] = [
  {
    urlRe:
      /^https:\/\/photos\.zillowstatic\.com\/fp\/[a-zA-Z0-9]+-cc_ft_\d+\.(?:jpg|webp)$/,
    siteRe: /^https:\/\/(www\.)?zillow\.com\//i,
    fallbackReferer: "https://www.zillow.com/",
    // Not every photo exists at cc_ft_1536 — walk down the ladder.
    candidates: (url) => [
      url,
      ...ZILLOW_SIZES.map((s) => url.replace(/cc_ft_\d+/, s)),
    ],
  },
  {
    urlRe:
      /^https:\/\/ssl\.cdn-redfin\.com\/photo\/\d+\/bigphoto\/[A-Za-z0-9_./-]+\.jpg$/i,
    siteRe: /^https:\/\/(www\.)?redfin\.com\//i,
    fallbackReferer: "https://www.redfin.com/",
    candidates: (url) => [url],
  },
  {
    urlRe: /^https:\/\/[a-z0-9-]+\.rdcpix\.com\/[A-Za-z0-9_/-]+\.jpg$/i,
    siteRe: /^https:\/\/(www\.)?realtor\.com\//i,
    fallbackReferer: "https://www.realtor.com/",
    // If the original ("od") upload is gone, fall back to the standard
    // large rendition.
    candidates: (url) => [url, url.replace(/-m(\d+)od\.jpg$/i, "-m$1s.jpg")],
  },
];

export function ruleForPhotoUrl(url: string): PhotoHostRule | null {
  return PHOTO_HOST_RULES.find((r) => r.urlRe.test(url)) ?? null;
}

export function refererFor(rule: PhotoHostRule, sourceUrl?: string): string {
  return sourceUrl && rule.siteRe.test(sourceUrl)
    ? sourceUrl
    : rule.fallbackReferer;
}

export const PHOTO_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/131.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

// Try each size candidate in order; first OK response wins.
export async function fetchPhotoWithFallback(
  url: string,
  referer: string,
  timeoutMs?: number,
): Promise<Response | null> {
  const rule = ruleForPhotoUrl(url);
  if (!rule) return null;
  const candidates = rule
    .candidates(url)
    .filter((u, i, arr) => arr.indexOf(u) === i);
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, {
        headers: { ...PHOTO_FETCH_HEADERS, Referer: referer },
        signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
      });
      if (res.ok && res.body) return res;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}
