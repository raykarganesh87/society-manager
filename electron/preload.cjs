const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("electronAPI", {
  read: (name) => ipcRenderer.invoke("db:read", name),
  write: (name, bytes) => ipcRenderer.invoke("db:write", name, bytes),
  saveAs: (name, text) => ipcRenderer.invoke("file:saveAs", name, text),
});
