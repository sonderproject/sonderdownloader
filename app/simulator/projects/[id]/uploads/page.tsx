"use client";

import {
  Suspense,
  useEffect,
  useRef,
  useState,
  DragEvent,
  ChangeEvent,
} from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Shell } from "../../../ui";
import {
  GenerationMode,
  GENERATION_MODE_LABEL,
  MediaItem,
  ProcessingState,
  PROCESSING_STATE_LABEL,
  Project,
  QUALITY_LABEL,
  newId,
} from "@/lib/spatial/types";
import { store } from "@/lib/spatial/store";
import {
  SUPPORTED_EXT,
  validateUpload,
  detectInputKind,
  detectProjectInputType,
  estimateCaptureQuality,
  runProcessing,
  ProcessingRun,
} from "@/lib/spatial/processing";

function UploadsInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [mode, setMode] = useState<GenerationMode | null>(null);
  const [state, setState] = useState<ProcessingState | null>(null);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const runRef = useRef<ProcessingRun | null>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    setProject(store.get(id));
    return () => runRef.current?.cancel();
  }, [id]);

  // Arriving from "Send to Simulator": photos are already attached —
  // start generating immediately, no clicks needed.
  useEffect(() => {
    if (autoStarted.current || !project) return;
    if (
      params.get("auto") &&
      project.media.length > 0 &&
      project.status !== "ready" &&
      state === null
    ) {
      autoStarted.current = true;
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  if (!project) return <Shell>{null}</Shell>;

  const fileNames = project.media.map((m) => ({
    name: m.label ? `${m.label}.jpg` : m.id.includes(".") ? m.id : `${m.id}.jpg`,
  }));
  const detected = project.media.length > 0 ? detectProjectInputType(fileNames) : null;
  const quality = project.media.length > 0 ? estimateCaptureQuality(fileNames) : null;
  const activeMode = mode ?? detected ?? "guided_tour";
  const processing = state !== null && state !== "ready";

  function addFiles(files: File[]) {
    const bad: string[] = [];
    const good: MediaItem[] = [];
    for (const f of files) {
      const v = validateUpload({ name: f.name, size: f.size });
      if (!v.ok) {
        bad.push(`${f.name} — ${v.reason}`);
        continue;
      }
      const kind = detectInputKind(f.name);
      good.push({
        id: `${newId("m")}.${f.name.split(".").pop()?.toLowerCase() ?? "jpg"}`,
        url: kind === "image" ? URL.createObjectURL(f) : f.name,
      });
    }
    setRejected(bad);
    if (good.length > 0) {
      const next = store.update(project!.id, {
        media: [...project!.media, ...good],
        status: "uploaded",
        thumbnail: project!.thumbnail ?? good[0]?.url,
      });
      if (next) setProject(next);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  }

  function handleGenerate() {
    if (processing || !project || project.media.length === 0) return;
    store.update(project.id, { status: "processing" });
    runRef.current = runProcessing((s, p) => {
      setState(s);
      setProgress(p);
      if (s === "ready") {
        const next = store.update(project.id, {
          status: "ready",
          scene: {
            id: newId("scn"),
            projectId: project.id,
            sceneType:
              activeMode === "model_import"
                ? "model_3d"
                : activeMode === "walkthrough_scan"
                  ? "gaussian_splat"
                  : "guided_tour",
            processingStatus: "ready",
            qualityScore: quality ?? undefined,
          },
        });
        if (next) setProject(next);
        setTimeout(
          () => router.push(`/simulator/projects/${project.id}/viewer`),
          900,
        );
      }
    });
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
        Upload &amp; generate
      </h1>

      <div className="max-w-2xl flex flex-col gap-6">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`glass p-10 text-center cursor-pointer transition block ${
            dragOver ? "ring-2 ring-accent" : ""
          }`}
        >
          <p className="text-text font-sans text-sm mb-2">
            Drag &amp; drop property media — or click to browse
          </p>
          <p className="microlabel text-[9px] opacity-70">
            {SUPPORTED_EXT.map((e) => `.${e}`).join("  ")}
          </p>
          <p className="microlabel text-[9px] opacity-50 mt-2">
            Coming soon: IFC · Revit · SketchUp · CAD · floor plans · PDF
          </p>
          <input
            type="file"
            multiple
            className="hidden"
            onChange={onPick}
            accept="image/*,video/*,.ply,.splat,.ksplat,.sog,.glb,.gltf"
          />
        </label>

        {rejected.length > 0 && (
          <div className="glass px-5 py-4 border-l-2 border-l-accent">
            {rejected.map((r) => (
              <p key={r} className="text-text-dim text-xs font-sans">
                {r}
              </p>
            ))}
          </div>
        )}

        {project.media.length > 0 && (
          <div className="glass p-6">
            <div className="grid grid-cols-6 md:grid-cols-8 gap-1.5 mb-6">
              {project.media.slice(0, 16).map((m) => (
                <div
                  key={m.id}
                  className="aspect-[4/3] rounded-sonder overflow-hidden bg-black/40"
                >
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
              {project.media.length > 16 && (
                <div className="aspect-[4/3] rounded-sonder bg-black/40 flex items-center justify-center">
                  <span className="microlabel text-[9px]">
                    +{project.media.length - 16}
                  </span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-5 mb-6">
              <div>
                <p className="microlabel mb-1">Files</p>
                <p className="text-text font-display text-lg">
                  {project.media.length}
                </p>
              </div>
              <div>
                <p className="microlabel mb-1">Capture quality</p>
                <p className="text-accent-bright font-sans text-sm">
                  {quality ? QUALITY_LABEL[quality] : "—"}
                </p>
              </div>
            </div>

            <p className="microlabel mb-2">Generation mode</p>
            <div className="flex flex-wrap gap-1 mb-6">
              {(Object.keys(GENERATION_MODE_LABEL) as GenerationMode[]).map(
                (m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    disabled={processing}
                    className={`px-3 py-2 text-xs uppercase tracking-widest rounded-sonder border transition ${
                      activeMode === m
                        ? "border-accent text-text bg-accent/20"
                        : "border-white/15 text-text-dim hover:text-text"
                    }`}
                  >
                    {GENERATION_MODE_LABEL[m]}
                    {detected === m ? " · detected" : ""}
                  </button>
                ),
              )}
            </div>

            {state === null ? (
              <button onClick={handleGenerate} className="btn-primary">
                Generate Simulator →
              </button>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="microlabel">
                    {PROCESSING_STATE_LABEL[state]}
                    {state !== "ready" && "…"}
                  </p>
                  <p className="microlabel text-accent-bright">
                    {Math.round(progress * 100)}%
                  </p>
                </div>
                <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent transition-[width] duration-500"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
                {state === "ready" && (
                  <p className="mt-3 text-accent-bright text-sm font-sans">
                    ✓ Scene ready — opening viewer…
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}

export default function UploadsPage() {
  return (
    <Suspense>
      <UploadsInner />
    </Suspense>
  );
}
