# Sonder Simulation — Architecture

4D property simulators for real estate, architecture, investors, and
construction. A Sonder Project portfolio product, integrated into the
Sonder Real Estate Downloader app (photos extracted or uploaded there
flow directly into simulator projects).

## Product vision

Properties are experienced in space *and* time. Sonder Simulation lets
anyone turn property media into a walkable simulator — before the
building exists (architecture), while it changes (construction,
renovation), and when it sells (real estate, investment) — and share
it with a link that opens anywhere.

- **3D** = a walkable spatial experience of the property as it stands.
- **4D** = time: construction phases, before/after renovation states,
  future-build previews, and design options.

## The three input paths

The product never pretends random listing photos make a perfect 3D
world. Input quality routes to the right pipeline:

1. **True Scan Path** — high-overlap photo sets, video walkthroughs,
   or Gaussian Splat files (`.ply`, `.splat`, `.ksplat`, `.sog`) →
   photorealistic walkable scene.
   Future pipeline: COLMAP/SfM pose estimation → Gaussian Splat
   training (gsplat / Nerfstudio) → browser-optimized splat scene.
2. **Model Import Path** — GLB/GLTF, BIM-style exports, architecture
   models (future: Revit/IFC/SketchUp/CAD) → walkable future-build
   simulator.
3. **Guided Tour Fallback Path** — standard listing photos with weak
   overlap → guided cinematic pseudo-3D walkthrough: photo nodes in a
   spatial gallery, smooth camera moves, room labels (auto-seeded from
   the downloader's CLIP classifier), and hotspots. Each room's lead
   photo is additionally lifted to a **depth-displaced 3D diorama**
   using in-browser monocular depth estimation (Depth Anything small
   via transformers.js, `lib/spatial/depth.ts`) — real parallax from a
   single photo, no API key, model cached from the HF CDN like the
   CLIP classifier. Failure at any point leaves the flat curved
   backdrop in place.

`ProcessingService.detectProjectInputType()` and
`estimateCaptureQuality()` pick the default path; the user can
override the generation mode.

## What's real vs. stubbed (MVP)

Real today:

- Project system: create/update/delete, four project types sharing one
  schema with type-specific labels and CTAs.
- Upload flow with validation, input-type detection, quality scoring.
- Staged processing pipeline with realistic states
  (`uploaded → validating → analyzing_media → reconstructing →
  generating_scene → optimizing → ready`).
- Three.js first-person viewer: WASD + mouse-look, room zones, photo
  gallery from real project media, floating hotspots, cinematic
  auto-tour, phase-driven construction visuals, before/after lighting,
  presentation mode.
- Backend-free share links (tour payload deflate-compressed into the
  URL fragment).

Stubbed (interfaces final, implementations pending):

- `processGaussianSplat`, `processModelImport`, `generateGuidedTour`,
  `generateCollisionMesh` in `lib/spatial/processing.ts`.

## Storage

MVP persistence is `localStorage` behind the `SpatialStore` interface
(`lib/spatial/store.ts`). Nothing else touches storage directly, so
the layer swaps for a server implementation (Supabase/Postgres + S3 or
Cloudflare R2 for media) without touching UI code. Uploaded files are
kept as browser object URLs in the MVP — cloud media storage is the
first Phase 3 milestone.

## Future work

- **Gaussian Splat pipeline** — COLMAP/SfM → gsplat or Nerfstudio
  training on GPU workers → compressed splats streamed to the viewer.
- **BIM/IFC/Revit support** — IFC.js ingestion, element metadata as
  hotspots, phase mapping from construction schedules.
- **Cloud storage + GPU processing** — queue-based workers; the
  ProcessingService states already mirror the queue lifecycle.
- **Matterport import** — tour graph → guided-tour path conversion.
- **AI-generated labels/notes** — the downloader already ships CLIP
  room classification; extend to captioning hotspots and auto-writing
  listing/investor notes.
- **Lead capture & CRM** — the CTA modal becomes a form; routes to
  agent email/CRM webhooks.

## Layout

```
lib/spatial/
  types.ts        data models + per-type label system
  store.ts        SpatialStore interface + localStorage impl + share codec
  processing.ts   ProcessingService (validation, detection, staged pipeline)
  viewer.ts       Three.js walkable scene engine
app/simulator/
  page.tsx        landing
  dashboard/      project grid
  projects/new    create flow (picks up downloader-staged photos)
  projects/[id]/  project hub, uploads, viewer, hotspots, phases, settings
  s/              public share viewer (URL-fragment payload)
  ui.tsx          shell, badges, share modal
  viewer-ui.tsx   simulator HUD (shared by viewer + share page)
```
