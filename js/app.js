import { calculateNotebook, formatMeters, rowHasData, toNumber } from "./calculation.js";
import { createVoiceController, normalizeSpokenNumber } from "./voice.js";
import { clearProject, formatSavedAt, loadProject, saveProject } from "./storage.js";
import { exportNotebookCsv } from "./export.js";

const DEFAULT_ROW_COUNT = 200;
const NUMERIC_FIELDS = new Set(["bs", "fs", "elevation", "distance"]);
const tbody = document.querySelector("#notebookBody");
const notice = document.querySelector("#notice");
let selectedInput = null;
let autosaveTimer = null;
let calculated = null;

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createRow(route = "out") {
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

function createBlankProject() {
  return {
    version: 2,
    meta: {
      siteName: "",
      workDate: new Date().toISOString().slice(0, 10),
      observer: "",
      lineName: "",
      knownPointName: ""
    },
    settings: { closureToleranceMm: 10 },
    rows: Array.from({ length: DEFAULT_ROW_COUNT }, () => createRow("out")),
    savedAt: null
  };
}

function normalizeLoadedProject(loaded) {
  const blank = createBlankProject();
  if (!loaded || !Array.isArray(loaded.rows)) return blank;
  const rows = loaded.rows.map((row) => ({
    ...createRow(),
    ...row,
    id: row.id || makeId(),
    route: row.route === "back" ? "back" : "out",
    elevationType: row.elevationType === "manual" ? "manual" : "calculated",
    bs: toNumber(row.bs),
    fs: toNumber(row.fs),
    elevation: toNumber(row.elevation),
    distance: toNumber(row.distance)
  }));
  while (rows.length < DEFAULT_ROW_COUNT) rows.push(createRow("out"));
  return {
    ...blank,
    ...loaded,
    meta: { ...blank.meta, ...(loaded.meta || {}) },
    settings: { ...blank.settings, ...(loaded.settings || {}) },
    rows
  };
}

let project = normalizeLoadedProject(loadProject());

function rowTemplate(row, index) {
  const tr = document.createElement("tr");
  tr.dataset.rowId = row.id;
  tr.innerHTML = `
    <td class="sticky-no row-number">${index + 1}</td>
    <td>
      <select data-field="route" aria-label="${index + 1}行目 区分">
        <option value="out">往路</option>
        <option value="back">復路</option>
      </select>
    </td>
    <td class="sticky-point"><input data-field="pointName" inputmode="text" autocomplete="off" aria-label="${index + 1}行目 点名"></td>
    <td><input data-field="bs" inputmode="decimal" autocomplete="off" aria-label="${index + 1}行目 後視 BS"></td>
    <td><input data-field="fs" inputmode="decimal" autocomplete="off" aria-label="${index + 1}行目 前視 FS"></td>
    <td class="calc diff"></td>
    <td class="elevation-cell calculated"><input data-field="elevation" inputmode="decimal" autocomplete="off" aria-label="${index + 1}行目 既知標高または仮標高"></td>
    <td><input data-field="distance" inputmode="decimal" autocomplete="off" aria-label="${index + 1}行目 距離"></td>
    <td><input data-field="note" inputmode="text" autocomplete="off" aria-label="${index + 1}行目 備考"></td>`;
  tr.querySelector('[data-field="route"]').value = row.route;
  return tr;
}

function renderAllRows() {
  const fragment = document.createDocumentFragment();
  project.rows.forEach((row, index) => fragment.appendChild(rowTemplate(row, index)));
  tbody.replaceChildren(fragment);
  updateMetadataInputs();
  recalculateAndRender();
}

function updateMetadataInputs() {
  document.querySelectorAll("[data-meta]").forEach((input) => {
    input.value = project.meta[input.dataset.meta] || "";
  });
  document.querySelector("#closureTolerance").value = project.settings.closureToleranceMm;
  updateSaveStatus();
}

function displayValue(value, digits = null) {
  if (value === null || value === undefined) return "";
  return digits === null ? String(value) : Number(value).toFixed(digits);
}

function recalculateAndRender() {
  calculated = calculateNotebook(project.rows, project.settings.closureToleranceMm);
  project.rows = calculated.rows.map(({ _complete, _incomplete, _difference, ...row }) => row);

  [...tbody.rows].forEach((tr, index) => {
    const row = calculated.rows[index];
    if (!row) return;
    tr.classList.toggle("incomplete", row._incomplete);
    tr.querySelector(".diff").textContent = row._incomplete
      ? "BS/FS要確認"
      : Number.isFinite(row._difference) ? row._difference.toFixed(3) : "";

    const elevationInput = tr.querySelector('[data-field="elevation"]');
    const isFocused = document.activeElement === elevationInput;
    if (!isFocused || row.elevationType === "calculated") {
      elevationInput.value = displayValue(row.elevation, row.elevation !== null ? 3 : null);
    }
    const cell = elevationInput.closest(".elevation-cell");
    cell.classList.toggle("manual", row.elevationType === "manual" && row.elevation !== null);
    cell.classList.toggle("calculated", row.elevationType !== "manual" || row.elevation === null);
  });

  document.querySelector("#outDiff").textContent = formatMeters(calculated.outDifference);
  document.querySelector("#backDiff").textContent = formatMeters(calculated.backDifference);
  document.querySelector("#lastElevation").textContent = formatMeters(calculated.lastElevation);

  const closureCard = document.querySelector("#closureCard");
  const judgement = document.querySelector("#closureJudgement");
  closureCard.classList.remove("pass", "fail", "pending");
  if (calculated.closureMm === null) {
    document.querySelector("#closure").textContent = "—";
    judgement.textContent = "判定待ち";
    closureCard.classList.add("pending");
  } else {
    document.querySelector("#closure").textContent = `${calculated.closureMm.toFixed(1)} mm`;
    judgement.textContent = calculated.closurePassed ? "合格" : "要確認";
    closureCard.classList.add(calculated.closurePassed ? "pass" : "fail");
  }
}

function findRowIndex(element) {
  const tr = element.closest("tr");
  return project.rows.findIndex((row) => row.id === tr?.dataset.rowId);
}

function parseInputValue(input) {
  if (!NUMERIC_FIELDS.has(input.dataset.field)) return input.value;
  if (input.value.trim() === "") return null;
  return toNumber(input.value);
}

function handleFieldChange(input) {
  const index = findRowIndex(input);
  if (index < 0) return;
  const field = input.dataset.field;
  if (field === "route") {
    project.rows[index].route = input.value === "back" ? "back" : "out";
  } else {
    const parsed = parseInputValue(input);
    if (NUMERIC_FIELDS.has(field) && input.value.trim() !== "" && parsed === null) {
      showNotice(`${index + 1}行目の「${input.getAttribute("aria-label").split(" ").slice(1).join(" ")}」は数値で入力してください。`, "error");
      input.setAttribute("aria-invalid", "true");
      return;
    }
    input.removeAttribute("aria-invalid");
    project.rows[index][field] = parsed;
    if (field === "elevation") {
      project.rows[index].elevationType = parsed === null ? "calculated" : "manual";
    }
  }
  recalculateAndRender();
  scheduleAutosave();
}

tbody.addEventListener("focusin", (event) => {
  if (event.target.matches("input")) selectedInput = event.target;
});

tbody.addEventListener("input", (event) => {
  if (event.target.matches("input, select")) handleFieldChange(event.target);
});

tbody.addEventListener("change", (event) => {
  if (event.target.matches("select")) handleFieldChange(event.target);
});

tbody.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches("input, select")) {
    event.preventDefault();
    moveToNextInput(event.target);
  }
});

