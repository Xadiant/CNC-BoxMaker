const FIELD_RULES = {
  height: [25, 1000, null],
  width: [50, 1500, null],
  depth: [50, 1500, null],
  finger_size: [3, 100, 12.7],
  joint_clearance: [0, 10, 0.254],
  hidden_finger_skin: [0.5, 50, 1.5875],
  wall_thickness: [3, 50, 12.7],
  bottom_thickness: [1, 30, 6.35],
  bottom_slot_extra: [0, 10, 0.53975],
  bottom_slot_depth: [0.1, 50, 6.35],
  bottom_inset_depth: [0.1, 30, 3.175],
  top_thickness: [1, 30, 6.35],
  top_slot_extra: [0, 10, 0.53975],
  top_slot_depth: [0.1, 50, 6.35],
  top_inset_depth: [0.1, 30, 3.175],
  cutter_diameter: [0.1, 50, 3.175],
};
const BOTTOM_TYPES = new Set([
  "none", "captured", "inset", "butt_bottom", "butt_inside", "finger_jointed", "hidden_finger_jointed",
]);
const TOP_TYPES = new Set([
  "none", "captured", "inset", "butt_top", "butt_inside", "finger_jointed", "hidden_finger_jointed",
]);
const WALL_CONNECTIONS = new Set(["finger", "hidden_finger", "miter", "butt_front_back", "butt_sides"]);
const DIMENSION_BASES = new Set(["exterior", "interior"]);

