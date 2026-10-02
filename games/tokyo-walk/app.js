// 東京、歩く。：Three.js で街を描き、engine.js の結果をそのまま表示する
// Three.js は CDN（jsDelivr）からバージョン固定で読み込む。

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
const awnings = []; // ひさし（真下に入ると、頭が見えるように薄くする）

function setMode(m) {
  mode = m;
  app.dataset.state = m;
}

// テスト用の読み取り専用の窓口（ゲームの動作には影響しない）
window.__tokyoWalk = {
  get ready() { return !!THREE && !!renderer; },
  get revision() { return THREE ? THREE.REVISION : null; },
  get mode() { return mode; },
  snapshot() { return { x: state.x, y: state.y, z: state.z, onGround: state.onGround, jumps: state.jumps, moving: state.moving, camYaw }; },
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

// =========================================================
// テクスチャ（Canvas で作る。画像ファイルは使わない）
// =========================================================

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 窓の並んだ壁（白で描いて、建物の色と掛け合わせる）
function windowTexture() {
  return canvasTexture(64, 64, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        g.fillStyle = "#6f87a8";
        g.fillRect(x * 32 + 7, y * 32 + 8, 18, 16);
        g.fillStyle = "rgba(255,255,255,0.35)";
        g.fillRect(x * 32 + 8, y * 32 + 9, 7, 14);
      }
    }
  });
}

