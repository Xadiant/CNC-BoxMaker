const DXF_SETTINGS_MARKER = "DRAWERFORGE_SETTINGS_V1";
const DXF_SETTING_NAMES = [
  "height",
  "width",
  "depth",
  "finger_size",
  "finger_clearance",
  "wall_thickness",
  "bottom_thickness",
  "bottom_slot_extra",
  "bottom_slot_depth",
  "bottom_slot_offset",
  "cutter_diameter",
];

function trimFixed(value, places = 6) {
  const normalized = Math.abs(value) < 0.5 * (10 ** -places) ? 0 : value;
  return normalized.toFixed(places).replace(/(?:\.0+|(\.[0-9]*?[1-9])0+)$/, "$1");
}

function significant(value, digits = 12) {
  return Number(value).toPrecision(digits).replace(/(?:\.0+|(?:(\.[0-9]*?[1-9])0+))(?=e|$)/, "$1").replace("e+", "e");
}

function pair(code, value) {
  const output = typeof value === "number" && !Number.isInteger(value) ? trimFixed(value) : String(value);
  return `${code}\n${output}\n`;
}

export function layoutToDxf(layout, units = "mm") {
  if (units !== "mm" && units !== "in") throw new Error("units must be 'mm' or 'in'");
  const scale = units === "mm" ? 1 : 1 / 25.4;
  const insertionUnits = units === "mm" ? 4 : 1;
  const pocketDepth = layout.manufacturing.pocket_depth * scale;
  const pocketLayer = `POCKET_BOTTOM_SLOT_${pocketDepth.toFixed(3)}${units.toUpperCase()}`;
  const outputLayer = (layer) => layer === "POCKET_BOTTOM_SLOT" ? pocketLayer : layer;

  const storedSpec = { ...layout.spec };
  if (storedSpec.bottom_slot_offset == null) storedSpec.bottom_slot_offset = storedSpec.wall_thickness;
  const metadata = [pair(999, DXF_SETTINGS_MARKER), pair(999, `units=${units}`)];
  for (const name of DXF_SETTING_NAMES) {
    metadata.push(pair(999, `${name}_mm=${significant(storedSpec[name])}`));
  }

  const chunks = [
    pair(0, "SECTION"), pair(2, "HEADER"), pair(9, "$ACADVER"), pair(1, "AC1024"),
    pair(9, "$INSUNITS"), pair(70, insertionUnits), ...metadata,
    pair(0, "ENDSEC"), pair(0, "SECTION"), pair(2, "TABLES"), pair(0, "TABLE"),
    pair(2, "LAYER"), pair(70, 3),
  ];
  for (const [name, color] of [["CUT_OUTSIDE", 7], [pocketLayer, 5], ["ANNOTATION", 8]]) {
    chunks.push(
      pair(0, "LAYER"), pair(2, name), pair(70, 0), pair(62, color), pair(6, "CONTINUOUS"),
    );
  }
  chunks.push(
    pair(0, "ENDTAB"), pair(0, "ENDSEC"), pair(0, "SECTION"), pair(2, "ENTITIES"),
  );

  for (const entity of layout.entities) {
    if (entity.type === "polyline") {
      chunks.push(
        pair(0, "LWPOLYLINE"), pair(100, "AcDbEntity"), pair(8, outputLayer(entity.layer)),
        pair(100, "AcDbPolyline"), pair(90, entity.points.length), pair(70, entity.closed ? 1 : 0),
      );
      const bulges = entity.bulges ?? entity.points.map(() => 0);
      entity.points.forEach(([px, py], index) => {
        chunks.push(pair(10, px * scale), pair(20, py * scale));
        if (Math.abs(bulges[index]) > 1e-12) chunks.push(pair(42, bulges[index]));
      });
    } else if (entity.type === "circle") {
      chunks.push(
        pair(0, "CIRCLE"), pair(100, "AcDbEntity"), pair(8, outputLayer(entity.layer)),
        pair(100, "AcDbCircle"), pair(10, entity.cx * scale), pair(20, entity.cy * scale),
        pair(30, 0), pair(40, entity.r * scale),
      );
    } else if (entity.type === "text") {
      chunks.push(
        pair(0, "TEXT"), pair(100, "AcDbEntity"), pair(8, outputLayer(entity.layer)),
        pair(100, "AcDbText"), pair(10, entity.x * scale), pair(20, entity.y * scale),
        pair(30, 0), pair(40, entity.height * scale), pair(1, entity.text), pair(72, 1),
        pair(11, entity.x * scale), pair(21, entity.y * scale), pair(31, 0),
      );
    }
  }
  chunks.push(pair(0, "ENDSEC"), pair(0, "EOF"));
  return chunks.join("");
}
