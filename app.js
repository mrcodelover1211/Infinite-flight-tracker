const API = "https://vbifkgzmczbndtawawre.supabase.co/functions/v1/flights";
const POLL_MS = 15000;
const IDLE_STOP_MS = 15 * 60 * 1000;
const SERVERS = ["casual","training","expert"];

let selectedServer = new URLSearchParams(location.search).get("server")?.toLowerCase() || "expert";
if (!SERVERS.includes(selectedServer)) selectedServer = "expert";

const map = L.map("map", {
  worldCopyJump:false,
  zoomControl:true,
  preferCanvas:true,
  maxBounds:[[-85,-180],[85,180]],
  maxBoundsViscosity:1,
  minZoom:2,
  maxZoom:12,
  inertia:false
}).setView([20,0],2);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom:19,
  noWrap:true,
  bounds:[[-85,-180],[85,180]],
  attribution:"© OpenStreetMap contributors"
}).addTo(map);

L.control.scale({imperial:true,metric:true}).addTo(map);
map.createPane("airportPane");
map.getPane("airportPane").style.zIndex="650";

const $=id=>document.getElementById(id);
const markers=new Map();
const aircraftPhotoCache=new Map();
const airportMarkers=new Map();
const atcMarkers=new Map();
const trails=new Map();
const trailHistory=new Map();
const flightById=new Map();

let allFlights=[];
let visibleFlights=[];
let selectedFlight=null;
let followingFlightId=null;
let worldData=null;
let airportsVisible=false;
let airportTab="arrivals";
let loading=false;
let idlePaused=false;
let lastInteractionAt=Date.now();
let filterTimer=null;
let animationFrame=0;
let routeLayers=[];
let activeSearchTerm="";
let listVisible=false;
const replayBuffer=new Map();
const MAX_REPLAY_POINTS=240;
let weatherLayer=null;
let densityLayers=[];
let dayNightLayer=null;
let rangeRingLayers=[];
let replayMarker=null;
let replayRoute=null;
let replayTimer=0;
let replayIndex=0;
let globeInstance=null;
let globeScriptPromise=null;
const sessionFavorites=new Set();

const settings={
  trails:true,
  labels:true,
  atc:true,
  density:false,
  daynight:false,
  rings:false,
  weather:false,
  planeSize:"normal",
  connectedOnly:false,
  callsignOnly:false
};

let activeFilters={
  phase:"all",
  aircraft:"",
  airport:"",
  minAlt:null,
  maxAlt:null,
  minSpeed:null,
  maxSpeed:null,
  minVs:null,
  maxVs:null,
  livery:"",
  va:"",
  className:""
};

let draftPhase="all";

const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v).toLocaleString(undefined,{maximumFractionDigits:d}):"—";
const normLon=v=>{let n=Number(v);if(!Number.isFinite(n))return NaN;n=((n+180)%360+360)%360-180;return n===-180?180:n};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const displayServer=s=>s.charAt(0).toUpperCase()+s.slice(1);
const validNumber=v=>Number.isFinite(Number(v));

function setStatus(t,c=""){$("status").textContent=t;$("status").className="status "+c}
function error(t){$("error").textContent=t;$("error").classList.remove("hidden")}
function clearError(){$("error").classList.add("hidden")}
function touch(){lastInteractionAt=Date.now();if(idlePaused){idlePaused=false;load()}}
function optionalNumber(id){
  const raw=$(id).value.trim();
  if(raw==="")return null;
  const value=Number(raw);
  return Number.isFinite(value)?value:NaN;
}

function syncServerUI(serverName=selectedServer){
  document.querySelectorAll(".server-btn").forEach(b=>b.classList.toggle("active",b.dataset.server===selectedServer));
  $("serverLabelMirror").textContent=displayServer(serverName || selectedServer);
  $("settingsServer").textContent=displayServer(serverName || selectedServer);
}
function updateLiveStats(){
  const onMap=visibleFlights.filter(validPos).length;
  const air=visibleFlights.filter(f=>phase(f)!=="ground").length;
  const ground=visibleFlights.length-air;
  const connected=visibleFlights.filter(f=>f.connected===true).length;
  const withCallsign=visibleFlights.filter(f=>String(f.callsign||"").trim()).length;
  $("settingsLiveCount").textContent=allFlights.length.toLocaleString();
  $("settingsMapCount").textContent=onMap.toLocaleString();
  $("statLive").textContent=allFlights.length.toLocaleString();
  $("statMap").textContent=onMap.toLocaleString();
  $("statAir").textContent=air.toLocaleString();
  $("statGround").textContent=ground.toLocaleString();
  $("statConnected").textContent=connected.toLocaleString();
  $("statCallsign").textContent=withCallsign.toLocaleString();
}

function clearMarkers(){
  for(const m of markers.values())map.removeLayer(m);
  for(const l of trails.values())map.removeLayer(l);
  markers.clear();
  trails.clear();
  trailHistory.clear();
  flightById.clear();
}
function clearWorld(){
  for(const m of airportMarkers.values())map.removeLayer(m);
  for(const m of atcMarkers.values())map.removeLayer(m);
  airportMarkers.clear();
  atcMarkers.clear();
}
function clearRoute(){
  for(const l of routeLayers)map.removeLayer(l);
  routeLayers=[];
}

function setServer(server){
  touch();
  if(!SERVERS.includes(server)||server===selectedServer)return;
  selectedServer=server;
  history.replaceState(null,"",location.pathname+"?server="+server);
  selectedFlight=null;
  followingFlightId=null;
  clearMarkers();
  clearRoute();
  worldData=null;
  clearWorld();
  airportsVisible=false;
  $("airportsToggle").classList.remove("active");
  $("airportCount").textContent=" · Airports off";
  closeAirportPanel();
  syncServerUI();
  load();
}


