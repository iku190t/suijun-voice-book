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
  const preset =
    LEVELING_TOLERANCE_PRESETS[presetKey] || LEVELING_TOLERANCE_PRESETS.grade3;
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

function safeTolerance(toleranceMm) {
  return Number.isFinite(Number(toleranceMm)) && Number(toleranceMm) >= 0
    ? Number(toleranceMm)
    : 10;
}

function prepareRows(sourceRows) {
  return sourceRows.map((sourceRow) => ({
    ...sourceRow,
    bs: toNumber(sourceRow.bs),
    fs: toNumber(sourceRow.fs),
    distance: toNumber(sourceRow.distance),
    _difference: null,
    _roundTripDifferenceMm: null,
    _complete: false,
    _incomplete: false
  }));
}

function calculateNotebookUpward(sourceRows, toleranceMm, options) {
  const rows = prepareRows(sourceRows);
  const initialElevation = toNumber(options.initialElevation) ?? 0;
  let lastUsedIndex = -1;

  sourceRows.forEach((row, index) => {
    if (rowHasPairingData(row)) lastUsedIndex = index;
  });

  const manualElevations = rows.map((row) => (
    row.elevationType === "manual" ? toNumber(row.elevation) : null
  ));
  const resolvedElevations = Array(rows.length).fill(null);
  const groups = [];
  let activeGroup = null;

  rows.forEach((row, index) => {
    if (index > lastUsedIndex) return;
    const hasBs = row.bs !== null;
    const hasFs = row.fs !== null;

    // 復路は最下段の既知点から上向きに標高を復元する。
    // FSとBSが同じ行なら前の器械位置を閉じ、その行を次の器械位置にする。
    if (hasFs) {
      if (activeGroup) {
        activeGroup.sightIndexes.push(index);
      } else {
        row._incomplete = true;
      }
    }

    if (hasBs) {
      if (activeGroup) {
        if (hasFs && activeGroup.sightIndexes.length > 0) {
          groups.push(activeGroup);
        } else {
          rows[activeGroup.baseIndex]._incomplete = true;
        }
      }
      activeGroup = {
        baseIndex: index,
        bs: row.bs,
        sightIndexes: []
      };
    }
  });

  if (activeGroup) {
    if (activeGroup.sightIndexes.length > 0) {
      groups.push(activeGroup);
    } else {
      rows[activeGroup.baseIndex]._incomplete = true;
    }
  }

  const lastGroup = groups.at(-1);
  const routeEndIndex = lastGroup?.sightIndexes.at(-1) ?? -1;
  const implicitBaselineIndex = routeEndIndex >= 0 &&
    manualElevations[routeEndIndex] === null
    ? routeEndIndex
    : -1;

  if (routeEndIndex >= 0) {
    resolvedElevations[routeEndIndex] =
      manualElevations[routeEndIndex] ?? initialElevation;
  }

  let validDifferenceCount = 0;
  for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
    const group = groups[groupIndex];
    const endpointIndex = group.sightIndexes.at(-1);
    const endpointRow = rows[endpointIndex];
    let endpointElevation = manualElevations[endpointIndex] ??
      resolvedElevations[endpointIndex];

    if (!Number.isFinite(endpointElevation)) {
      rows[group.baseIndex]._incomplete = true;
      group.sightIndexes.forEach((index) => {
        rows[index]._incomplete = true;
      });
      continue;
    }

    const baseIndex = group.baseIndex;
    const computedBaseElevation = endpointElevation - group.bs + endpointRow.fs;
    const baseElevation = manualElevations[baseIndex] ?? computedBaseElevation;
    resolvedElevations[baseIndex] = baseElevation;

    group.sightIndexes.forEach((index) => {
      const sightRow = rows[index];
      const computedElevation = baseElevation + group.bs - sightRow.fs;
      resolvedElevations[index] = manualElevations[index] ?? computedElevation;
    });

    endpointElevation = manualElevations[endpointIndex] ??
      resolvedElevations[endpointIndex];

    // 復路の高低差は、次の折返し点を基準として一段上側へ記載する。
    // 基準行自身には前の器械位置の差を書かず、次のグループの差を書く。
    const displayIndexes = [baseIndex, ...group.sightIndexes.slice(0, -1)];
    displayIndexes.forEach((index) => {
      const elevation = resolvedElevations[index];
      if (!Number.isFinite(elevation) || !Number.isFinite(endpointElevation)) {
        rows[index]._incomplete = true;
        return;
      }
      rows[index]._difference = elevation - endpointElevation;
      rows[index]._complete = true;
      validDifferenceCount += 1;
    });
  }

  rows.forEach((row, index) => {
    const manualElevation = manualElevations[index];
    if (manualElevation !== null) {
      row.elevation = manualElevation;
      row.elevationType = "manual";
    } else if (index === implicitBaselineIndex) {
      // 空欄の既知標高は内部では initialElevation として使い、表示は空欄を保つ。
      row.elevation = null;
      row.elevationType = "calculated";
    } else if (Number.isFinite(resolvedElevations[index])) {
      row.elevation = resolvedElevations[index];
      row.elevationType = "calculated";
    } else {
      row.elevation = null;
      row.elevationType = "calculated";
    }
  });

  const routeStartIndex = groups[0]?.baseIndex ?? -1;
  const routeStartElevation = routeStartIndex >= 0
    ? resolvedElevations[routeStartIndex]
    : null;
  const routeEndElevation = routeEndIndex >= 0
    ? resolvedElevations[routeEndIndex]
    : null;
  const backDifference = validDifferenceCount > 0 &&
    Number.isFinite(routeEndElevation) &&
    Number.isFinite(routeStartElevation)
    ? routeEndElevation - routeStartElevation
    : null;

  return {
    rows,
    outDifference: null,
    backDifference,
    closureMm: null,
    closurePassed: null,
    toleranceMm: safeTolerance(toleranceMm),
    startElevation: routeStartElevation,
    lastElevation: routeEndElevation
  };
}

