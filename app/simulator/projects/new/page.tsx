"use client";

import { Suspense, useEffect, useState, ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Shell } from "../../ui";
import {
  MediaItem,
  ProjectType,
  PROJECT_TYPE_LABEL,
  newId,
} from "@/lib/spatial/types";
import { store } from "@/lib/spatial/store";
import { SIMULATOR_STAGE_KEY } from "@/lib/simulator";
import type { ListingFacts } from "@/lib/sources";

const fieldCls =
  "w-full px-4 py-3 bg-black/25 border border-white/10 rounded-sonder text-text placeholder:text-text-subtle font-sans text-sm focus:outline-none focus:border-accent/60 transition";

type Stage = {
  photos?: { id: string; url: string; room?: string }[];
  facts?: ListingFacts;
  slug?: string;
};

function CreateProjectInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [projectType, setProjectType] = useState<ProjectType>("real_estate");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [stage, setStage] = useState<Stage | null>(null);
  const [busy, setBusy] = useState(false);

  // Photos staged from the downloader flow straight in.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SIMULATOR_STAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Stage;
      if (!Array.isArray(s.photos) || s.photos.length === 0) return;
      setStage(s);
      if (params.get("staged")) applyStage(s);
    } catch {
      // No stage.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyStage(s: Stage) {
    setMedia(
      (s.photos ?? []).map((p) => ({
        id: p.id,
        url: p.url,
        label:
          p.room && p.room !== "unknown"
            ? p.room.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
            : undefined,
      })),
    );
    if (s.facts?.address) {
      setAddress(s.facts.address);
      if (!title) setTitle(s.facts.address);
    } else if (s.slug && !title) {
      setTitle(s.slug.replace(/-/g, " "));
    }
  }

  function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const added: MediaItem[] = files
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => ({ id: newId("m"), url: URL.createObjectURL(f) }));
    setMedia((m) => [...m, ...added]);
  }

  function handleCreate() {
    if (!title.trim() || busy) return;
    setBusy(true);
    const stagedFacts = stage?.facts;
    const project = store.create({
      title: title.trim(),
      address: address.trim() || undefined,
      projectType,
      media,
      seedRoomHotspots: true,
      property: stagedFacts
        ? {
            price: stagedFacts.price,
            beds: stagedFacts.beds,
            baths: stagedFacts.baths,
            squareFeet: stagedFacts.sqft,
          }
        : undefined,
    });
    router.push(`/simulator/projects/${project.id}/uploads`);
  }

  return (
    <Shell>
      <p className="eyebrow mb-3">New Project</p>
      <h1 className="font-display text-text text-3xl md:text-5xl font-medium leading-tight mb-10">
        Create a simulator
      </h1>

      <div className="max-w-2xl flex flex-col gap-6">
        {stage && media.length === 0 && (
          <div className="glass px-5 py-4 border-l-2 border-l-accent">
            <p className="text-text text-sm font-sans mb-3">
              {stage.photos?.length} photo
              {stage.photos?.length === 1 ? "" : "s"} staged from the
              downloader.
            </p>
            <button onClick={() => applyStage(stage)} className="btn-primary">
              Use Staged Photos
            </button>
          </div>
        )}

        <div>
          <label className="microlabel block mb-2">Project name</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Luxury Coastal Listing"
            className={fieldCls}
            autoFocus
          />
        </div>

        <div>
          <label className="microlabel block mb-2">Address — optional</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Ocean Ave, Del Mar, CA"
            className={fieldCls}
          />
        </div>

        <div>
          <label className="microlabel block mb-2">Project type</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {(Object.keys(PROJECT_TYPE_LABEL) as ProjectType[]).map((t) => (
              <button
                key={t}
                onClick={() => setProjectType(t)}
                className={`glass !p-4 text-left transition ${
                  projectType === t
                    ? "ring-2 ring-accent"
                    : "opacity-70 hover:opacity-100"
                }`}
              >
                <span className="text-text text-sm font-sans">
                  {PROJECT_TYPE_LABEL[t]}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="microlabel block mb-2">
            Upload media {media.length > 0 && `— ${media.length} attached`}
          </label>
          <input
            type="file"
            accept="image/*,video/*,.ply,.splat,.ksplat,.sog,.glb,.gltf"
            multiple
            onChange={handleUpload}
            className="block w-full text-xs text-text-dim file:mr-3 file:px-4 file:py-2.5 file:rounded-sonder file:border-0 file:bg-accent/20 file:text-text file:text-xs file:uppercase file:tracking-widest file:cursor-pointer"
          />
          <p className="mt-2 microlabel text-[9px] opacity-70">
            You can add more (or scene files) on the next step.
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={handleCreate}
            disabled={!title.trim() || busy}
            className="btn-primary"
          >
            {busy ? "Creating…" : "Create Project →"}
          </button>
        </div>
      </div>
    </Shell>
  );
}

export default function CreateProject() {
  return (
    <Suspense>
      <CreateProjectInner />
    </Suspense>
  );
}
