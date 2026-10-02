// 東京、歩く。：Three.js で街を描き、engine.js の結果をそのまま表示する
// Three.js は CDN（jsDelivr）からバージョン固定で読み込む。

import { buildWorld } from "./city.js";
import { buildPlayer, animatePlayer } from "./player.js";
import { buildTargets } from "./targets.js";

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";

// engine.js（通常のscript）で宣言された TokyoWalkEngine を使う。window のプロパティではないので直接参照する
const E = TokyoWalkEngine;
const MS = TokyoWalkMission; // 探索ミッションのルール（mission.js）
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
let awnings = null; // ひさし（真下に入ると、頭が見えるように薄くする）
let worldStats = null;
// 画面の解像度（スマホは 1.5 倍から始め、重ければ下げる。一度重かった解像度には戻さない）
const pixelRatio = { max: 1, current: 1, min: 1, frames: 0, time: 0, settle: 0, tooSlow: Infinity, changes: 0 };
const SUN_OFFSET = { x: -26, y: 30, z: 18 }; // 夕方の低めの日ざし（南西から）
// 影の地図は「止まっている物」だけ。プレイヤーが SHADOW_CELL m 動いたときにだけ描き直す
const SHADOW_CELL = 6;
let shadowCenter = null;
let shadowUpdates = 0;
let targets = null; // 目的物の見た目と発見の演出（targets.js）

// ---- 探索ゲームの進み具合 ----
//   phase: "brief"（今日の目的を表示中）→ "run"（探索中）→ "found" / "timeup"（演出）→ 結果画面（mode = "result"）
const game = { phase: "none", mission: null, elapsed: 0, hintStage: 0, shownSec: -1, warn: 0, timer: 0, score: null, lastKey: null, best: null, newBest: false, plays: 0 };
const BEST_KEY = "tokyoWalkHighScore";
const TUTORIAL_KEY = "tokyoWalkTutorialSeen";
// localStorage は使えない環境（プライベートブラウズなど）でも止まらないようにする
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
      /* 保存できなくてもゲームは続ける */
    }
  },
};
function loadBest() {
  const v = parseInt(store.get(BEST_KEY), 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}

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
  get phase() { return game.phase; },
  mission() {
    const m = game.mission;
    return m && { type: m.type, key: m.key, label: m.label, x: m.x, z: m.z, r: m.r, area: m.area || null, spawn: m.spawn || null, elapsed: game.elapsed, remaining: Math.max(0, MS.TIME_LIMIT - game.elapsed), hintStage: game.hintStage, score: game.score, best: game.best, plays: game.plays };
  },
  snapshot() {
    const c = camera ? camera.position : { x: 0, y: 0, z: 0 };
    return { x: state.x, y: state.y, z: state.z, onGround: state.onGround, jumps: state.jumps, moving: state.moving, speed: state.speed, dash: state.dash, dashing: state.dashing, dashOn: input.dashOn, stamina: state.stamina, tired: state.tired, lands: state.lands, camYaw, fov: camera ? camera.fov : 0, cam: { x: c.x, y: c.y, z: c.z } };
  },
  // 描画の負荷（直前のフレーム）
  stats() {
    if (!renderer) return null;
    const i = renderer.info;
    return { player: player ? { tris: player.tris, meshes: player.meshes } : null, calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, sceneObjects: scene ? countObjects(scene) : 0, pixelRatio: pixelRatio.current, pixelRatioChanges: pixelRatio.changes, softShadows: renderer.shadowMap.type !== THREE.BasicShadowMap, shadowUpdates, world: worldStats };
  },
};

// =========================================================
// 入力
// =========================================================

// dashOn：スマホの DASH ボタン（押すとオン、もう一度押すかスタミナが切れるとオフ）。shift：PC の Shift キー
const input = { jx: 0, jy: 0, jumpQueued: false, keys: new Set(), dashOn: false, shift: false };

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
  // 少し倒しただけでは急に速くならないように、ゆるやかな曲線で強さを決める
  const k = mag < dead ? 0 : Math.pow((mag - dead) / (1 - dead), 1.35) / Math.max(mag, 1e-6);
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

