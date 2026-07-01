// Ready-to-post social captions synthesized from the listing facts.
// Pure templates — no API, no cost, works offline. Three voices so
// there's always one that fits the property and the platform.

import type { ListingFacts } from "./sources";

export type Caption = {
  key: "professional" | "punchy" | "luxury";
  label: string;
  text: string;
};

function specLine(f: ListingFacts): string {
  const parts: string[] = [];
  if (f.beds) parts.push(`${f.beds} bed`);
  if (f.baths) parts.push(`${f.baths} bath`);
  if (f.sqft) parts.push(`${f.sqft} sq ft`);
  return parts.join(" · ");
}

function cityTag(f: ListingFacts): string | null {
  // "123 Main St, Anytown, CA 90210" → "Anytown"
  const parts = (f.address ?? "").split(",").map((s) => s.trim());
  if (parts.length < 2) return null;
  const city = parts[1].replace(/[^A-Za-z ]/g, "").trim();
  if (!city || /^\d/.test(city)) return null;
  return city.replace(/\s+/g, "");
}

function hashtags(f: ListingFacts, extra: string[]): string {
  const tags = ["#realestate", "#newlisting", ...extra];
  const city = cityTag(f);
  if (city) tags.push(`#${city}`, `#${city}RealEstate`);
  return tags.join(" ");
}

function teaser(f: ListingFacts): string {
  if (!f.description) return "";
  const first = f.description.split(/(?<=[.!?])\s+/)[0] ?? "";
  return first.length > 20 && first.length < 220 ? first : "";
}

export function buildCaptions(f: ListingFacts): Caption[] {
  const specs = specLine(f);
  const where = f.address ? ` at ${f.address}` : "";
  const price = f.price ? ` Offered at ${f.price}.` : "";
  const tease = teaser(f);

  const professional = [
    `JUST LISTED${where ? ` — ${f.address}` : ""}`,
    specs ? specs : null,
    tease || null,
    price.trim() || null,
    `DM for a private showing or the full photo tour.`,
    hashtags(f, ["#justlisted", "#hometour"]),
  ]
    .filter(Boolean)
    .join("\n\n");

  const punchy = [
    `New on the market 🏡${where ? ` — ${f.address}` : ""}`,
    specs ? `${specs}${f.price ? ` · ${f.price}` : ""}` : f.price || null,
    `Watch the full walkthrough before it's gone 👇`,
    hashtags(f, ["#housetour", "#dreamhome", "#homesweethome"]),
  ]
    .filter(Boolean)
    .join("\n\n");

  const luxury = [
    `A rare offering${where ? ` — ${f.address}` : ""}.`,
    tease ||
      (specs
        ? `${specs} of thoughtfully designed living space.`
        : `Thoughtfully designed living space, presented at its best.`),
    f.price ? `Presented at ${f.price}.` : null,
    `Private tours by appointment.`,
    hashtags(f, ["#luxuryrealestate", "#luxuryhomes", "#curbappeal"]),
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { key: "professional", label: "Professional", text: professional },
    { key: "punchy", label: "Punchy · Reels/TikTok", text: punchy },
    { key: "luxury", label: "Luxury", text: luxury },
  ];
}

export function captionsFileText(f: ListingFacts, slug: string): string {
  const blocks = buildCaptions(f).map(
    (c) => `── ${c.label} ──────────────────\n\n${c.text}\n`,
  );
  return `Sonder captions — ${slug}\n\n${blocks.join("\n")}`;
}
