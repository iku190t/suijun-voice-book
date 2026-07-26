import {
  applyRoundTripDifferences,
  calculateNotebook,
  calculateToleranceMm,
  formatRoundTripMillimeters,
  formatMeters,
  LEVELING_TOLERANCE_PRESETS,
  resolveToleranceDistanceMeters,
  toNumber
} from "./calculation.js?v=154";
import {
  chooseLevelReading,
  createVoiceController,
  levelReadingToSpeech,
  normalizeSpokenNumber,
  prepareSpeechSynthesis,
  speakBack
} from "./voice.js?v=154";
import { clearProject, loadProject, saveProject } from "./storage.js?v=154";
import { exportNotebookCsv } from "./export.js?v=154";
import {
  alignSheetsWithCurrentLabels,
  isValidStaffReading,
  rowHasLevelObservationData,
  reversePointNamesWithinUsedRows
} from "./rules.js?v=154";
import {
  choosePointName,
  composePointNameSuggestionCandidates,
  getBaseNoOffsetCandidates,
  getPointNameConfusionCandidates,
  getOffsetPointNameCandidates,
  getRankedPointNameCandidates,
  incrementPointNameOrCopy,
  normalizePointName,
  pointNameToSpeech,
  recordPointNameUsage
} from "./point-names.js?v=154";
import { initializeAnalytics, trackEvent } from "./analytics.js?v=154";

initializeAnalytics();

const DEFAULT_ROW_COUNT = 200;
const APP_SHARE_URL = "https://iku190t.github.io/suijun-voice-book/";
const APP_SHARE_TITLE = "水準ボイス野帳";
const APP_SHARE_TEXT = "水準測量の音声入力Web野帳です。";
const POINT_SUGGESTION_LIMIT = 6;
const POINT_SUGGESTION_SEEDS = ["NO.0", "TP0", "KBM0", "T-0", "BC.0", "SP.0"];
const POINT_NAME_FINALIZE_DELAYS = new Set([500, 1000, 1500, 2000]);
const NUMERIC_FIELDS = new Set(["bs", "fs", "elevation", "planHeight", "distance"]);
const UNSIGNED_DECIMAL_FIELDS = new Set(["bs", "fs", "distance"]);
const COLUMN_DEFINITIONS = [
  { key: "number", label: "No.", baseWidth: 42, toggleable: false },
  { key: "pointName", label: "点名", baseWidth: 116 },
  { key: "distance", label: "距離", baseWidth: 112 },
  { key: "bs", label: "後視", baseWidth: 112 },
  { key: "fs", label: "前視", baseWidth: 112 },
  { key: "roundTrip", label: "往復差", baseWidth: 112 },
  { key: "difference", label: "高低差", baseWidth: 112 },
  { key: "elevation", label: "標高", baseWidth: 112 },
  { key: "planHeight", label: "計画高", baseWidth: 112 },
  { key: "planDifference", label: "差", baseWidth: 112 },
  { key: "note", label: "備考", baseWidth: 180 }
];
const FIELD_COLUMN_KEYS = {
  pointName: "pointName",
  distance: "distance",
  bs: "bs",
  fs: "fs",
  elevation: "elevation",
  planHeight: "planHeight",
  note: "note"
};
const COLLAPSED_COLUMN_BASE_WIDTH = 0;
const tbody = document.querySelector("#notebookBody");
const notice = document.querySelector("#notice");
const notebook = document.querySelector("#notebook");
const tableShell = document.querySelector(".table-shell");
const tableWrap = document.querySelector(".table-wrap");
const stickyTableHeader = document.querySelector("#stickyTableHeader");
const stickyNotebookHeader = document.querySelector("#stickyNotebookHeader");
const hiddenColumnButtons = document.querySelector("#hiddenColumnButtons");
const tolerancePresetSelect = document.querySelector("#tolerancePreset");
const toleranceDistanceModeSelect = document.querySelector("#toleranceDistanceMode");
const manualToleranceDistanceField = document.querySelector("#manualToleranceDistanceField");
const manualToleranceDistanceInput = document.querySelector("#manualToleranceDistance");
const toleranceSettingsDialog = document.querySelector("#toleranceSettingsDialog");
const toleranceSettingsButton = document.querySelector("#toleranceSettingsBtn");
const tolerancePresetSummary = document.querySelector("#tolerancePresetSummary");
const toleranceDistanceSummary = document.querySelector("#toleranceDistanceSummary");
const voiceButton = document.querySelector("#voiceBtn");
const voiceButtonLabel = document.querySelector("#voiceButtonLabel");
const keyboardModeButton = document.querySelector("#keyboardModeBtn");
const voiceStatus = document.querySelector("#voiceStatus");
const lastVoiceValue = document.querySelector("#lastVoiceValue");
const voiceDock = document.querySelector(".voice-dock");
const pointScriptControls = document.querySelector("#pointScriptControls");
const settingsDialog = document.querySelector("#settingsDialog");
const settingsOpenButton = document.querySelector("#settingsOpenBtn");
const pointSuggestions = document.querySelector("#pointSuggestions");
const pointSuggestionButtons = document.querySelector("#pointSuggestionButtons");
const pointClipboardPopover = document.querySelector("#pointClipboardPopover");
const pointCopyButton = document.querySelector("#pointCopyBtn");
const pointPasteButton = document.querySelector("#pointPasteBtn");
const pointIncrementPasteButton = document.querySelector("#pointIncrementPasteBtn");
const planHeightBulkButton = document.querySelector("#planHeightBulkBtn");
const pointClearButton = document.querySelector("#pointClearBtn");
const planHeightBulkDialog = document.querySelector("#planHeightBulkDialog");
const planHeightBulkSheet = document.querySelector("#planHeightBulkSheet");
const planHeightPointList = document.querySelector("#planHeightPointList");
const planHeightSelectAllButton = document.querySelector("#planHeightSelectAllBtn");
const planHeightClearSelectionButton = document.querySelector("#planHeightClearSelectionBtn");
const planHeightRangeButton = document.querySelector("#planHeightRangeBtn");
const planHeightRangeStatus = document.querySelector("#planHeightRangeStatus");
const planHeightBulkValueInput = document.querySelector("#planHeightBulkValue");
const planHeightSelectionCount = document.querySelector("#planHeightSelectionCount");
const applyPlanHeightBulkButton = document.querySelector("#applyPlanHeightBulkBtn");
const rowActionPopover = document.querySelector("#rowActionPopover");
const rowActionButtons = document.querySelector("#rowActionButtons");
const insertRowButton = document.querySelector("#insertRowBtn");
const deleteSelectedRowButton = document.querySelector("#deleteSelectedRowBtn");
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
let pointerTapInput = null;
let pointerTapId = null;
let pointerTapStartX = 0;
let pointerTapStartY = 0;
let pointerTapMoved = false;
let suppressNextCellClick = false;
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
let pointNameIncrementClipboard = "";
let noteClipboard = "";
let lastVoiceValueText = "";
let pointClipboardPositionFrame = null;
let pointClipboardDismissedFor = null;
let planHeightBulkSelectedRows = new Set();
let planHeightRangeMode = false;
let planHeightRangeStart = null;
let planHeightBulkReturnState = null;
let keyboardViewportBaseline = window.visualViewport?.height || window.innerHeight;
let keyboardCellScrollTimer = null;
let keyboardCellScrollTarget = null;
let textMeasureContext = null;
let stickyHeaderFrame = null;
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
  project.settings.voiceRate = clamp(Number(project.settings.voiceRate) || 1.2, 0.5, 1.5);
  project.settings.tableScale = clamp(Number(project.settings.tableScale) || 0.44, 0.4, 1.8);
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
    planHeight: null,
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
      tolerancePreset: "grade4",
      toleranceDistanceMode: "manual",
      manualToleranceDistance: null,
      toleranceDefaultsVersion: 1,
      showDistance: false,
      distanceVisibilityDefaultsVersion: 1,
      visibleColumns: Object.fromEntries(
        COLUMN_DEFINITIONS.map(({ key }) => [
          key,
          key !== "distance" && key !== "note"
        ])
      ),
      columnVisibilityDefaultsVersion: 3,
      voiceRate: 1.2,
      pointNameFinalizeDelayMs: 1000,
      voiceSettingsVersion: 3,
      autoVoiceCursorMove: true,
      sheetMeaningVersion: 2,
      tableScale: 0.44,
      tableScaleDefaultsVersion: 2,
      sampleDataDefaultsVersion: 5,
      pointAliases: [],
      pointNameScripts: {
        kanji: false,
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

function createSampleProject() {
  const sample = createBlankProject();
  const outSampleRows = [
    { pointName: "KBM1", bs: 1.567, elevation: 100, elevationType: "manual" },
    { pointName: "PF-2", bs: 3.074, fs: 0.898 },
    { pointName: "TP", bs: 3.901, fs: 0.834 },
    { pointName: "TF-3", fs: 1.333 },
    { pointName: "TF-4", fs: 1.257 },
    { pointName: "6K400", fs: 1.595 }
  ];
  const backSampleRows = [
    { pointName: "6K400", bs: 1.619 },
    { pointName: "TF-4", fs: 1.283 },
    { pointName: "TF-3", fs: 1.359 },
    { pointName: "TP", bs: 0.828, fs: 3.925 },
    { pointName: "PF-2", bs: 0.912, fs: 3.064 },
    { pointName: "KBM1", fs: 1.581 }
  ];
  outSampleRows.forEach((values, index) => {
    Object.assign(sample.sheets.out[index], values);
  });
  backSampleRows.forEach((values, index) => {
    Object.assign(sample.sheets.back[index], values);
  });
  return sample;
}

function isKnownLegacyDemoProject(outRows, backRows) {
  const expectedBackBs = [1.336, 2.003, 1.553, 3.005, 2.005];
  const outHasObservations = outRows.some(rowHasLevelObservationData);
  const backHasUnexpectedObservations = backRows.some((row, index) => {
    if (index < expectedBackBs.length) {
      return row.bs !== expectedBackBs[index] ||
        row.fs !== null ||
        row.distance !== null ||
        row.elevationType === "manual";
    }
    return rowHasLevelObservationData(row);
  });
  return !outHasObservations && !backHasUnexpectedObservations;
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
    planHeight: toNumber(row?.planHeight),
    distance: toNumber(row?.distance)
  };
}

