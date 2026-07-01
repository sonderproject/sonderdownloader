import { NextRequest, NextResponse } from "next/server";
import {
  ruleForPhotoUrl,
  fetchPhotoWithFallback,
} from "@/lib/photoHosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxies listing-CDN photos through our origin so the browser can read
// pixel data for client-side ML (CLIP classification) and canvas video
// rendering. Locked to the allowlisted photo hosts so this can't be
// used as an open image proxy. Falls back down each host's size ladder
// so a missing rendition never loses a photo.
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const rule = url ? ruleForPhotoUrl(url) : null;
  if (!url || !rule) {
    return NextResponse.json({ error: "Not allowed." }, { status: 400 });
  }

  const upstream = await fetchPhotoWithFallback(
    url,
    rule.fallbackReferer,
    15_000,
  );

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