function distance(first, second) {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

function samePoint(first, second) {
  return first[0] === second[0] && first[1] === second[1];
}

function roundHalfEven(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (Math.abs(fraction - 0.5) <= Number.EPSILON * Math.max(1, Math.abs(value))) {
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return Math.round(value);
}

function roundTo(value, places) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

export function validateSpec(values) {
  const normalizedValues = {
    ...values,
    joint_clearance: values.joint_clearance ?? values.finger_clearance,
  };
  const spec = {};
  for (const [name, [minimum, maximum, defaultValue]] of Object.entries(FIELD_RULES)) {
    const rawValue = normalizedValues[name] ?? defaultValue;
    const value = typeof rawValue === "string" && rawValue.trim() === "" ? Number.NaN : Number(rawValue);
    if (!Number.isFinite(value)) throw new Error(`${name.replaceAll("_", " ")} must be a number`);
    if (value < minimum || value > maximum) {
      throw new Error(`${name.replaceAll("_", " ")} must be between ${minimum} and ${maximum} mm`);
    }
    spec[name] = value;
  }

  const rawDogboneSetting = values.use_dogbones ?? true;
  if (rawDogboneSetting !== true && rawDogboneSetting !== false) {
    throw new Error("use dogbones must be true or false");
  }
  spec.use_dogbones = rawDogboneSetting;

  const bottomType = values.bottom_type ?? "captured";
  if (!BOTTOM_TYPES.has(bottomType)) {
    throw new Error("bottom type must be none, captured, inset, butt-bottom, butt-inside, finger jointed, or hidden fingers");
  }
  spec.bottom_type = bottomType;

  const topType = values.top_type ?? "none";
  if (!TOP_TYPES.has(topType)) {
    throw new Error("top type must be none, captured, inset, butt-top, butt-inside, finger jointed, or hidden fingers");
  }
  spec.top_type = topType;

  const wallConnection = values.wall_connection ?? "finger";
  if (!WALL_CONNECTIONS.has(wallConnection)) {
    throw new Error("wall connection must be finger, hidden finger, miter, butt-front/back, or butt-sides");
  }
  spec.wall_connection = wallConnection;

  const dimensionBasis = values.dimension_basis ?? "exterior";
  if (!DIMENSION_BASES.has(dimensionBasis)) {
    throw new Error("dimension reference must be exterior or interior");
  }
  spec.dimension_basis = dimensionBasis;

  const rawOffset = values.bottom_slot_offset ?? spec.wall_thickness;
  const bottomSlotOffset = typeof rawOffset === "string" && rawOffset.trim() === ""
    ? Number.NaN
    : Number(rawOffset);
  if (!Number.isFinite(bottomSlotOffset)) throw new Error("bottom slot offset must be a number");
  if (bottomSlotOffset < 0 || bottomSlotOffset > 1000) {
    throw new Error("bottom slot offset must be between 0 and 1000 mm");
  }
  spec.bottom_slot_offset = bottomSlotOffset;

  const rawTopOffset = values.top_slot_offset ?? spec.wall_thickness;
  const topSlotOffset = typeof rawTopOffset === "string" && rawTopOffset.trim() === ""
    ? Number.NaN
    : Number(rawTopOffset);
  if (!Number.isFinite(topSlotOffset)) throw new Error("top slot offset must be a number");
  if (topSlotOffset < 0 || topSlotOffset > 1000) {
    throw new Error("top slot offset must be between 0 and 1000 mm");
  }
  spec.top_slot_offset = topSlotOffset;

  const exterior = exteriorDimensions(spec);
  if (exterior.width <= spec.wall_thickness * 3) {
    throw new Error("width must be more than three wall thicknesses");
  }
  if (exterior.depth <= spec.wall_thickness * 3) {
    throw new Error("depth must be more than three wall thicknesses");
  }
  const minimumHeight = spec.wall_thickness * 2
    + (spec.bottom_type === "none" ? 0 : spec.bottom_thickness)
    + (spec.top_type === "none" ? 0 : spec.top_thickness);
  if (exterior.height <= minimumHeight) {
    throw new Error("height is too small for the selected materials");
  }
  const wallPanelHeight = exterior.height
    - (spec.bottom_type === "butt_bottom" ? spec.bottom_thickness : 0)
    - (spec.top_type === "butt_top" ? spec.top_thickness : 0);
  if (spec.finger_size > wallPanelHeight / 2) {
    throw new Error("finger size must be no more than half the box height");
  }
  const usesHiddenFingers = spec.bottom_type === "hidden_finger_jointed"
    || spec.top_type === "hidden_finger_jointed"
    || spec.wall_connection === "hidden_finger";
  if (usesHiddenFingers && spec.hidden_finger_skin >= spec.wall_thickness) {
    throw new Error("hidden finger skin must be thinner than the wall material");
  }
  if (usesHiddenFingers && spec.joint_clearance >= spec.wall_thickness - spec.hidden_finger_skin) {
    throw new Error("joint clearance must be smaller than the hidden finger pocket depth");
  }
  if (spec.bottom_type === "captured") {
    if (spec.bottom_slot_depth + spec.bottom_slot_extra > spec.wall_thickness) {
      throw new Error("bottom slot depth plus extra cannot exceed the wall thickness");
    }
    if (spec.bottom_slot_extra >= spec.bottom_slot_depth) {
      throw new Error("bottom slot extra must be smaller than the slot depth");
    }
    if (spec.bottom_slot_offset + spec.bottom_thickness + spec.bottom_slot_extra > exterior.height) {
      throw new Error("bottom slot offset places the slot above the panel");
    }
  }
  if (spec.bottom_type === "inset" && spec.bottom_inset_depth >= spec.bottom_thickness) {
    throw new Error("bottom inset depth must be smaller than the bottom material thickness");
  }
  if (spec.bottom_type === "inset"
      && (exterior.width <= 2 * (spec.wall_thickness + spec.joint_clearance)
        || exterior.depth <= 2 * (spec.wall_thickness + spec.joint_clearance))) {
    throw new Error("joint clearance leaves no raised center on the inset bottom");
  }
  if (spec.top_type === "captured") {
    if (spec.top_slot_depth + spec.top_slot_extra > spec.wall_thickness) {
      throw new Error("top slot depth plus extra cannot exceed the wall thickness");
    }
    if (spec.top_slot_extra >= spec.top_slot_depth) {
      throw new Error("top slot extra must be smaller than the slot depth");
    }
    if (spec.top_slot_offset + spec.top_thickness + spec.top_slot_extra > exterior.height) {
      throw new Error("top slot offset places the slot below the panel");
    }
  }
  if (spec.top_type === "inset" && spec.top_inset_depth >= spec.top_thickness) {
    throw new Error("top inset depth must be smaller than the top material thickness");
  }
  if (spec.top_type === "inset"
      && (exterior.width <= 2 * (spec.wall_thickness + spec.joint_clearance)
        || exterior.depth <= 2 * (spec.wall_thickness + spec.joint_clearance))) {
    throw new Error("joint clearance leaves no raised center on the inset top");
  }
  if (spec.bottom_type === "captured" && spec.top_type === "captured") {
    const bottomGrooveTop = spec.bottom_slot_offset + spec.bottom_thickness + spec.bottom_slot_extra;
    const topGrooveBottom = exterior.height
      - spec.top_slot_offset - spec.top_thickness - spec.top_slot_extra;
    if (bottomGrooveTop >= topGrooveBottom) throw new Error("top and bottom slots overlap");
  }
  return spec;
}

function interiorFloorTop(spec) {
  if (spec.bottom_type === "captured") {
    return spec.bottom_slot_offset + spec.bottom_slot_extra / 2 + spec.bottom_thickness;
  }
  return spec.bottom_type === "none" ? 0 : spec.bottom_thickness;
}

function interiorCeilingDepth(spec) {
  if (spec.top_type === "captured") {
    return spec.top_slot_offset + spec.top_slot_extra / 2 + spec.top_thickness;
  }
  return spec.top_type === "none" ? 0 : spec.top_thickness;
}

function exteriorDimensions(spec) {
  if (spec.dimension_basis !== "interior") {
    return { width: spec.width, depth: spec.depth, height: spec.height };
  }
  return {
    width: spec.width + 2 * spec.wall_thickness,
    depth: spec.depth + 2 * spec.wall_thickness,
    height: spec.height + interiorFloorTop(spec) + interiorCeilingDepth(spec),
  };
}

function interiorDimensions(spec) {
  return {
    width: spec.width - 2 * spec.wall_thickness,
    depth: spec.depth - 2 * spec.wall_thickness,
    height: spec.height - interiorFloorTop(spec) - interiorCeilingDepth(spec),
  };
}

export function edgePoints(start, end, mode, targetSize, depth, phase = 0, clearance = 0) {
  const [x0, y0] = start;
  const [x1, y1] = end;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  if (mode === "plain") return { points: [[x0, y0], [x1, y1]], dogbones: [] };

  const tx = dx / length;
  const ty = dy / length;
  const outward = [ty, -tx];
  let segmentCount = Math.max(3, roundHalfEven(length / targetSize));
  if (segmentCount % 2 === 0) segmentCount += 1;
  const segment = length / segmentCount;
  if (mode === "slot" && clearance >= segment) {
    throw new Error("joint clearance must be smaller than each finger");
  }

  const boundaries = Array.from({ length: segmentCount + 1 }, (_, index) => segment * index);
  if (mode === "slot" && clearance > 0) {
    for (let index = 1; index < segmentCount; index += 1) {
      const previousActive = (index - 1 + phase) % 2 === 0;
      const nextActive = (index + phase) % 2 === 0;
      if (previousActive !== nextActive) {
        boundaries[index] += previousActive ? clearance / 2 : -clearance / 2;
      }
    }
  }

  const points = [[x0, y0]];
  const dogbones = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const active = (index + phase) % 2 === 0 && mode !== "plain";
    const offset = active
      ? (mode === "tab" ? depth : -(depth + clearance))
      : (mode === "tab" ? -clearance : 0);
    const sx = x0 + tx * boundaries[index];
    const sy = y0 + ty * boundaries[index];
    const ex = x0 + tx * boundaries[index + 1];
    const ey = y0 + ty * boundaries[index + 1];
    const ox = outward[0] * offset;
    const oy = outward[1] * offset;
    const segmentStart = [sx + ox, sy + oy];
    if (!samePoint(points.at(-1), segmentStart)) points.push(segmentStart);
    points.push([ex + ox, ey + oy]);
    if (mode === "slot" && active) dogbones.push(segmentStart, [ex + ox, ey + oy]);
  }
  if (!samePoint(points.at(-1), [x1, y1])) points.push([x1, y1]);
  return { points, dogbones };
}

function fingerPocketIntervals(length, targetSize, phase = 0, clearance = 0) {
  let segmentCount = Math.max(3, roundHalfEven(length / targetSize));
  if (segmentCount % 2 === 0) segmentCount += 1;
  const segment = length / segmentCount;
  if (clearance >= segment) throw new Error("joint clearance must be smaller than each finger");

  const boundaries = Array.from({ length: segmentCount + 1 }, (_, index) => segment * index);
  if (clearance > 0) {
    for (let index = 1; index < segmentCount; index += 1) {
      const previousActive = (index - 1 + phase) % 2 === 0;
      const nextActive = (index + phase) % 2 === 0;
      if (previousActive !== nextActive) {
        boundaries[index] += previousActive ? clearance / 2 : -clearance / 2;
      }
    }
  }
  return Array.from({ length: segmentCount }, (_, index) => (
    (index + phase) % 2 === 0 ? [boundaries[index], boundaries[index + 1]] : null
  )).filter(Boolean);
}

function cleanPolyline(points, { closed, tolerance = 1e-9 }) {
  const cleaned = [];
  for (const point of points) {
    if (!cleaned.length || distance(point, cleaned.at(-1)) > tolerance) cleaned.push(point);
  }
  if (closed && cleaned.length > 1 && distance(cleaned[0], cleaned.at(-1)) <= tolerance) {
    cleaned.pop();
  }

  let changed = true;
  while (changed && cleaned.length >= 3) {
    changed = false;
    const limit = closed ? cleaned.length : cleaned.length - 2;
    const startIndex = closed ? 0 : 1;
    for (let index = startIndex; index < limit; index += 1) {
      const previous = cleaned[(index - 1 + cleaned.length) % cleaned.length];
      const current = cleaned[index];
      const following = cleaned[(index + 1) % cleaned.length];
      const first = [current[0] - previous[0], current[1] - previous[1]];
      const second = [following[0] - current[0], following[1] - current[1]];
      const cross = first[0] * second[1] - first[1] * second[0];
      const scale = Math.max(1, Math.hypot(...first) * Math.hypot(...second));
      if (Math.abs(cross) <= tolerance * scale) {
        cleaned.splice(index, 1);
        changed = true;
        break;
      }
    }
  }

  const deduplicated = [];
  for (const point of cleaned) {
    if (!deduplicated.length || distance(point, deduplicated.at(-1)) > tolerance) {
      deduplicated.push(point);
    }
  }
  if (closed && deduplicated.length > 1 && distance(deduplicated[0], deduplicated.at(-1)) <= tolerance) {
    deduplicated.pop();
  }
  return deduplicated;
}

function dogboneOutline(points, radius, offset = 0, maximumArcStep = Math.PI / 8) {
  if (points.length < 3 || radius <= 0) {
    return { outline: points.map((point) => [...point]), bulges: points.map(() => 0), operations: [] };
  }
  if (offset >= radius) throw new Error("joint clearance must be smaller than the cutter radius");

  const twiceArea = points.reduce((sum, current, index) => {
    const following = points[(index + 1) % points.length];
    return sum + current[0] * following[1] - following[0] * current[1];
  }, 0);
  const winding = twiceArea > 0 ? 1 : -1;
  const reliefs = new Map();

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[(index - 1 + points.length) % points.length];
    const following = points[(index + 1) % points.length];
    const incoming = [current[0] - previous[0], current[1] - previous[1]];
    const outgoing = [following[0] - current[0], following[1] - current[1]];
    const turn = incoming[0] * outgoing[1] - incoming[1] * outgoing[0];
    const scale = Math.max(1, Math.hypot(...incoming) * Math.hypot(...outgoing));
    if (turn * winding >= -1e-9 * scale) continue;

    const incomingLength = Math.hypot(...incoming);
    const outgoingLength = Math.hypot(...outgoing);
    const towardPrevious = [-incoming[0] / incomingLength, -incoming[1] / incomingLength];
    const towardFollowing = [outgoing[0] / outgoingLength, outgoing[1] / outgoingLength];
    const bisector = [
      towardPrevious[0] + towardFollowing[0],
      towardPrevious[1] + towardFollowing[1],
    ];
    const bisectorLength = Math.hypot(...bisector);
    if (bisectorLength <= 1e-9) throw new Error("dogbone relief requires a valid inside corner");
    const centerOffset = [
      bisector[0] / bisectorLength * (radius - offset),
      bisector[1] / bisectorLength * (radius - offset),
    ];
    const center = [current[0] + centerOffset[0], current[1] + centerOffset[1]];
    const centerDistanceSquared = centerOffset[0] ** 2 + centerOffset[1] ** 2;
    const edgeTrim = (direction) => {
      const projection = direction[0] * centerOffset[0] + direction[1] * centerOffset[1];
      const discriminant = radius ** 2 - (centerDistanceSquared - projection ** 2);
      if (discriminant < -1e-9) {
        throw new Error("joint clearance is too large for the selected cutter diameter");
      }
      return projection + Math.sqrt(Math.max(0, discriminant));
    };
    reliefs.set(index, {
      type: "dogbone",
      cx: center[0],
      cy: center[1],
      corner: [...current],
      radius,
      incoming_trim: edgeTrim(towardPrevious),
      outgoing_trim: edgeTrim(towardFollowing),
    });
  }

  for (let index = 0; index < points.length; index += 1) {
    const endIndex = (index + 1) % points.length;
    let required = 0;
    if (reliefs.has(index)) required += reliefs.get(index).outgoing_trim;
    if (reliefs.has(endIndex)) required += reliefs.get(endIndex).incoming_trim;
    if (required && distance(points[index], points[endIndex]) <= required + 1e-9) {
      throw new Error("cutter diameter is too large for the selected finger joints");
    }
  }

  const outline = [];
  const bulges = [];
  const appendPoint = (point, incomingBulge = 0) => {
    if (outline.length) bulges[bulges.length - 1] = incomingBulge;
    outline.push(point);
    bulges.push(0);
  };

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    if (!reliefs.has(index)) {
      appendPoint([...current]);
      continue;
    }
    const previous = points[(index - 1 + points.length) % points.length];
    const following = points[(index + 1) % points.length];
    const incomingLength = distance(previous, current);
    const outgoingLength = distance(current, following);
    const incoming = [(current[0] - previous[0]) / incomingLength, (current[1] - previous[1]) / incomingLength];
    const outgoing = [(following[0] - current[0]) / outgoingLength, (following[1] - current[1]) / outgoingLength];
    const relief = reliefs.get(index);
    const center = [relief.cx, relief.cy];
    const start = [
      current[0] - incoming[0] * relief.incoming_trim,
      current[1] - incoming[1] * relief.incoming_trim,
    ];
    appendPoint(start);
    const end = [
      current[0] + outgoing[0] * relief.outgoing_trim,
      current[1] + outgoing[1] * relief.outgoing_trim,
    ];
    const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
    const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
    const sweep = winding > 0
      ? -positiveModulo(startAngle - endAngle, Math.PI * 2)
      : positiveModulo(endAngle - startAngle, Math.PI * 2);
    const segmentCount = Math.max(1, Math.ceil(Math.abs(sweep) / maximumArcStep - 1e-12));
    const segmentSweep = sweep / segmentCount;
    const segmentBulge = Math.tan(segmentSweep / 4);
    for (let step = 1; step <= segmentCount; step += 1) {
      const angle = startAngle + segmentSweep * step;
      appendPoint([
        center[0] + Math.cos(angle) * radius,
        center[1] + Math.sin(angle) * radius,
      ], segmentBulge);
    }
  }

  const operations = [...reliefs.values()].map(({ incoming_trim, outgoing_trim, ...operation }) => operation);
  return { outline, bulges, operations };
}

