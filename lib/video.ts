// Client-side Ken-Burns walkthrough video generator.
// Renders each photo with a slow zoom/pan and cross-fades between them,
// captures the canvas via MediaRecorder, and returns the resulting Blob.
// Runs entirely in the browser — no server, no ffmpeg.wasm.

export type VideoTitle = {
  heading?: string; // address
  price?: string;
  meta?: string; // "4 bd · 3 ba · 2,450 sqft"
};

export type VideoOutro = {
  name?: string;
  phone?: string;
  website?: string;
};

export type VideoOptions = {
  width: number;
  height: number;
  secondsPerPhoto: number;
  fps: number;
  crossfadeSeconds: number;
  bitsPerSecond?: number;
  // Optional production extras — all rendered on the same canvas.
  title?: VideoTitle; // 3s opening card over the first photo
  labels?: string[]; // per-photo lower-third room label ("" = none)
  outro?: VideoOutro; // 3s closing card with agent branding
  musicUrl?: string; // object URL of an uploaded audio file
  musicVolume?: number; // 0..1, default 0.35
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
// available (Safari), then WebM. When a music track is present, probe
// audio-capable codec strings first so the audio track isn't dropped.
function pickMimeType(withAudio: boolean): { mime: string; ext: string } {
  const audioCandidates = [
    { mime: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", ext: "mp4" },
    { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
  ];
  const videoOnly = [
    { mime: "video/mp4;codecs=avc1.42E01E", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9", ext: "webm" },
    { mime: "video/webm;codecs=vp8", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
  ];
  const candidates = withAudio ? [...audioCandidates, ...videoOnly] : videoOnly;
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

  const hasTitle = !!(
    o.title &&
    (o.title.heading || o.title.price || o.title.meta)
  );
  const hasOutro = !!(
    o.outro &&
    (o.outro.name || o.outro.phone || o.outro.website)
  );
  const wantsMusic = !!o.musicUrl;

  const { mime, ext } = pickMimeType(wantsMusic);
  const stream = canvas.captureStream(fps);

  // Mix an uploaded music track into the recording: element → gain →
  // MediaStreamDestination, whose audio track joins the canvas stream.
  // Failure here degrades to a silent video, never a failed render.
  let audioCleanup: (() => void) | null = null;
  if (wantsMusic) {
    try {
      const audio = new Audio(o.musicUrl!);
      audio.loop = true;
      const actx = new AudioContext();
      const src = actx.createMediaElementSource(audio);
      const gain = actx.createGain();
      gain.gain.value = o.musicVolume ?? 0.35;
      const dest = actx.createMediaStreamDestination();
      src.connect(gain);
      gain.connect(dest);
      for (const track of dest.stream.getAudioTracks()) {
        stream.addTrack(track);
      }
      await audio.play();
      audioCleanup = () => {
        audio.pause();
        void actx.close();
      };
    } catch (err) {
      console.warn("music track failed, rendering silent video:", err);
    }
  }

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

  const framesPerPhoto = Math.max(2, Math.round(secondsPerPhoto * fps));
  const crossfadeFrames = Math.max(0, Math.round(crossfadeSeconds * fps));
  const titleFrames = hasTitle ? Math.round(3 * fps) : 0;
  const outroFrames = hasOutro ? Math.round(3 * fps) : 0;
  const totalPhotos = imgs.length;
  const totalFrames =
    titleFrames + totalPhotos * framesPerPhoto + outroFrames;
  let framesDone = 0;

  const base = Math.min(width, height);
  const fontStack = "Outfit, Inter, system-ui, sans-serif";

  const drawFrame = (img: HTMLImageElement, seed: number, t: number) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    const r = kbRect(img.naturalWidth, img.naturalHeight, width, height, seed, t);
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, width, height);
  };

  // Opening card: the first photo slowly zooming behind a scrim, with
  // address / price / specs fading in.
  const drawTitleCard = (t: number) => {
    drawFrame(imgs[0], 0, t * 0.3);
    ctx.fillStyle = "rgba(10,10,9,0.62)";
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = Math.min(1, t * 3);
    ctx.textAlign = "center";
    let y = height * 0.42;
    ctx.fillStyle = "#6FC3F0";
    ctx.font = `600 ${Math.round(base * 0.022)}px ${fontStack}`;
    ctx.fillText("JUST LISTED", width / 2, y);
    y += base * 0.08;
    if (o.title?.heading) {
      let size = Math.round(base * 0.05);
      ctx.font = `500 ${size}px ${fontStack}`;
      while (
        ctx.measureText(o.title.heading).width > width * 0.86 &&
        size > 18
      ) {
        size -= 2;
        ctx.font = `500 ${size}px ${fontStack}`;
      }
      ctx.fillStyle = "#EDE9E3";
      ctx.fillText(o.title.heading, width / 2, y);
      y += base * 0.095;
    }
    if (o.title?.price) {
      ctx.font = `600 ${Math.round(base * 0.062)}px ${fontStack}`;
      ctx.fillStyle = "#EDE9E3";
      ctx.fillText(o.title.price, width / 2, y);
      y += base * 0.07;
    }
    if (o.title?.meta) {
      ctx.font = `500 ${Math.round(base * 0.026)}px ${fontStack}`;
      ctx.fillStyle = "rgba(237,233,227,0.85)";
      ctx.fillText(o.title.meta, width / 2, y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  };

  // Lower-third room label with an accent bar, faded by `alpha`.
  const drawLabel = (text: string, alpha: number) => {
    if (!text || alpha <= 0) return;
    const fs = Math.round(base * 0.028);
    ctx.font = `600 ${fs}px ${fontStack}`;
    const tw = ctx.measureText(text).width;
    const padX = fs * 0.9;
    const padY = fs * 0.55;
    const rectH = fs + padY * 2;
    const x = width * 0.045;
    const yBottom = height * 0.94;
    ctx.globalAlpha = alpha * 0.85;
    ctx.fillStyle = "rgba(10,10,9,0.72)";
    ctx.fillRect(x, yBottom - rectH, tw + padX * 2 + 5, rectH);
    ctx.fillStyle = "#3E9BD4";
    ctx.fillRect(x, yBottom - rectH, 5, rectH);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#EDE9E3";
    ctx.fillText(text, x + padX + 5, yBottom - padY - fs * 0.14);
    ctx.globalAlpha = 1;
  };

  // Closing card: agent branding on the dark canvas.
  const drawOutroCard = (t: number) => {
    ctx.fillStyle = "#0A0A09";
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = Math.min(1, t * 3);
    ctx.textAlign = "center";
    let y = height * 0.42;
    ctx.fillStyle = "rgba(237,233,227,0.6)";
    ctx.font = `600 ${Math.round(base * 0.02)}px ${fontStack}`;
    ctx.fillText("PRESENTED BY", width / 2, y);
    y += base * 0.065;
    if (o.outro?.name) {
      ctx.font = `500 ${Math.round(base * 0.045)}px ${fontStack}`;
      ctx.fillStyle = "#EDE9E3";
      ctx.fillText(o.outro.name, width / 2, y);
      y += base * 0.05;
    }
    ctx.fillStyle = "#3E9BD4";
    ctx.fillRect(width / 2 - 44, y, 88, 5);
    y += base * 0.055;
    if (o.outro?.phone) {
      ctx.font = `500 ${Math.round(base * 0.028)}px ${fontStack}`;
      ctx.fillStyle = "rgba(237,233,227,0.9)";
      ctx.fillText(o.outro.phone, width / 2, y);
      y += base * 0.042;
    }
    if (o.outro?.website) {
      ctx.font = `500 ${Math.round(base * 0.024)}px ${fontStack}`;
      ctx.fillStyle = "#6FC3F0";
      ctx.fillText(o.outro.website, width / 2, y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  };

  // Wait a frame between draws to give the MediaRecorder time to sample.
  const nextFrame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const tickProgress = (photoIndex: number) => {
    framesDone++;
    onProgress?.({
      phase: "rendering",
      photoIndex,
      totalPhotos,
      frameRatio: framesDone / totalFrames,
    });
  };

  recorder.start(250);

  try {
    for (let f = 0; f < titleFrames; f++) {
      drawTitleCard(f / Math.max(1, titleFrames - 1));
      tickProgress(0);
      await nextFrame();
    }

    for (let p = 0; p < totalPhotos; p++) {
      const img = imgs[p];
      const seed = p;
      const label = o.labels?.[p] ?? "";
      for (let f = 0; f < framesPerPhoto; f++) {
        const t = ease(f / (framesPerPhoto - 1));
        drawFrame(img, seed, t);

        // Crossfade tail: blend next photo on top for the last frames.
        let cfProgress = 0;
        if (
          p < totalPhotos - 1 &&
          crossfadeFrames > 0 &&
          f >= framesPerPhoto - crossfadeFrames
        ) {
          const nextImg = imgs[p + 1];
          const nextSeed = p + 1;
          cfProgress =
            (f - (framesPerPhoto - crossfadeFrames)) / crossfadeFrames;
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

        // Room label fades in over ~0.4s and out with the crossfade.
        drawLabel(label, Math.min(1, f / (fps * 0.4)) * (1 - cfProgress));

        tickProgress(p);
        await nextFrame();
      }
    }

    for (let f = 0; f < outroFrames; f++) {
      drawOutroCard(f / Math.max(1, outroFrames - 1));
      tickProgress(totalPhotos - 1);
      await nextFrame();
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
      (totalFrames - Math.max(0, totalPhotos - 1) * crossfadeFrames) / fps;

    return { blob, mime, ext, durationSeconds };
  } finally {
    audioCleanup?.();
  }
}
