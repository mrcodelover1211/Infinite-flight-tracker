const map = L.map("map", { worldCopyJump: true, minZoom: 2 }).setView([36.8065, 10.1815], 5);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors"
}).addTo(map);
L.control.scale({ imperial: true, metric: true }).addTo(map);

const markers = new Map();
const state = { aircraft: [], selected: null, loading: false };

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
const fmt = (v, digits=0) => Number.isFinite(Number(v)) ? Number(v).toLocaleString(undefined,{maximumFractionDigits:digits}) : "—";

function icon(track) {
  const deg = Number.isFinite(Number(track)) ? Number(track) : 0;
  return L.divIcon({ className:"", html:`<div class="aircraft-icon"><span style="transform:rotate(${deg}deg)">✈</span></div>`, iconSize:[28,28], iconAnchor:[14,14] });
}

function aircraftId(a) { return a.hex || a.icao || `${a.lat}:${a.lon}:${a.flight || ""}`; }
function callsign(a) { return String(a.flight || a.callsign || "").trim() || "UNKNOWN"; }
function registration(a) { return a.r || a.registration || "—"; }
function type(a) { return a.t || a.type || "—"; }

function showDetail(a) {
  state.selected = aircraftId(a);
  $("detail").innerHTML = `
    <h3>${esc(callsign(a))}</h3>
    <div class="grid">
      <div><small>Registration</small><b>${esc(registration(a))}</b></div>
      <div><small>Type</small><b>${esc(type(a))}</b></div>
      <div><small>ICAO</small><b>${esc(a.hex || "—")}</b></div>
      <div><small>Altitude</small><b>${fmt(a.alt_baro)} ft</b></div>
      <div><small>Ground speed</small><b>${fmt(a.gs)} kt</b></div>
      <div><small>Track</small><b>${fmt(a.track,1)}°</b></div>
      <div><small>Vertical rate</small><b>${fmt(a.baro_rate)} ft/min</b></div>
      <div><small>Squawk</small><b>${esc(a.squawk || "—")}</b></div>
      <div><small>Latitude</small><b>${fmt(a.lat,5)}</b></div>
      <div><small>Longitude</small><b>${fmt(a.lon,5)}</b></div>
    </div>`;
  renderList();
}

function renderList() {
  const term = $("search").value.trim().toLowerCase();
  const list = state.aircraft.filter(a => {
    if (!term) return true;
    return [callsign(a), registration(a), type(a), a.hex].join(" ").toLowerCase().includes(term);
  }).sort((a,b) => (Number(b.alt_baro)||0) - (Number(a.alt_baro)||0));

  $("list").innerHTML = list.slice(0,300).map(a => {
    const id = aircraftId(a);
    return `<div class="row ${id===state.selected?"active":""}" data-id="${esc(id)}">
      <div><strong><span class="dot"></span>${esc(callsign(a))}</strong><small>${esc(registration(a))} · ${esc(type(a))}</small></div>
      <b>${fmt(a.alt_baro)} ft</b>
    </div>`;
  }).join("") || '<div style="padding:14px;color:#718294">No aircraft match.</div>';

  document.querySelectorAll(".row").forEach(row => row.addEventListener("click", () => {
    const a = state.aircraft.find(x => aircraftId(x) === row.dataset.id);
    if (a) selectAircraft(a);
  }));
}

function selectAircraft(a) {
  const id = aircraftId(a);
  state.selected = id;
  const m = markers.get(id);
  if (m) {
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 7), { animate:true });
    m.openPopup();
  }
  showDetail(a);
}

function popup(a) {
  return `<b>${esc(callsign(a))}</b><br>${esc(registration(a))} · ${esc(type(a))}<br>ALT ${fmt(a.alt_baro)} ft · GS ${fmt(a.gs)} kt<br>TRK ${fmt(a.track,1)}° · SQK ${esc(a.squawk || "—")}`;
}

function renderMap() {
  const incoming = new Set(state.aircraft.map(aircraftId));
  for (const [id, marker] of markers) {
    if (!incoming.has(id)) { map.removeLayer(marker); markers.delete(id); }
  }
  for (const a of state.aircraft) {
    const id = aircraftId(a);
    const lat = Number(a.lat), lon = Number(a.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let marker = markers.get(id);
    if (!marker) {
      marker = L.marker([lat,lon], { icon: icon(a.track), keyboard:true, title:callsign(a) });
      marker.on("click", () => showDetail(a));
      marker.bindPopup(popup(a));
      marker.addTo(map);
      markers.set(id, marker);
    } else {
      marker.setLatLng([lat,lon]);
      marker.setIcon(icon(a.track));
      marker.setPopupContent(popup(a));
    }
  }
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  $("status").textContent = "Fetching real ADS-B…";
  $("status").className = "";
  try {
    const lat = Number($("lat").value);
    const lon = Number($("lon").value);
    const radius = Number($("radius").value);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("Invalid latitude.");
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error("Invalid longitude.");
    if (!Number.isFinite(radius) || radius <= 0 || radius > 250) throw new Error("Radius must be 1-250 NM.");
    const data = await window.adsbAPI.nearby({lat,lon,radius});
    state.aircraft = data.aircraft || [];
    renderMap();
    renderList();
    $("count").textContent = String(state.aircraft.length);
    $("updated").textContent = new Date(data.retrievedAt).toLocaleTimeString();
    $("status").textContent = "● Live ADS-B";
    $("status").style.color = "#7ce0a4";
  } catch (e) {
    $("status").textContent = "● Data error";
    $("status").style.color = "#ff8d8d";
    $("detail").innerHTML = `<span class="error">${esc(e.message || e)}</span>`;
  } finally {
    state.loading = false;
  }
}

$("refresh").addEventListener("click", refresh);
$("locate").addEventListener("click", () => { $("lat").value="36.8065"; $("lon").value="10.1815"; $("radius").value="150"; refresh(); });
$("search").addEventListener("input", renderList);
setInterval(refresh, 15000);
refresh();
