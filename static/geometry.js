const FIELD_RULES = {
  height: [25, 1000, null],
  width: [50, 1500, null],
  depth: [50, 1500, null],
  finger_size: [3, 100, 12.7],
  finger_clearance: [0, 10, 0.254],
  wall_thickness: [3, 50, 12.7],
  bottom_thickness: [1, 30, 6.35],
  bottom_slot_extra: [0, 10, 0.53975],
  bottom_slot_depth: [0.1, 50, 6.35],
  cutter_diameter: [0.1, 50, 3.175],
};

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
  const spec = {};
  for (const [name, [minimum, maximum, defaultValue]] of Object.entries(FIELD_RULES)) {
    const rawValue = values[name] ?? defaultValue;
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

  const rawOffset = values.bottom_slot_offset ?? spec.wall_thickness;
  const bottomSlotOffset = typeof rawOffset === "string" && rawOffset.trim() === ""
    ? Number.NaN
    : Number(rawOffset);
  if (!Number.isFinite(bottomSlotOffset)) throw new Error("bottom slot offset must be a number");
  if (bottomSlotOffset < 0 || bottomSlotOffset > 1000) {
    throw new Error("bottom slot offset must be between 0 and 1000 mm");
  }
  spec.bottom_slot_offset = bottomSlotOffset;

  if (spec.width <= spec.wall_thickness * 3) {
    throw new Error("width must be more than three wall thicknesses");
  }
  if (spec.depth <= spec.wall_thickness * 3) {
    throw new Error("depth must be more than three wall thicknesses");
  }
  if (spec.height <= spec.wall_thickness * 2 + spec.bottom_thickness) {
    throw new Error("height is too small for the selected materials");
  }
  if (spec.finger_size > spec.height / 2) {
    throw new Error("finger size must be no more than half the drawer height");
  }
  if (spec.bottom_slot_depth + spec.bottom_slot_extra > spec.wall_thickness) {
    throw new Error("bottom slot depth plus extra cannot exceed the wall thickness");
  }
  if (spec.bottom_slot_extra >= spec.bottom_slot_depth) {
    throw new Error("bottom slot extra must be smaller than the slot depth");
  }
  if (spec.bottom_slot_offset + spec.bottom_thickness + spec.bottom_slot_extra > spec.height) {
    throw new Error("bottom slot offset places the slot above the panel");
  }
  return spec;
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
    throw new Error("finger clearance must be smaller than each finger");
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
  if (offset >= radius) throw new Error("finger clearance must be smaller than the cutter radius");

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
        throw new Error("finger clearance is too large for the selected cutter diameter");
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

function fingeredPanel({ x, y, width, height, verticalMode, fingerSize, jointDepth, label, groove, grooveDepth, cutterDiameter, fingerClearance, useDogbones }) {
  const corners = [
    [[0, 0], [width, 0], "plain", 0],
    [[width, 0], [width, height], verticalMode, 0],
    [[width, height], [0, height], "plain", 0],
    [[0, height], [0, 0], verticalMode, 0],
  ];
  const outline = [];
  for (const [start, end, mode, phase] of corners) {
    const edge = edgePoints(start, end, mode, fingerSize, jointDepth, phase, fingerClearance).points;
    outline.push(...(outline.length ? edge.slice(1) : edge));
  }

  const squareOutline = cleanPolyline(outline, { closed: true });
  const routedOutline = useDogbones
    ? dogboneOutline(squareOutline, cutterDiameter / 2, fingerClearance)
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

  if (groove) {
    let [gx, gy, gw, gh] = groove;
    const pieceLeft = Math.min(...squareOutline.map((point) => point[0]));
    const pieceRight = Math.max(...squareOutline.map((point) => point[0]));
    const grooveLeft = Math.max(pieceLeft, gx);
    const grooveRight = Math.min(pieceRight, gx + gw);
    gx = grooveLeft;
    gw = Math.max(0, grooveRight - grooveLeft);
    operations.push({ type: "groove", rect: [gx, gy, gw, gh], depth: grooveDepth });
    entities.push({
      type: "polyline",
      layer: "POCKET_BOTTOM_SLOT",
      closed: true,
      points: [
        [x + gx, y + gy],
        [x + gx + gw, y + gy],
        [x + gx + gw, y + gy + gh],
        [x + gx, y + gy + gh],
      ],
    });
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
    operations,
    layout_origin: [x, y],
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
  const spec = validateSpec(values);
  const wall = spec.wall_thickness;
  const clearance = spec.bottom_slot_extra;
  const slotHeight = spec.bottom_thickness + clearance;
  const slotY = spec.bottom_slot_offset;
  const pocketDepth = roundTo(spec.bottom_slot_depth + clearance, 12);
  const slotExtension = pocketDepth;
  const engagement = spec.bottom_slot_depth;
  const frontWidth = spec.width - 2 * wall;
  const bottomWidth = spec.width - 2 * wall + 2 * engagement;
  const bottomDepth = spec.depth - 2 * wall + 2 * engagement;
  const gap = Math.max(18, wall * 3);
  const margin = 20;

  const common = {
    height: spec.height,
    fingerSize: spec.finger_size,
    jointDepth: wall,
    grooveDepth: pocketDepth,
    cutterDiameter: spec.cutter_diameter,
    fingerClearance: spec.finger_clearance,
    useDogbones: spec.use_dogbones,
  };
  const placements = [
    fingeredPanel({
      ...common,
      x: margin,
      y: margin,
      width: frontWidth,
      verticalMode: "tab",
      label: "FRONT",
      groove: [-slotExtension, slotY, frontWidth + 2 * slotExtension, slotHeight],
    }),
    fingeredPanel({
      ...common,
      x: margin,
      y: margin + spec.height + gap,
      width: frontWidth,
      verticalMode: "tab",
      label: "BACK",
      groove: [-slotExtension, slotY, frontWidth + 2 * slotExtension, slotHeight],
    }),
    fingeredPanel({
      ...common,
      x: margin + spec.width + wall + gap,
      y: margin,
      width: spec.depth,
      verticalMode: "slot",
      label: "LEFT SIDE",
      groove: [wall - slotExtension, slotY, spec.depth - 2 * wall + 2 * slotExtension, slotHeight],
    }),
    fingeredPanel({
      ...common,
      x: margin + spec.width + wall + gap,
      y: margin + spec.height + gap,
      width: spec.depth,
      verticalMode: "slot",
      label: "RIGHT SIDE",
      groove: [wall - slotExtension, slotY, spec.depth - 2 * wall + 2 * slotExtension, slotHeight],
    }),
  ];

  const assemblyTransforms = [
    { origin: [wall, 0, 0], u_axis: [1, 0, 0], v_axis: [0, 0, 1], thickness_axis: [0, 1, 0], explode_axis: [0, -1, 0] },
    { origin: [wall, spec.depth, 0], u_axis: [1, 0, 0], v_axis: [0, 0, 1], thickness_axis: [0, -1, 0], explode_axis: [0, 1, 0] },
    { origin: [0, 0, 0], u_axis: [0, 1, 0], v_axis: [0, 0, 1], thickness_axis: [1, 0, 0], explode_axis: [-1, 0, 0] },
    { origin: [spec.width, 0, 0], u_axis: [0, 1, 0], v_axis: [0, 0, 1], thickness_axis: [-1, 0, 0], explode_axis: [1, 0, 0] },
  ];
  placements.forEach((part, index) => { part.assembly = assemblyTransforms[index]; });

  const bottomX = margin;
  const bottomY = margin + 2 * (spec.height + gap);
  const bottomProfile = [[0, 0], [bottomWidth, 0], [bottomWidth, bottomDepth], [0, bottomDepth]];
  const bottomEntities = [
    {
      type: "polyline",
      layer: "CUT_OUTSIDE",
      closed: true,
      points: [[bottomX, bottomY], [bottomX + bottomWidth, bottomY], [bottomX + bottomWidth, bottomY + bottomDepth], [bottomX, bottomY + bottomDepth]],
    },
    {
      type: "text",
      layer: "ANNOTATION",
      x: bottomX + bottomWidth / 2,
      y: bottomY + bottomDepth / 2,
      height: Math.max(3, Math.min(bottomWidth, bottomDepth) * 0.045),
      text: "CAPTURED BOTTOM",
    },
  ];
  placements.push({
    name: "CAPTURED BOTTOM",
    width: bottomWidth,
    height: bottomDepth,
    thickness: spec.bottom_thickness,
    profile: bottomProfile,
    operations: [],
    layout_origin: [bottomX, bottomY],
    assembly: {
      origin: [(spec.width - bottomWidth) / 2, (spec.depth - bottomDepth) / 2, slotY + clearance / 2],
      u_axis: [1, 0, 0],
      v_axis: [0, 1, 0],
      thickness_axis: [0, 0, 1],
      explode_axis: [0, 0, 0],
    },
    entities: bottomEntities,
  });

  const entities = placements.flatMap((part) => part.entities);
  return {
    units: "mm",
    spec: { ...spec },
    entities,
    parts: placements.map(({ entities: _entities, ...part }) => part),
    bounds: entityBounds(entities),
    manufacturing: {
      dogbones_enabled: spec.use_dogbones,
      dogbone_diameter: roundTo(spec.cutter_diameter, 3),
      finger_clearance: roundTo(spec.finger_clearance, 3),
      pocket_depth: pocketDepth,
      groove_depth: roundTo(pocketDepth, 3),
      groove_width: roundTo(slotHeight, 3),
      groove_offset: roundTo(slotY, 3),
      bottom_width: roundTo(bottomWidth, 3),
      bottom_depth: roundTo(bottomDepth, 3),
    },
  };
}
