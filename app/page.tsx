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

      <section className="flex-1 px-6 md:px-14 pt-16 md:pt-24 pb-24">
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
          <p className="mt-6 font-sans text-text-dim max-w-xl text-base md:text-lg leading-relaxed">
            Paste a Zillow listing. We slip past the page-block, pull every
            photo at its highest resolution, and hand you a single archive —
            ready for Kling, Higgsfield, or wherever the next frame lives.
          </p>

          <form onSubmit={handleSubmit} className="mt-12 md:mt-16">
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
              <p className="mt-4 microlabel text-[9px] opacity-80">
                No accounts · No storage · Streamed and forgotten
              </p>
            </div>
          </form>

          {error && (
            <div className="mt-6 glass px-5 py-4 border-l-2 border-l-accent text-text-dim text-sm font-sans max-w-2xl">
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
                  <p className="mt-2 microlabel">
                    {result.slug}
                  </p>
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
