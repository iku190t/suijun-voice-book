function escapeCsv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function exportNotebookCsv(project, calculatedRows) {
  const headers = ["No.", "区分", "点名", "後視 BS", "前視 FS", "高低差", "既知標高・仮標高", "距離", "備考"];
  const data = calculatedRows.map((row, index) => [
    index + 1,
    row.route === "back" ? "復路" : "往路",
    row.pointName,
    row.bs ?? "",
    row.fs ?? "",
    Number.isFinite(row._difference) ? row._difference.toFixed(3) : "",
    row.elevation !== null ? row.elevation.toFixed(3) : "",
    row.distance ?? "",
    row.note
  ]);
  const csv = `\uFEFF${[headers, ...data].map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeName = (project.meta.siteName || "水準ボイス野帳").replace(/[\\/:*?"<>|]/g, "_");
  anchor.href = url;
  anchor.download = `${safeName}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
