const API = "https://vbifkgzmczbndtawawre.supabase.co/functions/v1/flights";
const POLL_MS = 15000;
const IDLE_STOP_MS = 15 * 60 * 1000;
const SERVER_ORDER = ["casual", "training", "expert"];

let selectedServer = new URLSearchParams(location.search).get("server")?.toLowerCase() || "expert";
if (!SERVER_ORDER.includes(selectedServer)) selectedServer = "expert";

const isLowPowerDevice =
  (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
  (navigator.deviceMemory && navigator.deviceMemory <= 4);

const map = L.map("map", {
  worldCopyJump: false,
  zoomControl: true,
  preferCanvas: true,
  renderer: L.canvas({ padding: 0.25 }),
  maxBounds: [[-85, -180], [85, 180]],
  maxBoundsViscosity: 0.85,
  minZoom: 2,
  maxZoom: 12
}).setView([20, 0], 2);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  noWrap: true,
  bounds: [[-85, -180], [85, 180]],
  attribution: "© OpenStreetMap contributors"
}).addTo(map);
L.control.scale({ imperial: true, metric: true }).addTo(map);

const canvasRenderer = L.canvas({ padding: 0.25 });
const markers = new Map();
const trailLines = new Map();
const trailHistory = new Map();
const worldMarkers = new Map();
const atcMarkers = new Map();
const worldCache = new Map();
const detailCache = new Map();

let selectedRouteLayer = null;
let allFlights = [];
let visibleFlights = [];
let flightById = new Map();
let loading = false;
let selectedFlight = null;
let airportTab = "arrivals";
let airportsVisible = false;
let followingFlightId = null;
let filterAircraft = "";
let filterLivery = "";
let filterVA = "";
let worldData = null;
let lastInteractionAt = Date.now();
let idlePaused = false;
let filterTimer = null;

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const formatNumber = (value, digits = 0) => {
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "—";
};

const formatReport = value => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
};

function normLon(value) {
  let n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  n = ((n + 180) % 360 + 360) % 360 - 180;
  return n === -180 ? 180 : n;
}

function setStatus(text, state = "") {
  $("status").textContent = text;
  $("status").className = "status " + state;
}

function showError(message) {
  $("error").textContent = message;
  $("error").classList.remove("hidden");
}

function clearError() {
  $("error").classList.add("hidden");
}

function serverIndex(server) {
  return SERVER_ORDER.indexOf(server);
}

function syncServerUI() {
  const index = serverIndex(selectedServer);
  $("serverSlider").value = String(index);
  const displayName = selectedServer[0].toUpperCase() + selectedServer.slice(1);
  $("serverLabel").textContent = displayName;
  $("serverLabelMirror").textContent = displayName;
  $("serverHint").textContent = isLowPowerDevice
    ? "Canvas mode · low-power optimized"
    : "Canvas mode · performance optimized";
}

function setServer(server) {
  if (!SERVER_ORDER.includes(server) || server === selectedServer) return;
  selectedServer = server;
  syncServerUI();
  history.replaceState(null, "", location.pathname + "?server=" + encodeURIComponent(server));
  followingFlightId = null;
  selectedFlight = null;
  clearFlightLayers();
  worldData = null;
  clearWorldLayers();
  load();
}

function clearFlightLayers() {
  for (const marker of markers.values()) map.removeLayer(marker);
  for (const line of trailLines.values()) map.removeLayer(line);
  markers.clear();
  trailLines.clear();
  trailHistory.clear();
  allFlights = [];
  visibleFlights = [];
  flightById = new Map();
}

function clearWorldLayers() {
  for (const marker of worldMarkers.values()) map.removeLayer(marker);
  for (const marker of atcMarkers.values()) map.removeLayer(marker);
  worldMarkers.clear();
  atcMarkers.clear();
}

function noteInteraction() {
  lastInteractionAt = Date.now();
  if (idlePaused) {
    idlePaused = false;
    setStatus("Updating…");
    load();
  }
}

