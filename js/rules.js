export const MAX_STAFF_READING_METERS = 10;

export function isValidStaffReading(value) {
  return Number.isFinite(value) && value >= 0 && value < MAX_STAFF_READING_METERS;
}

export function normalizeAliasKey(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\u30a1-\u30f6]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
    .replace(/点/g, "てん")
    .replace(/[\s　、。，・]/g, "");
}

export function resolvePointAlias(transcript, aliases) {
  const key = normalizeAliasKey(transcript);
  if (!key || !Array.isArray(aliases)) return null;
  const replacements = aliases
    .map((alias) => ({
      pointName: String(alias?.pointName ?? "").trim(),
      spoken: normalizeAliasKey(alias?.spoken)
    }))
    .filter((alias) => alias.pointName && alias.spoken)
    .sort((left, right) => right.spoken.length - left.spoken.length);
  if (!replacements.length) return null;

  const numberWords = [
    ["きゅう", "9"], ["しち", "7"], ["いち", "1"], ["はち", "8"],
    ["ろく", "6"], ["なな", "7"], ["よん", "4"], ["さん", "3"],
    ["ぜろ", "0"], ["れい", "0"], ["まる", "0"], ["に", "2"],
    ["ご", "5"], ["し", "4"], ["く", "9"]
  ];
  let result = "";
  let matchedAlias = false;
  let index = 0;
  while (index < key.length) {
    const alias = replacements.find((candidate) => key.startsWith(candidate.spoken, index));
    if (alias) {
      result += alias.pointName;
      index += alias.spoken.length;
      matchedAlias = true;
      continue;
    }
    const number = numberWords.find(([spoken]) => key.startsWith(spoken, index));
    if (number) {
      result += number[1];
      index += number[0].length;
      continue;
    }
    result += key[index];
    index += 1;
  }
  return matchedAlias ? result : null;
}

export function rowHasContent(row) {
  return Boolean(
    String(row?.pointName ?? "").trim() ||
    row?.bs !== null && row?.bs !== undefined ||
    row?.fs !== null && row?.fs !== undefined ||
    row?.elevation !== null && row?.elevation !== undefined ||
    row?.distance !== null && row?.distance !== undefined ||
    String(row?.note ?? "").trim()
  );
}

export function reversePointNamesWithinUsedRows(sourceRows, targetRows) {
  let usedLength = 0;
  sourceRows.forEach((row, index) => {
    if (rowHasContent(row)) usedLength = index + 1;
  });

  targetRows.forEach((row) => {
    row.pointName = "";
  });
  for (let index = 0; index < usedLength; index += 1) {
    targetRows[index].pointName = String(sourceRows[usedLength - 1 - index]?.pointName ?? "");
  }
  return usedLength;
}
