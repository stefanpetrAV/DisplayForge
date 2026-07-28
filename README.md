# DisplayForge

Parametric tools for LED display design and media server workflows

> Design, preview and export compound-curve LED walls and custom-shaped displays for Media Servers and 3d Engines.

DisplayForge is a parametric design tool for creating LED walls ranging from simple flat surfaces to complex compound curves and custom shapes. It exports standard Wavefront OBJ files that can be imported directly into Disguise, Pixera, Blender, Unreal Engine, and other 3D applications.

![Screenshot](images/{7C0F7EE2-1F29-4BB5-A89D-888A912DEDE2}.png)
![Screenshot](images/{384A207E-18C0-4F9C-90DC-0BB31DE3EC58}.png)
![Screenshot](images/{C60D4346-E471-4DC2-8164-5078944E5692}.png)

The application is available in two versions sharing the same geometry engine:

- **Disguise Plugin** – optimized for use inside Designer.
- **Standalone Application** – full-featured portable version with interactive 3D visualization.

---

# Features

## Compound Curve Engine

Create LED walls composed of multiple consecutive runs:

- Straight sections
- Curved sections
- Straight → Curved → Straight combinations
- Unlimited run sequences

Geometry is generated using the same core algorithms as the main DisplayForge application.

---

## Shape Generator

Generate displays in several predefined layouts:

- Rectangle
- Triangle
- Diamond
- Circle

Every generated shape can be manually edited row by row for complete control over cabinet placement.

---

## Transform Tools

Precisely position every display using:

- Custom origin point
- World position
- Rotation on X/Y/Z
- Automatic front orientation for curved walls

Unlike renderer-only transformations, all transforms are baked directly into the exported OBJ geometry.

---

## Automatic UV Mapping

Every exported mesh includes a complete, non-overlapping UV map generated automatically during the export process.

This allows the OBJ file to be immediately texture-ready, eliminating the need for manual UV unwrapping in external 3D software and significantly speeding up content creation workflows.

---

## Tile Configuration

DisplayForge is fully parametric and allows every project to be built using any LED cabinet specification.

For each tile you can define:

- Physical width
- Physical height
- Horizontal resolution (pixels)
- Vertical resolution (pixels)

All geometry, dimensions, and exported meshes are automatically generated from these values.

The software continuously calculates and displays the overall display specifications, including:

- Total physical width
- Total physical height
- Total horizontal resolution
- Total vertical resolution
- Total pixel count

This allows designers to instantly verify both the physical size and the effective resolution of the LED wall while editing, regardless of its shape or compound-curve configuration.
---

## Multiple Screens (Standalone)

The standalone version supports complete multi-screen projects.

Each screen has its own:

- Tile specifications
- Compound curve
- Shape
- Position
- Rotation

Functions include:

- Add
- Duplicate
- Rename
- Delete

All screens can be exported individually or merged into a single OBJ file.

---

## Interactive 3D Preview

Available only in the standalone version.

Features include:

- Orbit controls
- Real-time geometry updates
- Multi-screen visualization
- Automatic framing
- Simultaneous 2D plan view

The Disguise plugin intentionally excludes the 3D viewer because Designer's embedded browser currently does not expose a usable WebGL context.

---

# Export

DisplayForge exports production-ready Wavefront OBJ files with all geometric data already prepared for use in real-time rendering and content creation workflows.

Each exported mesh includes:

- Optimized geometry
- Vertex normals
- Fully generated UV mapping
- Origin baked into the mesh
- Position baked into the mesh
- Rotation baked into the mesh

The generated UV layout is automatically created during mesh generation, allowing textures, media, or calibration assets to be applied immediately without requiring manual UV unwrapping in external 3D software.

The exported OBJ files can be imported directly into applications such as Disguise Designer, Pixera, Blender, Unreal Engine, Unity, and other software supporting the Wavefront OBJ format.

# Plugin vs Standalone

| Feature | Plugin | Standalone |
|----------|---------|------------|
| Runs inside Disguise Designer | ✔ | ✖ |
| 3D Preview | ✖ | ✔ |
| Multiple Screens | ✖ | ✔ |
| OBJ Export | ✔ | ✔ |
| Shape Generator | ✔ | ✔ |
| Compound Curves | ✔ | ✔ |
| Origin & Transform Tools | ✔ | ✔ |

---

# Supported Shapes

- Rectangle
- Triangle
- Circle
- Diamond
- Manual row editing

---

# Export

The application exports standard OBJ meshes with:

- Vertex positions
- Normals
- Origin baked into geometry
- Position baked into geometry
- Rotation baked into geometry


---
