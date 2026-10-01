// どうでもいい裁判所の判決エンジンをチェックする
// 使い方: node scripts/check-court.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const dir = path.join(__dirname, "..", "games", "court");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(dir, "rules.js"), "utf8") + "\n" +
    fs.readFileSync(path.join(dir, "judge.js"), "utf8") + ";this.Court = Court;",
  ctx
);
const { Court } = ctx;

let failed = 0;
function check(ok, message) {
  if (!ok) {
    failed++;
    console.error("NG: " + message);
  }
}

// 空入力は判決を出さない
["", "   ", "\n\n"].forEach((t) => check(Court.judge(t) === null, `空入力 ${JSON.stringify(t)} で判決が出た`));

// キーワードごとに、狙った罪・相手が選ばれるか
const expectations = [
  ["既読無視3時間は有罪？", "reply", null],
  ["返信が2日遅れた", "reply", null],
  ["友達との待ち合わせに5分遅れた", "late", "friend"],
  ["会議に遅刻した", "late", null],
  ["最後のプリンを食べた", "food", null],
  ["弟のケーキを食べた", "food", "family"],
  ["約束を忘れてた", "promise", null],
  ["お金を返し忘れた", "money", null],
  ["友達に1000円借りた", "money", "friend"],
  ["家族に勝手にスマホを見られた", "privacy", "family"],
  ["「何でもいい」と言われて本当に何でもいいものを選んだ", "whatever", null],
  ["恋人の誕生日を忘れた", "promise", "partner"],
  ["洗い物をいつも後回しにする", "chores", null],
  ["二度寝した", "sleep", null],
  ["空が青い", null, null],
];
expectations.forEach(([text, act, people]) => {
  const r = Court.judge(text);
  check(r && r.matched.act === act, `「${text}」の罪の種類: 期待 ${act} / 実際 ${r && r.matched.act}`);
  check(r && r.matched.people === people, `「${text}」の相手: 期待 ${people} / 実際 ${r && r.matched.people}`);
});

// 被告の判定
check(Court.judge("家族に勝手にスマホを見られた").defendant.startsWith("相手"), "受け身の文で被告が相手にならない");
check(Court.judge("最後のプリンを食べた").defendant === "あなた", "自分の行動で被告があなたにならない");
check(Court.judge("怒られました。俺が悪い？").defendant === "あなた", "「俺が悪い？」で被告があなたにならない");

// どんな入力でも、必ず完全な判決が出る
const samples = ["a", "プリン", "x".repeat(500), "<script>alert(1)</script>", "ＡＢＣ　１２３", "😀😀😀", "10万円貸した", "三日間返信がない", "わざとアイスを食べた！！"];
for (let i = 0; i < 300; i++) samples.push(Math.random().toString(36).slice(2) + "を" + ["した", "された", "忘れた"][i % 3]);
samples.forEach((text) => {
  const r = Court.judge(text);
  const ok =
    r && r.caseNo && r.crime && r.verdict && r.main && r.comment && r.reasons.length >= 1 && r.reasons.length <= 3 &&
    r.guilt >= 0 && r.guilt <= 100 && !/undefined|NaN/.test(JSON.stringify(r));
  check(ok, `不完全な判決: ${JSON.stringify(text).slice(0, 40)}`);
  check(JSON.stringify(Court.judge(text)) === JSON.stringify(r), `同じ入力で判決が変わった: ${text.slice(0, 20)}`);
});

if (failed) {
  console.error(`\n${failed} 件の NG`);
  process.exit(1);
}
console.log(`OK: ${expectations.length + samples.length + 6} ケースすべて問題なし`);
