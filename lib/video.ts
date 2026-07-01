// Client-side Ken-Burns walkthrough video generator.
// Renders each photo with a slow zoom/pan and cross-fades between them,
// captures the canvas via MediaRecorder, and returns the resulting Blob.
// Runs entirely in the browser — no server, no ffmpeg.wasm.

export type VideoOptions = {
  width: number;
  height: number;
  secondsPerPhoto: number;
  fps: number;
  crossfadeSeconds: number;
  bitsPerSecond?: number;
};

export const DEFAULT_VIDEO_OPTIONS: VideoOptions = {
  width: 1920,
  height: 1080,
  secondsPerPhoto: 4,
  fps: 30,
  crossfadeSeconds: 0.6,
  bitsPerSecond: 8_000_000,
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error(`Failed to load image: ${url.slice(0, 80)}`));
    img.src = url;
  });
}

// Pick MediaRecorder mimeType supported by the browser. Prefer MP4 when
// available (Safari), then WebM. Actual browsers vary — probe.
function pickMimeType(): { mime: string; ext: string } {
  const candidates = [
    { mime: "video/mp4;codecs=avc1.42E01E", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9", ext: "webm" },
    { mime: "video/webm;codecs=vp8", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
  ];
  for (const c of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(c.mime)
    ) {
      return c;
    }
  }
  return { mime: "video/webm", ext: "webm" };
}

// Ken-Burns rect at time t in [0,1]. Randomize direction per photo but
// deterministic per index so the same photo always animates the same way
// within a single render.
function kbRect(
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
  seed: number,
  t: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const imgAR = imgW / imgH;
  const canvasAR = canvasW / canvasH;

  // Cover-fit rect at max zoom (1.0) so photo fills canvas at start.
  let baseSw: number;
  let baseSh: number;
  if (imgAR > canvasAR) {
    baseSh = imgH;
    baseSw = imgH * canvasAR;
  } else {
    baseSw = imgW;
    baseSh = imgW / canvasAR;
  }

  // Zoom range: 1.00 → 1.15 (or reverse based on seed).
  const zoomStart = seed % 2 === 0 ? 1.0 : 1.15;
  const zoomEnd = seed % 2 === 0 ? 1.15 : 1.0;
  const zoom = zoomStart + (zoomEnd - zoomStart) * t;

  const sw = baseSw / zoom;
  const sh = baseSh / zoom;

  // Pan direction based on seed.
  const dir = seed % 4;
  const maxPanX = imgW - sw;
  const maxPanY = imgH - sh;
  let panX = maxPanX / 2;
  let panY = maxPanY / 2;
  if (dir === 0) panX = maxPanX * (0.15 + 0.7 * t);
  else if (dir === 1) panX = maxPanX * (0.85 - 0.7 * t);
  else if (dir === 2) panY = maxPanY * (0.15 + 0.7 * t);
  else panY = maxPanY * (0.85 - 0.7 * t);

  return {
    sx: Math.max(0, panX),
    sy: Math.max(0, panY),
    sw: Math.min(imgW, sw),
    sh: Math.min(imgH, sh),
  };
}

// Ease in-out for smoother motion.
function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export type VideoProgress = {
  phase: "loading" | "rendering" | "encoding";
  photoIndex: number;
  totalPhotos: number;
  frameRatio: number;
};

export type VideoResult = {
  blob: Blob;
  mime: string;
  ext: string;
  durationSeconds: number;
};

export async function renderWalkthroughVideo(
  photoUrls: string[],
  opts: Partial<VideoOptions> = {},
  onProgress?: (p: VideoProgress) => void,
): Promise<VideoResult> {
  const o = { ...DEFAULT_VIDEO_OPTIONS, ...opts };
  const { width, height, secondsPerPhoto, fps, crossfadeSeconds } = o;

  if (photoUrls.length === 0) {
    throw new Error("Need at least one photo to render.");
  }
  if (typeof MediaRecorder === "undefined") {
    throw new Error(
      "This browser doesn't support MediaRecorder. Try Chrome, Firefox, or Safari 15+.",
    );
  }

  // Pre-load all images. Bail if any fail — we don't want holes.
  const imgs: HTMLImageElement[] = [];
  for (let i = 0; i < photoUrls.length; i++) {
    onProgress?.({
      phase: "loading",
      photoIndex: i,
      totalPhotos: photoUrls.length,
      frameRatio: 0,
    });
    try {
      imgs.push(await loadImage(photoUrls[i]));
    } catch (err) {
      throw new Error(
        `Photo ${i + 1} failed to load. It may be blocked by CORS.`,
      );
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

  const { mime, ext } = pickMimeType();
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: o.bitsPerSecond,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
    recorder.onerror = (e) => reject(e as unknown as Error);
  });

  recorder.start(250);

  const framesPerPhoto = Math.max(2, Math.round(secondsPerPhoto * fps));
  const crossfadeFrames = Math.max(0, Math.round(crossfadeSeconds * fps));
  const totalPhotos = imgs.length;

  const drawFrame = (img: HTMLImageElement, seed: number, t: number) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    const r = kbRect(img.naturalWidth, img.naturalHeight, width, height, seed, t);
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, width, height);
  };

  // Wait a frame between draws to give the MediaRecorder time to sample.
  const nextFrame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  for (let p = 0; p < totalPhotos; p++) {
    const img = imgs[p];
    const seed = p;
    for (let f = 0; f < framesPerPhoto; f++) {
      const t = ease(f / (framesPerPhoto - 1));
      drawFrame(img, seed, t);

      // Crossfade tail: blend next photo on top for the last crossfade frames.
      if (
        p < totalPhotos - 1 &&
        crossfadeFrames > 0 &&
        f >= framesPerPhoto - crossfadeFrames
      ) {
        const nextImg = imgs[p + 1];
        const nextSeed = p + 1;
        const cfProgress = (f - (framesPerPhoto - crossfadeFrames)) / crossfadeFrames;
        // Draw next photo at very start of its motion.
        const r2 = kbRect(
          nextImg.naturalWidth,
          nextImg.naturalHeight,
          width,
          height,
          nextSeed,
          0,
        );
        ctx.globalAlpha = ease(cfProgress);
        ctx.drawImage(nextImg, r2.sx, r2.sy, r2.sw, r2.sh, 0, 0, width, height);
        ctx.globalAlpha = 1;
      }

      onProgress?.({
        phase: "rendering",
        photoIndex: p,
        totalPhotos,
        frameRatio: (p * framesPerPhoto + f + 1) / (totalPhotos * framesPerPhoto),
      });
      await nextFrame();
    }
  }

  onProgress?.({
    phase: "encoding",
    photoIndex: totalPhotos,
    totalPhotos,
    frameRatio: 1,
  });

  // Give recorder one more tick before stopping.
  await nextFrame();
  recorder.stop();
  const blob = await done;

  const durationSeconds =
    (totalPhotos * framesPerPhoto -
      Math.max(0, totalPhotos - 1) * crossfadeFrames) /
    fps;

  return { blob, mime, ext, durationSeconds };
}
