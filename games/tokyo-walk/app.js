// 東京、歩く。：Three.js で街を描き、engine.js の結果をそのまま表示する
// Three.js は CDN（jsDelivr）からバージョン固定で読み込む。

import { buildWorld, buildPlayer } from "./city.js";

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";

// engine.js（通常のscript）で宣言された TokyoWalkEngine を使う。window のプロパティではないので直接参照する
const E = TokyoWalkEngine;
const $ = (id) => document.getElementById(id);
const app = $("tw-app");
const canvas = $("tw-canvas");
const startBtn = $("tw-start");

const isTouch = matchMedia("(hover: none), (pointer: coarse)").matches;

let THREE = null;
let renderer, scene, camera, sun;
let player = null; // 表示用の人型
let state = E.create();
let camYaw = 0; // 0 = カメラが南側（北を向いて見る）
let camPos = null;
let last = performance.now();
let mode = "loading";
let titleAngle = 0.6;
let awnings = []; // ひさし（真下に入ると、頭が見えるように薄くする）
let worldStats = null;
// 画面の解像度（スマホは 1.5 倍から始め、重ければ下げ、軽ければ上げる）
const pixelRatio = { max: 1, current: 1, min: 1, frames: 0, time: 0 };
const SUN_OFFSET = { x: -26, y: 30, z: 18 }; // 夕方の低めの日ざし（南西から）

function countObjects(root) {
  let n = 0;
  root.traverse((o) => {
    if (o.isMesh || o.isLine || o.isPoints) n++;
  });
  return n;
}

function setMode(m) {
  mode = m;
  app.dataset.state = m;
}

// テスト用の読み取り専用の窓口（ゲームの動作には影響しない）
window.__tokyoWalk = {
  get ready() { return !!THREE && !!renderer; },
  get revision() { return THREE ? THREE.REVISION : null; },
  get mode() { return mode; },
  snapshot() {
    const c = camera ? camera.position : { x: 0, y: 0, z: 0 };
    return { x: state.x, y: state.y, z: state.z, onGround: state.onGround, jumps: state.jumps, moving: state.moving, camYaw, cam: { x: c.x, y: c.y, z: c.z } };
  },
  // 描画の負荷（直前のフレーム）
  stats() {
    if (!renderer) return null;
    const i = renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, sceneObjects: scene ? countObjects(scene) : 0, pixelRatio: pixelRatio.current, world: worldStats };
  },
};

// =========================================================
// 入力
// =========================================================

const input = { jx: 0, jy: 0, jumpQueued: false, keys: new Set() };

// ---- 仮想ジョイスティック（左下。触れた場所が中心になる） ----
const joyZone = $("tw-joy-zone");
const joy = $("tw-joy");
const JOY_R = 50;
let joyId = null;
let joyOrigin = null;

function resetJoy() {
  joyId = null;
  input.jx = 0;
  input.jy = 0;
  joy.classList.remove("active");
  joy.style.removeProperty("--jx");
  joy.style.removeProperty("--jy");
  joy.style.setProperty("--kx", "0px");
  joy.style.setProperty("--ky", "0px");
}

joyZone.addEventListener("pointerdown", (e) => {
  if (joyId !== null) return;
  e.preventDefault();
  joyId = e.pointerId;
  joyZone.setPointerCapture(e.pointerId);
  const r = joyZone.getBoundingClientRect();
  // 土台がはみ出さない範囲で、触れた場所を中心にする
  const x = Math.max(64, Math.min(r.width - 64, e.clientX - r.left));
  const y = Math.max(64, Math.min(r.height - 64, e.clientY - r.top));
  joyOrigin = { x: r.left + x, y: r.top + y };
  joy.style.setProperty("--jx", x + "px");
  joy.style.setProperty("--jy", y + "px");
  joy.classList.add("active");
  moveJoy(e);
});

function moveJoy(e) {
  let dx = e.clientX - joyOrigin.x;
  let dy = e.clientY - joyOrigin.y;
  const len = Math.hypot(dx, dy);
  if (len > JOY_R) {
    dx = (dx / len) * JOY_R;
    dy = (dy / len) * JOY_R;
  }
  joy.style.setProperty("--kx", dx + "px");
  joy.style.setProperty("--ky", dy + "px");
  const mag = Math.min(1, len / JOY_R);
  const dead = 0.12;
  const k = mag < dead ? 0 : (mag - dead) / (1 - dead) / Math.max(mag, 1e-6);
  input.jx = (dx / JOY_R) * k;
  input.jy = (-dy / JOY_R) * k; // 上が前
}

joyZone.addEventListener("pointermove", (e) => {
  if (e.pointerId === joyId) moveJoy(e);
});
["pointerup", "pointercancel", "lostpointercapture"].forEach((t) =>
  joyZone.addEventListener(t, (e) => {
    if (e.pointerId === joyId) resetJoy();
  })
);

