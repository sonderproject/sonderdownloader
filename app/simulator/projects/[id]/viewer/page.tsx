"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Project } from "@/lib/spatial/types";
import { store } from "@/lib/spatial/store";
import { SimulatorScene } from "../../../viewer-ui";
import { ShareModal } from "../../../ui";

export default function ViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    setProject(store.get(id));
    setLoaded(true);
  }, [id]);

  if (!loaded) return null;
  if (!project) {
    return (
      <main className="min-h-screen flex items-center justify-center text-text">
        <div className="glass p-8 text-center">
          <p className="text-text-dim text-sm mb-4">Project not found.</p>
          <Link href="/simulator/dashboard" className="btn-primary no-underline">
            ← Dashboard
          </Link>
        </div>
      </main>
    );
  }

  const orderedPhases = project.phases
    .slice()
    .sort((a, b) => a.phaseOrder - b.phaseOrder);

  return (
    <>
      <SimulatorScene
        title={project.title}
        address={project.address}
        projectType={project.projectType}
        property={project.property}
        media={project.media}
        hotspots={project.hotspots}
        phases={orderedPhases}
        ctaLabel={project.ctaLabel}
        backHref={`/simulator/projects/${project.id}`}
        onShare={() => setSharing(true)}
      />
      {sharing && (
        <ShareModal
          project={project}
          onClose={() => setSharing(false)}
          onChange={setProject}
        />
      )}
    </>
  );
}
