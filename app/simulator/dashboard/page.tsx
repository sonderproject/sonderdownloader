"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell, StatusBadge, TypeBadge, timeAgo } from "../ui";
import { Project } from "@/lib/spatial/types";
import { store } from "@/lib/spatial/store";

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[] | null>(null);

  useEffect(() => {
    setProjects(store.list());
  }, []);

  return (
    <Shell>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5 mb-10">
        <div>
          <p className="eyebrow mb-3">Dashboard</p>
          <h1 className="font-display text-text text-3xl md:text-5xl font-medium leading-tight">
            Simulators
          </h1>
        </div>
        <Link href="/simulator/projects/new" className="btn-primary no-underline">
          Create New Project
        </Link>
      </div>

      {projects && projects.length === 0 && (
        <div className="glass p-8 max-w-xl">
          <p className="text-text-dim text-sm leading-relaxed">
            No projects yet. Create one, or send photos over from the
            downloader.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(projects ?? []).map((p) => (
          <div key={p.id} className="glass overflow-hidden !p-0 flex flex-col">
            <Link
              href={`/simulator/projects/${p.id}`}
              className="block relative aspect-[16/9] bg-black/40 no-underline"
            >
              {p.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.thumbnail}
                  alt={p.title}
                  className="w-full h-full object-cover"
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent/25 via-black/20 to-black/60">
                  <span className="font-display text-3xl text-text/70">
                    {p.title.slice(0, 1)}
                  </span>
                </div>
              )}
              <span className="absolute top-2 right-2">
                <StatusBadge status={p.status} />
              </span>
            </Link>
            <div className="p-5 flex flex-col gap-3 flex-1">
              <div>
                <h3 className="font-display text-text text-lg font-medium leading-snug">
                  {p.title}
                </h3>
                {p.address && (
                  <p className="microlabel text-[9px] mt-1">{p.address}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <TypeBadge type={p.projectType} />
                <span className="microlabel text-[9px] opacity-60">
                  {timeAgo(p.updatedAt)}
                </span>
              </div>
              <div className="mt-auto flex gap-2">
                <Link
                  href={`/simulator/projects/${p.id}`}
                  className="btn-ghost no-underline"
                >
                  Open
                </Link>
                {p.status === "ready" && (
                  <Link
                    href={`/simulator/projects/${p.id}/viewer`}
                    className="btn-primary no-underline"
                  >
                    Viewer →
                  </Link>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
