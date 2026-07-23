export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim().replace(/,/g, "");
  if (normalized === "") return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function formatMeters(value) {
  return Number.isFinite(value) ? `${value.toFixed(3)} m` : "—";
}

export const LEVELING_TOLERANCE_PRESETS = Object.freeze({
  grade1: { label: "1級", coefficient: 2.5 },
  grade2: { label: "2級", coefficient: 5 },
  grade3: { label: "3級", coefficient: 10 },
  grade4: { label: "4級", coefficient: 20 }
});

export function sumObservationDistanceMeters(rows) {
  return rows.reduce((total, row) => {
    const distance = toNumber(row.distance);
    return distance !== null && distance > 0 ? total + distance : total;
  }, 0);
}

export function calculateToleranceMm(presetKey, distanceMeters) {
  const preset = LEVELING_TOLERANCE_PRESETS[presetKey] || LEVELING_TOLERANCE_PRESETS.grade3;
  const meters = toNumber(distanceMeters);
  if (meters === null || meters <= 0) return null;
  return preset.coefficient * Math.sqrt(meters / 1000);
}

export function rowHasData(row) {
  return Boolean(
    row.pointName ||
    row.note ||
    row.bs !== null ||
    row.fs !== null ||
    row.elevation !== null ||
    row.distance !== null
  );
}

function rowHasPairingData(row) {
  return Boolean(
    row.pointName ||
    row.note ||
    row.bs !== null ||
    row.fs !== null ||
    row.distance !== null ||
    (row.elevationType === "manual" && row.elevation !== null)
  );
}

function calculateNotebookUpward(sourceRows, toleranceMm, options) {
  const rows = sourceRows.map((row) => ({ ...row }));
  const initialElevation = toNumber(options.initialElevation) ?? 0;
  let lastUsedIndex = -1;
  let instrumentHeight = null;
  let heldFs = null;
  let heldFsRowIndex = null;
  let routeEndElevation = null;
  let reconstructedStartElevation = null;
  let validSightCount = 0;

  sourceRows.forEach((row, index) => {
    if (rowHasPairingData(row)) lastUsedIndex = index;
  });

  rows.forEach((row) => {
    row.bs = toNumber(row.bs);
    row.fs = toNumber(row.fs);
    row.distance = toNumber(row.distance);
    row._difference = null;
    row._roundTripDifferenceMm = null;
    row._complete = false;
    row._incomplete = false;
  });

  for (let index = lastUsedIndex; index >= 0; index -= 1) {
    const row = rows[index];
    const bs = row.bs;
    const fs = row.fs;
    const hasBs = bs !== null;
    const hasFs = fs !== null;
    const manualElevation = row.elevationType === "manual"
      ? toNumber(row.elevation)
      : null;
    let resolvedElevation = manualElevation;
    let usesImplicitBaseline = false;

    // 復路の最下段は、既知標高が空欄なら往路起点高（通常0m）を内部基準にする。
    if (hasFs && instrumentHeight === null && resolvedElevation === null) {
      resolvedElevation = initialElevation;
      usesImplicitBaseline = true;
    }

    // 下段で保持したFSから器械高を復元し、上段のBSで標高を逆算する。
    if (hasBs) {
      if (instrumentHeight !== null && heldFs !== null && heldFsRowIndex !== null) {
        if (resolvedElevation === null) {
          resolvedElevation = instrumentHeight - bs;
        }
        const difference = bs - heldFs;
        rows[heldFsRowIndex]._difference = difference;
        rows[heldFsRowIndex]._complete = true;
        validSightCount += 1;
        reconstructedStartElevation = resolvedElevation;
        instrumentHeight = null;
        heldFs = null;
        heldFsRowIndex = null;
      } else {
        row._incomplete = true;
      }
    }

    // 同じ行にBSとFSがある場合も、BSの逆算後に一つ上の区間用FSを保持する。
    if (hasFs) {
      if (resolvedElevation !== null) {
        instrumentHeight = resolvedElevation + fs;
        heldFs = fs;
        heldFsRowIndex = index;
        if (routeEndElevation === null) routeEndElevation = resolvedElevation;
      } else {
        row._incomplete = true;
      }
    }

    if (manualElevation !== null) {
      row.elevation = manualElevation;
      row.elevationType = "manual";
    } else if (usesImplicitBaseline) {
      row.elevation = null;
      row.elevationType = "calculated";
    } else if (resolvedElevation !== null) {
      row.elevation = resolvedElevation;
      row.elevationType = "calculated";
    } else {
      row.elevation = null;
      row.elevationType = "calculated";
    }
  }

  if (heldFsRowIndex !== null) {
    rows[heldFsRowIndex]._incomplete = true;
  }

  const backDifference = validSightCount > 0 &&
    routeEndElevation !== null &&
    reconstructedStartElevation !== null
    ? routeEndElevation - reconstructedStartElevation
    : null;
  const safeTolerance = Number.isFinite(Number(toleranceMm)) && Number(toleranceMm) >= 0
    ? Number(toleranceMm)
    : 10;

  return {
    rows,
    outDifference: null,
    backDifference,
    closureMm: null,
    closurePassed: null,
    toleranceMm: safeTolerance,
    startElevation: reconstructedStartElevation,
    lastElevation: routeEndElevation
  };
}

