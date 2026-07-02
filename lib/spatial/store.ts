// Sonder Simulation — project store.
//
// MVP storage is localStorage behind the SpatialStore interface, so
// the whole persistence layer can later move to Supabase/S3/R2 by
// implementing the same interface server-side. Nothing outside this
// file touches localStorage directly.
//
// Share links carry the entire tour payload deflated into the URL
// fragment — a shared simulator opens on any device with no backend.

import {
  Project,
  ProjectType,
  Phase,
  Hotspot,
  MediaItem,
  Visibility,
  PHASE_PRESETS,
  CTA_LABEL,
  newId,
} from "./types";

const PROJECTS_KEY = "sonder-spatial-projects-v1";
const SEEDED_KEY = "sonder-spatial-seeded-v1";

export interface SpatialStore {
  list(): Project[];
  get(id: string): Project | null;
  create(input: CreateProjectInput): Project;
  update(id: string, patch: Partial<Project>): Project | null;
  remove(id: string): void;
}

export type CreateProjectInput = {
  title: string;
  address?: string;
  projectType: ProjectType;
  media?: MediaItem[];
  property?: Partial<Project["property"]>;
  description?: string;
  seedRoomHotspots?: boolean;
};

function readAll(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Project[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(projects: Project[]): void {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // Storage full — best effort.
  }
}

function defaultPhases(projectId: string, type: ProjectType): Phase[] {
  return PHASE_PRESETS[type].map((title, i) => ({
    id: newId("ph"),
    projectId,
    title,
    phaseOrder: i,
    phaseType: i === 0 ? "current" : "planned",
  }));
}

// Auto-layout: spread hotspots through the demo world's rooms.
export function autoPosition(index: number): [number, number, number] {
  const spots: [number, number, number][] = [
    [0, 1.6, -6],
    [5, 1.6, -10],
    [-5, 1.6, -10],
    [5, 1.6, -18],
    [-5, 1.6, -18],
    [0, 1.6, -24],
  ];
  const base = spots[index % spots.length];
  const ring = Math.floor(index / spots.length);
  return [base[0] + ring * 1.5, base[1], base[2] - ring * 1.5];
}

class LocalStorageStore implements SpatialStore {
  list(): Project[] {
    seedDemoProjects();
    return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Project | null {
    seedDemoProjects();
    return readAll().find((p) => p.id === id) ?? null;
  }

  create(input: CreateProjectInput): Project {
    const id = newId("prj");
    const now = Date.now();
    const media = input.media ?? [];
    const hotspots: Hotspot[] = input.seedRoomHotspots
      ? media
          .filter((m) => m.label)
          .slice(0, 6)
          .map((m, i) => ({
            id: newId("hs"),
            projectId: id,
            title: m.label!,
            hotspotType: "room_label" as const,
            position: autoPosition(i),
          }))
      : [];
    const project: Project = {
      id,
      title: input.title,
      address: input.address,
      projectType: input.projectType,
      status: media.length > 0 ? "uploaded" : "draft",
      visibility: "private",
      shareSlug: newId("s"),
      description: input.description,
      thumbnail: media[0]?.url,
      media,
      property: { projectId: id, ...(input.property ?? {}) },
      phases: defaultPhases(id, input.projectType),
      hotspots,
      ctaLabel: CTA_LABEL[input.projectType],
      createdAt: now,
      updatedAt: now,
    };
    writeAll([project, ...readAll()]);
    return project;
  }

  update(id: string, patch: Partial<Project>): Project | null {
    const all = readAll();
    const idx = all.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const next = { ...all[idx], ...patch, id, updatedAt: Date.now() };
    all[idx] = next;
    writeAll(all);
    return next;
  }

  remove(id: string): void {
    writeAll(readAll().filter((p) => p.id !== id));
  }
}

export const store: SpatialStore = new LocalStorageStore();

// ── Demo projects ───────────────────────────────────────────────────

function demo(
  title: string,
  projectType: ProjectType,
  description: string,
  property: Partial<Project["property"]>,
  hotspots: { title: string; type: Hotspot["hotspotType"]; desc?: string }[],
): Project {
  const id = newId("prj");
  const now = Date.now();
  return {
    id,
    title,
    projectType,
    description,
    status: "ready",
    visibility: "unlisted",
    shareSlug: newId("s"),
    media: [],
    property: { projectId: id, ...property },
    scene: {
      id: newId("scn"),
      projectId: id,
      sceneType: "demo",
      processingStatus: "ready",
    },
    phases: defaultPhases(id, projectType),
    hotspots: hotspots.map((h, i) => ({
      id: newId("hs"),
      projectId: id,
      title: h.title,
      description: h.desc,
      hotspotType: h.type,
      position: autoPosition(i),
    })),
    ctaLabel: CTA_LABEL[projectType],
    createdAt: now,
    updatedAt: now,
  };
}

export function seedDemoProjects(): void {
  try {
    if (localStorage.getItem(SEEDED_KEY)) return;
    const demos: Project[] = [
      demo(
        "Luxury Coastal Listing",
        "real_estate",
        "High-end listing walkthrough",
        { price: "$4,850,000", beds: "5", baths: "6", squareFeet: "6,200" },
        [
          { title: "Primary Suite", type: "room_label" },
          { title: "Ocean-view terrace", type: "sales_note", desc: "Unobstructed Pacific views from every west-facing room." },
          { title: "Chef's kitchen", type: "room_label" },
          { title: "Book a private showing", type: "cta" },
        ],
      ),
      demo(
        "Downtown Value-Add Deal",
        "investor",
        "Before/after renovation and investor notes",
        { price: "$1,120,000", beds: "8", baths: "6", squareFeet: "5,400" },
        [
          { title: "Kitchen rehab estimate", type: "investor_note", desc: "$38k full gut, ARV supports it." },
          { title: "Roof — 5 yrs left", type: "issue", desc: "Budget $22k replacement in year 3." },
          { title: "Unit 2 rent comp", type: "investor_note", desc: "$2,150/mo post-reno." },
        ],
      ),
      demo(
        "Modern Hillside Residence",
        "architecture",
        "Future-build walkthrough",
        { squareFeet: "4,100", propertyType: "New construction" },
        [
          { title: "Material option — shou sugi ban", type: "design_comment", desc: "Charred cedar rain-screen, option B is stucco." },
          { title: "Great room", type: "room_label" },
          { title: "Cantilevered deck", type: "design_comment", desc: "Steel moment frame, 12' projection." },
        ],
      ),
      demo(
        "Boutique Hotel Renovation",
        "construction",
        "4D construction timeline",
        { squareFeet: "28,000", propertyType: "Hospitality" },
        [
          { title: "Drywall issue — L2 corridor", type: "issue", desc: "Moisture reading high; re-inspect after roof patch." },
          { title: "Lobby millwork", type: "room_label" },
          { title: "MEP rough-in complete", type: "design_comment", desc: "Signed off 6/24." },
        ],
      ),
    ];
    writeAll([...demos, ...readAll()]);
    localStorage.setItem(SEEDED_KEY, "1");
  } catch {
    // Best-effort.
  }
}

// ── Share payloads (URL-fragment encoded, backend-free) ─────────────

export type SharePayload = {
  v: 1;
  title: string;
  projectType: ProjectType;
  address?: string;
  property: Project["property"];
  media: MediaItem[];
  hotspots: Hotspot[];
  phases: { title: string }[];
  ctaLabel: string;
  visibility: Visibility;
};

export async function encodeShare(project: Project): Promise<string> {
  const { deflateSync, strToU8 } = await import("fflate");
  const payload: SharePayload = {
    v: 1,
    title: project.title,
    projectType: project.projectType,
    address: project.address,
    property: project.property,
    // blob: media can't travel to another device — CDN urls only.
    media: project.media.filter((m) => !m.url.startsWith("blob:")),
    hotspots: project.hotspots,
    phases: project.phases
      .slice()
      .sort((a, b) => a.phaseOrder - b.phaseOrder)
      .map((p) => ({ title: p.title })),
    ctaLabel: project.ctaLabel ?? CTA_LABEL[project.projectType],
    visibility: project.visibility,
  };
  const packed = deflateSync(strToU8(JSON.stringify(payload)), { level: 9 });
  let bin = "";
  for (const b of packed) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function decodeShare(hash: string): Promise<SharePayload | null> {
  try {
    const { inflateSync, strFromU8 } = await import("fflate");
    const b64 = hash.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const payload = JSON.parse(strFromU8(inflateSync(bytes))) as SharePayload;
    return payload && payload.v === 1 ? payload : null;
  } catch {
    return null;
  }
}
