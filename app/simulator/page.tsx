"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ROOM_LABEL } from "@/lib/rooms";
import {
  SIMULATOR_STAGE_KEY,
  SimulatorStage,
  simulatorReady,
  runSimulation,
} from "@/lib/simulator";

export default function Simulator() {
  const [stage, setStage] = useState<SimulatorStage | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SIMULATOR_STAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as SimulatorStage;
        if (Array.isArray(s.photos) && s.photos.length > 0) {
          setStage(s);
          setSelected(new Set(s.photos.map((p) => p.id)));
        }
      }
    } catch {
      // Corrupt stage — treated as empty.
    }
    setLoaded(true);
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleGenerate() {
    if (!stage || busy) return;
    setBusy(true);
    setError(null);
    try {
      await runSimulation({
        photos: stage.photos.filter((p) => selected.has(p.id)),
        facts: stage.facts,
        slug: stage.slug,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed.");
    } finally {
      setBusy(false);
    }
  }

  const ready = simulatorReady();

  return (
    <main className="min-h-screen w-full flex flex-col text-text">
      <nav className="w-full px-6 md:px-14 pt-8">
        <div className="max-w-[1100px] mx-auto flex items-center justify-between">
          <Link
            href="/"
            className="font-display text-text text-lg tracking-tight font-medium"
          >
            Sonder Project
          </Link>
          <Link
            href="/"
            className="microlabel hover:text-accent-bright transition"
          >
            ← back to photos
          </Link>
        </div>
      </nav>

      <section className="flex-1 px-6 md:px-14 pt-16 pb-24">
        <div className="max-w-[1100px] mx-auto">
          <p className="eyebrow mb-5">Utility № 002</p>
          <h1 className="font-display text-text text-4xl md:text-6xl leading-[0.98] tracking-tight font-medium max-w-3xl">
            Property{" "}
            <span
              style={{
                background:
                  "linear-gradient(180deg, #6FC3F0 0%, #3E9BD4 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Simulator
            </span>
          </h1>

          {!loaded ? null : !stage ? (
            <div className="mt-10 glass p-6 max-w-xl">
              <p className="text-text-dim text-sm leading-relaxed">
                Nothing staged yet. Extract or upload photos on the main page,
                then click <span className="text-text">Send to Simulator</span>.
              </p>
              <Link href="/" className="btn-primary inline-block mt-5 no-underline">
                ← Get Photos
              </Link>
            </div>
          ) : (
            <>
              <p className="mt-6 font-sans text-text-dim max-w-2xl text-base leading-relaxed">
                {stage.facts.address || stage.slug}
                {stage.facts.price ? ` · ${stage.facts.price}` : ""}
                {stage.facts.beds ? ` · ${stage.facts.beds} bd` : ""}
                {stage.facts.baths ? ` · ${stage.facts.baths} ba` : ""}
                {stage.facts.sqft ? ` · ${stage.facts.sqft} sqft` : ""}
              </p>

              <div className="mt-10 flex flex-wrap items-center gap-4">
                <button
                  onClick={handleGenerate}
                  disabled={busy || !ready || selected.size === 0}
                  className="btn-primary"
                  title={
                    ready
                      ? "Run the simulator on the selected photos"
                      : "The simulator engine lands here next — photos are staged and ready"
                  }
                >
                  {busy ? "Simulating…" : "Generate Simulation"}
                </button>
                <span className="microlabel">
                  {selected.size} / {stage.photos.length} photos selected —
                  click a photo to toggle
                </span>
              </div>

              {!ready && (
                <p className="mt-4 microlabel text-[10px] opacity-80 max-w-lg">
                  Coming soon — the simulation engine plugs into
                  lib/simulator.ts. Your photo selection and listing details
                  are already wired to it.
                </p>
              )}

              {error && (
                <div className="mt-6 glass px-5 py-4 border-l-2 border-l-accent text-text-dim text-sm font-sans max-w-2xl leading-relaxed">
                  {error}
                </div>
              )}

              <div className="mt-10 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {stage.photos.map((p, i) => {
                  const on = selected.has(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggle(p.id)}
                      className={`glass overflow-hidden !p-0 relative text-left transition ${
                        on
                          ? "ring-2 ring-accent"
                          : "opacity-50 hover:opacity-80"
                      }`}
                      title={on ? "Selected — click to exclude" : "Excluded — click to include"}
                    >
                      <div className="relative aspect-[4/3] bg-black/30">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.url}
                          alt={`Photo ${i + 1}`}
                          loading="lazy"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.currentTarget.parentElement!
                              .parentElement as HTMLElement).style.display =
                              "none";
                          }}
                        />
                        <span className="absolute top-2 left-2 microlabel text-[9px] text-text bg-black/60 px-2 py-1 rounded-sonder">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        {p.room !== "unknown" && (
                          <span className="absolute bottom-2 right-2 microlabel text-[9px] text-text bg-accent/80 px-2 py-1 rounded-sonder">
                            {ROOM_LABEL[p.room]}
                          </span>
                        )}
                        {on && (
                          <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent text-[11px] text-white flex items-center justify-center">
                            ✓
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </section>

      <footer className="w-full px-6 md:px-14 pb-10">
        <div className="max-w-[1100px] mx-auto flex flex-col md:flex-row md:justify-between gap-2 microlabel">
          <span>Sonder Project · MMXXVI</span>
          <span>A stateless utility · sonderproject.co</span>
        </div>
      </footer>
    </main>
  );
}
