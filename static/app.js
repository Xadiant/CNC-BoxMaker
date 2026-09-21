import { buildLayout } from "./geometry.js";
import { layoutToDxf } from "./dxf.js";

const form = document.querySelector("#boxForm");
const inputs = [...form.querySelectorAll('input[type="number"]')];
const dogboneCheckbox = document.querySelector("#use_dogbones");
const dimensionBasisSelect = document.querySelector("#dimension_basis");
const wallConnectionSelect = document.querySelector("#wall_connection");
const bottomTypeSelect = document.querySelector("#bottom_type");
const capturedSettingRows = [...document.querySelectorAll(".captured-setting")];
const bottomSettingRows = [...document.querySelectorAll(".bottom-setting")];
const fingerJointSettingRows = [...document.querySelectorAll(".finger-joint-setting")];
const pieceCheckboxes = [...document.querySelectorAll("[data-draw-piece]")];
const pieceDrawingCount = document.querySelector("#pieceDrawingCount");
const modelCanvas = document.querySelector("#modelCanvas");
const drawingCanvas = document.querySelector("#drawingCanvas");
const modelStage = document.querySelector("#modelStage");
const drawingStage = document.querySelector("#drawingStage");
const statusText = document.querySelector("#statusText");
const statusDot = document.querySelector(".status-dot");
const errorMessage = document.querySelector("#errorMessage");
const downloadButton = document.querySelector("#downloadButton");
const importSettingsButton = document.querySelector("#importSettingsButton");
const dxfSettingsFile = document.querySelector("#dxfSettingsFile");
const dimensionCard = document.querySelector("#dimensionCard");
const zoomReadout = document.querySelector("#zoomReadout");
const unitButtons = [...document.querySelectorAll("[data-unit]")];
const explodeSlider = document.querySelector("#explodeSlider");
const explodeValue = document.querySelector("#explodeValue");
const modelMode = document.querySelector("#modelMode");
const diagnosticStatus = document.querySelector("#diagnosticStatus");
const modelTitle = document.querySelector("#modelTitle");
const modelLegend = document.querySelector("#modelLegend");

const bottomTypeLabels = {
  none: "None",
  captured: "Captured bottom",
  butt_bottom: "Butt-bottom",
  butt_inside: "Butt-inside",
  finger_jointed: "Finger-jointed bottom",
};
const bottomTypeHelp = {
  none: "Creates the four walls without a bottom piece.",
  captured: "Rides in grooves routed into all four walls.",
  butt_bottom: "Covers the outside footprint below shortened walls while preserving the requested overall height.",
  butt_inside: "Fits between the four walls at the bottom of the box.",
  finger_jointed: "Interlocks with finger joints along the bottoms of all four walls.",
};
const wallConnectionLabels = {
  finger: "Finger joints",
  miter: "Mitered edges",
  butt_front_back: "Butted with end grain on front/back",
  butt_sides: "Butted with end grain on sides",
};
const wallConnectionHelp = {
  finger: "Interlocking finger joints at all four vertical corners.",
  miter: "Full-length walls meet with 45° beveled corner edges.",
  butt_front_back: "Side walls run full depth, exposing their end grain on the front and back.",
  butt_sides: "Front and back walls run full width, exposing their end grain on both sides.",
};
const dimensionBasisHelp = {
  exterior: "Width, depth, and height are the box's exterior extents.",
  interior: "Width and depth are clear between the walls; height is clear above the finished bottom.",
};

let displayUnit = "in";
let spec = readSpec();
let layout = null;
let updateTimer = 0;
let requestSequence = 0;
let modelRenderer = null;
let overlapGeometry = null;
let emptySpaceGeometry = null;

const fieldLimits = {
  width: [50, 1500, 1],
  depth: [50, 1500, 1],
  height: [25, 1000, 1],
  finger_size: [3, 100, .5],
  finger_clearance: [0, 10, .01],
  wall_thickness: [3, 50, .1],
  bottom_thickness: [1, 30, .1],
  bottom_slot_extra: [0, 10, .1],
  bottom_slot_depth: [.1, 50, .1],
  bottom_slot_offset: [0, 1000, .1],
  cutter_diameter: [.1, 50, .001],
};
const inchSteps = {
  width: ".01",
  depth: ".01",
  height: ".01",
  finger_size: ".01",
  finger_clearance: ".001",
  wall_thickness: ".001",
  bottom_thickness: ".001",
  bottom_slot_extra: ".00001",
  bottom_slot_depth: ".001",
  bottom_slot_offset: ".001",
  cutter_diameter: ".001",
};

const modelView = { yaw: -0.68, pitch: 0.48, zoom: 1, panX: 0, panY: 0 };
const drawingView = { scale: 1, panX: 0, panY: 0, fittedScale: 1 };

function readSpec() {
  const factor = displayUnit === "in" ? 25.4 : 1;
  return {
    ...Object.fromEntries(inputs.map((input) => [input.name, Number(input.value) * factor])),
    use_dogbones: dogboneCheckbox.checked,
    dimension_basis: dimensionBasisSelect.value,
    wall_connection: wallConnectionSelect.value,
    bottom_type: bottomTypeSelect.value,
  };
}

function updateDimensionBasisControls() {
  const basis = dimensionBasisSelect.value;
  document.querySelector("#dimensionBasisHelp").textContent = dimensionBasisHelp[basis];
  document.querySelector("#overallSizeLegend").textContent = `${basis === "interior" ? "Interior" : "Exterior"} size`;
}

function updateWallConnectionControls() {
  document.querySelector("#wallConnectionHelp").textContent = wallConnectionHelp[wallConnectionSelect.value];
  updateJoineryControls();
}

function updateJoineryControls() {
  const hasFingerJoints = wallConnectionSelect.value === "finger"
    || bottomTypeSelect.value === "finger_jointed";
  fingerJointSettingRows.forEach((row) => { row.hidden = !hasFingerJoints; });
  document.querySelector("#dogboneToggle").hidden = !hasFingerJoints;
  document.querySelector("#joinerySettings").hidden = !hasFingerJoints
    && bottomTypeSelect.value !== "captured";
}

function updateBottomTypeControls() {
  const bottomType = bottomTypeSelect.value;
  const captured = bottomType === "captured";
  const hasBottom = bottomType !== "none";
  capturedSettingRows.forEach((row) => { row.hidden = !captured; });
  bottomSettingRows.forEach((row) => { row.hidden = !hasBottom; });
  document.querySelector("#bottomTypeHelp").textContent = bottomTypeHelp[bottomType];
  document.querySelector("#bottomPieceLabel").textContent = bottomTypeLabels[bottomType];
  document.querySelector("#bottomPieceOption").hidden = !hasBottom;
  document.querySelector("#bottomLegendLabel").textContent = bottomTypeLabels[bottomType];
  document.querySelector("#bottomLegend").hidden = !hasBottom;
  document.querySelector("#grooveLegend").hidden = !captured;
  document.querySelector("#pocketDepthLabel").textContent = captured ? "Bottom pocket depth" : "Bottom type";
  updatePieceDrawingCount();
  updateJoineryControls();
}

