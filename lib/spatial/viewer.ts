// Sonder Simulation — walkable demo scene (Three.js).
//
// A polished placeholder world that behaves like the eventual product:
// first-person WASD + mouse-look, room zones with labels, a photo
// gallery built from the project's real media, floating hotspots, a
// cinematic auto-tour, phase-driven "construction" visuals, and a
// before/after lighting toggle. Real Gaussian-splat / GLB scenes plug
// in behind the same handle later.

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
};

export type ViewerHandle = {
  dispose(): void;
  reset(): void;
  setSpeed(mult: number): void;
  startTour(): void;
  stopTour(): void;
  isTouring(): boolean;
  setPhaseRatio(ratio: number): void;
  setAfter(after: boolean): void;
};

const ACCENT = 0x3e9bd4;
const ACCENT_BRIGHT = 0x6fc3f0;
const EYE = 1.6;

const ROOMS: { name: string; x: number; z: number; w: number; d: number }[] = [
  { name: "Entry", x: 0, z: -4, w: 6, d: 5 },
  { name: "Living Room", x: 5, z: -10, w: 6, d: 7 },
  { name: "Dining Room", x: -5, z: -10, w: 6, d: 7 },
  { name: "Kitchen", x: 5, z: -18, w: 6, d: 7 },
  { name: "Primary Suite", x: -5, z: -18, w: 6, d: 7 },
  { name: "Terrace", x: 0, z: -26, w: 10, d: 6 },
];

function labelSprite(text: string, accent = false): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const scale = 4;
  const font = `600 ${13 * scale}px Inter, system-ui, sans-serif`;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 28 * scale;
  canvas.width = w;
  canvas.height = 30 * scale;
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
  sprite.scale.set(0.55 * aspect, 0.55, 1);
  sprite.renderOrder = 10;
  return sprite;
}