function dogbonePocketOutline(points, reliefIndices, radius, offset = 0, maximumArcStep = Math.PI / 8) {
  if (!reliefIndices.length || radius <= 0) {
    return { outline: points.map((point) => [...point]), bulges: points.map(() => 0), operations: [] };
  }
  if (offset >= radius) throw new Error("joint clearance must be smaller than the cutter radius");

  const reliefs = new Map();
  for (const index of reliefIndices) {
    const current = points[index];
    const previous = points[(index - 1 + points.length) % points.length];
    const following = points[(index + 1) % points.length];
    const incomingLength = distance(previous, current);
    const outgoingLength = distance(current, following);
    const incoming = [
      (current[0] - previous[0]) / incomingLength,
      (current[1] - previous[1]) / incomingLength,
    ];
    const outgoing = [
      (following[0] - current[0]) / outgoingLength,
      (following[1] - current[1]) / outgoingLength,
    ];
    const pocketBisector = [outgoing[0] - incoming[0], outgoing[1] - incoming[1]];
    const bisectorLength = Math.hypot(...pocketBisector);
    if (bisectorLength <= 1e-9) throw new Error("dogbone relief requires a valid pocket corner");
    const centerOffset = pocketBisector.map((value) => value / bisectorLength * (radius - offset));
    const center = [current[0] + centerOffset[0], current[1] + centerOffset[1]];
    const centerDistanceSquared = centerOffset[0] ** 2 + centerOffset[1] ** 2;
    const edgeTrim = (direction) => {
      const projection = direction[0] * centerOffset[0] + direction[1] * centerOffset[1];
      const discriminant = radius ** 2 - (centerDistanceSquared - projection ** 2);
      if (discriminant < -1e-9) {
        throw new Error("joint clearance is too large for the selected cutter diameter");
      }
      return projection + Math.sqrt(Math.max(0, discriminant));
    };
    reliefs.set(index, {
      type: "hidden_finger_relief",
      cx: center[0],
      cy: center[1],
      corner: [...current],
      radius,
      incoming_trim: edgeTrim([-incoming[0], -incoming[1]]),
      outgoing_trim: edgeTrim(outgoing),
    });
  }

  for (let index = 0; index < points.length; index += 1) {
    const endIndex = (index + 1) % points.length;
    const required = (reliefs.get(index)?.outgoing_trim ?? 0)
      + (reliefs.get(endIndex)?.incoming_trim ?? 0);
    if (required && distance(points[index], points[endIndex]) <= required + 1e-9) {
      throw new Error("cutter diameter is too large for the selected hidden finger pockets");
    }
  }

  const outline = [];
  const bulges = [];
  const appendPoint = (point, incomingBulge = 0) => {
    if (outline.length) bulges[bulges.length - 1] = incomingBulge;
    outline.push(point);
    bulges.push(0);
  };
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    if (!reliefs.has(index)) {
      appendPoint([...current]);
      continue;
    }
    const previous = points[(index - 1 + points.length) % points.length];
    const following = points[(index + 1) % points.length];
    const incomingLength = distance(previous, current);
    const outgoingLength = distance(current, following);
    const incoming = [
      (current[0] - previous[0]) / incomingLength,
      (current[1] - previous[1]) / incomingLength,
    ];
    const outgoing = [
      (following[0] - current[0]) / outgoingLength,
      (following[1] - current[1]) / outgoingLength,
    ];
    const relief = reliefs.get(index);
    const center = [relief.cx, relief.cy];
    const start = [
      current[0] - incoming[0] * relief.incoming_trim,
      current[1] - incoming[1] * relief.incoming_trim,
    ];
    const end = [
      current[0] + outgoing[0] * relief.outgoing_trim,
      current[1] + outgoing[1] * relief.outgoing_trim,
    ];
    appendPoint(start);
    const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
    const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
    let sweep = positiveModulo(endAngle - startAngle, Math.PI * 2);
    if (sweep <= 1e-9) sweep = Math.PI * 2;
    const segmentCount = Math.max(1, Math.ceil(sweep / maximumArcStep - 1e-12));
    const segmentSweep = sweep / segmentCount;
    const segmentBulge = Math.tan(segmentSweep / 4);
    for (let step = 1; step <= segmentCount; step += 1) {
      const angle = startAngle + segmentSweep * step;
      appendPoint([
        center[0] + Math.cos(angle) * radius,
        center[1] + Math.sin(angle) * radius,
      ], segmentBulge);
    }
  }

  const operations = [...reliefs.values()].map(({ incoming_trim, outgoing_trim, ...operation }) => operation);
  return { outline, bulges, operations };
}

