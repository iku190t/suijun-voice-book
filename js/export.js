import { formatRoundTripMillimeters } from "./calculation.js?v=164";

const CSV_HEADERS = [
  "No.",
  "点名",
  "距離",
  "後視",
  "前視",
  "往復差",
  "高低差",
  "標高",
  "計画高",
  "差",
  "備考"
];

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

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export function getLastExportRowIndex(rows) {
  let lastIndex = -1;
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    if (
      String(row?.pointName ?? "").trim() ||
      hasValue(row?.distance) ||
      hasValue(row?.bs) ||
      hasValue(row?.fs) ||
      hasValue(row?.elevation) ||
      hasValue(row?.planHeight) ||
      String(row?.note ?? "").trim()
    ) {
      lastIndex = index;
    }
  });
  return lastIndex;
}

function formatSignedMeters(value) {
  if (!Number.isFinite(value)) return "";
  return `${value > 0 ? "+" : ""}${value.toFixed(3)}`;
}

function rowToCsv(row, index) {
  const planDifference = Number.isFinite(row?.elevation) && Number.isFinite(row?.planHeight)
    ? row.elevation - row.planHeight
    : null;
  return [
    index + 1,
    row?.pointName ?? "",
    Number.isFinite(row?.distance) ? row.distance.toFixed(3) : "",
    Number.isFinite(row?.bs) ? row.bs.toFixed(3) : "",
    Number.isFinite(row?.fs) ? row.fs.toFixed(3) : "",
    formatRoundTripMillimeters(
      row?._roundTripDifferenceMm,
      row?._roundTripDifferenceIntermediate
    ),
    Number.isFinite(row?._difference) ? row._difference.toFixed(3) : "",
    Number.isFinite(row?.elevation) ? row.elevation.toFixed(3) : "",
    Number.isFinite(row?.planHeight) ? row.planHeight.toFixed(3) : "",
    formatSignedMeters(planDifference),
    row?.note ?? ""
  ];
}

function createSheetSection(sheetName, rows) {
  const lastIndex = getLastExportRowIndex(rows);
  const dataRows = lastIndex >= 0
    ? rows.slice(0, lastIndex + 1).map(rowToCsv)
    : [];
  return [[sheetName], CSV_HEADERS, ...dataRows];
}

export function createNotebookCsv(outRows, backRows) {
  const rows = [
    ...createSheetSection("往路", outRows),
    [],
    ...createSheetSection("復路", backRows)
  ];
  return `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
}

export function createCsvFilename(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    "水準ボイス",
    now.getFullYear(),
    "-",
    pad(now.getMonth() + 1),
    "-",
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    ".csv"
  ].join("");
}

export async function exportNotebookCsv({ outRows = [], backRows = [] } = {}) {
  const csv = createNotebookCsv(outRows, backRows);
  const filename = createCsvFilename();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const file = typeof File === "function"
    ? new File([blob], filename, { type: "text/csv;charset=utf-8" })
    : null;
  const shareData = file
    ? {
      files: [file],
      title: "水準ボイス",
      text: "往路・復路のCSVです。"
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
