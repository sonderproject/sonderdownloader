# Sonder Simulation — Roadmap

## Phase 1 — MVP shell (shipped)

- Dashboard with demo projects
- Demo viewer (walkable Three.js scene)
- Upload flow with validation + quality scoring
- Four project types on one shared system
- Fake processing pipeline with realistic states
- Share links (backend-free, URL-fragment payload)
- Basic hotspots (auto-positioned)
- Basic phases with timeline slider
- Downloader integration (photos + facts + room labels flow in)

## Phase 2 — Viewer depth

- Gaussian Splat file import (.ply/.splat/.ksplat/.sog rendering)
- GLB/GLTF model import in the viewer
- Better viewer controls (collision, touch/mobile controls)
- In-scene hotspot editor (click-to-place, drag-to-move)
- Timeline slider polish (per-phase scene diffs)
- Presentation mode polish (camera bookmarks, auto-loop)

## Phase 3 — Real backend

- Cloud storage (Supabase/S3/R2) behind the existing SpatialStore interface
- Real processing pipeline on GPU workers (COLMAP → gsplat)
- AI-generated labels/notes (extending the existing CLIP classifier)
- Team accounts
- Hosted shareable public pages (slug URLs instead of fragment payloads)
- Lead capture on the CTA

## Phase 4 — Verticals

- Construction progress tracking (site-photo diffing per phase)
- BIM integrations (IFC/Revit)
- Investor underwriting overlays (live cap-rate/ARV models)
- Agent CRM integrations
- Paid subscriptions