function aircraftClass(f){
  const raw=String(f?.aircraft_type||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  if(/\b(a300|a310|a330|a340|a350|a380|b747|b767|b777|b787|md ?11|dc ?10|il ?96|an ?124)\b/.test(raw))return"widebody";
  if(/\b(a220|a318|a319|a320|a321|b717|b727|b737|b757|md ?8|md ?9|f100|tu ?204)\b/.test(raw))return"narrowbody";
  if(/\b(crj|erj|e170|e175|e190|e195|fokker 70|fokker 100|do ?328)\b/.test(raw))return"regional";
  if(/\b(atr|dh[8c]|dash ?8|beech ?1900|king air|c208|caravan|pc ?12|pc ?6)\b/.test(raw))return"turboprop";
  if(/\b(bell|h125|h130|h135|h145|ec ?35|ec ?45|aw109|aw139|apache|black ?hawk|chinook|helicopter)\b/.test(raw))return"helicopter";
  if(/\b(f ?16|f ?18|f ?22|f ?35|f ?15|su ?[0-9]+|mig ?[0-9]+|rafale|typhoon|tornado|c ?17|c ?130|kc ?[0-9]+|military)\b/.test(raw))return"military";
  if(/\b(cessna|cirrus|piper|diamond|tbm|sr ?2[02]|pa ?[0-9]+|gulfstream|citation|learjet|phenom|pc ?24|pilatus|bonanza|mooney|glider)\b/.test(raw))return"general";
  return"other";
}
function aircraftIconSvg(kind){
  const base='<svg viewBox="0 0 32 32" aria-hidden="true">';
  if(kind==="widebody")return base+'<path d="M29 14.1 18.8 11V4.2c0-.9-.7-1.6-1.6-1.6h-2.4c-.9 0-1.6.7-1.6 1.6V11L3 14.1c-.9.3-1.5 1.1-1.5 2.1v1.1c0 .7.6 1.3 1.3 1.3h10.4v4.4l-3.2 2.3c-.6.4-.9 1-.9 1.7v.5c0 .5.5.9 1 .7l5.1-1.8 5.1 1.8c.5.2 1-.2 1-.7v-.5c0-.7-.3-1.3-.9-1.7l-3.2-2.3v-4.4h10.4c.7 0 1.3-.6 1.3-1.3v-1.1c0-1-.6-1.8-1.5-2.1Z"/><path d="M8 18.3h16v2H8z" opacity=".25"/>'+'</svg>';
  if(kind==="regional")return base+'<path d="M27 14.5 17.2 11V5c0-.8-.6-1.4-1.4-1.4h-1.6c-.8 0-1.4.6-1.4 1.4v6l-9.8 3.5c-.8.3-1.3 1-1.3 1.8v.8c0 .6.5 1.1 1.1 1.1H12v4.3l-2.8 2c-.5.3-.8.9-.8 1.4v.5c0 .4.4.7.8.6l5.8-1.7 5.8 1.7c.4.1.8-.2.8-.6v-.5c0-.6-.3-1.1-.8-1.4l-2.8-2v-4.3H27c.6 0 1.1-.5 1.1-1.1v-.8c0-.8-.5-1.5-1.1-1.8Z"/>'+'</svg>';
  if(kind==="turboprop")return base+'<path d="M27.5 14.7 17.3 11V5.2c0-.8-.6-1.4-1.4-1.4h-1.4c-.8 0-1.4.6-1.4 1.4V11L4.1 14.7c-.8.3-1.3 1-1.3 1.8v.7c0 .6.5 1 1 1h8.9v4.5l-2.5 1.8c-.5.3-.7.8-.7 1.3v.5c0 .4.4.7.8.5l4.9-1.5 4.9 1.5c.4.1.8-.1.8-.5v-.5c0-.5-.3-1-.7-1.3l-2.5-1.8v-4.5h8.9c.6 0 1-.4 1-1v-.7c0-.8-.5-1.5-1.3-1.8Z"/><circle cx="9.2" cy="15.9" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="22.8" cy="15.9" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>'+'</svg>';
  if(kind==="helicopter")return base+'<path d="M5 8h22M15.2 9.2v13.6M12 22.8h6.4M10.3 25.2h11.4M7.2 25.2h-3M24.8 25.2h3M15.2 12.2l-3.7 4.2h7.4z"/><circle cx="15.2" cy="8" r="1.7"/><path d="M15.2 19.1c-3.5 0-6.6 1.7-8.3 4.2M15.2 19.1c3.5 0 6.6 1.7 8.3 4.2"/>'+'</svg>';
  if(kind==="military")return base+'<path d="M29.4 14.7 18.2 12l-2.2-8.6h-2l-1.8 8.6L3 14.7c-.8.2-1.3.9-1.3 1.7v.9c0 .6.5 1.1 1.1 1.1h9.3l-1.1 7.1 3.9-2.2 2.1 1.9 2.1-1.9 3.9 2.2-1.1-7.1h9.3c.6 0 1.1-.5 1.1-1.1v-.9c0-.8-.5-1.5-1.3-1.7Z"/>'+'</svg>';
  if(kind==="general")return base+'<path d="M27.4 14.9 17.4 12V5.7c0-.8-.6-1.4-1.4-1.4h-2c-.8 0-1.4.6-1.4 1.4V12l-9.8 2.9c-.8.2-1.3.9-1.3 1.7v.7c0 .6.5 1.1 1.1 1.1h9.2v4l-2.6 1.8c-.4.3-.7.8-.7 1.3v.4c0 .4.4.7.8.6l4.8-1.2 4.8 1.2c.4.1.8-.2.8-.6v-.4c0-.5-.3-1-.7-1.3l-2.6-1.8v-4h9.2c.6 0 1.1-.5 1.1-1.1v-.7c0-.8-.5-1.5-1.3-1.7Z"/>'+'</svg>';
  return base+'<path d="M28 14.6 18 11.7V5c0-.8-.6-1.4-1.4-1.4h-1.8c-.8 0-1.4.6-1.4 1.4v6.7L3 14.6c-.8.2-1.4 1-1.4 1.8v.8c0 .6.5 1.1 1.1 1.1h9.7v4.1l-2.8 1.9c-.5.3-.7.8-.7 1.4v.4c0 .4.4.7.8.6l4.9-1.4 4.9 1.4c.4.1.8-.2.8-.6v-.4c0-.6-.3-1.1-.7-1.4l-2.8-1.9v-4.1h9.7c.6 0 1.1-.5 1.1-1.1v-.8c0-.8-.6-1.6-1.4-1.8Z"/>'+'</svg>';
}
function labelForFlight(f){
  const kind=aircraftClass(f), airliner=kind==="widebody"||kind==="narrowbody"||kind==="regional";
  return airliner&&String(f.livery_name||"").trim()?String(f.livery_name).trim():String(f.callsign||f.username||f.flight_id||"Flight").trim();
}
function reportEpoch(v){const n=Date.parse(String(v||""));return Number.isFinite(n)?n:null;}
function dataAgeSeconds(f){const t=reportEpoch(f?.last_report);return t==null?Infinity:Math.max(0,(Date.now()-t)/1000);}
function flightStatus(f){
  const age=dataAgeSeconds(f);
  if(!Number.isFinite(age))return"stale";
  if(age<=25&&f?.connected!==false)return"live";
  if(age<=75)return"delayed";
  return"stale";
}
function dataQualityScore(){
  const ages=visibleFlights.map(dataAgeSeconds).filter(Number.isFinite);
  if(!ages.length)return"Unknown";
  const avg=ages.reduce((a,b)=>a+b,0)/ages.length;
  return avg<=20?"Excellent":avg<=40?"Good":avg<=75?"Delayed":"Stale";
}
function haversineNmClient(lat1,lon1,lat2,lon2){
  if(![lat1,lon1,lat2,lon2].every(Number.isFinite))return Infinity;
  const r=3440.065,p1=lat1*Math.PI/180,p2=lat2*Math.PI/180;
  const dp=(lat2-lat1)*Math.PI/180,dl=shortestLonDelta(lon1,lon2)*Math.PI/180;
  const a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return r*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));
}
function nearestNeighborFlights(f,limit=8){
  const lat=Number(f?.latitude),lon=normLon(f?.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lon))return[];
  return allFlights.filter(x=>String(x.flight_id)!==String(f.flight_id)&&validPos(x))
    .map(x=>({...x,_distance_nm:haversineNmClient(lat,lon,Number(x.latitude),normLon(x.longitude))}))
    .filter(x=>Number.isFinite(x._distance_nm)&&x._distance_nm<=100)
    .sort((a,b)=>a._distance_nm-b._distance_nm).slice(0,limit);
}
function recordReplaySnapshot(f){
  const id=String(f?.flight_id||""); if(!id||!validPos(f))return;
  const t=reportEpoch(f.last_report)||Date.now(), history=replayBuffer.get(id)||[];
  if(history.some(x=>x.t===t))return;
  history.push({t,lat:Number(f.latitude),lon:normLon(f.longitude),alt:Number(f.altitude_ft),speed:Number(f.speed_kt),vs:Number(f.vertical_speed_fpm),heading:Number(f.heading_deg),track:Number(f.track_deg)});
  while(history.length>MAX_REPLAY_POINTS)history.shift();
  replayBuffer.set(id,history);
}
function addStatusBadge(f){
  const s=flightStatus(f), age=Number.isFinite(dataAgeSeconds(f))?Math.round(dataAgeSeconds(f))+"s ago":"age unknown";
  return '<span class="flight-status-badge '+s+'">'+(s==="live"?"Live":s==="delayed"?"Delayed":"Stale")+' · '+age+'</span>';
}

function validPos(f){
  const lat=Number(f.latitude),lon=normLon(f.longitude);
  return Number.isFinite(lat)&&lat>=-85&&lat<=85&&Number.isFinite(lon);
}
function shortestLonDelta(a,b){let d=b-a;if(d>180)d-=360;if(d<-180)d+=360;return d}

const planeSvg='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.5 11.1 14 8.2V3.7c0-.7-.5-1.2-1.2-1.2h-1.6c-.7 0-1.2.5-1.2 1.2v4.5l-7.5 2.9c-.6.2-1 .8-1 1.4v.7c0 .5.4.9.9.9H10v3.7l-2.4 1.5c-.4.2-.6.7-.6 1.1v.5c0 .4.4.7.8.6l4.1-1.2 4.1 1.2c.4.1.8-.2.8-.6v-.5c0-.5-.2-.9-.6-1.1L14 17.8v-3.7h7.6c.5 0 .9-.4.9-.9v-.7c0-.6-.4-1.2-1-1.4Z"/></svg>';

function planePixels(){
  return settings.planeSize==="small"?12:settings.planeSize==="large"?18:14;
}

function planePixelsForClass(kind){
  const base=settings.planeSize==="small"?12:settings.planeSize==="large"?18:14;
  const mul={widebody:1.28,narrowbody:1.16,regional:1.04,turboprop:1,helicopter:.96,military:1.05,general:.9,other:1}[kind]||1;
  return Math.round(base*mul);
}
function planeIcon(f){
  const kind=aircraftClass(f||{}),px=planePixelsForClass(kind);
  return L.divIcon({className:"",html:'<div class="aircraft-marker type-'+kind+'" style="--plane-size:'+px+'px">'+aircraftIconSvg(kind)+'</div>',iconSize:[px,px],iconAnchor:[px/2,px/2]});
}
function refreshPlaneIcons(){
  for(const [id,marker] of markers){const f=flightById.get(id);if(f)marker.setIcon(planeIcon(f));}
}
function createPlaneMarker(f){
  const id=String(f.flight_id||f.callsign||Math.random());
  const marker=L.marker([clamp(Number(f.latitude),-85,85),normLon(f.longitude)],{icon:planeIcon(f),keyboard:false,zIndexOffset:10});
  marker._id=id;
  marker._lat=Number(f.latitude);
  marker._lon=normLon(f.longitude);
  marker._targetLat=marker._lat;
  marker._targetLon=marker._lon;
  marker._heading=Number(f.heading_deg??f.track_deg??0);
  marker._targetHeading=marker._heading;
  marker._reportedAt=reportEpoch(f.last_report);
  marker.bindTooltip(labelForFlight(f),{direction:"top",sticky:true,opacity:.92});
  marker.on("click",()=>{touch();const x=flightById.get(id);if(x)loadFlightDetail(x)});
  marker.on("dblclick",e=>{touch();L.DomEvent.stopPropagation(e);const x=flightById.get(id);if(x)followFlight(x)});
  marker.addTo(map); markers.set(id,marker); return marker;
}
function updatePlane(marker,f,selected){
  if(!validPos(f))return;
  const lat=clamp(Number(f.latitude),-85,85),lon=normLon(f.longitude),now=performance.now();
  const reportAt=reportEpoch(f.last_report);
  marker._startLat=Number.isFinite(marker._lat)?marker._lat:lat;
  marker._startLon=Number.isFinite(marker._lon)?marker._lon:lon;
  marker._targetLat=lat; marker._targetLon=lon;
  const interval=reportAt&&marker._reportedAt?reportAt-marker._reportedAt:POLL_MS;
  marker._animStart=now;
  marker._animDuration=clamp(interval||POLL_MS,1200,20000);
  marker._animEnd=now+marker._animDuration;
  marker._targetHeading=Number.isFinite(Number(f.heading_deg))?Number(f.heading_deg):Number(f.track_deg)||0;
  marker._selected=selected;
  marker._reportedAt=reportAt||marker._reportedAt||null;
  marker.setIcon(planeIcon(f));
  marker.setTooltipContent(labelForFlight(f));
  const el=marker.getElement()?.querySelector(".aircraft-marker");
  if(el){el.classList.toggle("selected",selected);el.style.transform="rotate("+marker._targetHeading+"deg)";}
  recordReplaySnapshot(f);
}
function animatePlanes(now){
  for(const m of markers.values()){
    if(!Number.isFinite(m._targetLat)||!Number.isFinite(m._targetLon))continue;
    const duration=Math.max(1,m._animDuration||POLL_MS);
    const p=clamp((now-(m._animStart||now))/duration,0,1);
    const lat=(m._startLat??m._targetLat)+(m._targetLat-(m._startLat??m._targetLat))*p;
    const lon=normLon((m._startLon??m._targetLon)+shortestLonDelta(m._startLon??m._targetLon,m._targetLon)*p);
    m.setLatLng([lat,lon]); m._lat=lat; m._lon=lon;
    const el=m.getElement()?.querySelector(".aircraft-marker");
    if(el){
      const start=Number.isFinite(m._heading)?m._heading:m._targetHeading;
      const delta=((m._targetHeading-start+540)%360)-180;
      el.style.transform="rotate("+(start+delta*p)+"deg)";
    }
  }
  animationFrame=requestAnimationFrame(animatePlanes);
}

