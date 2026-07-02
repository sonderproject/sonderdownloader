"use client";

// The simulator experience itself — shared by the in-app viewer page
// and the public share page. Three.js engine is loaded on demand.

import { useEffect, useRef, useState } from "react";
import {
  Hotspot,
  MediaItem,
  ProjectType,
  Property,
  CTA_LABEL,
} from "@/lib/spatial/types";
import type { ViewerHandle } from "@/lib/spatial/viewer";

export type SimulatorSceneProps = {
  title: string;
  address?: string;
  projectType: ProjectType;
  property: Property;
  media: MediaItem[];
  hotspots: Hotspot[];
  phases: { title: string }[];
  ctaLabel?: string;
  onShare?: () => void;
  backHref?: string;
};

export function SimulatorScene(props: SimulatorSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<ViewerHandle | null>(null);
  const [locked, setLocked] = useState(false);
  const [fast, setFast] = useState(false);
  const [touring, setTouring] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(props.phases.length - 1);
  const [after, setAfter] = useState(true);
  const [ctaOpen, setCtaOpen] = useState(false);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const { createViewer } = await import("@/lib/spatial/viewer");
      if (disposed || !mountRef.current) return;
      handleRef.current = createViewer(mountRef.current, {
        media: props.media,
        hotspots: props.hotspots,
        onLockChange: setLocked,
      });
      handleRef.current.setPhaseRatio(
        props.phases.length > 1 ? phaseIdx / (props.phases.length - 1) : 1,
      );
    })();
    return () => {
      disposed = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setPhase(i: number) {
    setPhaseIdx(i);
    handleRef.current?.setPhaseRatio(
      props.phases.length > 1 ? i / (props.phases.length - 1) : 1,
    );
  }

  function toggleAfter() {
    const next = !after;
    setAfter(next);
    handleRef.current?.setAfter(next);
  }

  function toggleTour() {
    const h = handleRef.current;
    if (!h) return;
    if (h.isTouring()) {
      h.stopTour();
      setTouring(false);
    } else {
      h.startTour();
      setTouring(true);
    }
  }

  function togglePresent() {
    const next = !presenting;
    setPresenting(next);
    const el = wrapRef.current;
    if (!el) return;
    if (next && !document.fullscreenElement) {
      void el.requestFullscreen?.().catch(() => {});
    } else if (!next && document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    }
  }

  const showBeforeAfter =
    props.projectType === "investor" || props.projectType === "construction";
  const cta = props.ctaLabel ?? CTA_LABEL[props.projectType];
  const p = props.property;
  const infoBits =
    props.projectType === "investor"
      ? [
          p.price && `Purchase ${p.price}`,
          p.squareFeet && `${p.squareFeet} sqft`,
          `${props.hotspots.length} notes`,
        ]
      : [
          p.price,
          p.beds && `${p.beds} bd`,
          p.baths && `${p.baths} ba`,
          p.squareFeet && `${p.squareFeet} sqft`,
        ];

  return (
    <div
      ref={wrapRef}
      className="relative w-full h-[100dvh] bg-[#0A0A09] overflow-hidden"
    >
      <div ref={mountRef} className="absolute inset-0" />

      {/* Top-left: property overlay */}
      {!presenting && (
        <div className="absolute top-5 left-5 glass px-5 py-4 max-w-xs pointer-events-none">
          <p className="microlabel text-[9px] mb-1 text-accent-bright">
            Sonder Simulation
          </p>
          <h2 className="font-display text-text text-lg leading-snug">
            {props.title}
          </h2>
          {props.address && props.address !== props.title && (
            <p className="microlabel text-[9px] mt-1 opacity-70">
              {props.address}
            </p>
          )}
          <p className="text-text-dim text-xs font-sans mt-2">
            {infoBits.filter(Boolean).join(" · ")}
          </p>
        </div>
      )}

      {/* Top-right: controls */}
      <div className="absolute top-5 right-5 flex flex-wrap gap-2 justify-end">
        {!presenting && (
          <>
            {props.backHref && (
              <a href={props.backHref} className="btn-ghost no-underline">
                ← Exit
              </a>
            )}
            <button
              onClick={() => handleRef.current?.reset()}
              className="btn-ghost"
            >
              Reset
            </button>
            <button
              onClick={() => {
                const next = !fast;
                setFast(next);
                handleRef.current?.setSpeed(next ? 2.2 : 1);
              }}
              className="btn-ghost"
            >
              Speed {fast ? "2×" : "1×"}
            </button>
            <button onClick={toggleTour} className="btn-ghost">
              {touring ? "Stop Tour" : "Cinematic Tour"}
            </button>
            {props.onShare && (
              <button onClick={props.onShare} className="btn-ghost">
                Share
              </button>
            )}
          </>
        )}
        <button onClick={togglePresent} className="btn-primary">
          {presenting ? "Exit Presentation" : "Presentation Mode"}
        </button>
      </div>

      {/* Movement hint */}
      {!locked && !touring && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="glass px-6 py-4 text-center">
            <p className="text-text text-sm font-sans">
              Click to look around
            </p>
            <p className="microlabel text-[9px] mt-1 opacity-70">
              WASD to walk · ESC to release
            </p>
          </div>
        </div>
      )}

      {/* Bottom: timeline + before/after + CTA */}
      <div className="absolute bottom-5 left-5 right-5 flex flex-col md:flex-row md:items-end gap-3">
        {props.phases.length > 1 && (
          <div className="glass px-5 py-4 flex-1 max-w-2xl">
            <div className="flex items-center justify-between mb-2">
              <p className="microlabel text-[9px]">4D Timeline</p>
              <p className="microlabel text-[9px] text-accent-bright">
                {props.phases[phaseIdx]?.title}
              </p>
            </div>
            <input
              type="range"
              min={0}
              max={props.phases.length - 1}
              step={1}
              value={phaseIdx}
              onChange={(e) => setPhase(parseInt(e.target.value, 10))}
              className="w-full accent-accent"
            />
            <div className="flex justify-between mt-1">
              <span className="microlabel text-[8px] opacity-50">
                {props.phases[0]?.title}
              </span>
              <span className="microlabel text-[8px] opacity-50">
                {props.phases[props.phases.length - 1]?.title}
              </span>
            </div>
          </div>
        )}
        {!presenting && (
          <div className="flex gap-2 md:ml-auto">
            {showBeforeAfter && (
              <button onClick={toggleAfter} className="btn-ghost">
                {after ? "View Before" : "View After"}
              </button>
            )}
            <button onClick={() => setCtaOpen(true)} className="btn-primary">
              {cta}
            </button>
          </div>
        )}
      </div>

      {ctaOpen && (
        <div
          className="absolute inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
          onClick={() => setCtaOpen(false)}
        >
          <div
            className="glass p-8 max-w-md w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="eyebrow mb-3">{cta}</p>
            <p className="text-text-dim text-sm leading-relaxed mb-5">
              {p.agentName
                ? `Reach out to ${p.agentName}${p.agentPhone ? ` · ${p.agentPhone}` : ""}${p.agentEmail ? ` · ${p.agentEmail}` : ""}`
                : "Lead capture connects here — agent contact routing lands in Phase 3 of the roadmap."}
            </p>
            <button onClick={() => setCtaOpen(false)} className="btn-primary">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
