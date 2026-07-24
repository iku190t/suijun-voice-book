import {
  applyRoundTripDifferences,
  calculateNotebook,
  calculateToleranceMm,
  formatMeters,
  LEVELING_TOLERANCE_PRESETS,
  sumObservationDistanceMeters,
  toNumber
} from "./calculation.js?v=65";
import {
  chooseLevelReading,
  createVoiceController,
  levelReadingToSpeech,
  normalizeSpokenNumber,
  prepareSpeechSynthesis,
  speakBack
} from "./voice.js?v=65";
import { clearProject, loadProject, saveProject } from "./storage.js?v=65";
import { exportSheetCsv } from "./export.js?v=65";
import {
  isValidStaffReading,
  reversePointNamesWithinUsedRows
} from "./rules.js?v=65";
import {
  choosePointName,
  getRankedPointNameCandidates,
  incrementPointNameOrCopy,
  normalizePointName,
  pointNameToSpeech,
  recordPointNameUsage
} from "./point-names.js?v=65";

const DEFAULT_ROW_COUNT = 200;
const POINT_SUGGESTION_LIMIT = 10;
const POINT_SUGGESTION_SEEDS = ["NO.0", "TP0", "KBM0", "T-0", "BC.0", "SP.0"];
const NUMERIC_FIELDS = new Set(["bs", "fs", "elevation", "distance"]);
const UNSIGNED_DECIMAL_FIELDS = new Set(["bs", "fs", "distance"]);
const tbody = document.querySelector("#notebookBody");
const notice = document.querySelector("#notice");
const notebook = document.querySelector("#notebook");
const tableWrap = document.querySelector(".table-wrap");
const distanceToggleButton = document.querySelector("#distanceToggleBtn");
const tolerancePresetSelect = document.querySelector("#tolerancePreset");
const voiceButton = document.querySelector("#voiceBtn");
const keyboardModeButton = document.querySelector("#keyboardModeBtn");
const voiceStatus = document.querySelector("#voiceStatus");
const voiceDock = document.querySelector(".voice-dock");
const pointScriptControls = document.querySelector("#pointScriptControls");
const pointSuggestions = document.querySelector("#pointSuggestions");
const pointSuggestionButtons = document.querySelector("#pointSuggestionButtons");
const pointClipboardPopover = document.querySelector("#pointClipboardPopover");
const pointCopyButton = document.querySelector("#pointCopyBtn");
const pointPasteButton = document.querySelector("#pointPasteBtn");
const cellDeleteButton = document.querySelector("#cellDeleteBtn");
const undoButton = document.querySelector("#undoBtn");
const redoButton = document.querySelector("#redoBtn");
const sheetToggleButton = document.querySelector("#sheetToggleBtn");
let activeSheet = "out";
let selectedInput = null;
let voiceTarget = null;
let voiceModeActive = false;
let voiceSessionActive = false;
let selectedRowIndex = null;
let autosaveTimer = null;
let calculations = { out: null, back: null };
let pinchStartDistance = null;
let pinchStartScale = 1;
let longPressTimer = null;
let longPressInput = null;
let longPressPointerId = null;
let longPressStartX = 0;
let longPressStartY = 0;
let pointerTapInput = null;
let pointerTapId = null;
let pointerTapStartX = 0;
let pointerTapStartY = 0;
let pointerTapMoved = false;
let suppressNextCellClick = false;
let cellDeleteTarget = null;
let voiceSessionToken = 0;
let suggestionLongPressTimer = null;
let suggestionLongPressStartX = 0;
let suggestionLongPressStartY = 0;
let suggestionLongPressTriggered = false;
let suggestionGestureMoved = false;
let suggestionEditInput = null;
let suggestionEditFocusPending = false;
let suggestionPositionFrame = null;
let cachedSuggestionPanelHeight = 0;
let cachedSuggestionEditing = null;
let lastNormalSuggestionY = Number.NaN;
let lastNormalSuggestionMaxHeight = Number.NaN;
let lastVoiceSuggestionShift = Number.NaN;
let suggestionPositionCorrectionPending = false;
let pointNameClipboard = "";
let pointClipboardPositionFrame = null;
let pointClipboardDismissedFor = null;
let keyboardViewportBaseline = window.visualViewport?.height || window.innerHeight;
const HISTORY_LIMIT = 50;
const undoHistory = { out: [], back: [] };
const redoHistory = { out: [], back: [] };
let historyGroupKey = "";
let historyGroupAt = 0;

function projectSnapshot() {
  return JSON.stringify(project);
}

function updateHistoryButtons() {
  undoButton.disabled = undoHistory[activeSheet].length === 0;
  redoButton.disabled = redoHistory[activeSheet].length === 0;
}

function endHistoryGroup() {
  historyGroupKey = "";
  historyGroupAt = 0;
}

function recordUndoSnapshot(sheet = activeSheet, groupKey = "", force = false) {
  const now = Date.now();
  const fullKey = `${sheet}:${groupKey}`;
  if (!force && groupKey && historyGroupKey === fullKey && now - historyGroupAt < 1500) {
    historyGroupAt = now;
    return;
  }
  const snapshot = projectSnapshot();
  const stack = undoHistory[sheet];
  if (stack.at(-1) !== snapshot) {
    stack.push(snapshot);
    if (stack.length > HISTORY_LIMIT) stack.shift();
  }
  redoHistory[sheet] = [];
  historyGroupKey = fullKey;
  historyGroupAt = now;
  updateHistoryButtons();
}

function restoreProjectSnapshot(snapshot) {
  project = normalizeLoadedProject(JSON.parse(snapshot));
  project.settings.voiceRate = clamp(Number(project.settings.voiceRate) || 0.9, 0.5, 1.5);
  project.settings.tableScale = clamp(Number(project.settings.tableScale) || 1, 0.5, 1.8);
  endHistoryGroup();
  renderSheet();
  project = saveProject(project);
}

function undoCurrentSheet() {
  const stack = undoHistory[activeSheet];
  if (!stack.length) return;
  const snapshot = stack.pop();
  redoHistory[activeSheet].push(projectSnapshot());
  if (redoHistory[activeSheet].length > HISTORY_LIMIT) redoHistory[activeSheet].shift();
  restoreProjectSnapshot(snapshot);
  updateHistoryButtons();
}

function redoCurrentSheet() {
  const stack = redoHistory[activeSheet];
  if (!stack.length) return;
  const snapshot = stack.pop();
  undoHistory[activeSheet].push(projectSnapshot());
  if (undoHistory[activeSheet].length > HISTORY_LIMIT) undoHistory[activeSheet].shift();
  restoreProjectSnapshot(snapshot);
  updateHistoryButtons();
}

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
    version: 5,
    settings: {
      tolerancePreset: "grade3",
      showDistance: false,
      voiceRate: 0.9,
      tableScale: 1,
      pointAliases: [],
      pointNameScripts: {
        kanji: true,
        hiragana: false,
        katakana: false
      },
      pointNameHistory: {}
    },
    sheets: {
      out: createRows("out"),
      back: createRows("back")
    },
    savedAt: null
  };
}

