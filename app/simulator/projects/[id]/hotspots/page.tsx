"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Shell } from "../../../ui";
import {
  Hotspot,
  HotspotType,
  HOTSPOT_TYPE_LABEL,
  HOTSPOT_TYPES_FOR,
  HOTSPOT_PLACEHOLDER,
  Project,
  newId,
} from "@/lib/spatial/types";
import { store, autoPosition } from "@/lib/spatial/store";

const fieldCls =
  "w-full px-3 py-2 bg-black/25 border border-white/10 rounded-sonder text-text placeholder:text-text-subtle font-sans text-sm focus:outline-none focus:border-accent/60 transition";

export default function HotspotsPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [type, setType] = useState<HotspotType | null>(null);

  useEffect(() => {
    setProject(store.get(id));
  }, [id]);

  if (!project) return <Shell>{null}</Shell>;

  const leadTypes = HOTSPOT_TYPES_FOR[project.projectType];
  const allTypes = Object.keys(HOTSPOT_TYPE_LABEL) as HotspotType[];
  const orderedTypes = [
    ...leadTypes,
    ...allTypes.filter((t) => !leadTypes.includes(t)),
  ];
  const activeType = type ?? leadTypes[0];

  function save(hotspots: Hotspot[]) {
    const next = store.update(project!.id, { hotspots });
    if (next) setProject(next);
  }

  function handleAdd() {
    if (!title.trim()) return;
    save([
      ...project!.hotspots,
      {
        id: newId("hs"),
        projectId: project!.id,
        title: title.trim(),
        description: desc.trim() || undefined,
        hotspotType: activeType,
        position: autoPosition(project!.hotspots.length),
      },
    ]);
    setTitle("");
    setDesc("");
  }

  return (
    <Shell>
      <Link
        href={`/simulator/projects/${project.id}`}
        className="microlabel hover:text-accent-bright transition no-underline"
      >
        ← {project.title}
      </Link>
      <h1 className="mt-4 font-display text-text text-3xl md:text-5xl font-medium leading-tight mb-10">
        Hotspots
      </h1>

      <div className="grid md:grid-cols-2 gap-6 max-w-4xl">
        <div className="glass p-6">
          <p className="microlabel mb-4">Add hotspot</p>
          <div className="flex flex-wrap gap-1 mb-4">
            {orderedTypes.map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-2.5 py-1.5 text-[10px] uppercase tracking-widest rounded-sonder border transition ${
                  activeType === t
                    ? "border-accent text-text bg-accent/20"
                    : "border-white/15 text-text-dim hover:text-text"
                }`}
              >
                {HOTSPOT_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={HOTSPOT_PLACEHOLDER[project.projectType]}
            className={`${fieldCls} mb-3`}
          />
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Description — optional"
            rows={2}
            className={`${fieldCls} mb-4`}
          />
          <button
            onClick={handleAdd}
            disabled={!title.trim()}
            className="btn-primary"
          >
            Add Hotspot
          </button>
          <p className="mt-3 microlabel text-[9px] opacity-70">
            Placed automatically in the scene — drag-to-position editing
            arrives in Phase 2.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {project.hotspots.length === 0 && (
            <p className="text-text-dim text-sm">No hotspots yet.</p>
          )}
          {project.hotspots.map((h) => (
            <div key={h.id} className="glass px-4 py-3 flex items-start gap-3">
              <span className="mt-1 w-2 h-2 rounded-full bg-accent-bright shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-text text-sm font-sans">{h.title}</p>
                <p className="microlabel text-[9px] mt-0.5">
                  {HOTSPOT_TYPE_LABEL[h.hotspotType]}
                </p>
                {h.description && (
                  <p className="text-text-dim text-xs mt-1 leading-relaxed">
                    {h.description}
                  </p>
                )}
              </div>
              <button
                onClick={() =>
                  save(project.hotspots.filter((x) => x.id !== h.id))
                }
                className="microlabel text-[10px] opacity-50 hover:opacity-100 transition"
                title="Delete hotspot"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