function moveToNextInput(current) {
  const inputs = [...tbody.querySelectorAll("input:not([disabled]), select:not([disabled])")];
  const index = inputs.indexOf(current);
  if (index >= 0 && index < inputs.length - 1) {
    inputs[index + 1].focus({ preventScroll: false });
  }
}

function addRows(count = 10, route = document.querySelector("#newRowRoute").value) {
  const start = project.rows.length;
  const fragment = document.createDocumentFragment();
  for (let offset = 0; offset < count; offset += 1) {
    const row = createRow(route);
    project.rows.push(row);
    fragment.appendChild(rowTemplate(row, start + offset));
  }
  tbody.appendChild(fragment);
  recalculateAndRender();
  scheduleAutosave();
}

function reverseCopy() {
  const source = project.rows.filter((row) => row.route === "out" && rowHasData(row));
  if (!source.length) {
    showNotice("反転コピーできる往路データがありません。", "error");
    return;
  }

  let targetIndex = project.rows.findIndex((row) => !rowHasData(row));
  if (targetIndex < 0) targetIndex = project.rows.length;
  const needed = targetIndex + source.length - project.rows.length;
  if (needed > 0) addRows(needed, "back");

  [...source].reverse().forEach((sourceRow, offset) => {
    const target = project.rows[targetIndex + offset];
    project.rows[targetIndex + offset] = {
      ...createRow("back"),
      id: target.id,
      pointName: sourceRow.pointName,
      distance: sourceRow.distance,
      note: sourceRow.note
    };
  });
  renderAllRows();
  scheduleAutosave();
  showNotice(`${source.length}行を復路へ反転コピーしました。観測値はコピーしていません。`, "success");
}

