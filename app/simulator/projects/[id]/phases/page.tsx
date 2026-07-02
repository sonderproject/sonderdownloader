"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Shell } from "../../../ui";
import { Phase, Project, newId } from "@/lib/spatial/types";
import { store } from "@/lib/spatial/store";

const fieldCls =
  "w-full px-3 py-2 bg-black/25 border border-white/10 rounded-sonder text-text placeholder:text-text-subtle font-sans text-sm focus:outline-none focus:border-accent/60 transition";

export default function PhasesPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    setProject(store.get(id));
  }, [id]);

  if (!project) return <Shell>{null}</Shell>;

  const phases = project.phases.slice().sort((a, b) => a.phaseOrder - b.phaseOrder);

  function save(next: Phase[]) {
    const renumbered = next.map((p, i) => ({ ...p, phaseOrder: i }));
    const updated = store.update(project!.id, { phases: renumbered });
    if (updated) setProject(updated);
  }

  function handleAdd() {
    if (!title.trim()) return;
    save([
      ...phases,
      {
        id: newId("ph"),
        projectId: project!.id,
        title: title.trim(),
        phaseOrder: phases.length,
        phaseType: "planned",
      },
    ]);
    setTitle("");
  }

  function move(i: number, dir: -1 | 1) {
    const next = phases.slice();
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  }

  function rename(i: number, value: string) {
    const next = phases.slice();
    next[i] = { ...next[i], title: value };
    save(next);
  }

  return (
    <Shell>
      <Link
        href={`/simulator/projects/${project.id}`}
        className="microlabel hover:text-accent-bright transition no-underline"
      >
        ← {project.title}
      </Link>
      <h1 className="mt-4 font-display text-text text-3xl md:text-5xl font-medium leading-tight mb-4">
        4D Timeline
      </h1>
      <p className="text-text-dim text-sm leading-relaxed mb-10 max-w-xl">
        Phases drive the timeline slider in the viewer — early phases render
        as skeletal structure, later phases as the finished build.
      </p>

      <div className="max-w-xl flex flex-col gap-2">
        {phases.map((p, i) => (
          <div key={p.id} className="glass px-4 py-3 flex items-center gap-3">
            <span className="microlabel text-[10px] text-accent-bright w-6">
              {String(i + 1).padStart(2, "0")}
            </span>
            <input
              value={p.title}
              onChange={(e) => rename(i, e.target.value)}
              className="flex-1 bg-transparent text-text text-sm font-sans focus:outline-none border-b border-transparent focus:border-accent/50 transition"
            />
            <button
              onClick={() => move(i, -1)}
              disabled={i === 0}
              className="microlabel opacity-50 hover:opacity-100 disabled:opacity-15 transition"
              title="Move up"
            >
              ↑
            </button>
            <button
              onClick={() => move(i, 1)}
              disabled={i === phases.length - 1}
              className="microlabel opacity-50 hover:opacity-100 disabled:opacity-15 transition"
              title="Move down"
            >
              ↓
            </button>
            <button
              onClick={() => save(phases.filter((x) => x.id !== p.id))}
              className="microlabel text-[10px] opacity-50 hover:opacity-100 transition"
              title="Delete phase"
            >
              ✕
            </button>
          </div>
        ))}

        <div className="glass px-4 py-3 flex items-center gap-3 mt-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="New phase — e.g. Framing"
            className={fieldCls}
          />
          <button
            onClick={handleAdd}
            disabled={!title.trim()}
            className="btn-primary whitespace-nowrap"
          >
            Add
          </button>
        </div>
      </div>
    </Shell>
  );
}