// ---- ジャンプボタン ----
const jumpBtn = $("tw-jump");
jumpBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  input.jumpQueued = true;
  jumpBtn.classList.add("pressed");
});
["pointerup", "pointercancel", "pointerleave"].forEach((t) => jumpBtn.addEventListener(t, () => jumpBtn.classList.remove("pressed")));

// ---- 右側をなぞってカメラを回す ----
const look = $("tw-look");
let lookId = null;
let lookX = 0;
look.addEventListener("pointerdown", (e) => {
  if (lookId !== null) return;
  e.preventDefault();
  lookId = e.pointerId;
  lookX = e.clientX;
  look.setPointerCapture(e.pointerId);
});
look.addEventListener("pointermove", (e) => {
  if (e.pointerId !== lookId) return;
  camYaw -= (e.clientX - lookX) * 0.008;
  lookX = e.clientX;
});
["pointerup", "pointercancel", "lostpointercapture"].forEach((t) =>
  look.addEventListener(t, (e) => {
    if (e.pointerId === lookId) lookId = null;
  })
);

// ---- キーボード ----
const KEYMAP = { KeyW: "f", ArrowUp: "f", KeyS: "b", ArrowDown: "b", KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r", KeyQ: "q", KeyE: "e" };
document.addEventListener("keydown", (e) => {
  if (mode !== "play") {
    if (mode === "title" && (e.code === "Enter" || e.code === "Space") && document.activeElement !== startBtn) {
      e.preventDefault();
      startGame();
    }
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) input.jumpQueued = true;
    return;
  }
  if (KEYMAP[e.code]) {
    e.preventDefault();
    input.keys.add(KEYMAP[e.code]);
  }
});
document.addEventListener("keyup", (e) => {
  if (KEYMAP[e.code]) input.keys.delete(KEYMAP[e.code]);
});
window.addEventListener("blur", () => {
  input.keys.clear();
  resetJoy();
});

// 2本指ピンチなどでページが拡大されないように
document.addEventListener("gesturestart", (e) => e.preventDefault());

function animatePlayer(dt) {
  const p = player;
  p.g.position.set(state.x, state.y, state.z);
  p.g.rotation.y = state.facing;

  const air = !state.onGround;
  p.phase += dt * (6 + 6 * state.moving) * (state.moving > 0.05 ? 1 : 0);
  const swing = air ? 0 : Math.sin(p.phase) * 0.75 * state.moving;
  p.legL.pivot.rotation.x = air ? -0.6 : swing;
  p.legR.pivot.rotation.x = air ? 0.3 : -swing;
  p.armL.pivot.rotation.x = air ? -2.4 : -swing * 0.9;
  p.armR.pivot.rotation.x = air ? -2.4 : swing * 0.9;
  const bob = air ? 0 : Math.abs(Math.sin(p.phase)) * 0.05 * state.moving;
  p.body.position.y = 0.95 + bob;
  p.head.position.y = 1.62 + bob;
}

// =========================================================
// カメラ
// =========================================================

// 第2版：少し近く・低めにして、キャラクターと街並みの両方が見えるように
const CAM_DIST = 6.4;
const CAM_HEIGHT = 3.5;
const LOOK_HEIGHT = 1.55;

function updateCamera(dt, instant) {
  const headY = state.y + LOOK_HEIGHT;
  const want = new THREE.Vector3(state.x + Math.sin(camYaw) * CAM_DIST, state.y + CAM_HEIGHT, state.z + Math.cos(camYaw) * CAM_DIST);
  // 建物にめり込まないよう、頭からカメラまでの間に建物があれば手前に寄せる
  const t = E.cameraClip(state.x, headY, state.z, want.x, want.y, want.z);
  if (t < 1) {
    const k = Math.max(0.12, t - 0.06);
    want.set(state.x + (want.x - state.x) * k, headY + (want.y - headY) * k, state.z + (want.z - state.z) * k);
  }
  if (!camPos || instant) camPos = want.clone();
  else camPos.lerp(want, Math.min(1, dt * 8));
  camera.position.copy(camPos);
  camera.lookAt(state.x, headY, state.z);

  // 影の範囲をプレイヤーのまわりに
  sun.position.set(state.x + SUN_OFFSET.x, SUN_OFFSET.y, state.z + SUN_OFFSET.z);
  sun.target.position.set(state.x, 0, state.z);
}

// プレイヤーがひさしの下（またはすぐそば）にいるときは、ひさしを薄くする
function fadeAwnings(dt) {
  for (const a of awnings) {
    const d = a.data;
    const near = Math.abs(state.x - d.x) < d.w / 2 + 1.2 && Math.abs(state.z - d.z) < d.d / 2 + 1.2;
    const target = near ? 0.22 : 1;
    const m = a.mesh.material;
    m.opacity += (target - m.opacity) * Math.min(1, dt * 8);
    m.depthWrite = m.opacity > 0.95;
  }
}