function performanceProfile(){
  const cores=Number(navigator.hardwareConcurrency||4);
  const memory=Number(navigator.deviceMemory||4);
  const phone=window.matchMedia("(max-width:600px)").matches;
  const tablet=window.matchMedia("(max-width:1100px)").matches;
  if(phone||cores<=2||memory<=2)return "low";
  if(tablet||cores<=4||memory<=4)return "medium";
  return "high";
}

function maxRenderableFlights(){
  const p=performanceProfile();
  if(selectedServer==="expert"){
    return p==="low"?350:p==="medium"?650:1200;
  }
  return p==="low"?500:p==="medium"?900:1600;
}

function phase(f){
  const alt=Number(f.altitude_ft),vs=Number(f.vertical_speed_fpm),speed=Number(f.speed_kt);
  if(speed<40||alt<1000)return"ground";
  if(vs>250)return"climb";
  if(vs<-250)return"descent";
  return"cruise";
}
function searchBlob(f){
  return[
    f.callsign,f.username,f.aircraft_type,f.livery_name,f.virtual_organization,
    f.origin?.identifier,f.destination?.identifier,f.flight_id
  ].map(x=>String(x??"").toLowerCase()).join(" ");
}

function filterFlights(){
  const term=activeSearchTerm;
  const aircraft=activeFilters.aircraft.toLowerCase();
  const airport=activeFilters.airport.toUpperCase();
  const minAlt=activeFilters.minAlt,maxAlt=activeFilters.maxAlt;
  const minSpeed=activeFilters.minSpeed,maxSpeed=activeFilters.maxSpeed;
  const minVs=activeFilters.minVs,maxVs=activeFilters.maxVs;
  const livery=activeFilters.livery.toLowerCase(),va=activeFilters.va.toLowerCase();
  return allFlights.filter(f=>{
    const alt=Number(f.altitude_ft),speed=Number(f.speed_kt),vs=Number(f.vertical_speed_fpm),ph=phase(f);
    const airportMatch=!airport ||
      String(f.origin?.identifier||"").toUpperCase()===airport ||
      String(f.destination?.identifier||"").toUpperCase()===airport;
    if(term&&!String(f.search_blob||"").includes(term))return false;
    if(aircraft&&!String(f.aircraft_type||"").toLowerCase().includes(aircraft))return false;
    if(!airportMatch)return false;
    if(Number.isFinite(minAlt)&&(!Number.isFinite(alt)||alt<minAlt))return false;
    if(Number.isFinite(maxAlt)&&(!Number.isFinite(alt)||alt>maxAlt))return false;
    if(Number.isFinite(minSpeed)&&(!Number.isFinite(speed)||speed<minSpeed))return false;
    if(Number.isFinite(maxSpeed)&&(!Number.isFinite(speed)||speed>maxSpeed))return false;
    if(Number.isFinite(minVs)&&(!Number.isFinite(vs)||vs<minVs))return false;
    if(Number.isFinite(maxVs)&&(!Number.isFinite(vs)||vs>maxVs))return false;
    if(livery&&!String(f.livery_name||"").toLowerCase().includes(livery))return false;
    if(va&&!String(f.virtual_organization||"").toLowerCase().includes(va))return false;
    if(activeFilters.className&&aircraftClass(f)!==activeFilters.className)return false;
    if(activeFilters.phase==="air"&&ph==="ground")return false;
    if(activeFilters.phase==="ground"&&ph!=="ground")return false;
    if(settings.connectedOnly&&f.connected!==true)return false;
    if(settings.callsignOnly&&!String(f.callsign||"").trim())return false;
    return true;
  });
}

function applyFilters(){
  visibleFlights=filterFlights();
  renderFlights();
  updateLiveStats();
}

