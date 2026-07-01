import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { PassThrough } from "node:stream";

export const runtime = "nodejs";
// NOTE: Vercel Hobby caps serverless functions at 10s. Fetching + zipping
// 20–60 photos comfortably exceeds that; Vercel Pro is required in prod.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const PHOTO_URL_RE =
  /^https:\/\/photos\.zillowstatic\.com\/fp\/[a-zA-Z0-9]+-cc_ft_\d+\.jpg$/;

type Body = {
  photos?: unknown;
  slug?: unknown;
  sourceUrl?: unknown;
};

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

const PHOTO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/131.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

// Not every photo exists at cc_ft_1536 — older listings top out at
// smaller sizes. Fall back down the ladder instead of dropping the
// photo from the zip.
const SIZE_LADDER = ["cc_ft_1536", "cc_ft_960", "cc_ft_576"];

async function fetchPhotoWithFallback(
  url: string,
  referer: string,
): Promise<Response | null> {
  const candidates = [
    url,
    ...SIZE_LADDER.map((s) => url.replace(/cc_ft_\d+/, s)),
  ].filter((u, i, arr) => arr.indexOf(u) === i);
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, {
        headers: { ...PHOTO_HEADERS, Referer: referer },
      });
      if (res.ok && res.body) return res;
    } catch {
      // Try the next size down.
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const rawPhotos = Array.isArray(body.photos) ? body.photos : [];
  const photos = rawPhotos.filter(
    (p): p is string => typeof p === "string" && PHOTO_URL_RE.test(p),
  );

  if (photos.length === 0) {
    return NextResponse.json({ error: "No photos to zip." }, { status: 400 });
  }

  const slug =
    typeof body.slug === "string" && body.slug.length > 0
      ? body.slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-")
      : "listing";

  const referer =
    typeof body.sourceUrl === "string" &&
    /^https:\/\/(www\.)?zillow\.com\//i.test(body.sourceUrl)
      ? body.sourceUrl
      : "https://www.zillow.com/";

  const archive = archiver("zip", { zlib: { level: 6 } });
  const passthrough = new PassThrough();
  archive.pipe(passthrough);

  archive.on("warning", (err) => {
    console.warn("archive warning:", err);
  });
  archive.on("error", (err) => {
    console.error("archive error:", err);
    passthrough.destroy(err);
  });

  const width = Math.max(2, String(photos.length).length);

  (async () => {
    try {
      for (let i = 0; i < photos.length; i++) {
        const url = photos[i];
        try {
          const res = await fetchPhotoWithFallback(url, referer);
          if (!res) {
            console.warn(`skip photo ${i + 1}: all sizes failed`);
            continue;
          }

          const buf = Buffer.from(await res.arrayBuffer());
          archive.append(buf, { name: `photo_${pad(i + 1, width)}.jpg` });
        } catch (err) {
          console.warn(`skip photo ${i + 1}:`, err);
        }
      }
      await archive.finalize();
    } catch (err) {
      console.error("zip pipeline error:", err);
      passthrough.destroy(err as Error);
    }
  })();

  const stream = new ReadableStream({
    start(controller) {
      passthrough.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      passthrough.on("end", () => controller.close());
      passthrough.on("error", (err) => controller.error(err));
    },
    cancel() {
      passthrough.destroy();
      archive.destroy();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
