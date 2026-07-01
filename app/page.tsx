"use client";

import { useState, useEffect, useMemo, FormEvent } from "react";

type ExtractedResult = {
  photos: string[];
  slug: string;
  sourceUrl?: string;
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
  // Try to find /homedetails/<slug>/ inside pasted HTML or a URL.
  const m = text.match(/\/homedetails\/([a-zA-Z0-9-]+)/);
  if (m) return m[1].toLowerCase();
  return "listing";
}

function hashesToPhotos(hashes: string[]): string[] {
  return hashes.map(
    (h) => `https://photos.zillowstatic.com/fp/${h}-cc_ft_1536.jpg`,
  );
}

export default function Home() {
  const [mode, setMode] = useState<"paste" | "url">("paste");
  const [pastedHtml, setPastedHtml] = useState("");
  const [url, setUrl] = useState("");
  const [zipping, setZipping] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Bookmarklet drops the user here with #photos=hash1,hash2,...
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash) return;
    const params = new URLSearchParams(hash.slice(1));
    const list = params.get("photos");
    const slug = params.get("slug") || "listing";
    if (list) {
      const hashes = list.split(",").filter((s) => /^[a-zA-Z0-9]{8,}$/.test(s));
      if (hashes.length > 0) {
        setResult({ photos: hashesToPhotos(hashes), slug });
        // Wipe the fragment so refresh doesn't re-trigger.
        history.replaceState(null, "", window.location.pathname);
      }
    }
  }, []);

  const bookmarklet = useMemo(() => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    // Runs in a Zillow tab: extracts photo hashes from the current
    // page HTML and opens Sonder with them in the URL hash.
    const code = `(function(){var h=new Set(),o=[];var re=/photos\\.zillowstatic\\.com\\/fp\\/([a-zA-Z0-9]{8,})-cc_ft_\\d+\\.(?:jpg|webp)/g;var s=document.documentElement.outerHTML,m;while((m=re.exec(s))){if(!h.has(m[1])){h.add(m[1]);o.push(m[1]);}}var slug=(location.pathname.match(/\\/homedetails\\/([^\\/]+)/)||[])[1]||'listing';if(!o.length){alert('No Zillow photos found on this page. Open a listing detail page first.');return;}window.open('${origin}/#photos='+o.join(',')+'&slug='+encodeURIComponent(slug.toLowerCase()),'_blank');})();`;
    return "javascript:" + code;
  }, []);

  async function handlePasteSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!pastedHtml.trim()) {
      setError("Paste the Zillow page source into the box below.");
      return;
    }
    const hashes = extractHashesFromHtml(pastedHtml);
    if (hashes.length === 0) {
      setError(
        "No Zillow photo URLs found in that HTML. Make sure you pasted the full page source from a listing detail page (right-click → View Page Source).",
      );
      return;
    }
    setResult({
      photos: hashesToPhotos(hashes),
      slug: slugFromZillowText(pastedHtml),
    });
    setPastedHtml("");
  }

  async function handleUrlSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setResult(null);
    setLoading(true);
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
            "Zillow blocked that request. Try the Paste flow instead — it always works.",
        );
        return;
      }
      setResult(data);
    } catch {
      setError("Network error. Try the Paste flow instead.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    if (!result || zipping) return;
    setZipping(true);
    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photos: result.photos,
          slug: result.slug,
          sourceUrl: result.sourceUrl || "https://www.zillow.com/",
        }),
      });
      if (!res.ok) {
        setError("Could not build zip. Please try again.");
        return;
      }
      const blob = await res.blob();
      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = `${result.slug}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError("Could not build zip. Please try again.");
    } finally {
      setZipping(false);
    }
  }

  async function copyBookmarklet() {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

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
            Two ways in — both free, both take seconds. Zillow blocks
            server-side scrapers, so we do the extraction in your browser
            instead. Paste the page source, or use the one-click bookmarklet.
          </p>

          <div className="mt-10 flex gap-2 border-b border-white/10">
            <button
              onClick={() => {
                setMode("paste");
                setError(null);
              }}
              className={`px-4 py-3 text-xs uppercase tracking-widest font-sans transition ${
                mode === "paste"
                  ? "text-text border-b-2 border-accent -mb-px"
                  : "text-text-dim hover:text-text"
              }`}
            >
              Paste HTML
            </button>
            <button
              onClick={() => {
                setMode("url");
                setError(null);
              }}
              className={`px-4 py-3 text-xs uppercase tracking-widest font-sans transition ${
                mode === "url"
                  ? "text-text border-b-2 border-accent -mb-px"
                  : "text-text-dim hover:text-text"
              }`}
            >
              URL{" "}
              <span className="opacity-50 normal-case tracking-normal ml-1">
                (fallback)
              </span>
            </button>
          </div>

          {mode === "paste" && (
            <form onSubmit={handlePasteSubmit} className="mt-8">
              <div className="glass p-5 md:p-6">
                <label
                  htmlFor="paste"
                  className="microlabel block mb-3"
                >
                  Zillow Page Source
                </label>
                <textarea
                  id="paste"
                  required
                  value={pastedHtml}
                  onChange={(e) => setPastedHtml(e.target.value)}
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
                  Drag this button to your bookmarks bar. Then on any Zillow
                  listing, click it — the tool opens with all photos already
                  extracted. Nothing sent to a server.
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
                    onClick={copyBookmarklet}
                    className="btn-ghost"
                  >
                    {copied ? "Copied" : "Copy JS"}
                  </button>
                </div>
              </div>
            </form>
          )}

          {mode === "url" && (
            <form onSubmit={handleUrlSubmit} className="mt-8">
              <div className="glass p-5 md:p-6">
                <label
                  htmlFor="url"
                  className="microlabel block mb-3"
                >
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

          {result && result.photos.length > 0 && (
            <div className="mt-16">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5 mb-8">
                <div>
                  <p className="eyebrow mb-3">Result</p>
                  <h2 className="font-display text-text text-3xl md:text-4xl leading-tight font-medium">
                    {result.photos.length} photo
                    {result.photos.length === 1 ? "" : "s"} · max resolution
                  </h2>
                  <p className="mt-2 microlabel">{result.slug}</p>
                </div>
                <button
                  onClick={handleDownload}
                  disabled={zipping}
                  className="btn-primary self-start md:self-auto"
                >
                  {zipping ? "Zipping…" : "Download Archive (.zip)"}
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {result.photos.map((photo, i) => (
                  <figure
                    key={photo}
                    className="glass overflow-hidden !p-0"
                    style={{ borderRadius: 8 }}
                  >
                    <div className="relative aspect-[4/3] bg-black/30">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo}
                        alt={`Listing photo ${i + 1}`}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                      <figcaption className="absolute bottom-2 left-2 microlabel text-[9px] text-text/80">
                        {String(i + 1).padStart(2, "0")}
                      </figcaption>
                    </div>
                  </figure>
                ))}
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
