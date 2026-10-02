// ぽよぽよブラスト：ルールとステージのチェック
// 使い方: node scripts/check-blast.js        （ボットで各ステージを200回ずつ遊ぶ）
//         node scripts/check-blast.js --stars （星の点数の目安を表示）

const PB = require("../games/blast/engine.js");
const LEVELS = require("../games/blast/levels.js");

let failed = 0;
const check = (ok, msg) => {
  if (!ok) {
    failed++;
    if (failed < 30) console.error("NG: " + msg);
  }
};

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
      }
    }
  }
  return true;
}

// ほどほどにうまいボット：ブースターの合体 > 目標に役立つ大きいグループ > ブースター
function choose(g, rnd) {
  const opts = g.options();
  if (!opts.length) return null;
  const need = (type, color) => g.goals.some((x) => x.left > 0 && x.type === type && (type !== "color" || x.color === color));
  const obstacleGoal = g.goals.some((x) => x.left > 0 && x.type !== "color");
  let best = null;
  let bestV = -1;
  for (const o of opts) {
    let v;
    if (o.kind === "booster") {
      // 効き目の範囲にある、目標の障害物（木箱・石・ふうせん）の数で決める
      const p = g.at(o.r, o.c);
      let hits = 0;
      g.each((q, y, x) => {
        if (!q || !["box", "stone", "balloon"].includes(q.t) || !need(q.t)) return;
        const inRange = p.t === "disco" || (p.t === "bomb" ? Math.hypot(y - o.r, x - o.c) <= 2 : p.dir === "h" ? y === o.r : x === o.c);
        if (inRange) hits++;
      });
      v = o.size >= 2 ? 30 + o.size * 5 : 6 + hits * 5;
    } else {
      v = o.size;
      if (need("color", o.color)) v += o.size * 1.5;
      if (o.size >= 9) v += 14;
      else if (o.size >= 7) v += 10;
      else if (o.size >= 5) v += 6;
      // となりの木箱・ふうせん
      const near = new Set();
      for (const [y, x] of o.cells) for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = g.at(y + dy, x + dx);
        if (q && (q.t === "box" || q.t === "balloon")) near.add(q.id);
      }
      v += near.size * (obstacleGoal ? 4 : 1);
      // プレゼントの下を消すと、プレゼントが下りる
      if (need("gift")) for (const [y, x] of o.cells) for (let k = 1; k <= 3; k++) { const q = g.at(y - k, x); if (q && q.t === "gift") v += 3; }
    }
    v += rnd() * 0.5;
    if (v > bestV) {
      bestV = v;
      best = o;
    }
  }
  return best;
}

function play(level, seed) {
  const g = new PB.Game(level, seed);
  const rnd = PB.makeRng(seed * 7 + 3);
  invariant(g, `L${level.id} start`);
  let taps = 0, boosters = 0, combos = 0, chains = 0, shuffles = 0, maxPop = 0;
  while (g.moves > 0 && !g.goalsDone()) {
    if (!g.hasMoves()) {
      g.shuffle();
      shuffles++;
      continue;
    }
    const o = choose(g, rnd);
    const res = g.tap(o.r, o.c);
    check(res, `L${level.id} seed${seed}: 選んだ場所をタップできない`);
    if (!res) break;
    taps++;
    if (res.created) boosters++;
    if (res.kind === "combo") combos++;
    chains += res.chain;
    maxPop = Math.max(maxPop, res.popped);
    // 出来事の中身：消えたマスは空いている（ブースターができたマス以外）
    for (const e of res.events) {
      if (e.type === "pop" && !e.merge) {
        const p = g.grid[e.r][e.c];
        check(p === null || (p && p.id !== e.id), `L${level.id}: 消えたはずのマスに同じぽよが残る`);
      }
    }
    const col = g.collapse();
    check(col.moves.every((m) => m.tr >= m.fr), `L${level.id}: 上へ動くぽよがある`);
    invariant(g, `L${level.id} seed${seed} tap${taps}`);
  }
  const won = g.goalsDone();
  // クリア後のごほうび：残り手数をブースターに変えて発動
  if (won) {
    let guard = 0;
    // 画面（app.js）と同じ順番：先に全部ブースターに変えてから、ひとつずつ発動
    while (g.moves > 0 && guard++ < 100) {
      if (!g.finaleConvert()) break;
    }
    for (let k = 0; k < 200; k++) {
      const b = g.boosterCells();
      if (!b.length) break;
      g.tap(b[0][0], b[0][1], { free: true });
      g.collapse();
    }
    invariant(g, `L${level.id} finale`);
  }
  return { won, score: g.score, used: g.movesUsed, taps, boosters, combos, chains, shuffles, maxPop, stars: g.stars() };
}

