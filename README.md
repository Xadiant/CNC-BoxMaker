# DrawerForge

A small, dependency-free browser app that generates a CNC-ready DXF layout for an open-top drawer with finger-jointed walls and a captured bottom. Geometry, previews, validation, DXF generation, and DXF settings import all run locally in the browser. Python only serves the static web files.

## Live interface

<https://xadiant.github.io/CNC-BoxMaker/>

The interface is deployed from `static/` to GitHub Pages whenever `main` is
updated. It runs entirely in the browser; no installation or server is needed.

## Run

```powershell
python app.py
```

Then open <http://127.0.0.1:8000>. Inputs default to inches; use the **MM / IN**
switch in the header to change units. The downloaded DXF uses the selected unit
system too.

Because the application is entirely static, the contents of `static/` can also
be deployed to any static web host without Python.

## Test

With Node.js 20 or newer installed:

```powershell
node --test tests/test_geometry.mjs
```

The tests cover browser-side geometry, validation, dogbone construction, unit
conversion, and DXF serialization. The migration was also checked against the
previous Python implementation for exact layout and byte-for-byte DXF parity.

## DXF conventions

- Units match the unit selected when downloading.
- DrawerForge settings are embedded as standard DXF `999` comments. Use **Load
  settings from DXF** to restore the saved dimensions, materials, joinery, cutter,
  and unit selection. DXFs made before this feature remain valid but have no
  settings to restore.
- `CUT_OUTSIDE` contains the five part profiles.
- Five bottom constructions are available: none, captured, full-footprint
  butt-bottom, wall-inset butt-inside, and finger jointed. Butt-bottom shortens
  the walls by the bottom material thickness so every mode preserves the entered
  outside height.
- `POCKET_BOTTOM_SLOT_<depth><unit>` contains the captured-bottom grooves. The
  calculated pocket depth is included to three decimal places in the layer name,
  such as `POCKET_BOTTOM_SLOT_0.271IN`, and is also shown in the app.
- The calculated pocket depth is the requested bottom-slot depth plus the slot
  extra; the requested depth remains the captured bottom's engagement distance.
- Bottom slot offset controls the distance from the bottom edge of each wall panel to the lower edge of the captured-bottom groove.
- Optional dogbone reliefs are built directly into the `CUT_OUTSIDE` part profiles
  as circular arcs. They are enabled by default, and their diameter follows the cutter diameter input, which
  defaults to a 1/8-inch (3.175 mm) bit. Finger clearance defaults to 0.01 inch
  (0.254 mm), is added to each socket's total width and depth, and shifts the
  dogbone center the same distance back toward the corner along its 45-degree
  bisector.
- `ANNOTATION` contains part labels and should not be cut.

The layout intentionally leaves CAM operations, feeds, speeds, hold-down tabs, kerf compensation, and stock nesting to the machine operator. Always verify the file in your CAM package and make a test joint before cutting final material.

## Geometry model

Each generated part has one canonical local profile, physical thickness,
manufacturing operations, flat-layout origin, and 3D assembly transform. The DXF
cut paths are translated directly from those profiles, while the 3D preview
extrudes the same profiles by the selected wall or bottom material thickness.