function fingeredPanel({
  x,
  y,
  width,
  height,
  verticalMode,
  verticalJointDepth = jointDepth,
  fingerSize,
  jointDepth,
  label,
  groove,
  topGroove = null,
  grooveDepth,
  topGrooveDepth = 0,
  cutterDiameter,
  jointClearance,
  useDogbones,
  bottomMode = "plain",
  bottomJointDepth = jointDepth,
  bottomJointInsets = [0, 0],
  bottomPhase = 0,
  miteredEdges = false,
  hiddenVerticalPockets = false,
  hiddenVerticalPocketPhase = 0,
  hiddenVerticalPocketReach = null,
  hiddenVerticalPocketBaseReach = 0,
  hiddenBottomPockets = false,
  topMode = "plain",
  topJointDepth = jointDepth,
  topJointInsets = [0, 0],
  topPhase = 0,
  hiddenTopPockets = false,
  hiddenPocketDepth = 0,
}) {
  const [bottomStartInset, bottomEndInset] = bottomJointInsets;
  const [topStartInset, topEndInset] = topJointInsets;
  const corners = [
    [[0, 0], [bottomStartInset, 0], "plain", 0, jointDepth, 0],
    [[bottomStartInset, 0], [width - bottomEndInset, 0], bottomMode, bottomPhase, bottomJointDepth, jointClearance],
    [[width - bottomEndInset, 0], [width, 0], "plain", 0, jointDepth, 0],
    [[width, 0], [width, height], verticalMode, 0, verticalJointDepth, jointClearance],
    [[width, height], [width - topStartInset, height], "plain", 0, jointDepth, 0],
    [[width - topStartInset, height], [topEndInset, height], topMode, topPhase, topJointDepth, jointClearance],
    [[topEndInset, height], [0, height], "plain", 0, jointDepth, 0],
    [[0, height], [0, 0], verticalMode, 0, verticalJointDepth, jointClearance],
  ];
  const outline = [];
  for (const [start, end, mode, phase, depth, clearance] of corners) {
    if (samePoint(start, end)) continue;
    const edge = edgePoints(start, end, mode, fingerSize, depth, phase, clearance).points;
    outline.push(...(outline.length ? edge.slice(1) : edge));
  }

  const squareOutline = cleanPolyline(outline, { closed: true });
  const routedOutline = useDogbones
    ? dogboneOutline(squareOutline, cutterDiameter / 2, jointClearance)
    : { outline: squareOutline, bulges: squareOutline.map(() => 0), operations: [] };
  const translatedOutline = routedOutline.outline.map(([px, py]) => [px + x, py + y]);
  const operations = [...routedOutline.operations];
  const entities = [{
    type: "polyline",
    layer: "CUT_OUTSIDE",
    closed: true,
    points: translatedOutline,
    bulges: routedOutline.bulges,
  }];

  const addGroove = (grooveRect, depth, layer) => {
    if (!grooveRect) return;
    let [gx, gy, gw, gh] = grooveRect;
    const pieceLeft = Math.min(...squareOutline.map((point) => point[0]));
    const pieceRight = Math.max(...squareOutline.map((point) => point[0]));
    const grooveLeft = Math.max(pieceLeft, gx);
    const grooveRight = Math.min(pieceRight, gx + gw);
    gx = grooveLeft;
    gw = Math.max(0, grooveRight - grooveLeft);
    operations.push({ type: "groove", rect: [gx, gy, gw, gh], depth });
    entities.push({
      type: "polyline",
      layer,
      closed: true,
      points: [
        [x + gx, y + gy],
        [x + gx + gw, y + gy],
        [x + gx + gw, y + gy + gh],
        [x + gx, y + gy + gh],
      ],
    });
  };
  addGroove(groove, grooveDepth, "POCKET_BOTTOM_SLOT");
  addGroove(topGroove, topGrooveDepth, "POCKET_TOP_SLOT");
  const addHiddenPocket = (rect, openSide) => {
    let [px, py, pw, ph] = rect;
    const right = Math.min(width, px + pw);
    const top = Math.min(height, py + ph);
    px = Math.max(0, px);
    py = Math.max(0, py);
    pw = right - px;
    ph = top - py;
    if (pw <= 0 || ph <= 0) return;
    operations.push({ type: "hidden_finger_pocket", rect: [px, py, pw, ph], depth: hiddenPocketDepth });
    const pocketOutline = [
      [px, py],
      [px + pw, py],
      [px + pw, py + ph],
      [px, py + ph],
    ];
    const reliefIndices = [];
    if (openSide === "left") {
      if (py > 1e-9) reliefIndices.push(1);
      if (py + ph < height - 1e-9) reliefIndices.push(2);
    } else if (openSide === "right") {
      if (py > 1e-9) reliefIndices.push(0);
      if (py + ph < height - 1e-9) reliefIndices.push(3);
    } else if (openSide === "bottom") {
      if (px + pw < width - 1e-9) reliefIndices.push(2);
      if (px > 1e-9) reliefIndices.push(3);
    } else {
      if (px > 1e-9) reliefIndices.push(0);
      if (px + pw < width - 1e-9) reliefIndices.push(1);
    }
    const routedPocket = useDogbones
      ? dogbonePocketOutline(pocketOutline, reliefIndices, cutterDiameter / 2, jointClearance)
      : { outline: pocketOutline, bulges: pocketOutline.map(() => 0), operations: [] };
    operations.push(...routedPocket.operations.map((operation) => ({
      ...operation,
      depth: hiddenPocketDepth,
    })));
    entities.push({
      type: "polyline",
      layer: "POCKET_HIDDEN_FINGERS",
      closed: true,
      points: routedPocket.outline.map(([pointX, pointY]) => [x + pointX, y + pointY]),
      bulges: routedPocket.bulges,
    });
  };
  if (hiddenVerticalPockets) {
    const reach = hiddenVerticalPocketReach ?? jointDepth + jointClearance;
    if (hiddenVerticalPocketBaseReach > 0) {
      addHiddenPocket([0, 0, hiddenVerticalPocketBaseReach, height], "left");
      addHiddenPocket([
        width - hiddenVerticalPocketBaseReach,
        0,
        hiddenVerticalPocketBaseReach,
        height,
      ], "right");
    }
    for (const [start, end] of fingerPocketIntervals(
      height,
      fingerSize,
      hiddenVerticalPocketPhase,
      jointClearance,
    )) {
      addHiddenPocket([
        hiddenVerticalPocketBaseReach,
        start,
        reach - hiddenVerticalPocketBaseReach,
        end - start,
      ], "left");
      addHiddenPocket([
        width - reach,
        start,
        reach - hiddenVerticalPocketBaseReach,
        end - start,
      ], "right");
    }
  }
  if (hiddenBottomPockets) {
    const reach = bottomJointDepth + jointClearance;
    const runLength = width - bottomStartInset - bottomEndInset;
    for (const [start, end] of fingerPocketIntervals(runLength, fingerSize, bottomPhase, jointClearance)) {
      addHiddenPocket([
        bottomStartInset + start,
        0,
        end - start,
        reach,
      ], "bottom");
    }
  }
  if (hiddenTopPockets) {
    const reach = topJointDepth + jointClearance;
    const runLength = width - topStartInset - topEndInset;
    for (const [start, end] of fingerPocketIntervals(runLength, fingerSize, topPhase, jointClearance)) {
      addHiddenPocket([
        topEndInset + start,
        height - reach,
        end - start,
        reach,
      ], "top");
    }
  }
  if (miteredEdges) {
    for (const endX of [jointDepth, width - jointDepth]) {
      entities.push({
        type: "polyline",
        layer: "MITER_END",
        closed: false,
        points: [
          [x + endX, y],
          [x + endX, y + height],
        ],
      });
    }
  }
  entities.push({
    type: "text",
    layer: "ANNOTATION",
    x: x + width / 2,
    y: y + height / 2,
    height: Math.max(3, Math.min(width, height) * 0.055),
    text: label,
  });
  return {
    name: label,
    width,
    height,
    thickness: jointDepth,
    profile: routedOutline.outline,
    diagnostic_profile: squareOutline,
    mitered_edges: miteredEdges,
    operations,
    layout_origin: [x, y],
    entities,
  };
}

