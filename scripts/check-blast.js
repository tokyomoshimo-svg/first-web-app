// ぽよぽよブラスト V2：ルールとステージのチェック
// 使い方: node scripts/check-blast.js          （ルールのテスト＋2種類のボットで全ステージを遊ぶ）
//         node scripts/check-blast.js --stars  （星の点数の目安も表示）
//         node scripts/check-blast.js --quick  （ボットの回数を減らす）
//
// ボットは2種類
//   ・タップだけ：動かさない。大きいグループ・目標・ブースターを優先してタップするだけ
//   ・作戦あり　：ドラッグの候補をしぼってから、そのターンの結果（連鎖まで）を先読みして選ぶ
//                 （先読みの補充は別の乱数なので、未来の補充は見えない）

const PB = require("../games/blast/engine.js");
const LEVELS = require("../games/blast/levels.js");

let failed = 0;
const check = (ok, msg) => {
  if (!ok) {
    failed++;
    if (failed < 40) console.error("NG: " + msg);
  }
};
const QUICK = process.argv.includes("--quick");
const RUNS_CASUAL = QUICK ? 40 : 120;
const RUNS_SMART = QUICK ? 15 : 40;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 盤面がこわれていないか：同じぽよが2か所にない／補充される区間に空きがない
function invariant(g, label) {
  const ids = new Set();
  for (let c = 0; c < g.cols; c++) {
    let open = true;
    for (let r = 0; r < g.rows; r++) {
      const p = g.grid[r][c];
      if (p === undefined) continue;
      if (p && PB.isStatic(p)) open = false;
      if (p === null && open) {
        check(false, `${label}: (${r},${c}) が空いたまま`);
        return false;
      }
      if (p) {
        check(!ids.has(p.id), `${label}: id ${p.id} が2か所にある`);
        ids.add(p.id);
        if (p.t === "c") check(p.color >= 0 && p.color < g.level.colors, `${label}: 色がおかしい ${p.color}`);
      }
    }
  }
  return true;
}

// タップのあと：落下と連鎖をくり返して、ターンを終える
let spawnViolations = 0;
let spawnChecks = 0;
function settle(g, label, strict) {
  for (let k = 0; k < 80; k++) {
    const col = g.collapse();
    if (strict) {
      check(col.moves.every((m) => m.tr >= m.fr), `${label}: 上へ動くぽよがある`);
      invariant(g, label);
      // 補充されたぽよは、4つ以上のかたまりを作らない（連鎖は盤面にあったぽよだけで起きる）
      for (const s of col.spawns) {
        if (s.piece.t !== "c" || g.grid[s.tr][s.tc] !== s.piece) continue;
        spawnChecks++;
        if (g.groupAt(s.tr, s.tc).length >= PB.CHAIN_MIN) spawnViolations++;
      }
    }
    const c = g.cascade();
    if (!c) break;
  }
  return g.endTurn();
}

// ---------- ボット ----------
const need = (g, type, key) => g.goals.some((x) => x.left > 0 && x.type === type && (type !== "color" || x.color === key) && (type !== "use" || x.booster === key || x.booster === "any"));

// タップだけのボット
function casualChoose(g, rnd) {
  const opts = g.options();
  let best = null;
  let bestV = -1e9;
  for (const o of opts) {
    let v;
    if (o.kind === "booster") {
      v = o.size >= 2 ? 40 : 14;
      if (need(g, "use", o.t)) v += 30;
      if (need(g, "fusion") && o.size >= 2) v += 40;
    } else {
      v = o.size;
      if (need(g, "color", o.color)) v += o.size * 1.5;
      if (o.size >= 4) v += 4 + o.size;
      const near = new Set();
      for (const [y, x] of o.cells) for (const [dy, dx] of DIRS) {
        const q = g.at(y + dy, x + dx);
        if (q && (q.t === "box" || q.t === "balloon")) near.add(q.id);
      }
      v += near.size * 4;
      if (need(g, "gift")) for (const [y, x] of o.cells) for (let k = 1; k <= 3; k++) {
        const q = g.at(y - k, x);
        if (q && q.t === "gift") v += 3;
      }
    }
    v += rnd() * 2;
    if (v > bestV) {
      bestV = v;
      best = o;
    }
  }
  return best;
}

