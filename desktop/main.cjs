// Electron wrapper for the standalone app (portable Windows build).
// The built web app (dist/) is served through a private "app://" protocol so
// ES modules load normally and localStorage (saved screens) has a stable origin.
const { app, BrowserWindow, Menu, net, protocol, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DIST = path.join(__dirname, "..", "dist");
const SMOKE_TEST = process.env.DISPLAYFORGE_SMOKE_TEST === "1";

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#141414",
    title: "DisplayForge",
    icon: path.join(DIST, "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  // Links opened by the page go to the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  if (SMOKE_TEST) {
    win.webContents.on("console-message", (_e, _level, message) => console.log(`[page] ${message}`));
    win.webContents.on("did-finish-load", async () => {
      // Give Vue and the 3D viewer time to start, then report what rendered.
      await new Promise((r) => setTimeout(r, 3000));
      const report = await win.webContents.executeJavaScript(
        `JSON.stringify({ title: document.title, screens: document.querySelectorAll('.screen-row').length, canvas: !!document.querySelector('canvas') })`,
      );
      console.log(`SMOKE ${report}`);
      app.quit();
    });
    win.webContents.on("did-fail-load", (_e, code, desc) => {
      console.log(`SMOKE FAIL ${code} ${desc}`);
      app.exit(1);
    });
  }

  win.loadURL("app://displayforge/standalone.html");
}

app.whenReady().then(() => {
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on("window-all-closed", () => app.quit());
