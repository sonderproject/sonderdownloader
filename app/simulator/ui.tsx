"use client";

// Sonder Simulation — shared chrome: page shell, badges, share modal.

import { useState } from "react";
import Link from "next/link";
import {
  Project,
  ProjectStatus,
  ProjectType,
  Visibility,
  PROJECT_TYPE_LABEL,
  STATUS_LABEL,
} from "@/lib/spatial/types";
import { store, encodeShare } from "@/lib/spatial/store";

export function Shell({
  children,
  wide,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="min-h-screen w-full flex flex-col text-text">
      <nav className="w-full px-6 md:px-14 pt-8">
        <div className="max-w-[1100px] mx-auto flex items-center justify-between">
          <Link
            href="/simulator"
            className="font-display text-text text-lg tracking-tight font-medium"
          >
            Sonder <span className="text-accent-bright">Simulation</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/simulator/dashboard"
              className="microlabel hover:text-accent-bright transition"
            >
              Dashboard
            </Link>
            <Link
              href="/"
              className="microlabel hover:text-accent-bright transition"
            >
              Downloader ↗
            </Link>
          </div>
        </div>
      </nav>
      <section className="flex-1 px-6 md:px-14 pt-12 pb-24">
        <div className={`${wide ? "max-w-[1280px]" : "max-w-[1100px]"} mx-auto`}>
          {children}
        </div>
      </section>
      <footer className="w-full px-6 md:px-14 pb-10">
        <div className="max-w-[1100px] mx-auto flex flex-col md:flex-row md:justify-between gap-2 microlabel">
          <span>Sonder Project · MMXXVI</span>
          <span>4D property simulators · sonderproject.co</span>
        </div>
      </footer>
    </main>
  );
}

const STATUS_TONE: Record<ProjectStatus, string> = {
  draft: "bg-white/10 text-text-dim",
  uploaded: "bg-accent/15 text-accent-bright",
  processing: "bg-accent/25 text-accent-bright",
  ready: "bg-emerald-400/15 text-emerald-300",
  failed: "bg-red-400/15 text-red-300",
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={`microlabel text-[9px] px-2 py-1 rounded-sonder ${STATUS_TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function TypeBadge({ type }: { type: ProjectType }) {
  return (
    <span className="microlabel text-[9px] px-2 py-1 rounded-sonder border border-white/15 text-text-dim">
      {PROJECT_TYPE_LABEL[type]}
    </span>
  );
}

export function ShareModal({
  project,
  onClose,
  onChange,
}: {
  project: Project;
  onClose: () => void;
  onChange: (p: Project) => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function buildLink() {
    const encoded = await encodeShare(project);
    return `${window.location.origin}/simulator/s#${project.shareSlug}=${encoded}`;
  }

  async function handleCopy() {
    const url = link ?? (await buildLink());
    setLink(url);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Field below stays selectable as fallback.
    }
  }

  async function handlePreview() {
    const url = link ?? (await buildLink());
    setLink(url);
    window.open(url, "_blank");
  }

  function setVisibility(v: Visibility) {
    const next = store.update(project.id, { visibility: v });
    if (next) onChange(next);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="glass p-6 md:p-8 w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="eyebrow mb-2">Share Simulator</p>
            <h3 className="font-display text-text text-xl font-medium">
              {project.title}
            </h3>
          </div>
          <button onClick={onClose} className="btn-ghost !px-3 !py-2">
            ✕
          </button>
        </div>

        <p className="microlabel mb-2">Visibility</p>
        <div className="flex gap-1 mb-5">
          {(["private", "unlisted", "public"] as Visibility[]).map((v) => (
            <button
              key={v}
              onClick={() => setVisibility(v)}
              className={`px-3 py-2 text-xs uppercase tracking-widest rounded-sonder border transition ${
                project.visibility === v
                  ? "border-accent text-text bg-accent/20"
                  : "border-white/15 text-text-dim hover:text-text"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {project.visibility === "private" ? (
          <p className="text-text-dim text-sm leading-relaxed mb-5">
            Private projects have no live link. Switch to unlisted or public
            to share.
          </p>
        ) : (
          <>
            <p className="microlabel mb-2">Simulator link</p>
            <div className="flex gap-2 mb-2">
              <button onClick={handleCopy} className="btn-primary">
                {copied ? "Copied" : "Copy Link"}
              </button>
              <button onClick={handlePreview} className="btn-ghost">
                Preview ↗
              </button>
            </div>
            {link && (
              <input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full px-3 py-2 bg-black/25 border border-white/10 rounded-sonder text-text-dim font-mono text-[10px] focus:outline-none"
              />
            )}
            <p className="mt-3 microlabel text-[9px] opacity-70">
              The link carries the full tour — it opens on any device, no
              account needed. Password protection is on the roadmap.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