// 目標の進み具合（先読みの評価用）
function goalValue(g) {
  let v = 0;
  for (const x of g.goals) {
    const done = x.count - Math.max(0, x.left);
    const w = x.type === "combo" ? 140 + x.min * 30 : x.type === "use" || x.type === "fusion" ? 90 : x.type === "gift" ? 80 : x.type === "stone" ? 45 : 25;
    v += done * w;
  }
  return v;
}
const BOOSTER_VALUE = { mini: 10, rocket: 22, bomb: 30, disco: 45 };
function boardValue(g) {
  let v = 0;
  g.each((p) => {
    if (PB.isBooster(p)) v += BOOSTER_VALUE[p.t] * (p.pow > 1 ? 1.4 : 1);
  });
  return v;
}

// ドラッグの道（1〜2マス：まっすぐ・L字）
const PATHS = [];
for (const d of DIRS) {
  PATHS.push([d]);
  for (const e of DIRS) if (!(e[0] === -d[0] && e[1] === -d[1])) PATHS.push([d, e]);
}

function smartTurn(g, rnd) {
  // 1) ドラッグの候補：その場で動かして、安い評価（できるかたまりの大きさ・ブースターのとなり）
  const cands = [];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    if (!PB.isMovable(g.at(r, c))) continue;
    for (const path of PATHS) {
      if (path.length > PB.DRAG_STEPS) continue;
      const done = [];
      let y = r, x = c, ok = true;
      for (const [dy, dx] of path) {
        if (!PB.isMovable(g.at(y + dy, x + dx))) {
          ok = false;
          break;
        }
        g.swap(y, x, y + dy, x + dx);
        done.push([y, x, y + dy, x + dx]);
        y += dy;
        x += dx;
      }
      if (ok) {
        const p = g.at(y, x);
        let s = 0;
        if (p.t === "c") s = g.groupAt(y, x).length;
        else if (PB.isBooster(p)) s = g.boosterClusterAt(y, x).length >= 2 ? 6 : 0;
        for (const [a, b] of done) {
          const q = g.at(a, b);
          if (q && q.t === "c") s = Math.max(s, g.groupAt(a, b).length - 0.5);
        }
        cands.push({ r, c, path, s: s + rnd() });
      }
      for (let i = done.length - 1; i >= 0; i--) g.swap(...done[i]);
    }
  }
  cands.sort((a, b) => b.s - a.s);
  const pool = [null, ...cands.slice(0, 9)];
  // ランダムにいくつか（連鎖の仕込みは「かたまりが大きくならない」動きのこともある）
  for (let i = 0; i < 4 && cands.length > 12; i++) pool.push(cands[12 + Math.floor(rnd() * (cands.length - 12))]);

  // 2) それぞれ、タップの候補を先読み
  const base = goalValue(g);
  let best = null;
  for (const cd of pool) {
    const h0 = g.clone(1);
    if (cd) {
      h0.pick(cd.r, cd.c);
      let y = cd.r, x = cd.c;
      for (const [dy, dx] of cd.path) {
        h0.step(y + dy, x + dx);
        y += dy;
        x += dx;
      }
      h0.release();
    }
    const opts = h0.options().sort((a, b) => (b.kind === "booster" ? 10 + b.size : b.size) - (a.kind === "booster" ? 10 + a.size : a.size)).slice(0, 5);
    for (const o of opts) {
      const h = h0.clone(Math.floor(rnd() * 1e9));
      if (!h.tap(o.r, o.c)) continue;
      const e = settle(h, "", false);
      const v = (h.score - g.score) * 0.02 + (goalValue(h) - base) + boardValue(h) + e.combo * 6 + rnd() * 2;
      if (!best || v > best.v) best = { v, cd, o };
    }
  }
  if (!best) return null;
  if (best.cd) {
    const cd = best.cd;
    check(g.pick(cd.r, cd.c), "ボット：選べない駒を選んだ");
    let y = cd.r, x = cd.c;
    for (const [dy, dx] of cd.path) {
      check(g.step(y + dy, x + dx), "ボット：動かせない向きに動かした");
      y += dy;
      x += dx;
    }
    g.release();
  }
  return g.tap(best.o.r, best.o.c);
}