["dragstart", "zoomstart", "mousedown", "touchstart", "wheel"].forEach(eventName => {
  map.on(eventName, noteInteraction);
});

function typeClass(f) {
  const type = String(f?.aircraft_type || "").toLowerCase();
  if (type.includes("helicopter") || type.includes("ec-")) return "rotorcraft";
  if (type.includes("a380") || type.includes("747") || type.includes("777") || type.includes("a350") || type.includes("767") || type.includes("787")) return "heavy";
  if (type.includes("737") || type.includes("a320") || type.includes("a330") || type.includes("a321") || type.includes("crj") || type.includes("embraer")) return "airliner";
  if (type.includes("cessna") || type.includes("piper") || type.includes("cirrus") || type.includes("tbm")) return "general";
  return "other";
}

function markerStyle(f, selected = false) {
  const kind = typeClass(f);
  const radius = selected ? 8 : kind === "heavy" ? 6 : kind === "rotorcraft" ? 4 : 5;
  const colors = {
    rotorcraft: "#ffbf69",
    heavy: "#8fd3ff",
    airliner: "#9fd8a3",
    general: "#d6b6ff",
    other: "#b8c4cf"
  };
  const fill = colors[kind];
  return {
    radius,
    color: selected ? "#ffffff" : fill,
    weight: selected ? 2 : 1,
    opacity: 0.95,
    fillColor: fill,
    fillOpacity: selected ? 1 : 0.86,
    renderer: canvasRenderer,
    interactive: true,
    bubblingMouseEvents: false
  };
}

function updateSelectedTrail(id, lat, lon) {
  if (selectedFlight?.flight_id && String(selectedFlight.flight_id) !== id && followingFlightId !== id) return;
  const history = trailHistory.get(id) || [];
  const previous = history[history.length - 1];
  if (!previous || Math.abs(previous[0] - lat) > 0.0001 || Math.abs(previous[1] - lon) > 0.0001) {
    history.push([lat, lon]);
    if (history.length > 18) history.shift();
    trailHistory.set(id, history);
  }
  const clean = splitWrappedPath(history);
  let line = trailLines.get(id);
  if (!line) {
    line = L.polyline(clean, {
      weight: 2,
      opacity: 0.45,
      interactive: false,
      noClip: false,
      renderer: canvasRenderer
    }).addTo(map);
    trailLines.set(id, line);
  } else {
    line.setLatLngs(clean);
  }
}

function splitWrappedPath(points) {
  if (!Array.isArray(points) || points.length < 2) return points || [];
  const segments = [];
  let current = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const point = points[i];
    if (Math.abs(point[1] - prev[1]) > 180) {
      if (current.length > 1) segments.push(current);
      current = [point];
    } else {
      current.push(point);
    }
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

function createMarker(f) {
  const id = String(f.flight_id || f.callsign || "");
  const marker = L.circleMarker(
    [Number(f.latitude), normLon(f.longitude)],
    markerStyle(f, false)
  );
  marker.bindTooltip(f.callsign || f.username || "Flight", {
    direction: "top",
    sticky: true,
    opacity: 0.92
  });
  marker.on("click", () => {
    const current = flightById.get(id);
    if (current) loadFlightDetail(current);
  });
  marker.on("dblclick", event => {
    L.DomEvent.stopPropagation(event);
    const current = flightById.get(id);
    if (current) followFlight(current);
  });
  marker.addTo(map);
  return marker;
}

function updateMarker(marker, f, selected = false) {
  const lat = Number(f.latitude);
  const lon = normLon(f.longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon)) return;

  if (marker._lat !== lat || marker._lon !== lon) {
    marker.setLatLng([lat, lon]);
    marker._lat = lat;
    marker._lon = lon;
  }

  const styleKey = typeClass(f) + ":" + (selected ? "selected" : "normal");
  if (marker._styleKey !== styleKey) {
    marker.setStyle(markerStyle(f, selected));
    marker._styleKey = styleKey;
  }

  const label = f.callsign || f.username || "Flight";
  if (marker._tooltipText !== label) {
    marker.setTooltipContent(label);
    marker._tooltipText = label;
  }

  if (selected) marker.bringToFront();
}

