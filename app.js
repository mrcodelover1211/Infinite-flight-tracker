const API = "https://vbifkgzmczbndtawawre.supabase.co/functions/v1/flights";
const map = L.map("map",{worldCopyJump:true,zoomControl:true}).setView([20,0],2);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:"© OpenStreetMap contributors"}).addTo(map);
const markers = new Map();
let allFlights = [];
const $ = id => document.getElementById(id);

function aircraftIcon(heading=0){
  return L.divIcon({className:"plane-marker",html:`<div style="font-size:18px;transform:rotate(${heading}deg);filter:drop-shadow(0 1px 2px #000)">✈</div>`,iconSize:[24,24],iconAnchor:[12,12]});
}
function render(flights){
  const visible = flights;
  $("summary").textContent = `${visible.length} flight${visible.length===1?"":"s"} shown`;
  const activeIds = new Set();
  visible.forEach(f=>{
    if(typeof f.latitude!=="number"||typeof f.longitude!=="number") return;
    activeIds.add(f.flight_id);
    let m=markers.get(f.flight_id);
    if(!m){m=L.marker([f.latitude,f.longitude],{icon:aircraftIcon(f.heading_deg)}).addTo(map);markers.set(f.flight_id,m);m.on("click",()=>showDetails(f));}
    else {m.setLatLng([f.latitude,f.longitude]);m.setIcon(aircraftIcon(f.heading_deg));m.off("click").on("click",()=>showDetails(f));}
    m.bindTooltip(f.callsign||f.username||"Flight",{direction:"top"});
  });
  for(const [id,m] of markers){if(!activeIds.has(id)){map.removeLayer(m);markers.delete(id)}}
}
function showDetails(f){
  $("details").innerHTML=`<div class="card"><div class="aircraft">${f.callsign||"Unknown callsign"}</div>
  <p><span class="label">Pilot</span><br>${f.username||"Unlinked"}</p>
  <p><span class="label">Position</span><br>${Number(f.latitude).toFixed(4)}, ${Number(f.longitude).toFixed(4)}</p>
  <p><span class="label">Altitude</span><br>${Math.round(f.altitude_ft).toLocaleString()} ft</p>
  <p><span class="label">Ground speed</span><br>${Math.round(f.speed_kt)} kt</p>
  <p><span class="label">Heading</span><br>${Math.round(f.heading_deg)}°</p>
  <p><span class="label">Vertical speed</span><br>${Math.round(f.vertical_speed_fpm)} ft/min</p>
  <p><span class="label">Last report</span><br>${f.last_report||"Unknown"}</p></div>`;
}
async function load(query=""){
  $("status").textContent="Updating…";
  try{
    const res=await fetch(API+(query?("?q="+encodeURIComponent(query)):""));
    const data=await res.json();
    if(!res.ok) throw new Error(data.message||data.error||"Backend error");
    allFlights=data.flights||[];
    render(allFlights);
    $("status").textContent="● Live";
  }catch(e){$("status").textContent="● Backend error";$("summary").textContent=e.message}
}
$("searchBtn").onclick=()=>load($("search").value.trim());
$("resetBtn").onclick=()=>{$("search").value="";load()};
$("search").addEventListener("keydown",e=>{if(e.key==="Enter")load($("search").value.trim())});
load();
setInterval(()=>{if(document.visibilityState==="visible")load($("search").value.trim())},15000);