function play(level, seed, mode) {
  const g = new PB.Game(level, seed);
  const rnd = PB.makeRng(seed * 7 + 3);
  const label = `L${level.id} ${mode} seed${seed}`;
  invariant(g, label + " start");
  let taps = 0, shuffles = 0;
  const combos = [];
  let near = 0;
  while (g.moves > 0 && !g.goalsDone()) {
    if (!g.hasMoves() || !g.options().length) {
      g.shuffle();
      shuffles++;
      if (shuffles > 60) break;
      continue;
    }
    let res;
    if (mode === "smart") {
      res = smartTurn(g, rnd);
    } else {
      const o = casualChoose(g, rnd);
      res = g.tap(o.r, o.c);
    }
    check(res, `${label}: 選んだ場所をタップできない`);
    if (!res) break;
    taps++;
    for (const e of res.events) {
      if (e.type === "pop" && !e.merge) {
        const p = g.grid[e.r][e.c];
        check(p === null || (p && p.id !== e.id), `${label}: 消えたはずのマスに同じぽよが残る`);
      }
    }
    const end = settle(g, `${label} tap${taps}`, true);
    combos.push(end.combo);
    if (end.near) near++;
  }
  const won = g.goalsDone();
  if (won) {
    // クリア後のごほうび（画面と同じ：先に全部ブースターに変えてから、ひとつずつ発動。連鎖もする）
    let guard = 0;
    while (g.moves > 0 && guard++ < 100) if (!g.finaleConvert()) break;
    for (let k = 0; k < 200; k++) {
      const b = g.boosterCells();
      if (!b.length) break;
      g.tap(b[0][0], b[0][1], { free: true });
      settle(g, label + " finale", true);
    }
    invariant(g, label + " finale");
  }
  return { won, score: g.score, used: g.movesUsed, taps, shuffles, combos, near, boosters: Object.values(g.used).reduce((a, b) => a + b, 0), stars: g.stars() };
}