function render(flights) {
  const active = new Set();
  $("summary").textContent =
    flights.length.toLocaleString() +
    " flight" +
    (flights.length === 1 ? "" : "s") +
    " shown · " +
    selectedServer[0].toUpperCase() +
    selectedServer.slice(1);

  flightById = new Map(flights.map(f => [String(f.flight_id || ""), f]));

  for (const f of flights) {
    const lat = Number(f.latitude);
    const lon = normLon(f.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon)) continue;

    const id = String(f.flight_id || f.callsign || ("flight:" + lat + ":" + lon));
    active.add(id);

    const selected = String(selectedFlight?.flight_id || "") === id || followingFlightId === id;
    let marker = markers.get(id);
    if (!marker) {
      marker = createMarker(f);
      markers.set(id, marker);
    }
    updateMarker(marker, f, selected);
    if (selected) updateSelectedTrail(id, lat, lon);
  }

  for (const [id, marker] of markers) {
    if (!active.has(id)) {
      map.removeLayer(marker);
      markers.delete(id);
    }
  }

  if (selectedFlight) {
    const current = flights.find(f => String(f.flight_id) === String(selectedFlight.flight_id));
    if (current) {
      selectedFlight = { ...selectedFlight, ...current };
      renderFlightDetails(selectedFlight);
    }
  }

  if (followingFlightId) {
    const current = flights.find(f => String(f.flight_id) === followingFlightId);
    if (current) {
      const lat = Number(current.latitude);
      const lon = normLon(current.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        map.setView([lat, lon], Math.max(map.getZoom(), 7), { animate: false });
      }
    }
  }
}

function selectFlight(f) {
  const previousId = String(selectedFlight?.flight_id || "");
  const nextId = String(f?.flight_id || "");
  if (previousId && previousId !== nextId) {
    const oldLine = trailLines.get(previousId);
    if (oldLine) map.removeLayer(oldLine);
    trailLines.delete(previousId);
    trailHistory.delete(previousId);
  }
  selectedFlight = f;
}

function followFlight(f) {
  followingFlightId = String(f.flight_id || "");
  selectFlight(f);
  const lat = Number(f.latitude);
  const lon = normLon(f.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    map.setView([lat, lon], 8, { animate: false });
  }
  renderFlightDetails(f);
  loadFlightDetail(f, true);
}

function stopFollowing() {
  followingFlightId = null;
  render(visibleFlights);
  if (selectedFlight) renderFlightDetails(selectedFlight);
}

function buildSearchBlob(f) {
  return [
    f.callsign,
    f.username,
    f.aircraft_type,
    f.livery_name,
    f.virtual_organization,
    f.origin?.identifier,
    f.origin?.name,
    f.destination?.identifier,
    f.destination?.name,
    f.flight_id
  ].map(v => String(v ?? "").toLowerCase()).join(" ");
}

function applySearch() {
  const term = $("search").value.trim().toLowerCase();
  visibleFlights = allFlights.filter(f =>
    (!term || f.search_blob.includes(term)) &&
    (!filterAircraft || String(f.aircraft_type || "").toLowerCase().includes(filterAircraft)) &&
    (!filterLivery || String(f.livery_name || "").toLowerCase().includes(filterLivery)) &&
    (!filterVA || String(f.virtual_organization || "").toLowerCase().includes(filterVA))
  );
  render(visibleFlights);
}

function scheduleFilterUpdate() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(applySearch, 120);
}

async function commonsSearch(query) {
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=" +
    encodeURIComponent(query) +
    "&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=900&format=json&origin=*";
  try {
    const response = await fetch(url);
    const data = await response.json();
    return Object.values(data?.query?.pages || {})
      .map(page => ({ title: page.title, info: page.imageinfo?.[0] }))
      .filter(item => item.info?.thumburl || item.info?.url);
  } catch {
    return [];
  }
}

