const API = "https://vbifkgzmczbndtawawre.supabase.co/functions/v1/flights";
const POLL_MS = 15000;
const IDLE_STOP_MS = 15 * 60 * 1000;
const SERVERS = ["casual","training","expert"];

let selectedServer = new URLSearchParams(location.search).get("server")?.toLowerCase() || "expert";
if (!SERVERS.includes(selectedServer)) selectedServer = "expert";

const map = L.map("map", {
  worldCopyJump:false, zoomControl:true, preferCanvas:true,
  maxBounds:[[-85,-180],[85,180]], maxBoundsViscosity:1,
  minZoom:2, maxZoom:12, inertia:false
}).setView([20,0],2);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom:19,noWrap:true,bounds:[[-85,-180],[85,180]],
  attribution:"© OpenStreetMap contributors"
}).addTo(map);
L.control.scale({imperial:true,metric:true}).addTo(map);

const $=id=>document.getElementById(id);
const markers=new Map();
const airportMarkers=new Map();
const atcMarkers=new Map();
const trails=new Map();
const trailHistory=new Map();
const flightById=new Map();

let allFlights=[], visibleFlights=[], selectedFlight=null, followingFlightId=null;
let worldData=null, airportsVisible=false, airportTab="arrivals";
let loading=false, idlePaused=false, lastInteractionAt=Date.now();
let filterPhase="all", filterTimer=null, animationFrame=0;

const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v).toLocaleString(undefined,{maximumFractionDigits:d}):"—";
const normLon=v=>{let n=Number(v);if(!Number.isFinite(n))return NaN;n=((n+180)%360+360)%360-180;return n===-180?180:n};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const displayServer=s=>s.charAt(0).toUpperCase()+s.slice(1);

function setStatus(t,c=""){$("status").textContent=t;$("status").className="status "+c}
function error(t){$("error").textContent=t;$("error").classList.remove("hidden")}
function clearError(){$("error").classList.add("hidden")}

function syncServerUI(){
  document.querySelectorAll(".server-btn").forEach(b=>b.classList.toggle("active",b.dataset.server===selectedServer));
  $("serverLabelMirror").textContent=displayServer(selectedServer);
}
function setServer(server){
  if(!SERVERS.includes(server)||server===selectedServer)return;
  selectedServer=server;
  history.replaceState(null,"",location.pathname+"?server="+server);
  selectedFlight=null;followingFlightId=null;clearMarkers();worldData=null;clearWorld();
  syncServerUI();load();
}

function clearMarkers(){
  for(const m of markers.values())map.removeLayer(m);
  for(const l of trails.values())map.removeLayer(l);
  markers.clear();trails.clear();trailHistory.clear();flightById.clear();
}
function clearWorld(){
  for(const m of airportMarkers.values())map.removeLayer(m);
  for(const m of atcMarkers.values())map.removeLayer(m);
  airportMarkers.clear();atcMarkers.clear();
}

function validPos(f){
  const lat=Number(f.latitude),lon=normLon(f.longitude);
  return Number.isFinite(lat)&&lat>=-85&&lat<=85&&Number.isFinite(lon);
}
function shortestLonDelta(a,b){let d=b-a;if(d>180)d-=360;if(d<-180)d+=360;return d}

const planeSvg='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.5 11.1 14 8.2V3.7c0-.7-.5-1.2-1.2-1.2h-1.6c-.7 0-1.2.5-1.2 1.2v4.5l-7.5 2.9c-.6.2-1 .8-1 1.4v.7c0 .5.4.9.9.9H10v3.7l-2.4 1.5c-.4.2-.6.7-.6 1.1v.5c0 .4.4.7.8.6l4.1-1.2 4.1 1.2c.4.1.8-.2.8-.6v-.5c0-.5-.2-.9-.6-1.1L14 17.8v-3.7h7.6c.5 0 .9-.4.9-.9v-.7c0-.6-.4-1.2-1-1.4Z"/></svg>';