// ---------- ルールのテスト（小さな盤面） ----------
{
  const flat = { id: 0, cols: 7, rows: 7, colors: 5, moves: 10, goals: [{ type: "color", color: 0, count: 999 }], stars: [1, 2] };
  const mk = (layout, extra = {}) => new PB.Game({ ...flat, ...extra, layout, rows: layout.length, cols: layout[0].length }, 5);
  const pops = (res) => res.events.filter((e) => e.type === "pop").length;
  const CHECKER = ["0101010", "1010101", "0101010", "1010101", "0101010", "1010101", "0101010"];
  const withCell = (r, c, ch) => CHECKER.map((row, i) => (i === r ? row.slice(0, c) + ch + row.slice(c + 1) : row));

  // タップ：2つで消える・1 COMBO・手数 −1。1つだけは消せない（手数は減らない）
  {
    const g = mk(["0010101", "1101010", "0101010", "1010101", "0101010", "1010101", "0101010"]);
    check(g.tap(0, 2) === null && g.moves === 10, "1個だけなのに消せる／手数が減る");
    const res = g.tap(0, 0);
    check(res && res.combo === 1 && g.moves === 9, "2個のタップが 1 COMBO にならない");
  }
  // 連鎖：下のペアを消すと、上の赤が落ちて赤4つ → 自動で消える（2 COMBO）。ぷちボムができる
  {
    const g = mk(["13404", "31421", "00021"]);
    const res = g.tap(1, 3);
    check(res && res.size === 2, "連鎖テスト：ペアが消えない");
    g.collapse();
    const c = g.cascade();
    check(c && c.combo === 2 && c.size === 4, `落ちてそろった4つが自動で消えない ${c && c.combo}`);
    check(c && c.made.length === 1 && c.made[0].t === "mini" && c.made[0].r === 2 && c.made[0].c === 3, "連鎖でぷちボムが、落ちてきた所にできない");
    g.collapse();
    const c2 = g.cascade();
    const end = g.endTurn();
    check(c2 === null && end.combo === 2, `連鎖のあとターンが 2 COMBO で終わらない ${end.combo}`);
  }
  // 動いていない4つのかたまりは、自動では消えない（タップを待つ）
  {
    const g = mk(["0000112", "2341234", "3412341"]);
    g.tap(2, 0); // 3,4 のペアではない所…（3 は1個なので消せない）
    const res = g.tap(0, 4);
    check(res && res.size === 2, "テストの準備：ペアが消えない");
    g.collapse();
    check(g.cascade() === null, "動いていない4つのかたまりが自動で消えた");
    check(g.groupAt(0, 0).length === 4, "動いていない4つのかたまりが残っていない");
  }
  // ブースターの大きさ：4 → ぷちボム、5 → ロケット、6 → ボム、7 → レインボー
  {
    const rows = (first) => [first, "1212121", "2121212", "1212121"];
    check(mk(rows("0000343")).tap(0, 0).created === "mini", "4個でぷちボムができない");
    check(mk(rows("0000034")).tap(0, 0).created === "rocket", "5個でロケットができない");
    check(mk(rows("0000003")).tap(0, 0).created === "bomb", "6個でボムができない");
    check(mk(rows("0000000")).tap(0, 0).created === "disco", "7個でレインボーができない");
    check(mk(rows("0003434")).tap(0, 0).created === null, "3個でブースターができた");
  }
  // ブースターの範囲：ぷちボム 9 / ボム 21 / チャージつきボム 37 / ロケット 1行 / チャージつきロケット 3行
  {
    const cnt = (radius) => {
      let n = 0;
      for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (Math.hypot(y, x) <= radius) n++;
      return n;
    };
    check(pops(mk(withCell(3, 3, "M")).tap(3, 3)) === 9, "ぷちボムの範囲が 9 マスでない");
    check(pops(mk(withCell(3, 3, "O")).tap(3, 3)) === 21, "ボムの範囲が 21 マスでない");
    const gb = mk(withCell(3, 3, "O"));
    gb.grid[3][3].pow = 2;
    check(pops(gb.tap(3, 3)) === cnt(3.5), `チャージつきボムの範囲が違う ${cnt(3.5)}`);
    check(pops(mk(withCell(3, 3, "R")).tap(3, 3)) === 7, "ロケット（横）が1行を消さない");
    const gr = mk(withCell(3, 3, "V"));
    gr.grid[3][3].pow = 2;
    check(pops(gr.tap(3, 3)) === 21, "チャージつきロケットが3列を消さない");
  }
  // ブースターの連鎖：ロケットの通り道のボムも発動 → COMBO +1
  {
    const g = mk(withCell(3, 0, "R").map((row, i) => (i === 3 ? row.slice(0, 6) + "O" : row)));
    const res = g.tap(3, 0);
    check(res && res.chain >= 1 && res.combo === 2, `ブースターの連鎖で COMBO が増えない ${res && res.combo}`);
  }
  // 合体：となり合ったブースターをタップ。ロケット＋ロケット＝十字（COMBO 2 から）
  {
    const g = mk(withCell(3, 3, "R").map((row, i) => (i === 3 ? row.slice(0, 4) + "V" + row.slice(5) : row)));
    const res = g.tap(3, 3);
    check(res && res.kind === "fusion" && res.fusion === "rocket+rocket" && res.combo >= 2, "ロケット同士が合体しない／COMBO が増えない");
    const popped = new Set(res.events.filter((e) => e.type === "pop").map((e) => e.r * 10 + e.c));
    check([...Array(7).keys()].every((k) => popped.has(3 * 10 + k) && popped.has(k * 10 + 3)), "十字に消えない");
    const g2 = mk(withCell(3, 3, "D").map((row, i) => (i === 3 ? row.slice(0, 4) + "D" + row.slice(5) : row)));
    check(pops(g2.tap(3, 3)) === 49, "レインボー同士で全部消えない");
    const g3 = mk(withCell(3, 3, "D").map((row, i) => (i === 3 ? row.slice(0, 4) + "O" + row.slice(5) : row)));
    g3.grid[3][3].color = 0;
    const r3 = g3.tap(3, 3);
    check(r3.fusion === "disco+bomb" && r3.events.some((e) => e.type === "transform" && e.piece.t === "bomb"), "レインボー＋ボムでボムに変わらない");
  }
  // 連鎖の 3 COMBO 目から：少ない数でも強いブースター＋チャージ
  {
    const g = mk(["0000343", "1212121", "2121212", "1212121"]);
    g.combo = 2;
    const res = g.resolveGroups([{ cells: g.groupAt(0, 0), pivot: [0, 0] }], false);
    check(res.combo === 3 && res.made[0].t === "rocket" && res.made[0].pow === 2, `3 COMBO 目の4個がチャージつきロケットにならない ${JSON.stringify(res.made)}`);
  }
  // COMBO の倍率
  check(PB.comboMult(1) === 1 && PB.comboMult(3) === 2 && PB.comboMult(20) === 5, "COMBO の倍率がおかしい");
  // ドラッグ：2マスまで・来た道を戻れる・ほかの駒は選べない・障害物とは入れかわらない・タップで終わり
  {
    const g = mk(["0123401", "1234012", "23B0123", "3401234"]);
    check(g.pick(0, 0) && g.step(0, 1) && g.step(0, 2), "2マス動かせない");
    check(g.step(0, 3) === null, "3マス目まで動かせてしまう");
    check(g.step(0, 1) && g.dragStepsUsed() === 1, "来た道を戻れない");
    check(!g.pick(3, 3), "1ターンに2つの駒を動かせてしまう");
    check(g.step(0, 0) && g.dragStepsUsed() === 0, "元の場所まで戻れない");
    g.release();
    check(g.drag === null && g.pick(1, 2), "元に戻したあと、別の駒を選べない");
    check(g.step(2, 2) === null, "木箱と入れかわってしまう");
    g.release();
    check(g.drag === null, "動かさずに離したのに選んだまま");
    const g2 = mk(["0010101", "1101010", "0101010"]);
    g2.pick(0, 2);
    g2.step(1, 2);
    g2.release();
    check(g2.at(0, 2).color === 0 && g2.at(1, 2).color === 1, "ドラッグで入れかわらない");
    check(g2.tap(0, 0) && g2.drag === null, "タップでドラッグが終わらない");
  }
  // 目標：COMBO 目標（あと1つの「惜しい」も）・ブースター使用・合体
  {
    const g = mk(["13404", "31421", "00021"], { goals: [{ type: "combo", min: 2, count: 1 }, { type: "combo", min: 3, count: 1 }] });
    g.tap(1, 3);
    settle(g, "combo goal", true);
    check(g.goals[0].left === 0 && g.goals[1].left === 1, "2 COMBO の目標が進まない");
    const g2 = mk(["13404", "31421", "00021"], { goals: [{ type: "combo", min: 3, count: 1 }] });
    g2.tap(1, 3);
    let end = null;
    for (let k = 0; k < 20; k++) {
      g2.collapse();
      if (!g2.cascade()) {
        end = g2.endTurn();
        break;
      }
    }
    check(end && end.combo === 2 && end.near === 3, "あと1 COMBO の「惜しい」が出ない");
    const g3 = mk(withCell(3, 3, "R"), { goals: [{ type: "use", booster: "rocket", count: 1 }] });
    g3.tap(3, 3);
    check(g3.goals[0].left === 0, "ロケットを使った目標が進まない");
    const g4 = mk(withCell(3, 3, "R").map((row, i) => (i === 3 ? row.slice(0, 4) + "M" + row.slice(5) : row)), { goals: [{ type: "fusion", count: 1 }] });
    g4.tap(3, 3);
    check(g4.goals[0].left === 0, "合体の目標が進まない");
  }
  // 木箱：となりで消すと1減る。石はとなりでは壊れない。プレゼントは下まで落ちると回収
  {
    const g = mk(["0034343", "B212121", "S121212", "2121212"]);
    const res = g.tap(0, 0);
    check(res.events.some((e) => e.type === "pop" && e.piece.t === "box"), "となりで消しても木箱が壊れない");
    check(!res.events.some((e) => e.piece && e.piece.t === "stone"), "石がとなりで壊れた");
    const g2 = mk(["1212121", "2121212", "G121212", "0012121"]);
    g2.tap(3, 0);
    check(g2.collapse().collected.length === 1, "プレゼントが回収されない");
  }
  // 最初の盤面には4つ以上のかたまりがない
  {
    let big = 0;
    for (let s = 1; s <= 200; s++) {
      const L = LEVELS[s % LEVELS.length];
      const g = new PB.Game(L, s);
      g.each((p, r, c) => {
        if (p && p.t === "c" && !p.fixed && g.groupAt(r, c).length >= PB.CHAIN_MIN) big++;
      });
    }
    check(big === 0, `最初の盤面に4つ以上のかたまりがある（${big}）`);
  }
}