function selectedPieceNames() {
  return new Set(pieceCheckboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.dataset.drawPiece));
}

function updatePieceDrawingCount() {
  const available = pieceCheckboxes.filter((checkbox) => !checkbox.closest("label").hidden);
  const selectedCount = available.filter((checkbox) => checkbox.checked).length;
  pieceDrawingCount.textContent = `${selectedCount} of ${available.length}`;
}

function visibleParts() {
  const selected = selectedPieceNames();
  return layout?.parts.filter((part) => selected.has(part.name)) || [];
}

function setUnit(nextUnit) {
  if (nextUnit === displayUnit) return;
  const millimetreValues = readSpec();
  showMillimetreValues(millimetreValues, nextUnit);
  scheduleUpdate();
}

function showMillimetreValues(millimetreValues, nextUnit) {
  displayUnit = nextUnit;
  const factor = displayUnit === "in" ? 1 / 25.4 : 1;
  for (const input of inputs) {
    const [minimum, maximum, step] = fieldLimits[input.name];
    input.value = formatInput(millimetreValues[input.name] * factor);
    input.min = formatInput(minimum * factor);
    input.max = formatInput(maximum * factor);
    input.step = displayUnit === "in" ? inchSteps[input.name] : String(step);
  }
  document.querySelectorAll(".input-wrap em").forEach((label) => { label.textContent = displayUnit; });
  unitButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.unit === displayUnit)));
}

function parseDxfSettings(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const comments = [];
  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (lines[index].trim() === "999") comments.push(lines[index + 1].trim());
  }
  const markerIndex = comments.indexOf("DRAWERFORGE_SETTINGS_V1");
  if (markerIndex < 0) throw new Error("This DXF does not contain saved box settings");

  const metadata = Object.fromEntries(comments.slice(markerIndex + 1).map((comment) => {
    const separator = comment.indexOf("=");
    return separator < 0 ? [comment, ""] : [comment.slice(0, separator), comment.slice(separator + 1)];
  }));
  const importedUnit = metadata.units;
  if (importedUnit !== "mm" && importedUnit !== "in") throw new Error("The DXF has an invalid saved unit setting");

  const values = {};
  for (const input of inputs) {
    const savedValue = metadata[`${input.name}_mm`];
    const value = input.name === "finger_clearance" && savedValue === undefined
      ? 0.254
      : Number(savedValue);
    if (!Number.isFinite(value)) throw new Error(`The DXF is missing ${input.name.replaceAll("_", " ")}`);
    values[input.name] = value;
  }
  const savedDogboneSetting = metadata.use_dogbones;
  if (savedDogboneSetting !== undefined && savedDogboneSetting !== "true" && savedDogboneSetting !== "false") {
    throw new Error("The DXF has an invalid saved dogbone setting");
  }
  const savedBottomType = metadata.bottom_type ?? "captured";
  if (!Object.hasOwn(bottomTypeLabels, savedBottomType)) {
    throw new Error("The DXF has an invalid saved bottom type");
  }
  const savedWallConnection = metadata.wall_connection ?? "finger";
  if (!Object.hasOwn(wallConnectionLabels, savedWallConnection)) {
    throw new Error("The DXF has an invalid saved wall connection");
  }
  const savedDimensionBasis = metadata.dimension_basis ?? "exterior";
  if (!Object.hasOwn(dimensionBasisHelp, savedDimensionBasis)) {
    throw new Error("The DXF has an invalid saved dimension reference");
  }
  return {
    units: importedUnit,
    values,
    useDogbones: savedDogboneSetting === undefined ? true : savedDogboneSetting === "true",
    bottomType: savedBottomType,
    wallConnection: savedWallConnection,
    dimensionBasis: savedDimensionBasis,
  };
}

function formatInput(value) {
  return Number(value.toFixed(displayUnit === "in" ? 5 : 3)).toString();
}

function measure(valueMm) {
  const value = displayUnit === "in" ? valueMm / 25.4 : valueMm;
  const maximumFractionDigits = displayUnit === "in" ? 4 : 3;
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits })} ${displayUnit}`;
}

function measureFixed(valueMm, fractionDigits = 3) {
  const value = displayUnit === "in" ? valueMm / 25.4 : valueMm;
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} ${displayUnit}`;
}

