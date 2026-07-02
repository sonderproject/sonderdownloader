// Sonder Simulation — walkable scene engine (Three.js).
//
// The world is GENERATED from the listing: classified room labels
// become rooms, sized by photo count and laid out along a central
// spine in walkthrough order, with each room's photos mounted on its
// own walls. Hotspots snap into the room whose name they mention.
// First-person movement has acceleration/damping, sprint, and head
// bob; a cinematic tour glides through every room. Real Gaussian
// splat / GLB scenes plug in behind the same handle later.

import * as THREE from "three";

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
};

export type ViewerHandle = {
  dispose(): void;
  reset(): void;
  setSpeed(mult: number): void;
  setWalk(on: boolean): void; // touch "hold to walk"
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

// Group media by room label (order of first appearance = walkthrough
// order, since the downloader sorts before sending) and lay rooms out
// alternating left/right along a central spine.
function buildRooms(media: ViewerMedia[]): Room[] {
  const groups = new Map<string, ViewerMedia[]>();
  const order: string[] = [];
  for (const m of media) {
    const key = m.label ?? "Gallery";
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    const g = groups.get(key)!;
    if (g.length < MAX_PANELS_PER_ROOM) g.push(m);
  }
  const names =
    order.length > 0 ? order.slice(0, MAX_ROOMS) : FALLBACK_ROOMS;

  const rooms: Room[] = [];
  let z = -8;
  names.forEach((name, i) => {
    const photos = groups.get(name) ?? [];
    const d = 9;
    const w = Math.max(7.5, Math.min(15, 4.5 + photos.length * 2.2));
    const side = (i % 2 === 0 ? 1 : -1) as 1 | -1;
    rooms.push({ name, photos, cx: side * (2.4 + w / 2), cz: z, w, d, side });
    z -= d + 2;
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
  ctx.fillStyle = "rgba(10,10,9,0.78)";
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

export function createViewer(
  container: HTMLElement,
  opts: ViewerOptions,
): ViewerHandle {
  const rooms = buildRooms(opts.media);
  const lastZ = rooms.length > 0 ? rooms[rooms.length - 1].cz : -20;
  const maxHalfX =
    rooms.reduce((m, r) => Math.max(m, Math.abs(r.cx) + r.w / 2), 8) + 1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a09);
  scene.fog = new THREE.Fog(0x0a0a09, 20, 58);

  const camera = new THREE.PerspectiveCamera(
    68,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.1,
    180,
  );
  const START = new THREE.Vector3(0, EYE, 3);
  camera.position.copy(START);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  // 1.5 max: retina-crisp without quadrupling fragment work.
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // Everything created here gets tracked for disposal.
  const disposables: { dispose: () => void }[] = [renderer];
  function track<T extends { dispose: () => void }>(t: T): T {
    disposables.push(t);
    return t;
  }

  // ── Lights ───────────────────────────────────────────────────────
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  const key = new THREE.DirectionalLight(0xfff2e0, 0.9);
  key.position.set(6, 14, 4);
  const endGlow = new THREE.PointLight(ACCENT, 14, 34);
  endGlow.position.set(0, 3.2, lastZ - 4);
  scene.add(ambient, key, endGlow);

  // ── Floor, grid, spine ───────────────────────────────────────────
  const worldDepth = Math.abs(lastZ) + 30;
  const floor = new THREE.Mesh(
    track(new THREE.PlaneGeometry(maxHalfX * 2 + 30, worldDepth + 20)),
    track(new THREE.MeshStandardMaterial({ color: 0x121211, roughness: 0.95 })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -worldDepth / 2 + 8;
  scene.add(floor);

  const grid = new THREE.GridHelper(
    Math.max(maxHalfX * 2 + 30, worldDepth + 20),
    Math.round(Math.max(maxHalfX * 2 + 30, worldDepth + 20)),
    0x232322,
    0x1a1a19,
  );
  grid.position.set(0, 0.01, -worldDepth / 2 + 8);
  scene.add(grid);
  track(grid.geometry);
  track(grid.material as THREE.Material);

  // Central spine: a subtle lit walkway tying the rooms together.
  const spine = new THREE.Mesh(
    track(new THREE.PlaneGeometry(2.6, Math.abs(lastZ) + 16)),
    track(
      new THREE.MeshStandardMaterial({
        color: 0x17181a,
        roughness: 0.7,
        emissive: ACCENT,
        emissiveIntensity: 0.02,
      }),
    ),
  );
  spine.rotation.x = -Math.PI / 2;
  spine.position.set(0, 0.02, lastZ / 2 + 3);
  scene.add(spine);

  const centerline = new THREE.Mesh(
    track(new THREE.PlaneGeometry(0.06, Math.abs(lastZ) + 16)),
    track(
      new THREE.MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity: 0.35,
      }),
    ),
  );
  centerline.rotation.x = -Math.PI / 2;
  centerline.position.set(0, 0.03, lastZ / 2 + 3);
  scene.add(centerline);

  // ── Texture loading (with scene-ready signal) ────────────────────
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

  // ── Rooms: floor patches, walls, labels, photo panels ────────────
  const wireframables: THREE.Mesh[] = [];
  const wallMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1e1e1d,
      roughness: 0.85,
      transparent: true,
      opacity: 0.94,
    }),
  );
  const frameMat = track(
    new THREE.MeshStandardMaterial({ color: 0x090908, roughness: 0.6 }),
  );
  const frameGeo = track(new THREE.BoxGeometry(PANEL_W + 0.26, PANEL_H + 0.26, 0.1));
  const photoGeo = track(new THREE.PlaneGeometry(PANEL_W, PANEL_H));
  const glowGeo = track(new THREE.PlaneGeometry(PANEL_W + 0.4, 0.05));
  const glowMat = track(
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.8 }),
  );

  function addPanel(
    m: ViewerMedia,
    pos: THREE.Vector3,
    rotY: number,
    showCaption: boolean,
  ) {
    const group = new THREE.Group();
    const frame = new THREE.Mesh(frameGeo, wallMat.clone());
    (frame.material as THREE.MeshStandardMaterial).color.set(0x090908);
    track(frame.material as THREE.Material);
    group.add(frame);

    const mat = track(new THREE.MeshBasicMaterial({ color: 0x15181a }));
    const photo = new THREE.Mesh(photoGeo, mat);
    photo.position.z = 0.06;
    group.add(photo);
    texLoader.load(m.url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(4, maxAniso);
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
      track(tex);
    });

    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.set(0, -(PANEL_H / 2 + 0.12), 0.06);
    group.add(glow);

    if (showCaption && m.label) {
      const cap = labelSprite(m.label, true);
      cap.position.set(0, -(PANEL_H / 2 + 0.55), 0.2);
      group.add(cap);
      track((cap.material as THREE.SpriteMaterial).map!);
      track(cap.material);
    }

    group.position.copy(pos);
    group.rotation.y = rotY;
    scene.add(group);
    wireframables.push(frame);
  }

  // Wall slots: far wall → outer wall → near wall, evenly spaced.
  function panelSlots(r: Room): { pos: THREE.Vector3; rotY: number }[] {
    const slots: { pos: THREE.Vector3; rotY: number }[] = [];
    const y = 1.8;
    const inset = 0.18;
    const perWallFar = Math.max(1, Math.floor(r.w / (PANEL_W + 0.7)));
    const perWallSide = Math.max(1, Math.floor(r.d / (PANEL_W + 0.7)));
    // Far wall (deeper z), facing back toward entry (+z).
    for (let i = 0; i < perWallFar; i++) {
      const x = r.cx - r.w / 2 + ((i + 0.5) * r.w) / perWallFar;
      slots.push({
        pos: new THREE.Vector3(x, y, r.cz - r.d / 2 + inset),
        rotY: 0,
      });
    }
    // Outer wall, facing the corridor.
    for (let i = 0; i < perWallSide; i++) {
      const z = r.cz - r.d / 2 + ((i + 0.5) * r.d) / perWallSide;
      slots.push({
        pos: new THREE.Vector3(
          r.cx + r.side * (r.w / 2 - inset),
          y,
          z,
        ),
        rotY: -r.side * (Math.PI / 2),
      });
    }
    // Near wall, facing deeper (-z).
    for (let i = 0; i < perWallFar; i++) {
      const x = r.cx - r.w / 2 + ((i + 0.5) * r.w) / perWallFar;
      slots.push({
        pos: new THREE.Vector3(x, y, r.cz + r.d / 2 - inset),
        rotY: Math.PI,
      });
    }
    return slots;
  }

  const roomEdgeMat = track(
    new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.35 }),
  );
  for (const r of rooms) {
    const patchGeo = track(new THREE.PlaneGeometry(r.w, r.d));
    const patch = new THREE.Mesh(
      patchGeo,
      track(
        new THREE.MeshStandardMaterial({
          color: 0x1b1b1a,
          roughness: 0.9,
          transparent: true,
          opacity: 0.9,
        }),
      ),
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(r.cx, 0.02, r.cz);
    scene.add(patch);

    const edge = new THREE.LineSegments(
      track(new THREE.EdgesGeometry(patchGeo)),
      roomEdgeMat,
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(r.cx, 0.03, r.cz);
    scene.add(edge);

    const label = labelSprite(r.name, false, true);
    label.position.set(r.cx, 3.0, r.cz);
    scene.add(label);
    track((label.material as THREE.SpriteMaterial).map!);
    track(label.material);

    // Three walls (the corridor side stays open).
    const wallH = 3.1;
    const mkWall = (w: number, dz: number, x: number, z: number, rot = 0) => {
      const wall = new THREE.Mesh(
        track(new THREE.BoxGeometry(w, wallH, 0.14)),
        wallMat.clone(),
      );
      track(wall.material as THREE.Material);
      wall.position.set(x, wallH / 2, z);
      wall.rotation.y = rot;
      scene.add(wall);
      wireframables.push(wall);
      void dz;
    };
    mkWall(r.w, 0, r.cx, r.cz - r.d / 2); // far
    mkWall(r.w, 0, r.cx, r.cz + r.d / 2); // near
    mkWall(r.d, 0, r.cx + r.side * (r.w / 2), r.cz, Math.PI / 2); // outer

    // Photos on this room's walls. Caption only when the room is the
    // generic gallery (otherwise the room label already says it).
    const slots = panelSlots(r);
    r.photos.forEach((m, i) => {
      const slot = slots[i % slots.length];
      addPanel(m, slot.pos, slot.rotY, r.name === "Gallery");
    });

    // Soft per-room fill light.
    const fill = new THREE.PointLight(0xfff2e0, 4, r.w + r.d);
    fill.position.set(r.cx, 2.9, r.cz);
    scene.add(fill);
  }
  // No textures queued (demo project) → signal ready on next tick.
  if (opts.media.length === 0) setTimeout(fireReady, 50);

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
    const room = roomFor(h.title, i);
    let pos: THREE.Vector3;
    if (room) {
      const n = roomCounts.get(room) ?? 0;
      roomCounts.set(room, n + 1);
      // Fan multiple hotspots around the room center.
      const angle = n * 2.1;
      pos = new THREE.Vector3(
        room.cx + Math.cos(angle) * Math.min(2, room.w * 0.22) * (n > 0 ? 1 : 0),
        1.55,
        room.cz + Math.sin(angle) * Math.min(2, room.d * 0.22) * (n > 0 ? 1 : 0),
      );
    } else {
      pos = new THREE.Vector3(...h.position);
    }

    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.copy(pos);
    scene.add(orb);
    hotspotMeshes.push(orb);

    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(pos.x, 0.03, pos.z);
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
  let walkHeld = false; // touch button
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
    // Touch devices drag to look instead of locking.
    if (
      !("ontouchstart" in window) &&
      document.pointerLockElement !== renderer.domElement
    ) {
      renderer.domElement.requestPointerLock();
    }
  };
  const onLock = () =>
    opts.onLockChange?.(document.pointerLockElement === renderer.domElement);

  // Touch drag-look.
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

  // Pause the render loop while the tab is hidden.
  let hidden = false;
  const onVisibility = () => {
    hidden = document.hidden;
    if (!hidden) clock.getDelta(); // swallow the gap
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

  // ── Cinematic tour: corridor → into each room → onward ──────────
  const tourPoints: THREE.Vector3[] = [START.clone()];
  for (const r of rooms) {
    tourPoints.push(new THREE.Vector3(0, EYE, r.cz + r.d / 2 + 1));
    tourPoints.push(new THREE.Vector3(r.cx * 0.55, EYE, r.cz + r.d * 0.1));
    tourPoints.push(new THREE.Vector3(r.cx * 0.25, EYE, r.cz - r.d * 0.25));
  }
  const tourCurve = new THREE.CatmullRomCurve3(
    tourPoints,
    false,
    "centripetal",
    0.35,
  );
  const TOUR_SECONDS = Math.max(24, rooms.length * 8);

  // ── Render loop ──────────────────────────────────────────────────
  const clock = new THREE.Clock();
  let raf = 0;
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const wishDir = new THREE.Vector3();

  const animate = () => {
    raf = requestAnimationFrame(animate);
    if (hidden) return;
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;

    if (touring) {
      tourT += dt / TOUR_SECONDS;
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

      const sprint =
        keys.has("ShiftLeft") || keys.has("ShiftRight") ? 1.9 : 1;
      const maxSpeed = 4.2 * speedMult * sprint;
      if (wishDir.lengthSq() > 0) {
        wishDir.normalize().applyEuler(new THREE.Euler(0, yaw, 0));
        velocity.addScaledVector(wishDir, 26 * dt);
        if (velocity.length() > maxSpeed) velocity.setLength(maxSpeed);
      }
      // Exponential damping — stops feel weighty, not abrupt.
      velocity.multiplyScalar(Math.exp(-9 * dt));
      camera.position.addScaledVector(velocity, dt);

      // Head bob proportional to speed.
      const speed = velocity.length();
      bobPhase += dt * speed * 2.6;
      camera.position.y = EYE + Math.sin(bobPhase) * 0.028 * Math.min(1, speed / 3);

      camera.position.x = Math.max(
        -maxHalfX,
        Math.min(maxHalfX, camera.position.x),
      );
      camera.position.z = Math.max(lastZ - 8, Math.min(4, camera.position.z));
    }

    const s = 1 + Math.sin(t * 2.4) * 0.18;
    for (const m of hotspotMeshes) m.scale.setScalar(s);

    renderer.render(scene, camera);
  };
  animate();

  return {
    dispose() {
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
    // Phase 0 = skeletal wireframe, 1 = finished build.
    setPhaseRatio(ratio: number) {
      const r = Math.max(0, Math.min(1, ratio));
      for (const m of wireframables) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.wireframe = r < 0.55;
        mat.opacity = 0.35 + r * 0.6;
      }
      endGlow.intensity = 6 + r * 10;
      ambient.intensity = 0.3 + r * 0.3;
    },
    setAfter(after: boolean) {
      key.color.set(after ? 0xfff2e0 : 0xbfd4e6);
      key.intensity = after ? 1.1 : 0.45;
      ambient.intensity = after ? 0.62 : 0.34;
      scene.fog = new THREE.Fog(0x0a0a09, after ? 22 : 13, after ? 62 : 40);
    },
  };
}