export function calculateNotebook(sourceRows, toleranceMm = 10, options = {}) {
  if (options.direction === "up") {
    return calculateNotebookUpward(sourceRows, toleranceMm, options);
  }

  const rows = sourceRows.map((row) => ({ ...row }));
  const initialElevation = toNumber(options.initialElevation) ?? 0;
  let instrumentHeight = null;
  let heldBs = null;
  let routeStartElevation = null;
  let lastSightElevation = null;
  let validSightCount = 0;

  rows.forEach((row) => {
    const bs = toNumber(row.bs);
    const fs = toNumber(row.fs);
    const hasBs = bs !== null;
    const hasFs = fs !== null;
    const manualElevation = row.elevationType === "manual"
      ? toNumber(row.elevation)
      : null;
    let resolvedElevation = manualElevation;
    let usesImplicitBaseline = false;
    let validFs = false;
    let invalidObservation = false;

    row.bs = bs;
    row.fs = fs;
    row.distance = toNumber(row.distance);
    row._difference = null;
    row._roundTripDifferenceMm = null;

    // FSは、現在保持している器械高とBSを使って先に計算する。
    if (hasFs) {
      if (instrumentHeight !== null && heldBs !== null) {
        row._difference = heldBs - fs;
        validFs = true;
        validSightCount += 1;
        if (resolvedElevation === null) {
          resolvedElevation = instrumentHeight - fs;
        }
        lastSightElevation = resolvedElevation;
      } else {
        invalidObservation = true;
      }
    }

    // 最初のBS行は、既知標高が空欄なら0mを基準標高とする。
    if (hasBs && resolvedElevation === null && !hasFs && instrumentHeight === null) {
      resolvedElevation = initialElevation;
      usesImplicitBaseline = true;
    }

    // 同じ行にFSとBSがある場合も、上のFS計算後に新しい器械高へ切り替える。
    if (hasBs) {
      if (resolvedElevation !== null) {
        instrumentHeight = resolvedElevation + bs;
        heldBs = bs;
        if (routeStartElevation === null) routeStartElevation = resolvedElevation;
      } else {
        invalidObservation = true;
      }
    }

    if (manualElevation !== null) {
      row.elevation = manualElevation;
      row.elevationType = "manual";
    } else if (usesImplicitBaseline) {
      // 計算内部では0m（または復路の起点高）を使うが、未入力の既知標高セルは空欄を保つ。
      row.elevation = null;
      row.elevationType = "calculated";
    } else if (resolvedElevation !== null) {
      row.elevation = resolvedElevation;
      row.elevationType = "calculated";
    } else {
      row.elevation = null;
      row.elevationType = "calculated";
    }

    row._complete = validFs;
    row._incomplete = invalidObservation;
  });

  const routeDifference = validSightCount > 0 &&
    routeStartElevation !== null &&
    lastSightElevation !== null
    ? lastSightElevation - routeStartElevation
    : null;
  const route = rows.find((row) => row.route === "back") ? "back" : "out";
  const outDifference = route === "out" ? routeDifference : null;
  const backDifference = route === "back" ? routeDifference : null;
  const safeTolerance = Number.isFinite(Number(toleranceMm)) && Number(toleranceMm) >= 0
    ? Number(toleranceMm)
    : 10;

  return {
    rows,
    outDifference,
    backDifference,
    closureMm: null,
    closurePassed: null,
    toleranceMm: safeTolerance,
    startElevation: routeStartElevation,
    lastElevation: lastSightElevation
  };
}

export function applyRoundTripDifferences(outRows, backRows) {
  const maximumLength = Math.max(outRows.length, backRows.length);
  let lastUsedIndex = -1;

  for (let index = 0; index < maximumLength; index += 1) {
    if (rowHasPairingData(outRows[index] || {}) || rowHasPairingData(backRows[index] || {})) {
      lastUsedIndex = index;
    }
  }

  outRows.forEach((row) => { row._roundTripDifferenceMm = null; });
  backRows.forEach((row) => { row._roundTripDifferenceMm = null; });
  if (lastUsedIndex < 0) return;

  const usedRowCount = lastUsedIndex + 1;
  // 高低差は到達した行に記録される。復路は逆向きなので、
  // 往路の行Nに対応するのは「使用行数-N」の復路行になる。
  for (let outIndex = 1; outIndex < usedRowCount; outIndex += 1) {
    const backIndex = usedRowCount - outIndex;
    const outDifference = outRows[outIndex]?._difference;
    const backDifference = backRows[backIndex]?._difference;
    if (!Number.isFinite(outDifference) || !Number.isFinite(backDifference)) continue;

    const differenceMm = Math.abs(outDifference + backDifference) * 1000;
    outRows[outIndex]._roundTripDifferenceMm = differenceMm;
    backRows[backIndex]._roundTripDifferenceMm = differenceMm;
  }
}