function createPlaneMarker(f){
  const id=String(f.flight_id||f.callsign||Math.random());
  const marker=L.marker([clamp(Number(f.latitude),-85,85),normLon(f.longitude)],{
    icon:L.divIcon({className:"",html:'<div class="aircraft-marker">'+planeSvg+"</div>",iconSize:[18,18],iconAnchor:[9,9]}),
    keyboard:false,zIndexOffset:10
  });
  marker._id=id;marker._lat=Number(f.latitude);marker._lon=normLon(f.longitude);marker._targetLat=marker._lat;marker._targetLon=marker._lon;
  marker._heading=Number(f.heading_deg??f.track_deg??0);
  marker._targetHeading=marker._heading;
  marker.bindTooltip(f.callsign||f.username||"Flight",{direction:"top",sticky:true,opacity:.92});
  marker.on("click",()=>{const x=flightById.get(id);if(x)loadFlightDetail(x)});
  marker.on("dblclick",e=>{L.DomEvent.stopPropagation(e);const x=flightById.get(id);if(x)followFlight(x)});
  marker.addTo(map);markers.set(id,marker);return marker;
}

function updatePlane(marker,f,selected){
  if(!validPos(f))return;
  const lat=clamp(Number(f.latitude),-85,85),lon=normLon(f.longitude);
  marker._startLat=Number(marker._lat);marker._startLon=Number(marker._lon);
  marker._targetLat=lat;marker._targetLon=lon;marker._animStart=performance.now();marker._animEnd=performance.now()+POLL_MS;
  marker._targetHeading=Number.isFinite(Number(f.heading_deg))?Number(f.heading_deg):Number(f.track_deg)||0;
  marker._selected=selected;
  marker.setTooltipContent(f.callsign||f.username||"Flight");
  const el=marker.getElement()?.querySelector(".aircraft-marker");
  if(el){el.classList.toggle("selected",selected);el.style.transform="rotate("+marker._targetHeading+"deg)"}
}

function animatePlanes(now){
  for(const m of markers.values()){
    if(!Number.isFinite(m._targetLat)||!Number.isFinite(m._targetLon))continue;
    const p=clamp((now-(m._animStart||now))/Math.max(1,(m._animEnd||now)-(m._animStart||now)),0,1);
    const lat=(m._startLat??m._targetLat)+(m._targetLat-(m._startLat??m._targetLat))*p;
    const d=shortestLonDelta(m._startLon??m._targetLon,m._targetLon);
    let lon=(m._startLon??m._targetLon)+d*p;lon=normLon(lon);
    m.setLatLng([lat,lon]);m._lat=lat;m._lon=lon;
    const el=m.getElement()?.querySelector(".aircraft-marker");
    if(el){
      let h=m._heading??m._targetHeading;let dh=shortestLonDelta(h,m._targetHeading);h=(h+dh*Math.min(1,p));m._heading=h;
      el.style.transform="rotate("+h+"deg)";
    }
  }
  animationFrame=requestAnimationFrame(animatePlanes);
}

function typeClass(f){
  const t=String(f.aircraft_type||"").toLowerCase();
  if(/helicopter|ec-|r44|r22/.test(t))return"rotorcraft";
  if(/a380|747|777|a350|767|787|md-11|dc-10/.test(t))return"heavy";
  if(/737|a320|a330|a321|crj|embraer|e175|e190/.test(t))return"airliner";
  if(/cessna|piper|cirrus|tbm|bonanza/.test(t))return"general";
  return"other";
}
function phase(f){
  const alt=Number(f.altitude_ft),vs=Number(f.vertical_speed_fpm),speed=Number(f.speed_kt);
  if(speed<40||alt<1000)return"ground";
  if(vs>250)return"climb";
  if(vs<-250)return"descent";
  return"cruise";
}
function searchBlob(f){return[f.callsign,f.username,f.aircraft_type,f.livery_name,f.virtual_organization,f.origin?.identifier,f.destination?.identifier,f.flight_id].map(x=>String(x??"").toLowerCase()).join(" ")}

