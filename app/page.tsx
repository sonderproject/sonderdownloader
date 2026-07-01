"use client";

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  FormEvent,
  ChangeEvent,
} from "react";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ROOM_KEYS,
  ROOM_LABEL,
  RoomKey,
  promptFor,
  walkthroughRank,
} from "@/lib/rooms";
import {
  renderWalkthroughVideo,
  VideoProgress,
  DEFAULT_VIDEO_OPTIONS,
} from "@/lib/video";

type Photo = {
  id: string;
  url: string;
  room: RoomKey;
};

const PHOTO_HASH_RE =
  /photos\.zillowstatic\.com\\?\/fp\\?\/([a-zA-Z0-9]{8,})-cc_ft_\d+\.(?:jpg|webp)/g;

function extractHashesFromHtml(html: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const m of html.matchAll(PHOTO_HASH_RE)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      ordered.push(m[1]);
    }
  }
  return ordered;
}

function slugFromZillowText(text: string): string {
  const m = text.match(/\/homedetails\/([a-zA-Z0-9-]+)/);
  if (m) return m[1].toLowerCase();
  return "listing";
}

function hashesToPhotos(hashes: string[]): Photo[] {
  return hashes.map((h) => ({
    id: h,
    url: `https://photos.zillowstatic.com/fp/${h}-cc_ft_1536.jpg`,
    room: "unknown" as RoomKey,
  }));
}