function panelPart({
  x,
  y,
  coreWidth,
  coreDepth,
  thickness,
  edgeMode,
  fingerSize,
  jointDepth,
  cutterDiameter,
  useDogbones,
  label,
  name,
  assembly,
  edgePhase = 0,
  insetPockets = [],
  insetPocketDepth = 0,
  insetPocketLayer = "POCKET_BOTTOM_INSET",
}) {
  const edges = [
    [[0, 0], [coreWidth, 0]],
    [[coreWidth, 0], [coreWidth, coreDepth]],
    [[coreWidth, coreDepth], [0, coreDepth]],
    [[0, coreDepth], [0, 0]],
  ];
  const outline = [];
  for (const [start, end] of edges) {
    const edge = edgePoints(
      start,
      end,
      edgeMode,
      fingerSize,
      jointDepth,
      edgePhase,
      0,
    ).points;
    outline.push(...(outline.length ? edge.slice(1) : edge));
  }
  const squareOutline = cleanPolyline(outline, { closed: true });
  const routedOutline = useDogbones
    ? dogboneOutline(squareOutline, cutterDiameter / 2, 0)
    : { outline: squareOutline, bulges: squareOutline.map(() => 0), operations: [] };
  const translatedOutline = routedOutline.outline.map(([px, py]) => [px + x, py + y]);
  const bounds = {
    minX: Math.min(...routedOutline.outline.map(([px]) => px)),
    maxX: Math.max(...routedOutline.outline.map(([px]) => px)),
    minY: Math.min(...routedOutline.outline.map(([, py]) => py)),
    maxY: Math.max(...routedOutline.outline.map(([, py]) => py)),
  };
  const entities = [
    {
      type: "polyline",
      layer: "CUT_OUTSIDE",
      closed: true,
      points: translatedOutline,
      bulges: routedOutline.bulges,
    },
    ...insetPockets.map((rect) => {
      const [px, py, pw, ph] = rect;
      return {
        type: "polyline",
        layer: insetPocketLayer,
        closed: true,
        points: [
          [x + px, y + py],
          [x + px + pw, y + py],
          [x + px + pw, y + py + ph],
          [x + px, y + py + ph],
        ],
      };
    }),
    {
      type: "text",
      layer: "ANNOTATION",
      x: x + (bounds.minX + bounds.maxX) / 2,
      y: y + (bounds.minY + bounds.maxY) / 2,
      height: Math.max(3, Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.045),
      text: label,
    },
  ];
  return {
    name,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    thickness,
    profile: routedOutline.outline,
    diagnostic_profile: squareOutline,
    operations: [
      ...routedOutline.operations,
      ...insetPockets.map((rect) => ({ type: "inset_pocket", rect, depth: insetPocketDepth })),
    ],
    layout_origin: [x, y],
    assembly,
    entities,
  };
}