function textTexture(text, bg, fg, w = 256, h = 96) {
  return canvasTexture(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 6;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = fg;
    g.font = `900 ${Math.round(h * 0.52)}px "Hiragino Sans","Noto Sans JP",sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 2, w - 24);
  });
}

function vendingTexture() {
  return canvasTexture(64, 128, (g) => {
    g.fillStyle = "#e8413a";
    g.fillRect(0, 0, 64, 128);
    g.fillStyle = "#f6fbff";
    g.fillRect(6, 8, 52, 62);
    const colors = ["#2f7de1", "#f2b134", "#3cb371", "#e8413a", "#8a5cd1", "#1fb5c9"];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 5; c++) {
        g.fillStyle = colors[(r * 5 + c) % colors.length];
        g.fillRect(9 + c * 10, 12 + r * 20, 6, 14);
      }
    }
    g.fillStyle = "#222";
    g.fillRect(10, 96, 44, 12);
    g.fillStyle = "#fff";
    g.fillRect(46, 76, 8, 12);
  });
}

// =========================================================
// 街を作る
// =========================================================

function buildCity() {
  const F = E.FIELD;
  const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

  // ---- 地面 ----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(F * 2 + 60, F * 2 + 60), lambert("#d6d0c4"));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const flat = (w, d, color, x, z, y = 0.01) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lambert(color));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };

  // 歩道（道路の両側）
  flat(F * 2, E.SIDEWALK * 2, "#ebe5d8", 0, 0, 0.005);
  flat(E.SIDEWALK * 2, F * 2, "#ebe5d8", 0, 0, 0.006);
  // 道路
  flat(F * 2, E.ROAD * 2, "#5d6272", 0, 0, 0.02);
  flat(E.ROAD * 2, F * 2, "#5d6272", 0, 0, 0.021);
  // 縁石
  const curbMat = lambert("#c9c3b6");
  for (const s of [-1, 1]) {
    for (const [w, d, x, z] of [
      [F * 2, 0.25, 0, s * E.ROAD],
      [0.25, F * 2, s * E.ROAD, 0],
    ]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), curbMat);
      c.position.set(x, 0.06, z);
      c.receiveShadow = true;
      scene.add(c);
    }
  }
  // 公園（南西ブロックの一部）
  flat(17, 22, "#a7d58c", -27.5, 15.5, 0.012);

  // 白線（センターライン）と横断歩道 → 1つのInstancedMeshにまとめる
  const stripeGeo = new THREE.PlaneGeometry(1, 1);
  stripeGeo.rotateX(-Math.PI / 2);
  const stripes = [];
  for (let t = -F + 2; t < F; t += 4) {
    if (Math.abs(t) < E.SIDEWALK + 2) continue;
    stripes.push([t, 0, 2, 0.18]);
    stripes.push([0, t, 0.18, 2]);
  }
  // 横断歩道：交差点の4方向
  for (const s of [-1, 1]) {
    for (let k = -3; k <= 3; k++) {
      stripes.push([k * 1.1, s * (E.ROAD + 1.4), 0.55, 2.2]); // 東西に渡る道の上
      stripes.push([s * (E.ROAD + 1.4), k * 1.1, 2.2, 0.55]);
    }
  }
  const stripeMesh = new THREE.InstancedMesh(stripeGeo, lambert("#f7f7f2"), stripes.length);
  const m4 = new THREE.Matrix4();
  stripes.forEach(([x, z, w, d], i) => {
    m4.compose(new THREE.Vector3(x, 0.03, z), new THREE.Quaternion(), new THREE.Vector3(w, 1, d));
    stripeMesh.setMatrixAt(i, m4);
  });
  stripeMesh.receiveShadow = true;
  scene.add(stripeMesh);

  // ---- 建物 ----
  const winTex = windowTexture();
  const roofMat = lambert("#b9b4ad");
  const acMat = lambert("#e6e6e6");
  const SIGN_COLORS = ["#ff6b6b", "#3a86ff", "#2a9d8f", "#ff9f1c", "#8338ec"];
  E.BUILDINGS.forEach((b, i) => {
    const tex = winTex.clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(Math.max(1, Math.round(b.w / 3)), Math.max(1, Math.round(b.h / 3)));
    const texZ = tex.clone();
    texZ.needsUpdate = true;
    texZ.repeat.set(Math.max(1, Math.round(b.d / 3)), Math.max(1, Math.round(b.h / 3)));
    const wallX = lambert(b.color, { map: texZ });
    const wallZ = lambert(b.color, { map: tex });
    // 箱の面の順番：+x, -x, +y, -y, +z, -z
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), [wallX, wallX, roofMat, roofMat, wallZ, wallZ]);
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // 1階のひさし（道路側。位置は engine.js と共有）
    const aw = E.AWNINGS[i];
    const { towardX, towardZ } = aw;
    const awning = new THREE.Mesh(new THREE.BoxGeometry(aw.w, 0.18, aw.d), lambert(SIGN_COLORS[i % SIGN_COLORS.length], { transparent: true }));
    awning.position.set(aw.x, aw.y, aw.z);
    awnings.push({ mesh: awning, data: aw });
    awning.castShadow = true;
    scene.add(awning);

    // 屋上の室外機
    const ac = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 1.0), acMat);
    ac.position.set(b.x - b.w * 0.25, b.h + 0.45, b.z + b.d * 0.2);
    scene.add(ac);

    // 屋上の看板
    if (b.sign) {
      const color = SIGN_COLORS[i % SIGN_COLORS.length];
      const sw = Math.min(b.w, 8);
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(sw, 2.2, 0.3),
        [
          lambert("#fff"), lambert("#fff"), lambert("#fff"), lambert("#fff"),
          lambert("#fff", { map: textTexture(b.sign, color, "#fff") }),
          lambert("#fff", { map: textTexture(b.sign, color, "#fff") }),
        ]
      );
      // 東西の道路に面した看板は、文字面が ±x を向くよう回す
      if (towardX) sign.rotation.y = Math.PI / 2;
      sign.position.set(b.x + towardX * (b.w / 2 - 0.6), b.h + 1.3, b.z + towardZ * (b.d / 2 - 0.6));
      sign.castShadow = true;
      scene.add(sign);
    }
  });

  // ---- 街灯（柱と灯りをそれぞれInstancedMeshに） ----
  const lamps = E.PROPS.filter((p) => p.kind === "lamp");
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6);
  const headGeo = new THREE.SphereGeometry(0.28, 10, 8);
  const poles = new THREE.InstancedMesh(poleGeo, lambert("#59607a"), lamps.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: "#fff4c8" }), lamps.length);
  lamps.forEach((p, i) => {
    m4.makeTranslation(p.x, 2.1, p.z);
    poles.setMatrixAt(i, m4);
    m4.makeTranslation(p.x, 4.3, p.z);
    heads.setMatrixAt(i, m4);
  });
  poles.castShadow = true;
  scene.add(poles, heads);

  // ---- 木 ----
  const trees = E.PROPS.filter((p) => p.kind === "tree");
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.22, 1.6, 6), lambert("#8a5a3b"), trees.length);
  const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.25, 0), lambert("#6cbf6a", { flatShading: true }), trees.length);
  trees.forEach((p, i) => {
    m4.makeTranslation(p.x, 0.8, p.z);
    trunks.setMatrixAt(i, m4);
    const s = 0.85 + ((i * 37) % 10) / 25;
    m4.compose(new THREE.Vector3(p.x, 2.2 * s, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i, 0)), new THREE.Vector3(s, s, s));
    leaves.setMatrixAt(i, m4);
  });
  trunks.castShadow = leaves.castShadow = true;
  scene.add(trunks, leaves);

  // ---- 自動販売機 ----
  const vendFront = lambert("#fff", { map: vendingTexture() });
  const vendBody = lambert("#e8413a");
  E.PROPS.filter((p) => p.kind === "vending").forEach((p) => {
    // 箱の面の順番：+x, -x, +y, -y, +z, -z。正面（+z）を道路側へ回す
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.w, 1.8, p.d), [vendBody, vendBody, vendBody, vendBody, vendFront, vendBody]);
    mesh.position.set(p.x, 0.9, p.z);
    mesh.rotation.y = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][p.rot];
    mesh.castShadow = true;
    scene.add(mesh);
  });

  // ---- 立て看板 ----
  const boardBody = lambert("#3d3f4a");
  E.PROPS.filter((p) => p.kind === "signboard").forEach((p, i) => {
    const face = lambert("#fff", { map: textTexture(p.text, ["#ffffff", "#fff3d6", "#e8f6ff", "#eaffea"][i % 4], "#2b2f3f", 128, 128) });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.w, 1.1, p.d * 0.4), [boardBody, boardBody, boardBody, boardBody, face, face]);
    mesh.position.set(p.x, 0.55, p.z);
    // 文字が道路から読めるように向ける
    mesh.rotation.y = Math.abs(p.z) < Math.abs(p.x) ? Math.PI / 2 : 0;
    mesh.castShadow = true;
    scene.add(mesh);
  });
}

// =========================================================
// 主人公（プリミティブだけの人型）
// =========================================================

function buildPlayer() {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const skin = mat("#ffd9bd");
  const hoodie = mat("#4fb3bf");
  const pants = mat("#3d4466");
  const shoe = mat("#ff7a7a");

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.45, 4, 10), hoodie);
  body.position.y = 0.95;
  g.add(body);

  const head = new THREE.Group();
  head.position.y = 1.62;
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), skin);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.315, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), mat("#3a3346"));
  hair.rotation.x = -0.25;
  const eyeMat = new THREE.MeshBasicMaterial({ color: "#2b2f3f" });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), eyeMat);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.1, -0.02, 0.27);
  eyeR.position.set(0.1, -0.02, 0.27);
  head.add(face, hair, eyeL, eyeR);
  g.add(head);

  // 腕と脚は付け根で回せるように、グループの中に入れる
  const limb = (w, h, d, material, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.y = -h / 2;
    pivot.add(m);
    g.add(pivot);
    return { pivot, mesh: m };
  };
  const armL = limb(0.14, 0.5, 0.14, hoodie, -0.4, 1.25);
  const armR = limb(0.14, 0.5, 0.14, hoodie, 0.4, 1.25);
  const legL = limb(0.18, 0.6, 0.2, pants, -0.14, 0.62);
  const legR = limb(0.18, 0.6, 0.2, pants, 0.14, 0.62);
  for (const leg of [legL, legR]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.3), shoe);
    s.position.set(0, -0.6, 0.05);
    leg.pivot.add(s);
  }

  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  scene.add(g);
  return { g, body, head, armL, armR, legL, legR, phase: 0 };
}

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

const CAM_DIST = 7;
const CAM_HEIGHT = 4.2;

function updateCamera(dt, instant) {
  const headY = state.y + 1.4;
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
  sun.position.set(state.x + 18, 30, state.z + 10);
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
    camera.position.set(Math.sin(titleAngle) * 36, 26, Math.cos(titleAngle) * 36);
    camera.lookAt(0, 0, 0);
    sun.position.set(18, 30, 10);
    sun.target.position.set(0, 0, 0);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.75 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color("#bfe3ff");
  scene.fog = new THREE.Fog("#d7ecff", 40, 95);

  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);

  scene.add(new THREE.HemisphereLight("#eaf6ff", "#c9b99c", 1.6));
  sun = new THREE.DirectionalLight("#fff3dc", 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -22;
  sc.right = sc.top = 22;
  sc.near = 1;
  sc.far = 80;
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);

  buildCity();
  player = buildPlayer();

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