async function showWikiPhoto(f) {
  const model = String(f.aircraft_type || "").trim();
  const livery = String(f.livery_name || "").trim();

  const [modelResults, liveryResults] = await Promise.all([
    model ? commonsSearch(model + " aircraft") : Promise.resolve([]),
    livery ? commonsSearch(livery + " " + model + " aircraft") : Promise.resolve([])
  ]);

  const pick = (items, needle) => {
    const n = String(needle || "").toLowerCase();
    return items.find(item => String(item.title || "").toLowerCase().includes(n)) || items[0] || null;
  };

  const aircraftPhoto = pick(modelResults, model);
  const liveryPhoto = pick(liveryResults, livery);

  f.wiki_photo = aircraftPhoto?.info
    ? {
        url: aircraftPhoto.info.thumburl || aircraftPhoto.info.url,
        title: aircraftPhoto.title,
        descriptionurl: aircraftPhoto.info.descriptionurl,
        match: "aircraft"
      }
    : null;

  f.wiki_livery_photo = liveryPhoto?.info
    ? {
        url: liveryPhoto.info.thumburl || liveryPhoto.info.url,
        title: liveryPhoto.title,
        descriptionurl: liveryPhoto.info.descriptionurl,
        match: "livery"
      }
    : null;
}

async function loadFlightDetail(f, force = false) {
  selectFlight(f);
  const key = selectedServer + ":" + String(f.flight_id || "");
  const cached = detailCache.get(key);

  try {
    let data = cached && cached.expires > Date.now() && !force ? cached.flight : null;
    if (!data) {
      const response = await fetch(
        API +
          "?server=" +
          encodeURIComponent(selectedServer) +
          "&detail=flight&flightId=" +
          encodeURIComponent(f.flight_id),
        { cache: "no-store" }
      );
      const json = await response.json();
      if (!response.ok) throw new Error(json.message || "Detailed route data unavailable");
      data = json.flight || f;
      detailCache.set(key, { expires: Date.now() + POLL_MS, flight: data });
    }
    selectedFlight = { ...f, ...data };
    renderFlightDetails(selectedFlight);
    await showWikiPhoto(selectedFlight);
    renderFlightDetails(selectedFlight);
  } catch {
    renderFlightDetails(f);
  }
}

