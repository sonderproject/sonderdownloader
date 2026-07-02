"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "./ui";
import { SIMULATOR_STAGE_KEY } from "@/lib/simulator";
import { store } from "@/lib/spatial/store";

const USE_CASES = [
  {
    name: "Real Estate",
    line: "Walkable listing tours that sell the home before the showing.",
  },
  {
    name: "Investors",
    line: "Before/after states, rehab notes, and deal numbers in the walls.",
  },
  {
    name: "Architecture",
    line: "Walk clients through buildings that don't exist yet.",
  },
  {
    name: "Construction",
    line: "A 4D timeline from foundation to final walkthrough.",
  },
];

export default function SimulationLanding() {
  const [staged, setStaged] = useState(0);
  const [demoId, setDemoId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SIMULATOR_STAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { photos?: unknown[] };
        if (Array.isArray(s.photos)) setStaged(s.photos.length);
      }
    } catch {
      // No stage.
    }
    const ready = store.list().find((p) => p.status === "ready");
    if (ready) setDemoId(ready.id);
  }, []);

  return (
    <Shell>
      <p className="eyebrow mb-5">Sonder Simulation</p>
      <h1 className="font-display text-text text-4xl md:text-6xl leading-[1.02] tracking-tight font-medium max-w-4xl">
        Build digital worlds for properties{" "}
        <span
          style={{
            background: "linear-gradient(180deg, #6FC3F0 0%, #3E9BD4 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          before, during, and after
        </span>{" "}
        they exist.
      </h1>
      <p className="mt-6 font-sans text-text-dim max-w-2xl text-base md:text-lg leading-relaxed">
        4D property simulators for real estate, architecture, investors, and
        construction. Upload property media, generate a walkable simulator,
        drop notes into the space, and share it with a link.
      </p>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/simulator/projects/new" className="btn-primary no-underline">
          Create Simulator
        </Link>
        {demoId && (
          <Link
            href={`/simulator/projects/${demoId}/viewer`}
            className="btn-ghost no-underline"
          >
            View Demo
          </Link>
        )}
        <Link href="/simulator/dashboard" className="btn-ghost no-underline">
          Dashboard
        </Link>
      </div>

      {staged > 0 && (
        <div className="mt-8 glass px-5 py-4 border-l-2 border-l-accent max-w-xl">
          <p className="text-text text-sm font-sans">
            {staged} photo{staged === 1 ? "" : "s"} staged from the
            downloader — ready to become a simulator.
          </p>
          <Link
            href="/simulator/projects/new?staged=1"
            className="btn-primary inline-block mt-3 no-underline"
          >
            Create From Staged Photos →
          </Link>
        </div>
      )}

      <div className="mt-20 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {USE_CASES.map((u) => (
          <div key={u.name} className="glass p-6">
            <p className="microlabel mb-3 text-accent-bright">{u.name}</p>
            <p className="text-text-dim text-sm leading-relaxed">{u.line}</p>
          </div>
        ))}
      </div>

      <div className="mt-20 max-w-2xl">
        <p className="eyebrow mb-4">3D → 4D</p>
        <h2 className="font-display text-text text-2xl md:text-3xl font-medium leading-tight mb-4">
          The fourth dimension is time.
        </h2>
        <p className="text-text-dim text-sm md:text-base leading-relaxed">
          <span className="text-text">3D</span> is a walkable spatial
          experience of a property as it stands.{" "}
          <span className="text-text">4D</span> adds time: construction
          phases, before/after renovation states, future-build previews, and
          design options — the same space, walked through at different moments
          of its life.
        </p>
      </div>
    </Shell>
  );
}
