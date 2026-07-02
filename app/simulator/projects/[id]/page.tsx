"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Shell, ShareModal, StatusBadge, TypeBadge, timeAgo } from "../../ui";
import { Project, PROCESSING_STATE_LABEL } from "@/lib/spatial/types";
import { store } from "@/lib/spatial/store";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    setProject(store.get(id));
    setLoaded(true);
  }, [id]);

  if (!loaded) return <Shell>{null}</Shell>;
  if (!project) {
    return (
      <Shell>
        <p className="text-text-dim">Project not found.</p>
        <Link href="/simulator/dashboard" className="btn-ghost inline-block mt-4 no-underline">
          ← Dashboard
        </Link>
      </Shell>
    );
  }

  const ready = project.status === "ready";
  const stats = [
    { k: "Media", v: `${project.media.length} file${project.media.length === 1 ? "" : "s"}` },
    {
      k: "Scene",
      v: project.scene
        ? PROCESSING_STATE_LABEL[project.scene.processingStatus]
        : "Not generated",
    },
    { k: "Hotspots", v: String(project.hotspots.length) },
    { k: "Phases", v: String(project.phases.length) },
  ];

  return (
    <Shell>
      <Link href="/simulator/dashboard" className="microlabel hover:text-accent-bright transition no-underline">
        ← Dashboard
      </Link>
      <div className="mt-4 flex flex-col md:flex-row md:items-end md:justify-between gap-5 mb-10">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <TypeBadge type={project.projectType} />
            <StatusBadge status={project.status} />
            <span className="microlabel text-[9px] opacity-60">
              updated {timeAgo(project.updatedAt)}
            </span>
          </div>
          <h1 className="font-display text-text text-3xl md:text-5xl font-medium leading-tight">
            {project.title}
          </h1>
          {project.address && (
            <p className="mt-2 text-text-dim text-sm">{project.address}</p>
          )}
        </div>
        <div className="flex gap-2">
          {ready ? (
            <Link
              href={`/simulator/projects/${project.id}/viewer`}
              className="btn-primary no-underline"
            >
              Open Viewer →
            </Link>
          ) : (
            <Link
              href={`/simulator/projects/${project.id}/uploads`}
              className="btn-primary no-underline"
            >
              {project.media.length > 0 ? "Generate Simulator →" : "Upload Media →"}
            </Link>
          )}
          <button onClick={() => setSharing(true)} className="btn-ghost">
            Share
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        {stats.map((s) => (
          <div key={s.k} className="glass p-5">
            <p className="microlabel mb-2">{s.k}</p>
            <p className="text-text font-display text-xl">{s.v}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={`/simulator/projects/${project.id}/uploads`} className="btn-ghost no-underline">
          Upload Media
        </Link>
        <Link href={`/simulator/projects/${project.id}/hotspots`} className="btn-ghost no-underline">
          Manage Hotspots
        </Link>
        <Link href={`/simulator/projects/${project.id}/phases`} className="btn-ghost no-underline">
          Manage Phases
        </Link>
        <Link href={`/simulator/projects/${project.id}/settings`} className="btn-ghost no-underline">
          Settings
        </Link>
      </div>

      {project.media.length > 0 && (
        <div className="mt-10">
          <p className="microlabel mb-3">Media</p>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {project.media.slice(0, 12).map((m) => (
              <div key={m.id} className="glass !p-0 overflow-hidden aspect-[4/3] bg-black/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.url}
                  alt={m.label ?? ""}
                  loading="lazy"
                  className="w-full h-full object-cover"
                  onError={(e) => (e.currentTarget.style.opacity = "0.15")}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {sharing && (
        <ShareModal
          project={project}
          onClose={() => setSharing(false)}
          onChange={setProject}
        />
      )}
    </Shell>
  );
}
