import { calculateNotebook, formatMeters, toNumber } from "./calculation.js?v=5";
import { createVoiceController, normalizeSpokenNumber, prepareSpeechSynthesis, speakBack } from "./voice.js?v=5";
import { clearProject, loadProject, saveProject } from "./storage.js?v=5";
import { exportSheetCsv } from "./export.js?v=5";

const DEFAULT_ROW_COUNT = 200;
const NUMERIC_FIELDS = new Set(["bs", "fs", "elevation", "distance"]);
const UNSIGNED_DECIMAL_FIELDS = new Set(["bs", "fs", "distance"]);
const tbody = document.querySelector("#notebookBody");
const notice = document.querySelector("#notice");
const notebook = document.querySelector("#notebook");
const distanceToggleButton = document.querySelector("#distanceToggleBtn");
const voiceButton = document.querySelector("#voiceBtn");
const voiceStatus = document.querySelector("#voiceStatus");
let activeSheet = "out";
let selectedInput = null;
let voiceTarget = null;
let selectedRowIndex = null;
let autosaveTimer = null;
let calculations = { out: null, back: null };

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createRow(route) {
  return {
    id: makeId(),
    route,
    pointName: "",
    bs: null,
    fs: null,
    elevation: null,
    elevationType: "calculated",
    distance: null,
    note: ""
  };
}

function createRows(route, count = DEFAULT_ROW_COUNT) {
  return Array.from({ length: count }, () => createRow(route));
}

function createBlankProject() {
  return {
    version: 3,
    settings: { closureToleranceMm: 10, showDistance: false },
    sheets: {
      out: createRows("out"),
      back: createRows("back")
    },
    savedAt: null
  };
}

function normalizeRow(row, route) {
  return {
    ...createRow(route),
    ...row,
    id: row?.id || makeId(),
    route,
    elevationType: row?.elevationType === "manual" ? "manual" : "calculated",
    bs: toNumber(row?.bs),
    fs: toNumber(row?.fs),
    elevation: toNumber(row?.elevation),
    distance: toNumber(row?.distance)
  };
}

function normalizeLoadedProject(loaded) {
  const blank = createBlankProject();
  if (!loaded) return blank;

  let outRows = [];
  let backRows = [];
  if (loaded.sheets) {
    outRows = Array.isArray(loaded.sheets.out) ? loaded.sheets.out : [];
    backRows = Array.isArray(loaded.sheets.back) ? loaded.sheets.back : [];
  } else if (Array.isArray(loaded.rows)) {
    outRows = loaded.rows.filter((row) => row.route !== "back");
    backRows = loaded.rows.filter((row) => row.route === "back");
  }

  outRows = outRows.map((row) => normalizeRow(row, "out"));
  backRows = backRows.map((row) => normalizeRow(row, "back"));
  while (outRows.length < DEFAULT_ROW_COUNT) outRows.push(createRow("out"));
  while (backRows.length < DEFAULT_ROW_COUNT) backRows.push(createRow("back"));

  return {
    version: 3,
    settings: { ...blank.settings, ...(loaded.settings || {}) },
    sheets: { out: outRows, back: backRows },
    savedAt: loaded.savedAt || null
  };
}

let project = normalizeLoadedProject(loadProject());

function displayValue(value, digits = null) {
  if (value === null || value === undefined) return "";
  return digits === null ? String(value) : Number(value).toFixed(digits);
}