function applyFilters(){
  const term=$("search").value.trim().toLowerCase(), aircraft=$("aircraftFilter").value.trim().toLowerCase(), livery=$("liveryFilter").value.trim().toLowerCase(),va=$("vaFilter").value.trim().toLowerCase(),airport=$("airportFilter").value.trim().toUpperCase();
  const minAlt=Number($("minAlt").value),maxAlt=Number($("maxAlt").value),minSpeed=Number($("minSpeed").value);
  visibleFlights=allFlights.filter(f=>{
    const a=Number(f.altitude_ft),s=Number(f.speed_kt),ph=phase(f),blob=f.search_blob;
    const airportMatch=!airport||String(f.origin?.identifier||"").toUpperCase()===airport||String(f.destination?.identifier||"").toUpperCase()===airport;
    return(!term||blob.includes(term))&&(!aircraft||String(f.aircraft_type||"").toLowerCase().includes(aircraft))&&(!livery||String(f.livery_name||"").toLowerCase().includes(livery))&&(!va||String(f.virtual_organization||"").toLowerCase().includes(va)||String(f.livery_name||"").toLowerCase().includes(va))&&airportMatch&&(!Number.isFinite(minAlt)||a>=minAlt)&&(!Number.isFinite(maxAlt)||a<=maxAlt)&&(!Number.isFinite(minSpeed)||s>=minSpeed)&&(filterPhase==="all"||ph===filterPhase);
  });
  renderFlights();
}

function renderFlights(){
  $("summary").textContent=visibleFlights.length.toLocaleString()+" shown · "+allFlights.length.toLocaleString()+" live · "+displayServer(selectedServer);
  $("serverCounts").textContent=allFlights.length.toLocaleString();
  flightById.clear();for(const f of visibleFlights)flightById.set(String(f.flight_id||f.callsign),f);
  const active=new Set();
  for(const f of visibleFlights){
    if(!validPos(f))continue;
    const id=String(f.flight_id||f.callsign);active.add(id);
    const selected=String(selectedFlight?.flight_id||"")===id||followingFlightId===id;
    let m=markers.get(id);if(!m)m=createPlaneMarker(f);
    updatePlane(m,f,selected);
    if(selected)updateTrail(id,f);
  }
  for(const [id,m] of markers){if(!active.has(id)){map.removeLayer(m);markers.delete(id)}}
  if(selectedFlight){
    const current=visibleFlights.find(f=>String(f.flight_id)===String(selectedFlight.flight_id));
    if(current){selectedFlight={...selectedFlight,...current};renderDetails(selectedFlight)}
  }
  if(followingFlightId){
    const f=visibleFlights.find(x=>String(x.flight_id)===followingFlightId);
    if(f&&validPos(f))map.setView([Number(f.latitude),normLon(f.longitude)],Math.max(map.getZoom(),7),{animate:false});
  }
}

function updateTrail(id,f){
  const lat=Number(f.latitude),lon=normLon(f.longitude),h=trailHistory.get(id)||[],last=h[h.length-1];
  if(!last||Math.abs(last[0]-lat)>.0001||Math.abs(last[1]-lon)>.0001){h.push([lat,lon]);if(h.length>30)h.shift();trailHistory.set(id,h)}
  const parts=[];let cur=[h[0]];
  for(let i=1;i<h.length;i++){if(Math.abs(h[i][1]-h[i-1][1])>180){if(cur.length>1)parts.push(cur);cur=[h[i]]}else cur.push(h[i])}if(cur.length>1)parts.push(cur);
  let line=trails.get(id);
  if(!line){line=L.polyline(parts,{weight:2,opacity:.38,color:"#ffd43b",interactive:false,noClip:false}).addTo(map);trails.set(id,line)}else line.setLatLngs(parts);
}

function selectFlight(f){selectedFlight=f;renderFlights()}
function followFlight(f){followingFlightId=String(f.flight_id);selectFlight(f);if(validPos(f))map.setView([Number(f.latitude),normLon(f.longitude)],8,{animate:false});loadFlightDetail(f)}
function stopFollowing(){followingFlightId=null;renderFlights()}