function renderFlightDetails(f) {
  $("details").className = "";
  const aircraftName = f.aircraft_type || "Aircraft type unavailable";
  const liveryName = f.livery_name || "Livery unavailable";
  const dest = f.destination?.identifier || f.destination?.name || "Unknown";
  const origin = f.origin?.identifier || f.origin?.name || "Unknown";
  const isFollowing = followingFlightId === String(f.flight_id);

  $("details").innerHTML =
    '<div class="card">' +
    (f.wiki_photo
      ? '<img class="photo" src="' +
        escapeHtml(f.wiki_photo.url) +
        '" alt="' +
        escapeHtml(aircraftName) +
        '"><div class="photo-credit">Wikimedia Commons · ' +
        escapeHtml(f.wiki_photo.title || "") +
        "</div>"
      : "") +
    (f.wiki_livery_photo
      ? '<img class="photo photo-secondary" src="' +
        escapeHtml(f.wiki_livery_photo.url) +
        '" alt="' +
        escapeHtml(liveryName) +
        '"><div class="photo-credit">Livery reference · Wikimedia Commons · ' +
        escapeHtml(f.wiki_livery_photo.title || "") +
        "</div>"
      : "") +
    '<div class="aircraft">' +
    escapeHtml(f.callsign || "Unknown callsign") +
    '</div><div class="muted">' +
    escapeHtml(aircraftName) +
    " · " +
    escapeHtml(liveryName) +
    '</div><div class="chips"><span class="chip">' +
    escapeHtml(selectedServer) +
    '</span><span class="chip">' +
    (f.connected ? "Connected" : "Disconnected") +
    '</span><span class="chip">' +
    escapeHtml(f.pilot_state_label || "Active") +
    '</span></div>' +
    '<div class="grid"><div><div class="label">Pilot</div><div class="value">' +
    escapeHtml(f.username || "—") +
    '</div></div><div><div class="label">Virtual airline</div><div class="value">' +
    escapeHtml(f.virtual_organization || "—") +
    '</div></div><div><div class="label">Origin</div><div class="value"><span class="route-badge">' +
    escapeHtml(origin) +
    '</span></div></div><div><div class="label">Destination</div><div class="value"><span class="route-badge">' +
    escapeHtml(dest) +
    '</span></div></div><div><div class="label">Altitude</div><div class="value">' +
    formatNumber(f.altitude_ft) +
    ' ft</div></div><div><div class="label">Speed</div><div class="value">' +
    formatNumber(f.speed_kt) +
    ' kt</div></div><div><div class="label">Heading</div><div class="value">' +
    formatNumber(f.heading_deg) +
    '°</div></div><div><div class="label">Vertical speed</div><div class="value">' +
    formatNumber(f.vertical_speed_fpm) +
    ' ft/min</div></div><div><div class="label">Position</div><div class="value">' +
    formatNumber(f.latitude, 4) +
    ", " +
    formatNumber(f.longitude, 4) +
    '</div></div><div><div class="label">Track</div><div class="value">' +
    formatNumber(f.track_deg) +
    '°</div></div><div><div class="label">ETA</div><div class="value">' +
    escapeHtml(f.eta ? formatReport(f.eta) : "—") +
    '</div></div><div><div class="label">Last report</div><div class="value">' +
    escapeHtml(formatReport(f.last_report)) +
    '</div></div><div class="wide"><div class="label">Live data</div><div class="value">Infinite Flight Live API · ' +
    escapeHtml(f.retrieved_at ? formatReport(f.retrieved_at) : "current request") +
    '</div></div></div><div class="detail-actions"><button class="small-btn" id="routeBtn">Show route</button><button class="small-btn" id="focusBtn">Focus</button><button class="small-btn" id="followBtn">' +
    (isFollowing ? "Stop following" : "Follow") +
    '</button><button class="small-btn" id="aiBtn">AI data</button></div></div>';

  $("routeBtn").addEventListener("click", () => drawSelectedRoute(f));
  $("focusBtn").addEventListener("click", () => {
    const lat = Number(f.latitude);
    const lon = normLon(f.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) map.setView([lat, lon], 8, { animate: false });
  });
  $("followBtn").addEventListener("click", () => (isFollowing ? stopFollowing() : followFlight(f)));
  $("aiBtn").addEventListener("click", () => copyAIUrl(f));
}

async function copyAIUrl(f) {
  const url =
    API +
    "?server=" +
    encodeURIComponent(selectedServer) +
    "&detail=ai&flightId=" +
    encodeURIComponent(f.flight_id);
  try {
    await navigator.clipboard.writeText(url);
    setStatus("AI endpoint copied", "live");
    setTimeout(() => setStatus("● Live", "live"), 1800);
  } catch {
    window.prompt("Copy this live AI endpoint:", url);
  }
}

function fitAircraft() {
  const points = visibleFlights
    .map(f => [Number(f.latitude), normLon(f.longitude)])
    .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (points.length === 1) {
    map.setView(points[0], 7, { animate: false });
  } else if (points.length > 1) {
    map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 7, animate: false });
  }
}

