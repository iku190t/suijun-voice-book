function escapeCsv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportSheetCsv(sheet, calculatedRows) {
  const headers = ["No.", "点名", "距離", "後視 BS", "前視 FS", "往復差 mm", "高低差", "既知標高・仮標高", "備考"];
  const data = calculatedRows.map((row, index) => [
    index + 1,
    row.pointName,
    row.distance !== null ? Number(row.distance).toFixed(3) : "",
    row.bs !== null ? Number(row.bs).toFixed(3) : "",
    row.fs !== null ? Number(row.fs).toFixed(3) : "",
    Number.isFinite(row._roundTripDifferenceMm) ? Math.round(row._roundTripDifferenceMm) : "",
    Number.isFinite(row._difference) ? row._difference.toFixed(3) : "",
    row.elevation !== null ? row.elevation.toFixed(3) : "",
    row.note
  ]);
  const csv = `\uFEFF${[headers, ...data].map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
  const sheetName = sheet === "out" ? "往路" : "復路";
  const filename = `水準ボイス野帳_${sheetName}.csv`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const file = typeof File === "function"
    ? new File([blob], filename, { type: "text/csv;charset=utf-8" })
    : null;
  const shareData = file
    ? {
      files: [file],
      title: `水準ボイス野帳 ${sheetName}`,
      text: `${sheetName}シートのCSVです。`
    }
    : null;
  let supportsFileShare = Boolean(shareData && navigator.share);
  if (supportsFileShare && navigator.canShare) {
    try {
      supportsFileShare = navigator.canShare(shareData);
    } catch {
      supportsFileShare = false;
    }
  }

  if (supportsFileShare) {
    try {
      await navigator.share(shareData);
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
    }
  }

  downloadCsv(blob, filename);
  return "downloaded";
}