function renderDetails(f){
  const dest=f.destination?.identifier||f.destination?.name||"Unknown",origin=f.origin?.identifier||f.origin?.name||"Unknown";
  $("details").className="";
  $("details").innerHTML='<div class="card"><div class="aircraft">'+esc(f.callsign||"Unknown flight")+'</div>'+
    '<div class="chips"><span class="chip">'+esc(f.aircraft_type||"Unknown aircraft")+'</span><span class="chip">'+esc(f.livery_name||"Unknown livery")+'</span><span class="chip">'+esc(displayServer(selectedServer))+'</span></div>'+
    '<div class="grid">'+
    '<div><div class="label">Pilot</div><div class="value">'+esc(f.username||"—")+'</div></div>'+
    '<div><div class="label">Flight ID</div><div class="value">'+esc(f.flight_id||"—")+'</div></div>'+
    '<div><div class="label">Altitude</div><div class="value">'+num(f.altitude_ft)+' ft</div></div>'+
    '<div><div class="label">Speed</div><div class="value">'+num(f.speed_kt)+' kt</div></div>'+
    '<div><div class="label">Heading</div><div class="value">'+num(f.heading_deg)+'°</div></div>'+
    '<div><div class="label">Vertical speed</div><div class="value">'+num(f.vertical_speed_fpm)+' fpm</div></div>'+
    '<div><div class="label">Route</div><div class="value">'+esc(origin)+' → '+esc(dest)+'</div></div>'+
    '<div><div class="label">Phase</div><div class="value">'+esc(phase(f))+'</div></div>'+
    '<div class="wide"><div class="label">Position</div><div class="value">'+num(f.latitude,4)+', '+num(f.longitude,4)+'</div></div>'+
    '<div class="wide"><div class="label">Last report</div><div class="value">'+esc(f.last_report||"—")+'</div></div></div>'+
    '<div class="detail-actions"><button class="small-btn" id="followBtn">'+(followingFlightId===String(f.flight_id)?"Stop following":"Follow flight")+'</button><button class="small-btn" id="routeBtn">Show route</button><button class="small-btn" id="airportOriginBtn">'+esc(origin)+'</button><button class="small-btn" id="airportDestBtn">'+esc(dest)+'</button></div></div>';
  $("followBtn").onclick=()=>followingFlightId===String(f.flight_id)?stopFollowing():followFlight(f);
  $("routeBtn").onclick=()=>drawRoute(f);
  $("airportOriginBtn").onclick=()=>/^[A-Z0-9]{4}$/.test(origin)&&loadAirport(origin);
  $("airportDestBtn").onclick=()=>/^[A-Z0-9]{4}$/.test(dest)&&loadAirport(dest);
}

async function loadFlightDetail(f){
  selectFlight(f);renderDetails(f);
  try{
    const r=await fetch(API+"?server="+encodeURIComponent(selectedServer)+"&detail=flight&flightId="+encodeURIComponent(f.flight_id),{cache:"no-store"});
    const d=await r.json();if(r.ok&&d.flight){selectedFlight={...f,...d.flight};renderDetails(selectedFlight)}
  }catch{}
}

