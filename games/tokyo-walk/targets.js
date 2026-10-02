// 東京、歩く。5.0：探索の目的物（見た目）と、発見の演出
//
// ・赤い自販機・黄色い立て看板・郵便ポスト・黒ねこは、起動時に1つずつ作っておき、
//   ゲームごとに選ばれた1つだけを、選ばれた場所に置く（毎回新しく作らない）
// ・お店・袖看板・公園は、街にもとからある物が目的物
// ・近く（約8m以内）に来たときだけ、小さなきらめきを出す（遠くからは場所が分からない）

import { createKit } from "./city.js";

const NEAR = 8; // きらめきが見える距離
const VEND_RY = [Math.PI, Math.PI / 2, 0, -Math.PI / 2]; // engine.js の自販機と同じ向き

function canvasTexture(THREE, w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildTargets(THREE, scene, { glowTexture }) {
  const K = createKit(THREE);
  const { M, Batch, BOX6, CYL, DOME } = K;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  let tris = 0;
  const merged = (build) => {
    const b = new Batch();
    build(b);
    tris += b.tris;
    const m = b.meshes(mat)[0];
    m.castShadow = false;
    return m;
  };
  const holder = () => {
    const g = new THREE.Group();
    g.visible = false;
    scene.add(g);
    return g;
  };

  // ---- 赤い自販機（正面は +z）----
  const vendFront = canvasTexture(THREE, 64, 128, (g) => {
    g.fillStyle = "#f6fbff";
    g.fillRect(0, 0, 64, 128);
    const colors = ["#2f7de1", "#f2b134", "#3cb371", "#e8413a", "#8a5cd1", "#1fb5c9"];
    for (let r = 0; r < 3; r++) {
      g.fillStyle = "#dfe8f0";
      g.fillRect(4, 8 + r * 24, 56, 22);
      for (let c = 0; c < 5; c++) {
        g.fillStyle = colors[(r * 5 + c + 2) % colors.length];
        g.fillRect(7 + c * 11, 11 + r * 24, 7, 15);
      }
    }
    g.fillStyle = "#c8221b";
    g.fillRect(0, 84, 64, 44);
    g.fillStyle = "#fff";
    g.font = "900 11px sans-serif";
    g.textAlign = "center";
    g.fillText("つめた〜い", 32, 98);
    g.fillStyle = "#222";
    g.fillRect(10, 108, 44, 12);
  });
  const vending = holder();
  vending.add(merged((b) => {
    b.box(0, 0.92, 0, 1.0, 1.84, 0.8, "#d8322b");
    b.box(0, 1.88, 0.06, 1.06, 0.08, 0.94, "#a5241e", 0, 0, 0, BOX6);
  }));
  const vf = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.6), new THREE.MeshLambertMaterial({ map: vendFront, emissive: "#ffffff", emissiveMap: vendFront, emissiveIntensity: 0.35 }));
  vf.position.set(0, 0.98, 0.412);
  vending.add(vf);
  tris += 2;

  // ---- 黄色い立て看板（A型。両面に文字）----
  const boardFace = canvasTexture(THREE, 64, 96, (g) => {
    g.fillStyle = "#f7c21b";
    g.fillRect(0, 0, 64, 96);
    g.strokeStyle = "#2b2b33";
    g.lineWidth = 3;
    g.strokeRect(4, 4, 56, 88);
    g.fillStyle = "#2b2b33";
    g.font = "900 15px sans-serif";
    g.textAlign = "center";
    g.fillText("本日", 32, 36);
    g.fillText("おすすめ", 32, 58);
    g.fillStyle = "#c8221b";
    g.fillText("★", 32, 80);
  });
  const board = holder();
  board.add(merged((b) => {
    // A型：2枚の板の上がくっつくように、内側へ傾ける
    for (const s of [-1, 1]) b.box(0, 0.55, s * 0.12, 0.84, 1.1, 0.05, "#e0a90f", 0, -0.2 * s, 0, BOX6);
  }));
  const bfMat = new THREE.MeshLambertMaterial({ map: boardFace, emissive: "#ffffff", emissiveMap: boardFace, emissiveIntensity: 0.25 });
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.92), bfMat);
    f.position.set(0, 0.56, s * 0.15);
    f.rotation.set(-0.2, s < 0 ? Math.PI : 0, 0, "YXZ");
    board.add(f);
    tris += 2;
  }

  // ---- 郵便ポスト（赤くて丸い）----
  const mailbox = holder();
  mailbox.add(merged((b) => {
    b.add(CYL, M(0, 0.6, 0, 0.5, 1.2, 0.5), "#d4231a");
    b.add(DOME, M(0, 1.2, 0, 0.54, 0.38, 0.54), "#b91d15");
    b.box(0, 1.0, 0.25, 0.28, 0.05, 0.04, "#2b2b33", 0, 0, 0, BOX6);
    b.box(0, 0.62, 0.252, 0.22, 0.16, 0.01, "#f4f2ee", 0, 0, 0, BOX6);
    b.add(CYL, M(0, 0.04, 0, 0.56, 0.08, 0.56), "#7a7a80");
  }));

  // ---- 黒ねこ（丸くなって座っている。しっぽだけ動く）----
  const cat = holder();
  cat.add(merged((b) => {
    const black = "#26232a";
    b.add(K.SPH, M(0, 0.17, 0, 0.36, 0.32, 0.5), black); // 体
    b.add(K.SPH, M(0, 0.33, 0.2, 0.26, 0.24, 0.24), black); // 頭
    for (const s of [-1, 1]) {
      b.add(new THREE.ConeGeometry(0.05, 0.1, 4), M(s * 0.07, 0.47, 0.2, 1, 1, 1, 0, 0, -s * 0.25), black); // 耳
      b.add(K.SPH, M(s * 0.055, 0.35, 0.31, 0.05, 0.045, 0.03), "#f2d14a"); // 目
      b.add(K.SPH, M(s * 0.09, 0.03, 0.17, 0.09, 0.06, 0.12), black); // 前足
    }
    b.box(0, 0.25, 0.27, 0.16, 0.025, 0.04, "#d8423a", 0, 0, 0, BOX6); // 赤い首輪
    b.add(K.SPH, M(0, 0.24, 0.305, 0.035, 0.03, 0.02), "#f2c41c"); // 鈴
  }));
  const tail = merged((b) => b.add(new THREE.CapsuleGeometry(0.03, 0.32, 2, 5), M(0, 0.16, 0, 1, 1, 1), "#26232a"));
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.08, -0.22);
  tailPivot.rotation.x = -1.2;
  tailPivot.add(tail);
  cat.add(tailPivot);

  const spawns = { vending, board, mailbox, cat };
  const heights = { vending: 2.3, board: 1.5, mailbox: 1.7, cat: 0.9, shop: 4.0, vsign: 5.9, ramen: 4.0, sento: 4.0, park: 0 };

  // ---- 近くに来たときだけ見える、小さなきらめき ----
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: "#fff3c4", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glint.visible = false;
  glint.renderOrder = 4;
  scene.add(glint);

  // ---- 発見の演出：足もとに広がる光の輪 ----
  const ring = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: glowTexture, color: "#ffd36b", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  ring.visible = false;
  ring.renderOrder = 4;
  scene.add(ring);

  let current = null;
  let anchor = null; // きらめきを出す位置
  let time = 0;
  let burstT = 1;

  return {
    tris,
    // ゲーム開始：目的物を置く（置く物でない目的は、何も置かない）
    show(m) {
      for (const k in spawns) spawns[k].visible = false;
      current = m;
      burstT = 1;
      ring.visible = false;
      if (m.spawn) {
        const g = spawns[m.spawn];
        g.position.set(m.x, 0, m.z);
        g.rotation.y = m.spawn === "vending" ? VEND_RY[m.rot] : m.spawn === "board" ? (Math.abs(m.z) < Math.abs(m.x) ? Math.PI / 2 : 0) : m.spawn === "cat" ? (m.x * 7 + m.z * 3) % (Math.PI * 2) : 0;
        g.visible = true;
      }
      anchor = m.area ? null : { x: m.x, y: heights[m.type] || 2, z: m.z };
      glint.visible = false;
    },
    // 毎フレーム：距離の計算1回と、少しの数字の更新だけ
    update(dt, px, pz, found) {
      time += dt;
      if (current && current.spawn === "cat") tailPivot.rotation.z = Math.sin(time * 2.2) * 0.5;
      if (anchor && !found) {
        const d = Math.hypot(px - anchor.x, pz - anchor.z);
        const on = d < NEAR;
        glint.visible = on;
        if (on) {
          const s = (0.55 + 0.2 * Math.sin(time * 5)) * Math.min(1, (NEAR - d) / 2);
          glint.position.set(anchor.x, anchor.y + Math.sin(time * 2) * 0.08, anchor.z);
          glint.scale.set(s, s, s);
        }
      }
      if (burstT < 1) {
        burstT = Math.min(1, burstT + dt / 0.9);
        const r = 0.8 + 5 * burstT;
        ring.scale.set(r, 1, r);
        ring.material.opacity = 0.9 * (1 - burstT);
        ring.visible = burstT < 1;
        glint.visible = burstT < 0.6;
        const g = 0.6 + 2.2 * Math.sin(Math.min(1, burstT * 2) * Math.PI * 0.5) * (1 - burstT);
        glint.scale.set(g, g, g);
      }
    },
    // 起動時にシェーダーを用意しておくため、一度だけ全部を見える状態にする
    setPreview(on) {
      for (const k in spawns) spawns[k].visible = on;
      glint.visible = on;
      ring.visible = on;
    },
    // 発見！：目的物（またはプレイヤー）のところで光の輪を広げる
    burst(px, pz) {
      const x = anchor ? anchor.x : px;
      const z = anchor ? anchor.z : pz;
      ring.position.set(x, 0.09, z);
      glint.position.set(x, (anchor ? anchor.y : 1.5), z);
      burstT = 0;
    },
  };
}
