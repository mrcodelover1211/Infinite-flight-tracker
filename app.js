const API="https://vbifkgzmczbndtawawre.supabase.co/functions/v1/flights";
const POLL_MS=15000;
const map=L.map("map",{worldCopyJump:true,zoomControl:true}).setView([20,0],2);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:"© OpenStreetMap contributors"}).addTo(map);
const markers=new Map();let allFlights=[];let visibleFlights=[];let lastSelectedId=null;let loading=false;
const $=id=>document.getElementById(id);

function aircraftIcon(heading){
  const h=Number.isFinite(Number(heading))?Number(heading):0;
  return L.divIcon({className:"plane-marker",html:'<div class="plane-glyph" style="transform:rotate('+h+'deg)">✈</div>',iconSize:[28,28],iconAnchor:[14,14]});
}
function formatNumber(value,digits){
  const n=Number(value);if(!Number.isFinite(n))return "—";
  return n.toLocaleString(undefined,{minimumFractionDigits:digits||0,maximumFractionDigits:digits||0});
}
function formatReport(value){
  if(!value)return "—";const d=new Date(value);
  return Number.isNaN(d.getTime())?String(value):d.toLocaleString();
}
function escapeHtml(value){
  return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function setStatus(text,state){$("status").textContent=text;$("status").className="status "+(state||"");}
function showError(message){$("error").textContent=message;$("error").classList.remove("hidden");}
function clearError(){$("error").classList.add("hidden");}

function applySearch(){
  const term=$("search").value.trim().toLowerCase();
  visibleFlights=!term?allFlights:allFlights.filter(f=>String(f.callsign||"").toLowerCase().includes(term)||String(f.username||"").toLowerCase().includes(term)||String(f.flight_id||"").toLowerCase()===term);
  render(visibleFlights);
}
function render(flights){
  $("summary").textContent=flights.length.toLocaleString()+" flight"+(flights.length===1?"":"s")+" shown";
  const activeIds=new Set();
  for(const f of flights){
    const lat=Number(f.latitude),lon=Number(f.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    const id=String(f.flight_id||((f.callsign||"flight")+":"+lat+":"+lon));activeIds.add(id);
    let marker=markers.get(id);
    if(!marker){marker=L.marker([lat,lon],{icon:aircraftIcon(f.heading_deg)}).addTo(map);markers.set(id,marker)}
    else{marker.setLatLng([lat,lon]);marker.setIcon(aircraftIcon(f.heading_deg))}
    marker.bindTooltip(f.callsign||f.username||"Flight",{direction:"top"});
    marker.off("click").on("click",()=>showDetails(f));
  }
  for(const [id,marker] of markers)if(!activeIds.has(id)){map.removeLayer(marker);markers.delete(id)}
  if(lastSelectedId){const selected=flights.find(f=>String(f.flight_id)===lastSelectedId);if(selected)showDetails(selected)}
}
function showDetails(f){
  lastSelectedId=String(f.flight_id||"");$("details").className="";
  $("details").innerHTML='<div class="card"><div class="aircraft">'+escapeHtml(f.callsign||"Unknown callsign")+'</div><div class="grid">'+
  '<div><div class="label">Pilot</div><div class="value">'+escapeHtml(f.username||"—")+'</div></div>'+
  '<div><div class="label">Flight ID</div><div class="value">'+escapeHtml(f.flight_id||"—")+'</div></div>'+
  '<div><div class="label">Altitude</div><div class="value">'+formatNumber(f.altitude_ft)+' ft</div></div>'+
  '<div><div class="label">Speed</div><div class="value">'+formatNumber(f.speed_kt)+' kt</div></div>'+
  '<div><div class="label">Heading</div><div class="value">'+formatNumber(f.heading_deg)+'°</div></div>'+
  '<div><div class="label">Vertical speed</div><div class="value">'+formatNumber(f.vertical_speed_fpm)+' ft/min</div></div>'+
  '<div><div class="label">Position</div><div class="value">'+formatNumber(f.latitude,4)+", "+formatNumber(f.longitude,4)+'</div></div>'+
  '<div><div class="label">Track</div><div class="value">'+formatNumber(f.track_deg)+'°</div></div>'+
  '<div><div class="label">Aircraft ID</div><div class="value">'+escapeHtml(f.aircraft_id||"—")+'</div></div>'+
  '<div><div class="label">Livery ID</div><div class="value">'+escapeHtml(f.livery_id||"—")+'</div></div>'+
  '<div class="wide"><div class="label">Last report</div><div class="value">'+escapeHtml(formatReport(f.last_report))+'</div></div>'+
  '</div></div>';
}
function fitAircraft(){
  const points=visibleFlights.map(f=>[Number(f.latitude),Number(f.longitude)]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(!points.length)return;if(points.length===1)map.setView(points[0],7);else map.fitBounds(L.latLngBounds(points),{padding:[30,30],maxZoom:7});
}
async function load(){
  if(loading)return;loading=true;setStatus("Updating…");clearError();
  try{
    const response=await fetch(API,{cache:"no-store"});const data=await response.json();
    if(!response.ok)throw new Error(data.message||data.error||("Backend returned HTTP "+response.status));
    if(data.simulated===true)throw new Error("Backend returned simulated data. The tracker refuses to display it.");
    allFlights=Array.isArray(data.flights)?data.flights:[];applySearch();
    $("updated").textContent="Updated "+new Date().toLocaleTimeString();setStatus("● Live","live");
  }catch(error){setStatus("● Backend error","error");showError(error instanceof Error?error.message:"Unknown backend error")}
  finally{loading=false}
}
$("searchBtn").addEventListener("click",applySearch);
$("resetBtn").addEventListener("click",()=>{$("search").value="";applySearch()});
$("fitBtn").addEventListener("click",fitAircraft);$("refreshBtn").addEventListener("click",load);
$("search").addEventListener("keydown",e=>{if(e.key==="Enter")applySearch()});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")load()});
load();setInterval(()=>{if(document.visibilityState==="visible")load()},POLL_MS);