// ---- ダッシュボタン（押すたびにオン・オフ） ----
const dashBtn = $("tw-dash");
dashBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  input.dashOn = !input.dashOn;
  updateDashButton();
});

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
    const onButton = document.activeElement && (document.activeElement.tagName === "BUTTON" || document.activeElement.tagName === "A");
    if ((e.code === "Enter" || e.code === "Space") && !onButton) {
      if (mode === "title") {
        e.preventDefault();
        startGame();
      } else if (mode === "result") {
        e.preventDefault();
        newGame();
      }
    }
    return;
  }
  // 今日の目的の表示中は、何かキーを押すとスタート
  if (game.phase === "brief" && !e.repeat) {
    e.preventDefault();
    beginRun();
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) input.jumpQueued = true;
    return;
  }
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
    input.shift = true;
    return;
  }
  if (KEYMAP[e.code]) {
    e.preventDefault();
    input.keys.add(KEYMAP[e.code]);
  }
});
document.addEventListener("keyup", (e) => {
  if (KEYMAP[e.code]) input.keys.delete(KEYMAP[e.code]);
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") input.shift = false;
});
window.addEventListener("blur", () => {
  input.keys.clear();
  input.shift = false;
  resetJoy();
});

// 2本指ピンチなどでページが拡大されないように
document.addEventListener("gesturestart", (e) => e.preventDefault());

// ---- スタミナの表示・DASH ボタンの見た目（変わったときだけ書きかえる） ----
const staminaBox = $("tw-stamina");
const staminaBar = $("tw-stamina-bar");
const hud = { shown: false, value: -1, tired: null, dash: null, idle: 0 };

function updateDashButton() {
  const on = input.dashOn && !state.tired;
  if (hud.dash === on && hud.tired === state.tired) return;
  hud.dash = on;
  dashBtn.classList.toggle("on", on);
  dashBtn.setAttribute("aria-pressed", on ? "true" : "false");
}

function updateHud(dt) {
  // 満タンでしばらく走っていなければ隠す（街を見る余白を残す）
  const full = state.stamina >= 1 && !state.dashing;
  hud.idle = full ? hud.idle + dt : 0;
  const show = hud.idle < 1.2;
  if (show !== hud.shown) {
    hud.shown = show;
    staminaBox.classList.toggle("show", show);
  }
  const v = Math.round(state.stamina * 200) / 200;
  if (v !== hud.value) {
    hud.value = v;
    staminaBar.style.transform = `scaleX(${v})`;
    staminaBox.classList.toggle("low", v < 0.3);
  }
  if (state.tired !== hud.tired) {
    staminaBox.classList.toggle("tired", state.tired);
    dashBtn.classList.toggle("tired", state.tired);
    if (state.tired) input.dashOn = false; // 切れたら一度オフ。戻ったらまた押せば走れる
    updateDashButton();
    hud.tired = state.tired;
  }
}

// =========================================================
// カメラ
// =========================================================

// キャラクターと街並みの両方が見える距離・高さ。走ると少し後ろへ引き、視野を少し広げる
const CAM_DIST = 6.4;
const CAM_DIST_DASH = 7.3;
const CAM_HEIGHT = 3.4;
const LOOK_HEIGHT = 1.55;
const FOV_DASH = 5; // 走るときに広げる角度（控えめ）
let camZoom = 1; // 壁よけで手前に寄せている割合（1 = 寄せていない）
let baseFov = 55;
let camFovAdd = 0;
let lookY = null; // 見る高さ（ジャンプで上下にガクッと動かないよう、少し遅れて追う）
let landDip = 0; // 着地のときに、カメラを少しだけ沈める
const _want = { x: 0, y: 0, z: 0 };

