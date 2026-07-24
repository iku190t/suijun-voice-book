import { resolvePointAlias } from "./rules.js?v=47";

const BASE_PRIORITY_POINT_NAMES = [...new Set(`
BM,KBM,TBM,仮BM,水準点,仮水準点,既知点,未知点,固定点,既設点,新設点,閉合点,確認点,チェック点,
TP,後視点,前視点,中間点,移器点,盛替点,折返し点,始点BM,終点BM,往路BM,復路BM,閉合BM,
測点,始点,終点,起点,中心点,交点,端点,境界点,変化点,折れ点,器械点,据付点,杭,仮杭,木杭,鋲,測量鋲,金属鋲,コンクリート鋲,釘,測量釘,赤釘,青釘,白釘,プレート,境界杭,コンクリート杭,プラスチック杭,金属杭,石杭,刻印,ペンキ,マーキング,
センター,CL,道路中心,路線中心,河川中心,水路中心,計画中心,現況中心,中心杭,幅杭,逃げ杭,控え杭,法肩杭,法尻杭,丁張杭,見通し杭,方向杭,曲線杭,接線杭,中間杭,距離杭,BP,BC,EC,EP,IP,SP,MC,KA,KE,
横断中心,中央,左,右,左側,右側,左端,右端,左1,左2,左3,左4,左5,右1,右2,右3,右4,右5,左肩,右肩,左法肩,右法肩,左法尻,右法尻,左路肩,右路肩,左車道端,右車道端,左舗装端,右舗装端,左側溝,右側溝,左境界,右境界,左官民境界,右官民境界,左水路,右水路,左擁壁,右擁壁,左天端,右天端,左下端,右下端,
道路,車道,車道中心,車道端,舗装,舗装面,舗装端,アスファルト,アスファルト面,コンクリート舗装,路肩,路肩端,歩道,歩道中心,歩道端,歩車道境界,縁石,縁石上,縁石下,縁石天端,地先境界ブロック,境界ブロック,中央分離帯,ガードレール,ガードレール基礎,ガードレール支柱,防護柵,白線,外側線,中央線,停止線,道路鋲,
マンホール,マンホール中心,マンホール蓋,マンホール天端,集水桝,集水桝中心,集水桝天端,集水桝底,桝,桝中心,桝天端,桝底,グレーチング,グレーチング上,グレーチング下,側溝,側溝中心,側溝天端,側溝底,側溝左,側溝右,側溝外,側溝内,側溝蓋,側溝肩,側溝壁,自由勾配側溝,可変側溝,U字溝,U型側溝,L型側溝,街渠,暗渠,横断管,
河川,水路,水面,水位,水際,左岸,右岸,河床,川底,水路底,底高,底盤,河道,低水路,高水敷,堤防,堤防天端,堤防肩,堤防法面,堤防法尻,護岸,護岸天端,護岸肩,護岸法面,護岸法尻,護岸基礎,護岸下端,石積み,石積み天端,ブロック積み,ブロック積み天端,根固め,根固めブロック,落差工,床止め,床固め,堰,堰天端,樋門,樋管,吐口,流入口,流出口,上流,下流,上流側,下流側,水門,取水口,排水口,放流口,越流部,
地盤,現況地盤,計画地盤,造成面,盛土,切土,法面,法肩,法尻,法面中間,小段,小段肩,小段尻,上段,中段,下段,天端,天端肩,下端,上端,斜面,崖,崖上,崖下,地山,地山線,掘削底,掘削面,床付け,床付け面,床掘り,埋戻し,盛土天端,切土天端,土羽,土羽尻,
擁壁,擁壁天端,擁壁下端,擁壁前面,擁壁背面,擁壁基礎,擁壁底,重力式擁壁,L型擁壁,逆T型擁壁,ブロック積み擁壁,石積み擁壁,コンクリート壁,壁,壁天端,壁下端,基礎,基礎天端,基礎底,フーチング,フーチング天端,フーチング底,橋,橋面,橋台,橋台天端,橋脚,橋脚天端,床版,床版上,床版下,桁,桁下,梁,梁下,ボックスカルバート,カルバート,ボックス,ボックス上,ボックス下,函渠,管渠,翼壁,パラペット,胸壁,地覆,高欄,橋梁中心,橋座,支承,支承面,
建物,建物角,建物入口,玄関,玄関前,床,床面,一階床,二階床,軒,軒下,屋根,屋根端,柱,柱中心,壁面,階段,階段上,階段下,踊り場,駐車場,駐車場面,敷地,敷地境界,敷地角,境界,官民境界,民民境界,道路境界,水路境界,フェンス,フェンス基礎,門,門柱,塀,塀天端,犬走り,土間,コンクリート土間,
水道,水道管,上水道,下水道,下水管,雨水管,汚水管,排水管,ガス管,電線,電線管,通信管,NTT,光ケーブル,共同溝,管,管上,管底,管中心,管口,管入口,管出口,上流管底,下流管底,インバート,流入管,流出管,取付管,本管,枝管,バルブ,仕切弁,止水栓,消火栓,空気弁,量水器,水道メーター,電柱,電柱根元,支柱,標識柱,信号柱,照明柱,街路灯,ハンドホール,下水マンホール,雨水マンホール,汚水マンホール,電気マンホール,通信マンホール,
田,畑,水田,畦,畦畔,田面,農道,用水路,排水路,山,山道,林道,竹林,森林,草地,空地,石,岩,岩盤,露岩,巨石,木,立木,樹木,切り株,生垣,植樹,標識,看板,カーブミラー,郵便ポスト,バス停,倉庫,小屋,車庫,コンテナ,ネットフェンス,金網,門扉,石垣,コンクリート,砂利,土,芝,
計画高,設計高,現況高,施工高,仕上がり高,掘削高,床付け高,切土高,盛土高,路盤高,下層路盤,上層路盤,基層,表層,舗装高,出来形,出来形点,確認高,管理点,丁張,丁張高,逃げ,控え,基準高,基準線,通り芯,芯,オフセット,高さ基準,レベル基準,ゼロ点,砕石,砕石上,捨てコンクリート,捨てコン,捨てコン上,均しコンクリート,鉄筋,型枠,型枠上,コンクリート天端,コンクリート上,コンクリート下,打設面,仕上げ面
`.split(",").map((name) => name.trim()).filter(Boolean))];