function drawRoute(f){
  const pts=(f.route||[]).map(p=>[Number(p.latitude),normLon(p.longitude)]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(!pts.length){setStatus("No route geometry","error");setTimeout(()=>setStatus("● Live","live"),1500);return}
  const clean=[];let seg=[pts[0]];for(let i=1;i<pts.length;i++){if(Math.abs(pts[i][1]-pts[i-1][1])>180){if(seg.length>1)clean.push(seg);seg=[pts[i]]}else seg.push(pts[i])}if(seg.length>1)clean.push(seg);
  L.layerGroup(clean.map(x=>L.polyline(x,{weight:3,opacity:.65,color:"#ffd43b"}))).addTo(map);
  map.fitBounds(L.latLngBounds(pts),{padding:[40,40],maxZoom:7,animate:false});
}

function renderWorld(){
  if(!airportsVisible||!worldData)return;
  clearWorld();
  const bounds=map.getBounds(),zoom=map.getZoom();
  const airports=(worldData.airports||[]).filter(a=>Number.isFinite(Number(a.latitude))&&Number.isFinite(Number(a.longitude)));
  for(const a of airports){
    const lat=Number(a.latitude),lon=normLon(a.longitude);
    if(!bounds.pad(.25).contains([lat,lon]))continue;
    const traffic=(Number(a.inbound_count)||0)+(Number(a.outbound_count)||0);
    if(zoom<4&&traffic===0)continue;
    const marker=L.marker([lat,lon],{icon:L.divIcon({className:"airport-label-wrap",html:'<button class="airport-label" type="button">'+esc(a.icao||"APT")+' · '+traffic+'</button>',iconSize:[80,22],iconAnchor:[40,11]})});
    marker.bindTooltip((a.name||"Airport")+" · "+(a.icao||"")+" · "+traffic+" traffic",{direction:"top"});
    marker.on("click",()=>loadAirport(a.icao));marker.addTo(map);airportMarkers.set(a.icao,marker);
  }
  if(zoom>=4){
    for(const a of worldData.atc||[]){
      const lat=Number(a.latitude),lon=normLon(a.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon)||!bounds.pad(.25).contains([lat,lon]))continue;
      const m=L.circleMarker([lat,lon],{radius:3,color:"#ffcf70",weight:1,fillColor:"#ffcf70",fillOpacity:.8});
      m.bindTooltip("ATC · "+esc(a.airport||"Center")+" · "+esc(a.username||"Unknown"),{direction:"top"}).addTo(map);
      atcMarkers.set((a.airport||"")+"|"+lat+"|"+lon,m);
    }
  }
  $("airportCount").textContent=airports.length+" airports shown · "+atcMarkers.size+" ATC";
}

async function loadWorld(){
  const r=await fetch(API+"?server="+encodeURIComponent(selectedServer)+"&detail=world",{cache:"no-store"}),d=await r.json();
  if(!r.ok)throw new Error(d.message||"Airport data unavailable");worldData=d;renderWorld();
}
function toggleAirports(){
  airportsVisible=!airportsVisible;$("airportsToggle").classList.toggle("active",airportsVisible);
  if(!airportsVisible){clearWorld();$("airportCount").textContent=" · Airports off";return}
  $("airportCount").textContent=" · Loading airports…";loadWorld().catch(e=>error(e.message));
}

async function loadAirport(icao){
  icao=String(icao||"").trim().toUpperCase();
  if(!/^[A-Z0-9]{4}$/.test(icao)){error("Use a four-character ICAO code, such as LTFM.");return}
  $("airportPanel").classList.remove("hidden");$("airportPanel").innerHTML='<div class="airport-title">'+esc(icao)+'</div><div class="muted">Loading live airport traffic…</div>';
  try{
    const r=await fetch(API+"?server="+encodeURIComponent(selectedServer)+"&detail=airport&airport="+encodeURIComponent(icao),{cache:"no-store"}),d=await r.json();
    if(!r.ok)throw new Error(d.message||"Airport unavailable");renderAirport(d);
    const lat=Number(d.airport?.latitude),lon=normLon(d.airport?.longitude);if(Number.isFinite(lat)&&Number.isFinite(lon))map.setView([lat,lon],8,{animate:false});
  }catch(e){$("airportPanel").innerHTML='<div class="error">'+esc(e.message||"Airport unavailable")+"</div>"}
}

function renderAirport(d){
  const a=d.airport||{},list=airportTab==="arrivals"?d.inbound||[]:d.outbound||[];
  $("airportPanel").innerHTML='<div class="airport-title">'+esc(a.icao||"Airport")+'</div><div class="muted">'+esc(a.name||"")+'</div><div class="tabs"><button id="arrivalsTab" class="'+(airportTab==="arrivals"?"active":"")+'">Arrivals ('+(d.inbound_count??0)+')</button><button id="departuresTab" class="'+(airportTab==="departures"?"active":"")+'">Departures ('+(d.outbound_count??0)+')</button></div>'+
    (list.map(x=>{const f=x.flight||{},other=airportTab==="arrivals"?(x.origin?.identifier||"Unknown"): (x.destination?.identifier||"Unknown");return '<div class="flight-row" data-flight="'+esc(f.flight_id||"")+'"><div class="flight-main"><strong>'+esc(f.callsign||"Unknown")+'</strong><span class="route-badge">'+esc(other)+'</span></div><div class="muted">'+esc(f.username||"")+" · "+esc(f.aircraft_type||"")+"</div></div>"}).join("")||'<div class="empty">No live flights returned.</div>');
  $("arrivalsTab").onclick=()=>{airportTab="arrivals";loadAirport(a.icao)};$("departuresTab").onclick=()=>{airportTab="departures";loadAirport(a.icao)};
  document.querySelectorAll(".flight-row").forEach(row=>row.onclick=()=>{const f=allFlights.find(x=>String(x.flight_id)===row.dataset.flight);if(f)loadFlightDetail(f)});
}