function updateCamera(dt, instant) {
  if (state.landed > 0) landDip = Math.max(landDip, 0.12 * state.landed);
  landDip = Math.max(0, landDip - dt * 0.6);
  const dist = CAM_DIST + (CAM_DIST_DASH - CAM_DIST) * state.dash;
  // 見る高さ：地面にいるときはすぐ、跳んでいる間はゆっくり追う
  const targetLook = state.y + LOOK_HEIGHT;
  if (lookY === null || instant) lookY = targetLook;
  else lookY += (targetLook - lookY) * Math.min(1, dt * (state.onGround ? 10 : 5));
  const headY = lookY - landDip;
  const wx = state.x + Math.sin(camYaw) * dist;
  const wy = headY - LOOK_HEIGHT + CAM_HEIGHT;
  const wz = state.z + Math.cos(camYaw) * dist;
  // 建物にめり込まないよう、頭からカメラまでの間に建物があれば手前に寄せる。
  // 寄せるときはすぐ、離すときはゆっくり（寄ったり離れたりで画面が揺れないように）
  const t = E.cameraClip(state.x, headY, state.z, wx, wy, wz);
  const k = t < 1 ? Math.max(0.12, t - 0.06) : 1;
  if (instant || k < camZoom) camZoom = k;
  else camZoom += (k - camZoom) * Math.min(1, dt * 2.5);
  // 大きく寄せたときは少し上から見下ろし、少し先を見る（頭で画面がふさがらないように）
  const lift = Math.max(0, 0.45 - camZoom) * 1.6;
  _want.x = state.x + (wx - state.x) * camZoom;
  _want.y = headY + (wy - headY) * camZoom + lift;
  _want.z = state.z + (wz - state.z) * camZoom;
  if (lift > 0) {
    // 持ち上げた先が、ひさしなどにぶつからないか確かめる
    const t2 = E.cameraClip(state.x, headY, state.z, _want.x, _want.y, _want.z);
    if (t2 < 1) {
      const k2 = Math.max(0.12, t2 - 0.06);
      _want.x = state.x + (_want.x - state.x) * k2;
      _want.y = headY + (_want.y - headY) * k2;
      _want.z = state.z + (_want.z - state.z) * k2;
    }
  }
  if (!camPos || instant) camPos = new THREE.Vector3(_want.x, _want.y, _want.z);
  else {
    const a = Math.min(1, dt * 10);
    camPos.x += (_want.x - camPos.x) * a;
    camPos.y += (_want.y - camPos.y) * a;
    camPos.z += (_want.z - camPos.z) * a;
  }
  camera.position.copy(camPos);
  // 視野：走るとほんの少し広く（なめらかに）
  const fovAdd = FOV_DASH * state.dash;
  if (Math.abs(fovAdd - camFovAdd) > 0.01) {
    camFovAdd += (fovAdd - camFovAdd) * Math.min(1, dt * 4);
    camera.fov = baseFov + camFovAdd;
    camera.updateProjectionMatrix();
  }
  const ahead = (1 - camZoom) * 2.5;
  camera.lookAt(state.x - Math.sin(camYaw) * ahead, headY - (1 - camZoom) * 0.3, state.z - Math.cos(camYaw) * ahead);
  updateSun(state.x, state.z);
}

// 影の範囲をプレイヤーのまわりに。動いていない間は描き直さない
function updateSun(x, z) {
  const cx = Math.round(x / SHADOW_CELL) * SHADOW_CELL;
  const cz = Math.round(z / SHADOW_CELL) * SHADOW_CELL;
  if (shadowCenter && shadowCenter.x === cx && shadowCenter.z === cz) return;
  shadowCenter = { x: cx, z: cz };
  sun.position.set(cx + SUN_OFFSET.x, SUN_OFFSET.y, cz + SUN_OFFSET.z);
  sun.target.position.set(cx, 0, cz);
  sun.target.updateMatrixWorld();
  renderer.shadowMap.needsUpdate = true;
  shadowUpdates++;
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
  const rawDt = Math.min(0.5, (now - last) / 1000);
  const dt = Math.min(0.05, rawDt);
  last = now;

  if (mode === "play" || mode === "result") {
    const running = mode === "play" && game.phase === "run";
    if (mode === "play") {
      if (input.keys.has("q")) camYaw += dt * 1.8;
      if (input.keys.has("e")) camYaw -= dt * 1.8;
    }
    // 探索中だけ動ける（目的の表示中・発見の演出中・結果画面では止まる）
    const { ix, iz } = running ? readInput() : { ix: 0, iz: 0 };
    E.step(state, dt, ix, iz, running && input.jumpQueued, running && (input.dashOn || input.shift));
    input.jumpQueued = false;
    animatePlayer(player, state, dt);
    updateCamera(dt);
    updateHud(dt);
    updateCompass();
    awnings.update(state.x, state.z, dt);
    updateGame(rawDt);
    targets.update(dt, state.x, state.z, game.phase !== "run" && game.phase !== "brief");
  } else {
    // タイトル画面では、空から街全体をゆっくり見回す
    titleAngle += dt * 0.1;
    animatePlayer(player, state, dt);
    camera.position.set(Math.sin(titleAngle) * 40, 27, Math.cos(titleAngle) * 40);
    camera.lookAt(0, 0, 0);
    updateSun(0, 0);
  }

  renderer.render(scene, camera);
  adaptResolution(rawDt);
  requestAnimationFrame(frame);
}

