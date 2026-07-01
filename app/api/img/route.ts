import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxies Zillow CDN photos through our origin so the browser can read
// pixel data for client-side ML (CLIP classification). Locked down to
// photos.zillowstatic.com so this can't be used as an open image proxy.
// Not every photo exists at cc_ft_1536 — fall back down the size
// ladder so classification and video rendering never lose a photo.
const SIZE_LADDER = ["cc_ft_1536", "cc_ft_960", "cc_ft_576"];

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url || !/^https:\/\/photos\.zillowstatic\.com\/fp\/[a-zA-Z0-9]+-cc_ft_\d+\.(?:jpg|webp)$/.test(url)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 400 });
  }

  const candidates = [
    url,
    ...SIZE_LADDER.map((s) => url.replace(/cc_ft_\d+/, s)),
  ].filter((u, i, arr) => arr.indexOf(u) === i);

  let upstream: Response | null = null;
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, {
        headers: {
          Referer: "https://www.zillow.com/",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok && res.body) {
        upstream = res;
        break;
      }
    } catch {
      // Try the next size down.
    }
  }

  if (!upstream || !upstream.body) {
    return NextResponse.json(
      { error: "Upstream image fetch failed." },
      { status: 502 },
    );
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
