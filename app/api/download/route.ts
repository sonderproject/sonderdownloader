import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { PassThrough } from "node:stream";
import {
  ruleForPhotoUrl,
  refererFor,
  fetchPhotoWithFallback,
} from "@/lib/photoHosts";

export const runtime = "nodejs";
// NOTE: Vercel Hobby caps serverless functions at 10s. Fetching + zipping
// 20–60 photos comfortably exceeds that; Vercel Pro is required in prod.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Body = {
  photos?: unknown;
  slug?: unknown;
  sourceUrl?: unknown;
  prompts?: unknown;
};

type Entry = { url: string; name: string };

const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
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
  const width = Math.max(2, String(rawPhotos.length).length);
  const entries: Entry[] = [];
  for (const [i, item] of rawPhotos.entries()) {
    // Accept both {url, name} objects and bare URL strings.
    const url =
      typeof item === "string"
        ? item
        : item && typeof item === "object" && typeof (item as { url?: unknown }).url === "string"
          ? (item as { url: string }).url
          : null;
    if (!url || !ruleForPhotoUrl(url)) continue;
    const rawName =
      item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string"
        ? (item as { name: string }).name
        : "";
    entries.push({
      url,
      name: NAME_RE.test(rawName) ? rawName : `photo_${pad(i + 1, width)}.jpg`,
    });
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: "No photos to zip." }, { status: 400 });
  }

  const slug =
    typeof body.slug === "string" && body.slug.length > 0
      ? body.slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-")
      : "listing";

  const sourceUrl =
    typeof body.sourceUrl === "string" ? body.sourceUrl : undefined;

  const prompts =
    typeof body.prompts === "string" &&
    body.prompts.length > 0 &&
    body.prompts.length <= 200_000
      ? body.prompts
      : null;

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

  (async () => {
    try {
      if (prompts) {
        archive.append(Buffer.from(prompts, "utf8"), { name: "prompts.txt" });
      }
      for (let i = 0; i < entries.length; i++) {
        const { url, name } = entries[i];
        try {
          const rule = ruleForPhotoUrl(url)!;
          const res = await fetchPhotoWithFallback(
            url,
            refererFor(rule, sourceUrl),
          );
          if (!res) {
            console.warn(`skip photo ${i + 1}: all sizes failed`);
            continue;
          }
          const buf = Buffer.from(await res.arrayBuffer());
          archive.append(buf, { name });
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
