// Sonder Simulation — core data models.
// One shared project system; labels change per project type.

export type ProjectType =
  | "real_estate"
  | "investor"
  | "architecture"
  | "construction";

export type ProjectStatus =
  | "draft"
  | "uploaded"
  | "processing"
  | "ready"
  | "failed";

export type Visibility = "private" | "unlisted" | "public";

export type SceneType = "gaussian_splat" | "model_3d" | "guided_tour" | "demo";

export type ProcessingState =
  | "uploaded"
  | "validating"
  | "analyzing_media"
  | "reconstructing"
  | "generating_scene"
  | "optimizing"
  | "ready"
  | "failed";

export type HotspotType =
  | "room_label"
  | "sales_note"
  | "investor_note"
  | "issue"
  | "design_comment"
  | "cta";

export type User = {
  id: string;
  name: string;
  email: string;
};

export type Organization = {
  id: string;
  name: string;
  brandName: string;
};

export type Property = {
  projectId: string;
  price?: string;
  beds?: string;
  baths?: string;
  squareFeet?: string;
  lotSize?: string;
  propertyType?: string;
  agentName?: string;
  agentEmail?: string;
  agentPhone?: string;
};

export type SpatialUpload = {
  id: string;
  projectId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  url: string;
  status: "pending" | "stored" | "failed";
  createdAt: number;
};

export type Scene = {
  id: string;
  projectId: string;
  sceneType: SceneType;
  fileUrl?: string;
  format?: string;
  processingStatus: ProcessingState;
  qualityScore?: QualityScore;
  cameraStartPosition?: [number, number, number];
  cameraPath?: [number, number, number][];
  collisionMeshUrl?: string;
};

export type Phase = {
  id: string;
  projectId: string;
  title: string;
  phaseOrder: number;
  phaseType: string;
  date?: string;
  sceneId?: string;
  notes?: string;
};

export type Hotspot = {
  id: string;
  projectId: string;
  sceneId?: string;
  title: string;
  description?: string;
  position: [number, number, number];
  hotspotType: HotspotType;
};

export type InvestorNote = {
  id: string;
  projectId: string;
  purchasePrice?: string;
  rehabEstimate?: string;
  arv?: string;
  rentEstimate?: string;
  capRate?: string;
  notes?: string;
};

export type ConstructionIssue = {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: "open" | "in_progress" | "resolved";
  priority: "low" | "medium" | "high";
  phaseId?: string;
};

export type MediaItem = {
  id: string;
  url: string; // CDN url (persists) or blob: url (tab-local)
  label?: string; // room label from the downloader's classifier
};

export type Project = {
  id: string;
  title: string;
  address?: string;
  projectType: ProjectType;
  status: ProjectStatus;
  visibility: Visibility;
  shareSlug: string;
  thumbnail?: string;
  description?: string;
  media: MediaItem[];
  property: Property;
  scene?: Scene;
  phases: Phase[];
  hotspots: Hotspot[];
  ctaLabel?: string; // override; defaults per type
  createdAt: number;
  updatedAt: number;
};

export type QualityScore =
  | "good_for_scan"
  | "better_as_tour"
  | "model_import"
  | "needs_more_media";

export type GenerationMode = "walkthrough_scan" | "model_import" | "guided_tour";

// ── Per-type label system — same system, different words ───────────

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  real_estate: "Real Estate Sales",
  investor: "Investor Review",
  architecture: "Architecture Preview",
  construction: "Construction Progress",
};

export const CTA_LABEL: Record<ProjectType, string> = {
  real_estate: "Book Showing",
  investor: "Request Deal Packet",
  architecture: "Review Design",
  construction: "View Progress Report",
};

export const HOTSPOT_TYPE_LABEL: Record<HotspotType, string> = {
  room_label: "Room Label",
  sales_note: "Sales Note",
  investor_note: "Investor Note",
  issue: "Construction Issue",
  design_comment: "Design Comment",
  cta: "CTA",
};

// Which hotspot types each project type leads with (all remain usable).
export const HOTSPOT_TYPES_FOR: Record<ProjectType, HotspotType[]> = {
  real_estate: ["room_label", "sales_note", "cta"],
  investor: ["investor_note", "room_label", "issue"],
  architecture: ["design_comment", "room_label", "cta"],
  construction: ["issue", "room_label", "design_comment"],
};

export const HOTSPOT_PLACEHOLDER: Record<ProjectType, string> = {
  real_estate: "Primary Suite",
  investor: "Kitchen rehab estimate",
  architecture: "Material option",
  construction: "Drywall issue",
};

export const PHASE_PRESETS: Record<ProjectType, string[]> = {
  real_estate: ["Current condition", "Staged", "Final walkthrough"],
  investor: ["Current condition", "Renovation concept", "After repair"],
  architecture: ["Concept", "Design option A", "Design option B", "Final design"],
  construction: [
    "Current condition",
    "Foundation",
    "Framing",
    "MEP",
    "Drywall",
    "Finish",
    "Final walkthrough",
  ],
};

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Draft",
  uploaded: "Uploaded",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

export const PROCESSING_STATE_LABEL: Record<ProcessingState, string> = {
  uploaded: "Uploaded",
  validating: "Validating",
  analyzing_media: "Analyzing media",
  reconstructing: "Reconstructing",
  generating_scene: "Building scene",
  optimizing: "Optimizing",
  ready: "Ready",
  failed: "Failed",
};

export const QUALITY_LABEL: Record<QualityScore, string> = {
  good_for_scan: "Good for 3D scan",
  better_as_tour: "Better as guided tour",
  model_import: "Model import detected",
  needs_more_media: "Needs more media",
};

export const GENERATION_MODE_LABEL: Record<GenerationMode, string> = {
  walkthrough_scan: "Walkthrough Scan",
  model_import: "Model Import",
  guided_tour: "Guided Photo Tour",
};

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