export function createViewer(
  container: HTMLElement,
  opts: ViewerOptions,
): ViewerHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a09);
  scene.fog = new THREE.Fog(0x0a0a09, 18, 48);

  const camera = new THREE.PerspectiveCamera(
    68,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.1,
    120,
  );
  const START = new THREE.Vector3(0, EYE, 2.5);
  camera.position.copy(START);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";

  // ── Lights ───────────────────────────────────────────────────────
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  const key = new THREE.DirectionalLight(0xfff2e0, 0.9);
  key.position.set(6, 12, 4);
  const accentGlow = new THREE.PointLight(ACCENT, 14, 30);
  accentGlow.position.set(0, 3.4, -26);
  scene.add(ambient, key, accentGlow);

  // ── Floor + grid ─────────────────────────────────────────────────
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 90),
    new THREE.MeshStandardMaterial({ color: 0x121211, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -15;
  scene.add(floor);

  const grid = new THREE.GridHelper(90, 90, 0x232322, 0x1a1a19);
  grid.position.y = 0.01;
  grid.position.z = -15;
  scene.add(grid);

  // ── Room zones ───────────────────────────────────────────────────
  const wireframables: THREE.Mesh[] = [];
  for (const r of ROOMS) {
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(r.w, r.d),
      new THREE.MeshStandardMaterial({
        color: 0x1b1b1a,
        roughness: 0.9,
        transparent: true,
        opacity: 0.9,
      }),
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(r.x, 0.02, r.z);
    scene.add(patch);

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(r.w, r.d)),
      new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.35 }),
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(r.x, 0.03, r.z);
    scene.add(edge);

    const label = labelSprite(r.name);
    label.position.set(r.x, 2.5, r.z);
    scene.add(label);

    // Wall stubs on the room's outer edge — the bones of the future
    // build, kept off the central walking path.
    if (r.x !== 0) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 2.6, r.d),
        new THREE.MeshStandardMaterial({
          color: 0x1e1e1d,
          roughness: 0.85,
          transparent: true,
          opacity: 0.92,
        }),
      );
      wall.position.set(r.x + Math.sign(r.x) * (r.w / 2), 1.3, r.z);
      scene.add(wall);
      wireframables.push(wall);
    }
  }

  // ── Photo gallery panels from real project media ─────────────────
  const texLoader = new THREE.TextureLoader();
  const panelTargets: THREE.Vector3[] = [];
  const disposables: { dispose: () => void }[] = [];
  opts.media.slice(0, 10).forEach((m, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const z = -4 - Math.floor(i / 2) * 5.4;
    const x = side * 7.6;
    const group = new THREE.Group();

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(4.5, 3.0, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x090908, roughness: 0.6 }),
    );
    group.add(frame);

    const mat = new THREE.MeshBasicMaterial({ color: 0x15181a });
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(4.24, 2.76), mat);
    photo.position.z = 0.06;
    group.add(photo);
    texLoader.load(m.url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    });
    disposables.push(mat);

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.7, 0.05),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.8 }),
    );
    glow.position.set(0, -1.62, 0.06);
    group.add(glow);

    if (m.label) {
      const cap = labelSprite(m.label, true);
      cap.position.set(0, -2.05, 0.2);
      group.add(cap);
    }

    group.position.set(x, 1.9, z);
    group.rotation.y = (-side * Math.PI) / 2;
    scene.add(group);
    panelTargets.push(new THREE.Vector3(x, EYE, z));
    wireframables.push(frame);
  });

  // ── Hotspots ─────────────────────────────────────────────────────
  const hotspotMeshes: THREE.Mesh[] = [];
  for (const h of opts.hotspots) {
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 20, 20),
      new THREE.MeshBasicMaterial({ color: ACCENT_BRIGHT }),
    );
    orb.position.set(...h.position);
    scene.add(orb);
    hotspotMeshes.push(orb);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.24, 32),
      new THREE.MeshBasicMaterial({
        color: ACCENT,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      }),
    );
    halo.position.set(h.position[0], 0.03, h.position[2]);
    halo.rotation.x = -Math.PI / 2;
    scene.add(halo);

    const tag = labelSprite(h.title, true);
    tag.position.set(h.position[0], h.position[1] + 0.55, h.position[2]);
    scene.add(tag);
  }

  // ── First-person controls ────────────────────────────────────────
  let yaw = 0;
  let pitch = 0;
  let speedMult = 1;
  const keys = new Set<string>();
  let touring = false;
  let tourT = 0;

  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (touring && ["KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) {
      touring = false;
    }
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    yaw -= e.movementX * 0.0022;
    pitch = Math.max(
      -1.35,
      Math.min(1.35, pitch - e.movementY * 0.0022),
    );
  };
  const onClick = () => {
    if (document.pointerLockElement !== renderer.domElement) {
      renderer.domElement.requestPointerLock();
    }
  };
  const onLock = () =>
    opts.onLockChange?.(document.pointerLockElement === renderer.domElement);
  const onResize = () => {
    const w = container.clientWidth;
    const h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("pointerlockchange", onLock);
  renderer.domElement.addEventListener("click", onClick);
  window.addEventListener("resize", onResize);

  // ── Cinematic tour path ──────────────────────────────────────────
  const tourPoints =
    panelTargets.length >= 2
      ? panelTargets.map(
          (p) => new THREE.Vector3(p.x * 0.45, EYE, p.z + 0.6),
        )
      : ROOMS.map((r) => new THREE.Vector3(r.x * 0.75, EYE, r.z + 1.5));
  tourPoints.unshift(START.clone());
  const tourCurve = new THREE.CatmullRomCurve3(tourPoints, false, "centripetal", 0.4);
  const TOUR_SECONDS = Math.max(20, tourPoints.length * 6);

  // ── Render loop ──────────────────────────────────────────────────
  const clock = new THREE.Clock();
  let raf = 0;
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const dir = new THREE.Vector3();

  const animate = () => {
    raf = requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;

    if (touring) {
      tourT += dt / TOUR_SECONDS;
      if (tourT >= 1) {
        touring = false;
        tourT = 0;
      } else {
        const pos = tourCurve.getPointAt(Math.min(1, tourT));
        const ahead = tourCurve.getPointAt(Math.min(1, tourT + 0.015));
        camera.position.copy(pos);
        camera.lookAt(ahead);
        euler.setFromQuaternion(camera.quaternion, "YXZ");
        yaw = euler.y;
        pitch = euler.x;
      }
    } else {
      euler.set(pitch, yaw, 0);
      camera.quaternion.setFromEuler(euler);
      dir.set(0, 0, 0);
      if (keys.has("KeyW")) dir.z -= 1;
      if (keys.has("KeyS")) dir.z += 1;
      if (keys.has("KeyA")) dir.x -= 1;
      if (keys.has("KeyD")) dir.x += 1;
      if (dir.lengthSq() > 0) {
        dir.normalize().applyEuler(new THREE.Euler(0, yaw, 0));
        const speed = 4.2 * speedMult;
        camera.position.addScaledVector(dir, speed * dt);
      }
      camera.position.y = EYE;
      camera.position.x = Math.max(-8.6, Math.min(8.6, camera.position.x));
      camera.position.z = Math.max(-29, Math.min(3, camera.position.z));
    }

    // Hotspot pulse
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
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("click", onClick);
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      renderer.dispose();
      for (const d of disposables) d.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      renderer.domElement.remove();
    },
    reset() {
      touring = false;
      tourT = 0;
      camera.position.copy(START);
      yaw = 0;
      pitch = 0;
    },
    setSpeed(mult: number) {
      speedMult = mult;
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
      accentGlow.intensity = 6 + r * 10;
      ambient.intensity = 0.3 + r * 0.3;
    },
    setAfter(after: boolean) {
      key.color.set(after ? 0xfff2e0 : 0xbfd4e6);
      key.intensity = after ? 1.1 : 0.45;
      ambient.intensity = after ? 0.62 : 0.34;
      scene.fog = new THREE.Fog(0x0a0a09, after ? 20 : 12, after ? 52 : 38);
    },
  };
}
