// 東京、歩く。4.0：主人公（見た目・関節・アニメーション）
//
// ・街は軽いまま、主人公だけ少しだけ丁寧に作る（三角形 約3,000・描画10回）
// ・関節（肩・ひじ・股・ひざ）を Group で持ち、毎フレームは角度を数個変えるだけ
// ・外部の3Dモデルは使わない（Three.js の基本形を組み合わせ、頂点カラーで塗る）

import { createKit } from "./city.js";

// 色：ごく普通の、東京を歩いている人（性別ははっきりさせない）
const C = {
  skin: "#f6cfb0",
  skinShade: "#e9b896",
  hair: "#3b3038",
  hairLight: "#52444f",
  hoodie: "#4f9aa8",
  hoodieDark: "#3d7f8c",
  hoodieLight: "#6db0bc",
  pants: "#3a4157",
  pantsDark: "#2e3446",
  shoe: "#f3f1ec",
  shoeAccent: "#e8675f",
  sole: "#cfcac1",
  bag: "#d9a24a",
  bagDark: "#b8842f",
  strap: "#5a5550",
  eye: "#2a2630",
  white: "#ffffff",
  blush: "#f2a49a",
};

export function buildPlayer(THREE, scene, { shadowTexture } = {}) {
  const K = createKit(THREE);
  const { M, Batch, BOX6 } = K;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const SPH = (w, h) => new THREE.SphereGeometry(0.5, w, h);
  const CAP = (r, l, cap = 2, radial = 7) => new THREE.CapsuleGeometry(r, l, cap, radial);
  const CYLR = (r0, r1, h, seg = 8) => new THREE.CylinderGeometry(r1, r0, h, seg, 1, true);
  // 回転体（服のシルエット）：points は [半径, 高さ]
  const LATHE = (points, seg = 10) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);

  let tris = 0;
  let meshes = 0;
  // 部位ごとに1メッシュ（頂点カラーで色分け）。parent の子にして返す
  const mesh = (parent, build) => {
    const b = new Batch();
    build(b);
    tris += b.tris;
    const m = b.meshes(mat)[0];
    m.name = "player";
    parent.add(m);
    meshes++;
    return m;
  };
  const group = (parent, x, y, z) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  const root = new THREE.Group(); // 足もと（位置・向き）
  const hips = group(root, 0, 0.9, 0); // 腰：上下に揺れる
  const torso = group(hips, 0, 0, 0); // 胴：前に傾く・少しひねる

  // ---- 胴体：パーカーのシルエット（肩幅があり、腰で少ししぼる）＋フード・ポケット・ひも・首・リュック ----
  mesh(torso, (b) => {
    b.add(LATHE([[0.0, -0.02], [0.17, -0.02], [0.185, 0.04], [0.172, 0.2], [0.19, 0.36], [0.2, 0.45], [0.17, 0.53], [0.09, 0.59], [0.0, 0.6]]), M(0, 0, 0, 1.12, 1, 0.78, Math.PI / 10), C.hoodie);
    b.add(CYLR(0.192, 0.192, 0.07, 10), M(0, 0.0, 0, 1.12, 1, 0.78, Math.PI / 10), C.hoodieDark); // すその リブ
    b.add(new THREE.TorusGeometry(0.1, 0.045, 4, 10), M(0, 0.555, -0.035, 1.25, 1, 1.05, 0, Math.PI / 2 - 0.35), C.hoodieDark); // 首まわりのフード
    b.add(SPH(7, 5), M(0, 0.5, -0.14, 0.26, 0.2, 0.12, 0, 0.3), C.hoodieDark); // 背中に垂れたフード
    b.box(0, 0.13, 0.135, 0.24, 0.12, 0.03, C.hoodieDark, 0, 0, 0, BOX6); // ポケット
    b.add(CYLR(0.052, 0.048, 0.1, 8), M(0, 0.62, 0), C.skin); // 首
    // リュック（角の丸い形）と肩ベルト
    b.add(CAP(0.14, 0.16, 2, 8), M(0, 0.31, -0.215, 1.35, 1, 0.55), C.bag);
    b.box(0, 0.2, -0.29, 0.2, 0.12, 0.04, C.bagDark, 0, 0, 0, BOX6);
    for (const s of [-1, 1]) {
      b.box(s * 0.12, 0.5, -0.05, 0.04, 0.02, 0.26, C.strap, 0, 0, 0, BOX6); // 肩ベルト（肩の上だけ見える）
    }
  });

  // ---- 頭：少し縦長の顔・耳・目（ハイライトつき）・まゆ・ほっぺ・ボブの髪（前髪・横の髪・後ろ） ----
  const head = group(torso, 0, 0.66, 0);
  mesh(head, (b) => {
    b.add(SPH(11, 9), M(0, 0.165, 0.005, 0.4, 0.46, 0.42), C.skin);
    for (const s of [-1, 1]) {
      b.add(SPH(6, 5), M(s * 0.198, 0.16, 0.0, 0.05, 0.08, 0.05), C.skinShade); // 耳
      b.add(SPH(6, 5), M(s * 0.075, 0.165, 0.19, 0.05, 0.068, 0.03), C.eye); // 目
      b.add(SPH(4, 3), M(s * 0.068 + 0.012, 0.182, 0.203, 0.016, 0.018, 0.01), C.white); // 目のハイライト
      b.box(s * 0.078, 0.228, 0.19, 0.065, 0.013, 0.012, C.hair, 0, 0, -s * 0.12, BOX6); // まゆ
      b.add(SPH(6, 4), M(s * 0.115, 0.115, 0.175, 0.06, 0.03, 0.02), C.blush); // ほっぺ
    }
    b.box(0, 0.095, 0.205, 0.04, 0.008, 0.008, "#b9776a", 0, 0, 0, BOX6); // 口
    // 髪：頭頂（少し後ろ寄り）・後ろと横のボブ・前髪・横の髪
    b.add(new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.56), M(0, 0.185, -0.01, 0.44, 0.47, 0.46, 0, -0.18), C.hair);
    b.add(SPH(10, 7), M(0, 0.13, -0.045, 0.45, 0.36, 0.4), C.hair);
    b.add(SPH(8, 5), M(0, 0.275, 0.13, 0.36, 0.13, 0.15, 0, -0.55), C.hairLight); // 前髪
    for (const s of [-1, 1]) {
      b.add(SPH(6, 5), M(s * 0.175, 0.13, 0.07, 0.07, 0.22, 0.12, 0, 0.1, s * 0.08), C.hair); // 横の髪
    }
  });

  // ---- 腕：肩（袖のふくらみ）→上腕→ひじ→前腕→袖口→手 ----
  const arm = (side) => {
    const shoulder = group(torso, side * 0.235, 0.49, 0);
    mesh(shoulder, (b) => {
      b.add(SPH(6, 4), M(side * 0.01, -0.01, 0, 0.14, 0.15, 0.14), C.hoodie);
      b.add(CAP(0.062, 0.17, 3, 8), M(0, -0.13, 0), C.hoodie);
    });
    const elbow = group(shoulder, 0, -0.26, 0);
    mesh(elbow, (b) => {
      b.add(CAP(0.056, 0.15, 3, 8), M(0, -0.1, 0), C.hoodie);
      b.add(CYLR(0.06, 0.058, 0.05, 8), M(0, -0.205, 0), C.hoodieDark); // 袖口
      b.add(SPH(7, 5), M(0, -0.275, 0.005, 0.1, 0.13, 0.075), C.skin); // 手
    });
    return { shoulder, elbow };
  };

  // ---- 脚：股→もも→ひざ→すね→すそ→足首→スニーカー ----
  const leg = (side) => {
    const hip = group(hips, side * 0.095, 0, 0);
    mesh(hip, (b) => {
      b.add(CAP(0.086, 0.26, 3, 8), M(0, -0.2, 0), C.pants);
      if (side < 0) b.add(SPH(7, 5), M(0.095, 0.0, 0, 0.36, 0.14, 0.26), C.pants); // おしり・股のつなぎ
    });
    // すねとスニーカーは1つのメッシュ（描画回数を減らす）。足首は曲げない
    const knee = group(hip, 0, -0.42, 0);
    const F = -0.4; // 足首の高さ（ひざから）
    mesh(knee, (b) => {
      b.add(CAP(0.07, 0.25), M(0, -0.18, 0), C.pants);
      b.add(CYLR(0.075, 0.072, 0.06, 7), M(0, -0.34, 0), C.pantsDark); // すそ
      b.box(0, F - 0.06, 0.035, 0.11, 0.035, 0.27, C.sole, 0, 0, 0, BOX6); // ソール
      b.add(SPH(8, 5), M(0, F - 0.02, 0.025, 0.11, 0.09, 0.27), C.shoe); // 甲
      b.add(SPH(6, 4), M(0, F - 0.03, 0.12, 0.1, 0.06, 0.08), C.shoe); // つま先
      b.box(side * 0.054, F - 0.02, 0.0, 0.006, 0.03, 0.14, C.shoeAccent, 0, 0, 0, BOX6); // 横のライン
      b.box(0, F + 0.015, -0.085, 0.07, 0.05, 0.03, C.shoeAccent, 0, 0, 0, BOX6); // かかと
    });
    return { hip, knee };
  };

  const armL = arm(-1);
  const armR = arm(1);
  const legL = leg(-1);
  const legR = leg(1);
  scene.add(root);

  // 足もとの丸い影（太陽の影の地図にはプレイヤーを入れず、これで代わりにする → 影を毎フレーム描き直さなくてよい）
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTexture, color: "#000000", transparent: true, opacity: 0.38, depthWrite: false })
  );
  shadow.renderOrder = 3;
  shadow.name = "player-shadow";
  scene.add(shadow);

  // 着地の砂ぼこり（走りジャンプのときだけ、輪が広がって消える）
  const dust = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: shadowTexture, color: "#e9e1d4", transparent: true, opacity: 0, depthWrite: false })
  );
  dust.renderOrder = 3;
  dust.visible = false;
  dust.name = "player-dust";
  scene.add(dust);

  return {
    root, hips, torso, head, armL, armR, legL, legR, shadow, dust,
    phase: 0,
    land: 0, // 着地の沈み込み（1→0）
    landPower: 0,
    dustT: 1,
    time: 0,
    pose: null,
    tris,
    meshes,
  };
}