// スマホ向け：2秒ごとに平均fpsを見て、解像度を少しずつ調整する。
// 上げ下げをくり返すと、そのたびに画面の作り直しで一瞬止まるので、
// 「一度重かった解像度」には戻さない。変えた直後の2秒は測らない
function adaptResolution(rawDt) {
  if (!isTouch) return;
  if (pixelRatio.settle > 0) {
    pixelRatio.settle -= rawDt;
    return;
  }
  pixelRatio.frames++;
  pixelRatio.time += rawDt;
  if (pixelRatio.time < 2) return;
  const fps = pixelRatio.frames / pixelRatio.time;
  pixelRatio.frames = 0;
  pixelRatio.time = 0;
  let next = pixelRatio.current;
  if (fps < 45 && pixelRatio.current <= pixelRatio.min && renderer.shadowMap.type !== THREE.BasicShadowMap) {
    // 解像度を下げきっても重いときは、影のふちのぼかしをやめる（1回だけ。シェーダーの作り直しで一瞬止まる）
    renderer.shadowMap.type = THREE.BasicShadowMap;
    scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
    renderer.shadowMap.needsUpdate = true;
    pixelRatio.settle = 2;
    pixelRatio.changes++;
    return;
  }
  if (fps < 45) {
    pixelRatio.tooSlow = Math.min(pixelRatio.tooSlow, pixelRatio.current);
    next = Math.max(pixelRatio.min, pixelRatio.current - 0.25);
  } else if (fps > 58 && pixelRatio.current + 0.25 < pixelRatio.tooSlow) {
    next = Math.min(pixelRatio.max, pixelRatio.current + 0.25);
  }
  if (next !== pixelRatio.current) {
    pixelRatio.current = next;
    pixelRatio.changes++;
    pixelRatio.settle = 2;
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
  baseFov = w < h ? 62 : 50;
  camera.fov = baseFov + camFovAdd;
  camera.updateProjectionMatrix();
}

// =========================================================
// 探索ゲーム
// =========================================================

const timeBox = $("tw-time");
const timeVal = $("tw-time-val");
const hintEl = $("tw-hint");
const card = $("tw-card");
const banner = $("tw-banner");
const flash = $("tw-flash");
let hintTimer = 0;

const pad2 = (n) => String(n).padStart(2, "0");
const mmss = (sec) => `${pad2(Math.floor(sec / 60))}:${pad2(Math.floor(sec % 60))}`;

function showHint(text, ms = 6000) {
  hintEl.textContent = text;
  hintEl.classList.add("show");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hintEl.classList.remove("show"), ms);
}

// ---- 効果音（Web Audio。最初のタップのあとで用意し、失敗しても無音で続ける） ----
const sound = {
  ctx: null,
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch (e) {
      this.ctx = null;
    }
  },
  // notes: [周波数, 長さ(秒)] の並び。小さめの音量で順に鳴らす
  play(notes, type = "triangle", volume = 0.07) {
    const c = this.ctx;
    if (!c || c.state !== "running") return;
    try {
      let t = c.currentTime + 0.01;
      for (const [freq, len] of notes) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(volume, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g).connect(c.destination);
        o.start(t);
        o.stop(t + len + 0.02);
        t += len * 0.85;
      }
    } catch (e) {
      /* 音が鳴らなくてもゲームは続ける */
    }
  },
  start() { this.play([[523, 0.12], [784, 0.18]]); },
  found() { this.play([[659, 0.1], [784, 0.1], [1047, 0.12], [1319, 0.3]], "triangle", 0.08); },
  warn() { this.play([[880, 0.12], [880, 0.16]], "sine", 0.05); },
  tick() { this.play([[740, 0.06]], "sine", 0.035); },
  timeup() { this.play([[523, 0.18], [392, 0.18], [262, 0.4]], "triangle", 0.07); },
};

// 方位（N/E/S/W）：カメラの向きに合わせて帯を横にずらす
const compassStrip = $("tw-compass-strip");
const COMPASS_PX = 0.55; // 1度あたりのピクセル
let compassDeg = null;
(() => {
  const names = { 0: "N", 90: "E", 180: "S", 270: "W" };
  let html = "";
  for (let d = -360; d <= 720; d += 45) {
    const n = names[((d % 360) + 360) % 360];
    html += `<span class="${n === "N" ? "n" : n ? "" : "tick"}" style="left:${(d + 360) * COMPASS_PX}px">${n || "·"}</span>`;
  }
  compassStrip.innerHTML = html;
})();
function updateCompass() {
  // カメラが見ている向き（北=0、時計回り）
  const deg = ((((-camYaw * 180) / Math.PI) % 360) + 360) % 360;
  if (compassDeg !== null && Math.abs(deg - compassDeg) < 0.5) return;
  compassDeg = deg;
  compassStrip.style.transform = `translateX(${60 - (deg + 360) * COMPASS_PX}px)`;
}

