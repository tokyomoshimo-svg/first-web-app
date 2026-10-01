// 診断データ：街（結果タイプ）と質問
// 各選択肢の scores に「街のキー: 加点」を書く。合計点が最も高い街が診断結果になる。

const TOWNS = {
  shimokitazawa: {
    name: "下北沢",
    type: "自由なサブカル",
    emoji: "🎸",
    color: "#ff8a5b",
    catch: "古着と音楽と演劇。好きなものに一直線な街。",
    desc: "小さなライブハウスや劇場、古着屋、個性的なカフェがぎゅっと詰まった街。流行より「自分の好き」を大切にするあなたにぴったり。ふらっと路地に入れば、いつも新しい発見があります。",
    features: ["古着屋めぐりが楽しい", "ライブハウス・小劇場が多い", "再開発で新しいスポットも続々"],
  },
  daikanyama: {
    name: "代官山",
    type: "洗練おしゃれ",
    emoji: "🥐",
    color: "#c49a6c",
    catch: "落ち着いたセンスのよさが光る、大人の街。",
    desc: "セレクトショップや本屋、テラスのあるカフェが並ぶ、ゆったりとおしゃれな街。人混みは苦手だけど、上質なものに囲まれていたいあなたに。休日のブランチがよく似合います。",
    features: ["こだわりのセレクトショップ", "テラス席のあるカフェ", "渋谷から近いのに静か"],
  },
  asakusa: {
    name: "浅草",
    type: "下町人情",
    emoji: "🏮",
    color: "#e0533d",
    catch: "人との距離が近い、あたたかい下町。",
    desc: "浅草寺や仲見世、昔ながらの商店や飲み屋が残る、東京の下町を代表する街。にぎやかで人懐っこく、伝統を大切にするあなたに。隅田川沿いの散歩も気持ちいいですよ。",
    features: ["浅草寺・仲見世の活気", "老舗グルメと食べ歩き", "隅田川とスカイツリーの景色"],
  },
  shibuya: {
    name: "渋谷",
    type: "トレンド最前線",
    emoji: "⚡",
    color: "#7b61ff",
    catch: "いつでも新しい何かが始まっている街。",
    desc: "スクランブル交差点に大型商業施設、IT企業やエンタメが集まる、東京の流行の発信地。新しいもの好きで、刺激とスピード感を楽しめるあなたに。夜まで眠らないエネルギーが魅力です。",
    features: ["最新のショップ・グルメ", "IT・カルチャーの発信地", "どこへ行くにも便利な交通網"],
  },
  kichijoji: {
    name: "吉祥寺",
    type: "バランス上手",
    emoji: "🦢",
    color: "#3fb68b",
    catch: "都会の便利さと自然、どっちも欲しい。",
    desc: "井の頭公園の緑と、商店街・デパート・カフェがほどよく揃う、住みたい街の常連。仕事も遊びも暮らしも、いいとこ取りしたいバランス感覚のあるあなたに。",
    features: ["井の頭公園でのんびり", "商店街も大型店もそろう", "カフェや雑貨屋が充実"],
  },
  yanaka: {
    name: "谷根千（谷中・根津・千駄木）",
    type: "のんびり散歩",
    emoji: "🐈",
    color: "#d4a017",
    catch: "猫と路地とレトロ。時間がゆっくり流れる街。",
    desc: "お寺や古い木造家屋、小さな商店が残るレトロな街並み。夕やけだんだんや谷中銀座をぶらぶら歩けば、心がほどけていくはず。マイペースで、日常の小さな幸せを大切にするあなたに。",
    features: ["レトロな路地と商店街", "猫に会える散歩道", "個人経営のギャラリーやカフェ"],
  },
  marunouchi: {
    name: "丸の内",
    type: "スマートエリート",
    emoji: "💼",
    color: "#2f6fdb",
    catch: "洗練されたビジネス街で、ワンランク上の毎日を。",
    desc: "東京駅を中心に、オフィスビルと上質なショップ・レストランが並ぶ街。仕事にもプライベートにも妥協せず、計画的に目標を叶えていくあなたに。夜のイルミネーションも見どころです。",
    features: ["東京駅直結のアクセス", "高級ブランドやレストラン", "皇居ランやイルミネーション"],
  },
  nakameguro: {
    name: "中目黒",
    type: "感性クリエイター",
    emoji: "🌸",
    color: "#f27aa6",
    catch: "川沿いの桜と、こだわりの小さなお店。",
    desc: "目黒川沿いにカフェやインテリアショップ、隠れ家的な飲食店が並ぶ街。春の桜並木は圧巻です。おしゃれだけど気取らず、自分の感性を大事にするクリエイティブなあなたに。",
    features: ["目黒川の桜並木", "隠れ家カフェ・ビストロ", "インテリア・雑貨の名店"],
  },
};

