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

const QUESTIONS = [
  {
    text: "休日の朝、まず何をしたい？",
    options: [
      { emoji: "😴", label: "昼まで寝て、ゆっくりスタート", scores: { yanaka: 2, shimokitazawa: 1 } },
      { emoji: "☕", label: "おしゃれなカフェでモーニング", scores: { daikanyama: 3, nakameguro: 1 } },
      { emoji: "🏃", label: "公園でランニングや散歩", scores: { kichijoji: 2, marunouchi: 1 } },
      { emoji: "🛍", label: "開店と同時に買い物へ", scores: { shibuya: 2, kichijoji: 1 } },
    ],
  },
  {
    text: "好きな食べものの雰囲気は？",
    options: [
      { emoji: "🍢", label: "老舗の定食・食べ歩き", scores: { asakusa: 3, yanaka: 1 } },
      { emoji: "🍛", label: "スパイスカレーなど個性派", scores: { shimokitazawa: 2, kichijoji: 1 } },
      { emoji: "🍝", label: "ビストロでワインと一緒に", scores: { nakameguro: 2, daikanyama: 1 } },
      { emoji: "🍣", label: "ちょっと贅沢なレストラン", scores: { marunouchi: 3 } },
    ],
  },
  {
    text: "人混みについてどう思う？",
    options: [
      { emoji: "🎉", label: "にぎやかなほうがワクワクする", scores: { shibuya: 2, asakusa: 1 } },
      { emoji: "🙂", label: "ほどほどなら平気", scores: { kichijoji: 3, marunouchi: 1 } },
      { emoji: "😌", label: "できれば静かな場所がいい", scores: { daikanyama: 2, yanaka: 2 } },
      { emoji: "🎶", label: "好きなイベントなら気にしない", scores: { shimokitazawa: 2, nakameguro: 1 } },
    ],
  },
  {
    text: "ファッションのこだわりは？",
    options: [
      { emoji: "👕", label: "古着やヴィンテージが好き", scores: { shimokitazawa: 3 } },
      { emoji: "🧥", label: "シンプルで上質なもの", scores: { daikanyama: 3, marunouchi: 1 } },
      { emoji: "👟", label: "流行をいち早く取り入れる", scores: { shibuya: 3 } },
      { emoji: "🧶", label: "着心地がいちばん", scores: { yanaka: 2, kichijoji: 1 } },
    ],
  },
  {
    text: "友だちと会うなら、どこで？",
    options: [
      { emoji: "🍺", label: "気軽な居酒屋・立ち飲み", scores: { asakusa: 2, shimokitazawa: 1 } },
      { emoji: "🌳", label: "公園でピクニック", scores: { kichijoji: 3 } },
      { emoji: "🍸", label: "夜景の見えるバー", scores: { marunouchi: 2 } },
      { emoji: "🖼", label: "ギャラリーやお店めぐり", scores: { nakameguro: 2, yanaka: 1 } },
    ],
  },
  {
    text: "古いものと新しいもの、惹かれるのは？",
    options: [
      { emoji: "⛩", label: "伝統や歴史のあるもの", scores: { asakusa: 3, yanaka: 1 } },
      { emoji: "📻", label: "レトロでどこか懐かしいもの", scores: { yanaka: 2, shimokitazawa: 2 } },
      { emoji: "✨", label: "できたばかりの最新スポット", scores: { shibuya: 2, marunouchi: 1 } },
      { emoji: "🎨", label: "古さと新しさのミックス", scores: { nakameguro: 2, daikanyama: 1, kichijoji: 1 } },
    ],
  },
  {
    text: "理想の働き方は？",
    options: [
      { emoji: "🏢", label: "大きな会社でキャリアアップ", scores: { marunouchi: 3 } },
      { emoji: "💻", label: "スタートアップで挑戦", scores: { shibuya: 2, nakameguro: 1 } },
      { emoji: "🎭", label: "好きなことを仕事にしたい", scores: { shimokitazawa: 2, nakameguro: 1 } },
      { emoji: "🏡", label: "家の近くでマイペースに", scores: { kichijoji: 2, yanaka: 1 } },
    ],
  },
  {
    text: "旅行に行くならどんなスタイル？",
    options: [
      { emoji: "📋", label: "計画をしっかり立てる", scores: { marunouchi: 2, daikanyama: 1 } },
      { emoji: "🎲", label: "行き当たりばったりで楽しむ", scores: { shimokitazawa: 2, yanaka: 1 } },
      { emoji: "♨️", label: "温泉や名所でのんびり", scores: { asakusa: 2, yanaka: 1 } },
      { emoji: "📸", label: "映えスポットを巡る", scores: { nakameguro: 2, shibuya: 1, daikanyama: 1 } },
    ],
  },
  {
    text: "好きな季節のイベントは？",
    options: [
      { emoji: "🌸", label: "川沿いのお花見", scores: { nakameguro: 3 } },
      { emoji: "🎆", label: "花火大会やお祭り", scores: { asakusa: 3 } },
      { emoji: "🎃", label: "ハロウィンやカウントダウン", scores: { shibuya: 3 } },
      { emoji: "🎄", label: "冬のイルミネーション", scores: { marunouchi: 2, daikanyama: 1 } },
    ],
  },
  {
    text: "あなたを一言で表すと？",
    options: [
      { emoji: "🔥", label: "好奇心旺盛なチャレンジャー", scores: { shibuya: 1, shimokitazawa: 1 } },
      { emoji: "🍃", label: "マイペースな癒やし系", scores: { yanaka: 2, kichijoji: 1 } },
      { emoji: "💎", label: "こだわりの強い美意識派", scores: { daikanyama: 3, nakameguro: 1 } },
      { emoji: "🤝", label: "面倒見のいい人情派", scores: { asakusa: 2, kichijoji: 1 } },
    ],
  },
];