function rowTemplate(row, index) {
  const tr = document.createElement("tr");
  tr.dataset.rowId = row.id;
  tr.innerHTML = `
    <td class="row-number"><button class="row-selector" type="button" aria-label="${index + 1}行目の操作">${index + 1}</button></td>
    <td><input data-field="pointName" inputmode="text" autocomplete="off" aria-label="${index + 1}行目 点名"></td>
    <td class="distance-column"><input data-field="distance" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*" autocomplete="off" spellcheck="false" aria-label="${index + 1}行目 距離"></td>
    <td><input data-field="bs" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*" autocomplete="off" spellcheck="false" aria-label="${index + 1}行目 後視 BS"></td>
    <td><input data-field="fs" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*" autocomplete="off" spellcheck="false" aria-label="${index + 1}行目 前視 FS"></td>
    <td class="calc diff"></td>
    <td class="elevation-cell calculated"><input data-field="elevation" inputmode="decimal" autocomplete="off" aria-label="${index + 1}行目 既知標高または仮標高"></td>
    <td><input data-field="note" inputmode="text" autocomplete="off" aria-label="${index + 1}行目 備考"></td>`;
  tr.querySelector('[data-field="pointName"]').value = row.pointName || "";
  tr.querySelector('[data-field="bs"]').value = displayValue(row.bs);
  tr.querySelector('[data-field="fs"]').value = displayValue(row.fs);
  tr.querySelector('[data-field="elevation"]').value = displayValue(row.elevation, row.elevation !== null ? 3 : null);
  tr.querySelector('[data-field="distance"]').value = displayValue(row.distance);
  tr.querySelector('[data-field="note"]').value = row.note || "";
  return tr;
}

