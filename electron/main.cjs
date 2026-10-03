const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");

const API_ROOT = "https://api.adsb.lol/v2";
const MAX_RADIUS_NM = 250;
const FETCH_TIMEOUT_MS = 12000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "ADSB-Flight-Tracker/0.1 (+desktop)" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`ADS-B API returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function validateQuery(q) {
  const lat = Number(q.lat);
  const lon = Number(q.lon);
  const radius = Number(q.radius ?? 100);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("Latitude must be between -90 and 90.");
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error("Longitude must be between -180 and 180.");
  if (!Number.isFinite(radius) || radius <= 0 || radius > MAX_RADIUS_NM) throw new Error(`Radius must be 1-${MAX_RADIUS_NM} NM.`);
  return { lat, lon, radius };
}

ipcMain.handle("adsb:nearby", async (_event, query) => {
  const { lat, lon, radius } = validateQuery(query || {});
  const data = await fetchJson(`${API_ROOT}/lat/${lat}/lon/${lon}/dist/${radius}`);
  return {
    source: "ADSB.lol",
    retrievedAt: new Date().toISOString(),
    aircraft: Array.isArray(data.aircraft) ? data.aircraft : [],
    total: Array.isArray(data.aircraft) ? data.aircraft.length : 0
  };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1450,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: "#070b11",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, "..", "adsb", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