function renderTrafficList(){
  const box=$("trafficList");
  if(!listVisible){
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");

  const rows=visibleFlights
    .filter(validPos)
    .slice()
    .sort((a,b)=>String(a.callsign||a.username||"").localeCompare(String(b.callsign||b.username||"")))
    .slice(0,40);

  $("listSummary").textContent=visibleFlights.length.toLocaleString()+" matches";
  $("flightRows").innerHTML=rows.map(f=>{
    const origin=f.origin?.identifier||"----";
    const destination=f.destination?.identifier||"----";
    return '<div class="flight-row" data-flight="'+esc(f.flight_id||"")+'">'+
      '<div class="flight-main"><strong>'+esc(f.callsign||f.username||"Unknown")+'</strong><span>'+num(f.altitude_ft)+' ft</span></div>'+
      '<div class="flight-route">'+esc(origin)+' → '+esc(destination)+'</div>'+
      '<div class="flight-meta">'+esc(f.aircraft_type||"Unknown plane")+' · '+num(f.speed_kt)+' kt</div>'+
    '</div>';
  }).join("")||'<div class="empty">No matching flights.</div>';

  document.querySelectorAll("#flightRows .flight-row").forEach(row=>{
    row.onclick=()=>{
      touch();
      const f=visibleFlights.find(x=>String(x.flight_id)===row.dataset.flight);
      if(f)loadFlightDetail(f);
    };
  });
}

function renderFlights(){
  const validCount=visibleFlights.filter(validPos).length;
  const filterState=activeSearchTerm||activeFilters.aircraft||activeFilters.airport||activeFilters.phase!=="all"||activeFilters.minAlt!==null||activeFilters.maxAlt!==null||settings.connectedOnly||settings.callsignOnly;
  const mapRenderLimit=maxRenderableFlights();
  $("summary").textContent=allFlights.length.toLocaleString()+" live · "+visibleFlights.length.toLocaleString()+" shown · "+Math.min(validCount,mapRenderLimit).toLocaleString()+" on map"+(validCount>mapRenderLimit?" · performance mode":"")+(filterState?" · filtered":"");
  $("serverCounts").textContent=allFlights.length.toLocaleString();
  const perf=selectedServer==="expert"&&performanceProfile()!=="high";
  $("searchHint").textContent=perf
    ?"Expert performance mode: showing the most important live aircraft to keep weaker devices smooth."
    :$("searchHint").textContent;

  flightById.clear();
  for(const f of visibleFlights)flightById.set(String(f.flight_id||f.callsign),f);

  const active=new Set();
  const renderLimit=maxRenderableFlights();
  const candidates=visibleFlights
    .filter(validPos)
    .slice()
    .sort((x,y)=>{
      const xs=(String(x.flight_id)===String(selectedFlight?.flight_id)||String(x.flight_id)===String(followingFlightId))?1:0;
      const ys=(String(y.flight_id)===String(selectedFlight?.flight_id)||String(y.flight_id)===String(followingFlightId))?1:0;
      return ys-xs;
    })
    .slice(0,renderLimit);

  for(const f of candidates){
    if(!validPos(f))continue;
    const id=String(f.flight_id||f.callsign);
    active.add(id);
    const selected=String(selectedFlight?.flight_id||"")===id||followingFlightId===id;
    let marker=markers.get(id);
    if(!marker)marker=createPlaneMarker(f);
    updatePlane(marker,f,selected);
    if(settings.trails&&selected)updateTrail(id,f,true);
  }

  for(const [id,m] of markers){
    if(!active.has(id)){
      map.removeLayer(m);
      markers.delete(id);
      const trail=trails.get(id);
      if(trail)map.removeLayer(trail);
      trails.delete(id);
      trailHistory.delete(id);
    }
  }

  const performanceMode=selectedServer==="expert"&&performanceProfile()!=="high";
  if(performanceMode){
    for(const l of trails.values())map.removeLayer(l);
    trails.clear();
  }else if(!settings.trails){
    for(const l of trails.values())map.removeLayer(l);
  }

  if(selectedFlight){
    const current=visibleFlights.find(f=>String(f.flight_id)===String(selectedFlight.flight_id));
    if(current){
      selectedFlight={...selectedFlight,...current};
      renderDetails(selectedFlight);
    }
  }

  if(followingFlightId){
    const f=visibleFlights.find(x=>String(x.flight_id)===followingFlightId);
    if(f&&validPos(f))map.setView([Number(f.latitude),normLon(f.longitude)],Math.max(map.getZoom(),7),{animate:false});
  }

  renderTrafficList();
}

function updateTrail(id,f,selected){
  const lat=Number(f.latitude),lon=normLon(f.longitude),h=trailHistory.get(id)||[],last=h[h.length-1];
  if(!last||Math.abs(last[0]-lat)>.0001||Math.abs(last[1]-lon)>.0001){
    h.push([lat,lon]);
    if(h.length>30)h.shift();
    trailHistory.set(id,h);
  }

  const parts=[];
  let cur=[h[0]];
  for(let i=1;i<h.length;i++){
    if(Math.abs(h[i][1]-h[i-1][1])>180){
      if(cur.length>1)parts.push(cur);
      cur=[h[i]];
    }else cur.push(h[i]);
  }
  if(cur.length>1)parts.push(cur);

  let line=trails.get(id);
  if(!line){
    line=L.polyline(parts,{weight:selected?2.5:1.6,opacity:selected?.72:.28,color:selected?"#ffd43b":"#8ea3b8",interactive:false,noClip:false}).addTo(map);
    trails.set(id,line);
  }else { line.setLatLngs(parts); line.setStyle({weight:selected?2.5:1.6,opacity:selected?.72:.28,color:selected?"#ffd43b":"#8ea3b8"}); }
}

function selectFlight(f){
  const oldId=String(selectedFlight?.flight_id||"");
  const newId=String(f?.flight_id||"");
  if(oldId&&oldId!==newId){
    const oldTrail=trails.get(oldId);
    if(oldTrail)map.removeLayer(oldTrail);
    trails.delete(oldId);
    trailHistory.delete(oldId);
  }
  selectedFlight=f;
  renderFlights();
}

function focusFlight(f){
  touch();
  if(!validPos(f))return;
  selectFlight(f);
  map.setView([Number(f.latitude),normLon(f.longitude)],Math.max(map.getZoom(),8),{animate:false});
  loadFlightDetail(f);
}

function followFlight(f){
  followingFlightId=String(f.flight_id);
  focusFlight(f);
}

function stopFollowing(){
  followingFlightId=null;
  renderFlights();
}

function renderDetails(f){
  const dest=f.destination?.identifier||f.destination?.name||"Unknown";
  const origin=f.origin?.identifier||f.origin?.name||"Unknown";
  $("details").className="";
  $("details").innerHTML='<div class="card">'+
    '<div class="aircraft">'+esc(f.callsign||"Unknown flight")+'</div>'+
    '<div id="aircraftPhoto" class="aircraft-photo"><div class="aircraft-photo-loading">Loading aircraft photo…</div></div>'+
    '<div class="chips"><span class="chip">'+esc(f.aircraft_type||"Unknown plane")+'</span><span class="chip">'+esc(f.livery_name||"Livery unavailable")+'</span><span class="chip">'+esc(displayServer(selectedServer))+'</span></div>'+
    '<div class="grid">'+
    '<div><div class="label">Pilot</div><div class="value">'+esc(f.username||"—")+'</div></div>'+
    '<div><div class="label">Flight ID</div><div class="value">'+esc(f.flight_id||"—")+'</div></div>'+
    '<div><div class="label">Height</div><div class="value">'+num(f.altitude_ft)+' ft</div></div>'+
    '<div><div class="label">Speed</div><div class="value">'+num(f.speed_kt)+' kt</div></div>'+
    '<div><div class="label">Heading</div><div class="value">'+num(f.heading_deg)+'°</div></div>'+
    '<div><div class="label">Vertical speed</div><div class="value">'+num(f.vertical_speed_fpm)+' fpm</div></div>'+
    '<div><div class="label">Route</div><div class="value">'+esc(origin)+' → '+esc(dest)+'</div></div>'+
    '<div><div class="label">Phase</div><div class="value">'+esc(phase(f))+'</div></div>'+
    '<div class="wide"><div class="label">Position</div><div class="value">'+num(f.latitude,4)+', '+num(f.longitude,4)+'</div></div>'+
    '<div class="wide"><div class="label">Last report</div><div class="value">'+esc(f.last_report||"—")+'</div></div>'+
    '</div>'+
    '<div class="detail-actions">'+
      '<button class="small-btn" id="followBtn">'+(followingFlightId===String(f.flight_id)?"Stop following":"Follow")+'</button>'+
      '<button class="small-btn" id="routeBtn">Route</button>'+
      '<button class="small-btn" id="shareBtn">Share</button>'+
      '<button class="small-btn" id="airportOriginBtn">'+esc(origin)+'</button>'+
      '<button class="small-btn" id="airportDestBtn">'+esc(dest)+'</button>'+
    '</div>'+
  '</div>';

  $("followBtn").onclick=()=>{touch();followingFlightId===String(f.flight_id)?stopFollowing():followFlight(f)};
  $("routeBtn").onclick=()=>{touch();drawRoute(f)};
  $("shareBtn").onclick=()=>shareFlight(f);
  $("airportOriginBtn").onclick=()=>{touch();/^[A-Z0-9]{4}$/.test(origin)&&loadAirport(origin)};
  $("airportDestBtn").onclick=()=>{touch();/^[A-Z0-9]{4}$/.test(dest)&&loadAirport(dest)};
  loadAircraftPhoto(f);
}

async function loadAircraftPhoto(f){
  const box=$("aircraftPhoto");
  if(!box)return;
  const aircraft=String(f.aircraft_type||"aircraft").trim();
  const livery=String(f.livery_name||"").trim();
  const key=(aircraft+"|"+livery).toLowerCase();
  if(aircraftPhotoCache.has(key)){
    renderAircraftPhoto(box,aircraftPhotoCache.get(key));
    return;
  }

  // Wikipedia search results can contain people, accidents, and other
  // unrelated pages. Only accept pages whose description clearly refers
  // to an aircraft/airliner/aviation subject and whose title is relevant.
  const aircraftNorm=aircraft.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const aircraftTokens=aircraftNorm.split(/\s+/).filter(t=>t.length>=2);
  const liveryNorm=livery.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const modelMatch=aircraft.match(/(?:A\d{3}|B\d{3}|(?:737|747|757|767|777|787)(?:-?\d{2,4})?)/i);
  const modelNorm=String(modelMatch?.[0]||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

  const queries=[...new Set([
    [livery,aircraft].filter(Boolean).join(" "),
    aircraft,
    aircraft+" aircraft",
    aircraft+" airliner"
  ].filter(Boolean))];

  try{
    let candidates=[];
    for(const query of queries){
      const url="https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch="+
        encodeURIComponent(query)+
        "&gsrlimit=10&prop=pageimages|pageterms|info&inprop=url&piprop=thumbnail&pilimit=10&pithumbsize=700&wbptterms=description&format=json&origin=*";
      const r=await fetch(url,{cache:"force-cache"});
      const d=await r.json();
      candidates.push(...Object.values(d.query?.pages||{}));
      if(candidates.length>=10)break;
    }

    const aircraftWords=/\b(aircraft|airliner|airplane|aeroplane|aviation|jet|helicopter|airliner)\b/i;
    const humanWords=/\b(person|politician|actor|actress|pilot|terrorist|militant|criminal|footballer|singer|writer|president|minister|general)\b/i;

    const scored=candidates
      .filter(p=>p?.thumbnail?.source)
      .map(p=>{
        const title=String(p.title||"");
        const description=String(p.terms?.description?.[0]||"");
        const text=(title+" "+description).toLowerCase();
        const titleNorm=text.replace(/[^a-z0-9]+/g," ");
        let score=0;

        if(aircraftWords.test(description))score+=8;
        if(humanWords.test(description))score-=20;
        if(aircraftTokens.some(t=>titleNorm.includes(t)))score+=3;
        if(aircraftNorm&&titleNorm.includes(aircraftNorm))score+=10;
        if(modelNorm&&titleNorm.includes(modelNorm))score+=7;
        if(liveryNorm&&titleNorm.includes(liveryNorm))score+=5;
        if(/\b(747|737|777|787|a3[0-9]{2}|a220|a330|a340|a350|a380|md[- ]?11|md[- ]?80|crj|embraer|e170|e175|e190|e195|atr|dash|concorde)\b/i.test(text))score+=4;

        return {p,score,description};
      })
      .filter(x=>x.score>=7 && !humanWords.test(x.description))
      .sort((a,b)=>b.score-a.score);

    const best=scored[0]?.p;
    const photo=best?{
      src:best.thumbnail.source,
      title:best.title||aircraft,
      url:best.fullurl||("https://en.wikipedia.org/wiki/"+encodeURIComponent(best.title||""))
    }:null;

    aircraftPhotoCache.set(key,photo);
    renderAircraftPhoto(box,photo);
  }catch{
    try{
      const fallbackUrl="https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch="+
        encodeURIComponent(aircraft+" aircraft")+
        "&gsrlimit=8&prop=imageinfo|info&iiprop=url&iiurlwidth=900&format=json&origin=*";
      const rr=await fetch(fallbackUrl,{cache:"no-store"});
      const dd=await rr.json();
      const pages=Object.values(dd.query?.pages||{});
      const best=pages.find(p=>p?.imageinfo?.[0]?.thumburl||p?.imageinfo?.[0]?.url);
      const info=best?.imageinfo?.[0];
      const photo=best&&info?{src:info.thumburl||info.url,title:best.title||aircraft,url:info.descriptionurl||info.url}:null;
      aircraftPhotoCache.set(key,photo);
      renderAircraftPhoto(box,photo);
    }catch{
      aircraftPhotoCache.set(key,null);
      renderAircraftPhoto(box,null);
    }
  }
}

function renderAircraftPhoto(box,photo){
  if(!box)return;
  if(!photo){
    box.innerHTML='<div class="aircraft-photo-empty">No aircraft photo found.</div>';
    return;
  }
  box.innerHTML='<img src="'+esc(photo.src)+'" alt="'+esc(photo.title)+'" loading="lazy" referrerpolicy="no-referrer"><div class="aircraft-photo-credit">Photo: <a href="'+esc(photo.url)+'" target="_blank" rel="noopener noreferrer">'+esc(photo.title)+'</a></div>';
}

async function shareFlight(f){
  touch();
  const u=new URL(location.href);
  u.searchParams.set("server",selectedServer);
  u.searchParams.set("flight",String(f.flight_id||""));
  try{
    await navigator.clipboard.writeText(u.toString());
    setStatus("Link copied","live");
    setTimeout(()=>setStatus("● Live","live"),1200);
  }catch{
    error("Copy is not available in this browser.");
  }
}

async function loadFlightDetail(f){
  selectFlight(f);
  renderDetails(f);
  try{
    const r=await fetch(API+"?server="+encodeURIComponent(selectedServer)+"&detail=flight&flightId="+encodeURIComponent(f.flight_id),{cache:"no-store"});
    const d=await r.json();
    if(r.ok&&d.flight){
      selectedFlight={...f,...d.flight};
      renderDetails(selectedFlight);
    }
  }catch{}
}

function drawRoute(f){
  clearRoute();
  const pts=(f.route||[])
    .map(p=>[Number(p.latitude),normLon(p.longitude)])
    .filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(!pts.length){
    error("No route is available for this flight.");
    return;
  }
  const clean=[];
  let seg=[pts[0]];
  for(let i=1;i<pts.length;i++){
    if(Math.abs(pts[i][1]-pts[i-1][1])>180){
      if(seg.length>1)clean.push(seg);
      seg=[pts[i]];
    }else seg.push(pts[i]);
  }
  if(seg.length>1)clean.push(seg);
  for(const part of clean)routeLayers.push(L.polyline(part,{weight:3,opacity:.65,color:"#ffd43b"}).addTo(map));
  map.fitBounds(L.latLngBounds(pts),{padding:[40,40],maxZoom:7,animate:false});
}

function airportIconForZoom(a){
  const z=map.getZoom();
  const icao=esc(a.icao||"");
  if(z>=6){
    return L.divIcon({
      className:"airport-icao-marker",
      html:'<div>'+icao+'</div>',
      iconSize:[46,18],
      iconAnchor:[23,9],
      pane:"airportPane"
    });
  }
  return L.divIcon({
    className:"airport-departure-marker",
    html:'<div aria-label="Airport"><svg viewBox="0 0 24 24"><path d="M21 11.5l-7.2-2.2L11 3.5 9.2 3l.9 6.3-5.3-1.6-2-2.1-1.2.4 1.5 3.4-1.5 3.4 1.2.4 2-2.1 5.3-1.6-.9 6.3 1.8-.5 2.8-5.8L21 12.5z"/></svg></div>',
    iconSize:[24,24],
    iconAnchor:[12,12],
    pane:"airportPane"
  });
}

function renderWorld(){
  if(!airportsVisible||!worldData)return;
  clearWorld();

  const zoom=map.getZoom();
  const bounds=map.getBounds().pad(0.25);
  let airports=(worldData.airports||[]).filter(a=>{
    const lat=Number(a.latitude),lon=normLon(a.longitude);
    return Number.isFinite(lat)&&Number.isFinite(lon)&&bounds.contains([lat,lon]);
  });

  // Never flood the map with every airport at world zoom. Thin the global
  // airport set into a geographic grid so markers stay useful and separated.
  if(zoom<6){
    const maxMarkers=zoom<3?120:zoom<4?220:zoom<5?400:700;
    if(airports.length>maxMarkers){
      const cellSize=zoom<3?12:zoom<4?7:zoom<5?4:2;
      const cells=new Map();
      airports.sort((x,y)=>{
        const xt=(Number(x.inbound_count)||0)+(Number(x.outbound_count)||0);
        const yt=(Number(y.inbound_count)||0)+(Number(y.outbound_count)||0);
        return yt-xt;
      });
      const selected=[];
      for(const a of airports){
        const lat=Number(a.latitude),lon=normLon(a.longitude);
        const key=Math.floor((lat+90)/cellSize)+":"+Math.floor((lon+180)/cellSize);
        if(cells.has(key))continue;
        cells.set(key,true);
        selected.push(a);
        if(selected.length>=maxMarkers)break;
      }
      airports=selected;
    }
  }

  for(const a of airports){
    const lat=Number(a.latitude),lon=normLon(a.longitude);
    const marker=L.marker([lat,lon],{
      icon:airportIconForZoom(a),
      keyboard:false,
      zIndexOffset:1000,
      pane:"airportPane",
      interactive:true
    });

    const traffic=(Number(a.inbound_count)||0)+(Number(a.outbound_count)||0);
    marker.bindTooltip(
      (a.name||"Airport")+" · "+(a.icao||"")+ (settings.labels?" · "+traffic+" flights":""),
      {direction:"top"}
    );
    marker.on("click",()=>{
      touch();
      map.setView([lat,lon],Math.max(map.getZoom(),8),{animate:true});
      loadAirport(a.icao);
    });
    marker.addTo(map);
    airportMarkers.set(a.icao,marker);
  }

  if(settings.atc&&map.getZoom()>=4){
    for(const a of worldData.atc||[]){
      const lat=Number(a.latitude),lon=normLon(a.longitude);
      if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
      const m=L.circleMarker([lat,lon],{radius:3,color:"#ffcf70",weight:1,fillColor:"#ffcf70",fillOpacity:.8});
      m.bindTooltip("ATC · "+esc(a.airport||"Center")+" · "+esc(a.username||"Unknown"),{direction:"top"}).addTo(map);
      atcMarkers.set((a.airport||"")+"|"+lat+"|"+lon,m);
    }
  }

  $("airportCount").textContent=airports.length+" airports · "+atcMarkers.size+" ATC";
}

async function loadWorld(){
  const r=await fetch(API+"?server="+encodeURIComponent(selectedServer)+"&detail=world",{cache:"no-store"});
  const d=await r.json();
  if(!r.ok)throw new Error(d.message||"Airport data unavailable");
  worldData=d;
  renderWorld();
}

function toggleAirports(force){
  touch();
  airportsVisible=typeof force==="boolean"?force:!airportsVisible;
  $("airportsToggle").classList.toggle("active",airportsVisible);
  document.querySelector('[data-setting="airports"]')?.classList.toggle("active",airportsVisible);

  if(!airportsVisible){
    clearWorld();
    $("airportCount").textContent=" · Airports off";
    return;
  }

  $("airportCount").textContent=" · Loading airports…";
  loadWorld().catch(e=>error(e.message));
}

function closeAirportPanel(){
  $("airportPanel").classList.add("hidden");
  $("airportPanel").innerHTML="";
}

async function loadAirport(icao){
  icao=String(icao||"").trim().toUpperCase();
  if(!/^[A-Z0-9]{4}$/.test(icao)){
    error("Use a four-character airport code, such as LTFM.");
    return;
  }
  $("airportPanel").classList.remove("hidden");
  $("airportPanel").innerHTML='<div class="airport-title">'+esc(icao)+'</div><div class="muted">Loading live airport traffic…</div>';

  try{
    const r=await fetch(API+"?server="+encodeURIComponent(selectedServer)+"&detail=airport&airport="+encodeURIComponent(icao),{cache:"no-store"});
    const d=await r.json();
    if(!r.ok)throw new Error(d.message||"Airport unavailable");
    renderAirport(d);
    const lat=Number(d.airport?.latitude),lon=normLon(d.airport?.longitude);
    if(Number.isFinite(lat)&&Number.isFinite(lon))map.setView([lat,lon],8,{animate:false});
  }catch(e){
    $("airportPanel").innerHTML='<div class="error">'+esc(e.message||"Airport unavailable")+"</div>";
  }
}

function renderAirport(d){
  const a=d.airport||{};
  const list=airportTab==="arrivals"?d.inbound||[]:d.outbound||[];
  const lat=Number(a.latitude),lon=Number(a.longitude);
  $("airportPanel").innerHTML='<div class="airport-title">'+esc(a.icao||"Airport")+'</div>'+
    '<div class="muted">'+esc(a.name||"")+'</div>'+
    '<div id="airportPhoto" class="airport-photo"><div class="airport-photo-loading">Loading airport photo…</div></div>'+
    '<div class="airport-location">'+(Number.isFinite(lat)&&Number.isFinite(lon)?lat.toFixed(4)+", "+lon.toFixed(4):"Location unavailable")+'</div>'+
    '<div class="tabs"><button id="arrivalsTab" class="'+(airportTab==="arrivals"?"active":"")+'">Arrivals ('+(d.inbound_count??0)+')</button>'+
    '<button id="departuresTab" class="'+(airportTab==="departures"?"active":"")+'">Departures ('+(d.outbound_count??0)+')</button></div>'+
    (list.map(x=>{
      const f=x.flight||{};
      const other=airportTab==="arrivals"?(x.origin?.identifier||"Unknown"):(x.destination?.identifier||"Unknown");
      return '<div class="flight-row airport-flight-row" data-flight="'+esc(f.flight_id||"")+'">'+
        '<div class="airport-flight-info">'+
          '<div class="flight-main"><strong>'+esc(f.callsign||"Unknown")+'</strong><span>'+esc(other)+'</span></div>'+
          '<div class="flight-meta">'+esc(f.username||"")+" · "+esc(f.aircraft_type||"")+'</div>'+
        '</div>'+
        (airportTab==="departures"?'<div class="airport-flight-action"><button class="small-btn book-flight-btn" data-book-flight="'+esc(f.flight_id||"")+'">Book</button></div>':"")+
      '</div>';
    }).join("")||'<div class="empty">No live flights returned.</div>');

  $("arrivalsTab").onclick=()=>{touch();airportTab="arrivals";loadAirport(a.icao)};
  $("departuresTab").onclick=()=>{touch();airportTab="departures";loadAirport(a.icao)};

  document.querySelectorAll(".airport-flight-row").forEach(row=>{
    row.onclick=(e)=>{
      if(e.target.closest(".book-flight-btn"))return;
      touch();
      const f=allFlights.find(x=>String(x.flight_id)===row.dataset.flight);
      if(f)loadFlightDetail(f);
    };
  });
  document.querySelectorAll(".book-flight-btn").forEach(btn=>{
    btn.onclick=e=>{
      e.stopPropagation();
      const f=allFlights.find(x=>String(x.flight_id)===btn.dataset.bookFlight);
      if(f)openBooking(f,a);
    };
  });

  loadAirportPhoto(a);
}

const airportPhotoCache=new Map();
async function loadAirportPhoto(a){
  const box=$("airportPhoto");
  if(!box)return;
  const icao=String(a.icao||"").trim().toUpperCase();
  const name=String(a.name||"").trim();
  const key=icao+"|"+name;
  if(airportPhotoCache.has(key)){
    renderAirportPhoto(box,airportPhotoCache.get(key));
    return;
  }

  const queries=[
    [name,icao,"airport"].filter(Boolean).join(" "),
    [icao,"airport"].filter(Boolean).join(" ")
  ];
  try{
    let candidates=[];
    for(const query of queries){
      const url="https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch="+
        encodeURIComponent(query)+
        "&gsrlimit=10&prop=pageimages|pageterms|info&inprop=url&piprop=thumbnail&pilimit=10&pithumbsize=900&wbptterms=description&format=json&origin=*";
      const r=await fetch(url,{cache:"force-cache"});
      const d=await r.json();
      candidates.push(...Object.values(d.query?.pages||{}));
      if(candidates.length>=10)break;
    }

    const airportWords=/\b(airport|international airport|aerodrome|airfield|aviation)\b/i;
    const badWords=/\b(person|politician|actor|actress|terrorist|militant|criminal|footballer|singer|writer|president|minister)\b/i;
    const icaoNorm=icao.toLowerCase();
    const nameTokens=name.toLowerCase().replace(/[^a-z0-9]+/g," ").split(/\s+/).filter(x=>x.length>2);

    const scored=candidates.filter(p=>p?.thumbnail?.source).map(p=>{
      const title=String(p.title||"");
      const desc=String(p.terms?.description?.[0]||"");
      const text=(title+" "+desc).toLowerCase();
      let score=0;
      if(airportWords.test(text))score+=8;
      if(badWords.test(text))score-=30;
      if(title.toLowerCase().includes(icaoNorm))score+=10;
      for(const token of nameTokens)if(title.toLowerCase().includes(token))score+=2;
      return {p,score,desc};
    }).filter(x=>x.score>=8&&!badWords.test(x.desc)).sort((a,b)=>b.score-a.score);

    const best=scored[0]?.p;
    const photo=best?{
      src:best.thumbnail.source,
      title:best.title||name||icao,
      url:best.fullurl||("https://en.wikipedia.org/wiki/"+encodeURIComponent(best.title||""))
    }:null;
    airportPhotoCache.set(key,photo);
    renderAirportPhoto(box,photo);
  }catch{
    try{
      const fallbackUrl="https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch="+
        encodeURIComponent((name||icao)+" airport")+
        "&gsrlimit=8&prop=imageinfo|info&iiprop=url&iiurlwidth=900&format=json&origin=*";
      const rr=await fetch(fallbackUrl,{cache:"no-store"});
      const dd=await rr.json();
      const pages=Object.values(dd.query?.pages||{});
      const valid=pages.find(p=>{
        const title=String(p?.title||"").toLowerCase();
        const info=p?.imageinfo?.[0];
        return info&&(title.includes(icao.toLowerCase())||title.includes("airport")||title.includes("aerodrome"));
      });
      const info=valid?.imageinfo?.[0];
      const photo=valid&&info?{src:info.thumburl||info.url,title:valid.title||name||icao,url:info.descriptionurl||info.url}:null;
      airportPhotoCache.set(key,photo);
      renderAirportPhoto(box,photo);
    }catch{
      airportPhotoCache.set(key,null);
      renderAirportPhoto(box,null);
    }
  }
}

function renderAirportPhoto(box,photo){
  if(photo){
    box.innerHTML='<img src="'+esc(photo.src)+'" alt="'+esc(photo.title)+'"><div class="airport-photo-credit">Photo: <a href="'+esc(photo.url)+'" target="_blank" rel="noopener">'+esc(photo.title)+'</a></div>';
  }else{
    box.innerHTML='<div class="airport-photo-empty">No airport photo found.</div>';
  }
}


function openBooking(f,airport){
  const overlay=$("bookingOverlay");
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden","false");
  const origin=f.origin?.identifier||airport?.icao||"----";
  const dest=f.destination?.identifier||"----";
  const existingName=localStorage.getItem("ift_passenger_name")||"";
  const saved=JSON.parse(localStorage.getItem("ift_booking_options")||"{}");
  $("bookingContent").innerHTML=
    '<div class="booking-card">'+
      '<div class="booking-route"><strong>'+esc(origin)+'</strong><span>→</span><strong>'+esc(dest)+'</strong></div>'+
      '<div class="muted booking-flight-summary">'+esc(f.callsign||"Flight")+" · "+esc(f.aircraft_type||"Aircraft")+'</div>'+
      '<label class="booking-label">Passenger approved name<input id="passengerName" maxlength="40" value="'+esc(existingName)+'" placeholder="Enter passenger name"></label>'+
      '<div class="booking-options-title">Booking options</div>'+
      '<div class="booking-options-grid">'+
        '<label class="booking-label">Cabin<select id="bookingCabin"><option value="Economy">Economy</option><option value="Premium Economy">Premium Economy</option><option value="Business">Business</option><option value="First">First</option></select></label>'+
        '<label class="booking-label">Seat preference<select id="bookingSeatPref"><option value="Any">Any seat</option><option value="Window">Window</option><option value="Aisle">Aisle</option><option value="Middle">Middle</option></select></label>'+
        '<label class="booking-label">Baggage<select id="bookingBaggage"><option value="Carry-on only">Carry-on only</option><option value="1 checked bag">1 checked bag</option><option value="2 checked bags">2 checked bags</option></select></label>'+
        '<label class="booking-label">Meal<select id="bookingMeal"><option value="Standard">Standard</option><option value="Vegetarian">Vegetarian</option><option value="Halal">Halal</option><option value="No meal">No meal</option></select></label>'+
      '</div>'+
      '<label class="booking-check"><input id="bookingPriority" type="checkbox"> Priority boarding</label>'+
      '<label class="booking-check"><input id="bookingWindow" type="checkbox"> Window seat request</label>'+
      '<button class="primary-btn" id="confirmBookingBtn">Confirm booking</button>'+
      '<div class="muted booking-note">This creates a tracker ticket only. It is not an Infinite Flight or real-world airline reservation.</div>'+
    '</div>';
  $("bookingCabin").value=saved.cabin||"Economy";
  $("bookingSeatPref").value=saved.seatPref||"Any";
  $("bookingBaggage").value=saved.baggage||"Carry-on only";
  $("bookingMeal").value=saved.meal||"Standard";
  $("bookingPriority").checked=Boolean(saved.priority);
  $("bookingWindow").checked=Boolean(saved.window);
  $("confirmBookingBtn").onclick=()=>confirmBooking(f,airport);
}

function closeBooking(){
  $("bookingOverlay").classList.add("hidden");
  $("bookingOverlay").setAttribute("aria-hidden","true");
}

function closeTicket(){
  $("ticketOverlay").classList.add("hidden");
  $("ticketOverlay").setAttribute("aria-hidden","true");
}

function makeBookingCode(){
  return "IFT-"+Math.random().toString(36).slice(2,8).toUpperCase();
}

function confirmBooking(f,airport){
  const name=$("passengerName").value.trim();
  if(!name){$("passengerName").focus();return;}
  localStorage.setItem("ift_passenger_name",name);
  const options={
    cabin:$("bookingCabin")?.value||"Economy",
    seatPref:$("bookingSeatPref")?.value||"Any",
    baggage:$("bookingBaggage")?.value||"Carry-on only",
    meal:$("bookingMeal")?.value||"Standard",
    priority:Boolean($("bookingPriority")?.checked),
    window:Boolean($("bookingWindow")?.checked)
  };
  localStorage.setItem("ift_booking_options",JSON.stringify(options));

  const aircraft=String(f.aircraft_type||"Aircraft");
  const flightId=String(f.flight_id||"");
  const seed=[...flightId].reduce((n,ch)=>n+ch.charCodeAt(0),0);
  const seat=(seed%30+1)+String.fromCharCode(65+(seed%6));
  const gate="G"+String(seed%48+1).padStart(2,"0");
  const depTime=new Date(Date.now()+Math.max(15,Math.min(180,Number(f.eta_minutes)||60))*60000);
  const ticket={
    code:makeBookingCode(),
    name,
    callsign:f.callsign||"Flight",
    aircraft,
    origin:f.origin?.identifier||airport?.icao||"----",
    destination:f.destination?.identifier||"----",
    seat,gate,
    time:depTime.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}),
    date:depTime.toLocaleDateString(),
    flightId,
    ...options
  };
  localStorage.setItem("ift_ticket",JSON.stringify(ticket));
  closeBooking();
  renderTicket(ticket);
}

