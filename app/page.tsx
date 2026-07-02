"use client";

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  FormEvent,
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
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
import type { ClassifyProgress } from "@/lib/classify";
import {
  extractListing,
  SOURCE_LABEL,
  ListingFacts,
} from "@/lib/sources";
import { buildCaptions, captionsFileText } from "@/lib/captions";
import { renderCoverImage, Branding } from "@/lib/cover";
import { SIMULATOR_STAGE_KEY } from "@/lib/simulator";
import { useRouter } from "next/navigation";

type Photo = {
  id: string;
  url: string;
  room: RoomKey;
  ext?: string; // uploaded photos keep their original extension
};

// Uploaded photos are blob: object URLs — local to this tab, never
// proxied, never persisted (they don't survive a reload).
function isLocalUrl(url: string): boolean {
  return url.startsWith("blob:");
}

function toRenderUrl(url: string): string {
  return isLocalUrl(url) ? url : `/api/img?url=${encodeURIComponent(url)}`;
}

// If the text is a single zillow.com URL, return it normalized; else null.
function asZillowUrl(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  try {
    const u = new URL(t);
    return /(^|\.)zillow\.com$/i.test(u.hostname) ? t : null;
  } catch {
    return null;
  }
}

const SESSION_KEY = "sonder-session-v1";
const HISTORY_KEY = "sonder-history-v1";
const BRANDING_KEY = "sonder-branding-v1";

type HistoryEntry = {
  slug: string;
  sourceUrl?: string;
  photos: Photo[];
  facts?: ListingFacts;
  ts: number;
};

