"use client";

// Public share page — the whole tour travels in the URL fragment, so
// this opens on any device with no account and no backend.

import { useEffect, useState } from "react";
import Link from "next/link";
import { decodeShare, SharePayload } from "@/lib/spatial/store";
import { SimulatorScene } from "../viewer-ui";
import { Hotspot } from "@/lib/spatial/types";

export default function SharedSimulator() {
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const hash = window.location.hash.slice(1);
      const encoded = hash.includes("=")
        ? hash.slice(hash.indexOf("=") + 1)
        : hash;
      if (encoded) setPayload(await decodeShare(encoded));
      setLoaded(true);
    })();
  }, []);

  if (!loaded) return null;

  if (!payload || payload.visibility === "private") {
    return (
      <main className="min-h-screen flex items-center justify-center text-text">
        <div className="glass p-8 text-center max-w-md">
          <p className="eyebrow mb-3">Sonder Simulation</p>
          <p className="text-text-dim text-sm leading-relaxed mb-5">
            This simulator link is invalid or has been set to private.
          </p>
          <Link href="/simulator" className="btn-primary no-underline">
            Sonder Simulation →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <SimulatorScene
      title={payload.title}
      address={payload.address}
      projectType={payload.projectType}
      property={payload.property}
      media={payload.media}
      hotspots={payload.hotspots as Hotspot[]}
      phases={payload.phases}
      ctaLabel={payload.ctaLabel}
    />
  );
}
