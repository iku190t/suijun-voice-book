function escapeCsv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function exportSheetCsv(sheet, calculatedRows) {
  const headers = ["No.", "点名", "距離", "後視 BS", "前視 FS", "高低差", "既知標高・仮標高", "備考"];
  const data = calculatedRows.map((row, index) => [
    index + 1,
    row.pointName,
    row.distance ?? "",
    row.bs ?? "",
    row.fs ?? "",
    Number.isFinite(row._difference) ? row._difference.toFixed(3) : "",
    row.elevation !== null ? row.elevation.toFixed(3) : "",
    row.note
  ]);
  const csv = `\uFEFF${[headers, ...data].map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `水準ボイス野帳_${sheet === "out" ? "往路" : "復路"}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