function renderSheet() {
  selectedInput = null;
  voiceTarget = null;
  selectedRowIndex = null;
  const fragment = document.createDocumentFragment();
  project.sheets[activeSheet].forEach((row, index) => fragment.appendChild(rowTemplate(row, index)));
  tbody.replaceChildren(fragment);
  document.querySelector("#activeSheetName").textContent = activeSheet === "out" ? "往路シート" : "復路シート";
  document.querySelector("#rowCount").textContent = `${project.sheets[activeSheet].length}行`;
  document.querySelectorAll(".sheet-tab").forEach((button) => {
    const active = button.dataset.sheet === activeSheet;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  applyDistanceVisibility();
  recalculateAndRender();
}

function applyDistanceVisibility() {
  const visible = Boolean(project.settings.showDistance);
  notebook.classList.toggle("show-distance", visible);
  distanceToggleButton.textContent = visible ? "－ 距離" : "＋ 距離";
  distanceToggleButton.setAttribute("aria-pressed", String(visible));
}

function recalculateAndRender() {
  calculations.out = calculateNotebook(project.sheets.out, project.settings.closureToleranceMm);
  calculations.back = calculateNotebook(project.sheets.back, project.settings.closureToleranceMm);
  project.sheets.out = stripCalculatedFields(calculations.out.rows);
  project.sheets.back = stripCalculatedFields(calculations.back.rows);

  const activeCalculation = calculations[activeSheet];
  [...tbody.rows].forEach((tr, index) => {
    const row = activeCalculation.rows[index];
    if (!row) return;
    tr.classList.toggle("incomplete", row._incomplete);
    tr.querySelector(".diff").textContent = row._incomplete
      ? "BS/FS確認"
      : Number.isFinite(row._difference) ? row._difference.toFixed(3) : "";
    const elevationInput = tr.querySelector('[data-field="elevation"]');
    if (document.activeElement !== elevationInput || row.elevationType === "calculated") {
      elevationInput.value = displayValue(row.elevation, row.elevation !== null ? 3 : null);
    }
    const cell = elevationInput.closest(".elevation-cell");
    cell.classList.toggle("manual", row.elevationType === "manual" && row.elevation !== null);
    cell.classList.toggle("calculated", row.elevationType !== "manual" || row.elevation === null);
  });

  const outDifference = calculations.out.outDifference;
  const backDifference = calculations.back.backDifference;
  document.querySelector("#outDiff").textContent = formatMeters(outDifference);
  document.querySelector("#backDiff").textContent = formatMeters(backDifference);
  updateClosure(outDifference, backDifference);
}

function stripCalculatedFields(rows) {
  return rows.map(({ _complete, _incomplete, _difference, ...row }) => row);
}

function updateClosure(outDifference, backDifference) {
  const card = document.querySelector("#closureCard");
  const value = document.querySelector("#closure");
  const judgement = document.querySelector("#closureJudgement");
  card.classList.remove("pass", "fail", "pending");
  if (outDifference === null || backDifference === null) {
    value.textContent = "—";
    judgement.textContent = "判定待ち";
    card.classList.add("pending");
    return;
  }
  const closureMm = Math.abs((outDifference + backDifference) * 1000);
  const passed = closureMm <= project.settings.closureToleranceMm;
  value.textContent = `${closureMm.toFixed(1)} mm`;
  judgement.textContent = passed ? "合格" : "要確認";
  card.classList.add(passed ? "pass" : "fail");
}

function findRowIndex(element) {
  const id = element.closest("tr")?.dataset.rowId;
  return project.sheets[activeSheet].findIndex((row) => row.id === id);
}

function parseInputValue(input) {
  if (!NUMERIC_FIELDS.has(input.dataset.field)) return input.value;
  if (input.value.trim() === "") return null;
  return toNumber(input.value);
}

function sanitizeUnsignedDecimal(value) {
  const normalized = String(value ?? "").normalize("NFKC").replace(/[，,、。]/g, ".");
  const digitsAndDots = normalized.replace(/[^0-9.]/g, "");
  const dotIndex = digitsAndDots.indexOf(".");
  if (dotIndex < 0) return digitsAndDots;
  return `${digitsAndDots.slice(0, dotIndex + 1)}${digitsAndDots.slice(dotIndex + 1).replace(/\./g, "")}`;
}

function handleFieldChange(input) {
  const index = findRowIndex(input);
  if (index < 0) return false;
  const field = input.dataset.field;
  const parsed = parseInputValue(input);
  if (NUMERIC_FIELDS.has(field) && input.value.trim() !== "" && parsed === null) {
    showNotice(`${index + 1}行目の値は数値で入力してください。`, "error");
    input.setAttribute("aria-invalid", "true");
    return false;
  }
  input.removeAttribute("aria-invalid");
  project.sheets[activeSheet][index][field] = parsed;
  if (field === "elevation") {
    project.sheets[activeSheet][index].elevationType = parsed === null ? "calculated" : "manual";
  }
  recalculateAndRender();
  scheduleAutosave();
  return true;
}

function markSelectedInput(input) {
  tbody.querySelectorAll(".voice-selected").forEach((element) => element.classList.remove("voice-selected"));
  selectedInput = input;
  input?.classList.add("voice-selected");
}

function moveStraightDown(current, focusTarget = true) {
  const field = current.dataset.field;
  const rowIndex = findRowIndex(current);
  if (!field || rowIndex < 0) return;
  if (rowIndex === project.sheets[activeSheet].length - 1) {
    project.sheets[activeSheet].push(createRow(activeSheet));
    renderSheet();
  }
  const target = tbody.rows[rowIndex + 1]?.querySelector(`[data-field="${field}"]`);
  if (!target) return;
  markSelectedInput(target);
  if (focusTarget) {
    target.focus({ preventScroll: false });
  } else {
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

tbody.addEventListener("focusin", (event) => {
  if (!event.target.matches("input")) return;
  markSelectedInput(event.target);
});

tbody.addEventListener("input", (event) => {
  if (!event.target.matches("input")) return;
  if (UNSIGNED_DECIMAL_FIELDS.has(event.target.dataset.field)) {
    const sanitized = sanitizeUnsignedDecimal(event.target.value);
    if (event.target.value !== sanitized) event.target.value = sanitized;
  }
  handleFieldChange(event.target);
});

tbody.addEventListener("click", (event) => {
  const selector = event.target.closest(".row-selector");
  if (!selector) return;
  selectedRowIndex = findRowIndex(selector);
  if (selectedRowIndex < 0) return;
  tbody.querySelectorAll("tr.row-selected").forEach((row) => row.classList.remove("row-selected"));
  selector.closest("tr").classList.add("row-selected");
  document.querySelector("#rowDialogTitle").textContent = `${selectedRowIndex + 1}行目の操作`;
  document.querySelector("#rowDialog").showModal();
});

tbody.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !event.target.matches("input")) return;
  event.preventDefault();
  if (handleFieldChange(event.target)) moveStraightDown(event.target);
});

function showNotice(message, type = "") {
  notice.textContent = message;
  notice.className = `notice ${type}`.trim();
  notice.hidden = false;
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => { notice.hidden = true; }, 3800);
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { project = saveProject(project); }, 700);
}

document.querySelectorAll(".sheet-tab").forEach((button) => {
  button.addEventListener("click", () => {
    activeSheet = button.dataset.sheet;
    renderSheet();
  });
});

