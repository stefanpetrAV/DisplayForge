import type { MeshData } from "./types";

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Resource-safe name: lowercase, [a-z0-9_-], used for the OBJ file and the Designer resources. */
export function resourceName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "") || "screen"
  );
}

export function meshToObj(mesh: MeshData, objectName: string): string {
  const lines = [
    "# Exported by DisplayForge",
    "# Units: metres, +Y up, front face towards +Z, UV v=0 at the bottom edge",
    `# vertices: ${mesh.metadata.vertexCount}, triangles: ${mesh.metadata.triangleCount}`,
    `o ${objectName.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "") || "screen"}`,
  ];
  const v = mesh.vertices;
  for (let i = 0; i < v.length; i += 3) lines.push(`v ${round6(v[i])} ${round6(v[i + 1])} ${round6(v[i + 2])}`);
  const t = mesh.uvs;
  for (let i = 0; i < t.length; i += 2) lines.push(`vt ${round6(t[i])} ${round6(t[i + 1])}`);
  const n = mesh.normals;
  for (let i = 0; i < n.length; i += 3) lines.push(`vn ${round6(n[i])} ${round6(n[i + 1])} ${round6(n[i + 2])}`);
  const f = mesh.indices;
  for (let i = 0; i < f.length; i += 3) {
    const a = f[i] + 1, b = f[i + 1] + 1, c = f[i + 2] + 1;
    lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
  }
  return lines.join("\n") + "\n";
}

export function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Keep the URL alive long enough for slow hosts (e.g. Designer's download handler).
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function downloadBytes(bytes: Uint8Array, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