function renderWorldLayers() {
  clearWorldLayers();
  if (!airportsVisible || !worldData) return;

  const bounds = map.getBounds().pad(0.15);
  const zoom = map.getZoom();
  const airportLimit = zoom < 4 ? 80 : zoom < 6 ? 180 : 300;

  const airports = (worldData.airports || [])
    .filter(a => {
      const lat = Number(a.latitude);
      const lon = normLon(a.longitude);
      return Number.isFinite(lat) && Number.isFinite(lon) && bounds.contains([lat, lon]);
    })
    .sort((a, b) =>
      (Number(b.inbound_count || 0) + Number(b.outbound_count || 0)) -
      (Number(a.inbound_count || 0) + Number(a.outbound_count || 0))
    )
    .slice(0, airportLimit);

  for (const airport of airports) {
    const lat = Number(airport.latitude);
    const lon = normLon(airport.longitude);
    const traffic = Number(airport.inbound_count || 0) + Number(airport.outbound_count || 0);
    const marker = zoom >= 4
      ? L.marker([lat, lon], {
          icon: L.divIcon({
            className: "airport-label-wrap",
            html: '<button class="airport-label" type="button">' +
              escapeHtml((airport.icao || "APT") + " · " + traffic) +
              "</button>",
            iconSize: [92, 24],
            iconAnchor: [46, 12]
          })
        })
      : L.circleMarker([lat, lon], {
          radius: Math.max(3, Math.min(7, 3 + traffic / 15)),
          color: "#7eaccc",
          weight: 1,
          fillColor: "#7eaccc",
          fillOpacity: 0.55,
          renderer: canvasRenderer
        });

    marker.bindTooltip(
      (airport.name || "Airport") +
        " · " +
        (airport.icao || "") +
        " · " +
        traffic +
        " active traffic",
      { direction: "top" }
    );
    marker.on("click", () => loadAirport(airport.icao));
    marker.addTo(map);
    worldMarkers.set(airport.icao || String(lat) + ":" + lon, marker);
  }

  if (zoom >= 3) {
    for (const atc of (worldData.atc || [])) {
      const lat = Number(atc.latitude);
      const lon = normLon(atc.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !bounds.contains([lat, lon])) continue;
      const marker = L.circleMarker([lat, lon], {
        radius: 4,
        color: "#ffcf70",
        weight: 1,
        fillColor: "#ffcf70",
        fillOpacity: 0.7,
        renderer: canvasRenderer
      });
      marker.bindTooltip(
        "ATC · " +
          (atc.airport || "Center") +
          " · " +
          (atc.username || "Unknown"),
        { direction: "top" }
      );
      marker.addTo(map);
      atcMarkers.set(
        (atc.airport || "ATC") +
          ":" +
          (atc.username || "") +
          ":" +
          lat +
          ":" +
          lon,
        marker
      );
    }
  }

  $("airportCount").textContent =
    airports.length +
    " airports shown · " +
    atcMarkers.size +
    " ATC";
}

async function loadWorld() {
  const cached = worldCache.get(selectedServer);
  if (cached && cached.expires > Date.now()) {
    worldData = cached.data;
    renderWorldLayers();
    return;
  }

  const response = await fetch(
    API + "?server=" + encodeURIComponent(selectedServer) + "&detail=world",
    { cache: "no-store" }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "World data unavailable");

  worldData = data;
  worldCache.set(selectedServer, { expires: Date.now() + POLL_MS, data });
  renderWorldLayers();
}

function toggleAirports() {
  airportsVisible = !airportsVisible;
  $("airportsToggle").classList.toggle("active", airportsVisible);

  if (!airportsVisible) {
    clearWorldLayers();
    $("airportCount").textContent = "Airports off";
    return;
  }

  $("airportCount").textContent = "Loading airport data…";
  loadWorld().catch(error => showError(error.message));
}

async function loadAirport(icao) {
  icao = String(icao || "").trim().toUpperCase();

  if (!/^[A-Z0-9]{4}$/.test(icao)) {
    $("airportPanel").classList.remove("hidden");
    $("airportPanel").innerHTML =
      '<div class="error">Enter a valid four-character ICAO code, such as LTFM.</div>';
    return;
  }

  $("airportPanel").classList.remove("hidden");
  $("airportPanel").innerHTML =
    '<div class="airport-title">' +
    escapeHtml(icao) +
    '</div><div class="muted">Loading live airport traffic…</div>';

  try {
    const response = await fetch(
      API +
        "?server=" +
        encodeURIComponent(selectedServer) +
        "&detail=airport&airport=" +
        encodeURIComponent(icao),
      { cache: "no-store" }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || "Airport unavailable");
    renderAirportResults(data);
    const lat = Number(data.airport?.latitude);
    const lon = normLon(data.airport?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      map.setView([lat, lon], 8, { animate: false });
    }
  } catch (error) {
    $("airportPanel").innerHTML =
      '<div class="error">' +
      escapeHtml(error.message || "Airport unavailable") +
      "</div>";
  }
}