document.querySelector("#closureTolerance").value = project.settings.closureToleranceMm;
document.querySelector("#closureTolerance").addEventListener("input", (event) => {
  const value = Number(event.target.value);
  project.settings.closureToleranceMm = Number.isFinite(value) && value >= 0 ? value : 10;
  recalculateAndRender();
  scheduleAutosave();
});

const rowDialog = document.querySelector("#rowDialog");
document.querySelector("#insertRowBtn").addEventListener("click", () => {
  if (selectedRowIndex === null) return;
  const rows = project.sheets[activeSheet];
  rows.splice(selectedRowIndex + 1, 0, createRow(activeSheet));
  rowDialog.close();
  renderSheet();
  scheduleAutosave();
});
document.querySelector("#deleteSelectedRowBtn").addEventListener("click", () => {
  if (selectedRowIndex === null) return;
  const rows = project.sheets[activeSheet];
  if (rows.length <= 1) {
    showNotice("最後の1行は削除できません。", "error");
    return;
  }
  if (!confirm(`${selectedRowIndex + 1}行目を削除しますか？`)) return;
  rows.splice(selectedRowIndex, 1);
  rowDialog.close();
  renderSheet();
  scheduleAutosave();
});
distanceToggleButton.addEventListener("click", () => {
  project.settings.showDistance = !project.settings.showDistance;
  applyDistanceVisibility();
  scheduleAutosave();
});
document.querySelector("#saveBtn").addEventListener("click", () => {
  project = saveProject(project);
  showNotice("上書き保存しました。", "success");
});
document.querySelector("#csvBtn").addEventListener("click", () => {
  exportSheetCsv(activeSheet, calculations[activeSheet].rows);
  showNotice(`${activeSheet === "out" ? "往路" : "復路"}シートをCSV出力しました。`, "success");
});
const clearDialog = document.querySelector("#clearDialog");
document.querySelector("#clearBtn").addEventListener("click", () => clearDialog.showModal());
clearDialog.querySelectorAll("[data-clear-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.clearTarget;
    const targetLabel = target === "out" ? "往路シート" : target === "back" ? "復路シート" : "全シート";
    if (!confirm(`${targetLabel}のデータを消去しますか？この操作は元に戻せません。`)) return;

    if (target === "all") {
      const settings = { ...project.settings };
      clearProject();
      project = createBlankProject();
      project.settings = settings;
    } else {
      project.sheets[target] = createRows(target);
    }
    clearDialog.close();
    renderSheet();
    project = saveProject(project);
    showNotice(`${targetLabel}を消去しました。`, "success");
  });
});

const supportDialog = document.querySelector("#supportDialog");
document.querySelector("#supportOpenBtn").addEventListener("click", () => supportDialog.showModal());

const voiceController = createVoiceController({
  onStatus: (message) => { voiceStatus.textContent = message; },
  onListeningChange: (listening) => {
    voiceButton.classList.toggle("listening", listening);
    voiceButton.textContent = listening ? "● 認識中…" : "🎤 音声入力";
    if (!listening && voiceTarget) voiceTarget.readOnly = false;
  },
  onResult: async (transcript) => {
    const target = voiceTarget;
    if (!target?.isConnected) return;
    const field = target.dataset.field;
    let value = NUMERIC_FIELDS.has(field) ? normalizeSpokenNumber(transcript) : transcript.trim();
    if (UNSIGNED_DECIMAL_FIELDS.has(field)) value = sanitizeUnsignedDecimal(value);
    target.value = value;
    if (!handleFieldChange(target)) return;
    voiceStatus.textContent = `${value} と復唱します`;
    await speakBack(value);
    moveStraightDown(target, false);
    voiceTarget = null;
    voiceStatus.textContent = "";
  }
});

if (!voiceController.supported) {
  voiceButton.disabled = true;
  voiceButton.title = "音声入力非対応";
}

voiceButton.addEventListener("click", () => {
  if (!selectedInput?.isConnected) {
    showNotice("先に入力セルを選択してください。", "error");
    return;
  }
  prepareSpeechSynthesis();
  voiceTarget = selectedInput;
  voiceTarget.readOnly = true;
  document.activeElement?.blur();
  voiceController.start();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

window.addEventListener("pagehide", () => {
  clearTimeout(autosaveTimer);
  project = saveProject(project);
});

renderSheet();
