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

export function resolveToleranceDistanceMeters({
  mode = "sheet",
  manualDistanceMeters = null,
  outRows = [],
  backRows = []
} = {}) {
  if (mode === "manual") {
    const manualDistance = toNumber(manualDistanceMeters);
    return manualDistance !== null && manualDistance > 0
      ? manualDistance
      : null;
  }
  const outDistance = sumObservationDistanceMeters(outRows);
  if (outDistance > 0) return outDistance;
  const backDistance = sumObservationDistanceMeters(backRows);
  return backDistance > 0 ? backDistance : null;
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

function rowHasRoundTripExtentData(row) {
  return Boolean(
    toNumber(row.bs) !== null ||
    toNumber(row.fs) !== null ||
    Number.isFinite(row._difference)
  );
}

function safeTolerance(toleranceMm) {
  return Number.isFinite(Number(toleranceMm)) && Number(toleranceMm) >= 0
    ? Number(toleranceMm)
    : 10;
}

function prepareRows(sourceRows) {
  const rows = sourceRows.map((sourceRow) => ({
    ...sourceRow,
    bs: toNumber(sourceRow.bs),
    fs: toNumber(sourceRow.fs),
    distance: toNumber(sourceRow.distance),
    _difference: null,
    _roundTripDifferenceMm: null,
    _roundTripDifferenceIntermediate: false,
    _intermediateSight: false,
    _complete: false,
    _incomplete: false
  }));
  markIntermediateSightRows(rows);
  return rows;
}

function markIntermediateSightRows(rows) {
  let instrumentActive = false;
  let sightIndexes = [];

  const finishInstrument = () => {
    sightIndexes.slice(0, -1).forEach((index) => {
      rows[index]._intermediateSight = true;
    });
    sightIndexes = [];
  };

  rows.forEach((row, index) => {
    // BS・FSが同じ行なら、そのFSは直前の器械位置の終点として扱う。
    if (instrumentActive && row.fs !== null) {
      sightIndexes.push(index);
    }
    if (row.bs !== null) {
      if (instrumentActive) finishInstrument();
      instrumentActive = true;
    }
  });
  if (instrumentActive) finishInstrument();
}

function calculateNotebookUpward(sourceRows, toleranceMm, options) {
  const rows = prepareRows(sourceRows);
  const initialElevation = toNumber(options.initialElevation);
  let lastUsedIndex = -1;

  sourceRows.forEach((row, index) => {
    if (rowHasPairingData(row)) lastUsedIndex = index;
  });

  const manualElevations = rows.map((row) => (
    row.elevationType === "manual" ? toNumber(row.elevation) : null
  ));
  const resolvedElevations = Array(rows.length).fill(null);
  let instrumentHeight = null;
  let routeStartElevation = null;
  let routeEndElevation = null;
  let validSightCount = 0;

  rows.forEach((row, index) => {
    if (index > lastUsedIndex) return;
    const hasBs = row.bs !== null;
    const hasFs = row.fs !== null;
    let resolvedElevation = manualElevations[index];

    // 復路は往路終点を開始標高として、現場で観測した順に上から計算する。
    // これにより復路の途中でも、完了した測点までの標高を確定できる。
    if (
      index === 0 &&
      resolvedElevation === null &&
      Number.isFinite(initialElevation)
    ) {
      resolvedElevation = initialElevation;
    }

    if (hasFs) {
      if (Number.isFinite(instrumentHeight)) {
        resolvedElevation ??= instrumentHeight - row.fs;
        row._complete = Number.isFinite(resolvedElevation);
        if (row._complete) {
          validSightCount += 1;
          routeEndElevation = resolvedElevation;
        }
      } else {
        row._incomplete = true;
      }
    }

    resolvedElevations[index] = resolvedElevation;

    // FSとBSが同じ行なら、前視を計算した後で次の器械位置へ切り替える。
    if (hasBs) {
      if (Number.isFinite(resolvedElevation)) {
        instrumentHeight = resolvedElevation + row.bs;
        routeStartElevation ??= resolvedElevation;
      } else {
        row._incomplete = true;
      }
    }
  });

  // 高低差の記載位置は従来どおり、復路では器械位置の終点から一段上側。
  // 途中観測では、その時点の最後の前視を仮の終点として計算可能な範囲を表示する。
  const groups = [];
  let activeGroup = null;
  rows.forEach((row, index) => {
    if (index > lastUsedIndex) return;
    const hasBs = row.bs !== null;
    const hasFs = row.fs !== null;
    if (hasFs && activeGroup) activeGroup.sightIndexes.push(index);
    if (hasBs) {
      if (activeGroup?.sightIndexes.length) groups.push(activeGroup);
      activeGroup = { baseIndex: index, sightIndexes: [] };
    }
  });
  if (activeGroup?.sightIndexes.length) groups.push(activeGroup);

  groups.forEach((group) => {
    const endpointIndex = group.sightIndexes.at(-1);
    const endpointElevation = resolvedElevations[endpointIndex];
    const displayIndexes = [group.baseIndex, ...group.sightIndexes.slice(0, -1)];
    displayIndexes.forEach((index) => {
      const elevation = resolvedElevations[index];
      if (Number.isFinite(elevation) && Number.isFinite(endpointElevation)) {
        rows[index]._difference = elevation - endpointElevation;
      }
    });
  });

  rows.forEach((row, index) => {
    const manualElevation = manualElevations[index];
    if (manualElevation !== null) {
      row.elevation = manualElevation;
      row.elevationType = "manual";
    } else if (Number.isFinite(resolvedElevations[index])) {
      row.elevation = resolvedElevations[index];
      row.elevationType = "calculated";
    } else {
      row.elevation = null;
      row.elevationType = "calculated";
    }
  });

  const backDifference = validSightCount > 0 &&
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

export function formatRoundTripMillimeters(value, intermediateSight = false) {
  if (!Number.isFinite(value)) return "";
  const formatted = String(Math.round(value));
  return intermediateSight ? `（${formatted}）` : formatted;
}

export function calculateRoundTripDifferenceMm(outElevation, backElevation) {
  const outward = toNumber(outElevation);
  const returnTrip = toNumber(backElevation);
  if (outward === null || returnTrip === null) return null;

  // 同じ測点の「往路標高－復路標高」をmmへ変換する。
  // 例: 往路 7.878m、復路 7.877m → +1mm。
  return (outward - returnTrip) * 1000;
}

export function applyRoundTripDifferences(
  outRows,
  backRows,
  { outStartElevation = null } = {}
) {
  let lastUsedIndex = -1;

  for (let index = 0; index < outRows.length; index += 1) {
    if (rowHasRoundTripExtentData(outRows[index] || {})) {
      lastUsedIndex = index;
    }
  }

  outRows.forEach((row) => { row._roundTripDifferenceMm = null; });
  backRows.forEach((row) => { row._roundTripDifferenceMm = null; });
  outRows.forEach((row) => { row._roundTripDifferenceIntermediate = false; });
  backRows.forEach((row) => { row._roundTripDifferenceIntermediate = false; });
  outRows.forEach((row) => { row._determinedElevation = null; });
  backRows.forEach((row) => { row._determinedElevation = null; });
  if (lastUsedIndex < 0) {
    return {
      closureMm: null,
      complete: false,
      matchedCount: 0,
      usedRowCount: 0
    };
  }

  const usedRowCount = lastUsedIndex + 1;
  // 往路は上から下、復路は反転した点名順なので、鏡位置の同じ測点を対応させる。
  let latestClosureMm = null;
  let latestCompletedBackIndex = -1;
  let matchedCount = 0;

  for (let outIndex = 0; outIndex < usedRowCount; outIndex += 1) {
    const backIndex = usedRowCount - 1 - outIndex;
    const outwardElevation = Number.isFinite(outRows[outIndex]?.elevation)
      ? outRows[outIndex].elevation
      : outIndex === 0
        ? toNumber(outStartElevation)
        : null;
    const differenceMm = calculateRoundTripDifferenceMm(
      outwardElevation,
      backRows[backIndex]?.elevation
    );
    if (differenceMm === null) {
      continue;
    }

    matchedCount += 1;
    const intermediateSight = Boolean(
      outRows[outIndex]?._intermediateSight ||
      backRows[backIndex]?._intermediateSight
    );
    outRows[outIndex]._roundTripDifferenceMm = differenceMm;
    outRows[outIndex]._roundTripDifferenceIntermediate = intermediateSight;

    if (
      Number.isFinite(outRows[outIndex]?.elevation) &&
      Number.isFinite(backRows[backIndex]?.elevation)
    ) {
      outRows[outIndex]._determinedElevation =
        (outRows[outIndex].elevation + backRows[backIndex].elevation) / 2;
    }

    // 復路で前視まで完了した最も先の測点を、上部の途中閉合差に使う。
    // 未観測セルは0として扱わず、計算可能な対応点だけで更新する。
    if (backRows[backIndex]?._complete && backIndex > latestCompletedBackIndex) {
      latestCompletedBackIndex = backIndex;
      latestClosureMm = differenceMm;
    }
  }

  return {
    closureMm: latestClosureMm,
    complete:
      usedRowCount > 1 &&
      latestCompletedBackIndex === usedRowCount - 1,
    matchedCount,
    usedRowCount
  };
}