const BUILTIN_POINT_ALIASES = [
  ["ビーエム点", "BM"], ["水準基準点", "BM"], ["ビーエム", "BM"],
  ["仮のビーエム", "KBM"], ["ケービーエム", "KBM"], ["仮ビーエム", "KBM"],
  ["ティービーエム", "TBM"], ["仮設ビーエム", "TBM"],
  ["ターニングポイント", "TP"], ["ターンニングポイント", "TP"],
  ["ティーピー点", "TP"], ["ティーピー", "TP"], ["盛り替え点", "TP"], ["盛替点", "TP"], ["移器点", "TP"],
  ["シーエル", "CL"], ["センター", "CL"], ["中心線", "CL"],
  ["アイピー", "IP"], ["ビーピー", "BP"], ["ビーシー", "BC"],
  ["イーシー", "EC"], ["イーピー", "EP"], ["エスピー", "SP"],
  ["エムシー", "MC"], ["ケーエー", "KA"], ["ケーイー", "KE"],
  ["測点ナンバー", "No."], ["ナンバー", "No."],
  ["法の肩", "法肩"], ["のり肩", "法肩"], ["糊肩", "法肩"], ["乗り肩", "法肩"],
  ["法の尻", "法尻"], ["のり尻", "法尻"], ["糊尻", "法尻"], ["乗り尻", "法尻"],
  ["のり面", "法面"], ["糊面", "法面"], ["乗り面", "法面"],
  ["ます", "桝"], ["枡", "桝"], ["てんば", "天端"], ["天場", "天端"],
  ["マンホールの上", "マンホール天端"], ["マンホール上", "マンホール天端"],
  ["マンホール天", "マンホール天端"], ["マンホール蓋", "マンホール天端"],
  ["側溝の上", "側溝天端"], ["側溝上", "側溝天端"], ["側溝天", "側溝天端"],
  ["側溝の下", "側溝底"], ["側溝の底", "側溝底"], ["側溝下", "側溝底"],
  ["縁石の上", "縁石上"], ["縁石天端", "縁石上"], ["縁石の下", "縁石下"], ["縁石下端", "縁石下"],
  ["現場地盤", "現況地盤"], ["現在地盤", "現況地盤"], ["計画盤", "計画地盤"],
  ["スタート", "始点"], ["ゴール", "終点"], ["真ん中", "中央"]
].map(([spoken, pointName]) => ({ spoken, pointName }));

