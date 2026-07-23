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

export function calculateNotebook(sourceRows, toleranceMm = 10) {
  const rows = sourceRows.map((row) => ({ ...row }));
  const currentElevation = { out: null, back: null };
  const routeTotals = { out: 0, back: 0 };
  const routeCounts = { out: 0, back: 0 };
  let lastElevation = null;

  rows.forEach((row) => {
    const route = row.route === "back" ? "back" : "out";
    const bs = toNumber(row.bs);
    const fs = toNumber(row.fs);
    const hasBs = bs !== null;
    const hasFs = fs !== null;
    const complete = hasBs && hasFs;
    const incomplete = hasBs !== hasFs;

    row.bs = bs;
    row.fs = fs;
    row.distance = toNumber(row.distance);
    row.elevation = toNumber(row.elevation);
    row._complete = complete;
    row._incomplete = incomplete;
    row._difference = complete ? bs - fs : null;

    if (complete) {
      routeTotals[route] += row._difference;
      routeCounts[route] += 1;
    }

    if (row.elevationType === "manual" && row.elevation !== null) {
      currentElevation[route] = row.elevation;
    } else if (currentElevation[route] !== null && complete) {
      currentElevation[route] += row._difference;
      row.elevation = currentElevation[route];
      row.elevationType = "calculated";
    } else {
      row.elevation = null;
      row.elevationType = "calculated";
    }

    if (row.elevation !== null) lastElevation = row.elevation;
  });

  const outDifference = routeCounts.out ? routeTotals.out : null;
  const backDifference = routeCounts.back ? routeTotals.back : null;
  const closureMm = outDifference !== null && backDifference !== null
    ? Math.abs((outDifference + backDifference) * 1000)
    : null;
  const safeTolerance = Number.isFinite(Number(toleranceMm)) && Number(toleranceMm) >= 0
    ? Number(toleranceMm)
    : 10;

  return {
    rows,
    outDifference,
    backDifference,
    closureMm,
    closurePassed: closureMm === null ? null : closureMm <= safeTolerance,
    lastElevation
  };
}
