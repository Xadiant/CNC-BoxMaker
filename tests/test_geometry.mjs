import assert from "node:assert/strict";
import test from "node:test";

import { buildLayout, edgePoints, validateSpec } from "../static/geometry.js";
import { layoutToDxf } from "../static/dxf.js";

const DEFAULT = {
  height: 160,
  width: 450,
  depth: 400,
  finger_size: 24,
  wall_thickness: 12,
  bottom_thickness: 6,
};

const close = (actual, expected, tolerance = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

test("layout has five parts and the expected manufacturing layers", () => {
  const layout = buildLayout(DEFAULT);
  assert.equal(layout.parts.length, 5);
  assert.deepEqual(new Set(layout.entities.map((entity) => entity.layer)), new Set([
    "CUT_OUTSIDE", "POCKET_BOTTOM_SLOT", "ANNOTATION",
  ]));
  assert.ok(!layout.entities.some((entity) => entity.type === "circle"));
});

test("part profiles drive flat geometry and assembly thickness", () => {
  const layout = buildLayout(DEFAULT);
  const cutPaths = layout.entities.filter((entity) => entity.type === "polyline" && entity.layer === "CUT_OUTSIDE");
  layout.parts.forEach((part, index) => {
    const [offsetX, offsetY] = part.layout_origin;
    assert.deepEqual(part.profile.map(([x, y]) => [x + offsetX, y + offsetY]), cutPaths[index].points);
    assert.ok(part.assembly);
  });
  assert.ok(layout.parts.slice(0, 4).every((part) => part.thickness === 12));
  assert.equal(layout.parts[4].thickness, 6);
});

test("assembled geometry stays within the requested dimensions", () => {
  const layout = buildLayout(DEFAULT);
  const limits = [DEFAULT.width, DEFAULT.depth, DEFAULT.height];
  for (const part of layout.parts) {
    const transform = part.assembly;
    for (const [u, v] of part.profile) {
      for (const thicknessPosition of [0, part.thickness]) {
        const point = [0, 1, 2].map((axis) => transform.origin[axis]
          + transform.u_axis[axis] * u
          + transform.v_axis[axis] * v
          + transform.thickness_axis[axis] * thicknessPosition);
        point.forEach((coordinate, axis) => {
          assert.ok(coordinate >= -1e-9);
          assert.ok(coordinate <= limits[axis] + 1e-9);
        });
      }
    }
  }
});

test("exploded view axes preserve height and bottom position", () => {
  const layout = buildLayout(DEFAULT);
  assert.ok(layout.parts.every((part) => part.assembly.explode_axis[2] === 0));
  assert.deepEqual(layout.parts.at(-1).assembly.explode_axis, [0, 0, 0]);
});

test("front and back tab profiles span the requested outer width", () => {
  const layout = buildLayout(DEFAULT);
  for (const part of layout.parts.slice(0, 2)) {
    const xs = part.profile.map(([x]) => x + part.assembly.origin[0]);
    close(Math.min(...xs), 0);
    close(Math.max(...xs), DEFAULT.width);
  }
});

test("captured bottom and pocket calculations match the reference values", () => {
  const manufacturing = buildLayout(DEFAULT).manufacturing;
  assert.equal(manufacturing.bottom_width, 438.7);
  assert.equal(manufacturing.bottom_depth, 388.7);
  assert.equal(manufacturing.groove_depth, 6.89);
  assert.equal(manufacturing.pocket_depth, 6.88975);
  assert.equal(manufacturing.groove_width, 6.54);
});

test("slot parameters drive pockets and bottom engagement", () => {
  const layout = buildLayout({ ...DEFAULT, bottom_slot_extra: 0.75, bottom_slot_depth: 8 });
  assert.equal(layout.manufacturing.groove_width, 6.75);
  assert.equal(layout.manufacturing.groove_depth, 8.75);
  assert.equal(layout.manufacturing.bottom_width, 442);
  assert.equal(layout.manufacturing.bottom_depth, 392);
  const grooves = layout.parts.slice(0, 4).map((part) => part.operations.find((operation) => operation.type === "groove"));
  assert.ok(grooves.every((operation) => operation.depth === 8.75));
  assert.deepEqual(grooves.map((operation) => operation.rect), [
    [-8.75, 12, 443.5, 6.75],
    [-8.75, 12, 443.5, 6.75],
    [3.25, 12, 393.5, 6.75],
    [3.25, 12, 393.5, 6.75],
  ]);
});

test("bottom slot offset moves grooves and the captured bottom", () => {
  const layout = buildLayout({ ...DEFAULT, bottom_slot_offset: 20 });
  const grooves = layout.parts.slice(0, 4).map((part) => part.operations.find((operation) => operation.type === "groove").rect);
  assert.ok(grooves.every((groove) => groove[1] === 20));
  assert.equal(layout.manufacturing.groove_offset, 20);
  assert.equal(layout.parts[4].assembly.origin[2], 20.269875);
});

test("missing optional values retain the established inch-derived defaults", () => {
  const spec = validateSpec({ height: 152.4, width: 457.2, depth: 406.4 });
  assert.equal(spec.finger_size, 12.7);
  assert.equal(spec.finger_clearance, 0.254);
  assert.equal(spec.wall_thickness, 12.7);
  assert.equal(spec.bottom_thickness, 6.35);
  assert.equal(spec.bottom_slot_extra, 0.53975);
  assert.equal(spec.bottom_slot_depth, 6.35);
  assert.equal(spec.bottom_slot_offset, 12.7);
  assert.equal(spec.cutter_diameter, 3.175);
  assert.equal(spec.use_dogbones, true);
  assert.equal(spec.bottom_type, "captured");
  assert.equal(spec.wall_connection, "finger");
});

test("invalid slot placement and depth are rejected", () => {
  assert.throws(() => buildLayout({ ...DEFAULT, height: 40, finger_size: 10, bottom_slot_offset: 34 }), /above the panel/);
  assert.throws(() => buildLayout({ ...DEFAULT, bottom_slot_depth: 11.75, bottom_slot_extra: 0.5 }), /depth plus extra/);
});

test("wall pockets continue across finger boundaries", () => {
  const layout = buildLayout({ ...DEFAULT, bottom_slot_depth: 8, bottom_slot_offset: 2 });
  const grooves = layout.parts.slice(0, 4).map((part) => part.operations.find((operation) => operation.type === "groove").rect);
  assert.ok(grooves[0][0] < 0);
  assert.ok(grooves[0][0] + grooves[0][2] > layout.parts[0].width);
  close(grooves[2][0], 3.46025);
  close(grooves[2][0] + grooves[2][2], 396.53975);
});

test("DXF declares units, CAM layers, bulges, and saved settings", () => {
  const dxf = layoutToDxf(buildLayout(DEFAULT));
  assert.match(dxf, /\$INSUNITS\n70\n4/);
  assert.match(dxf, /2\nPOCKET_BOTTOM_SLOT_6\.890MM\n/);
  assert.match(dxf, /8\nPOCKET_BOTTOM_SLOT_6\.890MM\n/);
  assert.ok(!dxf.includes("DOGBONE"));
  assert.ok(dxf.includes("\n42\n"));
  assert.ok(dxf.includes("999\nDRAWERFORGE_SETTINGS_V1"));
  assert.ok(dxf.includes("999\nunits=mm"));
  assert.ok(dxf.includes("999\nwidth_mm=450"));
  assert.ok(dxf.includes("999\nbottom_slot_offset_mm=12"));
  assert.ok(dxf.includes("999\nuse_dogbones=true"));
  assert.ok(dxf.includes("999\nbottom_type=captured"));
  assert.ok(dxf.includes("999\nwall_connection=finger"));
  assert.ok(dxf.endsWith("0\nEOF\n"));
});

test("inch DXF scales coordinates and declares inch units", () => {
  const dxf = layoutToDxf(buildLayout(DEFAULT), "in");
  assert.match(dxf, /\$INSUNITS\n70\n1/);
  assert.match(dxf, /POCKET_BOTTOM_SLOT_0\.271IN/);
  assert.ok(dxf.includes("999\nunits=in"));
  assert.ok(dxf.includes("10\n0.787402"));
});

test("closed cut contours contain no zero-length edges", () => {
  const layout = buildLayout(DEFAULT);
  const contours = layout.entities.filter((entity) => entity.type === "polyline" && entity.layer === "CUT_OUTSIDE");
  for (const contour of contours) {
    contour.points.forEach((start, index) => assert.ok(
      Math.hypot(start[0] - contour.points[(index + 1) % contour.points.length][0], start[1] - contour.points[(index + 1) % contour.points.length][1]) > 1e-9,
    ));
  }
});

test("dogbone arcs are integrated into wall profiles", () => {
  const layout = buildLayout(DEFAULT);
  const radius = DEFAULT.wall_thickness ? 3.175 / 2 : 0;
  const centerDistance = radius - 0.254;
  const cutPaths = layout.entities.filter((entity) => entity.type === "polyline" && entity.layer === "CUT_OUTSIDE");
  layout.parts.slice(0, 4).forEach((part, index) => {
    const operations = part.operations.filter((operation) => operation.type === "dogbone");
    assert.ok(operations.length);
    assert.equal(cutPaths[index].bulges.length, cutPaths[index].points.length);
    assert.ok(cutPaths[index].bulges.some((bulge) => Math.abs(bulge) > 0));
    for (const operation of operations) {
      const center = [operation.cx, operation.cy];
      const arcPoints = part.profile.filter((point) => Math.abs(Math.hypot(point[0] - center[0], point[1] - center[1]) - radius) <= 1e-8);
      assert.ok(arcPoints.length >= 9);
      close(Math.hypot(center[0] - operation.corner[0], center[1] - operation.corner[1]), centerDistance);
    }
  });
});

test("finger clearance expands both socket styles in either direction", () => {
  const clearance = 0.254;
  const tab = edgePoints([0, 0], [0, 160], "tab", 24, 12, 0, clearance).points;
  const slot = edgePoints([0, 0], [0, 160], "slot", 24, 12, 0, clearance).points;
  const reverseTab = edgePoints([0, 160], [0, 0], "tab", 24, 12, 0, clearance).points;
  const reverseSlot = edgePoints([0, 160], [0, 0], "slot", 24, 12, 0, clearance).points;
  const unique = (values) => [...new Set(values)].sort((a, b) => a - b);
  const tabBoundaries = unique(tab.map((point) => point[1]));
  const slotBoundaries = unique(slot.map((point) => point[1]));
  close(slotBoundaries[3] - slotBoundaries[2], tabBoundaries[1] - tabBoundaries[0] + clearance);
  close(Math.min(...slot.map((point) => point[0])), -(12 + clearance));
  close(Math.min(...tab.map((point) => point[0])), -clearance);
  close(Math.max(...reverseSlot.map((point) => point[0])), 12 + clearance);
  close(Math.max(...reverseTab.map((point) => point[0])), clearance);
});

test("zero clearance and larger cutters alter dogbones correctly", () => {
  const zero = buildLayout({ ...DEFAULT, finger_clearance: 0 });
  const zeroDogbone = zero.parts[0].operations.find((operation) => operation.type === "dogbone");
  close(Math.hypot(zeroDogbone.cx - zeroDogbone.corner[0], zeroDogbone.cy - zeroDogbone.corner[1]), zeroDogbone.radius);

  const larger = buildLayout({ ...DEFAULT, cutter_diameter: 6.35 });
  const defaultDogbone = buildLayout(DEFAULT).parts[0].operations.find((operation) => operation.type === "dogbone");
  const largerDogbone = larger.parts[0].operations.find((operation) => operation.type === "dogbone");
  assert.equal(defaultDogbone.radius, 3.175 / 2);
  assert.equal(largerDogbone.radius, 6.35 / 2);
  assert.notDeepEqual(buildLayout(DEFAULT).parts[0].profile, larger.parts[0].profile);
});

test("dogbones can be disabled without changing finger joints", () => {
  const layout = buildLayout({ ...DEFAULT, use_dogbones: false });
  assert.equal(layout.spec.use_dogbones, false);
  assert.equal(layout.manufacturing.dogbones_enabled, false);
  assert.ok(layout.parts.slice(0, 4).every((part) =>
    !part.operations.some((operation) => operation.type === "dogbone")
  ));
  const cutPaths = layout.entities.filter((entity) =>
    entity.type === "polyline" && entity.layer === "CUT_OUTSIDE"
  );
  assert.ok(cutPaths.slice(0, 4).every((entity) => entity.bulges.every((bulge) => bulge === 0)));
  const dxf = layoutToDxf(layout);
  assert.ok(dxf.includes("999\nuse_dogbones=false"));
  assert.ok(!dxf.includes("\n42\n"));
});

test("butt-bottom spans the footprint and shortens walls to preserve overall height", () => {
  const layout = buildLayout({ ...DEFAULT, bottom_type: "butt_bottom" });
  const bottom = layout.parts.at(-1);
  assert.deepEqual(layout.assembled_dimensions, { width: 450, depth: 400, height: 160 });
  assert.deepEqual(bottom.assembly.origin, [0, 0, 0]);
  assert.equal(layout.manufacturing.bottom_width, 450);
  assert.equal(layout.manufacturing.bottom_depth, 400);
  assert.ok(layout.parts.slice(0, 4).every((part) => part.assembly.origin[2] === 6));
  assert.ok(layout.parts.slice(0, 4).every((part) => part.height === 154));
  assert.ok(!layout.entities.some((entity) => entity.layer === "POCKET_BOTTOM_SLOT"));
});

test("no-bottom construction emits only four full-height walls", () => {
  const layout = buildLayout({ ...DEFAULT, bottom_type: "none" });
  assert.equal(layout.parts.length, 4);
  assert.deepEqual(layout.assembled_dimensions, { width: 450, depth: 400, height: 160 });
  assert.ok(layout.parts.every((part) => part.name !== "BOTTOM" && part.height === 160));
  assert.ok(!layout.entities.some((entity) => entity.layer === "POCKET_BOTTOM_SLOT"));
  assert.equal(layout.manufacturing.bottom_width, 0);
  assert.equal(layout.manufacturing.bottom_depth, 0);
  assert.ok(layoutToDxf(layout).includes("999\nbottom_type=none"));
});

test("mitered wall connections use full-length plain wall blanks", () => {
  const layout = buildLayout({ ...DEFAULT, bottom_type: "none", wall_connection: "miter" });
  assert.deepEqual(layout.parts.map((part) => part.width), [450, 450, 400, 400]);
  assert.ok(layout.parts.every((part) => part.mitered_edges));
  assert.ok(layout.parts.every((part) => part.profile.length === 4));
  assert.ok(layoutToDxf(layout).includes("999\nwall_connection=miter"));
});

test("butted wall variants expose end grain on the selected pair", () => {
  const frontBack = buildLayout({ ...DEFAULT, bottom_type: "none", wall_connection: "butt_front_back" });
  assert.deepEqual(frontBack.parts.map((part) => part.width), [426, 426, 400, 400]);
  assert.deepEqual(frontBack.parts.map((part) => part.assembly.origin.slice(0, 2)), [
    [12, 0], [12, 400], [0, 0], [450, 0],
  ]);

  const sides = buildLayout({ ...DEFAULT, bottom_type: "none", wall_connection: "butt_sides" });
  assert.deepEqual(sides.parts.map((part) => part.width), [450, 450, 376, 376]);
  assert.deepEqual(sides.parts.map((part) => part.assembly.origin.slice(0, 2)), [
    [0, 0], [0, 400], [0, 12], [450, 12],
  ]);
  assert.ok([...frontBack.parts, ...sides.parts].every((part) => part.profile.length === 4));
});

test("butt-inside fits between the walls without changing outside dimensions", () => {
  const layout = buildLayout({ ...DEFAULT, bottom_type: "butt_inside" });
  const bottom = layout.parts.at(-1);
  assert.deepEqual(layout.assembled_dimensions, { width: 450, depth: 400, height: 160 });
  assert.deepEqual(bottom.assembly.origin, [12, 12, 0]);
  assert.equal(layout.manufacturing.bottom_width, 426);
  assert.equal(layout.manufacturing.bottom_depth, 376);
  assert.ok(!layout.entities.some((entity) => entity.layer === "POCKET_BOTTOM_SLOT"));
});

test("finger-jointed bottom interlocks with all four wall bottoms", () => {
  const layout = buildLayout({ ...DEFAULT, bottom_type: "finger_jointed" });
  const withoutDogbones = buildLayout({ ...DEFAULT, bottom_type: "finger_jointed", use_dogbones: false });
  const bottom = layout.parts.at(-1);
  assert.deepEqual(layout.assembled_dimensions, { width: 450, depth: 400, height: 160 });
  assert.deepEqual(bottom.assembly.origin, [12, 12, 0]);
  assert.equal(layout.manufacturing.bottom_width, 450);
  assert.equal(layout.manufacturing.bottom_depth, 400);
  assert.ok(layout.parts.slice(0, 4).every((part) =>
    new Set(part.profile.map(([, y]) => y)).size > 2
  ));
  assert.ok(bottom.profile.length > 4);
  assert.ok(layout.parts.every((part) =>
    part.operations.some((operation) => operation.type === "dogbone")
  ));
  layout.parts.forEach((part, index) => {
    assert.notDeepEqual(part.profile, withoutDogbones.parts[index].profile);
  });
  assert.ok(!layout.entities.some((entity) => entity.layer === "POCKET_BOTTOM_SLOT"));
  assert.ok(layoutToDxf(layout).includes("999\nbottom_type=finger_jointed"));
});

test("captured-only slot constraints do not block other bottom types", () => {
  assert.doesNotThrow(() => buildLayout({
    ...DEFAULT,
    bottom_type: "butt_inside",
    bottom_slot_depth: 20,
    bottom_slot_extra: 10,
    bottom_slot_offset: 1000,
  }));
  assert.throws(() => buildLayout({ ...DEFAULT, bottom_type: "unsupported" }), /bottom type/);
  assert.throws(() => buildLayout({ ...DEFAULT, wall_connection: "unsupported" }), /wall connection/);
});

test("every bottom construction remains inside its assembled dimensions", () => {
  for (const bottomType of ["none", "captured", "butt_bottom", "butt_inside", "finger_jointed"]) {
    const layout = buildLayout({ ...DEFAULT, bottom_type: bottomType });
    const limits = Object.values(layout.assembled_dimensions);
    for (const part of layout.parts) {
      const transform = part.assembly;
      for (const [u, v] of part.profile) {
        for (const q of [0, part.thickness]) {
          const point = [0, 1, 2].map((axis) => transform.origin[axis]
            + transform.u_axis[axis] * u
            + transform.v_axis[axis] * v
            + transform.thickness_axis[axis] * q);
          point.forEach((coordinate, axis) => {
            assert.ok(coordinate >= -1e-8, `${bottomType} axis ${axis} fell below zero`);
            assert.ok(coordinate <= limits[axis] + 1e-8, `${bottomType} axis ${axis} exceeded its limit`);
          });
        }
      }
    }
  }
});

test("invalid box dimensions are rejected", () => {
  assert.throws(() => buildLayout({ ...DEFAULT, width: 30 }), /width/);
});