function measureVolume(valueCubicMm) {
  const value = displayUnit === "in" ? valueCubicMm / (25.4 ** 3) : valueCubicMm;
  const maximumFractionDigits = displayUnit === "in" ? 4 : 1;
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits })} ${displayUnit}³`;
}

function setStatus(message, state = "ready") {
  if (statusText) statusText.textContent = message;
  if (statusDot) statusDot.className = `status-dot ${state === "ready" ? "" : state}`;
}

function scheduleUpdate() {
  clearTimeout(updateTimer);
  setStatus("Rebuilding…", "busy");
  updateTimer = setTimeout(updateGeometry, 160);
}

async function updateGeometry(successMessage = "Geometry ready") {
  const sequence = ++requestSequence;
  spec = readSpec();
  try {
    const result = buildLayout(spec);
    if (sequence !== requestSequence) return;
    layout = result;
    overlapGeometry = null;
    emptySpaceGeometry = null;
    errorMessage.hidden = true;
    downloadButton.disabled = false;
    document.querySelector("#partCount").textContent = String(result.parts.length);
    const displayedBasis = spec.dimension_basis === "interior" ? "Exterior" : "Interior";
    const dimensions = displayedBasis === "Exterior"
      ? result.assembled_dimensions
      : result.interior_dimensions;
    dimensionCard.textContent = `${displayedBasis} · ${measure(dimensions.width).replace(` ${displayUnit}`, "")} × ${measure(dimensions.depth).replace(` ${displayUnit}`, "")} × ${measure(dimensions.height)}`;
    document.querySelector("#pocketDepth").textContent = result.manufacturing.has_bottom_groove
      ? measureFixed(result.manufacturing.pocket_depth)
      : bottomTypeLabels[spec.bottom_type];
    document.querySelector("#dogboneSize").textContent = result.manufacturing.dogbones_enabled
      ? measure(result.manufacturing.dogbone_diameter)
      : "Off";
    fitDrawing();
    drawModel();
    setStatus(successMessage, "ready");
  } catch (error) {
    if (sequence !== requestSequence) return;
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
    downloadButton.disabled = true;
    setStatus("Check dimensions", "error");
  }
}

function sizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width * ratio));
  const height = Math.max(1, Math.floor(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, ratio };
}

function rotatePoint(point) {
  const [x, y, z] = point;
  const cy = Math.cos(modelView.yaw), sy = Math.sin(modelView.yaw);
  const cp = Math.cos(modelView.pitch), sp = Math.sin(modelView.pitch);
  const x1 = x * cy - y * sy;
  const y1 = x * sy + y * cy;
  return [x1, y1 * cp - z * sp, y1 * sp + z * cp];
}

function uniqueCoordinates(values) {
  return [...values].sort((a, b) => a - b).filter((value, index, sorted) =>
    index === 0 || Math.abs(value - sorted[index - 1]) > 1e-8
  );
}

function pointInsideProfile(x, y, profile) {
  let inside = false;
  for (let index = 0, previous = profile.length - 1; index < profile.length; previous = index++) {
    const [xi, yi] = profile[index];
    const [xj, yj] = profile[previous];
    const intersects = (yi > y) !== (yj > y)
      && x < (xj - xi) * (y - yi) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function directExtrusionMesh(profile, thickness) {
  const flatPoints = profile.map(([x, y]) => ({ x, y }));
  const triangles = triangulatePolygon(flatPoints);
  const faces = [];
  for (const triangle of triangles) {
    faces.push({
      surface: "major",
      points: [...triangle].reverse().map((index) => [...profile[index], 0]),
    });
    faces.push({
      surface: "major",
      points: triangle.map((index) => [...profile[index], thickness]),
    });
  }

  const lines = [];
  for (let index = 0; index < profile.length; index++) {
    const current = profile[index];
    const next = profile[(index + 1) % profile.length];
    faces.push({
      surface: "edge",
      points: [[...current, 0], [...next, 0], [...next, thickness], [...current, thickness]],
    });
    lines.push({ color: "#49331f", points: [[...current, 0], [...next, 0]] });
    lines.push({ color: "#49331f", points: [[...current, thickness], [...next, thickness]] });
    lines.push({ color: "#49331f", points: [[...current, 0], [...current, thickness]] });
  }
  return { faces, lines, cells: [] };
}

function miteredExtrusionMesh(profile, thickness) {
  const minU = Math.min(...profile.map(([u]) => u));
  const maxU = Math.max(...profile.map(([u]) => u));
  const innerProfile = profile.map(([u, v]) => [
    Math.abs(u - minU) <= 1e-9 ? u + thickness
      : Math.abs(u - maxU) <= 1e-9 ? u - thickness : u,
    v,
  ]);
  const faces = [];
  const triangles = triangulatePolygon(profile.map(([x, y]) => ({ x, y })));
  for (const triangle of triangles) {
    faces.push({ surface: "major", points: [...triangle].reverse().map((index) => [...profile[index], 0]) });
    faces.push({ surface: "major", points: triangle.map((index) => [...innerProfile[index], thickness]) });
  }
  const lines = [];
  for (let index = 0; index < profile.length; index++) {
    const nextIndex = (index + 1) % profile.length;
    const current = profile[index], next = profile[nextIndex];
    const innerCurrent = innerProfile[index], innerNext = innerProfile[nextIndex];
    faces.push({
      surface: "edge",
      points: [[...current, 0], [...next, 0], [...innerNext, thickness], [...innerCurrent, thickness]],
    });
    lines.push({ color: "#49331f", points: [[...current, 0], [...next, 0]] });
    lines.push({ color: "#49331f", points: [[...innerCurrent, thickness], [...innerNext, thickness]] });
    lines.push({ color: "#49331f", points: [[...current, 0], [...innerCurrent, thickness]] });
  }
  return { faces, lines, cells: [] };
}

function partMesh(part, diagnostic = false) {
  const cacheKey = diagnostic ? "_diagnosticMesh" : "_mesh";
  if (part[cacheKey]) return part[cacheKey];
  const profile = diagnostic ? part.diagnostic_profile ?? part.profile : part.profile;
  const grooves = part.operations.filter((operation) => operation.type === "groove");
  if (!diagnostic && part.mitered_edges) {
    const mesh = miteredExtrusionMesh(profile, part.thickness);
    part[cacheKey] = mesh;
    return mesh;
  }
  if (!diagnostic && !grooves.length) {
    const mesh = directExtrusionMesh(profile, part.thickness);
    part[cacheKey] = mesh;
    return mesh;
  }
  const uCoordinates = profile.map((point) => point[0]);
  const vCoordinates = profile.map((point) => point[1]);
  const qCoordinates = [0, part.thickness];
  for (const groove of grooves) {
    const [gx, gy, gw, gh] = groove.rect;
    uCoordinates.push(gx, gx + gw);
    vCoordinates.push(gy, gy + gh);
    qCoordinates.push(Math.max(0, part.thickness - groove.depth));
  }
  const us = uniqueCoordinates(uCoordinates);
  const vs = uniqueCoordinates(vCoordinates);
  const qs = uniqueCoordinates(qCoordinates);
  const occupied = new Set();
  const key = (ui, vi, qi) => `${ui}:${vi}:${qi}`;

  for (let ui = 0; ui < us.length - 1; ui++) {
    for (let vi = 0; vi < vs.length - 1; vi++) {
      for (let qi = 0; qi < qs.length - 1; qi++) {
        const u = (us[ui] + us[ui + 1]) / 2;
        const v = (vs[vi] + vs[vi + 1]) / 2;
        const q = (qs[qi] + qs[qi + 1]) / 2;
        if (!pointInsideProfile(u, v, profile)) continue;
        const removed = grooves.some((groove) => {
          const [gx, gy, gw, gh] = groove.rect;
          return u > gx - 1e-8 && u < gx + gw + 1e-8
            && v > gy - 1e-8 && v < gy + gh + 1e-8
            && q > part.thickness - groove.depth - 1e-8;
        });
        if (!removed) occupied.add(key(ui, vi, qi));
      }
    }
  }

  const faces = [];
  const cells = [];
  for (const cellKey of occupied) {
    const [ui, vi, qi] = cellKey.split(":").map(Number);
    const u0 = us[ui], u1 = us[ui + 1];
    const v0 = vs[vi], v1 = vs[vi + 1];
    const q0 = qs[qi], q1 = qs[qi + 1];
    cells.push({ min: [u0, v0, q0], max: [u1, v1, q1] });
    const candidates = [
      { neighbor: [ui - 1, vi, qi], surface: "edge", points: [[u0,v0,q0],[u0,v0,q1],[u0,v1,q1],[u0,v1,q0]] },
      { neighbor: [ui + 1, vi, qi], surface: "edge", points: [[u1,v0,q0],[u1,v1,q0],[u1,v1,q1],[u1,v0,q1]] },
      { neighbor: [ui, vi - 1, qi], surface: "edge", points: [[u0,v0,q0],[u1,v0,q0],[u1,v0,q1],[u0,v0,q1]] },
      { neighbor: [ui, vi + 1, qi], surface: "edge", points: [[u0,v1,q0],[u0,v1,q1],[u1,v1,q1],[u1,v1,q0]] },
      { neighbor: [ui, vi, qi - 1], surface: "major", points: [[u0,v0,q0],[u0,v1,q0],[u1,v1,q0],[u1,v0,q0]] },
      { neighbor: [ui, vi, qi + 1], surface: "major", points: [[u0,v0,q1],[u1,v0,q1],[u1,v1,q1],[u0,v1,q1]] },
    ];
    for (const candidate of candidates) {
      if (!occupied.has(key(...candidate.neighbor))) faces.push(candidate);
    }
  }

  const lines = [];
  for (let index = 0; index < profile.length; index++) {
    const current = profile[index], next = profile[(index + 1) % profile.length];
    lines.push({ color: "#49331f", points: [[...current, 0], [...next, 0]] });
    lines.push({ color: "#49331f", points: [[...current, part.thickness], [...next, part.thickness]] });
    lines.push({ color: "#49331f", points: [[...current, 0], [...current, part.thickness]] });
  }
  part[cacheKey] = { faces, lines, cells };
  return part[cacheKey];
}

function assemblyPoint(part, [u, v, q], spread = 0) {
  const transform = part.assembly;
  return [0, 1, 2].map((axis) =>
    transform.origin[axis]
    + transform.u_axis[axis] * u
    + transform.v_axis[axis] * v
    + transform.thickness_axis[axis] * q
    + transform.explode_axis[axis] * spread
  );
}

function mergeSolidCells(cells) {
  const epsilon = 1e-9;
  let boxes = cells.map((cell) => ({ min: [...cell.min], max: [...cell.max] }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let axis = 0; axis < 3; axis++) {
      const otherAxes = [0, 1, 2].filter((candidate) => candidate !== axis);
      const groups = new Map();
      for (const box of boxes) {
        const key = otherAxes.flatMap((otherAxis) => [box.min[otherAxis], box.max[otherAxis]])
          .map((value) => value.toFixed(10))
          .join(":");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(box);
      }
      const merged = [];
      for (const group of groups.values()) {
        group.sort((first, second) => first.min[axis] - second.min[axis]);
        let current = group[0];
        for (const next of group.slice(1)) {
          if (Math.abs(current.max[axis] - next.min[axis]) <= epsilon) {
            current = { min: [...current.min], max: [...current.max] };
            current.max[axis] = next.max[axis];
            changed = true;
          } else {
            merged.push(current);
            current = next;
          }
        }
        merged.push(current);
      }
      boxes = merged;
    }
  }
  return boxes;
}

function partSolidBoxes(part, spread = 0) {
  if (!part._solidCells) part._solidCells = mergeSolidCells(partMesh(part, true).cells);
  return part._solidCells.map((cell) => {
    const corners = [];
    for (const u of [cell.min[0], cell.max[0]]) {
      for (const v of [cell.min[1], cell.max[1]]) {
        for (const q of [cell.min[2], cell.max[2]]) corners.push(assemblyPoint(part, [u, v, q], spread));
      }
    }
    return {
      min: [0, 1, 2].map((axis) => Math.min(...corners.map((point) => point[axis]))),
      max: [0, 1, 2].map((axis) => Math.max(...corners.map((point) => point[axis]))),
    };
  });
}

function buildOverlapGeometry(parts, spread) {
  const epsilon = 1e-7;
  const solids = parts.map((part) => partSolidBoxes(part, spread));
  const intersections = [];
  const collidingPairs = new Set();

  for (let first = 0; first < solids.length; first++) {
    for (let second = first + 1; second < solids.length; second++) {
      for (const a of solids[first]) {
        for (const b of solids[second]) {
          const min = [0, 1, 2].map((axis) => Math.max(a.min[axis], b.min[axis]));
          const max = [0, 1, 2].map((axis) => Math.min(a.max[axis], b.max[axis]));
          if (max.every((value, axis) => value - min[axis] > epsilon)) {
            intersections.push({ min, max });
            collidingPairs.add(`${first}:${second}`);
          }
        }
      }
    }
  }

  if (!intersections.length) return { faces: [], lines: [], pairCount: 0, volume: 0, spread };

  const coordinates = [0, 1, 2].map((axis) =>
    uniqueCoordinates(intersections.flatMap((box) => [box.min[axis], box.max[axis]]))
  );
  const coordinateIndex = (axis, value) =>
    coordinates[axis].findIndex((candidate) => Math.abs(candidate - value) <= epsilon);
  const occupied = new Set();
  const key = (xi, yi, zi) => `${xi}:${yi}:${zi}`;
  for (const box of intersections) {
    const starts = box.min.map((value, axis) => coordinateIndex(axis, value));
    const ends = box.max.map((value, axis) => coordinateIndex(axis, value));
    for (let xi = starts[0]; xi < ends[0]; xi++) {
      for (let yi = starts[1]; yi < ends[1]; yi++) {
        for (let zi = starts[2]; zi < ends[2]; zi++) occupied.add(key(xi, yi, zi));
      }
    }
  }

  const faces = [];
  let volume = 0;
  for (const cellKey of occupied) {
    const [xi, yi, zi] = cellKey.split(":").map(Number);
    const x0 = coordinates[0][xi], x1 = coordinates[0][xi + 1];
    const y0 = coordinates[1][yi], y1 = coordinates[1][yi + 1];
    const z0 = coordinates[2][zi], z1 = coordinates[2][zi + 1];
    volume += (x1 - x0) * (y1 - y0) * (z1 - z0);
    const candidates = [
      { neighbor: [xi - 1, yi, zi], surface: "edge", points: [[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]] },
      { neighbor: [xi + 1, yi, zi], surface: "edge", points: [[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1]] },
      { neighbor: [xi, yi - 1, zi], surface: "edge", points: [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]] },
      { neighbor: [xi, yi + 1, zi], surface: "edge", points: [[x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0]] },
      { neighbor: [xi, yi, zi - 1], surface: "major", points: [[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[x1,y0,z0]] },
      { neighbor: [xi, yi, zi + 1], surface: "major", points: [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]] },
    ];
    for (const candidate of candidates) {
      if (!occupied.has(key(...candidate.neighbor))) {
        faces.push({ color: "#ff5147", isBottom: false, surface: candidate.surface, points: candidate.points });
      }
    }
  }

  const lineMap = new Map();
  for (const face of faces) {
    for (let index = 0; index < face.points.length; index++) {
      const start = face.points[index];
      const end = face.points[(index + 1) % face.points.length];
      const pointKey = (point) => point.map((value) => value.toFixed(8)).join(",");
      const edgeKey = [pointKey(start), pointKey(end)].sort().join("|");
      if (!lineMap.has(edgeKey)) lineMap.set(edgeKey, { color: "#7d211d", points: [start, end] });
    }
  }
  return { faces, lines: [...lineMap.values()], pairCount: collidingPairs.size, volume, spread };
}

function buildEmptySpaceGeometry(parts, boxSpec, spread) {
  const epsilon = 1e-7;
  const solids = parts.flatMap((part) => partSolidBoxes(part, spread));
  const bottomPart = parts.find((part) => part.name === "BOTTOM");
  const bottomBoxes = bottomPart ? partSolidBoxes(bottomPart, spread) : [];
  if (!bottomBoxes.length) return { faces: [], lines: [], regionCount: 0, volume: 0, spread };

  const bottomMin = Math.min(...bottomBoxes.map((box) => box.min[2]));
  const bottomTop = Math.max(...bottomBoxes.map((box) => box.max[2]));
  const limits = [boxSpec.assembled_width, boxSpec.assembled_depth, boxSpec.assembled_height];
  const boundaries = [
    [0, boxSpec.wall_thickness, boxSpec.assembled_width - boxSpec.wall_thickness, boxSpec.assembled_width],
    [0, boxSpec.wall_thickness, boxSpec.assembled_depth - boxSpec.wall_thickness, boxSpec.assembled_depth],
    [bottomMin, bottomTop, boxSpec.assembled_height],
  ];
  const coordinates = [0, 1, 2].map((axis) => uniqueCoordinates([
    ...boundaries[axis],
    ...solids.flatMap((box) => [box.min[axis], box.max[axis]])
      .filter((value) => value >= (axis === 2 ? bottomMin : 0) - epsilon && value <= limits[axis] + epsilon),
  ]));
  const emptyCells = new Set();
  const key = (xi, yi, zi) => `${xi}:${yi}:${zi}`;
  const insideSolid = (point) => solids.some((box) =>
    point.every((value, axis) => value >= box.min[axis] - epsilon && value <= box.max[axis] + epsilon)
  );

  for (let xi = 0; xi < coordinates[0].length - 1; xi++) {
    for (let yi = 0; yi < coordinates[1].length - 1; yi++) {
      for (let zi = 0; zi < coordinates[2].length - 1; zi++) {
        const point = [
          (coordinates[0][xi] + coordinates[0][xi + 1]) / 2,
          (coordinates[1][yi] + coordinates[1][yi + 1]) / 2,
          (coordinates[2][zi] + coordinates[2][zi + 1]) / 2,
        ];
        const insideOpenArea = point[0] > boxSpec.wall_thickness
          && point[0] < boxSpec.assembled_width - boxSpec.wall_thickness
          && point[1] > boxSpec.wall_thickness
          && point[1] < boxSpec.assembled_depth - boxSpec.wall_thickness
          && point[2] > bottomTop - epsilon;
        if (!insideOpenArea && !insideSolid(point)) emptyCells.add(key(xi, yi, zi));
      }
    }
  }

  const faces = [];
  let volume = 0;
  for (const cellKey of emptyCells) {
    const [xi, yi, zi] = cellKey.split(":").map(Number);
    const x0 = coordinates[0][xi], x1 = coordinates[0][xi + 1];
    const y0 = coordinates[1][yi], y1 = coordinates[1][yi + 1];
    const z0 = coordinates[2][zi], z1 = coordinates[2][zi + 1];
    volume += (x1 - x0) * (y1 - y0) * (z1 - z0);
    const candidates = [
      { neighbor: [xi - 1, yi, zi], surface: "edge", points: [[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]] },
      { neighbor: [xi + 1, yi, zi], surface: "edge", points: [[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1]] },
      { neighbor: [xi, yi - 1, zi], surface: "edge", points: [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]] },
      { neighbor: [xi, yi + 1, zi], surface: "edge", points: [[x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0]] },
      { neighbor: [xi, yi, zi - 1], surface: "major", points: [[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[x1,y0,z0]] },
      { neighbor: [xi, yi, zi + 1], surface: "major", points: [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]] },
    ];
    for (const candidate of candidates) {
      if (!emptyCells.has(key(...candidate.neighbor))) {
        faces.push({ color: "#52cfeb", isBottom: false, surface: candidate.surface, points: candidate.points });
      }
    }
  }

  const lineMap = new Map();
  for (const face of faces) {
    for (let index = 0; index < face.points.length; index++) {
      const start = face.points[index];
      const end = face.points[(index + 1) % face.points.length];
      const pointKey = (point) => point.map((value) => value.toFixed(8)).join(",");
      const edgeKey = [pointKey(start), pointKey(end)].sort().join("|");
      if (!lineMap.has(edgeKey)) lineMap.set(edgeKey, { color: "#176070", points: [start, end] });
    }
  }

  let regionCount = 0;
  const unvisited = new Set(emptyCells);
  while (unvisited.size) {
    regionCount++;
    const queue = [unvisited.values().next().value];
    unvisited.delete(queue[0]);
    while (queue.length) {
      const current = queue.pop();
      const [xi, yi, zi] = current.split(":").map(Number);
      for (const neighbor of [[xi-1,yi,zi],[xi+1,yi,zi],[xi,yi-1,zi],[xi,yi+1,zi],[xi,yi,zi-1],[xi,yi,zi+1]]) {
        const neighborKey = key(...neighbor);
        if (unvisited.delete(neighborKey)) queue.push(neighborKey);
      }
    }
  }
  return { faces, lines: [...lineMap.values()], regionCount, volume, spread };
}

function drawModel() {
  const { width: cw, height: ch, ratio } = sizeCanvas(modelCanvas);
  if (!spec || !layout?.parts) return;

  const w = layout.assembled_dimensions.width;
  const d = layout.assembled_dimensions.depth;
  const h = layout.assembled_dimensions.height;
  const maxDimension = Math.max(w, d, h * 1.8);
  const drawMode = modelMode.value;
  const diagnosticMode = drawMode !== "assembly";
  const explosion = Number(explodeSlider.value) / 100;
  const spread = maxDimension * .38 * explosion;
  const framing = 1 + explosion * .55;
  const scale = (Math.min(cw, ch) * 0.68 / maxDimension / framing) * modelView.zoom;
  const center = [w / 2, d / 2, h * 0.45];
  const project = (point) => {
    const rotated = rotatePoint([point[0] - center[0], point[1] - center[1], point[2] - center[2]]);
    return {
      x: cw / 2 + modelView.panX * ratio + rotated[0] * scale,
      y: ch / 2 + modelView.panY * ratio + rotated[1] * scale,
      depth: rotated[2],
    };
  };

  const partColors = {
    FRONT: "#bf8744",
    BACK: "#c99554",
    "LEFT SIDE": "#a96f32",
    "RIGHT SIDE": "#d2a15d",
    BOTTOM: "#78934f",
  };
  const partPoint = (part, [u, v], thicknessPosition) => {
    const transform = part.assembly;
    const explode = transform.explode_axis.map((value) => value * spread);
    return [0, 1, 2].map((axis) =>
      transform.origin[axis]
      + transform.u_axis[axis] * u
      + transform.v_axis[axis] * v
      + transform.thickness_axis[axis] * thicknessPosition
      + explode[axis]
    );
  };

  const faces = [];
  const modelLines = [];
  const parts = visibleParts();
  const addParts = (alpha) => {
    for (const part of parts) {
      const isBottom = part.name === "BOTTOM";
      const color = partColors[part.name] || "#bd8a4d";
      const transform = part.assembly;
      const profileNormal = cross3(transform.u_axis, transform.v_axis);
      const sameHandedness = dot3(profileNormal, transform.thickness_axis) > 0;
      const mesh = partMesh(part);
      for (const meshFace of mesh.faces) {
        const points = meshFace.points.map(([u, v, q]) => partPoint(part, [u, v], q));
        faces.push({
          name: part.name,
          color,
          alpha,
          isBottom,
          surface: meshFace.surface,
          points: sameHandedness ? points : [...points].reverse(),
        });
      }
      for (const line of mesh.lines) {
        modelLines.push({
          color: line.color,
          alpha: diagnosticMode ? .2 : 1,
          projected: line.points.map(([u, v, q]) => project(partPoint(part, [u, v], q))),
        });
      }
    }
  };

  addParts(diagnosticMode ? .14 : 1);
  if (drawMode === "overlaps") {
    if (!overlapGeometry || Math.abs(overlapGeometry.spread - spread) > 1e-7) {
      overlapGeometry = buildOverlapGeometry(layout.parts, spread);
    }
    faces.push(...overlapGeometry.faces);
    modelLines.push(...overlapGeometry.lines.map((line) => ({ ...line, projected: line.points.map(project) })));
    diagnosticStatus.textContent = overlapGeometry.pairCount
      ? `${overlapGeometry.pairCount} part pair${overlapGeometry.pairCount === 1 ? "" : "s"} · ${measureVolume(overlapGeometry.volume)}`
      : "No physical overlaps";
  } else if (drawMode === "empty") {
    if (!emptySpaceGeometry || Math.abs(emptySpaceGeometry.spread - spread) > 1e-7) {
      emptySpaceGeometry = buildEmptySpaceGeometry(layout.parts, {
        ...spec,
        assembled_width: w,
        assembled_depth: d,
        assembled_height: h,
      }, spread);
    }
    faces.push(...emptySpaceGeometry.faces);
    modelLines.push(...emptySpaceGeometry.lines.map((line) => ({ ...line, projected: line.points.map(project) })));
    diagnosticStatus.textContent = emptySpaceGeometry.regionCount
      ? `${emptySpaceGeometry.regionCount} empty region${emptySpaceGeometry.regionCount === 1 ? "" : "s"} · ${measureVolume(emptySpaceGeometry.volume)}`
      : "No unexpected empty space";
  }
  for (const face of faces) face.projected = face.points.map(project);

  const visibleFaces = faces
    .filter((face) => projectedArea(face.projected) > .01)
    .sort((a, b) => avgDepth(a.projected) - avgDepth(b.projected));
  renderSolidModel(visibleFaces, modelLines, cw, ch, maxDimension, ratio);
}

function avgDepth(points) { return points.reduce((sum, point) => sum + point.depth, 0) / points.length; }

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function projectedArea(points) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

function triangleCross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointInTriangle(point, a, b, c, orientation) {
  const epsilon = 1e-7;
  return triangleCross(a, b, point) * orientation >= -epsilon
    && triangleCross(b, c, point) * orientation >= -epsilon
    && triangleCross(c, a, point) * orientation >= -epsilon;
}

function triangulatePolygon(points) {
  if (points.length === 3) return [[0, 1, 2]];
  const orientation = Math.sign(projectedArea(points)) || 1;
  const remaining = points.map((_, index) => index);
  const triangles = [];
  let guard = points.length * points.length;

  while (remaining.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let cursor = 0; cursor < remaining.length; cursor++) {
      const previousIndex = remaining[(cursor - 1 + remaining.length) % remaining.length];
      const currentIndex = remaining[cursor];
      const nextIndex = remaining[(cursor + 1) % remaining.length];
      const a = points[previousIndex], b = points[currentIndex], c = points[nextIndex];
      if (triangleCross(a, b, c) * orientation <= 1e-7) continue;
      const containsVertex = remaining.some((candidateIndex) =>
        candidateIndex !== previousIndex
        && candidateIndex !== currentIndex
        && candidateIndex !== nextIndex
        && pointInTriangle(points[candidateIndex], a, b, c, orientation)
      );
      if (containsVertex) continue;
      triangles.push([previousIndex, currentIndex, nextIndex]);
      remaining.splice(cursor, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) triangles.push([...remaining]);
  return triangles;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Could not compile 3D shader");
  }
  return shader;
}

function createModelRenderer(canvas) {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true, depth: true });
  if (!gl) throw new Error("This browser does not support WebGL");
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, `
    attribute vec3 a_position;
    attribute vec4 a_color;
    varying vec4 v_color;
    void main() {
      gl_Position = vec4(a_position, 1.0);
      v_color = a_color;
    }
  `);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec4 v_color;
    void main() {
      gl_FragColor = v_color;
    }
  `);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Could not link 3D shader");
  }
  return {
    gl,
    program,
    buffer: gl.createBuffer(),
    position: gl.getAttribLocation(program, "a_position"),
    color: gl.getAttribLocation(program, "a_color"),
  };
}