function PhotoCard({
  photo,
  index,
  onRoomChange,
}: {
  photo: Photo;
  index: number;
  onRoomChange: (id: string, room: RoomKey) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: photo.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.7 : 1,
  };
  return (
    <figure
      ref={setNodeRef}
      style={style}
      className="glass overflow-hidden !p-0 group"
    >
      <div
        className="relative aspect-[4/3] bg-black/30 touch-none cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.url}
          alt={`Photo ${index + 1}`}
          loading="lazy"
          draggable={false}
          className="w-full h-full object-cover select-none pointer-events-none"
        />
        <span className="absolute top-2 left-2 microlabel text-[9px] text-text bg-black/60 px-2 py-1 rounded-sonder">
          {String(index + 1).padStart(2, "0")}
        </span>
        {photo.room !== "unknown" && (
          <span className="absolute top-2 right-2 microlabel text-[9px] text-text bg-accent/80 px-2 py-1 rounded-sonder">
            {ROOM_LABEL[photo.room]}
          </span>
        )}
      </div>
      <div className="px-2 py-2 border-t border-white/10">
        <select
          value={photo.room}
          onChange={(e) => onRoomChange(photo.id, e.target.value as RoomKey)}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-full bg-black/25 text-text text-xs font-sans px-2 py-1.5 rounded-sonder border border-white/10 focus:border-accent/60 focus:outline-none"
        >
          {ROOM_KEYS.map((k) => (
            <option key={k} value={k}>
              {ROOM_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
    </figure>
  );
}

export default function Home() {
  const [mode, setMode] = useState<"paste" | "url">("paste");
  const [pastedHtml, setPastedHtml] = useState("");
  const [url, setUrl] = useState("");
  const [zipping, setZipping] = useState(false);
  const [loading, setLoading] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [slug, setSlug] = useState<string>("listing");
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"bookmarklet" | "prompts" | null>(null);

  // Video generation state
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoProgress, setVideoProgress] = useState<VideoProgress | null>(null);
  const [videoResult, setVideoResult] = useState<{
    url: string;
    ext: string;
    duration: number;
  } | null>(null);
  const [videoAR, setVideoAR] = useState<"16:9" | "9:16">("16:9");
  const [secondsPerPhoto, setSecondsPerPhoto] = useState(4);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const currentUrl = useRef<string | null>(null);
  useEffect(() => {
    // Revoke stale blob URLs when a new video is generated.
    return () => {
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    };
  }, []);

  // Bookmarklet drop-in: read hashes from URL fragment on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash) return;
    const params = new URLSearchParams(hash.slice(1));
    const list = params.get("photos");
    const s = params.get("slug") || "listing";
    if (list) {
      const hashes = list.split(",").filter((h) => /^[a-zA-Z0-9]{8,}$/.test(h));
      if (hashes.length > 0) {
        setPhotos(hashesToPhotos(hashes));
        setSlug(s);
        history.replaceState(null, "", window.location.pathname);
      }
    }
  }, []);

  const bookmarklet = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const code = `(function(){var h=new Set(),o=[];var re=/photos\\.zillowstatic\\.com\\/fp\\/([a-zA-Z0-9]{8,})-cc_ft_\\d+\\.(?:jpg|webp)/g;var s=document.documentElement.outerHTML,m;while((m=re.exec(s))){if(!h.has(m[1])){h.add(m[1]);o.push(m[1]);}}var slug=(location.pathname.match(/\\/homedetails\\/([^\\/]+)/)||[])[1]||'listing';if(!o.length){alert('No Zillow photos found on this page. Open a listing detail page first.');return;}window.open('${origin}/#photos='+o.join(',')+'&slug='+encodeURIComponent(slug.toLowerCase()),'_blank');})();`;
    return "javascript:" + code;
  }, []);

  function handlePasteSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pastedHtml.trim()) {
      setError("Paste the Zillow page source into the box below.");
      return;
    }
    const hashes = extractHashesFromHtml(pastedHtml);
    if (hashes.length === 0) {
      setError(
        "No Zillow photo URLs found in that HTML. Make sure you pasted the full page source from a listing detail page.",
      );
      return;
    }
    setPhotos(hashesToPhotos(hashes));
    setSlug(slugFromZillowText(pastedHtml));
    setSourceUrl(undefined);
    setPastedHtml("");
    setVideoResult(null);
  }

  async function handleUrlSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    setVideoResult(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(
          data.error ||
            "Zillow blocked that request. Try the Paste flow instead.",
        );
        return;
      }
      const hashes = (data.photos as string[])
        .map((u) => u.match(/fp\/([a-zA-Z0-9]{8,})-cc_ft_/)?.[1] || "")
        .filter(Boolean);
      setPhotos(hashesToPhotos(hashes));
      setSlug(data.slug || "listing");
      setSourceUrl(data.sourceUrl);
    } catch {
      setError("Network error. Try the Paste flow instead.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadZip() {
    if (photos.length === 0 || zipping) return;
    setZipping(true);
    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photos: photos.map((p) => p.url),
          slug,
          sourceUrl: sourceUrl || "https://www.zillow.com/",
        }),
      });
      if (!res.ok) {
        setError("Could not build zip. Please try again.");
        return;
      }
      const blob = await res.blob();
      triggerDownload(blob, `${slug}.zip`);
    } catch {
      setError("Could not build zip. Please try again.");
    } finally {
      setZipping(false);
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setPhotos((items) => {
      const oldIdx = items.findIndex((p) => p.id === active.id);
      const newIdx = items.findIndex((p) => p.id === over.id);
      return arrayMove(items, oldIdx, newIdx);
    });
  }

  function handleRoomChange(id: string, room: RoomKey) {
    setPhotos((items) =>
      items.map((p) => (p.id === id ? { ...p, room } : p)),
    );
  }

  function handleSortWalkthrough() {
    setPhotos((items) =>
      [...items].sort((a, b) => walkthroughRank(a.room) - walkthroughRank(b.room)),
    );
  }

  async function handleCopyPrompts() {
    const lines = photos.map(
      (p, i) =>
        `${String(i + 1).padStart(2, "0")} · ${ROOM_LABEL[p.room]}\n${promptFor(p.room)}\n`,
    );
    const text = `Sonder walkthrough — ${slug}\n\n${lines.join("\n")}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied("prompts");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Clipboard access denied.");
    }
  }

  async function handleGenerateVideo() {
    if (videoBusy || photos.length === 0) return;
    setError(null);
    setVideoBusy(true);
    setVideoResult(null);
    if (currentUrl.current) {
      URL.revokeObjectURL(currentUrl.current);
      currentUrl.current = null;
    }
    try {
      const [w, h] =
        videoAR === "16:9"
          ? [DEFAULT_VIDEO_OPTIONS.width, DEFAULT_VIDEO_OPTIONS.height]
          : [1080, 1920];
      const result = await renderWalkthroughVideo(
        photos.map((p) => p.url),
        { width: w, height: h, secondsPerPhoto },
        setVideoProgress,
      );
      const objectUrl = URL.createObjectURL(result.blob);
      currentUrl.current = objectUrl;
      setVideoResult({
        url: objectUrl,
        ext: result.ext,
        duration: result.durationSeconds,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Video generation failed.");
    } finally {
      setVideoBusy(false);
      setVideoProgress(null);
    }
  }

  function handleCopyBookmarklet() {
    navigator.clipboard.writeText(bookmarklet).then(
      () => {
        setCopied("bookmarklet");
        setTimeout(() => setCopied(null), 2000);
      },
      () => setError("Clipboard access denied."),
    );
  }

  function triggerDownload(blob: Blob, name: string) {
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  const hasPhotos = photos.length > 0;

  return (
    <main className="min-h-screen w-full flex flex-col text-text">
      <nav className="w-full px-6 md:px-14 pt-8">
        <div className="max-w-[1100px] mx-auto flex items-center justify-between">
          <a
            href="https://www.sonderproject.co/"
            target="_blank"
            rel="noreferrer"
            className="font-display text-text text-lg tracking-tight font-medium"
          >
            Sonder Project
          </a>
          <div className="flex items-center gap-6">
            <span className="hidden md:inline microlabel">
              Real Estate · Downloader
            </span>
            <a
              href="https://www.sonderproject.co/"
              target="_blank"
              rel="noreferrer"
              className="microlabel hover:text-accent-bright transition"
            >
              sonderproject.co ↗
            </a>
          </div>
        </div>
      </nav>

      <section className="flex-1 px-6 md:px-14 pt-16 md:pt-20 pb-24">
        <div className="max-w-[1100px] mx-auto">
          <p className="eyebrow mb-5">Utility № 001</p>
          <h1 className="font-display text-text text-5xl md:text-7xl leading-[0.98] tracking-tight font-medium max-w-3xl">
            Every listing photo,
            <br />
            at{" "}
            <span
              style={{
                background:
                  "linear-gradient(180deg, #6FC3F0 0%, #3E9BD4 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              full resolution.
            </span>
          </h1>
          <p className="mt-6 font-sans text-text-dim max-w-2xl text-base md:text-lg leading-relaxed">
            Grab every photo from a Zillow listing, order them into a
            walkthrough, and render a cinematic Ken-Burns video — all in your
            browser. Prompts ready to hand to Kling, Higgsfield, or Runway.
          </p>

          <div className="mt-10 flex gap-2 border-b border-white/10">
            {(["paste", "url"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`px-4 py-3 text-xs uppercase tracking-widest font-sans transition ${
                  mode === m
                    ? "text-text border-b-2 border-accent -mb-px"
                    : "text-text-dim hover:text-text"
                }`}
              >
                {m === "paste" ? "Paste HTML" : "URL (fallback)"}
              </button>
            ))}
          </div>

          {mode === "paste" && (
            <form onSubmit={handlePasteSubmit} className="mt-8">
              <div className="glass p-5 md:p-6">
                <label htmlFor="paste" className="microlabel block mb-3">
                  Zillow Page Source
                </label>
                <textarea
                  id="paste"
                  required
                  value={pastedHtml}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                    setPastedHtml(e.target.value)
                  }
                  placeholder="Paste the full page source of a Zillow listing here…"
                  spellCheck={false}
                  className="w-full h-40 px-4 py-3 bg-black/25 border border-white/10 rounded-sonder-lg text-text placeholder:text-text-subtle font-mono text-xs leading-relaxed focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition"
                />
                <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <p className="microlabel text-[10px] opacity-80 max-w-md">
                    On the listing: right-click → View Page Source →
                    Ctrl/Cmd+A → Ctrl/Cmd+C → paste here.
                  </p>
                  <button
                    type="submit"
                    disabled={!pastedHtml.trim()}
                    className="btn-primary whitespace-nowrap"
                  >
                    Extract Photos
                  </button>
                </div>
              </div>

              <div className="mt-6 glass p-5 md:p-6">
                <p className="microlabel mb-3">Or — one-click bookmarklet</p>
                <p className="text-text-dim text-sm leading-relaxed mb-4">
                  Drag the button below to your bookmarks bar. On any Zillow
                  listing, click it — Sonder opens with all photos ready.
                </p>
                <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages, jsx-a11y/anchor-is-valid */}
                  <a
                    href={bookmarklet}
                    onClick={(e) => e.preventDefault()}
                    draggable
                    className="btn-primary no-underline cursor-grab active:cursor-grabbing"
                    title="Drag me to your bookmarks bar"
                  >
                    ↴ Sonder — Zillow Photos
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyBookmarklet}
                    className="btn-ghost"
                  >
                    {copied === "bookmarklet" ? "Copied" : "Copy JS"}
                  </button>
                </div>
              </div>
            </form>
          )}

          {mode === "url" && (
            <form onSubmit={handleUrlSubmit} className="mt-8">
              <div className="glass p-5 md:p-6">
                <label htmlFor="url" className="microlabel block mb-3">
                  Zillow Listing URL
                </label>
                <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-stretch">
                  <input
                    id="url"
                    type="url"
                    required
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://www.zillow.com/homedetails/…"
                    className="flex-1 px-4 py-4 bg-black/25 border border-white/10 rounded-sonder-lg text-text placeholder:text-text-subtle font-sans text-base md:text-lg focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition"
                    disabled={loading}
                  />
                  <button
                    type="submit"
                    disabled={loading || !url.trim()}
                    className="btn-primary whitespace-nowrap"
                  >
                    {loading ? "Reading…" : "Get Photos"}
                  </button>
                </div>
                <p className="mt-4 microlabel text-[10px] opacity-80">
                  URL mode often gets blocked by Zillow's bot check. If it
                  fails, switch to Paste HTML — that always works.
                </p>
              </div>
            </form>
          )}

          {error && (
            <div className="mt-6 glass px-5 py-4 border-l-2 border-l-accent text-text-dim text-sm font-sans max-w-2xl leading-relaxed">
              {error}
            </div>
          )}

          {hasPhotos && (
            <div className="mt-16">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5 mb-6">
                <div>
                  <p className="eyebrow mb-3">Photos</p>
                  <h2 className="font-display text-text text-3xl md:text-4xl leading-tight font-medium">
                    {photos.length} photo{photos.length === 1 ? "" : "s"} · max
                    resolution
                  </h2>
                  <p className="mt-2 microlabel">{slug}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 mb-6">
                <button
                  onClick={handleSortWalkthrough}
                  className="btn-ghost"
                  title="Reorder photos by canonical walkthrough sequence"
                >
                  Sort to Walkthrough
                </button>
                <button
                  onClick={handleDownloadZip}
                  disabled={zipping}
                  className="btn-ghost"
                >
                  {zipping ? "Zipping…" : "Download Photos .zip"}
                </button>
                <button
                  onClick={handleCopyPrompts}
                  className="btn-ghost"
                  title="Copy Kling/Higgsfield/Runway prompts to clipboard"
                >
                  {copied === "prompts" ? "Copied" : "Copy AI Prompts"}
                </button>
              </div>

              <p className="microlabel text-[10px] opacity-80 mb-4">
                Drag tiles to reorder. Set a category on each so the auto-sort
                and prompts know what each room is.
              </p>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={photos.map((p) => p.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {photos.map((p, i) => (
                      <PhotoCard
                        key={p.id}
                        photo={p}
                        index={i}
                        onRoomChange={handleRoomChange}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              <div className="mt-16">
                <p className="eyebrow mb-3">Walkthrough Video</p>
                <h3 className="font-display text-text text-2xl md:text-3xl leading-tight font-medium mb-2">
                  Render a Ken-Burns walkthrough
                </h3>
                <p className="text-text-dim text-sm leading-relaxed mb-6 max-w-xl">
                  Slow zoom+pan on each photo with cross-fades. Rendered
                  entirely in your browser. Feed the output to Kling or upload
                  to Reels/TikTok/Shorts.
                </p>

                <div className="glass p-5 md:p-6">
                  <div className="flex flex-col md:flex-row md:items-end gap-5 md:gap-8">
                    <div>
                      <p className="microlabel mb-2">Aspect</p>
                      <div className="flex gap-1">
                        {(["16:9", "9:16"] as const).map((a) => (
                          <button
                            key={a}
                            onClick={() => setVideoAR(a)}
                            className={`px-3 py-2 text-xs uppercase tracking-widest rounded-sonder border transition ${
                              videoAR === a
                                ? "border-accent text-text bg-accent/20"
                                : "border-white/15 text-text-dim hover:text-text"
                            }`}
                          >
                            {a}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="microlabel mb-2">
                        Seconds / photo — {secondsPerPhoto}s
                      </p>
                      <input
                        type="range"
                        min={2}
                        max={8}
                        step={0.5}
                        value={secondsPerPhoto}
                        onChange={(e) =>
                          setSecondsPerPhoto(parseFloat(e.target.value))
                        }
                        className="w-40 accent-accent"
                      />
                    </div>
                    <div className="md:ml-auto">
                      <button
                        onClick={handleGenerateVideo}
                        disabled={videoBusy}
                        className="btn-primary"
                      >
                        {videoBusy ? "Rendering…" : "Generate Video"}
                      </button>
                    </div>
                  </div>

                  {videoBusy && videoProgress && (
                    <div className="mt-5">
                      <div className="microlabel mb-2">
                        {videoProgress.phase === "loading"
                          ? `Loading ${videoProgress.photoIndex + 1} / ${videoProgress.totalPhotos}`
                          : videoProgress.phase === "rendering"
                            ? `Rendering ${Math.round(videoProgress.frameRatio * 100)}%`
                            : "Encoding…"}
                      </div>
                      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-accent transition-[width]"
                          style={{
                            width: `${Math.round(videoProgress.frameRatio * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {videoResult && (
                    <div className="mt-6">
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video
                        src={videoResult.url}
                        controls
                        playsInline
                        className="w-full rounded-sonder-lg"
                      />
                      <div className="mt-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                        <p className="microlabel">
                          {Math.round(videoResult.duration)}s · {videoResult.ext.toUpperCase()}
                        </p>
                        <a
                          href={videoResult.url}
                          download={`${slug}-walkthrough.${videoResult.ext}`}
                          className="btn-primary self-start md:self-auto no-underline"
                        >
                          Download Video
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
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