function setTimeText(remaining) {
  const sec = Math.ceil(Math.max(0, remaining));
  if (sec === game.shownSec) return; // 1秒に1回だけ書きかえる
  game.shownSec = sec;
  timeVal.textContent = mmss(sec);
  const warn = sec <= 30 ? (sec <= 10 ? 2 : 1) : 0;
  if (warn !== game.warn) {
    game.warn = warn;
    timeBox.classList.toggle("warn", warn > 0);
    timeBox.classList.toggle("last", warn === 2);
    if (warn === 1 && game.phase === "run") sound.warn();
  }
  if (warn === 2 && game.phase === "run" && sec > 0 && sec <= 5) sound.tick();
}

// 新しいゲーム：新しい目的・新しい場所・新しい制限時間で、スタート地点から
function newGame() {
  game.mission = MS.pick(E, Math.random, game.lastKey);
  game.lastKey = game.mission.key;
  game.elapsed = 0;
  game.hintStage = 0;
  game.shownSec = -1;
  game.warn = 0;
  game.score = null;
  game.newBest = false;
  game.plays++;
  state = E.create();
  input.dashOn = false;
  input.jumpQueued = false;
  hud.tired = null;
  camYaw = 0;
  updateCamera(0, true);
  targets.show(game.mission);
  $("tw-mission-text").textContent = game.mission.label;
  timeBox.classList.remove("warn", "last");
  setTimeText(MS.TIME_LIMIT);
  hintEl.classList.remove("show");
  banner.classList.remove("show", "timeup");
  setMode("play");
  // 今日の目的。初めての人にだけ、操作を3行で
  $("tw-card-target").textContent = game.mission.label;
  const first = !store.get(TUTORIAL_KEY);
  $("tw-card-tips").hidden = !first;
  $("tw-card-tap").textContent = isTouch ? "タップでスタート" : "クリックかキーでスタート";
  card.classList.add("show");
  game.phase = "brief";
  clearTimeout(game.timer);
  game.timer = setTimeout(beginRun, first ? 5000 : 2600);
  sound.start();
}

// 目的の表示を閉じて、探索スタート（タイマーはここから）
function beginRun() {
  if (game.phase !== "brief") return;
  clearTimeout(game.timer);
  card.classList.remove("show");
  store.set(TUTORIAL_KEY, "1");
  game.phase = "run";
}
card.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  beginRun();
});

// 毎フレーム：時間を進め、ヒント・発見・時間切れを調べる（DOM は変わったときだけ書きかえる）
function updateGame(rawDt) {
  if (game.phase !== "run") return;
  game.elapsed += Math.min(rawDt, 0.25); // 裏に回っていた時間は数えない
  const remaining = MS.TIME_LIMIT - game.elapsed;
  setTimeText(remaining);
  if (game.hintStage < MS.HINT_TIMES.length && game.elapsed >= MS.HINT_TIMES[game.hintStage]) {
    showHint(game.hintStage === 0 ? MS.FIRST_HINT : `ヒント：${game.mission.hint}`);
    game.hintStage++;
  }
  if (MS.isFound(game.mission, state.x, state.z)) {
    onFound(remaining);
  } else if (remaining <= 0) {
    onTimeUp();
  }
}

function onFound(remaining) {
  game.phase = "found";
  const sc = MS.score(remaining);
  game.score = sc.total;
  game.clearTime = game.elapsed;
  input.dashOn = false;
  targets.burst(state.x, state.z);
  sound.found();
  flash.classList.remove("show");
  void flash.offsetWidth; // アニメーションを最初から
  flash.classList.add("show");
  hintEl.classList.remove("show");
  $("tw-banner-title").textContent = "FOUND!";
  const l1 = $("tw-banner-line1");
  const l2 = $("tw-banner-line2");
  l1.textContent = `+${sc.base} POINT`;
  l2.textContent = sc.bonus ? `TIME BONUS +${sc.bonus}` : "TIME BONUS なし";
  l1.classList.remove("show");
  l2.classList.remove("show");
  banner.classList.remove("timeup");
  banner.classList.add("show");
  setTimeout(() => l1.classList.add("show"), 450);
  setTimeout(() => l2.classList.add("show"), 950);
  saveBest(sc.total);
  game.timer = setTimeout(() => showResult(true), 2600);
}

