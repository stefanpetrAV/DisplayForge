# DisplayForge 0.8.1

Release date: 2026-11-23

## Fixed

- **Deleting a screen did nothing in the plugin.** *Del* asked for
  confirmation with the browser's `window.confirm()`, which Designer's embedded
  browser does not show: it answers "cancel" at once, so the screen was never
  deleted. The confirmation is now inline in the screen row
  (*Delete? Yes / No*). The LED screen in Designer, if any, is still kept;
  the last remaining screen cannot be deleted.

# DisplayForge 0.8.0

Release date: 2026-11-23

## New

- **Import OBJ.** Rebuild a DisplayForge screen from an existing OBJ by
  analysing its mesh and UV map: the column × row grid and the shape (lit
  tiles per row) come from the UV map, tile width/height and the hinge angle
  between columns (straight and curved runs) from the mesh, and the placement
  (position and X/Y/Z rotation) from a least-squares fit of the rebuilt wall
  onto the OBJ. The report shows the largest remaining difference in mm.
  - Plugin: pick an OBJ of the project (`objects/Mesh`, plus legacy
    `objects/meshfromobj`). When one LED screen uses the mesh, the tile pixel
    resolution is taken from that screen and the imported screen takes its
    name, so *Update LED Screen* targets it. Local OBJ files can be imported
    too.
  - Standalone: import a local OBJ file.
  - Requirements: a regular UV grid with a vertex on every tile corner, one
    tile size for the whole wall. Rows with gaps are filled (DisplayForge has
    one continuous span per row) and reported.
  - Checked on the ANCI walls: `wall_v2.obj` (84 × 14, straight runs with 5°
    kinks) and `wall_v3.obj` (84 × 15, 0.6° per tile) are rebuilt within
    0.01 mm.

# DisplayForge 0.7.1

Release date: 2026-11-23

## Fixed

- **"Designer project storage unavailable (Designer Python API: HTTP 500)".**
  Designer runs plugin code with globals where the name `os` is a Designer
  object (`d3.OS`), not Python's `os` module, so every call that looked for the
  project folder failed with `'OS' object has no attribute 'path'`. Screens
  were then kept only in the browser, and saving the OBJ / creating the LED
  screen could not find the project folder either. The module now uses a
  private alias of the `os` module. Checked against a running Designer:
  `project_info` and `load_state` answer correctly.

# DisplayForge 0.7.0

Release date: 2026-11-23

## Fixed

- **The plugin still created `objects/meshfromobj`.** Designer files every
  `.obj` downloaded from a plugin page under `objects/meshfromobj`, so 0.6.0
  saved the OBJ there and then waited in vain for it in `objects/Mesh`. The
  plugin no longer downloads OBJ files: *Create LED Screen* and the OBJ
  buttons write `objects/Mesh/<name>.obj` through Designer's Python API and
  make Designer re-read a mesh that was already loaded. The standalone app
  still downloads the OBJ.

## New

- **Population masks.** Each screen can export pixel-perfect population masks
  (PNG) for disguise: one for the screen's own shape and one per *population
  variant*, an alternative set of lit tiles on the same mesh (for example the
  14-row configuration of a 15-row wall). Absent tiles can be transparent or
  black. Up to 16384 px per side the mask has the screen resolution; larger
  screens are scaled down automatically and proportionally so the long side is
  exactly 16384 px, with hard tile edges on the nearest whole pixel (any tile
  format, square or not).
  In the plugin the PNG is saved in `objects/DxTexture` and can be set
  directly as the LED screen's *Population mask*; the standalone app
  downloads it. Variants and mask options are saved with the screens.

## To verify in Designer

- The OBJ written by Python loads from `objects/Mesh` and no
  `objects/meshfromobj` folder appears (an existing one can be deleted by hand
  once its files are no longer used).
- Updating an existing screen picks up the rewritten OBJ/PNG
  (`reloadExternal`).
- How Designer applies a population mask that is smaller than the screen
  (screens over 16384 px) and how it shows transparent vs black tiles.

# DisplayForge 0.6.0

Release date: 2026-11-19

The project is now maintained as source code (Vue 3 + TypeScript + Vite) in
this repository. Previous releases only contained minified bundles that had
been patched by hand, which is how the bugs below were introduced.

## Fixed

- **Screen upside-down in Designer / 2D grid not matching the 3D view.** In
  0.5.x the mesh placed Row 1 at the top while the 2D grid drew Row 1 at the
  bottom, so the shape you designed in the grid came out flipped vertically
  in the 3D preview and in Designer. All views now share one convention:
  Row 1 is the top row (labelled in the UI).
- **The plugin forgot the screens.** The plugin now manages multiple screens
  and saves them in the Designer project (`displayforge/screens.json`), with a
  local browser copy as fallback. The standalone app saves to local storage.
- Switching between screens in the standalone app could regenerate (and
  overwrite) the other screen's custom rows; shape settings are now stored
  per screen and manual rows are marked *Custom*.
- Empty or invalid numeric inputs (e.g. clearing a field) produced `NaN`
  geometry; fractional column counts produced extra columns. Inputs are now
  validated and sanitized.
- The origin (left/center/right) was computed before the automatic
  orientation, so *Left*/*Right* did not match the wall ends on curved walls.
  The origin is now a point on the wall (left end, middle, right end).
- The plan view showed only the active screen without its position; it now
  shows all screens in world space, from the same points as the mesh.
- The 3D preview rendered both faces identically, hiding the wall's facing
  direction; back faces are now dark grey.
- **Create LED Screen** no longer scrapes values from the page DOM; it uses the
  active screen's data directly and records the created resource per screen.
- **Bogus `objects/meshfromobj` folder.** 0.5.x loaded the mesh from
  `objects/meshfromobj/<name>.obj`, a path that does not exist in a Designer
  project, so Designer created that folder. The mesh is now loaded from
  `objects/Mesh` (where OBJ files belong) and only once the file is there.
  An existing `objects/meshfromobj` folder from 0.5.x can be deleted.
- OBJ download URLs stay valid for 30 s, so slow hosts can finish the download.

## Added

- Portable Windows build `DisplayForge 0.6.0.exe` (Electron wrapper in
  `desktop/`, `npm run package:exe`), built from the same source as the web
  standalone app. Screens are remembered between sessions.

## Unchanged

- Hinge-angle semantics (angle at the joint before each column of a run).
- LED screen resource path: `objects/ledscreen/<name>.apx`.

## Validation

- Unit tests cover row order, UV orientation, face direction, plan/mesh
  agreement, shapes symmetry, sanitizing and project round-trip.
- The Python module was tested with a mocked `d3` module. LED screen creation
  and project storage still need to be confirmed inside the target Designer
  version.

---

# DisplayForge 0.5.0

Release date: 2026-10-26

- Added **Create LED Screen** to the Disguise plugin.
- Asynchronous OBJ import retries.
- Physically aware auto-fit for triangle, circle and diamond shapes.
- Unified plugin icons; refreshed ZIP packages; portable Windows 0.5.0 build.
