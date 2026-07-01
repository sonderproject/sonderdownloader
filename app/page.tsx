"use client";

import { useState, FormEvent } from "react";

type ExtractResponse = {
  photos: string[];
  slug: string;
  sourceUrl: string;
};

type ApiError = { error: string };

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [result, setResult] = useState<ExtractResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
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

      const data: ExtractResponse | ApiError = await res.json();

      if (!res.ok || "error" in data) {
        setError(
          "error" in data
            ? data.error
            : "Something went wrong. Please try again.",
        );
        return;
      }

      setResult(data);
    } catch {
      setError("Network error. Please try again.");
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
          sourceUrl: result.sourceUrl,
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

  return (
    <main className="min-h-screen w-full flex flex-col">
      <header className="w-full pt-8 pb-6 px-6 md:px-16">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-ink text-xl tracking-tight">
              Sonder
            </span>
            <span className="text-ink-muted text-xs uppercase tracking-widest">
              Studio
            </span>
          </div>
          <div className="text-ink-muted text-xs uppercase tracking-widest">
            Real Estate · Downloader
          </div>
        </div>
      </header>

      <div className="hairline max-w-6xl w-full mx-auto" />

      <section className="flex-1 px-6 md:px-16 py-12 md:py-20">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12 items-start">
            <div className="md:col-span-7">
              <p className="font-sans uppercase tracking-widest text-[11px] text-ember mb-6">
                Index № 001 · Utility
              </p>
              <h1 className="font-serif text-ink text-5xl md:text-7xl leading-[0.98] mb-6">
                Every listing photo,
                <br />
                <em className="font-serif italic text-ember">at full resolution.</em>
              </h1>
              <p className="font-sans text-ink-soft/80 text-base md:text-lg max-w-xl leading-relaxed">
                Paste a Zillow listing. We slip past the page-block, pull every
                photo at its highest resolution, and hand you a single zip —
                ready for Kling, Higgsfield, or wherever the next frame lives.
              </p>
            </div>
            <aside className="md:col-span-5 md:pl-8 md:border-l md:border-ink/10">
              <p className="font-sans uppercase tracking-widest text-[11px] text-ink-muted mb-3">
                On this page
              </p>
              <ul className="font-serif text-ink text-lg space-y-2">
                <li>— Paste a URL.</li>
                <li>— Preview every photo.</li>
                <li>— Download the archive.</li>
              </ul>
              <p className="mt-6 font-sans text-ink-muted text-xs leading-relaxed">
                No accounts. No storage. Photos are streamed through this
                session and never kept.
              </p>
            </aside>
          </div>

          <div className="mt-14 md:mt-20">
            <form onSubmit={handleSubmit}>
              <label
                htmlFor="url"
                className="block font-sans uppercase tracking-widest text-[11px] text-ink-muted mb-3"
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
                  className="flex-1 px-0 py-4 bg-transparent border-0 border-b border-ink/25 focus:border-ink focus:outline-none focus:ring-0 text-ink placeholder:text-ink-muted/60 font-serif text-lg md:text-2xl transition"
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading || !url.trim()}
                  className="self-start md:self-auto px-6 py-4 rounded-none bg-ink hover:bg-ember text-paper-soft font-sans text-sm uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {loading ? "Reading…" : "Get Photos"}
                </button>
              </div>
            </form>

            {error && (
              <div className="mt-8 border-l-2 border-ember pl-4 py-1 text-ink-soft text-sm font-sans max-w-xl">
                {error}
              </div>
            )}

            {result && result.photos.length > 0 && (
              <div className="mt-16">
                <div className="hairline mb-8" />
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
                  <div>
                    <p className="font-sans uppercase tracking-widest text-[11px] text-ink-muted mb-2">
                      Result
                    </p>
                    <h2 className="font-serif text-ink text-3xl md:text-4xl leading-tight">
                      {result.photos.length} photo
                      {result.photos.length === 1 ? "" : "s"} · max resolution
                    </h2>
                    <p className="mt-2 font-sans text-ink-muted text-sm">
                      {result.slug}
                    </p>
                  </div>
                  <button
                    onClick={handleDownload}
                    disabled={zipping}
                    className="self-start md:self-auto px-6 py-4 rounded-none bg-ember hover:bg-ember-deep text-paper-soft font-sans text-sm uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {zipping ? "Zipping…" : "Download Archive (.zip)"}
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">
                  {result.photos.map((photo, i) => (
                    <figure
                      key={photo}
                      className="relative aspect-[4/3] overflow-hidden bg-paper-deep"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo}
                        alt={`Listing photo ${i + 1}`}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                      <figcaption className="absolute bottom-2 left-2 text-[10px] uppercase tracking-widest text-paper-soft/90 font-sans mix-blend-difference">
                        {String(i + 1).padStart(2, "0")}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="hairline max-w-6xl w-full mx-auto" />

      <footer className="w-full py-8 px-6 md:px-16 text-ink-muted text-xs font-sans uppercase tracking-widest">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:justify-between gap-2">
          <span>Sonder Studio · MMXXVI</span>
          <span>A stateless utility</span>
        </div>
      </footer>
    </main>
  );
}