function renderTicket(ticket){
  const overlay=$("ticketOverlay");
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden","false");
  const qrData=new URL(location.href);
  qrData.search="";
  qrData.hash="ticket="+encodeURIComponent(ticket.code)+
    "&name="+encodeURIComponent(ticket.name)+
    "&flight="+encodeURIComponent(ticket.callsign)+
    "&route="+encodeURIComponent(ticket.origin+" → "+ticket.destination)+
    "&seat="+encodeURIComponent(ticket.seat)+
    "&gate="+encodeURIComponent(ticket.gate)+
    "&time="+encodeURIComponent(ticket.time);
  const qr="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data="+encodeURIComponent(qrData.toString());
  $("ticketContent").innerHTML=
    '<div class="ticket">'+
      '<div class="ticket-top"><span>INFINITE FLIGHT TRACKER</span><strong>BOARDING TICKET</strong></div>'+
      '<div class="ticket-route"><div><small>FROM</small><b>'+esc(ticket.origin)+'</b></div><span>✈</span><div><small>TO</small><b>'+esc(ticket.destination)+'</b></div></div>'+
      '<div class="ticket-grid">'+
        '<div><small>PASSENGER</small><b>'+esc(ticket.name)+'</b></div>'+
        '<div><small>FLIGHT</small><b>'+esc(ticket.callsign)+'</b></div>'+
        '<div><small>DATE</small><b>'+esc(ticket.date)+'</b></div>'+
        '<div><small>TIME</small><b>'+esc(ticket.time)+'</b></div>'+
        '<div><small>GATE</small><b>'+esc(ticket.gate)+'</b></div>'+
        '<div><small>SEAT</small><b>'+esc(ticket.seat)+'</b></div>'+
        '<div><small>CABIN</small><b>'+esc(ticket.cabin||"Economy")+'</b></div>'+
        '<div><small>BAGGAGE</small><b>'+esc(ticket.baggage||"Carry-on only")+'</b></div>'+
        '<div><small>MEAL</small><b>'+esc(ticket.meal||"Standard")+'</b></div>'+
        '<div><small>BOARDING</small><b>'+esc(ticket.priority?"Priority":"Standard")+'</b></div>'+
      '</div>'+
      '<div class="ticket-bottom"><div><small>BOOKING</small><b>'+esc(ticket.code)+'</b><small>APPROVED PASSENGER: '+esc(ticket.name)+'</small></div>'+
      '<img class="ticket-qr" src="'+esc(qr)+'" alt="Ticket QR code"></div>'+
      '<div class="ticket-note">QR opens this tracker with the approved passenger and booking reference.</div>'+
    '</div>';
}