// ---------- アニメーション ----------
// 関節ごとに「目標の角度」を決めて、いまの角度をそこへなめらかに近づける。
// 歩く・走る・跳ぶ・着地のあいだが自然につながる。毎フレームの計算は数十回の足し算だけ。
const JOINTS = ["hipsY", "lean", "twist", "headX", "lHip", "lKnee", "rHip", "rKnee", "lSh", "lShZ", "lEl", "rSh", "rShZ", "rEl"];

export function animatePlayer(p, s, dt) {
  p.time += dt;
  if (!p.pose) {
    p.pose = {};
    for (const k of JOINTS) p.pose[k] = 0;
    p.pose.hipsY = 0.9;
  }
  const air = !s.onGround;
  const speed = s.speed || 0;
  const move = Math.min(1, speed / 3.4);
  const run = s.dash || 0;
  const T = {};

  // 着地の瞬間：沈み込みを始める
  if (s.landed > 0) {
    p.land = 1;
    p.landPower = s.landed;
    if (s.landed > 0.55) p.dustT = 0;
  }
  p.land = Math.max(0, p.land - dt / 0.28);
  const crouch = Math.sin(p.land * Math.PI) * p.landPower; // 0→最大→0

  // 歩幅に合わせて足を運ぶ（速いほど回転が速い。走りは歩幅も大きい）
  if (!air) p.phase += dt * speed * (2.15 - 0.25 * run);
  const ph = p.phase;
  const sinP = Math.sin(ph);
  const cosP = Math.cos(ph);
  const walkAmt = Math.min(1, speed / 1.2);

  if (!air) {
    const legA = (0.5 + 0.38 * run) * walkAmt;
    const armA = (0.45 + 0.55 * run) * walkAmt;
    // 前へ振り出す脚のひざを曲げる（後ろの脚は伸びる）
    T.lHip = sinP * legA;
    T.rHip = -sinP * legA;
    T.lKnee = Math.max(0, cosP) * (0.35 + 0.85 * run) * walkAmt + 0.06 * move;
    T.rKnee = Math.max(0, -cosP) * (0.35 + 0.85 * run) * walkAmt + 0.06 * move;
    // 腕は脚と逆に振る。走るとひじを曲げる
    T.lSh = -sinP * armA;
    T.rSh = sinP * armA;
    T.lEl = -(0.25 + 1.05 * run) * Math.max(0.3, walkAmt) - 0.1;
    T.rEl = T.lEl;
    T.lShZ = -0.07 - 0.04 * run;
    T.rShZ = 0.07 + 0.04 * run;
    // 体：歩くと少し上下、走ると前に傾いて上下が大きい。止まっているときはゆっくり呼吸
    const bob = Math.abs(sinP) * (0.025 + 0.04 * run) * walkAmt;
    const breathe = (1 - walkAmt) * Math.sin(p.time * 2.2) * 0.006;
    T.hipsY = 0.9 - 0.025 * run * walkAmt + bob + breathe;
    T.lean = 0.05 * move + 0.2 * run * walkAmt;
    T.twist = sinP * (0.07 + 0.05 * run) * walkAmt;
  } else {
    // 空中：上がるとき（片ひざを上げる）→ 下りるとき（脚を伸ばして着地にそなえる）
    const up = Math.max(0, Math.min(1, s.vy / 6.6));
    const lead = s.dashJump ? 1 : 0;
    T.lHip = -0.75 * up - 0.25 - 0.45 * lead;
    T.lKnee = 1.1 * up + 0.35 + 0.2 * lead;
    T.rHip = 0.25 * up + 0.05 + 0.4 * lead;
    T.rKnee = 0.35 + 0.3 * up + 0.35 * lead;
    T.lSh = -1.0 - 0.9 * up + 0.5 * lead;
    T.rSh = -0.4 - 0.6 * up - 0.6 * lead;
    T.lShZ = -0.35;
    T.rShZ = 0.35;
    T.lEl = -0.5;
    T.rEl = -0.5;
    T.hipsY = 0.9;
    T.lean = 0.12 * move + 0.12 * lead;
    T.twist = 0;
  }

  // 着地の沈み込み：腰を落とし、ひざを曲げ、少し前かがみ
  if (crouch > 0.001) {
    T.hipsY -= 0.13 * crouch;
    T.lHip -= 0.45 * crouch;
    T.rHip -= 0.45 * crouch;
    T.lKnee += 0.9 * crouch;
    T.rKnee += 0.9 * crouch;
    T.lean += 0.25 * crouch;
    T.lSh -= 0.3 * crouch;
    T.rSh -= 0.3 * crouch;
  }
  T.headX = -T.lean * 0.6; // 体が傾いても前を見る

  // 目標へなめらかに（空中や着地はやや速く、歩きの振りは速く追う）
  const k = Math.min(1, dt * (air ? 14 : 22));
  const P = p.pose;
  for (const key of JOINTS) P[key] += (T[key] - P[key]) * k;

  // 反映
  p.root.position.set(s.x, s.y, s.z);
  p.root.rotation.y = s.facing;
  p.hips.position.y = P.hipsY;
  p.torso.rotation.set(P.lean, P.twist, 0);
  p.head.rotation.x = P.headX;
  p.legL.hip.rotation.x = P.lHip;
  p.legL.knee.rotation.x = P.lKnee;
  p.legR.hip.rotation.x = P.rHip;
  p.legR.knee.rotation.x = P.rKnee;
  p.armL.shoulder.rotation.set(P.lSh, 0, P.lShZ);
  p.armR.shoulder.rotation.set(P.rSh, 0, P.rShZ);
  p.armL.elbow.rotation.x = P.lEl;
  p.armR.elbow.rotation.x = P.rEl;

  // 足もとの丸い影：跳ぶと小さく薄く
  const sk = 1 / (1 + s.y * 0.6);
  p.shadow.position.set(s.x, 0.08, s.z);
  p.shadow.scale.set(1.1 * sk, 1, 1.1 * sk);
  p.shadow.material.opacity = 0.38 * sk;

  // 砂ぼこりの輪
  if (p.dustT < 1) {
    p.dustT = Math.min(1, p.dustT + dt / 0.45);
    const r = 0.6 + 1.3 * p.dustT;
    p.dust.visible = p.dustT < 1;
    p.dust.position.set(s.x, 0.085, s.z);
    p.dust.scale.set(r, 1, r);
    p.dust.material.opacity = 0.45 * (1 - p.dustT);
  }
}
