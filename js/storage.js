const STORAGE_KEY = "levelVoiceBook.projects.v3";
const VERSION_2_KEY = "levelVoiceBook.projects.v2";
const LEGACY_KEY = "level_voice_book_v1";

export function saveProject(project) {
  const savedAt = new Date().toISOString();
  const payload = { ...project, savedAt };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function loadProject() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }

  const version2 = localStorage.getItem(VERSION_2_KEY);
  if (version2) {
    try {
      return JSON.parse(version2);
    } catch {
      return null;
    }
  }

  const legacy = localStorage.getItem(LEGACY_KEY);
  if (!legacy) return null;

  try {
    const legacyRows = JSON.parse(legacy);
    return {
      version: 2,
      meta: {},
      settings: { tolerancePreset: "grade3" },
      rows: legacyRows.map((row, index) => ({
        id: `legacy-${index}-${Date.now()}`,
        route: row.route === "back" ? "back" : "out",
        pointName: row.point || "",
        bs: valueOrNull(row.bs),
        fs: valueOrNull(row.fs),
        elevation: valueOrNull(row.elev),
        elevationType: valueOrNull(row.elev) === null ? "calculated" : "manual",
        distance: valueOrNull(row.dist),
        note: row.note || ""
      })),
      savedAt: null
    };
  } catch {
    return null;
  }
}

export function clearProject() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(VERSION_2_KEY);
  localStorage.removeItem(LEGACY_KEY);
}

function valueOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

export function formatSavedAt(isoString) {
  if (!isoString) return "未保存";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "保存日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(date);
}