function normalizeLoadedProject(loaded) {
  const blank = loaded ? createBlankProject() : createSampleProject();
  if (!loaded) return blank;

  let outRows = [];
  let backRows = [];
  if (loaded.sheets) {
    const alignedSheets = alignSheetsWithCurrentLabels(
      loaded.sheets,
      loaded.settings?.sheetMeaningVersion
    );
    outRows = alignedSheets.out;
    backRows = alignedSheets.back;
  } else if (Array.isArray(loaded.rows)) {
    outRows = loaded.rows.filter((row) => row.route !== "back");
    backRows = loaded.rows.filter((row) => row.route === "back");
  }

  outRows = outRows.map((row) => normalizeRow(row, "out"));
  backRows = backRows.map((row) => normalizeRow(row, "back"));
  const shouldAddInitialSample =
    (Number(loaded.settings?.sampleDataDefaultsVersion) || 0) < 5 &&
    (
      !outRows.some(rowHasLevelObservationData) &&
        !backRows.some(rowHasLevelObservationData) ||
      isKnownLegacyDemoProject(outRows, backRows)
    );
  if (shouldAddInitialSample) {
    const sample = createSampleProject();
    outRows = sample.sheets.out;
    backRows = sample.sheets.back;
  }
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
  const hasCurrentVoiceDefaults = Number(loaded.settings?.voiceSettingsVersion) >= 2;
  const hasCurrentToleranceDefaults = Number(loaded.settings?.toleranceDefaultsVersion) >= 1;
  const hasCurrentTableScaleDefaults = Number(loaded.settings?.tableScaleDefaultsVersion) >= 2;
  const loadedTableScale = Number(loaded.settings?.tableScale);
  const columnVisibilityDefaultsVersion =
    Number(loaded.settings?.columnVisibilityDefaultsVersion) || 0;
  const hasSavedColumnVisibility = columnVisibilityDefaultsVersion >= 1;
  const loadedVisibleColumns =
    loaded.settings?.visibleColumns && typeof loaded.settings.visibleColumns === "object"
      ? loaded.settings.visibleColumns
      : {};
  const visibleColumns = Object.fromEntries(
    COLUMN_DEFINITIONS.map((definition) => {
      const { key } = definition;
      const visible = definition.toggleable === false
        ? true
        : key === "note" && columnVisibilityDefaultsVersion < 3
          ? true
        : hasSavedColumnVisibility
          ? loadedVisibleColumns[key] !== false
          : key === "distance"
            ? loaded.settings?.showDistance === true
            : true;
      return [key, visible];
    })
  );

  return {
    version: 5,
    settings: {
      ...blank.settings,
      ...(loaded.settings || {}),
      voiceRate: hasCurrentVoiceDefaults
        ? clamp(Number(loaded.settings?.voiceRate) || 1.2, 0.5, 1.5)
        : 1.2,
      pointNameFinalizeDelayMs: POINT_NAME_FINALIZE_DELAYS.has(
        Number(loaded.settings?.pointNameFinalizeDelayMs)
      )
        ? Number(loaded.settings.pointNameFinalizeDelayMs)
        : 1000,
      voiceSettingsVersion: 3,
      autoVoiceCursorMove: loaded.settings?.autoVoiceCursorMove !== false,
      sheetMeaningVersion: 2,
      tolerancePreset: hasCurrentToleranceDefaults &&
        LEVELING_TOLERANCE_PRESETS[loaded.settings?.tolerancePreset]
        ? loaded.settings.tolerancePreset
        : "grade4",
      toleranceDistanceMode: hasCurrentToleranceDefaults
        ? loaded.settings?.toleranceDistanceMode === "manual"
          ? "manual"
          : "sheet"
        : "manual",
      manualToleranceDistance: (() => {
        if (!hasCurrentToleranceDefaults) return null;
        const value = toNumber(loaded.settings?.manualToleranceDistance);
        return value !== null && value > 0 ? value : null;
      })(),
      toleranceDefaultsVersion: 1,
      showDistance: visibleColumns.distance,
      distanceVisibilityDefaultsVersion: 1,
      visibleColumns,
      columnVisibilityDefaultsVersion: 3,
      tableScale: hasCurrentTableScaleDefaults
        ? clamp(loadedTableScale || 0.44, 0.4, 1.8)
        : Number.isFinite(loadedTableScale) && loadedTableScale !== 1 && loadedTableScale !== 0.5
          ? clamp(loadedTableScale, 0.4, 1.8)
          : 0.44,
      tableScaleDefaultsVersion: 2,
      sampleDataDefaultsVersion: 5,
      pointAliases: loadedAliases,
      pointNameScripts: {
        kanji: hasCurrentVoiceDefaults && loadedScripts.kanji === true,
        hiragana: hasCurrentVoiceDefaults && loadedScripts.hiragana === true,
        katakana: hasCurrentVoiceDefaults && loadedScripts.katakana === true
      },
      pointNameHistory: loadedHistory
    },
    sheets: { out: outRows, back: backRows },
    savedAt: loaded.savedAt || null
  };
}

