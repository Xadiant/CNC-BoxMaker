# Box

A small, dependency-free browser app that generates a CNC-ready DXF layout for a box with an optional top. Geometry, previews, validation, DXF generation, and DXF settings import all run locally in the browser. Python only serves the static web files.

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

The dimension-reference dropdown accepts either exterior extents or clear
interior dimensions. Interior width and depth are measured between the inside
wall faces. Interior height is measured between the finished bottom and the
underside of the top; a missing bottom or top contributes no thickness.

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
- Box settings are embedded as standard DXF `999` comments. Use **Load
  settings from DXF** to restore the saved dimensions, materials, joinery, cutter,
  and unit selection. DXFs made before this feature remain valid but have no
  dimension-reference setting and therefore load as exterior dimensions.
- `CUT_OUTSIDE` contains the four wall profiles and the bottom profile when one is selected.
- Wall corners can use through fingers, hidden fingers, 45-degree miters, or
  either orientation of a butt joint. Hidden fingers alternate blind pockets
  behind thin exterior skins so the assembled corner stays clean.
- `MITER_END` contains dashed reference lines one wall thickness in from each
  mitered edge, showing where each 45-degree bevel ends. This layer is a guide
  and should not be cut.
- Seven bottom constructions are available: none, captured, rabbeted inset,
  full-footprint butt-bottom, wall-inset butt-inside, through-finger jointed,
  and hidden-finger jointed. The inset bottom has a full exterior-size flange
  and a raised center that fits between the walls; its perimeter is pocketed by
  the selected inset depth. The hidden-finger version keeps a thin, continuous
  outside skin on the bottom while its inside perimeter is pocketed into
  alternating tabs that fit blind pockets in all four walls. Wall heights are
  adjusted where needed so every mode preserves the entered outside height.
- The top defaults to none and offers the same seven mirrored constructions:
  none, captured, rabbeted inset, full-footprint butt-top, wall-inset
  butt-inside, through-finger jointed, and hidden-finger jointed. Top material,
  captured-slot, and inset-depth settings are independent from the bottom.
- `POCKET_BOTTOM_SLOT_<depth><unit>` contains the captured-bottom grooves. The
  calculated pocket depth is included to three decimal places in the layer name,
  such as `POCKET_BOTTOM_SLOT_0.271IN`, and is also shown in the app.
- `POCKET_BOTTOM_INSET_<depth><unit>` contains the four perimeter pocket regions
  for the inset bottom. The pocket extends inward by the wall thickness plus
  the selected joint clearance.
- `POCKET_TOP_SLOT_<depth><unit>` and `POCKET_TOP_INSET_<depth><unit>` contain
  the corresponding captured grooves and underside inset pockets for a top.
- `POCKET_HIDDEN_FINGERS_<depth><unit>` contains the blind pockets in the walls.
  `POCKET_HIDDEN_BOTTOM_<depth><unit>` and
  `POCKET_HIDDEN_TOP_<depth><unit>` contain the comb-shaped inside perimeter
  pockets that leave continuous outside skins on those panels. Each layer name
  uses its own material thickness minus the selected hidden skin thickness.
- The calculated pocket depth is the requested bottom-slot depth plus the slot
  extra; the requested depth remains the captured bottom's engagement distance.
- Bottom slot offset controls the distance from the bottom edge of each wall panel to the lower edge of the captured-bottom groove.
- Optional dogbone reliefs are built directly into the `CUT_OUTSIDE` part profiles
  as circular arcs. They are enabled by default, and their diameter follows the cutter diameter input, which
  defaults to a 1/8-inch (3.175 mm) bit. Joint clearance defaults to 0.01 inch
  (0.254 mm), is added to each finger socket's total width and depth and to the
  inset bottom's perimeter pocket, and shifts the
  dogbone center the same distance back toward the corner along its 45-degree
  bisector. Hidden fingers also leave this clearance between each concealed
  finger end and the neighboring exterior skin.
- `ANNOTATION` contains part labels and should not be cut.

The layout intentionally leaves CAM operations, feeds, speeds, hold-down tabs, kerf compensation, and stock nesting to the machine operator. Always verify the file in your CAM package and make a test joint before cutting final material.

## Geometry model

Each generated part has one canonical local profile, physical thickness,
manufacturing operations, flat-layout origin, and 3D assembly transform. The DXF
cut paths are translated directly from those profiles, while the 3D preview
extrudes the same profiles by the selected wall or bottom material thickness.