const RUNS = 200;
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const report = [];
for (const L of LEVELS) {
  // レイアウトの形
  if (L.layout) check(L.layout.length === L.rows && L.layout.every((l) => l.length === L.cols), `L${L.id}: layout の大きさが違う`);
  const results = [];
  for (let s = 1; s <= RUNS; s++) results.push(play(L, s * 101 + L.id));
  const wins = results.filter((x) => x.won);
  const rate = wins.length / RUNS;
  const scores = wins.map((x) => x.score).sort((a, b) => a - b);
  const stars = [1, 2, 3].map((k) => wins.filter((x) => x.stars === k).length);
  report.push({
    L: L.id,
    clear: Math.round(rate * 100) + "%",
    usedMoves: wins.length ? (wins.reduce((n, x) => n + x.used, 0) / wins.length).toFixed(1) + "/" + L.moves : "-",
    boosters: (results.reduce((n, x) => n + x.boosters, 0) / RUNS).toFixed(1),
    combos: (results.reduce((n, x) => n + x.combos, 0) / RUNS).toFixed(2),
    chains: (results.reduce((n, x) => n + x.chains, 0) / RUNS).toFixed(1),
    shuffles: results.reduce((n, x) => n + x.shuffles, 0),
    maxPop: Math.max(...results.map((x) => x.maxPop)),
    score35: scores.length ? pct(scores, 0.35) : 0,
    score50: scores.length ? pct(scores, 0.5) : 0,
    score80: scores.length ? pct(scores, 0.8) : 0,
    stars: stars.join("/"),
  });
  // 難しさ：最初は必ずクリアできる、あとは少しずつ難しく（ボットより人のほうが上手なので、ボットで半分以上）
  const minRate = L.id <= 2 ? 0.97 : L.id <= 5 ? 0.85 : L.id <= 7 ? 0.55 : 0.45;
  check(rate >= minRate, `L${L.id}: ボットのクリア率が低すぎる ${Math.round(rate * 100)}%（目安 ${minRate * 100}%以上）`);
  check(rate < 1 || L.id <= 4, `L${L.id}: 後半なのにボットが必ずクリアできる（簡単すぎ）`);
  check(results.reduce((n, x) => n + x.boosters, 0) > 0, `L${L.id}: ブースターが一度もできない`);
  // 星：3つ星は上手に遊んだときだけ、2つ星はふつうに取れる
  if (wins.length) {
    check(stars[2] / wins.length < 0.45, `L${L.id}: 3つ星が簡単すぎる (${stars.join("/")})`);
    check((stars[1] + stars[2]) / wins.length > 0.3, `L${L.id}: 2つ星が難しすぎる (${stars.join("/")})`);
  }
}
console.table(report);
if (process.argv.includes("--stars")) {
  // 星の点数の目安：2つ星＝ボットの勝ちの35%点、3つ星＝80%点（100点きざみ）
  console.log(JSON.stringify(report.map((x) => [x.L, Math.round(x.score35 / 100) * 100, Math.round(x.score80 / 100) * 100])));
}

