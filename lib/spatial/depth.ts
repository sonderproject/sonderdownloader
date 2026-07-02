// In-browser monocular depth estimation (Depth Anything small via
// transformers.js — the same runtime as the CLIP room classifier).
// No API key: the model downloads once from the HuggingFace CDN
// (~50 MB) and is cached in the browser.
//
// Output is a normalized inverse-depth grid (1 = nearest) that the
// viewer displaces photo meshes with, turning each room photo into a
// volumetric diorama with real parallax.

export type DepthGrid = {
  width: number;
  height: number;
  data: Float32Array; // row-major, 0..1, 1 = nearest
  aspect: number; // source image aspect (w/h)
};

type DepthPipeline = (url: string) => Promise<{
  depth: { data: Uint8Array | Float32Array; width: number; height: number };
}>;

let pipePromise: Promise<DepthPipeline> | null = null;

async function getPipeline(): Promise<DepthPipeline> {
  if (pipePromise) return pipePromise;
  pipePromise = (async () => {
    const tf = await import("@xenova/transformers");
    tf.env.allowLocalModels = false;
    const pipe = await tf.pipeline(
      "depth-estimation",
      "Xenova/depth-anything-small-hf",
    );
    return pipe as unknown as DepthPipeline;
  })();
  return pipePromise;
}

// Estimate depth for an image URL and downsample to a mesh-friendly
// grid. Throws if the model can't load (offline, blocked CDN) — the
// caller keeps its non-depth fallback.
export async function estimateDepthGrid(
  url: string,
  gridW = 96,
): Promise<DepthGrid> {
  const pipe = await getPipeline();
  const out = await pipe(url);
  const src = out.depth;
  const aspect = src.width / src.height;
  const gridH = Math.max(8, Math.round(gridW / aspect));

  // Find range for normalization.
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < src.data.length; i++) {
    const v = src.data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;

  const data = new Float32Array(gridW * gridH);
  for (let gy = 0; gy < gridH; gy++) {
    const sy = Math.min(
      src.height - 1,
      Math.round((gy / (gridH - 1)) * (src.height - 1)),
    );
    for (let gx = 0; gx < gridW; gx++) {
      const sx = Math.min(
        src.width - 1,
        Math.round((gx / (gridW - 1)) * (src.width - 1)),
      );
      data[gy * gridW + gx] =
        (src.data[sy * src.width + sx] - min) / range;
    }
  }
  return { width: gridW, height: gridH, data, aspect };
}