function entityBounds(entities) {
  const xs = [];
  const ys = [];
  for (const entity of entities) {
    if (entity.type === "polyline") {
      xs.push(...entity.points.map((point) => point[0]));
      ys.push(...entity.points.map((point) => point[1]));
    } else if (entity.type === "circle") {
      xs.push(entity.cx - entity.r, entity.cx + entity.r);
      ys.push(entity.cy - entity.r, entity.cy + entity.r);
    }
  }
  return { min_x: Math.min(...xs), min_y: Math.min(...ys), max_x: Math.max(...xs), max_y: Math.max(...ys) };
}

export function buildLayout(values) {
  const requestedSpec = validateSpec(values);
  const spec = { ...requestedSpec, ...exteriorDimensions(requestedSpec) };
  const wall = spec.wall_thickness;
  const hasBottom = spec.bottom_type !== "none";
  const capturedBottom = spec.bottom_type === "captured";
  const insetBottom = spec.bottom_type === "inset";
  const fingerJointedBottom = spec.bottom_type === "finger_jointed";
  const hiddenFingerBottom = spec.bottom_type === "hidden_finger_jointed";
  const hasFingerBottom = fingerJointedBottom || hiddenFingerBottom;
  const hasTop = spec.top_type !== "none";
  const capturedTop = spec.top_type === "captured";
  const insetTop = spec.top_type === "inset";
  const fingerJointedTop = spec.top_type === "finger_jointed";
  const hiddenFingerTop = spec.top_type === "hidden_finger_jointed";
  const hasFingerTop = fingerJointedTop || hiddenFingerTop;
  const hiddenFingerWalls = spec.wall_connection === "hidden_finger";
  const fingerWalls = spec.wall_connection === "finger" || hiddenFingerWalls;
  const miteredWalls = spec.wall_connection === "miter";
  const hiddenPocketDepth = wall - spec.hidden_finger_skin;
  const hiddenTabDepth = hiddenPocketDepth - spec.joint_clearance;
  const bottomClearance = capturedBottom ? spec.bottom_slot_extra : 0;
  const bottomSlotHeight = capturedBottom ? spec.bottom_thickness + bottomClearance : 0;
  const bottomSlotY = capturedBottom ? spec.bottom_slot_offset : 0;
  const bottomPocketDepth = capturedBottom
    ? roundTo(spec.bottom_slot_depth + bottomClearance, 12)
    : insetBottom ? spec.bottom_inset_depth : 0;
  const bottomSlotExtension = bottomPocketDepth;
  const bottomEngagement = capturedBottom ? spec.bottom_slot_depth : 0;
  const topClearance = capturedTop ? spec.top_slot_extra : 0;
  const topSlotHeight = capturedTop ? spec.top_thickness + topClearance : 0;
  const topPocketDepth = capturedTop
    ? roundTo(spec.top_slot_depth + topClearance, 12)
    : insetTop ? spec.top_inset_depth : 0;
  const topSlotExtension = topPocketDepth;
  const topEngagement = capturedTop ? spec.top_slot_depth : 0;
  const fullWidthFronts = miteredWalls || hiddenFingerWalls || spec.wall_connection === "butt_sides";
  const insetSides = spec.wall_connection === "butt_sides";
  const frontWidth = fullWidthFronts ? spec.width : spec.width - 2 * wall;
  const sideWidth = hiddenFingerWalls
    ? spec.depth - 2 * spec.hidden_finger_skin
    : insetSides ? spec.depth - 2 * wall : spec.depth;
  const frontOriginX = fullWidthFronts ? 0 : wall;
  const sideOriginY = hiddenFingerWalls ? spec.hidden_finger_skin : insetSides ? wall : 0;
  const gap = Math.max(18, wall * 3);
  const margin = 20;
  const wallBaseZ = spec.bottom_type === "butt_bottom"
    ? spec.bottom_thickness
    : insetBottom ? spec.bottom_thickness - spec.bottom_inset_depth : 0;
  const wallTopZ = spec.top_type === "butt_top"
    ? spec.height - spec.top_thickness
    : insetTop ? spec.height - (spec.top_thickness - spec.top_inset_depth) : spec.height;
  const wallHeight = wallTopZ - wallBaseZ;
  const assembledHeight = spec.height;

  const common = {
    height: wallHeight,
    fingerSize: spec.finger_size,
    jointDepth: wall,
    verticalJointDepth: wall,
    grooveDepth: bottomPocketDepth,
    topGrooveDepth: topPocketDepth,
    cutterDiameter: spec.cutter_diameter,
    jointClearance: spec.joint_clearance,
    useDogbones: spec.use_dogbones,
    bottomMode: fingerJointedBottom ? "slot" : "plain",
    bottomJointDepth: spec.bottom_thickness,
    bottomPhase: hasFingerBottom ? 1 : 0,
    hiddenBottomPockets: hiddenFingerBottom,
    topMode: fingerJointedTop ? "slot" : "plain",
    topJointDepth: spec.top_thickness,
    topPhase: hasFingerTop ? 1 : 0,
    hiddenTopPockets: hiddenFingerTop,
    hiddenPocketDepth,
    miteredEdges: miteredWalls,
  };
  const capturedGroove = (origin, axisLength) => capturedBottom
    ? [wall - bottomSlotExtension - origin, bottomSlotY,
      axisLength - 2 * wall + 2 * bottomSlotExtension, bottomSlotHeight]
    : null;
  const capturedTopGroove = (origin, axisLength) => capturedTop
    ? [wall - topSlotExtension - origin, wallHeight - spec.top_slot_offset - topSlotHeight,
      axisLength - 2 * wall + 2 * topSlotExtension, topSlotHeight]
    : null;
  const frontBottomInsets = hasFingerBottom
    ? [wall - frontOriginX, frontOriginX + frontWidth - (spec.width - wall)]
    : [0, 0];
  const sideBottomInsets = hasFingerBottom
    ? [wall - sideOriginY, sideOriginY + sideWidth - (spec.depth - wall)]
    : [0, 0];
  const frontTopInsets = hasFingerTop
    ? [wall - frontOriginX, frontOriginX + frontWidth - (spec.width - wall)]
    : [0, 0];
  const sideTopInsets = hasFingerTop
    ? [wall - sideOriginY, sideOriginY + sideWidth - (spec.depth - wall)]
    : [0, 0];
  const placements = [
    fingeredPanel({
      ...common,
      x: margin,
      y: margin,
      width: frontWidth,
      verticalMode: fingerWalls && !hiddenFingerWalls ? "tab" : "plain",
      hiddenVerticalPockets: hiddenFingerWalls,
      hiddenVerticalPocketPhase: 0,
      hiddenVerticalPocketReach: wall + spec.joint_clearance,
      hiddenVerticalPocketBaseReach: spec.hidden_finger_skin + spec.joint_clearance,
      label: "FRONT",
      groove: capturedGroove(frontOriginX, spec.width),
      topGroove: capturedTopGroove(frontOriginX, spec.width),
      bottomJointInsets: frontBottomInsets,
      topJointInsets: frontTopInsets,
    }),
    fingeredPanel({
      ...common,
      x: margin,
      y: margin + wallHeight + gap,
      width: frontWidth,
      verticalMode: fingerWalls && !hiddenFingerWalls ? "tab" : "plain",
      hiddenVerticalPockets: hiddenFingerWalls,
      hiddenVerticalPocketPhase: 0,
      hiddenVerticalPocketReach: wall + spec.joint_clearance,
      hiddenVerticalPocketBaseReach: spec.hidden_finger_skin + spec.joint_clearance,
      label: "BACK",
      groove: capturedGroove(frontOriginX, spec.width),
      topGroove: capturedTopGroove(frontOriginX, spec.width),
      bottomJointInsets: frontBottomInsets,
      topJointInsets: frontTopInsets,
    }),
    fingeredPanel({
      ...common,
      x: margin + spec.width + wall + gap,
      y: margin,
      width: sideWidth,
      verticalMode: fingerWalls && !hiddenFingerWalls ? "slot" : "plain",
      hiddenVerticalPockets: hiddenFingerWalls,
      hiddenVerticalPocketPhase: 1,
      hiddenVerticalPocketReach: wall - spec.hidden_finger_skin + spec.joint_clearance,
      hiddenVerticalPocketBaseReach: spec.joint_clearance,
      label: "LEFT SIDE",
      groove: capturedGroove(sideOriginY, spec.depth),
      topGroove: capturedTopGroove(sideOriginY, spec.depth),
      bottomJointInsets: sideBottomInsets,
      topJointInsets: sideTopInsets,
    }),
    fingeredPanel({
      ...common,
      x: margin + spec.width + wall + gap,
      y: margin + wallHeight + gap,
      width: sideWidth,
      verticalMode: fingerWalls && !hiddenFingerWalls ? "slot" : "plain",
      hiddenVerticalPockets: hiddenFingerWalls,
      hiddenVerticalPocketPhase: 1,
      hiddenVerticalPocketReach: wall - spec.hidden_finger_skin + spec.joint_clearance,
      hiddenVerticalPocketBaseReach: spec.joint_clearance,
      label: "RIGHT SIDE",
      groove: capturedGroove(sideOriginY, spec.depth),
      topGroove: capturedTopGroove(sideOriginY, spec.depth),
      bottomJointInsets: sideBottomInsets,
      topJointInsets: sideTopInsets,
    }),
  ];

  const assemblyTransforms = [
    { origin: [frontOriginX, 0, wallBaseZ], u_axis: [1, 0, 0], v_axis: [0, 0, 1], thickness_axis: [0, 1, 0], explode_axis: [0, -1, 0] },
    { origin: [frontOriginX, spec.depth, wallBaseZ], u_axis: [1, 0, 0], v_axis: [0, 0, 1], thickness_axis: [0, -1, 0], explode_axis: [0, 1, 0] },
    { origin: [0, sideOriginY, wallBaseZ], u_axis: [0, 1, 0], v_axis: [0, 0, 1], thickness_axis: [1, 0, 0], explode_axis: [-1, 0, 0] },
    { origin: [spec.width, sideOriginY, wallBaseZ], u_axis: [0, 1, 0], v_axis: [0, 0, 1], thickness_axis: [-1, 0, 0], explode_axis: [1, 0, 0] },
  ];
  placements.forEach((part, index) => { part.assembly = assemblyTransforms[index]; });

  const bottomY = margin + 2 * (wallHeight + gap);
  const insetPocketWidth = wall + spec.joint_clearance;
  const insetPockets = [
    [0, 0, spec.width, insetPocketWidth],
    [0, spec.depth - insetPocketWidth, spec.width, insetPocketWidth],
    [0, insetPocketWidth, insetPocketWidth, spec.depth - 2 * insetPocketWidth],
    [spec.width - insetPocketWidth, insetPocketWidth, insetPocketWidth, spec.depth - 2 * insetPocketWidth],
  ];
  const bottomConfigurations = {
    captured: {
      coreWidth: spec.width - 2 * wall + 2 * bottomEngagement,
      coreDepth: spec.depth - 2 * wall + 2 * bottomEngagement,
      edgeMode: "plain",
      jointDepth: 0,
      label: "CAPTURED BOTTOM",
      assemblyOrigin: [wall - bottomEngagement, wall - bottomEngagement,
        bottomSlotY + bottomClearance / 2],
    },
    inset: {
      coreWidth: spec.width,
      coreDepth: spec.depth,
      edgeMode: "plain",
      jointDepth: 0,
      label: "INSET BOTTOM",
      assemblyOrigin: [0, 0, 0],
    },
    butt_bottom: {
      coreWidth: spec.width,
      coreDepth: spec.depth,
      edgeMode: "plain",
      jointDepth: 0,
      label: "BUTT-BOTTOM",
      assemblyOrigin: [0, 0, 0],
    },
    butt_inside: {
      coreWidth: spec.width - 2 * wall,
      coreDepth: spec.depth - 2 * wall,
      edgeMode: "plain",
      jointDepth: 0,
      label: "BUTT-INSIDE BOTTOM",
      assemblyOrigin: [wall, wall, 0],
    },
    finger_jointed: {
      coreWidth: spec.width - 2 * wall,
      coreDepth: spec.depth - 2 * wall,
      edgeMode: "tab",
      jointDepth: wall,
      label: "FINGER-JOINTED BOTTOM",
      assemblyOrigin: [wall, wall, 0],
    },
    hidden_finger_jointed: {
      coreWidth: spec.width - 2 * wall,
      coreDepth: spec.depth - 2 * wall,
      edgeMode: "tab",
      jointDepth: hiddenTabDepth,
      label: "HIDDEN-FINGER BOTTOM",
      assemblyOrigin: [wall, wall, 0],
    },
  };
  let bottom = null;
  if (hasBottom) {
    const bottomConfig = bottomConfigurations[spec.bottom_type];
    const bottomLayoutInset = bottomConfig.edgeMode === "tab" ? wall : 0;
    bottom = panelPart({
      x: margin + bottomLayoutInset,
      y: bottomY + bottomLayoutInset,
      coreWidth: bottomConfig.coreWidth,
      coreDepth: bottomConfig.coreDepth,
      thickness: spec.bottom_thickness,
      edgeMode: bottomConfig.edgeMode,
      fingerSize: spec.finger_size,
      jointDepth: bottomConfig.jointDepth,
      cutterDiameter: spec.cutter_diameter,
      useDogbones: spec.use_dogbones,
      label: bottomConfig.label,
      name: "BOTTOM",
      edgePhase: bottomConfig.edgeMode === "tab" ? 1 : 0,
      insetPockets: insetBottom ? insetPockets : [],
      insetPocketDepth: insetBottom ? spec.bottom_inset_depth : 0,
      assembly: {
        origin: bottomConfig.assemblyOrigin,
        u_axis: [1, 0, 0],
        v_axis: [0, 1, 0],
        thickness_axis: [0, 0, 1],
        explode_axis: [0, 0, 0],
      },
    });
    placements.push(bottom);
  }

  const topConfigurations = {
    captured: {
      coreWidth: spec.width - 2 * wall + 2 * topEngagement,
      coreDepth: spec.depth - 2 * wall + 2 * topEngagement,
      edgeMode: "plain",
      jointDepth: 0,
      label: "CAPTURED TOP",
      assemblyOrigin: [wall - topEngagement, wall - topEngagement,
        spec.height - spec.top_slot_offset - topClearance / 2],
    },
    inset: {
      coreWidth: spec.width,
      coreDepth: spec.depth,
      edgeMode: "plain",
      jointDepth: 0,
      label: "INSET TOP",
      assemblyOrigin: [0, 0, spec.height],
    },
    butt_top: {
      coreWidth: spec.width,
      coreDepth: spec.depth,
      edgeMode: "plain",
      jointDepth: 0,
      label: "BUTT-TOP",
      assemblyOrigin: [0, 0, spec.height],
    },
    butt_inside: {
      coreWidth: spec.width - 2 * wall,
      coreDepth: spec.depth - 2 * wall,
      edgeMode: "plain",
      jointDepth: 0,
      label: "BUTT-INSIDE TOP",
      assemblyOrigin: [wall, wall, spec.height],
    },
    finger_jointed: {
      coreWidth: spec.width - 2 * wall,
      coreDepth: spec.depth - 2 * wall,
      edgeMode: "tab",
      jointDepth: wall,
      label: "FINGER-JOINTED TOP",
      assemblyOrigin: [wall, wall, spec.height],
    },
    hidden_finger_jointed: {
      coreWidth: spec.width - 2 * wall,
      coreDepth: spec.depth - 2 * wall,
      edgeMode: "tab",
      jointDepth: hiddenTabDepth,
      label: "HIDDEN-FINGER TOP",
      assemblyOrigin: [wall, wall, spec.height],
    },
  };
  let top = null;
  if (hasTop) {
    const topConfig = topConfigurations[spec.top_type];
    const topLayoutInset = topConfig.edgeMode === "tab" ? wall : 0;
    const topY = bottomY + (hasBottom ? spec.depth + 2 * wall + gap : 0);
    top = panelPart({
      x: margin + topLayoutInset,
      y: topY + topLayoutInset,
      coreWidth: topConfig.coreWidth,
      coreDepth: topConfig.coreDepth,
      thickness: spec.top_thickness,
      edgeMode: topConfig.edgeMode,
      fingerSize: spec.finger_size,
      jointDepth: topConfig.jointDepth,
      cutterDiameter: spec.cutter_diameter,
      useDogbones: spec.use_dogbones,
      label: topConfig.label,
      name: "TOP",
      edgePhase: topConfig.edgeMode === "tab" ? 1 : 0,
      insetPockets: insetTop ? insetPockets : [],
      insetPocketDepth: insetTop ? spec.top_inset_depth : 0,
      insetPocketLayer: "POCKET_TOP_INSET",
      assembly: {
        origin: topConfig.assemblyOrigin,
        u_axis: [1, 0, 0],
        v_axis: [0, 1, 0],
        thickness_axis: [0, 0, -1],
        explode_axis: [0, 0, 1],
      },
    });
    placements.push(top);
  }

  const entities = placements.flatMap((part) => part.entities);
  return {
    units: "mm",
    spec: { ...requestedSpec },
    assembled_dimensions: {
      width: spec.width,
      depth: spec.depth,
      height: assembledHeight,
    },
    interior_dimensions: interiorDimensions(spec),
    entities,
    parts: placements.map(({ entities: _entities, ...part }) => part),
    bounds: entityBounds(entities),
    manufacturing: {
      bottom_type: spec.bottom_type,
      top_type: spec.top_type,
      wall_connection: spec.wall_connection,
      has_bottom_groove: capturedBottom,
      has_bottom_pocket: capturedBottom || insetBottom,
      has_top_groove: capturedTop,
      has_top_pocket: capturedTop || insetTop,
      dogbones_enabled: spec.use_dogbones,
      dogbone_diameter: roundTo(spec.cutter_diameter, 3),
      joint_clearance: roundTo(spec.joint_clearance, 3),
      hidden_finger_skin: roundTo(spec.hidden_finger_skin, 3),
      hidden_finger_pocket_depth: (hiddenFingerWalls || hiddenFingerBottom || hiddenFingerTop)
        ? roundTo(hiddenPocketDepth, 3)
        : 0,
      pocket_depth: bottomPocketDepth,
      bottom_pocket_depth: bottomPocketDepth,
      top_pocket_depth: topPocketDepth,
      groove_depth: roundTo(bottomPocketDepth, 3),
      groove_width: roundTo(bottomSlotHeight, 3),
      groove_offset: roundTo(bottomSlotY, 3),
      top_groove_depth: roundTo(topPocketDepth, 3),
      top_groove_width: roundTo(topSlotHeight, 3),
      top_groove_offset: roundTo(spec.top_slot_offset, 3),
      bottom_width: bottom ? roundTo(bottom.width, 3) : 0,
      bottom_depth: bottom ? roundTo(bottom.height, 3) : 0,
      top_width: top ? roundTo(top.width, 3) : 0,
      top_depth: top ? roundTo(top.height, 3) : 0,
    },
  };
}