const KANJI_DIGITS = { "〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
const NUMBERED_PREFIXES = ["TP", "BM", "KBM", "TBM", "NO.", "P", "K", "T", "IP.", "BP.", "BC.", "EC.", "EP.", "SP.", "MC.", "KA.", "KE."];
const DOTTED_PREFIXES = new Set(["NO", "IP", "BP", "BC", "EC", "EP", "SP", "MC", "KA", "KE"]);
const SPOKEN_NUMBER_WORDS = [
  ["きゅう", "9"], ["しち", "7"], ["いち", "1"], ["はち", "8"],
  ["ろく", "6"], ["なな", "7"], ["よん", "4"], ["さん", "3"],
  ["ぜろ", "0"], ["れい", "0"], ["まる", "0"], ["に", "2"],
  ["ご", "5"], ["し", "4"], ["く", "9"]
];
const DIGIT_READINGS = ["ゼロ", "イチ", "ニ", "サン", "ヨン", "ゴ", "ロク", "ナナ", "ハチ", "キュウ"];
const DEFAULT_POINT_READINGS = {
  "KBM": "ケービーエム", "TBM": "ティービーエム", "BM": "ビーエム", "TP": "ティーピー",
  "NO": "ナンバー", "IP": "アイピー", "BP": "ビーピー", "BC": "ビーシー",
  "EC": "イーシー", "EP": "イーピー", "SP": "エスピー", "MC": "エムシー",
  "KA": "ケーエー", "KE": "ケーイー", "CL": "シーエル", "P": "ピー", "K": "ケー", "T": "ティー",
  ".": "テン", "-": "ハイフン"
};

function kanjiNumberToArabic(text) {
  if (/^[〇零一二三四五六七八九]+$/.test(text)) {
    return [...text].map((character) => KANJI_DIGITS[character]).join("");
  }
  if (!/[十百千]/.test(text)) return text;
  const units = { "十": 10, "百": 100, "千": 1000 };
  let total = 0;
  let current = 0;
  for (const character of text) {
    if (character in KANJI_DIGITS) {
      current = KANJI_DIGITS[character];
    } else if (character in units) {
      total += (current || 1) * units[character];
      current = 0;
    } else {
      return text;
    }
  }
  return String(total + current);
}

function normalizeNumberedPointName(input) {
  let text = String(input)
    .replace(/第/g, "")
    .replace(/の/g, "")
    .replace(/番号/g, "")
    .replace(/番/g, "")
    .replace(/\s+/g, "")
    .replace(/[〇零一二三四五六七八九十百千]+/g, kanjiNumberToArabic)
    .replace(/^NO\.\.(\d+)$/i, "NO.$1");

  const spokenSuffix = text.match(/^(TP|KBM|TBM|BM|CL|IP|BP|BC|EC|EP|SP|MC|KA|KE|NO|P|K|T)\.?([ぁ-んー]+)$/i);
  if (spokenSuffix) {
    let suffix = spokenSuffix[2];
    let converted = "";
    while (suffix) {
      const match = SPOKEN_NUMBER_WORDS.find(([spoken]) => suffix.startsWith(spoken));
      if (!match) break;
      converted += match[1];
      suffix = suffix.slice(match[0].length);
    }
    if (converted && !suffix) text = `${spokenSuffix[1]}${converted}`;
  }

  if (/^(TP|KBM|TBM|BM|CL|IP|BP|BC|EC|EP|SP|MC|KA|KE|P|K|T)\d+点$/i.test(text)) {
    text = text.slice(0, -1);
  }
  const standard = text.match(/^(TP|KBM|TBM|BM|CL|IP|BP|BC|EC|EP|SP|MC|KA|KE|NO|P|K|T)\.?(\d+)$/i);
  if (standard) {
    const prefix = standard[1].toUpperCase();
    const separator = DOTTED_PREFIXES.has(prefix) ? "." : "";
    return `${prefix}${separator}${Number(standard[2])}`;
  }
  if (/^(TP|KBM|TBM|BM|CL|IP|BP|BC|EC|EP|SP|MC|KA|KE|NO|P|K|T)$/i.test(text)) return text.toUpperCase();
  return text;
}

export function normalizePointName(inputText, manualAliases = []) {
  if (typeof inputText !== "string") return "";
  let text = inputText.normalize("NFKC").trim();
  if (!text) return "";

  const manualResult = resolvePointAlias(text, manualAliases);
  if (manualResult) text = manualResult;
  const builtinResult = resolvePointAlias(text, BUILTIN_POINT_ALIASES);
  if (builtinResult) text = builtinResult;
  return normalizeNumberedPointName(text).toUpperCase();
}

function dynamicNumberedCandidates(normalizedInput) {
  const match = normalizedInput.match(/^(TP|KBM|TBM|BM|NO|IP|BP|BC|EC|EP|SP|MC|KA|KE|P|K|T)\.?(\d*)$/i);
  if (!match) return [];
  const rawPrefix = match[1].toUpperCase();
  const prefix = `${rawPrefix}${DOTTED_PREFIXES.has(rawPrefix) ? "." : ""}`;
  const enteredNumber = match[2];
  if (enteredNumber) {
    const exact = Number(enteredNumber);
    const values = [exact, ...Array.from({ length: 9 }, (_, index) => Number(`${enteredNumber}${index}`))];
    return [...new Set(values.filter((number) => number >= 0 && number <= 999).map((number) => `${prefix}${number}`))];
  }
  const start = prefix === "NO." ? 0 : 1;
  return Array.from({ length: 20 }, (_, index) => `${prefix}${start + index}`);
}

export function recordPointNameUsage(history, pointName, now = Date.now()) {
  if (!pointName) return history;
  const next = history && typeof history === "object" ? history : {};
  const current = next[pointName] || { count: 0, lastUsed: 0 };
  next[pointName] = { count: current.count + 1, lastUsed: now };
  return next;
}

export function getSmartPointSuggestions(inputText, manualAliases = [], history = {}, limit = 8) {
  const normalizedInput = normalizePointName(inputText, manualAliases);
  if (!normalizedInput) return [];
  const manualNames = manualAliases.map((alias) => String(alias?.pointName ?? "").trim()).filter(Boolean);
  const candidates = [...new Set([
    normalizedInput,
    ...dynamicNumberedCandidates(normalizedInput),
    ...manualNames,
    ...BASE_PRIORITY_POINT_NAMES
  ])];
  const inputLower = normalizedInput.toLocaleLowerCase("ja-JP");

  return candidates
    .map((pointName) => {
      const normalized = normalizePointName(pointName);
      const lower = normalized.toLocaleLowerCase("ja-JP");
      const relevance = lower === inputLower ? 3 : lower.startsWith(inputLower) ? 2 : lower.includes(inputLower) ? 1 : 0;
      const usage = history?.[normalized] || history?.[pointName] || { count: 0, lastUsed: 0 };
      return {
        pointName: normalized,
        relevance,
        lastUsed: Number(usage.lastUsed) || 0,
        count: Number(usage.count) || 0,
        manual: manualNames.includes(pointName)
      };
    })
    .filter((candidate) => candidate.relevance > 0)
    .sort((left, right) => (
      right.relevance - left.relevance ||
      right.lastUsed - left.lastUsed ||
      right.count - left.count ||
      Number(right.manual) - Number(left.manual) ||
      left.pointName.localeCompare(right.pointName, "ja")
    ))
    .filter((candidate, index, all) => all.findIndex((item) => item.pointName === candidate.pointName) === index)
    .slice(0, limit)
    .map((candidate) => candidate.pointName);
}

export function incrementPointName(pointName, manualAliases = []) {
  const normalized = normalizePointName(pointName, manualAliases);
  const match = normalized.match(/^(.*?)(\d+)$/);
  if (!match) return "";
  if (!isAllowedPointNameCandidate(normalized, manualAliases)) return "";
  const numberText = match[2];
  const nextNumber = String(Number(numberText) + 1);
  const paddedNumber = numberText.length > 1 && numberText.startsWith("0")
    ? nextNumber.padStart(numberText.length, "0")
    : nextNumber;
  return `${match[1]}${paddedNumber}`;
}

export function isAllowedPointNameCandidate(pointName, manualAliases = []) {
  const normalized = normalizePointName(pointName, manualAliases);
  if (!normalized || /[ぁ-ゖゝゞ]/.test(normalized)) return false;
  if (/^[0-9.\-_]+$/.test(normalized)) return false;
  return /[^0-9.\-_]/.test(normalized);
}

function parseNumberedPointName(pointName, manualAliases = []) {
  const normalized = normalizePointName(pointName, manualAliases);
  if (!isAllowedPointNameCandidate(normalized, manualAliases)) return null;
  const match = normalized.match(/^(.+?)(\d+)$/);
  if (!match) return null;
  const prefix = match[1];
  const typeKey = prefix.replace(/[.\-_]+$/g, "").toUpperCase();
  if (!typeKey) return null;
  return {
    normalized,
    prefix,
    typeKey,
    number: Number(match[2]),
    width: match[2].length
  };
}

export function getSheetPointNameCandidates(pointNamesAbove, manualAliases = [], limit = 3) {
  const names = Array.isArray(pointNamesAbove) ? pointNamesAbove : [];
  if (!names.length || limit <= 0) return [];
  const types = new Map();

  names.forEach((pointName, index) => {
    const parsed = parseNumberedPointName(pointName, manualAliases);
    if (!parsed) return;
    const current = types.get(parsed.typeKey);
    if (!current || parsed.number > current.maxNumber) {
      types.set(parsed.typeKey, {
        prefix: parsed.prefix,
        maxNumber: parsed.number,
        width: parsed.width,
        lastSeen: index
      });
    } else {
      current.lastSeen = index;
      current.prefix = parsed.prefix;
      if (parsed.number === current.maxNumber) current.width = parsed.width;
    }
  });

  const previousType = parseNumberedPointName(names.at(-1), manualAliases)?.typeKey || "";
  const orderedTypes = [...types.entries()].sort((left, right) => {
    if (left[0] === previousType) return -1;
    if (right[0] === previousType) return 1;
    return right[1].lastSeen - left[1].lastSeen;
  });

  return orderedTypes
    .map(([, type]) => {
      const nextNumber = String(type.maxNumber + 1);
      const paddedNumber = type.width > 1 && String(type.maxNumber).length < type.width
        ? nextNumber.padStart(type.width, "0")
        : nextNumber;
      return `${type.prefix}${paddedNumber}`;
    })
    .filter((pointName) => isAllowedPointNameCandidate(pointName, manualAliases))
    .slice(0, Math.min(limit, names.length));
}

function createIncrementedCandidate(type, startAtOne = false) {
  const nextNumber = String(startAtOne ? 1 : type.maxNumber + 1);
  const paddedNumber = type.width > 1
    ? nextNumber.padStart(type.width, "0")
    : nextNumber;
  return `${type.prefix}${paddedNumber}`;
}

function parseRankedPointName(pointName, manualAliases = []) {
  const normalized = normalizePointName(pointName, manualAliases);
  if (/^\d+$/.test(normalized)) {
    return {
      normalized,
      prefix: "",
      typeKey: "__NUMBER_ONLY__",
      number: Number(normalized),
      width: normalized.length
    };
  }
  return parseNumberedPointName(pointName, manualAliases);
}

export function getRankedPointNameCandidates(
  pointNamesAbove,
  manualAliases = [],
  history = {},
  fallbackPointNames = [],
  limit = 4,
  excludedPointName = ""
) {
  if (limit <= 0) return [];
  const sheetTypes = new Map();

  (Array.isArray(pointNamesAbove) ? pointNamesAbove : []).forEach((pointName, index) => {
    const parsed = parseRankedPointName(pointName, manualAliases);
    if (!parsed) return;
    const current = sheetTypes.get(parsed.typeKey);
    if (!current) {
      sheetTypes.set(parsed.typeKey, {
        prefix: parsed.prefix,
        maxNumber: parsed.number,
        width: parsed.width,
        count: 1,
        lastSeen: index
      });
      return;
    }
    current.count += 1;
    current.lastSeen = index;
    current.prefix = parsed.prefix;
    if (parsed.number >= current.maxNumber) {
      current.maxNumber = parsed.number;
      current.width = parsed.width;
    }
  });

  const results = [];
  const usedTypes = new Set();
  const addCandidate = (typeKey, pointName) => {
    const numberOnlyCandidate = typeKey === "__NUMBER_ONLY__" && /^\d+$/.test(pointName);
    if (
      results.length >= limit ||
      usedTypes.has(typeKey) ||
      (!numberOnlyCandidate && !isAllowedPointNameCandidate(pointName, manualAliases))
    ) return;
    usedTypes.add(typeKey);
    results.push(pointName);
  };

  [...sheetTypes.entries()]
    .sort((left, right) => (
      right[1].count - left[1].count ||
      right[1].lastSeen - left[1].lastSeen
    ))
    .forEach(([typeKey, type]) => {
      addCandidate(typeKey, createIncrementedCandidate(type));
    });

  const excludedNormalized = normalizePointName(excludedPointName, manualAliases);
  const historyTypes = new Map();
  Object.entries(history && typeof history === "object" ? history : {}).forEach(([pointName, usage]) => {
    const parsed = parseRankedPointName(pointName, manualAliases);
    if (!parsed || usedTypes.has(parsed.typeKey)) return;
    const normalized = normalizePointName(pointName, manualAliases);
    const excludedCount = normalized === excludedNormalized ? 1 : 0;
    const count = Math.max(0, (Number(usage?.count) || 0) - excludedCount);
    if (count <= 0) return;
    const lastUsed = normalized === excludedNormalized ? 0 : Number(usage?.lastUsed) || 0;
    const current = historyTypes.get(parsed.typeKey);
    if (!current) {
      historyTypes.set(parsed.typeKey, {
        prefix: parsed.prefix,
        width: parsed.width,
        count,
        lastUsed
      });
      return;
    }
    current.count += count;
    if (lastUsed >= current.lastUsed) {
      current.lastUsed = lastUsed;
      current.prefix = parsed.prefix;
      current.width = parsed.width;
    }
  });

  [...historyTypes.entries()]
    .sort((left, right) => (
      right[1].count - left[1].count ||
      right[1].lastUsed - left[1].lastUsed
    ))
    .forEach(([typeKey, type]) => {
      addCandidate(typeKey, createIncrementedCandidate(type, true));
    });

  (Array.isArray(fallbackPointNames) ? fallbackPointNames : []).forEach((pointName) => {
    const parsed = parseRankedPointName(pointName, manualAliases);
    if (!parsed) return;
    addCandidate(parsed.typeKey, createIncrementedCandidate(parsed, true));
  });

  return results;
}

export function getNextPointNameCandidates(
  previousPointName,
  manualAliases = [],
  _history = {},
  learnedSuccessors = [],
  limit = 3
) {
  return getSheetPointNameCandidates(
    [previousPointName, ...learnedSuccessors],
    manualAliases,
    limit
  );
}

export function isPriorityPointName(pointName) {
  const normalized = normalizePointName(pointName);
  if (BASE_PRIORITY_POINT_NAMES.some((candidate) => normalizePointName(candidate) === normalized)) return true;
  return NUMBERED_PREFIXES.some((prefix) => normalized.startsWith(prefix) && /\d+$/.test(normalized));
}

export function pointNameToSpeech(pointName, manualAliases = []) {
  const text = String(pointName ?? "").normalize("NFKC").toUpperCase();
  if (!text) return "";
  const manualReadings = manualAliases
    .map((alias) => ({
      token: String(alias?.pointName ?? "").normalize("NFKC").toUpperCase(),
      reading: String(alias?.spoken ?? "").trim()
    }))
    .filter((alias) => alias.token && alias.reading)
    .sort((left, right) => right.token.length - left.token.length);
  const defaultTokens = Object.keys(DEFAULT_POINT_READINGS).sort((left, right) => right.length - left.length);
  const parts = [];
  let index = 0;
  while (index < text.length) {
    const manual = manualReadings.find((item) => text.startsWith(item.token, index));
    if (manual) {
      parts.push(manual.reading);
      index += manual.token.length;
      continue;
    }
    const standard = defaultTokens.find((token) => text.startsWith(token, index));
    if (standard) {
      parts.push(DEFAULT_POINT_READINGS[standard]);
      index += standard.length;
      continue;
    }
    const character = text[index];
    parts.push(/[0-9]/.test(character) ? DIGIT_READINGS[Number(character)] : character);
    index += 1;
  }
  return parts.filter(Boolean).join("、");
}