function onTimeUp() {
  game.phase = "timeup";
  game.score = 0;
  setTimeText(0);
  input.dashOn = false;
  sound.timeup();
  hintEl.classList.remove("show");
  $("tw-banner-title").textContent = "TIME UP";
  $("tw-banner-line1").textContent = "";
  $("tw-banner-line2").textContent = "";
  banner.classList.add("show", "timeup");
  game.best = loadBest();
  game.timer = setTimeout(() => showResult(false), 2000);
}

function saveBest(score) {
  const best = loadBest();
  game.newBest = best === null || score > best;
  if (game.newBest) store.set(BEST_KEY, String(score));
  game.best = game.newBest ? score : best;
}

function showResult(cleared) {
  banner.classList.remove("show", "timeup");
  $("tw-result-title").textContent = cleared ? "MISSION CLEAR" : "TIME UP";
  $("tw-result-msg").textContent = cleared ? `${game.mission.short || "目的のもの"}を見つけた！` : `今回は${game.mission.short || "目的のもの"}を見つけられませんでした。`;
  $("tw-result-score").textContent = String(game.score || 0);
  $("tw-result-time-row").hidden = !cleared;
  $("tw-result-time").textContent = cleared ? mmss(game.clearTime) : "";
  $("tw-result-best").textContent = game.best ? String(game.best) : "---";
  $("tw-result-new").hidden = !(cleared && game.newBest);
  game.phase = "result";
  setMode("result");
  updateTitleBest();
  // キーボードでも続けられるように
  setTimeout(() => $("tw-retry").focus({ preventScroll: true }), 50);
}

function updateTitleBest() {
  const best = loadBest();
  const el = $("tw-title-best");
  el.hidden = !best;
  if (best) el.textContent = `BEST ${best} POINT`;
}

function startGame() {
  if (mode !== "title") return;
  sound.unlock(); // スマホは、最初のタップの中で音の準備をする
  newGame();
}

$("tw-retry").addEventListener("click", () => {
  sound.unlock();
  newGame();
});

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
  // 影は止まっている物だけなので、毎フレームは描き直さない（updateSun が必要なときだけ頼む）
  renderer.shadowMap.autoUpdate = false;
  // 夕方のやわらかい色味（後処理は使わず、トーンマッピングだけ）
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  scene = new THREE.Scene();
  scene.background = new THREE.Color("#efd2bb");
  // 遠くの街が、夕方のもやの中にとけていく
  scene.fog = new THREE.Fog("#eccfb8", 50, 230);

  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);

  // 空から：青み、地面から：暖かい照り返し（少し控えめにして、日なたと日かげの差を出す）
  scene.add(new THREE.HemisphereLight("#dfe8f4", "#b3a08c", 1.25));
  // 太陽：低めの角度から暖色の光（影は1枚だけ、プレイヤーの周りに）
  sun = new THREE.DirectionalLight("#ffe0bd", 2.7);
  sun.castShadow = true;
  // 影の地図：スマホ 896px・PC 1536px（範囲 ±24m。1ピクセルあたり約5cm/3cm）
  const shadowSize = isTouch ? 896 : 1536;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -24;
  sc.right = sc.top = 24;
  sc.near = 1;
  sc.far = 90;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const world = buildWorld(THREE, E, scene, { isTouch, maxAniso: renderer.capabilities.getMaxAnisotropy() });
  awnings = world.awnings;
  worldStats = world.stats;
  player = buildPlayer(THREE, scene, { shadowTexture: world.glowTexture });
  targets = buildTargets(THREE, scene, { glowTexture: world.glowTexture });

  resize();
  // 使うシェーダーを最初にまとめて用意する（ひさしの半透明などが初めて出たときに一瞬止まらないように）
  awnings.setPreview(true);
  targets.setPreview(true);
  renderer.compile(scene, camera);
  awnings.setPreview(false);
  targets.setPreview(false);
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 200));

  setMode("title");
  startBtn.disabled = false;
  startBtn.textContent = "探索スタート";
  updateTitleBest();
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}

boot();