async function load(){
  if(loading||idlePaused)return;
  loading=true;
  setStatus("Updating…");
  clearError();

  try{
    const r=await fetch(API+"?server="+encodeURIComponent(selectedServer),{cache:"no-store"});
    const d=await r.json();
    if(!r.ok)throw new Error(d.message||d.error||("Backend HTTP "+r.status));
    if(d.simulated===true)throw new Error("Backend returned simulated data.");

    allFlights=(Array.isArray(d.flights)?d.flights:[]).map(f=>({...f,search_blob:searchBlob(f)}));
    if(d.session?.name){
      syncServerUI(String(d.session.name).toLowerCase());
    }else{
      syncServerUI();
    }

    applyFilters();

    $("updated").textContent="Updated "+new Date().toLocaleTimeString()+" · report "+(d.retrieved_at?new Date(d.retrieved_at).toLocaleTimeString():"live");
    setStatus("● Live","live");

    if(airportsVisible)loadWorld().catch(()=>{});

    const sharedFlight=new URLSearchParams(location.search).get("flight");
    if(sharedFlight&&(!selectedFlight||String(selectedFlight.flight_id)!==sharedFlight)){
      const f=allFlights.find(x=>String(x.flight_id)===sharedFlight);
      if(f)focusFlight(f);
    }
  }catch(e){
    setStatus("● Backend error","error");
    error(e.message||"Unknown error");
  }finally{
    loading=false;
  }
}

