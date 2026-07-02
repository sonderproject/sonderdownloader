// Sonder Simulation — walkable house engine (Three.js).
//
// The world is a HOUSE generated from the listing. You start outside
// in the yard at dusk: sky dome, trees, a solid house volume with the
// exterior photos on its facade and a glowing front door. Walk
// through the door and you're inside: ceiling overhead, warm light,
// rooms built from the classified room labels in walkthrough order.
// Each room's lead photo becomes a large curved backdrop that wraps
// your view — a guided pseudo-3D stand-in until the real Gaussian
// splat pipeline lands — with the room's other photos framed on its
// walls. Hotspots snap into the room they mention.

import * as THREE from "three";
import type { DepthGrid } from "./depth";

export type ViewerMedia = { url: string; label?: string };

export type ViewerHotspot = {
  id: string;
  title: string;
  description?: string;
  position: [number, number, number];
};

export type ViewerOptions = {
  media: ViewerMedia[];
  hotspots: ViewerHotspot[];
  onLockChange?: (locked: boolean) => void;
  onSceneReady?: () => void;
  // In-browser depth enhancement (no API key; model from HF CDN).
  enableDepth?: boolean;
  onDepthProgress?: (done: number, total: number) => void;
};

export type ViewerHandle = {
  dispose(): void;
  reset(): void;
  setSpeed(mult: number): void;
  setWalk(on: boolean): void;
  startTour(): void;
  stopTour(): void;
  isTouring(): boolean;
  setPhaseRatio(ratio: number): void;
  setAfter(after: boolean): void;
};

const ACCENT = 0x3e9bd4;
const ACCENT_BRIGHT = 0x6fc3f0;
const EYE = 1.6;
const PANEL_W = 3.2;
const PANEL_H = 2.1;
const MAX_ROOMS = 10;
const MAX_PANELS_PER_ROOM = 7;
const WALL_H = 3.2;
const CEIL_Y = 3.3;
const FOG_COLOR = 0x0c1420;

const EXTERIOR_LABELS = new Set([
  "Exterior · Front",
  "Exterior · Back",
  "Aerial",
  "Yard",
  "Pool",
  "Patio",
]);

type Room = {
  name: string;
  photos: ViewerMedia[];
  cx: number;
  cz: number;
  w: number;
  d: number;
  side: 1 | -1;
};

const FALLBACK_ROOMS = [
  "Entry",
  "Living Room",
  "Dining Room",
  "Kitchen",
  "Primary Suite",
  "Terrace",
];

function splitMedia(media: ViewerMedia[]): {
  interior: ViewerMedia[];
  exterior: ViewerMedia[];
} {
  const interior: ViewerMedia[] = [];
  const exterior: ViewerMedia[] = [];
  for (const m of media) {
    (m.label && EXTERIOR_LABELS.has(m.label) ? exterior : interior).push(m);
  }
  return { interior, exterior };
}

function buildRooms(interior: ViewerMedia[]): Room[] {
  const groups = new Map<string, ViewerMedia[]>();
  const order: string[] = [];
  for (const m of interior) {
    const key = m.label ?? "Gallery";
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    const g = groups.get(key)!;
    if (g.length < MAX_PANELS_PER_ROOM) g.push(m);
  }
  const names = order.length > 0 ? order.slice(0, MAX_ROOMS) : FALLBACK_ROOMS;

  const rooms: Room[] = [];
  let z = -9.5;
  names.forEach((name, i) => {
    const photos = groups.get(name) ?? [];
    const d = 9;
    const w = Math.max(8, Math.min(15, 5 + photos.length * 2));
    const side = (i % 2 === 0 ? 1 : -1) as 1 | -1;
    rooms.push({ name, photos, cx: side * (2.4 + w / 2), cz: z, w, d, side });
    z -= d + 1.6;
  });
  return rooms;
}