const storedProject = loadProject();
let project = normalizeLoadedProject(storedProject);
if (
  !storedProject ||
  Number(storedProject.settings?.toleranceDefaultsVersion) < 1 ||
  Number(storedProject.settings?.tableScaleDefaultsVersion) < 2 ||
  Number(storedProject.settings?.distanceVisibilityDefaultsVersion) < 1 ||
  Number(storedProject.settings?.columnVisibilityDefaultsVersion) < 3 ||
  (Number(storedProject.settings?.sampleDataDefaultsVersion) || 0) < 5
) {
  project = saveProject(project);
}
project.settings.voiceRate = clamp(Number(project.settings.voiceRate) || 1.2, 0.5, 1.5);
project.settings.tableScale = clamp(Number(project.settings.tableScale) || 0.44, 0.4, 1.8);
if (!LEVELING_TOLERANCE_PRESETS[project.settings.tolerancePreset]) {
  project.settings.tolerancePreset = "grade4";
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

function fitTextInputToCell(input) {
  if (!input?.matches?.('input[data-field="pointName"], input[data-field="note"]')) return;
  input.style.removeProperty("font-size");
  if (!input.value || input.clientWidth <= 0) return;

  const style = getComputedStyle(input);
  const baseFontSize = Number.parseFloat(style.fontSize) || 19.2;
  const horizontalPadding =
    (Number.parseFloat(style.paddingLeft) || 0) +
    (Number.parseFloat(style.paddingRight) || 0);
  const availableWidth = Math.max(8, input.clientWidth - horizontalPadding - 2);
  textMeasureContext ||= document.createElement("canvas").getContext("2d");
  if (!textMeasureContext) return;
  textMeasureContext.font = [
    style.fontStyle,
    style.fontWeight,
    `${baseFontSize}px`,
    style.fontFamily,
  ].join(" ");
  const textWidth = textMeasureContext.measureText(input.value).width;
  if (textWidth <= availableWidth) return;

  const minimumFontSize = Math.min(baseFontSize, Math.max(7, baseFontSize * 0.35));
  const fittedFontSize = Math.max(
    minimumFontSize,
    baseFontSize * availableWidth / textWidth
  );
  input.style.fontSize = `${Math.floor(fittedFontSize * 10) / 10}px`;
}

function fitSheetTextInputs() {
  tbody.querySelectorAll('input[data-field="pointName"], input[data-field="note"]')
    .forEach(fitTextInputToCell);
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
    <td class="elevation-cell calculated${index === 0 ? " starting-elevation-cell" : " locked-elevation-cell"}"><input data-field="elevation" inputmode="decimal" autocomplete="off" aria-label="${index + 1}行目 既知標高または仮標高"${index > 0 ? ' readonly aria-readonly="true" data-calculated-elevation="" tabindex="-1"' : ""}></td>
    <td><input data-field="planHeight" inputmode="decimal" autocomplete="off" aria-label="${index + 1}行目 計画高"></td>
    <td class="calc plan-difference"></td>
    <td><input data-field="note" inputmode="text" autocomplete="off" aria-label="${index + 1}行目 備考"></td>`;
  tr.querySelector('[data-field="pointName"]').value = row.pointName || "";
  tr.querySelector('[data-field="bs"]').value = displayValue(row.bs, row.bs !== null ? 3 : null);
  tr.querySelector('[data-field="fs"]').value = displayValue(row.fs, row.fs !== null ? 3 : null);
  tr.querySelector('[data-field="elevation"]').value = displayValue(row.elevation, row.elevation !== null ? 3 : null);
  tr.querySelector('[data-field="planHeight"]').value = displayValue(row.planHeight, row.planHeight !== null ? 3 : null);
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
  document.body.append(rowActionPopover);
  rowActionPopover.hidden = true;
  rowActionButtons.hidden = false;
  tbody.querySelectorAll(".point-clipboard-anchor").forEach((cell) => {
    cell.classList.remove("point-clipboard-anchor");
  });
  tbody.querySelectorAll(".row-action-anchor").forEach((cell) => {
    cell.classList.remove("row-action-anchor");
  });
  tbody.querySelectorAll("tr.row-action-selected").forEach((row) => {
    row.classList.remove("row-action-selected");
  });
  hidePointSuggestions();
  const fragment = document.createDocumentFragment();
  project.sheets[activeSheet].forEach((row, index) => fragment.appendChild(rowTemplate(row, index)));
  tbody.replaceChildren(fragment);
  syncVoiceInputLocks();
  const currentName = activeSheet === "out" ? "往路" : "復路";
  const destinationName = activeSheet === "out" ? "復路" : "往路";
  document.body.classList.toggle("back-sheet-active", activeSheet === "back");
  sheetToggleButton.textContent = currentName;
  sheetToggleButton.setAttribute(
    "aria-label",
    `${currentName}を表示中。押すと${destinationName}に切り替え`
  );
  applyColumnVisibility();
  applyTableScale(project.settings.tableScale);
  recalculateAndRender();
  updateHistoryButtons();
  updatePointClipboardButtons();
}

function isColumnVisible(key) {
  return project.settings.visibleColumns?.[key] !== false;
}

function isFieldColumnVisible(field) {
  const key = FIELD_COLUMN_KEYS[field];
  return key ? isColumnVisible(key) : true;
}

function initializeColumnVisibilityControls() {
  [notebook, stickyNotebookHeader].forEach((table) => {
    const cells = [...(table.tHead?.rows[0]?.cells || [])];
    COLUMN_DEFINITIONS.forEach((definition, index) => {
      const cell = cells[index];
      if (!cell) return;
      cell.dataset.columnKey = definition.key;
      cell.classList.add("column-heading");
      const label = document.createElement("span");
      label.className = "column-heading-label";
      label.textContent = definition.label;
      cell.replaceChildren(label);
      if (definition.toggleable === false) return;
      cell.dataset.columnHide = definition.key;
      cell.classList.add("column-hide-trigger");
      cell.tabIndex = 0;
      cell.setAttribute("role", "button");
      cell.setAttribute("aria-label", `${definition.label}列を非表示`);
    });
  });
}

function renderHiddenColumnButtons() {
  const fragment = document.createDocumentFragment();
  COLUMN_DEFINITIONS.forEach((definition) => {
    if (definition.toggleable === false || isColumnVisible(definition.key)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.columnRestore = definition.key;
    button.textContent = definition.label;
    button.setAttribute("aria-label", `${definition.label}列を表示`);
    fragment.appendChild(button);
  });
  hiddenColumnButtons.replaceChildren(fragment);
  hiddenColumnButtons.hidden = hiddenColumnButtons.childElementCount === 0;
}

function applyColumnVisibility() {
  project.settings.showDistance = isColumnVisible("distance");
  [notebook, stickyNotebookHeader].forEach((table) => {
    const rows = [...table.rows];
    COLUMN_DEFINITIONS.forEach((definition, index) => {
      const visible = isColumnVisible(definition.key);
      rows.forEach((row) => {
        row.cells[index]?.classList.toggle("column-collapsed", !visible);
      });
      if (definition.toggleable === false) return;
      const heading = table.tHead?.rows[0]?.cells[index];
      if (!heading) return;
      heading.classList.toggle("column-hide-trigger", visible);
      if (visible) {
        heading.dataset.columnHide = definition.key;
        heading.tabIndex = 0;
        heading.setAttribute("role", "button");
        heading.setAttribute("aria-label", `${definition.label}列を非表示`);
      } else {
        delete heading.dataset.columnHide;
        heading.removeAttribute("tabindex");
        heading.removeAttribute("role");
        heading.removeAttribute("aria-label");
      }
    });
  });
  renderHiddenColumnButtons();
  if (selectedInput && !isFieldColumnVisible(selectedInput.dataset.field)) {
    selectedInput.blur();
    selectedInput = null;
    voiceTarget = null;
    hidePointSuggestions();
    hidePointClipboardPopover();
  }
  scheduleStickyTableHeader();
}

function applyTableScale(value) {
  const scale = clamp(Number(value) || 1, 0.4, 1.8);
  project.settings.tableScale = scale;
  const tableMinimumWidth = COLUMN_DEFINITIONS.reduce((total, definition) => {
    return total + (
      isColumnVisible(definition.key)
        ? definition.baseWidth
        : COLLAPSED_COLUMN_BASE_WIDTH
    );
  }, 0);
  const pixels = {
    "--table-min-width": tableMinimumWidth,
    "--collapsed-column-width": COLLAPSED_COLUMN_BASE_WIDTH,
    "--row-height": 48,
    "--input-height": 47,
    "--number-width": 42,
    "--point-width": 116,
    "--distance-width": 112,
    "--reading-width": 112,
    "--difference-width": 112,
    "--round-trip-width": 112,
    "--elevation-width": 112,
    "--plan-height-width": 112,
    "--plan-difference-width": 112,
    "--note-width": 180,
    "--input-font-size": 19.2,
    "--header-font-size": 19.2
  };
  Object.entries(pixels).forEach(([property, base]) => {
    const size = `${Math.round(base * scale * 10) / 10}px`;
    notebook.style.setProperty(property, size);
    stickyNotebookHeader.style.setProperty(property, size);
  });
  requestAnimationFrame(fitSheetTextInputs);
  scheduleStickyTableHeader();
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
  Object.values(project.sheets).forEach((rows) => {
    rows.forEach((row, index) => {
      if (index > 0) row.elevationType = "calculated";
    });
  });
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
      ? formatRoundTripMillimeters(
        row._roundTripDifferenceMm,
        row._roundTripDifferenceIntermediate
      )
      : "";
    const elevationInput = tr.querySelector('[data-field="elevation"]');
    if (document.activeElement !== elevationInput || row.elevationType === "calculated") {
      elevationInput.value = displayValue(row.elevation, row.elevation !== null ? 3 : null);
    }
    const cell = elevationInput.closest(".elevation-cell");
    cell.classList.toggle("manual", row.elevationType === "manual" && row.elevation !== null);
    cell.classList.toggle("calculated", row.elevationType !== "manual" || row.elevation === null);
    const planDifference = Number.isFinite(row.elevation) && Number.isFinite(row.planHeight)
      ? row.elevation - row.planHeight
      : null;
    const planDifferenceCell = tr.querySelector(".plan-difference");
    planDifferenceCell.textContent = Number.isFinite(planDifference)
      ? `${planDifference > 0 ? "+" : ""}${planDifference.toFixed(3)}`
      : "";
    planDifferenceCell.classList.toggle(
      "negative",
      Number.isFinite(planDifference) && planDifference < 0
    );
  });

  const outDifference = calculations.out.outDifference;
  const backDifference = calculations.back.backDifference;
  document.querySelector("#outDiff").textContent = formatMeters(outDifference);
  document.querySelector("#backDiff").textContent = formatMeters(backDifference);
  updateToleranceDisplay(toleranceState);
  updateClosure(outDifference, backDifference, toleranceState.toleranceMm);
}

function stripCalculatedFields(rows) {
  return rows.map(({
    _complete,
    _incomplete,
    _difference,
    _roundTripDifferenceMm,
    _roundTripDifferenceIntermediate,
    _intermediateSight,
    ...row
  }) => row);
}

function getToleranceState() {
  const presetKey = project.settings.tolerancePreset;
  const preset = LEVELING_TOLERANCE_PRESETS[presetKey] || LEVELING_TOLERANCE_PRESETS.grade4;
  const distanceMode = project.settings.toleranceDistanceMode === "manual"
    ? "manual"
    : "sheet";
  const distanceMeters = resolveToleranceDistanceMeters({
    mode: distanceMode,
    manualDistanceMeters: project.settings.manualToleranceDistance,
    outRows: project.sheets.out,
    backRows: project.sheets.back
  });
  return {
    presetKey,
    preset,
    distanceMode,
    distanceMeters,
    toleranceMm: calculateToleranceMm(presetKey, distanceMeters)
  };
}

function updateToleranceDisplay(toleranceState) {
  tolerancePresetSelect.value = toleranceState.presetKey;
  toleranceDistanceModeSelect.value = toleranceState.distanceMode;
  tolerancePresetSummary.textContent = toleranceState.preset.label;
  toleranceDistanceSummary.textContent = toleranceState.distanceMeters === null
    ? toleranceState.distanceMode === "manual" ? "手入力" : "距離待ち"
    : `${toleranceState.distanceMode === "manual" ? "手入力" : "シート"} ${Math.round(toleranceState.distanceMeters)}m`;
  manualToleranceDistanceField.hidden = toleranceState.distanceMode !== "manual";
  if (document.activeElement !== manualToleranceDistanceInput) {
    const manualDistance = toNumber(project.settings.manualToleranceDistance);
    manualToleranceDistanceInput.value = manualDistance !== null && manualDistance > 0
      ? String(Math.round(manualDistance))
      : "";
  }
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
  if (isCalculatedElevationInput(input)) {
    recalculateAndRender();
    return false;
  }
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
  fitTextInputToCell(input);
  scheduleAutosave();
  return true;
}

function updateRowSelectorIndicators(activeIndex = null) {
  const selectedIndex = activeIndex ?? (
    selectedInput?.isConnected ? findRowIndex(selectedInput) : -1
  );
  Array.from(tbody.rows).forEach((row, index) => {
    const selector = row.querySelector(".row-selector");
    if (!selector) return;
    const isActive = index === selectedIndex;
    selector.textContent = isActive ? "⋮" : String(index + 1);
    selector.classList.toggle("is-active", isActive);
    selector.setAttribute(
      "aria-label",
      index === selectedIndex
        ? `${index + 1}行目の挿入・削除`
        : `${index + 1}行目`
    );
  });
}

function closeRowActionPopover() {
  rowActionPopover.hidden = true;
  rowActionButtons.hidden = false;
  rowActionPopover.parentElement?.classList.remove("row-action-anchor");
  tbody.querySelectorAll("tr.row-action-selected").forEach((row) => {
    row.classList.remove("row-action-selected");
  });
  selectedRowIndex = null;
  updateRowSelectorIndicators();
  updatePointClipboardButtons();
}

function openRowActionPopover(selector) {
  const rowIndex = findRowIndex(selector);
  if (rowIndex < 0) return;
  closeRowActionPopover();
  selectedRowIndex = rowIndex;
  updateRowSelectorIndicators(rowIndex);
  tbody.rows[rowIndex]?.classList.add("row-action-selected");
  pointClipboardPopover.hidden = true;
  pointClipboardPopover.parentElement?.classList.remove("point-clipboard-anchor");
  const anchorCell = selector.closest("td");
  anchorCell.classList.add("row-action-anchor");
  anchorCell.append(rowActionPopover);
  rowActionButtons.hidden = false;
  rowActionPopover.hidden = false;
}

function markSelectedInput(input) {
  if (!rowActionPopover.hidden) closeRowActionPopover();
  tbody.querySelectorAll(".voice-selected").forEach((element) => element.classList.remove("voice-selected"));
  if (input !== pointClipboardDismissedFor) pointClipboardDismissedFor = null;
  selectedInput = input;
  input?.classList.add("voice-selected");
  updateRowSelectorIndicators();
  updatePointClipboardButtons();
}

function incrementClipboardPointName(value) {
  const normalized = normalizePointName(value, project.settings.pointAliases);
  if (!normalized || !/\d+$/.test(normalized)) return "";
  return incrementPointNameOrCopy(normalized, project.settings.pointAliases);
}

function updatePointClipboardButtons() {
  const cellSelected = Boolean(
    !voiceSessionActive &&
    selectedInput?.isConnected &&
    !isCalculatedElevationInput(selectedInput)
  );
  const pointSelected = cellSelected && selectedInput.dataset.field === "pointName";
  const noteSelected = cellSelected && selectedInput.dataset.field === "note";
  const planHeightSelected = cellSelected && selectedInput.dataset.field === "planHeight";
  const textSelected = pointSelected || noteSelected;
  const clearOnlySelected = Boolean(
    cellSelected &&
    !textSelected &&
    !planHeightSelected
  );
  const dismissed = textSelected && selectedInput === pointClipboardDismissedFor;
  const popoverAllowed = (textSelected || planHeightSelected || clearOnlySelected) && !dismissed;
  const clipboardValue = pointSelected ? pointNameClipboard : noteSelected ? noteClipboard : "";
  pointClipboardPopover.classList.toggle("clear-only", clearOnlySelected);
  pointClipboardPopover.classList.toggle("plan-height-actions", planHeightSelected);
  pointClipboardPopover.hidden = !popoverAllowed;
  pointClipboardPopover.setAttribute(
    "aria-label",
    planHeightSelected
      ? "選択した計画高の一括設定とクリア"
      : noteSelected
      ? "選択した備考のコピー、貼り付け、クリア"
      : pointSelected
        ? "選択した点名のコピー、貼り付け、クリア"
        : "選択したセルのクリア"
  );
  pointCopyButton.hidden = !textSelected;
  pointCopyButton.disabled = !textSelected || !selectedInput.value.trim();
  pointPasteButton.disabled = !textSelected || !clipboardValue;
  pointPasteButton.hidden = !textSelected || !clipboardValue;
  pointPasteButton.textContent = clipboardValue;
  pointPasteButton.setAttribute(
    "aria-label",
    noteSelected ? "コピーした備考を貼り付け" : "コピーした点名を貼り付け"
  );
  pointIncrementPasteButton.disabled = !pointSelected || !pointNameIncrementClipboard;
  pointIncrementPasteButton.hidden = !pointSelected || !pointNameIncrementClipboard;
  pointIncrementPasteButton.textContent = pointNameIncrementClipboard;
  planHeightBulkButton.hidden = !planHeightSelected;
  planHeightBulkButton.disabled = !planHeightSelected;
  pointClearButton.hidden = !textSelected && !planHeightSelected && !clearOnlySelected;
  pointClearButton.disabled = !cellSelected || !selectedInput.value.trim();
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
    !selectedInput?.isConnected
  ) return;
  pointClipboardPopover.classList.remove("place-left");
}

function schedulePointClipboardPosition() {
  if (pointClipboardPositionFrame !== null) return;
  pointClipboardPositionFrame = requestAnimationFrame(() => {
    pointClipboardPositionFrame = null;
    positionPointClipboardPopover();
  });
}

function isCalculatedElevationInput(input) {
  return Boolean(input?.matches?.(
    'input[data-field="elevation"][data-calculated-elevation]'
  ));
}

function syncVoiceInputLocks() {
  const locked = voiceModeActive || voiceSessionActive;
  tbody.querySelectorAll("input").forEach((input) => {
    input.readOnly = locked || isCalculatedElevationInput(input);
  });
  if (locked) document.activeElement?.blur();
}

function updateLastVoiceValueUi() {
  const visible = Boolean(voiceModeActive && lastVoiceValueText);
  lastVoiceValue.hidden = !visible;
  lastVoiceValue.textContent = visible ? lastVoiceValueText : "";
}

function setLastVoiceValue(value) {
  lastVoiceValueText = String(value ?? "").trim();
  updateLastVoiceValueUi();
}

function updateVoiceModeUi() {
  document.body.classList.toggle("voice-mode-active", voiceModeActive);
  voiceButton.classList.toggle("voice-mode", voiceModeActive);
  keyboardModeButton.hidden = !voiceModeActive;
  keyboardModeButton.disabled = voiceSessionActive;
  if (!voiceSessionActive) {
    voiceButton.classList.remove("listening");
    voiceButtonLabel.textContent = voiceModeActive ? "🎤 聞き取る" : "🎤 音声モード";
  }
  updateLastVoiceValueUi();
}

function setVoiceModeActive(active) {
  const previous = voiceModeActive;
  const activating = Boolean(active) && !voiceModeActive;
  voiceModeActive = Boolean(active);
  if (activating) lastVoiceValueText = "";
  if (!voiceModeActive) voiceTarget = null;
  syncVoiceInputLocks();
  updateVoiceModeUi();
  updatePointClipboardButtons();
  hidePointSuggestions();
  if (previous !== voiceModeActive) {
    trackEvent("voice_mode_change", { state: voiceModeActive ? "on" : "off" });
  }
}

function setVoiceSessionActive(active) {
  voiceSessionActive = Boolean(active);
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
  if (isCalculatedElevationInput(input)) {
    voiceTarget = null;
    markSelectedInput(input);
    input.blur();
    hidePointSuggestions();
    return;
  }
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
  const rankedCandidates = getRankedPointNameCandidates(
    namesAboveCurrentRow,
    project.settings.pointAliases,
    project.settings.pointNameHistory,
    POINT_SUGGESTION_SEEDS,
    12,
    input.value
  );
  const currentPointName = normalizePointName(
    input.value,
    project.settings.pointAliases
  );
  const incrementedCandidate = incrementPointNameOrCopy(
    namesAboveCurrentRow.at(-1),
    project.settings.pointAliases
  );
  const offsetPatternCandidates = getOffsetPointNameCandidates(
    namesAboveCurrentRow.at(-1),
    project.settings.pointAliases
  );
  const baseNoOffsetCandidates = getBaseNoOffsetCandidates(
    namesAboveCurrentRow.at(-1),
    project.settings.pointAliases
  );
  const offsetPatternBase = normalizePointName(
    namesAboveCurrentRow.at(-1),
    project.settings.pointAliases
  ).match(/^(NO\.?\d+)\+\d+$/i)?.[1] || "";
  const rankedCandidatesWithOffsetPatterns = [
    ...baseNoOffsetCandidates,
    ...offsetPatternCandidates.slice(1),
    ...rankedCandidates.filter((pointName) => (
      !offsetPatternCandidates.length ||
      !pointName.startsWith(`${offsetPatternBase}+`) ||
      offsetPatternCandidates.includes(pointName)
    ))
  ];
  const confusionCandidates = currentPointName
    ? getPointNameConfusionCandidates(
      currentPointName,
      project.settings.pointAliases,
      namesAboveCurrentRow,
      project.settings.pointNameHistory,
      POINT_SUGGESTION_LIMIT - 1
    )
    : [];
  const candidate = rankedCandidatesWithOffsetPatterns.find((pointName) => (
    pointName !== incrementedCandidate &&
    pointName !== currentPointName
  ));
  const uniqueCandidates = composePointNameSuggestionCandidates(
    rankedCandidatesWithOffsetPatterns,
    currentPointName,
    confusionCandidates,
    POINT_SUGGESTION_LIMIT,
    incrementedCandidate
  );
  if (!uniqueCandidates.length) {
    hidePointSuggestions();
    return;
  }
  const buttons = uniqueCandidates.map((pointName) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.pointSuggestion = pointName;
    if (pointName === incrementedCandidate) {
      button.classList.add("increment-point-suggestion");
      button.dataset.suggestionRole = "increment";
      button.setAttribute("aria-label", `増番 ${pointName}`);
    } else if (pointName === candidate) {
      button.classList.add("primary-point-suggestion");
      button.dataset.suggestionRole = "candidate";
      button.setAttribute("aria-label", `候補 ${pointName}`);
    }
    if (pointName === currentPointName) {
      button.classList.add("current-point-suggestion");
      button.dataset.suggestionRole = "current";
      button.setAttribute("aria-label", `現在値 ${pointName}`);
    } else if (confusionCandidates.includes(pointName)) {
      button.classList.add("confusion-point-suggestion");
      button.dataset.suggestionRole = "confusion";
    } else if (!button.dataset.suggestionRole) {
      button.dataset.suggestionRole = "other";
    }
    button.textContent = pointName;
    return button;
  });
  pointSuggestionButtons.replaceChildren(...buttons);
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
  voiceButtonLabel.textContent = "🔊 復唱中…";
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

function clearVoiceDockViewportOffset() {
  voiceDock.style.removeProperty("--suggestion-keyboard-shift");
  voiceDock.style.removeProperty("--normal-suggestion-y");
  voiceDock.style.removeProperty("--normal-suggestion-max-height");
  lastVoiceSuggestionShift = Number.NaN;
  lastNormalSuggestionY = Number.NaN;
  lastNormalSuggestionMaxHeight = Number.NaN;
}

function restoreVoiceDockAfterExternalUi() {
  const focusedInput = document.activeElement?.matches?.(
    "#notebookBody input, .point-suggestion-editor input"
  );
  if (!focusedInput) {
    document.body.classList.remove("software-keyboard-open");
    document.body.style.removeProperty("--keyboard-row-clearance");
    keyboardViewportBaseline = window.visualViewport?.height || window.innerHeight;
    clearVoiceDockViewportOffset();
  }
  requestAnimationFrame(() => {
    updateSuggestionPosition();
    schedulePointClipboardPosition();
    scheduleStickyTableHeader();
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    clearVoiceDockViewportOffset();
    return;
  }
  restoreVoiceDockAfterExternalUi();
});
window.addEventListener("pageshow", restoreVoiceDockAfterExternalUi);
window.addEventListener("focus", restoreVoiceDockAfterExternalUi);

function ensureFocusedCellAboveKeyboard(input) {
  if (
    !input?.isConnected ||
    document.activeElement !== input ||
    !input.matches("#notebookBody input") ||
    voiceModeActive ||
    voiceSessionActive
  ) return;

  const viewport = window.visualViewport;
  const viewportHeight = viewport?.height || window.innerHeight;
  if (keyboardViewportBaseline - viewportHeight <= 120) return;

  const rowHeight = input.closest("tr")?.getBoundingClientRect().height || 48;
  const visibleTop = viewport?.offsetTop || 0;
  const visibleBottom = visibleTop + viewportHeight;
  const maximumClearance = Math.max(rowHeight, viewportHeight - rowHeight - 72);
  const fourRowClearance = Math.min(rowHeight * 4, maximumClearance);
  const desiredCellBottom = visibleBottom - fourRowClearance - 8;
  const overlap = input.getBoundingClientRect().bottom - desiredCellBottom;
  if (overlap <= 1) return;

  window.scrollBy({
    top: Math.ceil(overlap),
    left: 0,
    behavior: "smooth",
  });
}

function scheduleFocusedCellKeyboardScroll(input = document.activeElement, delay = 120) {
  if (
    !input?.matches?.("#notebookBody input") ||
    voiceModeActive ||
    voiceSessionActive
  ) return;
  keyboardCellScrollTarget = input;
  clearTimeout(keyboardCellScrollTimer);
  keyboardCellScrollTimer = setTimeout(() => {
    keyboardCellScrollTimer = null;
    requestAnimationFrame(() => ensureFocusedCellAboveKeyboard(keyboardCellScrollTarget));
  }, delay);
}

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
  if (keyboardOpen) {
    const rowHeight = document.activeElement.closest("tr")?.getBoundingClientRect().height || 48;
    document.body.style.setProperty("--keyboard-row-clearance", `${Math.ceil(rowHeight * 4 + 16)}px`);
  } else {
    document.body.style.removeProperty("--keyboard-row-clearance");
  }
  return keyboardOpen;
}

function handleKeyboardViewportResize() {
  if (updateSoftwareKeyboardState()) {
    scheduleFocusedCellKeyboardScroll(document.activeElement, 90);
  }
}

window.visualViewport?.addEventListener("resize", handleKeyboardViewportResize);
window.visualViewport?.addEventListener("scroll", updateSoftwareKeyboardState);
window.addEventListener("resize", handleKeyboardViewportResize);

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
  return Array.from(row.querySelectorAll("input"))
    .filter((input) => (
      isFieldColumnVisible(input.dataset.field) &&
      !isCalculatedElevationInput(input)
    ));
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

  if (field === "planHeight") {
    moveStraightDown(current, false);
    return;
  }

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

  if (field === "pointName" && isColumnVisible("distance") && hasDistanceInPreviousRow(rowIndex)) {
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

tbody.addEventListener("focusin", (event) => {
  if (!event.target.matches("input")) return;
  if (isCalculatedElevationInput(event.target)) {
    markSelectedInput(event.target);
    event.target.blur();
    return;
  }
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
  requestAnimationFrame(() => {
    updateSoftwareKeyboardState();
    scheduleFocusedCellKeyboardScroll(event.target, 280);
  });
});

tbody.addEventListener("pointerdown", (event) => {
  const input = event.target.closest("input");
  if (!input) return;
  pointerTapInput = input;
  pointerTapId = event.pointerId;
  pointerTapStartX = event.clientX;
  pointerTapStartY = event.clientY;
  pointerTapMoved = false;
  suppressNextCellClick = false;
  if (
    event.pointerType === "touch" &&
    !voiceModeActive &&
    !voiceSessionActive &&
    !isCalculatedElevationInput(input)
  ) {
    input.readOnly = true;
    input.dataset.touchTapLock = "";
  }
}, { capture: true });

tbody.addEventListener("pointermove", (event) => {
  if (event.pointerId !== pointerTapId) return;
  if (Math.hypot(event.clientX - pointerTapStartX, event.clientY - pointerTapStartY) > 12) {
    pointerTapMoved = true;
    suppressNextCellClick = true;
  }
}, { capture: true, passive: true });

function finishPointerGesture(event, cancelled = false) {
  if (event.pointerId !== pointerTapId) return;
  const input = pointerTapInput;
  const isTap = !cancelled && !pointerTapMoved;
  if (input?.hasAttribute("data-touch-tap-lock")) {
    delete input.dataset.touchTapLock;
    input.readOnly = (
      voiceModeActive ||
      voiceSessionActive ||
      isCalculatedElevationInput(input)
    );
  }
  if (isTap && input?.isConnected) {
    if (isCalculatedElevationInput(input)) {
      voiceTarget = null;
      markSelectedInput(input);
      input.blur();
      hidePointSuggestions();
    } else if (voiceModeActive || voiceSessionActive) {
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

tableWrap.addEventListener("scroll", () => {
  schedulePointClipboardPosition();
  scheduleStickyTableHeader();
}, { passive: true });

function syncStickyHeaderColumns() {
  const sourceCells = [...(notebook.tHead?.rows[0]?.cells || [])];
  const stickyCells = [...(stickyNotebookHeader.tHead?.rows[0]?.cells || [])];
  const sourceTableWidth = notebook.getBoundingClientRect().width;
  if (!sourceTableWidth || sourceCells.length !== stickyCells.length) return;

  const tableWidth = `${sourceTableWidth}px`;
  stickyNotebookHeader.style.width = tableWidth;
  stickyNotebookHeader.style.minWidth = tableWidth;
  stickyCells.forEach((cell, index) => {
    const width = sourceCells[index].getBoundingClientRect().width;
    const cellWidth = `${width}px`;
    cell.style.width = cellWidth;
    cell.style.minWidth = cellWidth;
    cell.style.maxWidth = cellWidth;
  });
}

function updateStickyTableHeader() {
  const wrapRect = tableWrap.getBoundingClientRect();

  const headerHeight = notebook.tHead?.getBoundingClientRect().height || 0;
  const visible = wrapRect.top < 0 && wrapRect.bottom > headerHeight;
  stickyTableHeader.hidden = !visible;
  if (!visible) return;

  const left = Math.max(0, wrapRect.left);
  const width = Math.min(window.innerWidth - left, wrapRect.width);
  stickyTableHeader.style.left = `${Math.round(left)}px`;
  stickyTableHeader.style.width = `${Math.round(width)}px`;
  syncStickyHeaderColumns();

  let translateX = -tableWrap.scrollLeft;
  stickyNotebookHeader.style.transform = `translateX(${translateX}px)`;
  const sourceFirstCell = notebook.tHead?.rows[0]?.cells[0];
  const stickyFirstCell = stickyNotebookHeader.tHead?.rows[0]?.cells[0];
  if (sourceFirstCell && stickyFirstCell) {
    translateX += sourceFirstCell.getBoundingClientRect().left -
      stickyFirstCell.getBoundingClientRect().left;
    stickyNotebookHeader.style.transform = `translateX(${translateX}px)`;
  }
}

function scheduleStickyTableHeader() {
  if (stickyHeaderFrame !== null) return;
  stickyHeaderFrame = requestAnimationFrame(() => {
    stickyHeaderFrame = null;
    updateStickyTableHeader();
  });
}

window.addEventListener("scroll", () => {
  schedulePointClipboardPosition();
  scheduleStickyTableHeader();
}, { passive: true });
window.addEventListener("resize", () => {
  schedulePointClipboardPosition();
  scheduleStickyTableHeader();
}, { passive: true });
window.visualViewport?.addEventListener("resize", () => {
  schedulePointClipboardPosition();
  scheduleStickyTableHeader();
});
window.visualViewport?.addEventListener("scroll", () => {
  schedulePointClipboardPosition();
  scheduleStickyTableHeader();
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
  if (keyboardCellScrollTarget === event.target) {
    keyboardCellScrollTarget = null;
    clearTimeout(keyboardCellScrollTimer);
    keyboardCellScrollTimer = null;
  }
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

function getPlanHeightBulkRows() {
  return project.sheets[activeSheet]
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => String(row.pointName || "").trim());
}

function parsePlanHeightBulkValue() {
  const raw = planHeightBulkValueInput.value.normalize("NFKC").trim().replace(/,/g, "");
  if (!raw) return null;
  return toNumber(raw);
}

function updatePlanHeightBulkControls() {
  const selectedCount = planHeightBulkSelectedRows.size;
  const value = parsePlanHeightBulkValue();
  planHeightSelectionCount.textContent = `${selectedCount}点を選択`;
  applyPlanHeightBulkButton.textContent = selectedCount
    ? `選択した${selectedCount}点に設定`
    : "選択した点に設定";
  applyPlanHeightBulkButton.disabled = selectedCount === 0 || value === null;
  planHeightBulkValueInput.toggleAttribute(
    "aria-invalid",
    Boolean(planHeightBulkValueInput.value.trim() && value === null)
  );
  planHeightRangeButton.setAttribute("aria-pressed", String(planHeightRangeMode));
}

function renderPlanHeightPointList() {
  const fragment = document.createDocumentFragment();
  getPlanHeightBulkRows().forEach(({ row, rowIndex }) => {
    const selected = planHeightBulkSelectedRows.has(rowIndex);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "plan-height-point-option";
    button.dataset.planHeightRow = String(rowIndex);
    button.setAttribute("aria-pressed", String(selected));
    const elevationText = Number.isFinite(row.elevation)
      ? `標高 ${row.elevation.toFixed(3)}`
      : "";
    button.setAttribute(
      "aria-label",
      `No.${rowIndex + 1} ${row.pointName}${elevationText ? ` ${elevationText}` : ""}`
    );
    button.classList.toggle("range-start", planHeightRangeStart === rowIndex);

    const check = document.createElement("span");
    check.className = "plan-height-point-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = "✓";

    const number = document.createElement("span");
    number.className = "plan-height-point-number";
    number.textContent = `No.${rowIndex + 1}`;

    const pointName = document.createElement("strong");
    pointName.className = "plan-height-point-name";
    pointName.textContent = row.pointName;

    const elevation = document.createElement("span");
    elevation.className = "plan-height-elevation";
    elevation.textContent = elevationText;

    button.append(check, number, pointName, elevation);
    fragment.append(button);
  });
  planHeightPointList.replaceChildren(fragment);
  updatePlanHeightBulkControls();
}

function restorePlanHeightBulkReturnCell(state) {
  if (!state || state.sheet !== activeSheet) return;
  const targetRow = Array.from(tbody.rows)
    .find((row) => row.dataset.rowId === state.rowId);
  const target = targetRow?.querySelector(`[data-field="${state.field}"]`);
  if (!target) return;

  if (voiceModeActive || voiceSessionActive) {
    selectVoiceTargetWithoutKeyboard(target);
  } else {
    markSelectedInput(target);
    target.blur();
  }

  const alignToOriginalPosition = () => {
    if (
      state.sheet !== activeSheet ||
      selectedInput !== target ||
      !target.isConnected
    ) return;
    tableWrap.scrollLeft = state.tableScrollLeft;
    window.scrollTo(state.windowScrollX, state.windowScrollY);
    scheduleStickyTableHeader();
    schedulePointClipboardPosition();
  };

  alignToOriginalPosition();
  requestAnimationFrame(() => {
    alignToOriginalPosition();
  });
  [120, 360, 720].forEach((delay) => {
    setTimeout(alignToOriginalPosition, delay);
  });
}

function openPlanHeightBulkDialog() {
  if (
    !selectedInput?.isConnected ||
    selectedInput.dataset.field !== "planHeight"
  ) return;
  const selectedRowIndex = findRowIndex(selectedInput);
  planHeightBulkReturnState = {
    sheet: activeSheet,
    rowId: selectedInput.closest("tr")?.dataset.rowId || "",
    field: selectedInput.dataset.field,
    tableScrollLeft: tableWrap.scrollLeft,
    windowScrollX: window.scrollX,
    windowScrollY: window.scrollY
  };
  planHeightBulkSelectedRows = new Set();
  if (
    selectedRowIndex >= 0 &&
    String(project.sheets[activeSheet][selectedRowIndex]?.pointName || "").trim()
  ) {
    planHeightBulkSelectedRows.add(selectedRowIndex);
  }
  planHeightRangeMode = false;
  planHeightRangeStart = null;
  planHeightRangeStatus.textContent = "点名を個別に選択できます。";
  planHeightBulkSheet.textContent = `${activeSheet === "out" ? "往路" : "復路"}の点名`;
  planHeightBulkValueInput.value = "";
  renderPlanHeightPointList();
  planHeightBulkDialog.showModal();
  requestAnimationFrame(() => {
    planHeightBulkValueInput.focus({ preventScroll: true });
    planHeightBulkValueInput.select();
    planHeightPointList
      .querySelector(`[data-plan-height-row="${selectedRowIndex}"]`)
      ?.scrollIntoView({ block: "center" });
  });
}

planHeightBulkButton.addEventListener("click", openPlanHeightBulkDialog);

planHeightSelectAllButton.addEventListener("click", () => {
  planHeightBulkSelectedRows = new Set(
    getPlanHeightBulkRows().map(({ rowIndex }) => rowIndex)
  );
  planHeightRangeMode = false;
  planHeightRangeStart = null;
  planHeightRangeStatus.textContent = "点名をすべて選択しました。";
  renderPlanHeightPointList();
});

planHeightClearSelectionButton.addEventListener("click", () => {
  planHeightBulkSelectedRows.clear();
  planHeightRangeMode = false;
  planHeightRangeStart = null;
  planHeightRangeStatus.textContent = "選択を解除しました。";
  renderPlanHeightPointList();
});

planHeightRangeButton.addEventListener("click", () => {
  planHeightRangeMode = !planHeightRangeMode;
  planHeightRangeStart = null;
  if (planHeightRangeMode) {
    planHeightBulkSelectedRows.clear();
    planHeightRangeStatus.textContent = "範囲の開始点を押してください。";
  } else {
    planHeightRangeStatus.textContent = "範囲選択を解除しました。";
  }
  renderPlanHeightPointList();
});

planHeightPointList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-plan-height-row]");
  if (!button) return;
  const rowIndex = Number(button.dataset.planHeightRow);
  if (!Number.isInteger(rowIndex)) return;

  if (planHeightRangeMode) {
    if (planHeightRangeStart === null) {
      planHeightRangeStart = rowIndex;
      planHeightBulkSelectedRows.add(rowIndex);
      planHeightRangeStatus.textContent = "範囲の終了点を押してください。";
    } else {
      const start = Math.min(planHeightRangeStart, rowIndex);
      const end = Math.max(planHeightRangeStart, rowIndex);
      planHeightBulkSelectedRows = new Set(
        getPlanHeightBulkRows()
          .map(({ rowIndex: candidateIndex }) => candidateIndex)
          .filter((candidateIndex) => candidateIndex >= start && candidateIndex <= end)
      );
      planHeightRangeMode = false;
      planHeightRangeStart = null;
      planHeightRangeStatus.textContent = `No.${start + 1}からNo.${end + 1}まで選択しました。`;
    }
  } else if (planHeightBulkSelectedRows.has(rowIndex)) {
    planHeightBulkSelectedRows.delete(rowIndex);
  } else {
    planHeightBulkSelectedRows.add(rowIndex);
  }
  renderPlanHeightPointList();
});

planHeightBulkValueInput.addEventListener("input", updatePlanHeightBulkControls);
planHeightBulkValueInput.addEventListener("blur", () => {
  const value = parsePlanHeightBulkValue();
  if (value !== null) planHeightBulkValueInput.value = value.toFixed(3);
  updatePlanHeightBulkControls();
});
planHeightBulkValueInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || applyPlanHeightBulkButton.disabled) return;
  event.preventDefault();
  applyPlanHeightBulkButton.click();
});

applyPlanHeightBulkButton.addEventListener("click", () => {
  const value = parsePlanHeightBulkValue();
  if (value === null || !planHeightBulkSelectedRows.size) {
    planHeightBulkValueInput.setAttribute("aria-invalid", "true");
    return;
  }
  const targetRows = [...planHeightBulkSelectedRows]
    .filter((rowIndex) => project.sheets[activeSheet][rowIndex]);
  if (!targetRows.length) return;

  recordUndoSnapshot(activeSheet, "plan-height-bulk", true);
  targetRows.forEach((rowIndex) => {
    project.sheets[activeSheet][rowIndex].planHeight = value;
  });
  planHeightBulkDialog.close("apply");
  renderSheet();
  scheduleAutosave();
  updateHistoryButtons();
  trackEvent("bulk_plan_height", {
    sheet: activeSheet,
    selected_count: targetRows.length
  });
  showNotice(`${targetRows.length}点の計画高を${value.toFixed(3)}に設定しました。`, "success");
});

planHeightBulkDialog.addEventListener("close", () => {
  const returnState = planHeightBulkReturnState;
  planHeightBulkReturnState = null;
  planHeightBulkSelectedRows.clear();
  planHeightRangeMode = false;
  planHeightRangeStart = null;
  restorePlanHeightBulkReturnCell(returnState);
});

pointCopyButton.addEventListener("click", () => {
  if (
    !selectedInput?.isConnected ||
    !["pointName", "note"].includes(selectedInput.dataset.field)
  ) return;
  const field = selectedInput.dataset.field;
  const value = field === "pointName"
    ? normalizePointName(selectedInput.value, project.settings.pointAliases)
    : selectedInput.value.trim();
  if (!value) return;
  if (field === "pointName") {
    pointNameClipboard = value;
    pointNameIncrementClipboard = incrementClipboardPointName(value);
  } else {
    noteClipboard = value;
  }
  updatePointClipboardButtons();
  showNotice(`「${value}」をコピーしました。`, "success");
});

pointClearButton.addEventListener("click", () => {
  if (
    !selectedInput?.isConnected ||
    !selectedInput.value.trim()
  ) return;
  const target = selectedInput;
  const field = target.dataset.field;
  target.value = "";
  if (!handleFieldChange(target, { forceHistory: true })) return;
  formatNumericInput(target);
  markSelectedInput(target);
  if (voiceModeActive) voiceTarget = target;
  if (!voiceSessionActive && field === "pointName") {
    showPointNameSuggestions(target);
  } else {
    hidePointSuggestions();
  }
  showNotice(
    field === "pointName"
      ? "点名をクリアしました。"
      : field === "note"
        ? "備考をクリアしました。"
        : "セルをクリアしました。",
    "success"
  );
  updatePointClipboardButtons();
});

pointPasteButton.addEventListener("click", async () => {
  if (
    !selectedInput?.isConnected ||
    !["pointName", "note"].includes(selectedInput.dataset.field)
  ) return;
  const target = selectedInput;
  const field = target.dataset.field;
  const clipboardValue = field === "pointName" ? pointNameClipboard : noteClipboard;
  if (!clipboardValue) return;
  target.value = clipboardValue;
  if (!handleFieldChange(target, { forceHistory: true })) return;
  if (field === "pointName") recordPointName(target.value);
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
    field === "pointName"
      ? pointNameToSpeech(target.value, project.settings.pointAliases)
      : target.value,
    project.settings.voiceRate
  );
  if (voiceModeActive) {
    await moveAfterVoiceInput(target);
  }
  updatePointClipboardButtons();
});

pointIncrementPasteButton.addEventListener("click", async () => {
  if (
    !pointNameIncrementClipboard ||
    !selectedInput?.isConnected ||
    selectedInput.dataset.field !== "pointName"
  ) return;
  const target = selectedInput;
  const pastedValue = pointNameIncrementClipboard;
  target.value = pastedValue;
  if (!handleFieldChange(target, { forceHistory: true })) return;
  recordPointName(target.value);
  pointNameIncrementClipboard = incrementClipboardPointName(pastedValue);
  markSelectedInput(target);
  hidePointSuggestions();
  if (!voiceModeActive) {
    target.readOnly = false;
    target.focus({ preventScroll: false });
    const end = target.value.length;
    target.setSelectionRange(end, end);
  }
  voiceStatus.textContent = `${target.value} と増番して貼り付けました`;
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
  event.preventDefault();
  event.stopPropagation();
  openRowActionPopover(selector);
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
    : "grade4";
  recalculateAndRender();
  scheduleAutosave();
});
toleranceSettingsButton.addEventListener("click", () => {
  if (toleranceSettingsDialog.open) return;
  toleranceSettingsDialog.showModal();
  toleranceSettingsButton.setAttribute("aria-expanded", "true");
  trackEvent("open_tolerance_settings");
});
toleranceSettingsDialog.addEventListener("close", () => {
  toleranceSettingsButton.setAttribute("aria-expanded", "false");
});
toleranceDistanceModeSelect.addEventListener("change", (event) => {
  project.settings.toleranceDistanceMode = event.target.value === "manual"
    ? "manual"
    : "sheet";
  recalculateAndRender();
  scheduleAutosave();
  trackEvent("change_tolerance_distance_mode", {
    mode: project.settings.toleranceDistanceMode
  });
});
manualToleranceDistanceInput.addEventListener("input", (event) => {
  const sanitized = sanitizeUnsignedDecimal(event.target.value);
  if (event.target.value !== sanitized) event.target.value = sanitized;
  const distance = toNumber(sanitized);
  project.settings.manualToleranceDistance = distance !== null && distance > 0
    ? distance
    : null;
  recalculateAndRender();
  scheduleAutosave();
});
manualToleranceDistanceInput.addEventListener("blur", () => {
  updateToleranceDisplay(getToleranceState());
});

insertRowButton.addEventListener("click", () => {
  if (selectedRowIndex === null) return;
  recordUndoSnapshot(activeSheet, "row-insert", true);
  project.sheets.out.splice(selectedRowIndex, 0, createRow("out"));
  project.sheets.back.splice(selectedRowIndex, 0, createRow("back"));
  closeRowActionPopover();
  renderSheet();
  scheduleAutosave();
  trackEvent("insert_row", { sheet: activeSheet });
});
deleteSelectedRowButton.addEventListener("click", () => {
  if (selectedRowIndex === null) return;
  const rows = project.sheets[activeSheet];
  if (rows.length <= 1) {
    showNotice("最後の1行は削除できません。", "error");
    return;
  }
  recordUndoSnapshot(activeSheet, "row-delete", true);
  project.sheets.out.splice(selectedRowIndex, 1);
  project.sheets.back.splice(selectedRowIndex, 1);
  closeRowActionPopover();
  renderSheet();
  scheduleAutosave();
  trackEvent("delete_row", { sheet: activeSheet });
});
document.addEventListener("pointerdown", (event) => {
  if (
    rowActionPopover.hidden ||
    rowActionPopover.contains(event.target) ||
    event.target.closest(".row-selector")
  ) return;
  closeRowActionPopover();
}, { capture: true });
function toggleColumn(key) {
  const definition = COLUMN_DEFINITIONS.find((item) => item.key === key);
  if (!definition || definition.toggleable === false) return;
  project.settings.visibleColumns[key] = !isColumnVisible(key);
  applyColumnVisibility();
  applyTableScale(project.settings.tableScale);
  scheduleAutosave();
  trackEvent("toggle_column", {
    column: key,
    visible: isColumnVisible(key) ? "yes" : "no"
  });
}

function handleColumnHeadingActivation(event) {
  const heading = event.target.closest("[data-column-hide]");
  if (!heading || !isColumnVisible(heading.dataset.columnHide)) return;
  event.preventDefault();
  event.stopPropagation();
  toggleColumn(heading.dataset.columnHide);
}

function handleColumnHeadingKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  handleColumnHeadingActivation(event);
}

notebook.tHead?.addEventListener("click", handleColumnHeadingActivation);
stickyNotebookHeader.tHead?.addEventListener("click", handleColumnHeadingActivation);
notebook.tHead?.addEventListener("keydown", handleColumnHeadingKeydown);
stickyNotebookHeader.tHead?.addEventListener("keydown", handleColumnHeadingKeydown);
hiddenColumnButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-column-restore]");
  if (!button) return;
  event.preventDefault();
  toggleColumn(button.dataset.columnRestore);
});
document.querySelector("#saveBtn").addEventListener("click", () => {
  project = saveProject(project);
  showNotice("上書き保存しました。", "success");
  trackEvent("save_notebook", { sheet: activeSheet });
});

function createFreshCsvRows() {
  const toleranceState = getToleranceState();
  const outCalculation = calculateNotebook(
    project.sheets.out,
    toleranceState.toleranceMm ?? 10
  );
  const backCalculation = calculateNotebook(
    project.sheets.back,
    toleranceState.toleranceMm ?? 10,
    {
      direction: "up",
      initialElevation: outCalculation.startElevation ?? 0
    }
  );
  applyRoundTripDifferences(outCalculation.rows, backCalculation.rows);
  return {
    outRows: outCalculation.rows,
    backRows: backCalculation.rows
  };
}

document.querySelector("#csvBtn").addEventListener("click", async () => {
  clearVoiceDockViewportOffset();
  let result;
  try {
    result = await exportNotebookCsv(createFreshCsvRows());
  } finally {
    restoreVoiceDockAfterExternalUi();
  }
  if (result) trackEvent("export_csv", { sheet: "both", result });
  if (result === "shared") {
    showNotice("CSVを共有しました。Gmailなどで送信できます。", "success");
  } else if (result === "downloaded") {
    showNotice("往路・復路をCSV出力しました。", "success");
  }
});
const clearDialog = document.querySelector("#clearDialog");
const confirmClearButton = document.querySelector("#confirmClearBtn");
const cancelClearButton = document.querySelector("#cancelClearBtn");

document.querySelector("#clearBtn").addEventListener("click", () => {
  clearDialog.showModal();
});
confirmClearButton.addEventListener("click", () => {
  recordUndoSnapshot(activeSheet, "clear-all", true);
  const settings = { ...project.settings };
  clearProject();
  project = createBlankProject();
  project.settings = settings;
  clearDialog.close();
  renderSheet();
  project = saveProject(project);
  showNotice("すべてのデータを消去しました。", "success");
  trackEvent("clear_sheet", { target: "all" });
});
cancelClearButton.addEventListener("click", () => clearDialog.close());

const supportDialog = document.querySelector("#supportDialog");
document.querySelector("#supportOpenBtn").addEventListener("click", () => {
  supportDialog.showModal();
  trackEvent("open_support");
});

const shareDialog = document.querySelector("#shareDialog");
const shareAppButton = document.querySelector("#shareAppBtn");
const copyShareUrlButton = document.querySelector("#copyShareUrlBtn");

function showShareDialog() {
  if (!shareDialog.open) shareDialog.showModal();
}

async function copyAppShareUrl() {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(APP_SHARE_URL);
  } catch {
    const temporaryInput = document.createElement("textarea");
    temporaryInput.value = APP_SHARE_URL;
    temporaryInput.setAttribute("readonly", "");
    temporaryInput.style.position = "fixed";
    temporaryInput.style.opacity = "0";
    document.body.appendChild(temporaryInput);
    temporaryInput.select();
    document.execCommand("copy");
    temporaryInput.remove();
  }
  copyShareUrlButton.textContent = "コピーしました";
  window.setTimeout(() => {
    copyShareUrlButton.textContent = "URLをコピー";
  }, 1600);
  trackEvent("copy_app_url");
}

shareAppButton.addEventListener("click", async () => {
  if (!navigator.share) {
    showShareDialog();
    trackEvent("open_share_fallback");
    return;
  }
  try {
    await navigator.share({
      title: APP_SHARE_TITLE,
      text: APP_SHARE_TEXT,
      url: APP_SHARE_URL
    });
    trackEvent("share_app");
  } catch (error) {
    if (error?.name === "AbortError") return;
    showShareDialog();
    trackEvent("open_share_fallback");
  }
});
copyShareUrlButton.addEventListener("click", copyAppShareUrl);

const installAppButton = document.querySelector("#installAppBtn");
const installAppSection = document.querySelector("#installAppSection");
const installDialog = document.querySelector("#installDialog");
const installDialogMessage = document.querySelector("#installDialogMessage");
const installDialogSteps = document.querySelector("#installDialogSteps");
let deferredInstallPrompt = null;

function isAppStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

let microphonePermissionConfirmed = false;

async function requestMicrophonePermission() {
  if (microphonePermissionConfirmed || !navigator.mediaDevices?.getUserMedia) {
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
  microphonePermissionConfirmed = true;
}

function showMicrophonePermissionError(errorCode) {
  const message = isIosDevice()
    ? "Safariのマイクを許可してください。Webサイトの設定から変更できます。"
    : "ブラウザのマイクを許可してください。";
  showNotice(message, "error");
  trackEvent("voice_permission_error", { error_code: errorCode });
}

function showInstallInstructions() {
  const ios = isIosDevice();
  installDialogMessage.textContent = ios
    ? "iPhoneではSafariの共有メニューからホーム画面へ追加します。"
    : "ブラウザのメニューから、このWebアプリを端末へ追加できます。";
  const steps = ios
    ? ["Safariでこのページを開く", "共有ボタンを押す", "「ホーム画面に追加」を選ぶ"]
    : ["Chromeの右上にある「︙」を押す", "「アプリをインストール」または「ホーム画面に追加」を選ぶ"];
  installDialogSteps.replaceChildren(...steps.map((step) => {
    const item = document.createElement("li");
    item.textContent = step;
    return item;
  }));
  installDialog.showModal();
  trackEvent("open_install_guide", { platform: ios ? "ios" : "other" });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (!isAppStandalone()) installAppSection.hidden = false;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installAppSection.hidden = true;
  trackEvent("install_app");
});

if (isAppStandalone()) installAppSection.hidden = true;

installAppButton.addEventListener("click", async () => {
  if (isAppStandalone()) {
    installAppSection.hidden = true;
    return;
  }
  if (!deferredInstallPrompt) {
    showInstallInstructions();
    return;
  }
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  trackEvent("install_prompt_result", { outcome: choice.outcome });
  if (choice.outcome === "accepted") installAppSection.hidden = true;
  deferredInstallPrompt = null;
});

const voiceRateInput = document.querySelector("#voiceRate");
const voiceRateValue = document.querySelector("#voiceRateValue");
const pointNameFinalizeDelayInput = document.querySelector("#pointNameFinalizeDelay");
const autoVoiceCursorMoveInput = document.querySelector("#autoVoiceCursorMove");
const pointAliasList = document.querySelector("#pointAliasList");
const pointScriptInputs = [...pointScriptControls.querySelectorAll("[data-point-script]")];
voiceRateInput.value = project.settings.voiceRate.toFixed(1);
voiceRateValue.textContent = `${project.settings.voiceRate.toFixed(1)}倍`;
pointNameFinalizeDelayInput.value = String(project.settings.pointNameFinalizeDelayMs);
autoVoiceCursorMoveInput.checked = project.settings.autoVoiceCursorMove !== false;
pointScriptInputs.forEach((input) => {
  input.checked = Boolean(project.settings.pointNameScripts[input.dataset.pointScript]);
});
settingsOpenButton.addEventListener("click", (event) => {
  event.stopPropagation();
  if (!settingsDialog.open) {
    renderPointAliasEditors();
    settingsDialog.showModal();
    settingsOpenButton.setAttribute("aria-expanded", "true");
    trackEvent("open_settings");
  }
});
settingsDialog.addEventListener("close", () => {
  settingsOpenButton.setAttribute("aria-expanded", "false");
});
voiceRateInput.addEventListener("input", () => {
  project.settings.voiceRate = clamp(Number(voiceRateInput.value) || 1.2, 0.5, 1.5);
  voiceRateValue.textContent = `${project.settings.voiceRate.toFixed(1)}倍`;
  scheduleAutosave();
});
pointNameFinalizeDelayInput.addEventListener("change", () => {
  const delay = Number(pointNameFinalizeDelayInput.value);
  project.settings.pointNameFinalizeDelayMs = POINT_NAME_FINALIZE_DELAYS.has(delay)
    ? delay
    : 1000;
  pointNameFinalizeDelayInput.value = String(project.settings.pointNameFinalizeDelayMs);
  scheduleAutosave();
});
autoVoiceCursorMoveInput.addEventListener("change", () => {
  project.settings.autoVoiceCursorMove = autoVoiceCursorMoveInput.checked;
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
    if (message.includes("復唱")) voiceButtonLabel.textContent = "🔊 復唱中…";
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
    voiceButtonLabel.textContent = listening ? "■ 聞き取り中（押すと中止）" : "🔊 処理中…";
  },
  onError: (errorCode) => {
    const permissionError = [
      "start-timeout",
      "not-allowed",
      "service-not-allowed",
      "audio-capture"
    ].includes(errorCode);
    if (!permissionError) return;
    showMicrophonePermissionError(errorCode);
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
          trackEvent("voice_input_error", { field_group: "level_reading" });
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
          trackEvent("voice_input_error", { field_group: "point_name" });
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
      setLastVoiceValue(target.value);
      if (field === "pointName") recordPointName(value);
      trackEvent("voice_input", {
        field_group: field === "pointName"
          ? "point_name"
          : field === "bs" || field === "fs"
            ? "level_reading"
            : "other"
      });
      voiceStatus.textContent = `${value} と復唱します`;
      voiceButtonLabel.textContent = "🔊 復唱中…";
      const repeatText = field === "pointName"
        ? pointNameToSpeech(value, project.settings.pointAliases)
        : field === "bs" || field === "fs"
          ? levelReadingToSpeech(value)
          : value;
      await speakBack(repeatText, project.settings.voiceRate);
      if (!voiceSessionActive || resultSessionToken !== voiceSessionToken) return;
      if (project.settings.autoVoiceCursorMove) {
        await moveAfterVoiceInput(target);
      }
    } finally {
      if (resultSessionToken === voiceSessionToken) finishVoiceSession();
    }
  },
  shouldFinalize: (transcript, recognitionDetails = {}) => {
    if (!voiceTarget) return false;
    if (voiceTarget.dataset.field === "pointName") {
      const pointName = choosePointName(
        transcript,
        recognitionDetails.alternatives,
        project.settings.pointAliases,
        project.settings.pointNameScripts
      );
      if (!pointName) return false;
      if (recognitionDetails.isFinal) return true;
      const interimKey = [
        transcript,
        ...(recognitionDetails.alternatives || [])
      ].join("\u241f");
      return {
        delayMs: project.settings.pointNameFinalizeDelayMs,
        key: interimKey
      };
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

voiceButton.addEventListener("click", async () => {
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
  const permissionSessionToken = voiceSessionToken;
  setVoiceSessionActive(true);
  voiceButtonLabel.textContent = "● マイク確認中…";
  try {
    await requestMicrophonePermission();
  } catch (error) {
    if (permissionSessionToken !== voiceSessionToken) return;
    finishVoiceSession();
    showMicrophonePermissionError(error?.name || "permission-request-failed");
    return;
  }
  if (!voiceSessionActive || permissionSessionToken !== voiceSessionToken) return;
  voiceButtonLabel.textContent = "● 準備中…";
  voiceController.start();
});

sheetToggleButton.addEventListener("click", () => {
  if (voiceSessionActive) cancelActiveVoiceSession();
  const targetSheet = activeSheet === "out" ? "back" : "out";
  synchronizePointNames(activeSheet, targetSheet);
  activeSheet = targetSheet;
  renderSheet();
  project = saveProject(project);
  trackEvent("switch_sheet", { sheet: activeSheet });
});

keyboardModeButton.addEventListener("click", () => {
  if (voiceSessionActive) return;
  setVoiceModeActive(false);
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

initializeColumnVisibilityControls();
renderSheet();
document.fonts?.ready.then(() => scheduleStickyTableHeader());