function fitAircraft(){
  touch();
  const pts=visibleFlights.filter(validPos).map(f=>[Number(f.latitude),normLon(f.longitude)]);
  if(pts.length){
    map.fitBounds(L.latLngBounds(pts),{padding:[35,35],maxZoom:7,animate:false});
  }else{
    error("There are no aircraft with a map position to fit.");
  }
}

function worldView(){
  touch();
  followingFlightId=null;
  map.setView([20,0],2,{animate:false});
}

function randomFlight(){
  touch();
  const choices=visibleFlights.filter(validPos);
  if(!choices.length){
    error("No live aircraft are available right now.");
    return;
  }
  focusFlight(choices[Math.floor(Math.random()*choices.length)]);
}

function runSearch(){
  touch();
  activeSearchTerm=$("search").value.trim().toLowerCase();
  applyFilters();

  if(!activeSearchTerm){
    $("searchHint").textContent="Search is off. All live flights are shown.";
    return;
  }

  const match=visibleFlights.filter(validPos)[0];
  if(match){
    $("searchHint").textContent=visibleFlights.length.toLocaleString()+" match"+(visibleFlights.length===1?"":"es");
    listVisible=visibleFlights.length>1;
    $("listBtn").classList.toggle("active",listVisible);
    focusFlight(match);
  }else{
    $("searchHint").textContent="No matching flights.";
    listVisible=true;
    $("listBtn").classList.add("active");
    renderTrafficList();
  }
}

function clearSearch(){
  touch();
  $("search").value="";
  activeSearchTerm="";
  $("searchHint").textContent="Search is off. All live flights are shown.";
  applyFilters();
}

function syncDraftFilterUI(){
  document.querySelectorAll("#phasePicker button").forEach(b=>b.classList.toggle("active",b.dataset.phase===draftPhase));
  $("connectedOnly").checked=settings.connectedOnly;
  $("callsignOnly").checked=settings.callsignOnly;
  $("aircraftFilter").value=activeFilters.aircraft;
  $("airportFilter").value=activeFilters.airport;
  $("minAlt").value=activeFilters.minAlt??"";
  $("maxAlt").value=activeFilters.maxAlt??"";
  $("minSpeed").value=activeFilters.minSpeed??"";
  $("maxSpeed").value=activeFilters.maxSpeed??"";
  $("minVs").value=activeFilters.minVs??"";
  $("maxVs").value=activeFilters.maxVs??"";
  $("liveryFilter").value=activeFilters.livery??"";
  $("vaFilter").value=activeFilters.va??"";
  $("classFilter").value=activeFilters.className??"";
  draftPhase=activeFilters.phase;
  document.querySelectorAll("#phasePicker button").forEach(b=>b.classList.toggle("active",b.dataset.phase===draftPhase));
}

function applySettingsFilters(){
  touch();
  const minAlt=optionalNumber("minAlt"),maxAlt=optionalNumber("maxAlt");
  const minSpeed=optionalNumber("minSpeed"),maxSpeed=optionalNumber("maxSpeed");
  const minVs=optionalNumber("minVs"),maxVs=optionalNumber("maxVs");
  if([minAlt,maxAlt,minSpeed,maxSpeed,minVs,maxVs].some(Number.isNaN)){error("Numeric filters must use numbers.");return;}
  if(Number.isFinite(minAlt)&&Number.isFinite(maxAlt)&&minAlt>maxAlt){error("Min height cannot be higher than max height.");return;}
  if(Number.isFinite(minSpeed)&&Number.isFinite(maxSpeed)&&minSpeed>maxSpeed){error("Min speed cannot be higher than max speed.");return;}
  if(Number.isFinite(minVs)&&Number.isFinite(maxVs)&&minVs>maxVs){error("Min vertical speed cannot be higher than max vertical speed.");return;}
  activeFilters={
    phase:draftPhase,
    aircraft:$("aircraftFilter").value.trim(),
    airport:$("airportFilter").value.trim().toUpperCase(),
    minAlt,maxAlt,minSpeed,maxSpeed,minVs,maxVs,
    livery:$("liveryFilter").value.trim(),
    va:$("vaFilter").value.trim(),
    className:$("classFilter").value
  };
  settings.connectedOnly=$("connectedOnly").checked;
  settings.callsignOnly=$("callsignOnly").checked;
  applyFilters();
  closeSettings();
}

function resetFilters(){
  touch();
  activeFilters={phase:"all",aircraft:"",airport:"",minAlt:null,maxAlt:null,minSpeed:null,maxSpeed:null,minVs:null,maxVs:null,livery:"",va:"",className:""};
  settings.connectedOnly=false;
  settings.callsignOnly=false;
  draftPhase="all";
  ["aircraftFilter","airportFilter","minAlt","maxAlt","minSpeed","maxSpeed","minVs","maxVs","liveryFilter","vaFilter"].forEach(id=>$(id).value="");
  $("classFilter").value="";
  $("connectedOnly").checked=false;
  $("callsignOnly").checked=false;
  document.querySelectorAll("#phasePicker button").forEach(b=>b.classList.toggle("active",b.dataset.phase==="all"));
  clearError();
  applyFilters();
}

function setPlaneSize(size){
  if(!["small","normal","large"].includes(size))return;
  settings.planeSize=size;
  document.querySelectorAll("#planeSizePicker button").forEach(b=>b.classList.toggle("active",b.dataset.size===size));
  refreshPlaneIcons();
}

function setLabels(enabled){
  settings.labels=enabled;
  document.getElementById("map").classList.toggle("labels-hidden",!enabled);
  document.querySelector('[data-setting="labels"]')?.classList.toggle("active",enabled);
  if(airportsVisible)renderWorld();
}

