export const MAX_STAFF_READING_METERS = 10;

export function isValidStaffReading(value) {
  return Number.isFinite(value) && value >= 0 && value < MAX_STAFF_READING_METERS;
}

export function normalizeAliasKey(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\s　、。，．,.・\-ー]/g, "");
}

export function resolvePointAlias(transcript, aliases) {
  const key = normalizeAliasKey(transcript);
  if (!key || !Array.isArray(aliases)) return null;
  const match = aliases.find((alias) => (
    alias?.pointName &&
    alias?.spoken &&
    normalizeAliasKey(alias.spoken) === key
  ));
  return match ? String(match.pointName).trim() : null;
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