async function load(){
  if(loading||idlePaused)return;loading=true;setStatus("Updating…");clearError();
  try{
    const r=await fetch(API+"?server="+encodeURIComponent(selectedServer),{cache:"no-store"}),d=await r.json();
    if(!r.ok)throw new Error(d.message||d.error||("Backend HTTP "+r.status));
    if(d.simulated===true)throw new Error("Backend returned simulated data.");
    allFlights=(Array.isArray(d.flights)?d.flights:[]).map(f=>({...f,search_blob:searchBlob(f)}));
    applyFilters();
    $("updated").textContent="Updated "+new Date().toLocaleTimeString()+" · report "+(d.retrieved_at?new Date(d.retrieved_at).toLocaleTimeString():"live");
    setStatus("● Live","live");
    if(airportsVisible)loadWorld().catch(()=>{});
  }catch(e){setStatus("● Backend error","error");error(e.message||"Unknown error")}
  finally{loading=false}
}

function fitAircraft(){
  const pts=visibleFlights.filter(validPos).map(f=>[Number(f.latitude),normLon(f.longitude)]);
  if(pts.length)map.fitBounds(L.latLngBounds(pts),{padding:[35,35],maxZoom:7,animate:false});
}
function scheduleFilters(){clearTimeout(filterTimer);filterTimer=setTimeout(applyFilters,120)}

document.querySelectorAll(".server-btn").forEach(b=>b.onclick=()=>setServer(b.dataset.server));
document.querySelectorAll(".filter-chip").forEach(b=>b.onclick=()=>{filterPhase=b.dataset.phase;document.querySelectorAll(".filter-chip").forEach(x=>x.classList.toggle("active",x===b));applyFilters()});
$("search").oninput=scheduleFilters;$("search").onkeydown=e=>{if(e.key==="Enter")applyFilters()};
["aircraftFilter","liveryFilter","vaFilter","airportFilter","minAlt","maxAlt","minSpeed"].forEach(id=>$(id).oninput=scheduleFilters);
$("searchBtn").onclick=applyFilters;
$("resetBtn").onclick=()=>{["search","aircraftFilter","liveryFilter","vaFilter","airportFilter","minAlt","maxAlt","minSpeed"].forEach(id=>$(id).value="");filterPhase="all";document.querySelectorAll(".filter-chip").forEach(x=>x.classList.toggle("active",x.dataset.phase==="all"));applyFilters()};
$("fitBtn").onclick=fitAircraft;$("refreshBtn").onclick=()=>{lastInteractionAt=Date.now();load()};
$("airportsToggle").onclick=toggleAirports;
$("airportBtn").onclick=()=>{$("airportSearch").classList.toggle("hidden");if(!$("airportSearch").classList.contains("hidden")){$("airportInput").focus();$("airportInput").select()}};
$("airportGo").onclick=()=>loadAirport($("airportInput").value);$("airportInput").onkeydown=e=>{if(e.key==="Enter")loadAirport(e.target.value)};
map.on("moveend zoomend",()=>{lastInteractionAt=Date.now();if(airportsVisible)renderWorld()});
map.on("dragstart zoomstart wheel",()=>{lastInteractionAt=Date.now()});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){idlePaused=false;lastInteractionAt=Date.now();load()}});
setInterval(()=>{if(document.visibilityState!=="visible")return;if(Date.now()-lastInteractionAt>=IDLE_STOP_MS){idlePaused=true;setStatus("Paused · idle");return}load()},POLL_MS);

syncServerUI();
requestAnimationFrame(animatePlanes);
load();
