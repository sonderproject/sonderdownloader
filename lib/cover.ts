// Branded cover graphic: 1080×1350 (IG portrait) hero image with
// price/address/specs overlay and agent branding. Rendered entirely
// in-browser on a canvas; photo loads through the /api/img proxy so
// pixel access never hits a CORS wall.

import type { ListingFacts } from "./sources";

export type Branding = {
  name?: string;
  phone?: string;
  website?: string;
};

const W = 1080;
const H = 1350;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Cover photo failed to load."));
    img.src = url;
  });
}

function coverCrop(
  imgW: number,
  imgH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const targetAR = W / H;
  const imgAR = imgW / imgH;
  if (imgAR > targetAR) {
    const sw = imgH * targetAR;
    return { sx: (imgW - sw) / 2, sy: 0, sw, sh: imgH };
  }
  const sh = imgW / targetAR;
  return { sx: 0, sy: (imgH - sh) / 2, sw: imgW, sh };
}

export async function renderCoverImage(
  photoUrl: string,
  facts: ListingFacts,
  branding: Branding,
): Promise<Blob> {
  const img = await loadImage(photoUrl);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

  const r = coverCrop(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);

  // Legibility gradient over the lower half.
  const grad = ctx.createLinearGradient(0, H * 0.45, 0, H);
  grad.addColorStop(0, "rgba(10,10,9,0)");
  grad.addColorStop(0.55, "rgba(10,10,9,0.72)");
  grad.addColorStop(1, "rgba(10,10,9,0.94)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, H * 0.45, W, H * 0.55);

  const pad = 64;
  let y = H - pad;
  ctx.textBaseline = "alphabetic";

  // Branding footer (smallest, at the very bottom).
  const brandBits = [branding.name, branding.phone, branding.website]
    .filter(Boolean)
    .join("  ·  ");
  if (brandBits) {
    ctx.font = "500 26px Inter, system-ui, sans-serif";
    ctx.fillStyle = "rgba(237,233,227,0.75)";
    ctx.fillText(brandBits, pad, y);
    y -= 58;
  }

  // Accent rule.
  ctx.fillStyle = "#3E9BD4";
  ctx.fillRect(pad, y - 6, 88, 6);
  y -= 40;

  const specs = [
    facts.beds ? `${facts.beds} BD` : null,
    facts.baths ? `${facts.baths} BA` : null,
    facts.sqft ? `${facts.sqft} SQFT` : null,
  ]
    .filter(Boolean)
    .join("   ·   ");
  if (specs) {
    ctx.font = "600 30px Inter, system-ui, sans-serif";
    ctx.fillStyle = "rgba(237,233,227,0.92)";
    ctx.fillText(specs, pad, y);
    y -= 62;
  }

  if (facts.address) {
    ctx.font = "500 40px Outfit, Inter, system-ui, sans-serif";
    ctx.fillStyle = "#EDE9E3";
    // Wrap the address onto up to two lines.
    const words = facts.address.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const probe = line ? `${line} ${w}` : w;
      if (ctx.measureText(probe).width > W - pad * 2 && line) {
        lines.push(line);
        line = w;
      } else {
        line = probe;
      }
    }
    if (line) lines.push(line);
    for (const l of lines.slice(0, 2).reverse()) {
      ctx.fillText(l, pad, y);
      y -= 52;
    }
    y -= 18;
  }

  if (facts.price) {
    ctx.font = "600 96px Outfit, Inter, system-ui, sans-serif";
    ctx.fillStyle = "#EDE9E3";
    ctx.fillText(facts.price, pad, y);
    y -= 110;
  }

  ctx.font = "600 24px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#6FC3F0";
  ctx.fillText("JUST LISTED", pad, y);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Cover export failed."))),
      "image/png",
    );
  });
}