// =========================================================
// ループ
// =========================================================

function readInput() {
  let jx = input.jx;
  let jy = input.jy;
  const k = input.keys;
  if (k.has("f")) jy += 1;
  if (k.has("b")) jy -= 1;
  if (k.has("r")) jx += 1;
  if (k.has("l")) jx -= 1;
  // カメラから見た「前」「右」をワールドの向きに直す
  const fx = -Math.sin(camYaw);
  const fz = -Math.cos(camYaw);
  const rx = Math.cos(camYaw);
  const rz = -Math.sin(camYaw);
  return { ix: rx * jx + fx * jy, iz: rz * jx + fz * jy };
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (mode === "play") {
    if (input.keys.has("q")) camYaw += dt * 1.8;
    if (input.keys.has("e")) camYaw -= dt * 1.8;
    const { ix, iz } = readInput();
    E.step(state, dt, ix, iz, input.jumpQueued);
    input.jumpQueued = false;
    animatePlayer(dt);
    updateCamera(dt);
    fadeAwnings(dt);
  } else {
    // タイトル画面では、空から街全体をゆっくり見回す
    titleAngle += dt * 0.1;
    animatePlayer(dt);
    camera.position.set(Math.sin(titleAngle) * 40, 27, Math.cos(titleAngle) * 40);
    camera.lookAt(0, 0, 0);
    sun.position.set(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z);
    sun.target.position.set(0, 0, 0);
  }

  renderer.render(scene, camera);
  adaptResolution(dt);
  requestAnimationFrame(frame);
}

// スマホ向け：2秒ごとに平均fpsを見て、解像度を少しずつ調整する
function adaptResolution(dt) {
  if (!isTouch) return;
  pixelRatio.frames++;
  pixelRatio.time += dt;
  if (pixelRatio.time < 2) return;
  const fps = pixelRatio.frames / pixelRatio.time;
  pixelRatio.frames = 0;
  pixelRatio.time = 0;
  let next = pixelRatio.current;
  if (fps < 40) next = Math.max(pixelRatio.min, pixelRatio.current - 0.25);
  else if (fps > 57) next = Math.min(pixelRatio.max, pixelRatio.current + 0.25);
  if (next !== pixelRatio.current) {
    pixelRatio.current = next;
    renderer.setPixelRatio(next);
    resize();
  }
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 縦長の画面では少し広めに見せる
  camera.fov = w < h ? 62 : 50;
  camera.updateProjectionMatrix();
}

function startGame() {
  if (mode !== "title") return;
  setMode("play");
  camYaw = 0;
  updateCamera(0, true);
  const hint = $("tw-hint");
  hint.textContent = isTouch ? "左下で歩く・右下でジャンプ・右側をなぞって見回す" : "WASDで歩く・Spaceでジャンプ・Q/Eで見回す";
  hint.classList.add("show");
  setTimeout(() => hint.classList.remove("show"), 4000);
}

startBtn.addEventListener("click", startGame);

// =========================================================
// 起動：Three.js を読み込んでから街を作る
// =========================================================

async function boot() {
  try {
    THREE = await import(THREE_URL);
  } catch (err) {
    setMode("error");
    $("tw-error").hidden = false;
    startBtn.textContent = "読み込めませんでした";
    console.warn("Three.js を読み込めませんでした", err);
    return;
  }

  renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: "high-performance" });
  pixelRatio.max = Math.min(window.devicePixelRatio || 1, isTouch ? 1.75 : 2);
  pixelRatio.current = isTouch ? Math.min(pixelRatio.max, 1.5) : pixelRatio.max;
  renderer.setPixelRatio(pixelRatio.current);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // 夕方のやわらかい色味（後処理は使わず、トーンマッピングだけ）
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  scene.background = new THREE.Color("#f2d3ba");
  // 遠くの街が、夕方のもやの中にとけていく
  scene.fog = new THREE.Fog("#efcfb6", 55, 215);

  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);

  // 空から：青み、地面から：暖かい照り返し
  scene.add(new THREE.HemisphereLight("#d9e8ff", "#c0a183", 1.45));
  // 太陽：低めの角度から暖色の光（影は1枚だけ、プレイヤーの周りに）
  sun = new THREE.DirectionalLight("#ffd9ae", 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -26;
  sc.right = sc.top = 26;
  sc.near = 1;
  sc.far = 90;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const world = buildWorld(THREE, E, scene, { isTouch, maxAniso: renderer.capabilities.getMaxAnisotropy() });
  awnings = world.awnings;
  worldStats = world.stats;
  player = buildPlayer(THREE, scene);

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 200));

  setMode("title");
  startBtn.disabled = false;
  startBtn.textContent = "歩きはじめる";
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}

boot();