function rgbChannels(hex, adjustment = 0) {
  const color = hex.replace("#", "");
  return [0, 2, 4].map((index) =>
    Math.max(0, Math.min(255, parseInt(color.slice(index, index + 2), 16) + adjustment)) / 255
  );
}

function renderSolidModel(faces, modelLines, width, height, maxDimension, ratio) {
  if (!modelRenderer) modelRenderer = createModelRenderer(modelCanvas);
  const { gl, program, buffer, position, color } = modelRenderer;
  const depthRange = maxDimension * 4;
  const toClip = (point, depthBias = 0) => [
    point.x / width * 2 - 1,
    1 - point.y / height * 2,
    -point.depth / depthRange + depthBias,
  ];
  const pushVertex = (target, point, channels, alpha = 1, depthBias = 0) => {
    target.push(...toClip(point, depthBias), ...channels, alpha);
  };
  const fillVertices = [];
  const transparentVertices = [];
  const lineVertices = [];
  const transparentLineVertices = [];

  for (const face of faces) {
    const shade = face.surface === "edge" ? -34 : face.isBottom ? 2 : 10;
    const channels = rgbChannels(face.color, shade);
    const alpha = face.alpha ?? 1;
    const target = alpha < 1 ? transparentVertices : fillVertices;
    for (const triangle of triangulatePolygon(face.projected)) {
      for (const index of triangle) pushVertex(target, face.projected[index], channels, alpha);
    }
  }
  for (const line of modelLines) {
    const channels = rgbChannels(line.color);
    const alpha = line.alpha ?? 1;
    const target = alpha < 1 ? transparentLineVertices : lineVertices;
    pushVertex(target, line.projected[0], channels, alpha, -0.0004);
    pushVertex(target, line.projected[1], channels, alpha, -0.0004);
  }

  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clearDepth(1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(position);
  gl.enableVertexAttribArray(color);
  gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 28, 0);
  gl.vertexAttribPointer(color, 4, gl.FLOAT, false, 28, 12);

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(transparentVertices), gl.DYNAMIC_DRAW);
  gl.drawArrays(gl.TRIANGLES, 0, transparentVertices.length / 7);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(transparentLineVertices), gl.DYNAMIC_DRAW);
  gl.lineWidth(Math.max(1, ratio));
  gl.drawArrays(gl.LINES, 0, transparentLineVertices.length / 7);

  gl.disable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(fillVertices), gl.DYNAMIC_DRAW);
  gl.drawArrays(gl.TRIANGLES, 0, fillVertices.length / 7);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineVertices), gl.DYNAMIC_DRAW);
  gl.lineWidth(Math.max(1, ratio));
  gl.drawArrays(gl.LINES, 0, lineVertices.length / 7);
}

