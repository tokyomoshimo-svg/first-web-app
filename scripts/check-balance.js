// 全回答パターンを総当たりして、各街が診断結果になる割合を表示する
// 使い方: node scripts/check-balance.js
// 採点ルールは app.js の calcScores / rankTowns と同じ

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "data.js"), "utf8") + ";this.TOWNS = TOWNS; this.QUESTIONS = QUESTIONS;",
  ctx
);
const { TOWNS, QUESTIONS } = ctx;

const keys = Object.keys(TOWNS);
const errors = [];
QUESTIONS.forEach((q, qi) => {
  if (q.options.length !== 4) errors.push(`Q${qi + 1}: 選択肢が4つではありません`);
  q.options.forEach((o) =>
    Object.keys(o.scores).forEach((k) => {
      if (!TOWNS[k]) errors.push(`Q${qi + 1}: 未定義の街 ${k}`);
    })
  );
});
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const counts = Object.fromEntries(keys.map((k) => [k, 0]));
const optionCount = QUESTIONS.map((q) => q.options.length);
const total = optionCount.reduce((a, b) => a * b, 1);
const choice = new Array(QUESTIONS.length).fill(0);

for (let n = 0; n < total; n++) {
  const points = {};
  const hits = {};
  keys.forEach((k) => (points[k] = hits[k] = 0));
  choice.forEach((ci, qi) => {
    Object.entries(QUESTIONS[qi].options[ci].scores).forEach(([k, pt]) => {
      points[k] += pt;
      hits[k]++;
    });
  });
  const winner = keys.slice().sort((a, b) => points[b] - points[a] || hits[b] - hits[a])[0];
  counts[winner]++;

  // 次の組み合わせへ（繰り上がり）
  for (let qi = 0; qi < choice.length; qi++) {
    if (++choice[qi] < optionCount[qi]) break;
    choice[qi] = 0;
  }
}

console.log(`全 ${total.toLocaleString()} パターン（理想は各 ${(100 / keys.length).toFixed(1)}%）\n`);
let min = Infinity;
let max = 0;
keys.forEach((k) => {
  const pct = (counts[k] / total) * 100;
  min = Math.min(min, pct);
  max = Math.max(max, pct);
  const bar = "█".repeat(Math.round(pct * 2));
  console.log(`${TOWNS[k].name.padEnd(14, "　")} ${pct.toFixed(1).padStart(5)}%  ${bar}`);
});
console.log(`\n最小 ${min.toFixed(1)}% / 最大 ${max.toFixed(1)}%`);

// 1つの街が極端に出ない・出すぎないことを確認
if (min < 8 || max > 18) {
  console.error("NG: 結果の偏りが大きすぎます（許容範囲 8%〜18%）");
  process.exit(1);
}
console.log("OK: 8つの街が偏りなく出ます");