function labelSprite(text: string, accent = false, big = false): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const scale = 4;
  const px = big ? 17 : 13;
  const font = `600 ${px * scale}px Inter, system-ui, sans-serif`;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 28 * scale;
  canvas.width = w;
  canvas.height = (px + 17) * scale;
  ctx.font = font;
  ctx.fillStyle = "rgba(8,10,12,0.78)";
  ctx.beginPath();
  ctx.roundRect(0, 0, w, canvas.height, 8 * scale);
  ctx.fill();
  ctx.fillStyle = accent ? "#6FC3F0" : "#EDE9E3";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 14 * scale, canvas.height / 2 + scale);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
  );
  const aspect = w / canvas.height;
  const h = big ? 0.72 : 0.55;
  sprite.scale.set(h * aspect, h, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// Dusk-gradient sky on the inside of a big sphere.
function skyTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#020408");
  g.addColorStop(0.55, "#0a1522");
  g.addColorStop(0.78, "#1a3450");
  g.addColorStop(0.9, "#2c4a6e");
  g.addColorStop(1, "#101d2e");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createViewer(
  container: HTMLElement,
  opts: ViewerOptions,
): ViewerHandle {
  const { interior, exterior } = splitMedia(opts.media);
  const rooms = buildRooms(interior);
  const lastZ = rooms.length > 0 ? rooms[rooms.length - 1].cz : -24;
  const maxHalfX =
    rooms.reduce((m, r) => Math.max(m, Math.abs(r.cx) + r.w / 2), 9) + 0.8;

  // House shell bounds.
  const hx = maxHalfX + 0.6;
  const zFront = -3.4;
  const zBack = lastZ - 9 / 2 - 1.2;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG_COLOR, 24, 85);

  const camera = new THREE.PerspectiveCamera(
    68,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.1,
    260,
  );
  const START = new THREE.Vector3(0, EYE, 10.5);
  camera.position.copy(START);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const disposables: { dispose: () => void }[] = [renderer];
  function track<T extends { dispose: () => void }>(t: T): T {
    disposables.push(t);
    return t;
  }

  // ── Sky, lights ──────────────────────────────────────────────────
  const sky = new THREE.Mesh(
    track(new THREE.SphereGeometry(200, 24, 16)),
    track(
      new THREE.MeshBasicMaterial({
        map: track(skyTexture()),
        side: THREE.BackSide,
        fog: false,
      }),
    ),
  );
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0x24405e, 0x0c0a08, 0.75);
  const ambient = new THREE.AmbientLight(0xfff0dd, 0.32);
  scene.add(ambient);
  const moon = new THREE.DirectionalLight(0xbfd4ea, 0.5);
  moon.position.set(-14, 26, 10);
  scene.add(hemi, moon);

  // ── Ground: yard outside, warm floor inside ──────────────────────
  const worldDepth = Math.abs(zBack) + 60;
  const yard = new THREE.Mesh(
    track(new THREE.PlaneGeometry(hx * 2 + 120, worldDepth + 80)),
    track(new THREE.MeshStandardMaterial({ color: 0x0e120d, roughness: 1 })),
  );
  yard.rotation.x = -Math.PI / 2;
  yard.position.z = -worldDepth / 2 + 25;
  scene.add(yard);

  const insideFloor = new THREE.Mesh(
    track(new THREE.PlaneGeometry(hx * 2, zFront - zBack)),
    track(new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.85 })),
  );
  insideFloor.rotation.x = -Math.PI / 2;
  insideFloor.position.set(0, 0.015, (zFront + zBack) / 2);
  scene.add(insideFloor);

  // Entry walk: from the street to the front door, continuing as the
  // interior spine.
  const spine = new THREE.Mesh(
    track(new THREE.PlaneGeometry(2.4, Math.abs(zBack) + 18)),
    track(
      new THREE.MeshStandardMaterial({
        color: 0x181a1e,
        roughness: 0.65,
        emissive: ACCENT,
        emissiveIntensity: 0.06,
      }),
    ),
  );
  spine.rotation.x = -Math.PI / 2;
  spine.position.set(0, 0.03, (zBack + 14) / 2);
  scene.add(spine);

  const centerline = new THREE.Mesh(
    track(new THREE.PlaneGeometry(0.06, Math.abs(zBack) + 18)),
    track(
      new THREE.MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity: 0.3,
      }),
    ),
  );
  centerline.rotation.x = -Math.PI / 2;
  centerline.position.set(0, 0.04, (zBack + 14) / 2);
  scene.add(centerline);

  // ── House shell: exterior walls, door, ceiling ───────────────────
  const wireframables: THREE.Mesh[] = [];
  const shellMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x211f1c,
      roughness: 0.9,
      transparent: true,
      opacity: 0.98,
    }),
  );

  function shellWall(w: number, h: number, x: number, y: number, z: number, rotY = 0) {
    const wall = new THREE.Mesh(
      track(new THREE.BoxGeometry(w, h, 0.22)),
      shellMat.clone(),
    );
    track(wall.material as THREE.Material);
    wall.position.set(x, y, z);
    wall.rotation.y = rotY;
    scene.add(wall);
    wireframables.push(wall);
    return wall;
  }

  const doorHalf = 1.5;
  // Front wall, split around the door + header above it.
  shellWall((hx - doorHalf), WALL_H, -(doorHalf + (hx - doorHalf) / 2), WALL_H / 2, zFront);
  shellWall((hx - doorHalf), WALL_H, doorHalf + (hx - doorHalf) / 2, WALL_H / 2, zFront);
  shellWall(doorHalf * 2, WALL_H - 2.45, 0, 2.45 + (WALL_H - 2.45) / 2, zFront);
  // Back and side walls.
  shellWall(hx * 2, WALL_H, 0, WALL_H / 2, zBack);
  shellWall(zFront - zBack, WALL_H, -hx, WALL_H / 2, (zFront + zBack) / 2, Math.PI / 2);
  shellWall(zFront - zBack, WALL_H, hx, WALL_H / 2, (zFront + zBack) / 2, Math.PI / 2);

  // Ceiling — the single biggest "I'm indoors" cue.
  const ceiling = new THREE.Mesh(
    track(new THREE.PlaneGeometry(hx * 2, zFront - zBack)),
    track(new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.95 })),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, CEIL_Y, (zFront + zBack) / 2);
  scene.add(ceiling);
  wireframables.push(ceiling);

  // Roof fascia so the house reads as a volume from outside.
  const fascia = new THREE.Mesh(
    track(new THREE.BoxGeometry(hx * 2 + 0.8, 0.35, zFront - zBack + 0.8)),
    shellMat.clone(),
  );
  track(fascia.material as THREE.Material);
  fascia.position.set(0, CEIL_Y + 0.18, (zFront + zBack) / 2);
  scene.add(fascia);
  wireframables.push(fascia);

  // Door glow: warm light spilling out.
  const doorLight = new THREE.PointLight(0xffd9a0, 55, 16);
  doorLight.position.set(0, 2.2, zFront + 1.2);
  scene.add(doorLight);
  const porchLight = new THREE.PointLight(0xffd9a0, 22, 12);
  porchLight.position.set(0, 2.4, zFront - 0.9 + 2);
  porchLight.position.z = zFront + 0.9;
  scene.add(porchLight);

  const doorFrame = new THREE.Mesh(
    track(new THREE.BoxGeometry(doorHalf * 2 + 0.3, 2.5, 0.1)),
    track(
      new THREE.MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity: 0.14,
      }),
    ),
  );
  doorFrame.position.set(0, 1.25, zFront);
  scene.add(doorFrame);

  // ── Trees: cheap dusk silhouettes around the yard ────────────────
  const treeGeo = track(new THREE.ConeGeometry(1.6, 4.4, 7));
  const trunkGeo = track(new THREE.CylinderGeometry(0.16, 0.2, 1.4, 6));
  const treeMat = track(
    new THREE.MeshStandardMaterial({ color: 0x0d130e, roughness: 1 }),
  );
  const trunkMat = track(
    new THREE.MeshStandardMaterial({ color: 0x171310, roughness: 1 }),
  );
  const TREES: [number, number, number][] = [
    [-hx - 6, 0, 6], [hx + 7, 0, 3], [-hx - 9, 0, -14], [hx + 8, 0, -22],
    [-hx - 5, 0, zBack - 8], [hx + 6, 0, zBack - 5], [-9, 0, 16], [11, 0, 14],
  ];
  for (const [tx, , tz] of TREES) {
    const cone = new THREE.Mesh(treeGeo, treeMat);
    cone.position.set(tx, 1.4 + 2.2, tz);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(tx, 0.7, tz);
    scene.add(cone, trunk);
  }

  // ── Texture loading ──────────────────────────────────────────────
  const manager = new THREE.LoadingManager();
  let readyFired = false;
  const fireReady = () => {
    if (!readyFired) {
      readyFired = true;
      opts.onSceneReady?.();
    }
  };
  manager.onLoad = fireReady;
  manager.onError = () => {};
  const texLoader = new THREE.TextureLoader(manager);

  function loadInto(mat: THREE.MeshBasicMaterial, url: string, mirror = false) {
    texLoader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(4, maxAniso);
      if (mirror) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.repeat.x = -1;
        tex.offset.x = 1;
      }
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
      track(tex);
    });
  }

  // ── Framed photo panels ──────────────────────────────────────────
  const frameGeo = track(
    new THREE.BoxGeometry(PANEL_W + 0.26, PANEL_H + 0.26, 0.1),
  );
  const photoGeo = track(new THREE.PlaneGeometry(PANEL_W, PANEL_H));
  const glowGeo = track(new THREE.PlaneGeometry(PANEL_W + 0.4, 0.05));
  const glowMat = track(
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.8 }),
  );
  const frameMat = track(
    new THREE.MeshStandardMaterial({ color: 0x0a0908, roughness: 0.6 }),
  );

  function addPanel(
    m: ViewerMedia,
    pos: THREE.Vector3,
    rotY: number,
    caption?: string,
  ) {
    const group = new THREE.Group();
    const frame = new THREE.Mesh(frameGeo, frameMat);
    group.add(frame);
    const mat = track(new THREE.MeshBasicMaterial({ color: 0x141a20 }));
    const photo = new THREE.Mesh(photoGeo, mat);
    photo.position.z = 0.06;
    group.add(photo);
    loadInto(mat, m.url);
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.set(0, -(PANEL_H / 2 + 0.12), 0.06);
    group.add(glow);
    if (caption) {
      const cap = labelSprite(caption, true);
      cap.position.set(0, -(PANEL_H / 2 + 0.55), 0.2);
      group.add(cap);
      track((cap.material as THREE.SpriteMaterial).map!);
      track(cap.material);
    }
    group.position.copy(pos);
    group.rotation.y = rotY;
    scene.add(group);
  }

  // Exterior photos on the facade, flanking the front door.
  exterior.slice(0, 6).forEach((m, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const rank = Math.floor(i / 2);
    const x = side * (3.6 + rank * (PANEL_W + 0.8));
    if (Math.abs(x) + PANEL_W / 2 > hx - 0.4) return;
    addPanel(
      m,
      new THREE.Vector3(x, 1.75, zFront + 0.18),
      0,
      m.label,
    );
  });

  // ── Rooms: immersive backdrop + framed photos + walls ────────────
  const wallMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x242019,
      roughness: 0.88,
      transparent: true,
      opacity: 0.97,
    }),
  );
  const roomEdgeMat = track(
    new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.3 }),
  );
  const roomBackdrops = new Map<Room, THREE.Mesh>();

  function panelSlots(r: Room): { pos: THREE.Vector3; rotY: number }[] {
    const slots: { pos: THREE.Vector3; rotY: number }[] = [];
    const y = 1.8;
    const inset = 0.2;
    const perSide = Math.max(1, Math.floor(r.d / (PANEL_W + 0.7)));
    // Near wall (toward entry), facing deeper.
    const perFar = Math.max(1, Math.floor(r.w / (PANEL_W + 0.7)));
    for (let i = 0; i < perFar; i++) {
      const x = r.cx - r.w / 2 + ((i + 0.5) * r.w) / perFar;
      slots.push({
        pos: new THREE.Vector3(x, y, r.cz + r.d / 2 - inset),
        rotY: Math.PI,
      });
    }
    for (let i = 0; i < perSide; i++) {
      const z = r.cz - r.d / 2 + ((i + 0.5) * r.d) / perSide;
      slots.push({
        pos: new THREE.Vector3(r.cx + r.side * (r.w / 2 - inset), y, z),
        rotY: -r.side * (Math.PI / 2),
      });
    }
    return slots;
  }

  for (const r of rooms) {
    const patchGeo = track(new THREE.PlaneGeometry(r.w, r.d));
    const patch = new THREE.Mesh(
      patchGeo,
      track(
        new THREE.MeshStandardMaterial({
          color: 0x1d1712,
          roughness: 0.82,
          transparent: true,
          opacity: 0.95,
        }),
      ),
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(r.cx, 0.03, r.cz);
    scene.add(patch);

    const edge = new THREE.LineSegments(
      track(new THREE.EdgesGeometry(patchGeo)),
      roomEdgeMat,
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(r.cx, 0.04, r.cz);
    scene.add(edge);

    const label = labelSprite(r.name, false, true);
    label.position.set(r.cx, 2.85, r.cz);
    scene.add(label);
    track((label.material as THREE.SpriteMaterial).map!);
    track(label.material);

    // Interior partition walls (far + near; outer side is the shell).
    for (const zw of [r.cz - r.d / 2, r.cz + r.d / 2]) {
      const wall = new THREE.Mesh(
        track(new THREE.BoxGeometry(r.w, WALL_H, 0.14)),
        wallMat.clone(),
      );
      track(wall.material as THREE.Material);
      wall.position.set(r.cx, WALL_H / 2, zw);
      scene.add(wall);
      wireframables.push(wall);
    }

    // Immersive backdrop: the room's lead photo on a curved surround
    // hugging the outer wall — stand in the room and it fills your view.
    // Upgraded in place to a depth-displaced 3D mesh when the depth
    // model finishes with this photo.
    if (r.photos.length > 0) {
      const arc = 1.9;
      const radius = Math.min(r.w, r.d) * 0.52;
      const cylGeo = track(
        new THREE.CylinderGeometry(radius, radius, 2.85, 40, 1, true,
          r.side * (Math.PI / 2) - arc / 2, arc),
      );
      const cylMat = track(
        new THREE.MeshBasicMaterial({
          color: 0x141a20,
          side: THREE.BackSide,
          fog: false,
        }),
      );
      loadInto(cylMat, r.photos[0].url, true);
      const cyl = new THREE.Mesh(cylGeo, cylMat);
      cyl.position.set(r.cx, 1.55, r.cz);
      scene.add(cyl);
      roomBackdrops.set(r, cyl);
    }

    // Remaining photos framed on the room's walls.
    const slots = panelSlots(r);
    r.photos.slice(1).forEach((m, i) => {
      const slot = slots[i % slots.length];
      addPanel(m, slot.pos, slot.rotY, r.name === "Gallery" ? m.label : undefined);
    });

    // Warm room light.
    const fill = new THREE.PointLight(0xffe2b8, 34, r.w + r.d + 6);
    fill.position.set(r.cx, 2.7, r.cz);
    scene.add(fill);
  }
  if (opts.media.length === 0) setTimeout(fireReady, 50);

  // ── Depth enhancement: photos → volumetric dioramas ──────────────
  // Runs entirely in the browser (Depth Anything via transformers.js,
  // no API key). Each finished room swaps its curved backdrop for a
  // depth-displaced mesh with real parallax. Any failure leaves the
  // curved fallback in place.
  let disposed = false;

  function addDepthDiorama(r: Room, grid: DepthGrid) {
    const w = Math.min(r.w - 1.2, 8.5);
    const h = Math.min(2.95, w / grid.aspect);
    const segX = grid.width - 1;
    const segY = grid.height - 1;
    const geo = track(new THREE.PlaneGeometry(w, h, segX, segY));
    const pos = geo.attributes.position;
    const depthScale = Math.min(3.4, r.w * 0.34);
    for (let i = 0; i < pos.count; i++) {
      const ix = i % (segX + 1);
      const iy = Math.floor(i / (segX + 1));
      pos.setZ(i, grid.data[iy * grid.width + ix] * depthScale);
    }
    pos.needsUpdate = true;
    geo.computeBoundingSphere();

    const mat = track(new THREE.MeshBasicMaterial({ color: 0x141a20 }));
    loadInto(mat, r.photos[0].url);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(r.cx + r.side * (r.w / 2 - 0.35), h / 2 + 0.25, r.cz);
    mesh.rotation.y = -r.side * (Math.PI / 2);
    scene.add(mesh);

    const old = roomBackdrops.get(r);
    if (old) scene.remove(old);
    roomBackdrops.delete(r);
  }

  async function enhanceRoomsWithDepth() {
    const targets = rooms.filter((r) => roomBackdrops.has(r));
    const total = targets.length;
    if (total === 0) return;
    let done = 0;
    opts.onDepthProgress?.(0, total);
    let estimateDepthGrid: typeof import("./depth").estimateDepthGrid;
    try {
      ({ estimateDepthGrid } = await import("./depth"));
    } catch {
      opts.onDepthProgress?.(-1, total);
      return;
    }
    for (const r of targets) {
      if (disposed) return;
      try {
        const grid = await estimateDepthGrid(r.photos[0].url);
        if (disposed) return;
        addDepthDiorama(r, grid);
      } catch (err) {
        console.warn("depth enhancement unavailable:", err);
        opts.onDepthProgress?.(-1, total);
        return;
      }
      done++;
      opts.onDepthProgress?.(done, total);
    }
  }
  if (opts.enableDepth !== false) void enhanceRoomsWithDepth();

  // ── Hotspots: snap into the room they mention ────────────────────
  const hotspotMeshes: THREE.Mesh[] = [];
  const roomCounts = new Map<Room, number>();
  const orbGeo = track(new THREE.SphereGeometry(0.13, 20, 20));
  const orbMat = track(new THREE.MeshBasicMaterial({ color: ACCENT_BRIGHT }));
  const haloGeo = track(new THREE.RingGeometry(0.2, 0.24, 32));
  const haloMat = track(
    new THREE.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    }),
  );

  function roomFor(title: string, index: number): Room | null {
    if (rooms.length === 0) return null;
    const t = title.toLowerCase();
    const hit = rooms.find(
      (r) =>
        t.includes(r.name.toLowerCase()) || r.name.toLowerCase().includes(t),
    );
    return hit ?? rooms[index % rooms.length];
  }

  opts.hotspots.forEach((h, i) => {
    // Exterior-labeled hotspots live in the front yard.
    const t = h.title.toLowerCase();
    const isExterior = Array.from(EXTERIOR_LABELS).some((l) =>
      t.includes(l.toLowerCase().replace(" · ", " ")),
    ) || /exterior|yard|pool|aerial|patio|curb/.test(t);

    let pos: THREE.Vector3;
    if (isExterior) {
      const n = hotspotMeshes.length;
      pos = new THREE.Vector3((n % 2 === 0 ? -1 : 1) * 4.5, 1.5, 3.5 + n);
    } else {
      const room = roomFor(h.title, i);
      if (room) {
        const n = roomCounts.get(room) ?? 0;
        roomCounts.set(room, n + 1);
        const angle = n * 2.1;
        pos = new THREE.Vector3(
          room.cx + Math.cos(angle) * Math.min(2, room.w * 0.2) * (n > 0 ? 1 : 0),
          1.55,
          room.cz + Math.sin(angle) * Math.min(2, room.d * 0.2) * (n > 0 ? 1 : 0),
        );
      } else {
        pos = new THREE.Vector3(...h.position);
      }
    }

    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.copy(pos);
    scene.add(orb);
    hotspotMeshes.push(orb);

    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(pos.x, 0.05, pos.z);
    halo.rotation.x = -Math.PI / 2;
    scene.add(halo);

    const tag = labelSprite(h.title, true);
    tag.position.set(pos.x, pos.y + 0.55, pos.z);
    scene.add(tag);
    track((tag.material as THREE.SpriteMaterial).map!);
    track(tag.material);
  });

  // ── Controls ─────────────────────────────────────────────────────
  let yaw = 0;
  let pitch = 0;
  let speedMult = 1;
  let walkHeld = false;
  const keys = new Set<string>();
  let touring = false;
  let tourT = 0;
  let bobPhase = 0;
  const velocity = new THREE.Vector3();

  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (
      touring &&
      ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown"].includes(e.code)
    ) {
      touring = false;
    }
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    yaw -= e.movementX * 0.0022;
    pitch = Math.max(-1.35, Math.min(1.35, pitch - e.movementY * 0.0022));
  };
  const onClick = () => {
    if (
      !("ontouchstart" in window) &&
      document.pointerLockElement !== renderer.domElement
    ) {
      renderer.domElement.requestPointerLock();
    }
  };
  const onLock = () =>
    opts.onLockChange?.(document.pointerLockElement === renderer.domElement);

  let touchId: number | null = null;
  let lastTX = 0;
  let lastTY = 0;
  const onTouchStart = (e: TouchEvent) => {
    if (touchId !== null) return;
    const t = e.changedTouches[0];
    touchId = t.identifier;
    lastTX = t.clientX;
    lastTY = t.clientY;
    if (touring) touring = false;
  };
  const onTouchMove = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== touchId) continue;
      yaw -= (t.clientX - lastTX) * 0.005;
      pitch = Math.max(
        -1.35,
        Math.min(1.35, pitch - (t.clientY - lastTY) * 0.005),
      );
      lastTX = t.clientX;
      lastTY = t.clientY;
      e.preventDefault();
    }
  };
  const onTouchEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === touchId) touchId = null;
    }
  };

  const onResize = () => {
    const w = container.clientWidth;
    const h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };

  let hidden = false;
  const onVisibility = () => {
    hidden = document.hidden;
    if (!hidden) clock.getDelta();
  };

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("pointerlockchange", onLock);
  document.addEventListener("visibilitychange", onVisibility);
  renderer.domElement.addEventListener("click", onClick);
  renderer.domElement.addEventListener("touchstart", onTouchStart, { passive: true });
  renderer.domElement.addEventListener("touchmove", onTouchMove, { passive: false });
  renderer.domElement.addEventListener("touchend", onTouchEnd);
  window.addEventListener("resize", onResize);

  // ── Cinematic tour: yard → front door → each room ────────────────
  const tourPoints: THREE.Vector3[] = [
    START.clone(),
    new THREE.Vector3(0, EYE, 5.5),
    new THREE.Vector3(0, EYE, zFront + 1.6),
  ];
  for (const r of rooms) {
    tourPoints.push(new THREE.Vector3(0, EYE, r.cz + r.d / 2 + 0.8));
    tourPoints.push(new THREE.Vector3(r.cx * 0.55, EYE, r.cz + r.d * 0.1));
    tourPoints.push(new THREE.Vector3(r.cx * 0.25, EYE, r.cz - r.d * 0.25));
  }
  const tourCurve = new THREE.CatmullRomCurve3(
    tourPoints,
    false,
    "centripetal",
    0.35,
  );
  const TOUR_SECONDS = Math.max(28, rooms.length * 8 + 8);

  // ── Render loop ──────────────────────────────────────────────────
  const clock = new THREE.Clock();
  let raf = 0;
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const wishDir = new THREE.Vector3();

  const animate = () => {
    raf = requestAnimationFrame(animate);
    if (hidden) return;
    // Physics uses a clamped delta (no teleporting after a stall); the
    // tour is pure interpolation, so it advances in real time even on
    // slow frames.
    const rawDt = clock.getDelta();
    const dt = Math.min(0.05, rawDt);
    const t = clock.elapsedTime;

    if (touring) {
      tourT += Math.min(0.5, rawDt) / TOUR_SECONDS;
      if (tourT >= 1) {
        touring = false;
        tourT = 0;
      } else {
        const pos = tourCurve.getPointAt(Math.min(1, tourT));
        const ahead = tourCurve.getPointAt(Math.min(1, tourT + 0.012));
        camera.position.lerp(pos, 0.35);
        camera.lookAt(ahead);
        euler.setFromQuaternion(camera.quaternion, "YXZ");
        yaw = euler.y;
        pitch = euler.x;
      }
    } else {
      euler.set(pitch, yaw, 0);
      camera.quaternion.setFromEuler(euler);

      wishDir.set(0, 0, 0);
      if (keys.has("KeyW") || keys.has("ArrowUp") || walkHeld) wishDir.z -= 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) wishDir.z += 1;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) wishDir.x -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) wishDir.x += 1;

      const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 1.9 : 1;
      const maxSpeed = 4.2 * speedMult * sprint;
      if (wishDir.lengthSq() > 0) {
        wishDir.normalize().applyEuler(new THREE.Euler(0, yaw, 0));
        velocity.addScaledVector(wishDir, 26 * dt);
        if (velocity.length() > maxSpeed) velocity.setLength(maxSpeed);
      }
      velocity.multiplyScalar(Math.exp(-9 * dt));
      camera.position.addScaledVector(velocity, dt);

      const speed = velocity.length();
      bobPhase += dt * speed * 2.6;
      camera.position.y =
        EYE + Math.sin(bobPhase) * 0.028 * Math.min(1, speed / 3);

      camera.position.x = Math.max(
        -(hx + 14),
        Math.min(hx + 14, camera.position.x),
      );
      camera.position.z = Math.max(zBack - 10, Math.min(16, camera.position.z));
    }

    const s = 1 + Math.sin(t * 2.4) * 0.18;
    for (const m of hotspotMeshes) m.scale.setScalar(s);

    renderer.render(scene, camera);
  };
  animate();

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLock);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("touchstart", onTouchStart);
      renderer.domElement.removeEventListener("touchmove", onTouchMove);
      renderer.domElement.removeEventListener("touchend", onTouchEnd);
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      for (const d of disposables) d.dispose();
      renderer.domElement.remove();
    },
    reset() {
      touring = false;
      tourT = 0;
      velocity.set(0, 0, 0);
      camera.position.copy(START);
      yaw = 0;
      pitch = 0;
    },
    setSpeed(mult: number) {
      speedMult = mult;
    },
    setWalk(on: boolean) {
      walkHeld = on;
      if (on && touring) touring = false;
    },
    startTour() {
      tourT = 0;
      touring = true;
    },
    stopTour() {
      touring = false;
    },
    isTouring() {
      return touring;
    },
    setPhaseRatio(ratio: number) {
      const r = Math.max(0, Math.min(1, ratio));
      for (const m of wireframables) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.wireframe = r < 0.55;
        mat.opacity = 0.35 + r * 0.63;
      }
      doorLight.intensity = 20 + r * 35;
      hemi.intensity = 0.5 + r * 0.25;
      ambient.intensity = 0.14 + r * 0.18;
    },
    setAfter(after: boolean) {
      moon.intensity = after ? 0.5 : 0.22;
      hemi.intensity = after ? 0.75 : 0.42;
      ambient.intensity = after ? 0.32 : 0.15;
      doorLight.intensity = after ? 55 : 18;
      scene.fog = new THREE.Fog(FOG_COLOR, after ? 24 : 15, after ? 85 : 48);
    },
  };
}