function calculateNotebookDownward(sourceRows, toleranceMm, options) {
  const rows = prepareRows(sourceRows);
  const initialElevation = toNumber(options.initialElevation) ?? 0;
  let instrumentHeight = null;
  let heldBs = null;
  let routeStartElevation = null;
  let lastSightElevation = null;
  let validSightCount = 0;

  rows.forEach((row) => {
    const hasBs = row.bs !== null;
    const hasFs = row.fs !== null;
    const manualElevation = row.elevationType === "manual"
      ? toNumber(row.elevation)
      : null;
    let resolvedElevation = manualElevation;
    let usesImplicitBaseline = false;
    let validFs = false;
    let invalidObservation = false;

    // 往路のFSは、現在保持している器械高とBSを使って先に計算する。
    if (hasFs) {
      if (instrumentHeight !== null && heldBs !== null) {
        row._difference = heldBs - row.fs;
        validFs = true;
        validSightCount += 1;
        if (resolvedElevation === null) {
          resolvedElevation = instrumentHeight - row.fs;
        }
        lastSightElevation = resolvedElevation;
      } else {
        invalidObservation = true;
      }
    }

    // 最初のBS行が空欄なら、内部では0mを基準標高として扱う。
    if (hasBs && resolvedElevation === null && !hasFs && instrumentHeight === null) {
      resolvedElevation = initialElevation;
      usesImplicitBaseline = true;
    }

    // FSとBSが同じ行ならFS計算後に、新しい器械位置へ切り替える。
    if (hasBs) {
      if (resolvedElevation !== null) {
        instrumentHeight = resolvedElevation + row.bs;
        heldBs = row.bs;
        if (routeStartElevation === null) routeStartElevation = resolvedElevation;
      } else {
        invalidObservation = true;
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

    row._complete = validFs;
    row._incomplete = invalidObservation;
  });

  const routeDifference = validSightCount > 0 &&
    routeStartElevation !== null &&
    lastSightElevation !== null
    ? lastSightElevation - routeStartElevation
    : null;
  const route = rows.find((row) => row.route === "back") ? "back" : "out";

  return {
    rows,
    outDifference: route === "out" ? routeDifference : null,
    backDifference: route === "back" ? routeDifference : null,
    closureMm: null,
    closurePassed: null,
    toleranceMm: safeTolerance(toleranceMm),
    startElevation: routeStartElevation,
    lastElevation: lastSightElevation
  };
}

export function calculateNotebook(sourceRows, toleranceMm = 10, options = {}) {
  if (options.direction === "up") {
    return calculateNotebookUpward(sourceRows, toleranceMm, options);
  }
  return calculateNotebookDownward(sourceRows, toleranceMm, options);
}

export function applyRoundTripDifferences(outRows, backRows) {
  const maximumLength = Math.max(outRows.length, backRows.length);
  let lastUsedIndex = -1;

  for (let index = 0; index < maximumLength; index += 1) {
    if (
      rowHasPairingData(outRows[index] || {}) ||
      rowHasPairingData(backRows[index] || {})
    ) {
      lastUsedIndex = index;
    }
  }

  outRows.forEach((row) => { row._roundTripDifferenceMm = null; });
  backRows.forEach((row) => { row._roundTripDifferenceMm = null; });
  if (lastUsedIndex < 0) return;

  const usedRowCount = lastUsedIndex + 1;
  // 往路は上から下、復路は反転した点名順なので、鏡位置の区間を対応させる。
  for (let outIndex = 1; outIndex < usedRowCount; outIndex += 1) {
    const backIndex = usedRowCount - 1 - outIndex;
    const outDifference = outRows[outIndex]?._difference;
    const backDifference = backRows[backIndex]?._difference;
    if (!Number.isFinite(outDifference) || !Number.isFinite(backDifference)) {
      continue;
    }

    const differenceMm =
      Math.abs(Math.abs(outDifference) - Math.abs(backDifference)) * 1000;
    outRows[outIndex]._roundTripDifferenceMm = differenceMm;
    backRows[backIndex]._roundTripDifferenceMm = differenceMm;
  }
}
