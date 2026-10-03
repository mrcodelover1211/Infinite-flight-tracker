const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("adsbAPI", {
  nearby: (query) => ipcRenderer.invoke("adsb:nearby", query)
});
