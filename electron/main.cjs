// Windows desktop shell. The database file is stored in the user's AppData folder (app.getPath("userData")).
const { app, BrowserWindow, ipcMain, dialog, protocol, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const dataDir = () => app.getPath("userData");
const safeName = (n) => path.basename(String(n)); // never allow paths outside the data folder

function createWindow() {
  const win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 420, title: "Society Manager",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  // WhatsApp links open in WhatsApp / the default browser. Nothing else may open.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadURL("app://local/index.html");
}

app.whenReady().then(() => {
  const dist = path.join(__dirname, "..", "dist");
  // Electron 22 (the last version that runs on Windows 7/8/8.1/10/11) serves app:// files like this.
  protocol.registerFileProtocol("app", (req, callback) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "") || "index.html";
    const file = path.normalize(path.join(dist, rel));
    if (!file.startsWith(dist)) return callback({ error: -6 });
    callback({ path: file });
  });

  ipcMain.handle("db:read", async (_e, name) => {
    try { return new Uint8Array(await fs.promises.readFile(path.join(dataDir(), safeName(name)))); } catch { return null; }
  });
  ipcMain.handle("db:write", async (_e, name, bytes) => {
    const target = path.join(dataDir(), safeName(name));
    const tmp = target + ".tmp";
    await fs.promises.writeFile(tmp, Buffer.from(bytes)); // write then rename, so a crash cannot leave a half-written database
    await fs.promises.rename(tmp, target);
  });
  ipcMain.handle("file:saveAs", async (e, suggestedName, text) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showSaveDialog(win, { defaultPath: safeName(suggestedName), filters: [{ name: "Society backup", extensions: ["ssbackup"] }] });
    if (r.canceled || !r.filePath) return false;
    await fs.promises.writeFile(r.filePath, String(text), "utf8");
    return true;
  });

  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