function renderAirportResults(data) {
  const airport = data.airport || {};
  const list = airportTab === "arrivals" ? data.inbound || [] : data.outbound || [];

  $("airportPanel").innerHTML =
    '<div class="airport-title">' +
    escapeHtml(airport.icao || "Airport") +
    '</div><div class="muted">' +
    escapeHtml(airport.name || "") +
    '</div><div class="tabs"><button class="' +
    (airportTab === "arrivals" ? "active" : "") +
    '" id="arrivalsTab">Arrivals (' +
    (data.inbound_count ?? 0) +
    ')</button><button class="' +
    (airportTab === "departures" ? "active" : "") +
    '" id="departuresTab">Departures (' +
    (data.outbound_count ?? 0) +
    ")</button></div>" +
    list.map(item => {
      const f = item.flight || {};
      const other =
        airportTab === "arrivals"
          ? item.origin?.identifier || item.origin?.name || "Unknown origin"
          : item.destination?.identifier || item.destination?.name || "Unknown destination";
      const time = item.eta
        ? new Date(item.eta).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "—";
      return (
        '<div class="flight-row" data-flight="' +
        escapeHtml(f.flight_id || "") +
        '"><div class="flight-main"><strong>' +
        escapeHtml(f.callsign || "Unknown") +
        '</strong><span class="route-badge">' +
        escapeHtml(other) +
        '</span></div><div class="muted">' +
        escapeHtml(f.username || "") +
        " · " +
        escapeHtml(f.aircraft_type || "") +
        " · " +
        (airportTab === "arrivals" ? "ETA " : "Departure ") +
        time +
        "</div></div>"
      );
    }).join("") ||
    '<div class="empty">No live ' +
    (airportTab === "arrivals" ? "arrivals" : "departures") +
    " returned.</div>";

  $("arrivalsTab").addEventListener("click", () => {
    airportTab = "arrivals";
    loadAirport(airport.icao);
  });
  $("departuresTab").addEventListener("click", () => {
    airportTab = "departures";
    loadAirport(airport.icao);
  });

  document.querySelectorAll(".flight-row").forEach(row => {
    row.addEventListener("click", () => {
      const flight = allFlights.find(
        item => String(item.flight_id) === row.dataset.flight
      );
      if (flight) loadFlightDetail(flight);
    });
  });
}

function drawSelectedRoute(f) {
  if (selectedRouteLayer) {
    map.removeLayer(selectedRouteLayer);
    selectedRouteLayer = null;
  }

  const routePoints = (f.route || [])
    .map(point => [Number(point.latitude), normLon(point.longitude)])
    .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));

  const planPoints = (f.flight_plan?.flightPlanItems || [])
    .flatMap(item => {
      const location = item?.location;
      return location &&
        Number.isFinite(Number(location.latitude)) &&
        Number.isFinite(Number(location.longitude))
        ? [[Number(location.latitude), normLon(location.longitude)]]
        : [];
    });

  const layers = [];
  if (routePoints.length > 1) {
    splitWrappedPath(routePoints).forEach(segment => {
      if (segment.length > 1) {
        layers.push(
          L.polyline(segment, {
            weight: 3,
            opacity: 0.65,
            renderer: canvasRenderer
          })
        );
      }
    });
  }

  if (planPoints.length > 1) {
    splitWrappedPath(planPoints).forEach(segment => {
      if (segment.length > 1) {
        layers.push(
          L.polyline(segment, {
            weight: 2,
            opacity: 0.5,
            dashArray: "5 6",
            renderer: canvasRenderer
          })
        );
      }
    });
  }

  if (!layers.length) {
    setStatus("No route geometry", "error");
    setTimeout(() => setStatus("● Live", "live"), 1600);
    return;
  }

  selectedRouteLayer = L.layerGroup(layers).addTo(map);
  const combined = [...routePoints, ...planPoints];
  if (combined.length) {
    map.fitBounds(L.latLngBounds(combined), {
      padding: [40, 40],
      maxZoom: 7,
      animate: false
    });
  }
}

