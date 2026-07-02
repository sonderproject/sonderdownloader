// Sonder Simulation — ProcessingService (MVP stub).
//
// The real pipeline (COLMAP/SfM → Gaussian Splat training → optimized
// browser scene) is future work; see docs/ARCHITECTURE.md. This module
// owns everything the app needs today: upload validation, input-type
// detection, capture-quality scoring, and a staged fake pipeline whose
// states mirror the real one so swapping in real workers later doesn't
// change the UI contract.

import {
  GenerationMode,
  ProcessingState,
  QualityScore,
  SpatialUpload,
} from "./types";

const IMAGE_EXT = ["jpg", "jpeg", "png", "webp"];
const VIDEO_EXT = ["mp4", "mov"];
const SPLAT_EXT = ["ply", "splat", "ksplat", "sog"];
const MODEL_EXT = ["glb", "gltf"];
// Future placeholder support: IFC, Revit, SketchUp, CAD, floor plans, PDFs.
export const FUTURE_EXT = ["ifc", "rvt", "skp", "dwg", "pdf"];

export const SUPPORTED_EXT = [
  ...IMAGE_EXT,
  ...VIDEO_EXT,
  ...SPLAT_EXT,
  ...MODEL_EXT,
];

export type InputKind = "image" | "video" | "splat" | "model" | "unsupported";

function extOf(name: string): string {
  return (name.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? "").toLowerCase();
}

export function validateUpload(file: {
  name: string;
  size: number;
}): { ok: boolean; reason?: string } {
  const ext = extOf(file.name);
  if (!SUPPORTED_EXT.includes(ext)) {
    if (FUTURE_EXT.includes(ext)) {
      return { ok: false, reason: `.${ext} support is on the roadmap` };
    }
    return { ok: false, reason: `.${ext || "?"} is not supported` };
  }
  if (file.size > 2_000_000_000) return { ok: false, reason: "File over 2 GB" };
  return { ok: true };
}

export function detectInputKind(fileName: string): InputKind {
  const ext = extOf(fileName);
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  if (SPLAT_EXT.includes(ext)) return "splat";
  if (MODEL_EXT.includes(ext)) return "model";
  return "unsupported";
}

export function detectProjectInputType(
  files: { name: string }[],
): GenerationMode {
  const kinds = files.map((f) => detectInputKind(f.name));
  if (kinds.includes("model")) return "model_import";
  if (kinds.includes("splat") || kinds.includes("video")) {
    return "walkthrough_scan";
  }
  return "guided_tour";
}

export function estimateCaptureQuality(
  files: { name: string }[],
): QualityScore {
  const kinds = files.map((f) => detectInputKind(f.name));
  if (kinds.includes("model")) return "model_import";
  if (kinds.includes("splat")) return "good_for_scan";
  const images = kinds.filter((k) => k === "image").length;
  const videos = kinds.filter((k) => k === "video").length;
  if (videos > 0 || images >= 60) return "good_for_scan";
  if (images >= 8) return "better_as_tour";
  return "needs_more_media";
}

// ── Staged fake pipeline ────────────────────────────────────────────

const PIPELINE: { state: ProcessingState; ms: number }[] = [
  { state: "uploaded", ms: 400 },
  { state: "validating", ms: 900 },
  { state: "analyzing_media", ms: 1600 },
  { state: "reconstructing", ms: 2200 },
  { state: "generating_scene", ms: 1800 },
  { state: "optimizing", ms: 1400 },
  { state: "ready", ms: 0 },
];

export type ProcessingRun = { cancel: () => void };

export function runProcessing(
  onState: (state: ProcessingState, progress: number) => void,
): ProcessingRun {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const total = PIPELINE.length - 1;
  const step = (i: number) => {
    if (cancelled) return;
    onState(PIPELINE[i].state, i / total);
    if (i < total) timer = setTimeout(() => step(i + 1), PIPELINE[i].ms);
  };
  step(0);
  return {
    cancel: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}

// Stubs for the future real pipeline — kept so call sites and tests
// can wire against the final shape now.
export const ProcessingService = {
  validateUpload,
  detectProjectInputType,
  estimateCaptureQuality,
  async processGaussianSplat(upload: SpatialUpload): Promise<void> {
    void upload; // Future: COLMAP/SfM → gsplat training → optimization
  },
  async processModelImport(upload: SpatialUpload): Promise<void> {
    void upload; // Future: GLB/GLTF normalization + collision mesh
  },
  async generateGuidedTour(uploads: SpatialUpload[]): Promise<void> {
    void uploads; // Future: photo-node graph + camera path synthesis
  },
  async generateCollisionMesh(): Promise<void> {},
  async generateTimelinePhases(): Promise<void> {},
  async generateHotspots(): Promise<void> {},
  async updateProcessingStatus(): Promise<void> {},
};