function showNotice(message, type = "") {
  notice.textContent = message;
  notice.className = `notice ${type}`.trim();
  notice.hidden = false;
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => { notice.hidden = true; }, 5500);
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  document.querySelector("#saveStatus").textContent = "自動保存：変更あり";
  autosaveTimer = setTimeout(() => persist(false), 700);
}

function persist(showMessage = true) {
  project = saveProject(project);
  updateSaveStatus();
  if (showMessage) showNotice("端末内へ上書き保存しました。", "success");
}

function updateSaveStatus() {
  document.querySelector("#saveStatus").textContent = `自動保存：${formatSavedAt(project.savedAt)}`;
}

document.querySelectorAll("[data-meta]").forEach((input) => {
  input.addEventListener("input", () => {
    project.meta[input.dataset.meta] = input.value;
    scheduleAutosave();
  });
});

document.querySelector("#closureTolerance").addEventListener("input", (event) => {
  const value = Number(event.target.value);
  project.settings.closureToleranceMm = Number.isFinite(value) && value >= 0 ? value : 10;
  recalculateAndRender();
  scheduleAutosave();
});

document.querySelector("#addRowsBtn").addEventListener("click", () => addRows(10));
document.querySelector("#deleteRowBtn").addEventListener("click", () => {
  if (project.rows.length <= 1) return;
  project.rows.pop();
  tbody.lastElementChild?.remove();
  recalculateAndRender();
  scheduleAutosave();
});
document.querySelector("#reverseCopyBtn").addEventListener("click", reverseCopy);
document.querySelector("#saveBtn").addEventListener("click", () => persist(true));
document.querySelector("#loadBtn").addEventListener("click", () => {
  const loaded = loadProject();
  if (!loaded) {
    showNotice("端末内に保存データがありません。", "error");
    return;
  }
  project = normalizeLoadedProject(loaded);
  renderAllRows();
  showNotice("保存データを読み込みました。", "success");
});
document.querySelector("#csvBtn").addEventListener("click", () => {
  exportNotebookCsv(project, calculated.rows);
  showNotice("UTF-8 BOM付きCSVを出力しました。", "success");
});
document.querySelector("#clearBtn").addEventListener("click", () => {
  if (!confirm("現場情報と野帳データをすべて消去しますか？この操作は元に戻せません。")) return;
  clearProject();
  project = createBlankProject();
  renderAllRows();
  persist(false);
  showNotice("データを全消去し、200行の新しい野帳を作成しました。", "success");
});

const supportDialog = document.querySelector("#supportDialog");
document.querySelector("#supportOpenBtn").addEventListener("click", () => supportDialog.showModal());

const voiceButton = document.querySelector("#voiceBtn");
const voiceStatus = document.querySelector("#voiceStatus");
const voiceController = createVoiceController({
  onStatus: (message) => { voiceStatus.textContent = message; },
  onListeningChange: (listening) => {
    voiceButton.classList.toggle("listening", listening);
    voiceButton.textContent = listening ? "● 認識中…" : "🎤 音声入力";
  },
  onResult: (transcript) => {
    if (!selectedInput?.isConnected) {
      voiceStatus.textContent = "先に入力セルを選択してください。";
      return;
    }
    const field = selectedInput.dataset.field;
    const value = NUMERIC_FIELDS.has(field) ? normalizeSpokenNumber(transcript) : transcript.trim();
    selectedInput.value = value;
    handleFieldChange(selectedInput);
    voiceStatus.textContent = `入力しました：${value}`;
    const current = selectedInput;
    moveToNextInput(current);
  }
});

if (!voiceController.supported) {
  voiceButton.disabled = true;
  voiceButton.title = "このブラウザはWeb Speech APIに対応していません";
}

voiceButton.addEventListener("click", () => {
  if (!selectedInput) {
    showNotice("先に野帳の入力セルを選択してください。", "error");
    return;
  }
  voiceController.start();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      showNotice("オフライン機能を開始できませんでした。オンラインでは利用できます。", "error");
    });
  });
}

window.addEventListener("pagehide", () => {
  clearTimeout(autosaveTimer);
  persist(false);
});

renderAllRows();
