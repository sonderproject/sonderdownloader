// Client-side CLIP zero-shot classifier for photo-to-room labeling.
// Uses @xenova/transformers with the CLIP model. First run downloads
// the model (~150 MB) into IndexedDB; subsequent runs load from cache.
//
// This module is intentionally dynamically importable so Transformers.js
// doesn't ship in the initial bundle. Only loaded when the user clicks
// "Auto-classify photos."

import type { RoomKey } from "./rooms";

// CLIP works best with natural-language prompts, not raw category names.
// We test the image against each prompt and pick the top match.
const LABEL_PROMPTS: { key: RoomKey; prompt: string }[] = [
  { key: "exterior_front", prompt: "a photo of the front exterior of a house" },
  { key: "exterior_back", prompt: "a photo of the back exterior of a house or backyard elevation" },
  { key: "aerial", prompt: "an aerial drone photo of a house from above" },
  { key: "entryway", prompt: "a photo of the entryway or foyer inside a home" },
  { key: "living_room", prompt: "a photo of a living room with a sofa" },
  { key: "family_room", prompt: "a photo of a family room or den" },
  { key: "dining_room", prompt: "a photo of a dining room with a dining table" },
  { key: "kitchen", prompt: "a photo of a kitchen with countertops and cabinets" },
  { key: "pantry", prompt: "a photo of a kitchen pantry with shelves" },
  { key: "office", prompt: "a photo of a home office with a desk" },
  { key: "primary_bedroom", prompt: "a photo of a large primary bedroom with a bed" },
  { key: "bedroom", prompt: "a photo of a smaller secondary bedroom with a bed" },
  { key: "primary_bathroom", prompt: "a photo of a large primary bathroom with a bathtub" },
  { key: "bathroom", prompt: "a photo of a bathroom with a shower or toilet" },
  { key: "laundry", prompt: "a photo of a laundry room with a washer and dryer" },
  { key: "closet", prompt: "a photo of a walk-in closet with shelves" },
  { key: "garage", prompt: "a photo of a residential garage interior" },
  { key: "basement", prompt: "a photo of a basement or lower level room" },
  { key: "patio", prompt: "a photo of a patio or covered outdoor sitting area" },
  { key: "pool", prompt: "a photo of a swimming pool" },
  { key: "yard", prompt: "a photo of a residential yard with grass and trees" },
  { key: "detail", prompt: "an architectural detail close-up like fixtures or trim" },
];

export type ClassifyProgress =
  | { phase: "loading-model"; progress: number; file?: string }
  | { phase: "classifying"; index: number; total: number };

// Bag of classifier state. Kept module-level so we don't reload the
// model on every run.
type Loaded = {
  pipeline: unknown;
};

let loadedPromise: Promise<Loaded> | null = null;

async function getPipeline(
  onProgress?: (p: ClassifyProgress) => void,
): Promise<Loaded> {
  if (loadedPromise) return loadedPromise;

  loadedPromise = (async () => {
    const tf = await import("@xenova/transformers");
    // Use hosted Xenova CLIP; env.allowLocalModels stays default (false).
    // Progress callback fires many times per file with { status, name,
    // file, loaded, total, progress }.
    tf.env.allowLocalModels = false;
    const pipeline = await tf.pipeline(
      "zero-shot-image-classification",
      "Xenova/clip-vit-base-patch16",
      {
        progress_callback: (data: {
          status: string;
          file?: string;
          progress?: number;
        }) => {
          if (data.status === "progress" && typeof data.progress === "number") {
            onProgress?.({
              phase: "loading-model",
              progress: data.progress / 100,
              file: data.file,
            });
          }
        },
      },
    );
    return { pipeline };
  })();

  return loadedPromise;
}

export type ClassifyInput = {
  id: string;
  url: string;
};

export type ClassifyResult = {
  id: string;
  room: RoomKey;
  confidence: number;
};

// Map a CDN photo URL to our same-origin image proxy so the browser
// can read pixel data without a CORS wall. Uploaded blob: photos are
// already same-origin — pass them straight through.
function toProxyUrl(url: string): string {
  if (url.startsWith("blob:")) return url;
  return `/api/img?url=${encodeURIComponent(url)}`;
}

export async function classifyPhotos(
  inputs: ClassifyInput[],
  onProgress?: (p: ClassifyProgress) => void,
): Promise<ClassifyResult[]> {
  const { pipeline } = await getPipeline(onProgress);
  // Signal to caller the model is ready and we're moving into
  // classification.
  onProgress?.({ phase: "classifying", index: 0, total: inputs.length });

  const results: ClassifyResult[] = [];
  const prompts = LABEL_PROMPTS.map((l) => l.prompt);

  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i];
    try {
      // pipeline signature: (image, candidate_labels) → [{ label, score }]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const output: { label: string; score: number }[] = (await (pipeline as any)(
        toProxyUrl(inp.url),
        prompts,
      )) as { label: string; score: number }[];
      const top = output?.[0];
      const match = LABEL_PROMPTS.find((l) => l.prompt === top?.label);
      results.push({
        id: inp.id,
        room: match?.key ?? "unknown",
        confidence: top?.score ?? 0,
      });
    } catch (err) {
      console.warn("classify failed:", inp.url, err);
      results.push({ id: inp.id, room: "unknown", confidence: 0 });
    }
    onProgress?.({ phase: "classifying", index: i + 1, total: inputs.length });
  }

  return results;
}
