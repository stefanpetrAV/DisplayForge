# DisplayForge 0.5.0

Release date: 2026-10-26

This release updates the Disguise plugin and standalone web application.

## Highlights

- Added **Create LED Screen** to the Disguise plugin. It invokes the existing
  OBJ export workflow, waits for Designer to load and validate the mesh, then
  creates the LED screen, associates the mesh, applies the configured pixel
  resolution, and adds it to the active stage.
- Moved OBJ import retries into asynchronous JavaScript calls so a slow import
  does not occupy a single long-running Designer Python execution.
- Improved physically aware auto-fit for triangle, circle and diamond shapes.
  Defaults recalculate when grid or tile dimensions change, and circle and
  diamond profiles account for tile aspect ratio.
- Preserved exact left/right profile symmetry and centered pointed-shape tips.
  Manual row edits are normalized before preview and mesh generation; choosing
  Rectangle restores all rows to full width.
- Unified the plugin Launcher and in-page icons using the root `icon.svg`.
- Refreshed the plugin and standalone web ZIP packages.

## Packages

- `DisplayForge_Plugin.zip` — extract the included `DisplayForge_Plugin` folder
  into the Designer project's `Plugins` directory. The plugin manifest and
  entry page are at the plugin folder root; there is no nested `dist` folder.
- `DisplayForge_Standalone.zip` — extract and serve over HTTP, then open
  `standalone.html`.
- `DisplayForge 0.5.0.exe` — portable Windows x64 standalone application; run
  the executable directly without installing it.

## Compatibility and validation

- The plugin's OBJ resource path is `objects/meshfromobj/<mesh-name>.obj`;
  the existing export workflow stores the OBJ in the project's `objects/Mesh`
  folder. The plugin does not create a physical `objects/meshfromobj` folder.
- Automated browser verification covers shape profiles, tile-dimension
  recalculation, manual row edits, Rectangle reset and mocked plugin
  integration. Import and LED-screen resource creation should still be
  confirmed in the target Disguise Designer version and project.
- The portable Windows application was rebuilt with the 0.5.0 standalone
  interface and smoke-tested to confirm the Electron app launches and renders
  the screen editor. `DisplayForge 0.4.0.exe` is retained as the previous
  portable build.
