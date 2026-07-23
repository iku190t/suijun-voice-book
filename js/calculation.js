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

export function calculateNotebook(sourceRows, toleranceMm = 10, options = {}) {
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
  if (lastUsedIndex < 1) return;

  const usedRowCount = lastUsedIndex + 1;
  for (let outIndex = 1; outIndex < usedRowCount; outIndex += 1) {
    const backIndex = usedRowCount - outIndex;
    const outDifference = outRows[outIndex]?._difference;
    const backDifference = backRows[backIndex]?._difference;
    if (!Number.isFinite(outDifference) || !Number.isFinite(backDifference)) continue;

    const differenceMm = Math.abs((outDifference + backDifference) * 1000);
    outRows[outIndex]._roundTripDifferenceMm = differenceMm;
    backRows[backIndex]._roundTripDifferenceMm = differenceMm;
  }
}