function setTrails(enabled){
  settings.trails=enabled;
  document.querySelector('[data-setting="trails"]')?.classList.toggle("active",enabled);
  if(!enabled){
    for(const l of trails.values())map.removeLayer(l);
  }else{
    for(const f of visibleFlights.filter(validPos)){
      if(String(f.flight_id)===String(selectedFlight?.flight_id))updateTrail(String(f.flight_id),f,true);
    }
  }
}

function setAtc(enabled){
  settings.atc=enabled;
  document.querySelector('[data-setting="atc"]')?.classList.toggle("active",enabled);
  if(airportsVisible)renderWorld();
}

function openSettings(){
  touch();
  syncDraftFilterUI();
  $("settingsOverlay").classList.remove("hidden");
  $("settingsOverlay").setAttribute("aria-hidden","false");
}

function closeSettings(){
  $("settingsOverlay").classList.add("hidden");
  $("settingsOverlay").setAttribute("aria-hidden","true");
}

function openStats(){
  touch();
  updateLiveStats();
  $("statsOverlay").classList.remove("hidden");
  $("statsOverlay").setAttribute("aria-hidden","false");
}

function closeStats(){
  $("statsOverlay").classList.add("hidden");
  $("statsOverlay").setAttribute("aria-hidden","true");
}

async function copySelectedFlight(){
  touch();
  if(!selectedFlight){
    error("Select a flight first.");
    return;
  }
  const textValue=[
    selectedFlight.callsign||"Unknown flight",
    selectedFlight.aircraft_type||"Unknown plane",
    (selectedFlight.origin?.identifier||"----")+" → "+(selectedFlight.destination?.identifier||"----"),
    num(selectedFlight.altitude_ft)+" ft",
    num(selectedFlight.speed_kt)+" kt"
  ].join(" · ");

  try{
    await navigator.clipboard.writeText(textValue);
    setStatus("Flight copied","live");
    setTimeout(()=>setStatus("● Live","live"),1200);
  }catch{
    error("Copy is not available in this browser.");
  }
}

function toggleList(){
  touch();
  listVisible=!listVisible;
  $("listBtn").classList.toggle("active",listVisible);
  renderTrafficList();
}

function openAirportSearch(){
  touch();
  $("airportSearch").classList.toggle("hidden");
  if(!$("airportSearch").classList.contains("hidden")){
    $("airportInput").focus();
    $("airportInput").select();
  }
}

document.querySelectorAll(".server-btn").forEach(b=>b.onclick=()=>setServer(b.dataset.server));

document.querySelectorAll("#phasePicker button").forEach(b=>{
  b.onclick=()=>{
    touch();
    draftPhase=b.dataset.phase;
    document.querySelectorAll("#phasePicker button").forEach(x=>x.classList.toggle("active",x===b));
  };
});

document.querySelectorAll("[data-setting]").forEach(b=>{
  b.onclick=()=>{
    touch();
    const name=b.dataset.setting;
    const enabled=!b.classList.contains("active");
    if(name==="airports")toggleAirports(enabled);
    if(name==="trails")setTrails(enabled);
    if(name==="labels")setLabels(enabled);
    if(name==="atc")setAtc(enabled);
  };
});

document.querySelectorAll("#planeSizePicker button").forEach(b=>b.onclick=()=>{touch();setPlaneSize(b.dataset.size)});

$("searchBtn").onclick=runSearch;
$("clearSearchBtn").onclick=clearSearch;
$("search").onkeydown=e=>{if(e.key==="Enter")runSearch()};

$("listBtn").onclick=toggleList;
$("searchTopBtn").onclick=()=>{
  touch();
  listVisible=true;
  $("listBtn").classList.add("active");
  renderTrafficList();
  $("search").focus();
  $("search").select();
};
$("airportsToggle").onclick=toggleAirports;
$("airportBtn").onclick=openAirportSearch;
$("fitBtn").onclick=fitAircraft;
$("randomBtn").onclick=randomFlight;
$("worldTopBtn").onclick=worldView;
$("refreshBtn").onclick=()=>{touch();load()};
$("settingsBtn").onclick=openSettings;
$("statsBtn").onclick=openStats;

$("settingsSearchBtn").onclick=()=>{
  closeSettings();
  listVisible=true;
  $("listBtn").classList.add("active");
  renderTrafficList();
  $("search").focus();
  $("search").select();
};
$("settingsAirportBtn").onclick=()=>{closeSettings();openAirportSearch()};
$("settingsRefreshBtn").onclick=()=>{closeSettings();touch();load()};
$("settingsWorldBtn").onclick=()=>{closeSettings();worldView()};
$("settingsStatsBtn").onclick=()=>{closeSettings();openStats()};
$("settingsAirportMapBtn").onclick=()=>{
  const enabled=!airportsVisible;
  toggleAirports(enabled);
};
$("settingsLabelsBtn").onclick=()=>setLabels(!settings.labels);
$("settingsAtcBtn").onclick=()=>setAtc(!settings.atc);
$("settingsTrailsBtn").onclick=()=>setTrails(!settings.trails);
$("settingsAirportsBtn").onclick=()=>toggleAirports(!airportsVisible);

$("airportGo").onclick=()=>{touch();loadAirport($("airportInput").value)};
$("airportInput").onkeydown=e=>{if(e.key==="Enter"){touch();loadAirport(e.target.value)}};

$("applyFiltersBtn").onclick=applySettingsFilters;
$("resetBtn").onclick=resetFilters;
$("worldBtn").onclick=()=>{closeSettings();worldView()};
$("fitSettingsBtn").onclick=()=>{closeSettings();fitAircraft()};
$("randomSettingsBtn").onclick=()=>{closeSettings();randomFlight()};
$("clearSelectionBtn").onclick=()=>{touch();selectedFlight=null;followingFlightId=null;renderFlights();$("details").className="empty";$("details").textContent="Select an aircraft on the map."};
$("clearRouteBtn").onclick=()=>{touch();clearRoute()};
$("copyFlightBtn").onclick=copySelectedFlight;

$("settingsClose").onclick=closeSettings;
$("statsClose").onclick=closeStats;

$("settingsOverlay").onclick=e=>{if(e.target===$("settingsOverlay"))closeSettings()};
$("statsOverlay").onclick=e=>{if(e.target===$("statsOverlay"))closeStats()};

$("bookingClose").onclick=closeBooking;
$("ticketClose").onclick=closeTicket;
$("bookingOverlay").addEventListener("keydown",e=>{if(e.key==="Escape")closeBooking()});
$("ticketOverlay").addEventListener("keydown",e=>{if(e.key==="Escape")closeTicket()});
$("bookingOverlay").addEventListener("click",e=>{if(e.target===$("bookingOverlay"))closeBooking()});
$("ticketOverlay").addEventListener("click",e=>{if(e.target===$("ticketOverlay"))closeTicket()});

const ticketParams=new URLSearchParams(location.hash.replace(/^#/,""));
const ticketCode=ticketParams.get("ticket");
if(ticketCode){
  try{
    const saved=JSON.parse(localStorage.getItem("ift_ticket")||"null");
    if(saved&&saved.code===ticketCode){
      renderTicket(saved);
    }else{
      const name=ticketParams.get("name");
      if(name){
        renderTicket({
          code:ticketCode,
          name,
          callsign:ticketParams.get("flight")||"Flight",
          aircraft:"Aircraft",
          origin:(ticketParams.get("route")||"---- → ----").split(" → ")[0]||"----",
          destination:(ticketParams.get("route")||"---- → ----").split(" → ")[1]||"----",
          seat:ticketParams.get("seat")||"—",
          gate:ticketParams.get("gate")||"—",
          time:ticketParams.get("time")||"—",
          date:new Date().toLocaleDateString(),
          flightId:""
        });
      }
    }
  }catch{}
}

document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    closeSettings();
    closeStats();
  }
});

document.querySelectorAll("input,button").forEach(el=>{
  el.addEventListener("pointerdown",()=>{lastInteractionAt=Date.now()});
  el.addEventListener("keydown",()=>{lastInteractionAt=Date.now()});
});

map.getContainer().classList.toggle("labels-hidden",!settings.labels);

map.on("moveend zoomend",()=>{touch();if(airportsVisible)renderWorld()});
map.on("dragstart zoomstart wheel",()=>{lastInteractionAt=Date.now()});

document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"){
    idlePaused=false;
    lastInteractionAt=Date.now();
    load();
  }else{
    idlePaused=true;
  }
});

setInterval(()=>{
  if(document.visibilityState!=="visible")return;
  if(Date.now()-lastInteractionAt>=IDLE_STOP_MS){
    idlePaused=true;
    setStatus("Paused · idle");
    return;
  }
  load();
},POLL_MS);


function detectDeviceLayout(){
  const width=window.innerWidth;
  const coarse=window.matchMedia("(pointer:coarse)").matches;
  const touch=navigator.maxTouchPoints>0;
  const device=width<=600?"phone":(width<=1100&& (touch||coarse) ? "tablet" : (width<=1100?"tablet":"desktop"));
  const orientation=window.innerHeight>window.innerWidth?"portrait":"landscape";
  document.body.dataset.device=device;
  document.body.dataset.orientation=orientation;
  document.documentElement.style.setProperty("--app-width",width+"px");
  requestAnimationFrame(()=>map.invalidateSize({animate:false}));
}
let deviceResizeTimer=0;
function scheduleDeviceLayout(){
  clearTimeout(deviceResizeTimer);
  deviceResizeTimer=setTimeout(detectDeviceLayout,120);
}
window.addEventListener("resize",scheduleDeviceLayout,{passive:true});
window.addEventListener("orientationchange",scheduleDeviceLayout,{passive:true});
detectDeviceLayout();

syncServerUI();
syncDraftFilterUI();
requestAnimationFrame(animatePlanes);
load();
