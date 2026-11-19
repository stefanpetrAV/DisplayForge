// Builds the two distributable ZIPs from dist/:
//   DisplayForge_Plugin.zip     -> DisplayForge_Plugin/ (copy into Designer's Plugins folder)
//   DisplayForge_Standalone.zip -> DisplayForge_Standalone/ (serve over HTTP, open standalone.html)
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const stage = join(root, "release");
if (!existsSync(join(dist, "d3plugin.json"))) throw new Error("dist/ is missing: run `npm run build` first.");

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage);

for (const name of ["DisplayForge_Plugin", "DisplayForge_Standalone"]) {
  const folder = join(stage, name);
  cpSync(dist, folder, { recursive: true });
  const zip = join(root, `${name}.zip`);
  rmSync(zip, { force: true });
  if (process.platform === "win32") {
    // bsdtar ships with Windows 10+ and writes portable (forward-slash) zip entries.
    const tar = join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe");
    execFileSync(tar, ["-a", "-c", "-f", `../${name}.zip`, name], { cwd: stage, stdio: "inherit" });
  } else {
    execFileSync("zip", ["-qr", zip, name], { cwd: stage, stdio: "inherit" });
  }
  console.log(`created ${zip}`);
}