function normalizeRow(row, route) {
  const bs = toNumber(row?.bs);
  const fs = toNumber(row?.fs);
  return {
    ...createRow(route),
    ...row,
    id: row?.id || makeId(),
    route,
    pointName: normalizePointName(String(row?.pointName ?? "")),
    elevationType: row?.elevationType === "manual" ? "manual" : "calculated",
    bs: bs === null || isValidStaffReading(bs) ? bs : null,
    fs: fs === null || isValidStaffReading(fs) ? fs : null,
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
  const rowCount = Math.max(DEFAULT_ROW_COUNT, outRows.length, backRows.length);
  while (outRows.length < rowCount) outRows.push(createRow("out"));
  while (backRows.length < rowCount) backRows.push(createRow("back"));

  const loadedAliases = Array.isArray(loaded.settings?.pointAliases)
    ? loaded.settings.pointAliases
      .map((alias) => ({
        pointName: String(alias?.pointName ?? "").normalize("NFKC").trim().toUpperCase(),
        spoken: String(alias?.spoken ?? "").trim()
      }))
      .filter((alias) => alias.pointName && alias.spoken)
    : [];
  const loadedHistory = loaded.settings?.pointNameHistory && typeof loaded.settings.pointNameHistory === "object"
    ? loaded.settings.pointNameHistory
    : {};
  const loadedScripts = loaded.settings?.pointNameScripts && typeof loaded.settings.pointNameScripts === "object"
    ? loaded.settings.pointNameScripts
    : {};

  return {
    version: 5,
    settings: {
      ...blank.settings,
      ...(loaded.settings || {}),
      pointAliases: loadedAliases,
      pointNameScripts: {
        kanji: loadedScripts.kanji !== false,
        hiragana: loadedScripts.hiragana === true,
        katakana: loadedScripts.katakana === true
      },
      pointNameHistory: loadedHistory
    },
    sheets: { out: outRows, back: backRows },
    savedAt: loaded.savedAt || null
  };
}

let project = normalizeLoadedProject(loadProject());
project.settings.voiceRate = clamp(Number(project.settings.voiceRate) || 0.9, 0.5, 1.5);
project.settings.tableScale = clamp(Number(project.settings.tableScale) || 1, 0.5, 1.8);
if (!LEVELING_TOLERANCE_PRESETS[project.settings.tolerancePreset]) {
  project.settings.tolerancePreset = "grade3";
}

function synchronizeRowCounts() {
  const rowCount = Math.max(DEFAULT_ROW_COUNT, project.sheets.out.length, project.sheets.back.length);
  while (project.sheets.out.length < rowCount) project.sheets.out.push(createRow("out"));
  while (project.sheets.back.length < rowCount) project.sheets.back.push(createRow("back"));
}

function synchronizePointNames(sourceSheet, targetSheet) {
  synchronizeRowCounts();
  return reversePointNamesWithinUsedRows(project.sheets[sourceSheet], project.sheets[targetSheet]);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

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
    <td class="calc round-trip-diff"></td>
    <td class="calc diff"></td>
    <td class="elevation-cell calculated"><input data-field="elevation" inputmode="decimal" autocomplete="off" aria-label="${index + 1}行目 既知標高または仮標高"></td>
    <td><input data-field="note" inputmode="text" autocomplete="off" aria-label="${index + 1}行目 備考"></td>`;
  tr.querySelector('[data-field="pointName"]').value = row.pointName || "";
  tr.querySelector('[data-field="bs"]').value = displayValue(row.bs, row.bs !== null ? 3 : null);
  tr.querySelector('[data-field="fs"]').value = displayValue(row.fs, row.fs !== null ? 3 : null);
  tr.querySelector('[data-field="elevation"]').value = displayValue(row.elevation, row.elevation !== null ? 3 : null);
  tr.querySelector('[data-field="distance"]').value = displayValue(row.distance, row.distance !== null ? 3 : null);
  tr.querySelector('[data-field="note"]').value = row.note || "";
  return tr;
}

function renderSheet() {
  selectedInput = null;
  pointClipboardDismissedFor = null;
  voiceTarget = null;
  selectedRowIndex = null;
  document.body.append(pointClipboardPopover);
  tbody.querySelectorAll(".point-clipboard-anchor").forEach((cell) => {
    cell.classList.remove("point-clipboard-anchor");
  });
  hidePointSuggestions();
  hideCellDeleteButton();
  const fragment = document.createDocumentFragment();
  project.sheets[activeSheet].forEach((row, index) => fragment.appendChild(rowTemplate(row, index)));
  tbody.replaceChildren(fragment);
  syncVoiceInputLocks();
  const destinationName = activeSheet === "out" ? "復路" : "往路";
  sheetToggleButton.textContent = destinationName;
  sheetToggleButton.setAttribute("aria-label", `${destinationName}に切り替え`);
  applyDistanceVisibility();
  applyTableScale(project.settings.tableScale);
  recalculateAndRender();
  updateHistoryButtons();
  updatePointClipboardButtons();
}

function applyDistanceVisibility() {
  const visible = Boolean(project.settings.showDistance);
  notebook.classList.toggle("show-distance", visible);
  distanceToggleButton.textContent = visible ? "－" : "＋";
  distanceToggleButton.setAttribute("aria-label", visible ? "距離列を収納" : "距離列を表示");
  distanceToggleButton.setAttribute("aria-pressed", String(visible));
}

function applyTableScale(value) {
  const scale = clamp(Number(value) || 1, 0.5, 1.8);
  project.settings.tableScale = scale;
  const pixels = {
    "--table-min-width": 894,
    "--row-height": 48,
    "--input-height": 47,
    "--number-width": 42,
    "--point-width": 116,
    "--distance-width": 94,
    "--reading-width": 96,
    "--difference-width": 100,
    "--round-trip-width": 104,
    "--elevation-width": 134,
    "--note-width": 180,
    "--input-font-size": 16,
    "--header-font-size": 16
  };
  Object.entries(pixels).forEach(([property, base]) => {
    notebook.style.setProperty(property, `${Math.round(base * scale * 10) / 10}px`);
  });
}

function touchDistance(touches) {
  const horizontal = touches[0].clientX - touches[1].clientX;
  const vertical = touches[0].clientY - touches[1].clientY;
  return Math.hypot(horizontal, vertical);
}

tableWrap.addEventListener("touchstart", (event) => {
  if (event.touches.length !== 2) return;
  event.preventDefault();
  pinchStartDistance = touchDistance(event.touches);
  pinchStartScale = project.settings.tableScale;
  tableWrap.classList.add("pinching");
}, { passive: false });

tableWrap.addEventListener("touchmove", (event) => {
  if (event.touches.length !== 2 || !pinchStartDistance) return;
  event.preventDefault();
  const nextScale = pinchStartScale * (touchDistance(event.touches) / pinchStartDistance);
  applyTableScale(nextScale);
}, { passive: false });

tableWrap.addEventListener("touchend", (event) => {
  if (event.touches.length >= 2) return;
  if (pinchStartDistance) {
    pinchStartDistance = null;
    tableWrap.classList.remove("pinching");
    scheduleAutosave();
  }
}, { passive: true });

tableWrap.addEventListener("touchcancel", () => {
  pinchStartDistance = null;
  tableWrap.classList.remove("pinching");
}, { passive: true });

function recalculateAndRender() {
  const toleranceState = getToleranceState();
  calculations.out = calculateNotebook(project.sheets.out, toleranceState.toleranceMm ?? 10);
  calculations.back = calculateNotebook(project.sheets.back, toleranceState.toleranceMm ?? 10, {
    direction: "up",
    initialElevation: calculations.out.startElevation ?? 0
  });
  applyRoundTripDifferences(calculations.out.rows, calculations.back.rows);
  project.sheets.out = stripCalculatedFields(calculations.out.rows);
  project.sheets.back = stripCalculatedFields(calculations.back.rows);

  const activeCalculation = calculations[activeSheet];
  [...tbody.rows].forEach((tr, index) => {
    const row = activeCalculation.rows[index];
    if (!row) return;
    tr.classList.toggle("incomplete", row._incomplete);
    tr.querySelector(".diff").textContent = Number.isFinite(row._difference)
      ? row._difference.toFixed(3)
      : "";
    tr.querySelector(".round-trip-diff").textContent = Number.isFinite(row._roundTripDifferenceMm)
      ? String(Math.round(row._roundTripDifferenceMm))
      : "";
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
  updateToleranceDisplay(toleranceState);
  updateClosure(outDifference, backDifference, toleranceState.toleranceMm);
}

function stripCalculatedFields(rows) {
  return rows.map(({ _complete, _incomplete, _difference, _roundTripDifferenceMm, ...row }) => row);
}

function getToleranceState() {
  const presetKey = project.settings.tolerancePreset;
  const preset = LEVELING_TOLERANCE_PRESETS[presetKey] || LEVELING_TOLERANCE_PRESETS.grade3;
  const outDistanceMeters = sumObservationDistanceMeters(project.sheets.out);
  const backDistanceMeters = sumObservationDistanceMeters(project.sheets.back);
  const distanceMeters = outDistanceMeters > 0 ? outDistanceMeters : backDistanceMeters;
  return {
    presetKey,
    preset,
    distanceMeters,
    toleranceMm: calculateToleranceMm(presetKey, distanceMeters)
  };
}

function updateToleranceDisplay(toleranceState) {
  tolerancePresetSelect.value = toleranceState.presetKey;
  document.querySelector("#toleranceFormula").textContent = `${toleranceState.preset.coefficient}mm√S`;
  document.querySelector("#calculatedTolerance").textContent = toleranceState.toleranceMm === null
    ? "距離待ち"
    : `許容 ${toleranceState.toleranceMm.toFixed(1)}mm`;
}

function updateClosure(outDifference, backDifference, toleranceMm) {
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
  value.textContent = `${closureMm.toFixed(1)} mm`;
  if (toleranceMm === null) {
    judgement.textContent = "距離待ち";
    card.classList.add("pending");
    return;
  }
  const passed = closureMm <= toleranceMm;
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

function formatNumericInput(input) {
  if (!input?.matches("input") || !NUMERIC_FIELDS.has(input.dataset.field)) return;
  const index = findRowIndex(input);
  if (index < 0) return;
  const value = project.sheets[activeSheet][index][input.dataset.field];
  input.value = displayValue(value, value !== null ? 3 : null);
}

function handleFieldChange(input, { recordHistory = true, forceHistory = false } = {}) {
  const index = findRowIndex(input);
  if (index < 0) return false;
  const field = input.dataset.field;
  let parsed = parseInputValue(input);
  if (NUMERIC_FIELDS.has(field) && input.value.trim() !== "" && parsed === null) {
    showNotice(`${index + 1}行目の値は数値で入力してください。`, "error");
    input.setAttribute("aria-invalid", "true");
    return false;
  }
  if ((field === "bs" || field === "fs") && parsed !== null && !isValidStaffReading(parsed)) {
    showNotice("BS・FSは0m以上、10m未満で入力してください。", "error");
    const previousValue = project.sheets[activeSheet][index][field];
    input.value = displayValue(previousValue, previousValue !== null ? 3 : null);
    input.setAttribute("aria-invalid", "true");
    return false;
  }
  if (field === "pointName" && parsed) {
    const normalizedPointName = normalizePointName(parsed, project.settings.pointAliases);
    if (normalizedPointName) {
      parsed = normalizedPointName;
      input.value = normalizedPointName;
    }
  }
  input.removeAttribute("aria-invalid");
  if (recordHistory) {
    recordUndoSnapshot(
      activeSheet,
      `cell:${project.sheets[activeSheet][index].id}:${field}`,
      forceHistory
    );
  }
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
  if (input !== pointClipboardDismissedFor) pointClipboardDismissedFor = null;
  selectedInput = input;
  input?.classList.add("voice-selected");
  updatePointClipboardButtons();
}

function updatePointClipboardButtons() {
  const pointSelected = Boolean(
    !voiceModeActive &&
    !voiceSessionActive &&
    selectedInput?.isConnected &&
    selectedInput.dataset.field === "pointName"
  );
  const popoverAllowed = pointSelected && selectedInput !== pointClipboardDismissedFor;
  pointClipboardPopover.hidden = !popoverAllowed;
  pointCopyButton.disabled = !pointSelected || !selectedInput.value.trim();
  pointPasteButton.disabled = !pointSelected || !pointNameClipboard;
  pointPasteButton.hidden = !pointNameClipboard;
  pointPasteButton.textContent = pointNameClipboard;
  if (popoverAllowed) {
    const targetCell = selectedInput.closest("td");
    tbody.querySelectorAll(".point-clipboard-anchor").forEach((cell) => {
      if (cell !== targetCell) cell.classList.remove("point-clipboard-anchor");
    });
    targetCell.classList.add("point-clipboard-anchor");
    if (pointClipboardPopover.parentElement !== targetCell) {
      targetCell.append(pointClipboardPopover);
    }
    pointClipboardPopover.style.visibility = "visible";
    schedulePointClipboardPosition();
  } else {
    pointClipboardPopover.parentElement?.classList.remove("point-clipboard-anchor");
  }
}

function positionPointClipboardPopover() {
  if (
    pointClipboardPopover.hidden ||
    !selectedInput?.isConnected ||
    selectedInput.dataset.field !== "pointName"
  ) return;
  const targetRect = selectedInput.getBoundingClientRect();
  const popoverRect = pointClipboardPopover.getBoundingClientRect();
  const tableRect = tableWrap.getBoundingClientRect();
  const viewport = window.visualViewport;
  const visibleLeft = viewport ? viewport.offsetLeft : 0;
  const visibleRight = visibleLeft + (viewport ? viewport.width : window.innerWidth);
  const gap = 4;
  const rightBoundary = Math.min(visibleRight, tableRect.right);
  const placeLeft = targetRect.right + gap + popoverRect.width > rightBoundary;
  pointClipboardPopover.classList.toggle("place-left", placeLeft);
}

function schedulePointClipboardPosition() {
  if (pointClipboardPositionFrame !== null) return;
  pointClipboardPositionFrame = requestAnimationFrame(() => {
    pointClipboardPositionFrame = null;
    positionPointClipboardPopover();
  });
}

function syncVoiceInputLocks() {
  const locked = voiceModeActive || voiceSessionActive;
  tbody.querySelectorAll("input").forEach((input) => {
    input.readOnly = locked;
  });
  if (locked) document.activeElement?.blur();
}

function updateVoiceModeUi() {
  document.body.classList.toggle("voice-mode-active", voiceModeActive);
  voiceButton.classList.toggle("voice-mode", voiceModeActive);
  keyboardModeButton.hidden = !voiceModeActive;
  keyboardModeButton.disabled = voiceSessionActive;
  if (!voiceSessionActive) {
    voiceButton.classList.remove("listening");
    voiceButton.textContent = voiceModeActive ? "🎤 聞き取る" : "🎤 音声モード";
  }
}

function setVoiceModeActive(active) {
  voiceModeActive = Boolean(active);
  if (!voiceModeActive) voiceTarget = null;
  if (!voiceModeActive) hideCellDeleteButton();
  syncVoiceInputLocks();
  updateVoiceModeUi();
  updatePointClipboardButtons();
  hidePointSuggestions();
}

function setVoiceSessionActive(active) {
  voiceSessionActive = Boolean(active);
  if (voiceSessionActive) hideCellDeleteButton();
  document.body.classList.toggle("voice-session-active", voiceSessionActive);
  syncVoiceInputLocks();
  updateVoiceModeUi();
  updatePointClipboardButtons();
}

function finishVoiceSession() {
  setVoiceSessionActive(false);
  voiceTarget = null;
  voiceStatus.textContent = "";
  if (selectedInput?.isConnected && selectedInput.dataset.field === "pointName") {
    showPointNameSuggestions(selectedInput);
  }
}

function selectVoiceTargetWithoutKeyboard(input) {
  if ((!voiceModeActive && !voiceSessionActive) || !input?.matches("input")) return;
  voiceTarget = input;
  markSelectedInput(input);
  input.blur();
  if (!voiceSessionActive && input.dataset.field === "pointName") {
    showPointNameSuggestions(input);
  } else {
    hidePointSuggestions();
  }
}

function hidePointSuggestions() {
  cancelSuggestionLongPress();
  suggestionLongPressTriggered = false;
  suggestionEditInput = null;
  suggestionEditFocusPending = false;
  pointSuggestions.hidden = true;
  pointSuggestionButtons.replaceChildren();
  document.body.classList.remove("point-suggestions-visible");
  if (suggestionPositionFrame !== null) cancelAnimationFrame(suggestionPositionFrame);
  suggestionPositionFrame = null;
  cachedSuggestionPanelHeight = 0;
  cachedSuggestionEditing = null;
  suggestionPositionCorrectionPending = false;
  lastNormalSuggestionY = Number.NaN;
  lastNormalSuggestionMaxHeight = Number.NaN;
  lastVoiceSuggestionShift = Number.NaN;
  voiceDock.style.removeProperty("--suggestion-keyboard-shift");
  voiceDock.style.removeProperty("--normal-suggestion-y");
  voiceDock.style.removeProperty("--normal-suggestion-max-height");
}

function showPointNameSuggestions(input) {
  if (
    !voiceModeActive ||
    voiceSessionActive ||
    !input?.isConnected ||
    input.dataset.field !== "pointName"
  ) {
    hidePointSuggestions();
    return;
  }
  const rowIndex = findRowIndex(input);
  const namesAboveCurrentRow = project.sheets[activeSheet]
    .slice(0, Math.max(0, rowIndex))
    .map((row) => row.pointName);
  let candidates = getRankedPointNameCandidates(
    namesAboveCurrentRow,
    project.settings.pointAliases,
    project.settings.pointNameHistory,
    POINT_SUGGESTION_SEEDS,
    POINT_SUGGESTION_LIMIT,
    input.value
  );
  const currentPointName = normalizePointName(
    input.value,
    project.settings.pointAliases
  );
  if (currentPointName && candidates[0] !== currentPointName) {
    candidates = [
      candidates[0],
      currentPointName,
      ...candidates.slice(1).filter((pointName) => pointName !== currentPointName)
    ].filter(Boolean).slice(0, POINT_SUGGESTION_LIMIT);
  }
  if (!candidates.length) {
    hidePointSuggestions();
    return;
  }
  const buttons = candidates.map((pointName, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.pointSuggestion = pointName;
    if (index === 0) button.classList.add("primary-point-suggestion");
    if (pointName === currentPointName) {
      button.classList.add("current-point-suggestion");
      button.setAttribute("aria-label", `現在値 ${pointName}`);
    }
    button.textContent = pointName;
    return button;
  });
  const primaryButton = buttons[0];
  const scrollHint = document.createElement("div");
  scrollHint.className = "point-suggestion-scroll-hint";
  scrollHint.setAttribute("aria-hidden", "true");
  const alternatives = document.createElement("div");
  alternatives.className = "point-suggestion-alternatives";
  alternatives.append(...buttons.slice(1));
  pointSuggestionButtons.replaceChildren(
    ...(primaryButton ? [primaryButton] : []),
    ...(alternatives.childElementCount ? [scrollHint] : []),
    ...(alternatives.childElementCount ? [alternatives] : [])
  );
  pointSuggestions.hidden = false;
  document.body.classList.add("point-suggestions-visible");
  keepSelectedPointAboveSuggestions(input);
  keepSuggestionEditorAboveKeyboard();
}

function keepSelectedPointAboveSuggestions(input) {
  requestAnimationFrame(() => {
    if (!input?.isConnected || pointSuggestions.hidden) return;
    const inputRect = input.getBoundingClientRect();
    const suggestionsRect = pointSuggestions.getBoundingClientRect();
    const overlapsHorizontally = (
      inputRect.right > suggestionsRect.left &&
      inputRect.left < suggestionsRect.right
    );
    if (!voiceModeActive && !overlapsHorizontally) return;
    const overlap = inputRect.bottom - suggestionsRect.top + 12;
    if (overlap > 0) {
      window.scrollBy({ top: overlap, behavior: "smooth" });
    }
  });
}

function cancelSuggestionLongPress() {
  if (suggestionLongPressTimer !== null) clearTimeout(suggestionLongPressTimer);
  suggestionLongPressTimer = null;
}

async function applyPointSuggestion(pointName) {
  if (voiceSessionActive || !selectedInput?.isConnected || selectedInput.dataset.field !== "pointName") return;
  const target = selectedInput;
  const normalized = normalizePointName(pointName, project.settings.pointAliases);
  if (!normalized) return;
  target.value = normalized;
  if (!handleFieldChange(target, { forceHistory: true })) return;
  recordPointName(target.value);
  hidePointSuggestions();
  voiceButton.textContent = "🔊 復唱中…";
  voiceStatus.textContent = `${target.value} と復唱します`;
  await speakBack(
    pointNameToSpeech(target.value, project.settings.pointAliases),
    project.settings.voiceRate
  );
  await moveAfterVoiceInput(target);
  updateVoiceModeUi();
}

function beginPointSuggestionEdit(button) {
  if (!button?.isConnected || voiceSessionActive) return;
  if (suggestionEditInput?.isConnected) {
    const nextPointName = button.dataset.pointSuggestion || "";
    suggestionEditInput = null;
    suggestionEditFocusPending = false;
    showPointNameSuggestions(selectedInput);
    button = Array.from(pointSuggestionButtons.querySelectorAll("[data-point-suggestion]"))
      .find((candidate) => candidate.dataset.pointSuggestion === nextPointName);
    if (!button) return;
  }
  suggestionLongPressTriggered = true;
  navigator.vibrate?.(25);

  const editor = document.createElement("div");
  editor.className = "point-suggestion-editor";
  const input = document.createElement("input");
  input.type = "text";
  input.value = button.dataset.pointSuggestion || "";
  input.setAttribute("aria-label", "点名候補を編集");
  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  confirmButton.textContent = "確定";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "suggestion-edit-cancel";
  cancelButton.textContent = "取消";

  const confirm = async () => {
    await applyPointSuggestion(input.value);
  };
  confirmButton.addEventListener("click", confirm);
  let cancelHandledByPointer = false;
  const cancelEdit = () => {
    suggestionEditFocusPending = false;
    showPointNameSuggestions(selectedInput);
  };
  cancelButton.addEventListener("pointerup", (event) => {
    event.preventDefault();
    event.stopPropagation();
    cancelHandledByPointer = true;
    cancelEdit();
  });
  cancelButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (cancelHandledByPointer) {
      cancelHandledByPointer = false;
      return;
    }
    cancelEdit();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirm();
    } else if (event.key === "Escape") {
      showPointNameSuggestions(selectedInput);
    }
  });

  editor.append(input, confirmButton, cancelButton);
  const editContainer = button.parentElement;
  if (editContainer?.classList.contains("point-suggestion-alternatives")) {
    editContainer.classList.add("editing");
    editContainer.replaceChildren(editor);
  } else {
    button.replaceWith(editor);
  }
  suggestionEditInput = input;
  suggestionEditFocusPending = true;
  suggestionPositionCorrectionPending = true;
  focusSuggestionEditInput();
}

function focusSuggestionEditInput() {
  if (!suggestionEditInput?.isConnected) return;
  suggestionEditInput.focus({ preventScroll: true });
  const end = suggestionEditInput.value.length;
  suggestionEditInput.setSelectionRange(end, end);
  keepSuggestionEditorAboveKeyboard();
}

function setDockPixelProperty(propertyName, value, previousValue) {
  if (Number.isFinite(previousValue) && Math.abs(value - previousValue) < 6) {
    return previousValue;
  }
  voiceDock.style.setProperty(propertyName, `${Math.round(value)}px`);
  return value;
}

function getRenderedTranslateY(element) {
  const transform = window.getComputedStyle(element).transform;
  if (!transform || transform === "none") return 0;
  const transformValues = transform.slice(transform.indexOf("(") + 1, transform.lastIndexOf(")"));
  const values = transformValues.split(",").map((value) => Number(value.trim()));
  if (transform.startsWith("matrix3d")) return values[13] || 0;
  if (transform.startsWith("matrix")) return values[5] || 0;
  return 0;
}

function updateSuggestionPosition() {
  const normalSuggestionVisible = (
    !voiceModeActive &&
    !voiceSessionActive &&
    !pointSuggestions.hidden
  );
  if (normalSuggestionVisible) {
    voiceDock.style.removeProperty("--suggestion-keyboard-shift");
    const viewport = window.visualViewport;
    const visibleTop = viewport ? viewport.offsetTop : 0;
    const visibleHeight = viewport ? viewport.height : window.innerHeight;
    const maxPanelHeight = Math.max(120, visibleHeight - 16);
    lastNormalSuggestionMaxHeight = setDockPixelProperty(
      "--normal-suggestion-max-height",
      maxPanelHeight,
      lastNormalSuggestionMaxHeight
    );
    const editing = Boolean(suggestionEditInput?.isConnected);
    cachedSuggestionEditing = editing;
    cachedSuggestionPanelHeight = voiceDock.getBoundingClientRect().height;
    const panelRect = voiceDock.getBoundingClientRect();
    const panelHeight = Math.min(panelRect.height, maxPanelHeight);
    const normalTop = visibleTop + 8;
    const desiredTop = editing ? Math.max(
      normalTop,
      visibleTop + visibleHeight - panelHeight - 8
    ) : normalTop;
    const layoutTop = panelRect.top - getRenderedTranslateY(voiceDock);
    const correctedY = desiredTop - layoutTop;
    lastNormalSuggestionY = setDockPixelProperty(
      "--normal-suggestion-y",
      correctedY,
      lastNormalSuggestionY
    );
    if (editing && suggestionPositionCorrectionPending) {
      suggestionPositionCorrectionPending = false;
      requestAnimationFrame(keepSuggestionEditorAboveKeyboard);
    }
    return;
  }
  voiceDock.style.removeProperty("--normal-suggestion-y");
  voiceDock.style.removeProperty("--normal-suggestion-max-height");
  lastNormalSuggestionY = Number.NaN;
  lastNormalSuggestionMaxHeight = Number.NaN;
  cachedSuggestionPanelHeight = 0;
  cachedSuggestionEditing = null;
  const visibleSuggestionPanel = !pointSuggestions.hidden && pointSuggestions.isConnected
    ? pointSuggestions
    : null;
  const keyboardAvoidanceTarget = visibleSuggestionPanel ||
    (suggestionEditInput?.isConnected ? suggestionEditInput : null);
  if (!keyboardAvoidanceTarget) {
    voiceDock.style.removeProperty("--suggestion-keyboard-shift");
    lastVoiceSuggestionShift = Number.NaN;
    return;
  }
  if (!keyboardAvoidanceTarget?.isConnected) return;
  const viewport = window.visualViewport;
  const visibleBottom = viewport
    ? viewport.offsetTop + viewport.height
    : window.innerHeight;
  const targetBottom = keyboardAvoidanceTarget.getBoundingClientRect().bottom;
  const renderedShift = Math.max(0, -getRenderedTranslateY(voiceDock));
  const unshiftedTargetBottom = targetBottom + renderedShift;
  const overlap = Math.max(0, unshiftedTargetBottom + 12 - visibleBottom);
  lastVoiceSuggestionShift = setDockPixelProperty(
    "--suggestion-keyboard-shift",
    overlap,
    lastVoiceSuggestionShift
  );
  if (suggestionEditInput?.isConnected && suggestionPositionCorrectionPending) {
    suggestionPositionCorrectionPending = false;
    requestAnimationFrame(keepSuggestionEditorAboveKeyboard);
  }
}

function keepSuggestionEditorAboveKeyboard() {
  if (suggestionPositionFrame !== null) return;
  suggestionPositionFrame = requestAnimationFrame(() => {
    suggestionPositionFrame = null;
    updateSuggestionPosition();
  });
}

window.visualViewport?.addEventListener("resize", keepSuggestionEditorAboveKeyboard);
window.visualViewport?.addEventListener("scroll", keepSuggestionEditorAboveKeyboard);

function updateSoftwareKeyboardState() {
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  if (!document.activeElement?.matches?.("#notebookBody input")) {
    keyboardViewportBaseline = Math.max(
      keyboardViewportBaseline,
      viewportHeight
    );
  }
  const keyboardOpen = Boolean(
    !voiceModeActive &&
    document.activeElement?.matches?.("#notebookBody input") &&
    keyboardViewportBaseline - viewportHeight > 120
  );
  document.body.classList.toggle("software-keyboard-open", keyboardOpen);
}

window.visualViewport?.addEventListener("resize", updateSoftwareKeyboardState);
window.visualViewport?.addEventListener("scroll", updateSoftwareKeyboardState);
window.addEventListener("resize", updateSoftwareKeyboardState);

function recordPointName(pointName) {
  const normalized = normalizePointName(pointName, project.settings.pointAliases);
  if (!normalized) return "";
  project.settings.pointNameHistory = recordPointNameUsage(project.settings.pointNameHistory, normalized);
  scheduleAutosave();
  return normalized;
}

function moveStraightDown(current, focusTarget = true) {
  const field = current.dataset.field;
  const rowIndex = findRowIndex(current);
  if (!field || rowIndex < 0) return;
  if (rowIndex === project.sheets[activeSheet].length - 1) {
    project.sheets.out.push(createRow("out"));
    project.sheets.back.push(createRow("back"));
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

function ensureFollowingRow(rowIndex) {
  if (rowIndex < project.sheets[activeSheet].length - 1) return;
  project.sheets.out.push(createRow("out"));
  project.sheets.back.push(createRow("back"));
  renderSheet();
}

function selectMovedInput(target, focusTarget = false) {
  if (!target) return;
  markSelectedInput(target);
  if (focusTarget) {
    target.focus({ preventScroll: false });
  } else {
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  if (voiceModeActive && !voiceSessionActive && target.dataset.field === "pointName") {
    showPointNameSuggestions(target);
  } else {
    hidePointSuggestions();
  }
}

function getVoiceRowInputs(row) {
  if (!row) return [];
  return Array.from(row.querySelectorAll("input")).filter((input) => {
    return project.settings.showDistance || input.dataset.field !== "distance";
  });
}

function getFieldBelowPreviousReading(rowIndex) {
  if (rowIndex === 0) return "bs";
  const previousRow = project.sheets[activeSheet][rowIndex - 1];
  if (!previousRow) return null;
  if (previousRow.bs !== null) return "bs";
  if (previousRow.fs !== null) return "fs";
  return null;
}

function hasDistanceInPreviousRow(rowIndex) {
  if (rowIndex <= 0) return false;
  const previousRow = project.sheets[activeSheet][rowIndex - 1];
  return previousRow?.distance !== null && previousRow?.distance !== undefined;
}

async function moveAfterVoiceInput(current) {
  const field = current.dataset.field;
  const rowIndex = findRowIndex(current);
  if (!field || rowIndex < 0) return;

  if (field === "fs") {
    ensureFollowingRow(rowIndex);
    const nextPointInput = tbody.rows[rowIndex + 1]?.querySelector('[data-field="pointName"]');
    let automaticPointName = "";
    if (nextPointInput && !nextPointInput.value.trim()) {
      const pointNameAbove = project.sheets[activeSheet][rowIndex]?.pointName || "";
      automaticPointName = incrementPointNameOrCopy(
        pointNameAbove,
        project.settings.pointAliases
      );
      if (automaticPointName) {
        nextPointInput.value = automaticPointName;
        if (!handleFieldChange(nextPointInput, { forceHistory: true })) {
          automaticPointName = "";
        } else {
          recordPointName(automaticPointName);
        }
      }
    }
    selectMovedInput(nextPointInput);
    if (automaticPointName) {
      voiceStatus.textContent = `${automaticPointName} を自動入力しました`;
      await speakBack(
        pointNameToSpeech(automaticPointName, project.settings.pointAliases),
        project.settings.voiceRate
      );
    }
    return;
  }

  if (field === "pointName" && project.settings.showDistance && hasDistanceInPreviousRow(rowIndex)) {
    selectMovedInput(tbody.rows[rowIndex]?.querySelector('[data-field="distance"]'));
    return;
  }

  if (field === "pointName" || field === "distance") {
    const readingField = getFieldBelowPreviousReading(rowIndex);
    if (readingField) {
      selectMovedInput(tbody.rows[rowIndex]?.querySelector(`[data-field="${readingField}"]`));
    }
    return;
  }

  const rowInputs = getVoiceRowInputs(tbody.rows[rowIndex]);
  const columnIndex = rowInputs.indexOf(current);
  if (columnIndex < 0) return;
  selectMovedInput(rowInputs[columnIndex + 1]);
}

function cancelLongPress() {
  if (longPressTimer) clearTimeout(longPressTimer);
  longPressTimer = null;
  longPressInput = null;
  longPressPointerId = null;
}

function hideCellDeleteButton() {
  cellDeleteButton.hidden = true;
  cellDeleteTarget = null;
}

function showCellDeleteButton(input, clientX, clientY) {
  if (!voiceModeActive || voiceSessionActive || !input?.isConnected) return;
  cellDeleteTarget = input;
  markSelectedInput(input);
  voiceTarget = input;
  hidePointSuggestions();
  const left = clamp(clientX + 10, 8, Math.max(8, window.innerWidth - 100));
  const top = clientY > window.innerHeight - 90
    ? Math.max(8, clientY - 62)
    : clientY + 12;
  cellDeleteButton.style.left = `${left}px`;
  cellDeleteButton.style.top = `${top}px`;
  cellDeleteButton.hidden = false;
}

function startLongPress(input, event) {
  cancelLongPress();
  if (!voiceModeActive || voiceSessionActive || !input?.isConnected) return;
  longPressInput = input;
  longPressPointerId = event.pointerId;
  longPressStartX = event.clientX;
  longPressStartY = event.clientY;
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    pointerTapMoved = true;
    suppressNextCellClick = true;
    showCellDeleteButton(longPressInput, longPressStartX, longPressStartY);
  }, 560);
}

tbody.addEventListener("focusin", (event) => {
  if (!event.target.matches("input")) return;
  if (voiceModeActive || voiceSessionActive) {
    selectVoiceTargetWithoutKeyboard(event.target);
    return;
  }
  markSelectedInput(event.target);
  if (event.target.dataset.field === "pointName") {
    showPointNameSuggestions(event.target);
  } else {
    hidePointSuggestions();
  }
  requestAnimationFrame(updateSoftwareKeyboardState);
});

tbody.addEventListener("pointerdown", (event) => {
  const input = event.target.closest("input");
  if (!input) return;
  hideCellDeleteButton();
  pointerTapInput = input;
  pointerTapId = event.pointerId;
  pointerTapStartX = event.clientX;
  pointerTapStartY = event.clientY;
  pointerTapMoved = false;
  suppressNextCellClick = false;
  if (event.pointerType === "touch" && !voiceModeActive && !voiceSessionActive) {
    input.readOnly = true;
    input.dataset.touchTapLock = "";
  }
  startLongPress(input, event);
}, { capture: true });

tbody.addEventListener("pointermove", (event) => {
  if (event.pointerId !== pointerTapId) return;
  if (Math.hypot(event.clientX - pointerTapStartX, event.clientY - pointerTapStartY) > 12) {
    pointerTapMoved = true;
    suppressNextCellClick = true;
    cancelLongPress();
  }
}, { capture: true, passive: true });

function finishPointerGesture(event, cancelled = false) {
  if (event.pointerId !== pointerTapId) {
    cancelLongPress();
    return;
  }
  const input = pointerTapInput;
  const isTap = !cancelled && !pointerTapMoved;
  cancelLongPress();
  if (input?.hasAttribute("data-touch-tap-lock")) {
    delete input.dataset.touchTapLock;
    input.readOnly = voiceModeActive || voiceSessionActive;
  }
  if (isTap && input?.isConnected) {
    if (voiceModeActive || voiceSessionActive) {
      selectVoiceTargetWithoutKeyboard(input);
    } else {
      markSelectedInput(input);
      input.focus({ preventScroll: true });
      if (input.dataset.field === "pointName") {
        showPointNameSuggestions(input);
      } else {
        hidePointSuggestions();
      }
    }
  } else if (input && document.activeElement === input) {
    input.blur();
  }
  pointerTapInput = null;
  pointerTapId = null;
}

window.addEventListener("pointerup", (event) => finishPointerGesture(event), { capture: true, passive: true });
window.addEventListener("pointercancel", (event) => finishPointerGesture(event, true), { capture: true, passive: true });

tbody.addEventListener("contextmenu", (event) => {
  const input = event.target.closest("input");
  if (!input || !voiceModeActive || voiceSessionActive) return;
  event.preventDefault();
  cancelLongPress();
  showCellDeleteButton(input, event.clientX, event.clientY);
});

tableWrap.addEventListener("scroll", () => {
  cancelLongPress();
  hideCellDeleteButton();
  schedulePointClipboardPosition();
}, { passive: true });

window.addEventListener("scroll", schedulePointClipboardPosition, { passive: true });
window.addEventListener("resize", schedulePointClipboardPosition, { passive: true });
window.visualViewport?.addEventListener("resize", schedulePointClipboardPosition);
window.visualViewport?.addEventListener("scroll", schedulePointClipboardPosition);

document.addEventListener("pointerdown", (event) => {
  if (event.target === cellDeleteButton || cellDeleteButton.hidden) return;
  hideCellDeleteButton();
}, { capture: true });

cellDeleteButton.addEventListener("click", () => {
  const target = cellDeleteTarget;
  hideCellDeleteButton();
  if (!target?.isConnected) return;
  target.value = "";
  if (!handleFieldChange(target, { forceHistory: true })) return;
  markSelectedInput(target);
  voiceTarget = target;
  if (target.dataset.field === "pointName") {
    showPointNameSuggestions(target);
  } else {
    hidePointSuggestions();
  }
});

tbody.addEventListener("click", (event) => {
  const input = event.target.closest("input");
  if (!input || (!voiceModeActive && !voiceSessionActive)) return;
  event.preventDefault();
  if (suppressNextCellClick) {
    suppressNextCellClick = false;
    return;
  }
  selectVoiceTargetWithoutKeyboard(input);
});

tbody.addEventListener("input", (event) => {
  if (!event.target.matches("input")) return;
  if (UNSIGNED_DECIMAL_FIELDS.has(event.target.dataset.field)) {
    const sanitized = sanitizeUnsignedDecimal(event.target.value);
    if (event.target.value !== sanitized) event.target.value = sanitized;
  }
  handleFieldChange(event.target);
  updatePointClipboardButtons();
  if (!voiceSessionActive && event.target.dataset.field === "pointName") {
    showPointNameSuggestions(event.target);
  } else if (event.target.dataset.field === "pointName") {
    hidePointSuggestions();
  }
});

tbody.addEventListener("change", (event) => {
  if (!event.target.matches('input[data-field="pointName"]')) return;
  const normalized = recordPointName(event.target.value);
  if (normalized && normalized !== event.target.value) {
    event.target.value = normalized;
    handleFieldChange(event.target);
  }
});

tbody.addEventListener("focusout", (event) => {
  requestAnimationFrame(updateSoftwareKeyboardState);
  endHistoryGroup();
  if (event.target.matches("input")) formatNumericInput(event.target);
  if (!event.target.matches('input[data-field="pointName"]')) return;
  const blurredPointInput = event.target;
  setTimeout(() => {
    if (
      selectedInput !== blurredPointInput &&
      selectedInput?.isConnected &&
      selectedInput.dataset.field === "pointName"
    ) return;
    if (voiceModeActive && selectedInput === blurredPointInput) return;
    if (!pointSuggestions.contains(document.activeElement)) hidePointSuggestions();
  }, 120);
});

pointSuggestionButtons.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("[data-point-suggestion]");
  if (!button || voiceSessionActive) return;
  cancelSuggestionLongPress();
  suggestionLongPressTriggered = false;
  suggestionGestureMoved = false;
  suggestionLongPressStartX = event.clientX;
  suggestionLongPressStartY = event.clientY;
  suggestionLongPressTimer = setTimeout(() => {
    suggestionLongPressTimer = null;
    beginPointSuggestionEdit(button);
  }, 560);
});

pointSuggestionButtons.addEventListener("pointermove", (event) => {
  if (suggestionLongPressTimer === null) return;
  if (
    Math.abs(event.clientX - suggestionLongPressStartX) > 10 ||
    Math.abs(event.clientY - suggestionLongPressStartY) > 10
  ) {
    suggestionGestureMoved = true;
    cancelSuggestionLongPress();
  }
});

pointSuggestionButtons.addEventListener("pointerup", () => {
  cancelSuggestionLongPress();
});
pointSuggestionButtons.addEventListener("pointercancel", cancelSuggestionLongPress);
pointSuggestionButtons.addEventListener("pointerleave", cancelSuggestionLongPress);
pointSuggestionButtons.addEventListener("contextmenu", (event) => {
  if (event.target.closest("[data-point-suggestion]")) event.preventDefault();
});

pointSuggestionButtons.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-point-suggestion]");
  if (!button) return;
  if (suggestionGestureMoved) {
    suggestionGestureMoved = false;
    return;
  }
  if (suggestionLongPressTriggered) {
    suggestionLongPressTriggered = false;
    return;
  }
  await applyPointSuggestion(button.dataset.pointSuggestion);
});

pointCopyButton.addEventListener("click", () => {
  if (
    !selectedInput?.isConnected ||
    selectedInput.dataset.field !== "pointName"
  ) return;
  const value = normalizePointName(
    selectedInput.value,
    project.settings.pointAliases
  );
  if (!value) return;
  pointNameClipboard = value;
  updatePointClipboardButtons();
  showNotice(`「${value}」をコピーしました。`, "success");
});

pointPasteButton.addEventListener("click", async () => {
  if (
    !pointNameClipboard ||
    !selectedInput?.isConnected ||
    selectedInput.dataset.field !== "pointName"
  ) return;
  const target = selectedInput;
  target.value = pointNameClipboard;
  if (!handleFieldChange(target, { forceHistory: true })) return;
  recordPointName(target.value);
  markSelectedInput(target);
  hidePointSuggestions();
  if (!voiceModeActive) {
    target.readOnly = false;
    target.focus({ preventScroll: false });
    const end = target.value.length;
    target.setSelectionRange(end, end);
  }
  pointClipboardDismissedFor = target;
  pointClipboardPopover.hidden = true;
  voiceStatus.textContent = `${target.value} と貼り付けました`;
  await speakBack(
    pointNameToSpeech(target.value, project.settings.pointAliases),
    project.settings.voiceRate
  );
  if (voiceModeActive) {
    await moveAfterVoiceInput(target);
  }
  updatePointClipboardButtons();
});

document.addEventListener("pointerup", () => {
  if (!suggestionEditFocusPending) return;
  suggestionEditFocusPending = false;
  focusSuggestionEditInput();
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
  if (handleFieldChange(event.target)) {
    formatNumericInput(event.target);
    moveStraightDown(event.target);
  }
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

tolerancePresetSelect.value = project.settings.tolerancePreset;
tolerancePresetSelect.addEventListener("change", (event) => {
  project.settings.tolerancePreset = LEVELING_TOLERANCE_PRESETS[event.target.value]
    ? event.target.value
    : "grade3";
  recalculateAndRender();
  scheduleAutosave();
});

const rowDialog = document.querySelector("#rowDialog");
rowDialog.addEventListener("close", () => {
  tbody.querySelectorAll("tr.row-selected").forEach((row) => row.classList.remove("row-selected"));
  selectedRowIndex = null;
});
document.querySelector("#insertRowBtn").addEventListener("click", () => {
  if (selectedRowIndex === null) return;
  recordUndoSnapshot(activeSheet, "row-insert", true);
  project.sheets.out.splice(selectedRowIndex + 1, 0, createRow("out"));
  project.sheets.back.splice(selectedRowIndex + 1, 0, createRow("back"));
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
  recordUndoSnapshot(activeSheet, "row-delete", true);
  project.sheets.out.splice(selectedRowIndex, 1);
  project.sheets.back.splice(selectedRowIndex, 1);
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
document.querySelector("#csvBtn").addEventListener("click", async () => {
  const result = await exportSheetCsv(activeSheet, calculations[activeSheet].rows);
  if (result === "shared") {
    showNotice("CSVを共有しました。Gmailなどで送信できます。", "success");
  } else if (result === "downloaded") {
    showNotice(`${activeSheet === "out" ? "往路" : "復路"}シートをCSV出力しました。`, "success");
  }
});
const clearDialog = document.querySelector("#clearDialog");
document.querySelector("#clearBtn").addEventListener("click", () => clearDialog.showModal());
clearDialog.querySelectorAll("[data-clear-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.clearTarget;
    const targetLabel = target === "out" ? "往路" : target === "back" ? "復路" : "全シート";
    if (!confirm(`${targetLabel}のデータを消去しますか？`)) return;

    recordUndoSnapshot(activeSheet, `clear-${target}`, true);
    if (target === "all") {
      const settings = { ...project.settings };
      clearProject();
      project = createBlankProject();
      project.settings = settings;
    } else {
      project.sheets[target] = createRows(target, project.sheets[target === "out" ? "back" : "out"].length);
    }
    clearDialog.close();
    renderSheet();
    project = saveProject(project);
    showNotice(`${targetLabel}を消去しました。`, "success");
  });
});

const supportDialog = document.querySelector("#supportDialog");
document.querySelector("#supportOpenBtn").addEventListener("click", () => supportDialog.showModal());

const settingsDialog = document.querySelector("#settingsDialog");
const voiceRateInput = document.querySelector("#voiceRate");
const voiceRateValue = document.querySelector("#voiceRateValue");
const pointAliasList = document.querySelector("#pointAliasList");
const pointScriptInputs = [...pointScriptControls.querySelectorAll("[data-point-script]")];
voiceRateInput.value = project.settings.voiceRate.toFixed(1);
voiceRateValue.textContent = `${project.settings.voiceRate.toFixed(1)}倍`;
pointScriptInputs.forEach((input) => {
  input.checked = Boolean(project.settings.pointNameScripts[input.dataset.pointScript]);
});
document.querySelector("#settingsOpenBtn").addEventListener("click", () => {
  renderPointAliasEditors();
  settingsDialog.showModal();
});
voiceRateInput.addEventListener("input", () => {
  project.settings.voiceRate = clamp(Number(voiceRateInput.value) || 0.9, 0.5, 1.5);
  voiceRateValue.textContent = `${project.settings.voiceRate.toFixed(1)}倍`;
  scheduleAutosave();
});
pointScriptControls.addEventListener("change", (event) => {
  const input = event.target.closest("[data-point-script]");
  if (!input) return;
  project.settings.pointNameScripts[input.dataset.pointScript] = input.checked;
  scheduleAutosave();
});

function createPointAliasEditor(alias = {}) {
  const row = document.createElement("div");
  row.className = "alias-row";

  const pointName = document.createElement("input");
  pointName.type = "text";
  pointName.dataset.aliasField = "pointName";
  pointName.value = alias.pointName || "";
  pointName.placeholder = "T-1";
  pointName.setAttribute("aria-label", "入力する点名");

  const spoken = document.createElement("input");
  spoken.type = "text";
  spoken.dataset.aliasField = "spoken";
  spoken.value = alias.spoken || "";
  spoken.placeholder = "ティノイチ";
  spoken.setAttribute("aria-label", "音声での読み");

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "alias-remove";
  remove.dataset.removeAlias = "";
  remove.textContent = "×";
  remove.setAttribute("aria-label", "この点名を削除");
  row.append(pointName, spoken, remove);
  return row;
}

function renderPointAliasEditors() {
  const editors = project.settings.pointAliases.map((alias) => createPointAliasEditor(alias));
  if (!editors.length) editors.push(createPointAliasEditor());
  pointAliasList.replaceChildren(...editors);
}

function collectPointAliases() {
  project.settings.pointAliases = [...pointAliasList.querySelectorAll(".alias-row")]
    .map((row) => ({
      pointName: row.querySelector('[data-alias-field="pointName"]').value.normalize("NFKC").trim().toUpperCase(),
      spoken: row.querySelector('[data-alias-field="spoken"]').value.trim()
    }))
    .filter((alias) => alias.pointName && alias.spoken);
  scheduleAutosave();
}

document.querySelector("#addPointAliasBtn").addEventListener("click", () => {
  pointAliasList.append(createPointAliasEditor());
  pointAliasList.lastElementChild.querySelector("input").focus();
});
pointAliasList.addEventListener("input", (event) => {
  if (event.target.matches('[data-alias-field="pointName"]')) {
    event.target.value = event.target.value.normalize("NFKC").toUpperCase();
  }
  collectPointAliases();
});
pointAliasList.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove-alias]");
  if (!remove) return;
  remove.closest(".alias-row").remove();
  if (!pointAliasList.children.length) pointAliasList.append(createPointAliasEditor());
  collectPointAliases();
});

const voiceController = createVoiceController({
  onStatus: (message) => {
    if (!voiceSessionActive) {
      voiceStatus.textContent = "";
      updateVoiceModeUi();
      return;
    }
    voiceStatus.textContent = message;
    if (message.includes("復唱")) voiceButton.textContent = "🔊 復唱中…";
    if (!message && voiceSessionActive && !voiceButton.classList.contains("listening")) {
      finishVoiceSession();
    }
  },
  onListeningChange: (listening) => {
    if (!voiceSessionActive) {
      voiceButton.classList.remove("listening");
      updateVoiceModeUi();
      return;
    }
    voiceButton.classList.toggle("listening", listening);
    voiceButton.textContent = listening ? "■ 聞き取り中（押すと中止）" : "🔊 処理中…";
  },
  onResult: async (transcript, recognitionDetails = {}) => {
    const resultSessionToken = voiceSessionToken;
    const target = voiceTarget;
    try {
      if (!target?.isConnected || resultSessionToken !== voiceSessionToken) return;
      const field = target.dataset.field;
      let value;
      if (field === "bs" || field === "fs") {
        value = chooseLevelReading(transcript, recognitionDetails.alternatives);
        if (!value) {
          showNotice("レベル値を確定できません。小数3桁でもう一度入力してください。", "error");
          navigator.vibrate?.([80, 60, 80]);
          voiceStatus.textContent = "レベル値を認識できませんでした";
          await speakBack("数字をもう一度", project.settings.voiceRate);
          return;
        }
      } else if (NUMERIC_FIELDS.has(field)) {
        value = normalizeSpokenNumber(transcript);
      } else if (field === "pointName") {
        value = choosePointName(
          transcript,
          recognitionDetails.alternatives,
          project.settings.pointAliases,
          project.settings.pointNameScripts
        );
        if (!value) {
          showNotice("点名として確定できません。登録済みの点名でもう一度入力してください。", "error");
          navigator.vibrate?.([80, 60, 80]);
          voiceStatus.textContent = "点名を認識できませんでした";
          await speakBack("点名をもう一度", project.settings.voiceRate);
          return;
        }
      } else {
        value = transcript.trim();
      }
      if (UNSIGNED_DECIMAL_FIELDS.has(field)) value = sanitizeUnsignedDecimal(value);
      target.value = value;
      if (!handleFieldChange(target, { forceHistory: true })) return;
      formatNumericInput(target);
      if (field === "pointName") recordPointName(value);
      voiceStatus.textContent = `${value} と復唱します`;
      voiceButton.textContent = "🔊 復唱中…";
      const repeatText = field === "pointName"
        ? pointNameToSpeech(value, project.settings.pointAliases)
        : field === "bs" || field === "fs"
          ? levelReadingToSpeech(value)
          : value;
      await speakBack(repeatText, project.settings.voiceRate);
      if (!voiceSessionActive || resultSessionToken !== voiceSessionToken) return;
      await moveAfterVoiceInput(target);
    } finally {
      if (resultSessionToken === voiceSessionToken) finishVoiceSession();
    }
  },
  shouldFinalize: (transcript, recognitionDetails = {}) => {
    if (!voiceTarget) return false;
    if (voiceTarget.dataset.field === "pointName") {
      if (!recognitionDetails.isFinal) return false;
      return Boolean(choosePointName(
        transcript,
        recognitionDetails.alternatives,
        project.settings.pointAliases,
        project.settings.pointNameScripts
      ));
    }
    if (!NUMERIC_FIELDS.has(voiceTarget.dataset.field)) return false;
    if (voiceTarget.dataset.field === "bs" || voiceTarget.dataset.field === "fs") {
      return Boolean(chooseLevelReading(transcript, recognitionDetails.alternatives));
    }
    let value = normalizeSpokenNumber(transcript);
    if (UNSIGNED_DECIMAL_FIELDS.has(voiceTarget.dataset.field)) value = sanitizeUnsignedDecimal(value);
    return value.replace(/^[-+]/, "").length >= 5;
  }
});

function cancelActiveVoiceSession() {
  voiceSessionToken += 1;
  finishVoiceSession();
  voiceController.cancel();
  updateVoiceModeUi();
}

undoButton.addEventListener("click", () => {
  if (voiceSessionActive) {
    cancelActiveVoiceSession();
  }
  undoCurrentSheet();
});

redoButton.addEventListener("click", () => {
  if (voiceSessionActive) {
    cancelActiveVoiceSession();
  }
  redoCurrentSheet();
});

if (!voiceController.supported) {
  voiceButton.disabled = true;
  voiceButton.title = "音声入力非対応";
}

voiceButton.addEventListener("click", () => {
  if (!voiceModeActive) {
    const target = selectedInput?.isConnected ? selectedInput : null;
    setVoiceModeActive(true);
    target?.blur();
    if (target?.dataset.field === "pointName") showPointNameSuggestions(target);
    return;
  }
  if (voiceSessionActive) {
    cancelActiveVoiceSession();
    return;
  }
  const activeInput = document.activeElement?.matches?.("#notebookBody input")
    ? document.activeElement
    : null;
  if (activeInput) markSelectedInput(activeInput);
  if (!selectedInput?.isConnected) {
    showNotice("先に入力セルを選択してください。", "error");
    return;
  }
  prepareSpeechSynthesis();
  voiceTarget = selectedInput;
  voiceSessionToken += 1;
  setVoiceSessionActive(true);
  voiceButton.textContent = "● 準備中…";
  voiceController.start();
});

sheetToggleButton.addEventListener("click", () => {
  if (voiceSessionActive) cancelActiveVoiceSession();
  const targetSheet = activeSheet === "out" ? "back" : "out";
  synchronizePointNames(activeSheet, targetSheet);
  activeSheet = targetSheet;
  renderSheet();
  project = saveProject(project);
});

keyboardModeButton.addEventListener("click", () => {
  if (voiceSessionActive) return;
  const target = selectedInput?.isConnected ? selectedInput : null;
  setVoiceModeActive(false);
  if (!target) {
    showNotice("キーボードを出すセルを先に選択してください。", "error");
    return;
  }
  target.readOnly = false;
  target.focus({ preventScroll: false });
  target.click();
  if (typeof target.setSelectionRange === "function") {
    const end = target.value.length;
    target.setSelectionRange(end, end);
  }
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