// ---------- 全ステージをボットで ----------
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const report = [];
const starHint = [];
for (const L of LEVELS) {
  if (L.layout) check(L.layout.length === L.rows && L.layout.every((l) => l.length === L.cols), `L${L.id}: layout の大きさが違う`);
  // 障害物の目標は、盤面にある数（降ってくるものを除く）を超えない
  {
    const g0 = new PB.Game(L, 1);
    const have = { box: 0, stone: 0, balloon: 0, gift: 0 };
    g0.each((p) => {
      if (p && p.t in have) have[p.t]++;
    });
    for (const x of L.goals) {
      if (!(x.type in have)) continue;
      const extra = (x.type === "balloon" && L.spawnBalloons) || (x.type === "gift" && L.spawnGifts);
      check(extra || x.count <= have[x.type], `L${L.id}: ${x.type} の目標 ${x.count} が盤面の数 ${have[x.type]} より多い`);
    }
  }
  const casual = [];
  const smart = [];
  for (let s = 1; s <= RUNS_CASUAL; s++) casual.push(play(L, s * 101 + L.id, "casual"));
  for (let s = 1; s <= RUNS_SMART; s++) smart.push(play(L, s * 977 + L.id, "smart"));
  const rate = (a) => a.filter((x) => x.won).length / a.length;
  const allCombos = (a) => a.flatMap((x) => x.combos);
  const ge = (a, k) => Math.round((allCombos(a).filter((x) => x >= k).length / Math.max(1, allCombos(a).length)) * 100) + "%";
  const wins = [...casual, ...smart].filter((x) => x.won);
  const scores = wins.map((x) => x.score).sort((a, b) => a - b);
  const sw = smart.filter((x) => x.won);
  const stars = [1, 2, 3].map((k) => sw.filter((x) => x.stars === k).length);
  report.push({
    L: L.id,
    "clear(タップだけ)": Math.round(rate(casual) * 100) + "%",
    "clear(作戦)": Math.round(rate(smart) * 100) + "%",
    "手数(作戦)": sw.length ? (sw.reduce((n, x) => n + x.used, 0) / sw.length).toFixed(1) + "/" + L.moves : "-",
    "≥2C": ge(casual, 2) + "→" + ge(smart, 2),
    "≥3C": ge(casual, 3) + "→" + ge(smart, 3),
    "≥5C": ge(casual, 5) + "→" + ge(smart, 5),
    maxC: Math.max(...allCombos(smart)),
    "惜しい/回": ((smart.reduce((n, x) => n + x.near, 0) + casual.reduce((n, x) => n + x.near, 0)) / (smart.length + casual.length)).toFixed(1),
    shuffles: [...casual, ...smart].reduce((n, x) => n + x.shuffles, 0),
    "星(作戦)": stars.join("/"),
  });
  starHint.push([L.id, Math.round(pct(scores, 0.4) / 100) * 100, Math.round(pct(sw.map((x) => x.score).sort((a, b) => a - b), 0.7) / 100) * 100]);
  // 難しさ：作戦ありのボットなら、ほぼクリアできる（人はボットほど先読みしないので、少し余裕を持たせる）
  const minSmart = L.id <= 3 ? 0.97 : L.id <= 8 ? 0.85 : 0.7;
  check(rate(smart) >= minSmart, `L${L.id}: 作戦ありのボットのクリア率が低すぎる ${Math.round(rate(smart) * 100)}%（目安 ${minSmart * 100}%以上）`);
  // タップだけでは届きにくい（COMBO の目標があるステージでは、作戦ありのほうがはっきり強い）
  if (L.goals.some((x) => x.type === "combo" && x.min >= 3)) check(rate(smart) - rate(casual) >= 0.2, `L${L.id}: タップだけでも COMBO の目標が簡単すぎる（${Math.round(rate(casual) * 100)}% / ${Math.round(rate(smart) * 100)}%）`);
  if (L.id <= 2) check(rate(casual) >= 0.6, `L${L.id}: 最初のステージなのに、タップだけだと難しすぎる ${Math.round(rate(casual) * 100)}%`);
  // 星：作戦ありのボットでも3つ星はいつもではない・2つ星はふつうに取れる
  if (sw.length) {
    check(stars[2] / sw.length <= 0.6, `L${L.id}: 3つ星が簡単すぎる (${stars.join("/")})`);
    check((stars[1] + stars[2]) / sw.length >= 0.4, `L${L.id}: 2つ星が難しすぎる (${stars.join("/")})`);
  }
}
console.table(report);
check(spawnViolations === 0, `補充されたぽよが4つ以上のかたまりを作った（${spawnViolations}/${spawnChecks}）`);
if (process.argv.includes("--stars")) console.log("星の目安 [id, 2つ星, 3つ星]:", JSON.stringify(starHint));

if (failed) {
  console.error(`\n${failed} 件の NG`);
  process.exit(1);
}
console.log(`OK: ルールのテスト（タップ・連鎖・COMBO・ドラッグ・ブースター4種・チャージ・合体・目標・補充）と、${LEVELS.length}ステージ × ボット（タップだけ ${RUNS_CASUAL}回・作戦あり ${RUNS_SMART}回）で盤面がこわれない・クリアできる`);
