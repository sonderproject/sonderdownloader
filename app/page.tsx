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
      <header className="w-full pt-8 pb-4 px-6 md:px-12">
        <div className="flex items-center gap-3">
          <div className="w-2 h-8 rounded-full bg-teal-deep" />
          <span className="font-serif text-navy text-lg tracking-tight">
            Sonder
          </span>
        </div>
      </header>

      <section className="flex-1 flex items-start md:items-center justify-center px-6 md:px-12 pb-12">
        <div className="w-full max-w-3xl">
          <div className="text-center mb-10">
            <p className="font-sans uppercase tracking-[0.28em] text-xs text-teal-deep mb-4">
              Real Estate Downloader
            </p>
            <h1 className="font-serif text-navy text-4xl md:text-6xl leading-[1.05] mb-4">
              Every listing photo,
              <br />
              at full resolution.
            </h1>
            <p className="font-sans text-navy-soft/70 max-w-xl mx-auto text-base md:text-lg">
              Paste a Zillow listing. We pull every photo at its highest
              resolution and hand you a single zip — ready for Kling, Higgsfield,
              or wherever else the frame goes next.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mb-6">
            <div className="flex flex-col md:flex-row gap-3">
              <input
                type="url"
                required
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.zillow.com/homedetails/..."
                className="flex-1 px-5 py-4 rounded-xl bg-cream-soft border border-navy/10 focus:border-teal focus:outline-none focus:ring-2 focus:ring-teal/20 text-navy placeholder:text-navy/30 font-sans transition"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !url.trim()}
                className="px-6 py-4 rounded-xl bg-navy hover:bg-navy-deep text-cream-soft font-sans font-medium tracking-wide disabled:opacity-50 disabled:cursor-not-allowed transition shadow-depth"
              >
                {loading ? "Reading listing…" : "Get Photos"}
              </button>
            </div>
          </form>

          {error && (
            <div className="mb-6 px-5 py-4 rounded-xl bg-cream-deep/60 border border-navy/10 text-navy-soft text-sm">
              {error}
            </div>
          )}

          {result && result.photos.length > 0 && (
            <div>
              <div className="divider-depth my-6" />
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="font-serif text-navy text-2xl">
                    {result.photos.length} photo
                    {result.photos.length === 1 ? "" : "s"}
                  </p>
                  <p className="text-navy-soft/60 text-sm mt-1">
                    Max resolution · {result.slug}
                  </p>
                </div>
                <button
                  onClick={handleDownload}
                  disabled={zipping}
                  className="px-5 py-3 rounded-xl bg-teal-deep hover:bg-teal text-cream-soft font-sans font-medium disabled:opacity-60 disabled:cursor-not-allowed transition shadow-depth"
                >
                  {zipping ? "Zipping…" : "Download All (.zip)"}
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {result.photos.map((photo, i) => (
                  <div
                    key={photo}
                    className="relative aspect-[4/3] rounded-lg overflow-hidden bg-cream-deep/40 border border-navy/5"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo}
                      alt={`Listing photo ${i + 1}`}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <footer className="w-full py-6 px-6 md:px-12 text-navy-soft/50 text-xs font-sans">
        <div className="max-w-3xl mx-auto flex justify-between">
          <span>Sonder · a stateless utility</span>
          <span>No accounts. No storage.</span>
        </div>
      </footer>
    </main>
  );
}