// "123-main-st-anytown-ca-90210" → "123 Main St Anytown Ca 90210" —
// a usable starting point when the source didn't carry a real address.
function addressFromSlug(slug: string): string | undefined {
  if (slug === "listing") return undefined;
  return slug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function listingFileText(
  f: ListingFacts,
  slug: string,
  sourceUrl?: string,
): string {
  const rows = [
    f.address && `Address: ${f.address}`,
    f.price && `Price: ${f.price}`,
    f.beds && `Beds: ${f.beds}`,
    f.baths && `Baths: ${f.baths}`,
    f.sqft && `SqFt: ${f.sqft}`,
    sourceUrl && `Listing: ${sourceUrl}`,
    f.description && `\n${f.description}`,
  ].filter(Boolean);
  return `Sonder listing — ${slug}\n\n${rows.join("\n")}`;
}

const fieldCls =
  "w-full px-3 py-2 bg-black/25 border border-white/10 rounded-sonder text-text placeholder:text-text-subtle font-sans text-sm focus:outline-none focus:border-accent/60 transition";

// Zip entry name: index plus the room label once classified, so the
// archive reads 03_kitchen.jpg instead of photo_03.jpg.
function zipEntryName(p: Photo, i: number, width: number): string {
  const n = String(i + 1).padStart(width, "0");
  const ext = p.ext ?? "jpg";
  return p.room === "unknown" ? `photo_${n}.${ext}` : `${n}_${p.room}.${ext}`;
}

function buildPromptsText(photos: Photo[], slug: string): string {
  const lines = photos.map(
    (p, i) =>
      `${String(i + 1).padStart(2, "0")} · ${ROOM_LABEL[p.room]}\n${promptFor(p.room)}\n`,
  );
  return `Sonder walkthrough — ${slug}\n\n${lines.join("\n")}`;
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
  onRemove,
}: {
  photo: Photo;
  index: number;
  onRoomChange: (id: string, room: RoomKey) => void;
  onRemove: (id: string) => void;
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
          onError={(e) => {
            // The 1536 size doesn't exist for every photo — retry via the
            // proxy, which walks the size ladder. Local blobs have no
            // fallback.
            const el = e.currentTarget;
            if (photo.url.startsWith("blob:")) return;
            const proxied = `/api/img?url=${encodeURIComponent(photo.url)}`;
            if (!el.src.includes("/api/img")) el.src = proxied;
          }}
          className="w-full h-full object-cover select-none pointer-events-none"
        />
        <span className="absolute top-2 left-2 microlabel text-[9px] text-text bg-black/60 px-2 py-1 rounded-sonder">
          {String(index + 1).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={() => onRemove(photo.id)}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-black/60 text-text-dim hover:text-text hover:bg-black/85 text-base leading-none transition"
          title="Remove this photo from the set"
          aria-label={`Remove photo ${index + 1}`}
        >
          ×
        </button>
        {photo.room !== "unknown" && (
          <span className="absolute bottom-2 right-2 microlabel text-[9px] text-text bg-accent/80 px-2 py-1 rounded-sonder">
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
  const [zipBytes, setZipBytes] = useState(0);
  const [loading, setLoading] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [slug, setSlug] = useState<string>("listing");
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [trashed, setTrashed] = useState<Photo[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [scrollTick, setScrollTick] = useState(0);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // Marketing-kit state
  const [facts, setFacts] = useState<ListingFacts>({});
  const [branding, setBranding] = useState<Branding>({});
  const [music, setMusic] = useState<{ url: string; name: string } | null>(
    null,
  );
  const [coverBusy, setCoverBusy] = useState(false);
  const router = useRouter();

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

  // Auto-classifier state
  const [classifyBusy, setClassifyBusy] = useState(false);
  const [classifyProgress, setClassifyProgress] = useState<ClassifyProgress | null>(null);

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

  // Extraction is instant — without visible feedback it reads as
  // "nothing happened." Flash a confirmation and scroll to the grid.
  const flashAndScroll = useCallback((message: string) => {
    setFlash(message);
    setScrollTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    if (scrollTick > 0) {
      gridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [scrollTick]);

  // Bookmarklet drop-in: read hashes from the URL fragment.
  const ingestFragment = useCallback((): boolean => {
    const hash = window.location.hash;
    if (!hash) return false;
    const params = new URLSearchParams(hash.slice(1));
    const list = params.get("photos");
    const s = params.get("slug") || "listing";
    const src = params.get("url");
    if (!list) return false;
    const hashes = list.split(",").filter((h) => /^[a-zA-Z0-9]{8,}$/.test(h));
    if (hashes.length === 0) return false;
    setPhotos(hashesToPhotos(hashes));
    setSlug(s);
    setSourceUrl(
      src && /^https:\/\/(www\.)?zillow\.com\//i.test(src) ? src : undefined,
    );
    setFacts({ address: addressFromSlug(s) });
    setTrashed([]);
    setVideoResult(null);
    setError(null);
    window.history.replaceState(null, "", window.location.pathname);
    flashAndScroll(
      `✓ ${hashes.length} photo${hashes.length === 1 ? "" : "s"} extracted — ${s}`,
    );
    return true;
  }, [flashAndScroll]);

  // On mount: fragment wins; otherwise restore the previous session so
  // a refresh doesn't lose photo order and room labels. Also listen for
  // hashchange — clicking a bookmarklet link into an already-open tab
  // is a same-document navigation that never remounts.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("hashchange", ingestFragment);
    if (!ingestFragment()) {
      try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        const saved = raw
          ? (JSON.parse(raw) as {
              photos?: Photo[];
              slug?: string;
              sourceUrl?: string;
              facts?: ListingFacts;
            })
          : null;
        if (saved && Array.isArray(saved.photos) && saved.photos.length > 0) {
          setPhotos(saved.photos);
          setSlug(saved.slug || "listing");
          setSourceUrl(saved.sourceUrl || undefined);
          setFacts(saved.facts ?? {});
        }
      } catch {
        // Corrupt session state — start fresh.
      }
    }
    return () => window.removeEventListener("hashchange", ingestFragment);
  }, [ingestFragment]);

  // Persist the working set so refreshes are seamless. Uploaded blob
  // photos can't survive a reload, so they're excluded.
  useEffect(() => {
    const persistable = photos.filter((p) => !isLocalUrl(p.url));
    if (persistable.length === 0) return;
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ photos: persistable, slug, sourceUrl, facts }),
      );
    } catch {
      // Storage full or unavailable — persistence is best-effort.
    }
  }, [photos, slug, sourceUrl, facts]);

  // Agent branding survives across listings.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BRANDING_KEY);
      if (raw) setBranding(JSON.parse(raw) as Branding);
    } catch {
      // Best-effort.
    }
  }, []);

  function updateBranding(patch: Partial<Branding>) {
    setBranding((b) => {
      const next = { ...b, ...patch };
      try {
        localStorage.setItem(BRANDING_KEY, JSON.stringify(next));
      } catch {
        // Best-effort.
      }
      return next;
    });
  }

  function updateFacts(patch: Partial<ListingFacts>) {
    setFacts((f) => ({ ...f, ...patch }));
  }

  // Recent-listings history lives in localStorage so it survives the
  // tab. Load once on mount…
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setHistory(
          parsed.filter(
            (e): e is HistoryEntry =>
              !!e && typeof e.slug === "string" && Array.isArray(e.photos),
          ),
        );
      }
    } catch {
      // Corrupt history — start fresh.
    }
  }, []);

  // …and upsert the current listing (including order + labels) on change.
  useEffect(() => {
    const persistable = photos.filter((p) => !isLocalUrl(p.url));
    if (persistable.length === 0) return;
    setHistory((prev) => {
      const entry: HistoryEntry = {
        slug,
        sourceUrl,
        photos: persistable,
        facts,
        ts: Date.now(),
      };
      const next = [entry, ...prev.filter((e) => e.slug !== slug)].slice(0, 8);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        // Best-effort.
      }
      return next;
    });
  }, [photos, slug, sourceUrl, facts]);

  // Ingest raw page source from any supported listing site: extract
  // photos, slug, and canonical URL.
  const ingestHtml = useCallback(
    (html: string): boolean => {
      const listing = extractListing(html);
      if (!listing) return false;
      setPhotos(
        listing.photos.map((u) => ({
          id: u,
          url: u,
          room: "unknown" as RoomKey,
        })),
      );
      setSlug(listing.slug);
      setSourceUrl(listing.sourceUrl);
      setFacts(listing.facts);
      setTrashed([]);
      setVideoResult(null);
      setError(null);
      flashAndScroll(
        `✓ ${listing.photos.length} photo${listing.photos.length === 1 ? "" : "s"} extracted from ${SOURCE_LABEL[listing.source]} — ${listing.slug}`,
      );
      return true;
    },
    [flashAndScroll],
  );

  const extractFromUrl = useCallback(async (target: string) => {
    if (!target) return;
    setError(null);
    setLoading(true);
    setVideoResult(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
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
      setFacts({ address: addressFromSlug(data.slug || "listing") });
      setTrashed([]);
      flashAndScroll(
        `✓ ${hashes.length} photo${hashes.length === 1 ? "" : "s"} extracted — ${data.slug || "listing"}`,
      );
    } catch {
      setError("Network error. Try the Paste flow instead.");
    } finally {
      setLoading(false);
    }
  }, [flashAndScroll]);

  // Route pasted text to the right flow: a Zillow URL hits the URL
  // pipeline, page source is extracted instantly. Returns true if handled.
  const ingestText = useCallback(
    (text: string): boolean => {
      const u = asZillowUrl(text);
      if (u) {
        setMode("url");
        setUrl(u);
        void extractFromUrl(u);
        return true;
      }
      return ingestHtml(text);
    },
    [extractFromUrl, ingestHtml],
  );

  // Paste anywhere on the page — no need to focus an input first.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      const text = e.clipboardData?.getData("text") ?? "";
      if (text && ingestText(text)) e.preventDefault();
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [ingestText]);

  const bookmarklet = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const code = `(function(){var h=new Set(),o=[];var re=/photos\\.zillowstatic\\.com\\/fp\\/([a-zA-Z0-9]{8,})-cc_ft_\\d+\\.(?:jpg|webp)/g;var s=document.documentElement.outerHTML,m;while((m=re.exec(s))){if(!h.has(m[1])){h.add(m[1]);o.push(m[1]);}}var slug=(location.pathname.match(/\\/homedetails\\/([^\\/]+)/)||[])[1]||'listing';if(!o.length){alert('No Zillow photos found on this page. Open a listing detail page first.');return;}window.open('${origin}/#photos='+o.join(',')+'&slug='+encodeURIComponent(slug.toLowerCase())+'&url='+encodeURIComponent(location.href),'_blank');})();`;
    return "javascript:" + code;
  }, []);

  function handlePasteSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pastedHtml.trim()) {
      setError("Paste the Zillow page source into the box below.");
      return;
    }
    if (!ingestText(pastedHtml)) {
      setError(
        "No listing photos found in that HTML. Make sure you pasted the full page source of a Zillow, Redfin, or Realtor.com listing detail page.",
      );
      return;
    }
    setPastedHtml("");
  }

  // Extract the instant content lands in the box — no button click needed.
  function handleTextareaPaste(e: ReactClipboardEvent<HTMLTextAreaElement>) {
    const text = e.clipboardData.getData("text");
    if (text && ingestText(text)) {
      e.preventDefault();
      setPastedHtml("");
    }
  }

  // Someone pasted page source into the URL field — handle it anyway.
  function handleUrlInputPaste(e: ReactClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (text && !asZillowUrl(text) && ingestHtml(text)) {
      e.preventDefault();
    }
  }

  function handleUrlSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    void extractFromUrl(url.trim());
  }

  // Zip is assembled in the browser: uploaded blob photos are read
  // directly, CDN photos come through the /api/img proxy (which owns
  // the Referer + size-ladder logic). No serverless time limit.
  async function handleDownloadZip() {
    if (photos.length === 0 || zipping) return;
    setZipping(true);
    setZipBytes(0);
    setError(null);
    try {
      const { zip, strToU8 } = await import("fflate");
      const width = Math.max(2, String(photos.length).length);
      type ZipEntry = [Uint8Array, { level: 0 | 6 }];
      const files: Record<string, ZipEntry> = {
        "prompts.txt": [strToU8(buildPromptsText(photos, slug)), { level: 6 }],
        "captions.txt": [strToU8(captionsFileText(facts, slug)), { level: 6 }],
        "listing.txt": [
          strToU8(listingFileText(facts, slug, sourceUrl)),
          { level: 6 },
        ],
      };
      let received = 0;
      let fetched = 0;
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        try {
          const res = await fetch(toRenderUrl(p.url));
          if (!res.ok) continue;
          const buf = new Uint8Array(await res.arrayBuffer());
          received += buf.length;
          setZipBytes(received);
          // Photos are already compressed — store, don't deflate.
          files[zipEntryName(p, i, width)] = [buf, { level: 0 }];
          fetched++;
        } catch {
          // Skip photos that fail; the rest of the zip still works.
        }
      }
      if (fetched === 0) {
        setError("No photos could be fetched. Please try again.");
        return;
      }
      const data = await new Promise<Uint8Array>((resolve, reject) =>
        zip(files, (err, out) => (err ? reject(err) : resolve(out))),
      );
      triggerDownload(
        new Blob([data as BlobPart], { type: "application/zip" }),
        `${slug}.zip`,
      );
      if (fetched < photos.length) {
        setFlash(
          `✓ Zip ready — ${photos.length - fetched} photo${photos.length - fetched === 1 ? "" : "s"} skipped`,
        );
      }
    } catch {
      setError("Could not build zip. Please try again.");
    } finally {
      setZipping(false);
    }
  }

  function handleUploadChange(e: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    );
    e.target.value = "";
    if (list.length === 0) return;
    const stamp = Date.now();
    const added: Photo[] = list.map((f, i) => ({
      id: `local-${stamp}-${i}-${f.name}`,
      url: URL.createObjectURL(f),
      room: "unknown" as RoomKey,
      ext: (f.name.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? "jpg").toLowerCase(),
    }));
    const wasEmpty = photos.length === 0;
    setPhotos((ps) => [...ps, ...added]);
    if (wasEmpty && slug === "listing") setSlug("my-photos");
    setVideoResult(null);
    setError(null);
    flashAndScroll(
      `✓ ${added.length} photo${added.length === 1 ? "" : "s"} added`,
    );
  }

  // Stage the current set for the Property Simulator and open it.
  function handleSendToSimulator() {
    if (photos.length === 0) return;
    try {
      sessionStorage.setItem(
        SIMULATOR_STAGE_KEY,
        JSON.stringify({
          photos: photos.map((p) => ({
            id: p.id,
            url: toRenderUrl(p.url),
            room: p.room,
          })),
          facts,
          slug,
          sourceUrl,
          ts: Date.now(),
        }),
      );
    } catch {
      setError("Could not stage photos for the simulator.");
      return;
    }
    router.push("/simulator");
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

  // Junk shots (floor plans, plat maps, duplicate angles) get a one-
  // click ×; removals are recoverable until the next extraction.
  function handleRemovePhoto(id: string) {
    const p = photos.find((x) => x.id === id);
    if (!p) return;
    setTrashed((t) => [...t, p]);
    setPhotos((items) => items.filter((x) => x.id !== id));
  }

  function handleRestoreTrashed() {
    setPhotos((items) => [...items, ...trashed]);
    setTrashed([]);
  }

  function loadHistoryEntry(e: HistoryEntry) {
    setPhotos(e.photos);
    setSlug(e.slug);
    setSourceUrl(e.sourceUrl);
    setFacts(e.facts ?? {});
    setTrashed([]);
    setVideoResult(null);
    setError(null);
    flashAndScroll(
      `✓ Loaded ${e.photos.length} photo${e.photos.length === 1 ? "" : "s"} — ${e.slug}`,
    );
  }

  function clearHistory() {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // Best-effort.
    }
  }

  async function handleAutoClassify() {
    if (classifyBusy || photos.length === 0) return;
    setError(null);
    setClassifyBusy(true);
    setClassifyProgress({ phase: "loading-model", progress: 0 });
    try {
      // Lazy import so Transformers.js is not in the initial page bundle.
      const { classifyPhotos } = await import("@/lib/classify");
      const results = await classifyPhotos(
        photos.map((p) => ({ id: p.id, url: p.url })),
        setClassifyProgress,
      );
      const byId = new Map(results.map((r) => [r.id, r.room]));
      // Label, then drop straight into walkthrough order — one click
      // takes a raw paste to a presentation-ready sequence.
      setPhotos((items) =>
        items
          .map((p) => (byId.has(p.id) ? { ...p, room: byId.get(p.id)! } : p))
          .sort((a, b) => walkthroughRank(a.room) - walkthroughRank(b.room)),
      );
      setFlash("✓ Photos classified and sorted into walkthrough order");
    } catch (err) {
      setError(
        err instanceof Error
          ? `Auto-classify failed: ${err.message}`
          : "Auto-classify failed.",
      );
    } finally {
      setClassifyBusy(false);
      setClassifyProgress(null);
    }
  }

  function handleSortWalkthrough() {
    setPhotos((items) =>
      [...items].sort((a, b) => walkthroughRank(a.room) - walkthroughRank(b.room)),
    );
  }

  async function handleCopyPrompts() {
    const text = buildPromptsText(photos, slug);
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
      const meta = [
        facts.beds && `${facts.beds} bd`,
        facts.baths && `${facts.baths} ba`,
        facts.sqft && `${facts.sqft} sqft`,
      ]
        .filter(Boolean)
        .join(" · ");
      // Load frames through the same-origin proxy: guarantees canvas
      // pixel access (the CDN sends no CORS headers) and falls back to
      // smaller sizes when 1536 is missing.
      const result = await renderWalkthroughVideo(
        photos.map((p) => toRenderUrl(p.url)),
        {
          width: w,
          height: h,
          secondsPerPhoto,
          title: { heading: facts.address, price: facts.price, meta },
          labels: photos.map((p) =>
            p.room === "unknown" ? "" : ROOM_LABEL[p.room],
          ),
          outro: branding,
          musicUrl: music?.url,
          musicVolume: 0.35,
        },
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

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Clipboard access denied.");
    }
  }

  async function handleDownloadCover() {
    if (photos.length === 0 || coverBusy) return;
    setCoverBusy(true);
    setError(null);
    try {
      const blob = await renderCoverImage(
        toRenderUrl(photos[0].url),
        facts,
        branding,
      );
      triggerDownload(blob, `${slug}-cover.png`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Cover image render failed.",
      );
    } finally {
      setCoverBusy(false);
    }
  }

  function handleMusicChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (music) URL.revokeObjectURL(music.url);
    setMusic({ url: URL.createObjectURL(file), name: file.name });
  }

  function handleRemoveMusic() {
    if (music) URL.revokeObjectURL(music.url);
    setMusic(null);
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
      {flash && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 glass px-5 py-3 text-sm font-sans text-text border border-accent/40 whitespace-nowrap">
          {flash}
        </div>
      )}
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
            Grab every photo from a Zillow, Redfin, or Realtor.com listing,
            order them into a walkthrough, and render a cinematic Ken-Burns
            video — all in your browser. Prompts ready to hand to Kling,
            Higgsfield, or Runway.
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
                  Listing Page Source — Zillow · Redfin · Realtor.com
                </label>
                <textarea
                  id="paste"
                  required
                  value={pastedHtml}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                    setPastedHtml(e.target.value)
                  }
                  onPaste={handleTextareaPaste}
                  placeholder="Paste the page source of a Zillow, Redfin, or Realtor.com listing — extraction starts instantly…"
                  spellCheck={false}
                  className="w-full h-40 px-4 py-3 bg-black/25 border border-white/10 rounded-sonder-lg text-text placeholder:text-text-subtle font-mono text-xs leading-relaxed focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition"
                />
                <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <p className="microlabel text-[10px] opacity-80 max-w-md">
                    On the listing: right-click → View Page Source →
                    Ctrl/Cmd+A → Ctrl/Cmd+C — then paste anywhere on this
                    page. Photos extract on paste.
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
                    onPaste={handleUrlInputPaste}
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

          <div className="mt-6 glass p-5 md:p-6">
            <p className="microlabel mb-3">Or — start from your own photos</p>
            <p className="text-text-dim text-sm leading-relaxed mb-4">
              Already have listing photos? Upload them and use everything
              here — classify, walkthrough video, cover image, captions,
              simulator.
            </p>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleUploadChange}
              className="block w-full max-w-md text-xs text-text-dim file:mr-3 file:px-4 file:py-2.5 file:rounded-sonder file:border-0 file:bg-accent/20 file:text-text file:text-xs file:uppercase file:tracking-widest file:cursor-pointer"
            />
            <p className="mt-3 microlabel text-[9px] opacity-70">
              Photos stay in your browser — nothing is uploaded to a server.
              They live for this tab only; refresh clears them.
            </p>
          </div>

          {history.length > 0 && (
            <div className="mt-6">
              <p className="microlabel mb-2">Recent listings</p>
              <div className="flex flex-wrap gap-2 items-center">
                {history.slice(0, 6).map((e) => (
                  <button
                    key={e.slug}
                    type="button"
                    onClick={() => loadHistoryEntry(e)}
                    className="btn-ghost !px-3 !py-2 text-[10px]"
                    title={`Load ${e.photos.length} photos`}
                  >
                    {e.slug.length > 36 ? `${e.slug.slice(0, 36)}…` : e.slug} ·{" "}
                    {e.photos.length}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={clearHistory}
                  className="microlabel text-[10px] opacity-60 hover:opacity-100 px-2 py-2 transition"
                >
                  clear
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-6 glass px-5 py-4 border-l-2 border-l-accent text-text-dim text-sm font-sans max-w-2xl leading-relaxed">
              {error}
            </div>
          )}

          {hasPhotos && (
            <div className="mt-16" ref={gridRef}>
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
                  onClick={handleAutoClassify}
                  disabled={classifyBusy}
                  className="btn-primary"
                  title="Auto-label each photo by room and sort into walkthrough order (in-browser CLIP, ~150 MB one-time download)"
                >
                  {classifyBusy ? "Classifying…" : "Classify & Sort"}
                </button>
                <button
                  onClick={handleSendToSimulator}
                  className="btn-primary"
                  title="Stage this photo set for the Property Simulator"
                >
                  Send to Simulator →
                </button>
                <label
                  className="btn-ghost cursor-pointer"
                  title="Add your own photos to this set"
                >
                  Add Photos
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleUploadChange}
                    className="hidden"
                  />
                </label>
                <button
                  onClick={handleSortWalkthrough}
                  className="btn-ghost"
                  title="Reorder photos by canonical walkthrough sequence"
                >
                  Sort to Walkthrough
                </button>
                {trashed.length > 0 && (
                  <button
                    onClick={handleRestoreTrashed}
                    className="btn-ghost"
                    title="Bring back the photos you removed with ×"
                  >
                    Restore {trashed.length} removed
                  </button>
                )}
                <button
                  onClick={handleDownloadZip}
                  disabled={zipping}
                  className="btn-ghost"
                >
                  {zipping
                    ? zipBytes > 0
                      ? `Zipping… ${(zipBytes / 1_000_000).toFixed(1)} MB`
                      : "Zipping…"
                    : "Download Photos .zip"}
                </button>
                <button
                  onClick={handleDownloadCover}
                  disabled={coverBusy}
                  className="btn-ghost"
                  title="1080×1350 branded hero graphic with price + address (PNG)"
                >
                  {coverBusy ? "Rendering…" : "Download Cover Image"}
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
                Classify &amp; Sort labels every photo and orders the
                walkthrough in one click — then fine-tune by dragging tiles.
                × removes junk shots (floor plans, maps) from the zip and
                video. First run downloads a ~150 MB vision model (cached
                forever). Zip filenames include room labels, plus a
                prompts.txt ready for Kling / Higgsfield / Runway.
              </p>

              {classifyBusy && classifyProgress && (
                <div className="mb-6 glass px-5 py-4">
                  <div className="microlabel mb-2">
                    {classifyProgress.phase === "loading-model"
                      ? `Downloading CLIP model — ${Math.round(classifyProgress.progress * 100)}%`
                      : `Classifying photo ${classifyProgress.index} / ${classifyProgress.total}`}
                  </div>
                  <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-[width]"
                      style={{
                        width:
                          classifyProgress.phase === "loading-model"
                            ? `${Math.round(classifyProgress.progress * 100)}%`
                            : `${Math.round((classifyProgress.index / Math.max(1, classifyProgress.total)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="glass p-5 md:p-6 mb-6">
                <p className="microlabel mb-4">
                  Listing Details — auto-extracted from the page source; edit
                  anything. Used on the video title card, cover image, and
                  captions.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  <div className="col-span-2 md:col-span-3">
                    <label className="microlabel text-[9px] block mb-1">
                      Address
                    </label>
                    <input
                      value={facts.address ?? ""}
                      onChange={(e) => updateFacts({ address: e.target.value })}
                      placeholder="123 Main St, Anytown, CA"
                      className={fieldCls}
                    />
                  </div>
                  <div>
                    <label className="microlabel text-[9px] block mb-1">
                      Price
                    </label>
                    <input
                      value={facts.price ?? ""}
                      onChange={(e) => updateFacts({ price: e.target.value })}
                      placeholder="$1,250,000"
                      className={fieldCls}
                    />
                  </div>
                  <div>
                    <label className="microlabel text-[9px] block mb-1">
                      Beds
                    </label>
                    <input
                      value={facts.beds ?? ""}
                      onChange={(e) => updateFacts({ beds: e.target.value })}
                      placeholder="4"
                      className={fieldCls}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="microlabel text-[9px] block mb-1">
                        Baths
                      </label>
                      <input
                        value={facts.baths ?? ""}
                        onChange={(e) => updateFacts({ baths: e.target.value })}
                        placeholder="3"
                        className={fieldCls}
                      />
                    </div>
                    <div>
                      <label className="microlabel text-[9px] block mb-1">
                        SqFt
                      </label>
                      <input
                        value={facts.sqft ?? ""}
                        onChange={(e) => updateFacts({ sqft: e.target.value })}
                        placeholder="2,450"
                        className={fieldCls}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <label className="microlabel text-[9px] block mb-1">
                    Description
                  </label>
                  <textarea
                    value={facts.description ?? ""}
                    onChange={(e) =>
                      updateFacts({ description: e.target.value })
                    }
                    rows={2}
                    placeholder="Sun-drenched corner lot with a chef's kitchen…"
                    className={fieldCls}
                  />
                </div>
              </div>

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
                        onRemove={handleRemovePhoto}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              <div className="mt-16">
                <p className="eyebrow mb-3">Social Captions</p>
                <h3 className="font-display text-text text-2xl md:text-3xl leading-tight font-medium mb-2">
                  Ready-to-post captions
                </h3>
                <p className="text-text-dim text-sm leading-relaxed mb-6 max-w-xl">
                  Generated from the listing details above — three voices for
                  Instagram, Reels/TikTok, and luxury campaigns. Also included
                  in the zip as captions.txt.
                </p>
                <div className="grid md:grid-cols-3 gap-3">
                  {buildCaptions(facts).map((c) => (
                    <div key={c.key} className="glass p-5 flex flex-col">
                      <p className="microlabel mb-3">{c.label}</p>
                      <pre className="whitespace-pre-wrap text-text-dim text-xs font-sans leading-relaxed flex-1">
                        {c.text}
                      </pre>
                      <button
                        onClick={() => copyText(c.text, c.key)}
                        className="btn-ghost mt-4 self-start"
                      >
                        {copied === c.key ? "Copied" : "Copy"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

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
                  <div className="mb-6 grid md:grid-cols-2 gap-5 pb-6 border-b border-white/10">
                    <div>
                      <p className="microlabel mb-2">
                        Agent Branding — video outro &amp; cover image (saved)
                      </p>
                      <div className="flex flex-col gap-2">
                        <input
                          value={branding.name ?? ""}
                          onChange={(e) =>
                            updateBranding({ name: e.target.value })
                          }
                          placeholder="Name / Team"
                          className={fieldCls}
                        />
                        <input
                          value={branding.phone ?? ""}
                          onChange={(e) =>
                            updateBranding({ phone: e.target.value })
                          }
                          placeholder="Phone"
                          className={fieldCls}
                        />
                        <input
                          value={branding.website ?? ""}
                          onChange={(e) =>
                            updateBranding({ website: e.target.value })
                          }
                          placeholder="Website"
                          className={fieldCls}
                        />
                      </div>
                    </div>
                    <div>
                      <p className="microlabel mb-2">
                        Background Music (optional)
                      </p>
                      <input
                        type="file"
                        accept="audio/*"
                        onChange={handleMusicChange}
                        className="block w-full text-xs text-text-dim file:mr-3 file:px-3 file:py-2 file:rounded-sonder file:border-0 file:bg-white/10 file:text-text file:text-xs file:cursor-pointer"
                      />
                      {music && (
                        <p className="mt-2 text-xs text-text-dim">
                          ♪ {music.name}{" "}
                          <button
                            type="button"
                            onClick={handleRemoveMusic}
                            className="text-accent-bright hover:underline ml-1"
                          >
                            remove
                          </button>
                        </p>
                      )}
                      <p className="mt-2 microlabel text-[9px] opacity-70">
                        Looped under the video at 35% volume. Use a track you
                        have rights to. The video opens with a title card
                        (address · price · specs) and closes with your
                        branding; room labels appear on classified photos.
                      </p>
                    </div>
                  </div>
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
