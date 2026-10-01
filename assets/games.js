// ゲーム一覧（トップページのカードはここから作られる）
// 新しいゲームを追加するときは games/<id>/ にファイルを置き、この配列に1件足すだけでOK。

const GAMES = [
  {
    id: "tokyo-town",
    title: "東京の街診断",
    emoji: "🗼",
    description: "10の質問に答えると、あなたにぴったりの東京の街がわかる。",
    time: "約1分",
    color: "#ff6b6b",
    href: "games/tokyo-town/",
  },
  {
    id: "court",
    title: "どうでもいい裁判所",
    emoji: "⚖️",
    description: "日常のどうでもいい事件を入力すると、架空の裁判所が勝手に判決を出す。",
    time: "約1分",
    color: "#2f3e6b",
    href: "games/court/",
  },
];