function pathPolygon(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

function drawLine(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

function drawPanelGrain(ctx, points, ratio) {
  ctx.save();
  pathPolygon(ctx, points);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,.06)";
  ctx.lineWidth = .6 * ratio;
  const left = Math.min(...points.map((p) => p.x));
  const right = Math.max(...points.map((p) => p.x));
  const top = Math.min(...points.map((p) => p.y));
  const bottom = Math.max(...points.map((p) => p.y));
  for (let y = top + 10 * ratio; y < bottom; y += 13 * ratio) {
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.bezierCurveTo(left + (right-left)*.3, y-2*ratio, left+(right-left)*.6, y+2*ratio, right, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGroundShadow(ctx, points, ratio) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.filter = `blur(${12 * ratio}px)`;
  ctx.fillStyle = "rgba(0,0,0,.42)";
  pathPolygon(ctx, points.map((p) => ({ ...p, y: p.y + 12 * ratio })));
  ctx.fill();
  ctx.restore();
}

function brighten(hex, amount) {
  const color = hex.replace("#", "");
  return `rgb(${[0, 2, 4].map((i) => Math.max(0, Math.min(255, parseInt(color.slice(i, i+2), 16) + amount))).join(",")})`;
}

function fitDrawing() {
  if (!layout) return;
  const { width, height } = sizeCanvas(drawingCanvas);
  const bounds = layout.bounds;
  const drawingWidth = bounds.max_x - bounds.min_x;
  const drawingHeight = bounds.max_y - bounds.min_y;
  drawingView.scale = Math.min(width * .82 / drawingWidth, height * .82 / drawingHeight);
  drawingView.fittedScale = drawingView.scale;
  drawingView.panX = width / 2 - (bounds.min_x + drawingWidth / 2) * drawingView.scale;
  drawingView.panY = height / 2 + (bounds.min_y + drawingHeight / 2) * drawingView.scale;
  drawDrawing();
}

function drawDrawing() {
  const { width, height, ratio } = sizeCanvas(drawingCanvas);
  const ctx = drawingCanvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  if (!layout) return;

  const viewPoint = ([x, y]) => ({
    x: x * drawingView.scale + drawingView.panX,
    y: -y * drawingView.scale + drawingView.panY,
  });
  const styles = {
    CUT_OUTSIDE: { color: "#e9ede5", width: 1.05, dash: [] },
    POCKET_BOTTOM_SLOT: { color: "#72d8d3", width: 1, dash: [5, 3] },
    ANNOTATION: { color: "#748073", width: 1, dash: [] },
  };

  for (const entity of layout.entities) {
    const style = styles[entity.layer];
    ctx.strokeStyle = style.color;
    ctx.fillStyle = style.color;
    ctx.lineWidth = style.width * ratio;
    ctx.setLineDash(style.dash.map((n) => n * ratio));
    if (entity.type === "polyline") {
      const points = entity.points.map(viewPoint);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      if (entity.closed) ctx.closePath();
      ctx.stroke();
    } else if (entity.type === "circle") {
      const center = viewPoint([entity.cx, entity.cy]);
      ctx.beginPath();
      ctx.arc(center.x, center.y, Math.max(entity.r * drawingView.scale, 1.5 * ratio), 0, Math.PI * 2);
      ctx.stroke();
    } else if (entity.type === "text") {
      const point = viewPoint([entity.x, entity.y]);
      const fontSize = Math.max(7 * ratio, Math.min(13 * ratio, entity.height * drawingView.scale));
      ctx.font = `600 ${fontSize}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(entity.text, point.x, point.y);
    }
  }
  ctx.setLineDash([]);
  const percent = Math.round(drawingView.scale / drawingView.fittedScale * 100);
  zoomReadout.textContent = Math.abs(percent - 100) < 2 ? "FIT" : `${percent}%`;
}

function zoomDrawing(factor, x, y) {
  const oldScale = drawingView.scale;
  const newScale = Math.max(drawingView.fittedScale * .25, Math.min(drawingView.fittedScale * 12, oldScale * factor));
  drawingView.panX = x - (x - drawingView.panX) * newScale / oldScale;
  drawingView.panY = y - (y - drawingView.panY) * newScale / oldScale;
  drawingView.scale = newScale;
  drawDrawing();
}

function bindDrag(stage, onDrag) {
  let active = false, x = 0, y = 0, dragMode = "primary";
  stage.addEventListener("pointerdown", (event) => {
    active = true; x = event.clientX; y = event.clientY;
    dragMode = event.shiftKey || event.button === 2 ? "secondary" : "primary";
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", (event) => {
    if (!active) return;
    const dx = event.clientX - x, dy = event.clientY - y;
    x = event.clientX; y = event.clientY;
    onDrag(dx, dy, event, dragMode);
  });
  stage.addEventListener("pointerup", () => { active = false; });
  stage.addEventListener("pointercancel", () => { active = false; });
}

function wrapAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}

bindDrag(modelStage, (dx, dy, event, dragMode) => {
  if (dragMode === "secondary") {
    modelView.panX += dx; modelView.panY += dy;
  } else {
    modelView.yaw = wrapAngle(modelView.yaw - dx * .008);
    modelView.pitch = wrapAngle(modelView.pitch - dy * .008);
  }
  drawModel();
});

bindDrag(drawingStage, (dx, dy) => {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  drawingView.panX += dx * ratio; drawingView.panY += dy * ratio;
  drawDrawing();
});

modelStage.addEventListener("wheel", (event) => {
  event.preventDefault();
  modelView.zoom = Math.max(.3, Math.min(10, modelView.zoom * Math.exp(-event.deltaY * .001)));
  drawModel();
}, { passive: false });
modelStage.addEventListener("contextmenu", (event) => event.preventDefault());

drawingStage.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = drawingCanvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  zoomDrawing(Math.exp(-event.deltaY * .001), (event.clientX - rect.left) * ratio, (event.clientY - rect.top) * ratio);
}, { passive: false });

document.querySelector("#reset3d").addEventListener("click", () => {
  Object.assign(modelView, { yaw: -.68, pitch: .48, zoom: 1, panX: 0, panY: 0 });
  explodeSlider.value = "0";
  explodeValue.value = "0%";
  explodeSlider.style.setProperty("--explode-fill", "0%");
  drawModel();
});
explodeSlider.addEventListener("input", () => {
  explodeValue.value = `${explodeSlider.value}%`;
  explodeSlider.style.setProperty("--explode-fill", `${explodeSlider.value}%`);
  drawModel();
});
explodeSlider.addEventListener("pointerdown", (event) => event.stopPropagation());
modelMode.addEventListener("change", () => {
  const drawMode = modelMode.value;
  const diagnosticMode = drawMode !== "assembly";
  diagnosticStatus.hidden = !diagnosticMode;
  diagnosticStatus.classList.toggle("empty-mode", drawMode === "empty");
  modelTitle.textContent = drawMode === "overlaps"
    ? "Collision overlaps"
    : drawMode === "empty" ? "Unexpected empty space" : "Assembled model";
  modelCanvas.setAttribute("aria-label", drawMode === "overlaps"
    ? "Interactive 3D physical overlap preview"
    : drawMode === "empty" ? "Interactive 3D unexpected empty space preview" : "Interactive 3D box preview");
  modelLegend.classList.toggle("overlap-mode", drawMode === "overlaps");
  modelLegend.classList.toggle("empty-mode", drawMode === "empty");
  drawModel();
});
document.querySelector("#fitDrawing").addEventListener("click", fitDrawing);
document.querySelector("#zoomIn").addEventListener("click", () => zoomDrawing(1.22, drawingCanvas.width/2, drawingCanvas.height/2));
document.querySelector("#zoomOut").addEventListener("click", () => zoomDrawing(1/1.22, drawingCanvas.width/2, drawingCanvas.height/2));

downloadButton.addEventListener("click", async () => {
  if (!layout) return;
  downloadButton.disabled = true;
  setStatus("Preparing DXF…", "busy");
  try {
    const blob = new Blob([layoutToDxf(layout, displayUnit)], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const fileDimensions = Object.values(layout.assembled_dimensions)
      .map((value) => formatInput(displayUnit === "in" ? value / 25.4 : value))
      .join("x");
    link.download = `box-${fileDimensions}${displayUnit}.dxf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus("DXF downloaded", "ready");
  } catch (error) {
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
    setStatus("Download failed", "error");
  } finally {
    downloadButton.disabled = false;
  }
});

importSettingsButton.addEventListener("click", () => {
  dxfSettingsFile.value = "";
  dxfSettingsFile.click();
});
dxfSettingsFile.addEventListener("change", async () => {
  const [file] = dxfSettingsFile.files;
  if (!file) return;
  setStatus("Reading DXF settings…", "busy");
  try {
    const imported = parseDxfSettings(await file.text());
    clearTimeout(updateTimer);
    showMillimetreValues(imported.values, imported.units);
    dogboneCheckbox.checked = imported.useDogbones;
    wallConnectionSelect.value = imported.wallConnection;
    bottomTypeSelect.value = imported.bottomType;
    dimensionBasisSelect.value = imported.dimensionBasis;
    updateDimensionBasisControls();
    updateWallConnectionControls();
    updateBottomTypeControls();
    spec = readSpec();
    await updateGeometry(`Settings loaded from ${file.name}`);
  } catch (error) {
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
    setStatus("Could not load settings", "error");
  }
});

inputs.forEach((input) => input.addEventListener("input", scheduleUpdate));
dogboneCheckbox.addEventListener("change", scheduleUpdate);
dimensionBasisSelect.addEventListener("change", () => {
  updateDimensionBasisControls();
  scheduleUpdate();
});
wallConnectionSelect.addEventListener("change", () => {
  updateWallConnectionControls();
  scheduleUpdate();
});
bottomTypeSelect.addEventListener("change", () => {
  updateBottomTypeControls();
  scheduleUpdate();
});
pieceCheckboxes.forEach((checkbox) => checkbox.addEventListener("change", () => {
  updatePieceDrawingCount();
  drawModel();
}));
unitButtons.forEach((button) => button.addEventListener("click", () => setUnit(button.dataset.unit)));
window.addEventListener("resize", () => {
  drawModel();
  fitDrawing();
});

new ResizeObserver(() => {
  drawModel();
  if (layout) fitDrawing();
}).observe(document.querySelector(".workspace"));

updateBottomTypeControls();
updateWallConnectionControls();
updateDimensionBasisControls();
updateGeometry();