// 街ごとの価値観（選択肢の配点の根拠。名物ではなく「行動のクセ」で振り分ける）
//   下北沢: 好きなものに一直線、ノリと寄り道、お金より体験
//   代官山: 自分の美意識、静かな上質さ、人との適度な距離
//   浅草  : 人情と顔なじみ、巻き込み力、ノリのいいおせっかい
//   渋谷  : スピードと刺激、人の多さで燃える、新しいもの優先
//   吉祥寺: 無理しないバランス、生活圏で完結、現実的
//   谷根千: マイペース、急がない、小さな発見を楽しむ
//   丸の内: 段取りと合理性、オンオフの切り替え、確実さ
//   中目黒: 雰囲気と感性、こだわりの小さな店、ちょっと秘密主義
const QUESTIONS = [
  {
    text: "土曜の朝、今日の予定がドタキャンされた。",
    options: [
      { emoji: "🛌", label: "「よし」と言って二度寝。起きてから考える", scores: { yanaka: 2, kichijoji: 1 } },
      { emoji: "📱", label: "すぐ「今日ヒマな人〜？」と送る", scores: { shibuya: 2, asakusa: 1 } },
      { emoji: "🚶", label: "行くはずだった店に一人で行く。むしろ快適", scores: { daikanyama: 2, nakameguro: 1 } },
      { emoji: "🚃", label: "とりあえず電車に乗って、気になった駅で降りる", scores: { shimokitazawa: 2, yanaka: 1 } },
    ],
  },
  {
    text: "金曜19時、仕事が終わった。",
    options: [
      { emoji: "🏃", label: "まっすぐ帰る。家に着くまでが最高の時間", scores: { daikanyama: 2, kichijoji: 1 } },
      { emoji: "🍶", label: "行きつけに顔を出す。「いつもの」で通じる店がある", scores: { asakusa: 2, shimokitazawa: 1 } },
      { emoji: "📅", label: "前から予約しておいた店へ。金曜は決めてある", scores: { nakameguro: 2, marunouchi: 1 } },
      { emoji: "👀", label: "誰かから「今どこ？」が来るのを待つ（来たら行く）", scores: { shibuya: 2, shimokitazawa: 1 } },
    ],
  },
  {
    text: "初めて降りた駅。まず何をする？",
    options: [
      { emoji: "🏮", label: "商店街を端から端まで歩いてみる", scores: { yanaka: 2, asakusa: 1 } },
      { emoji: "⭐", label: "地図アプリで評価4.0以上の店を探す", scores: { marunouchi: 2, shibuya: 1 } },
      { emoji: "🐾", label: "なんとなく気になる路地に吸い込まれる", scores: { shimokitazawa: 2, nakameguro: 1 } },
      { emoji: "🍔", label: "駅前の知ってるチェーン店で、一旦落ち着く", scores: { kichijoji: 2, marunouchi: 1 } },
    ],
  },
  {
    text: "友だちの友だち（初対面）が飲み会に合流してきた。",
    options: [
      { emoji: "🍻", label: "30分後には昔からの友だちみたいになってる", scores: { asakusa: 2, shibuya: 1 } },
      { emoji: "🧐", label: "相手の服や持ち物が気になって、そこから話しかける", scores: { nakameguro: 2, daikanyama: 1 } },
      { emoji: "🙂", label: "様子を見つつ、聞き役にまわる", scores: { kichijoji: 2, daikanyama: 1 } },
      { emoji: "🔋", label: "楽しい。でも帰り道に一人反省会をする", scores: { daikanyama: 2, yanaka: 1 } },
    ],
  },
  {
    text: "誰にも邪魔されない、一人の休日。",
    options: [
      { emoji: "📚", label: "開店直後の空いた本屋や美術館を独り占め", scores: { daikanyama: 2, marunouchi: 1 } },
      { emoji: "💿", label: "中古レコード屋か古本屋で2時間迷う", scores: { shimokitazawa: 2, yanaka: 1 } },
      { emoji: "🐈", label: "あてもなく歩く。猫に会えたら今日は勝ち", scores: { yanaka: 2, kichijoji: 1 } },
      { emoji: "🆕", label: "話題の新スポットへ。一人だと並ぶのも身軽", scores: { shibuya: 2, nakameguro: 1 } },
    ],
  },
  {
    text: "東京にいて、いちばん「いいな」と思う瞬間は？",
    options: [
      { emoji: "🌃", label: "残業帰り、ビルの窓明かりがきれいに見えたとき", scores: { marunouchi: 2, shibuya: 1 } },
      { emoji: "🥛", label: "銭湯上がりの夜風に当たっているとき", scores: { asakusa: 2, yanaka: 1 } },
      { emoji: "🚦", label: "大勢の人と同時に歩き出す、あの一瞬", scores: { shibuya: 2, shimokitazawa: 1 } },
      { emoji: "🍞", label: "住宅街で、いい匂いの小さな店を見つけたとき", scores: { nakameguro: 2, kichijoji: 1 } },
    ],
  },
  {
    text: "思いがけず、臨時収入が3万円入った。",
    options: [
      { emoji: "👜", label: "ずっと迷っていた「一生モノ」をついに買う", scores: { daikanyama: 2, marunouchi: 1 } },
      { emoji: "🎫", label: "ライブか舞台のチケットに消える", scores: { shimokitazawa: 2, asakusa: 1 } },
      { emoji: "🍖", label: "みんなを誘って焼肉。気づいたら足りてない", scores: { asakusa: 2, shimokitazawa: 1 } },
      { emoji: "🧻", label: "半分貯金、残りで「ちょっといいトイレットペーパー」", scores: { kichijoji: 2, marunouchi: 1 } },
    ],
  },
  {
    text: "友だちと旅行。あなたは何係？",
    options: [
      { emoji: "📋", label: "しおり係。分単位のスケジュールを作る", scores: { marunouchi: 2, daikanyama: 1 } },
      { emoji: "📍", label: "「ここ行きたい」と店のリンクだけ大量に送る係", scores: { nakameguro: 2, shibuya: 1 } },
      { emoji: "🗣", label: "現地のおじちゃんと仲良くなってくる係", scores: { asakusa: 2, shimokitazawa: 1 } },
      { emoji: "⏰", label: "集合時間にちゃんと来る係（それ以外は任せた）", scores: { kichijoji: 2, yanaka: 1 } },
    ],
  },
  {
    text: "すごくいいお店を見つけてしまった。",
    options: [
      { emoji: "🤫", label: "誰にも教えない。自分だけの場所にする", scores: { nakameguro: 2, daikanyama: 1 } },
      { emoji: "📸", label: "その場でストーリーに上げる", scores: { shibuya: 2, nakameguro: 1 } },
      { emoji: "👋", label: "通いつめて、店主に顔を覚えてもらう", scores: { yanaka: 2, asakusa: 1 } },
      { emoji: "📝", label: "「大事な日に使える店」リストにそっと追加", scores: { marunouchi: 2, kichijoji: 1 } },
    ],
  },
  {
    text: "出かけた先で、急に大雨が降ってきた。",
    options: [
      { emoji: "☕", label: "近くの喫茶店に入って、止むまで粘る", scores: { yanaka: 2, daikanyama: 1 } },
      { emoji: "💦", label: "ここまで濡れたらもう楽しい。そのまま歩く", scores: { shimokitazawa: 2, asakusa: 1 } },
      { emoji: "🚇", label: "地下でつながっている場所に、即ルート変更", scores: { marunouchi: 2, shibuya: 1 } },
      { emoji: "🏠", label: "帰る。今日はそういう日だったと受け入れる", scores: { kichijoji: 2, nakameguro: 1 } },
    ],
  },
];