async function load() {
  if (loading || idlePaused) return;
  loading = true;
  setStatus("Updating…");
  clearError();

  try {
    const response = await fetch(
      API + "?server=" + encodeURIComponent(selectedServer),
      { cache: "no-store" }
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || ("Backend returned HTTP " + response.status));
    }
    if (data.simulated === true) {
      throw new Error("Backend returned simulated data. The tracker refuses to display it.");
    }

    allFlights = Array.isArray(data.flights)
      ? data.flights.map(f => ({
          ...f,
          retrieved_at: data.retrieved_at,
          pilot_state_label:
            ["Active", "Away in flight", "Away parked", "In background"][Number(f.pilot_state)] ||
            "Unknown"
        }))
      : [];

    for (const flight of allFlights) {
      flight.search_blob = buildSearchBlob(flight);
    }

    applySearch();

    $("updated").textContent =
      "Updated " +
      new Date().toLocaleTimeString() +
      " · " +
      (data.retrieved_at ? new Date(data.retrieved_at).toLocaleTimeString() : "live");

    $("serverCounts").textContent = allFlights.length.toLocaleString();
    setStatus("● Live", "live");
  } catch (error) {
    setStatus("● Backend error", "error");
    showError(error instanceof Error ? error.message : "Unknown error");
  } finally {
    loading = false;
  }
}

$("serverSlider").addEventListener("input", event => {
  const server = SERVER_ORDER[Number(event.target.value)];
  if (server) setServer(server);
});

$("searchBtn").addEventListener("click", applySearch);
$("resetBtn").addEventListener("click", () => {
  $("search").value = "";
  $("aircraftFilter").value = "";
  $("liveryFilter").value = "";
  $("vaFilter").value = "";
  filterAircraft = "";
  filterLivery = "";
  filterVA = "";
  applySearch();
});

$("search").addEventListener("input", scheduleFilterUpdate);
$("search").addEventListener("keydown", event => {
  if (event.key === "Enter") applySearch();
});

$("aircraftFilter").addEventListener("input", event => {
  filterAircraft = event.target.value.trim().toLowerCase();
  scheduleFilterUpdate();
});
$("liveryFilter").addEventListener("input", event => {
  filterLivery = event.target.value.trim().toLowerCase();
  scheduleFilterUpdate();
});
$("vaFilter").addEventListener("input", event => {
  filterVA = event.target.value.trim().toLowerCase();
  scheduleFilterUpdate();
});

$("fitBtn").addEventListener("click", fitAircraft);
$("refreshBtn").addEventListener("click", () => {
  lastInteractionAt = Date.now();
  load();
});

$("airportsToggle").addEventListener("click", toggleAirports);

$("airportBtn").addEventListener("click", () => {
  const box = $("airportSearch");
  const open = box.classList.toggle("hidden") === false;
  $("airportBtn").setAttribute("aria-expanded", String(open));
  if (open) {
    $("airportInput").focus();
    $("airportInput").select();
  }
});

$("airportGo").addEventListener("click", () => loadAirport($("airportInput").value));
$("airportInput").addEventListener("keydown", event => {
  if (event.key === "Enter") loadAirport(event.target.value);
});

map.on("moveend zoomend", () => {
  if (airportsVisible) renderWorldLayers();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    idlePaused = false;
    lastInteractionAt = Date.now();
    load();
  }
});

syncServerUI();
setInterval(() => {
  if (document.visibilityState !== "visible") return;

  if (Date.now() - lastInteractionAt >= IDLE_STOP_MS) {
    idlePaused = true;
    setStatus("Paused · idle", "");
    return;
  }

  load();
}, POLL_MS);

load();