// ブースターと合体の効果（小さな盤面で確かめる）
{
  const flat = { id: 0, cols: 7, rows: 7, colors: 3, moves: 10, goals: [{ type: "color", color: 0, count: 999 }], stars: [1, 2] };
  const mk = (layout) => new PB.Game({ ...flat, layout }, 5);
  // ロケット（横）は1行ぜんぶ
  {
    const g = mk(["0101010", "1010101", "0101010", "1010R01", "0101010", "1010101", "0101010"]);
    g.grid[3][4].dir = "h";
    const res = g.tap(3, 4);
    check(res && res.events.filter((e) => e.type === "pop").length === 7, "ロケット（横）が1行を消さない");
  }
  // ボム：まわり13マス
  {
    const g = mk(["0101010", "1010101", "0101010", "101O101", "0101010", "1010101", "0101010"]);
    const res = g.tap(3, 3);
    check(res && res.events.filter((e) => e.type === "pop").length === 13, `ボムの範囲が違う: ${res && res.events.filter((e) => e.type === "pop").length}`);
  }
  // ロケット＋ロケット＝十字（合体）
  {
    const g = mk(["0101010", "1010101", "0101010", "101RR01", "0101010", "1010101", "0101010"]);
    const res = g.tap(3, 3);
    check(res && res.kind === "combo" && res.combo === "rocket+rocket", "ロケット同士が合体しない");
    const popped = new Set(res.events.filter((e) => e.type === "pop").map((e) => e.r * 10 + e.c));
    check([...Array(7).keys()].every((k) => popped.has(3 * 10 + k) && popped.has(k * 10 + 3)), "十字に消えない");
  }
  // レインボー＋レインボー＝全部
  {
    const g = mk(["0101010", "1010101", "0101010", "101DD01", "0101010", "1010101", "0101010"]);
    const res = g.tap(3, 3);
    check(res && res.combo === "disco+disco" && res.events.filter((e) => e.type === "pop").length === 49, "レインボー同士で全部消えない");
  }
  // レインボー＋ボム：その色が全部ボムになって爆発
  {
    const g = mk(["0101010", "1010101", "0101010", "101DO01", "0101010", "1010101", "0101010"]);
    g.grid[3][3].color = 0;
    const res = g.tap(3, 3);
    check(res && res.combo === "disco+bomb" && res.events.some((e) => e.type === "transform" && e.piece.t === "bomb"), "レインボー＋ボムでボムに変わらない");
  }
  // 連鎖：ロケットの通り道のボムが、続けて爆発する
  {
    const g = mk(["0101010", "1010101", "0101010", "R01010O", "0101010", "1010101", "0101010"]);
    g.grid[3][0].dir = "h";
    const res = g.tap(3, 0);
    check(res && res.chain >= 1 && res.events.some((e) => e.type === "fx" && e.fx === "bomb"), "ブースターの連鎖が起きない");
  }
  // グループの大きさでブースターが変わる
  {
    const g = mk(["0000011", "1111111", "2222222", "1111111", "2222222", "1111111", "2222222"]);
    const res = g.tap(0, 0);
    check(res && res.created === "rocket", "5個でロケットができない");
    const g2 = mk(["0000000", "1111111", "2222222", "1111111", "2222222", "1111111", "2222222"]);
    check(g2.tap(0, 0).created === "bomb", "7個でボムができない");
    const g3 = mk(["0000000", "0011111", "2222222", "1111111", "2222222", "1111111", "2222222"]);
    check(g3.tap(0, 0).created === "disco", "9個でレインボーができない");
    const g4 = mk(["0010101", "1101010", "0101010", "1010101", "0101010", "1010101", "0101010"]);
    check(g4.tap(0, 2) === null, "1個だけなのに消せてしまう");
    check(g4.moves === 10, "消せないタップで手数が減る");
  }
  // 木箱：となりで1回消すと1減る。石はとなりでは壊れない
  {
    const g = mk(["0011111", "B222222", "S111111", "2222222", "1111111", "2222222", "1111111"]);
    const res = g.tap(0, 0);
    check(res.events.some((e) => e.type === "pop" && e.piece.t === "box"), "となりで消しても木箱が壊れない");
    check(!res.events.some((e) => e.piece && e.piece.t === "stone"), "石がとなりで壊れた");
  }
  // プレゼントは下まで落ちると回収
  {
    const g = mk(["1212121", "2121212", "1212121", "2121212", "1212121", "G121212", "0012121"]);
    g.tap(6, 0);
    const col = g.collapse();
    check(col.collected.length === 1, "プレゼントが回収されない");
  }
}

if (failed) {
  console.error(`\n${failed} 件の NG`);
  process.exit(1);
}
console.log(`OK: ${LEVELS.length}ステージ × ${RUNS}回のボットプレイで盤面がこわれない・クリアできる・難しさが少しずつ上がる / ロケット・ボム・レインボー・合体・連鎖・木箱・石・プレゼントの動き`);
