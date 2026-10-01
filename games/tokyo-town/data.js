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
//   下北沢: 好きなものに一直線、ノリと勢い、お金より体験
//   代官山: 自分の美意識、丁寧さ、身近な人と落ち着いて過ごす
//   浅草  : 人とのつながり、誰かと一緒が楽しい、王道を楽しめる
//   渋谷  : スピードと刺激、新しいもの・情報が好き、すぐ動く
//   吉祥寺: 無理しないバランス、現実的、まわりに合わせられる
//   谷根千: マイペース、急がない、なじみの場所と小さな発見
//   丸の内: 段取りと合理性、用事を先に片付ける、確実さ
//   中目黒: 雰囲気と感性、お店選びへのこだわり、寄り道好き
const QUESTIONS = [
  {
    text: "土曜日の予定が、突然なくなった。どうする？",
    options: [
      { emoji: "📍", label: "前から気になっていた店や場所に行ってみる", scores: { nakameguro: 2, daikanyama: 1 } },
      { emoji: "🧺", label: "家でたまっていた用事を片付ける", scores: { marunouchi: 2, kichijoji: 1 } },
      { emoji: "📱", label: "誰かに連絡して、別の予定を作る", scores: { shibuya: 2, asakusa: 1 } },
      { emoji: "💭", label: "特に決めず、その日の気分で過ごす", scores: { yanaka: 2, shimokitazawa: 1 } },
    ],
  },
  {
    text: "金曜日の夜。仕事や学校が終わった。",
    options: [
      { emoji: "🏠", label: "まっすぐ帰って、家でゆっくりする", scores: { kichijoji: 2, yanaka: 1 } },
      { emoji: "🍝", label: "家族や恋人と、ごはんを食べる", scores: { daikanyama: 2, nakameguro: 1 } },
      { emoji: "🍺", label: "同僚や友だちと軽く一杯（一杯で終わるとは言ってない）", scores: { asakusa: 2, shimokitazawa: 1 } },
      { emoji: "👀", label: "ちょっと寄り道して、お店をのぞいてから帰る", scores: { nakameguro: 2, shibuya: 1 } },
    ],
  },
  {
    text: "初めて来た街で、30分ほど時間が空いた。",
    options: [
      { emoji: "🔍", label: "地図アプリで、近くの評判のいい店を探す", scores: { nakameguro: 2, marunouchi: 1 } },
      { emoji: "🚶", label: "気になった道を、なんとなく歩いてみる", scores: { yanaka: 2, shimokitazawa: 1 } },
      { emoji: "☕", label: "入りやすそうなカフェで、ひと休みする", scores: { kichijoji: 2, daikanyama: 1 } },
      { emoji: "🏬", label: "駅ビルや大きなお店を、ぶらっと見て回る", scores: { shibuya: 2, marunouchi: 1 } },
    ],
  },
  {
    text: "友だちと遊ぶ予定を立てるとき、あなたは？",
    options: [
      { emoji: "💡", label: "行きたい店や場所の候補を出す", scores: { nakameguro: 2, shibuya: 1 } },
      { emoji: "📅", label: "日にちや集合場所をまとめる", scores: { marunouchi: 2, daikanyama: 1 } },
      { emoji: "👌", label: "決まったことに合わせる。どこでも楽しめる", scores: { kichijoji: 2, asakusa: 1 } },
      { emoji: "🎲", label: "とりあえず集まって、その場で決めたい", scores: { shimokitazawa: 2, asakusa: 1 } },
    ],
  },
  {
    text: "家族や地元の友だちが、東京に遊びに来た。",
    options: [
      { emoji: "📷", label: "せっかくだから、定番の観光スポットへ", scores: { asakusa: 2, marunouchi: 1 } },
      { emoji: "🏡", label: "自分がふだん行っている、お気に入りの店へ", scores: { yanaka: 2, nakameguro: 1 } },
      { emoji: "✨", label: "最近話題になっている、新しい場所へ", scores: { shibuya: 2, nakameguro: 1 } },
      { emoji: "📝", label: "相手の希望を聞いて、行き方や店を下調べしておく", scores: { daikanyama: 2, marunouchi: 1 } },
    ],
  },
  {
    text: "疲れがたまっている、平日の夜。",
    options: [
      { emoji: "🍜", label: "好きなものを食べて、早めに寝る", scores: { kichijoji: 2, asakusa: 1 } },
      { emoji: "📞", label: "家族や友だちとしゃべって、スッキリする", scores: { asakusa: 2, shibuya: 1 } },
      { emoji: "🎮", label: "動画・音楽・ゲームなど、好きなことに没頭する", scores: { shimokitazawa: 2, yanaka: 1 } },
      { emoji: "🛁", label: "お風呂にゆっくり浸かって、整える", scores: { daikanyama: 2, yanaka: 1 } },
    ],
  },
  {
    text: "ちょっとした臨時収入（3万円）が入った。",
    options: [
      { emoji: "🎁", label: "前から欲しかった物を買う", scores: { daikanyama: 2, nakameguro: 1 } },
      { emoji: "🍣", label: "家族や友だちと、おいしいものを食べに行く", scores: { asakusa: 2, kichijoji: 1 } },
      { emoji: "🎫", label: "旅行やライブなど、「体験」に使う", scores: { shimokitazawa: 2, shibuya: 1 } },
      { emoji: "🐷", label: "ほとんど貯金。少しだけ自分にごほうび", scores: { marunouchi: 2, kichijoji: 1 } },
    ],
  },
  {
    text: "電車で30分の移動中。だいたい何してる？",
    options: [
      { emoji: "📰", label: "SNSやニュースをチェックしている", scores: { shibuya: 2, shimokitazawa: 1 } },
      { emoji: "🎧", label: "音楽・動画・ゲームの続きをしている", scores: { shimokitazawa: 2, nakameguro: 1 } },
      { emoji: "😪", label: "本を読むか、ぼーっとしている（気づいたら寝てる）", scores: { yanaka: 2, daikanyama: 1 } },
      { emoji: "📧", label: "メールや予定を確認して、用事を片付ける", scores: { marunouchi: 2, daikanyama: 1 } },
    ],
  },
  {
    text: "よく通る道に、知らないお店ができていた。",
    options: [
      { emoji: "🚪", label: "気になったら、その日のうちに入ってみる", scores: { shibuya: 2, shimokitazawa: 1 } },
      { emoji: "⭐", label: "口コミや評判を見てから行くか決める", scores: { daikanyama: 2, marunouchi: 1 } },
      { emoji: "👫", label: "誰かを誘って、一緒に行ってみる", scores: { asakusa: 2, kichijoji: 1 } },
      { emoji: "🤔", label: "「気になるな〜」と思いつつ、なかなか入れない", scores: { kichijoji: 2, yanaka: 1 } },
    ],
  },
  {
    text: "出かける予定の日に、雨が降ってきた。",
    options: [
      { emoji: "🌂", label: "気にせず、予定どおり出かける", scores: { shimokitazawa: 2, asakusa: 1 } },
      { emoji: "🏢", label: "行き先を、屋内で楽しめる場所に変える", scores: { marunouchi: 2, shibuya: 1 } },
      { emoji: "📺", label: "予定をずらして、今日は家で過ごす", scores: { yanaka: 2, kichijoji: 1 } },
      { emoji: "☔", label: "雨の日の街の雰囲気も、けっこう好き", scores: { nakameguro: 2, yanaka: 1 } },
    ],
  },
];
