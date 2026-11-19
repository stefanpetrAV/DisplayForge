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
