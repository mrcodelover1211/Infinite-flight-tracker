const API="https://vbifkgzmczbndtawawre.supabase.co/functions/v1/flights";
const POLL_MS=15000;
const map=L.map("map",{worldCopyJump:true,zoomControl:true}).setView([20,0],2);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap contributors"}).addTo(map);
const markers=new Map();const trails=new Map();let selectedRouteLayer=null;let allFlights=[];let visibleFlights=[];let lastSelectedId=null;let loading=false;let selectedFlight=null;let selectedSeat=null;let airportTab="arrivals";
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
  visibleFlights=!term?allFlights:allFlights.filter(f=>Object.values(f).some(v=>String(v??"").toLowerCase().includes(term)));
  render(visibleFlights);
}
function render(flights){
  $("summary").textContent=flights.length.toLocaleString()+" flight"+(flights.length===1?"":"s")+" shown";
  const activeIds=new Set();
  for(const f of flights){
    const lat=Number(f.latitude),lon=Number(f.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    const id=String(f.flight_id||((f.callsign||"flight")+":"+lat+":"+lon));activeIds.add(id);
    const history=trails.get(id)||[];const last=history.at(-1);
    if(!last||Math.abs(last[0]-lat)>0.0001||Math.abs(last[1]-lon)>0.0001){history.push([lat,lon]);if(history.length>80)history.shift();trails.set(id,history);}
    let trail=trails.get(id+"_line");
    if(history.length>1){if(!trail){trail=L.polyline(history,{color:"#5d6670",weight:2,opacity:.6}).addTo(map);trails.set(id+"_line",trail)}else trail.setLatLngs(history)}
    let marker=markers.get(id);
    if(!marker){marker=L.marker([lat,lon],{icon:aircraftIcon(f.heading_deg)}).addTo(map);markers.set(id,marker)}
    else{marker.setLatLng([lat,lon]);marker.setIcon(aircraftIcon(f.heading_deg))}
    marker.bindTooltip(f.callsign||f.username||"Flight",{direction:"top"});
    marker.off("click").on("click",()=>loadFlightDetail(f));
  }
  for(const [id,marker] of markers)if(!activeIds.has(id)){map.removeLayer(marker);markers.delete(id);const trail=trails.get(id+"_line");if(trail){map.removeLayer(trail);trails.delete(id+"_line")}}
  
}
async function loadFlightDetail(f){
  selectedFlight=f;
  try{
    const r=await fetch(API+"?detail=flight&flightId="+encodeURIComponent(f.flight_id),{cache:"no-store"});
    if(!r.ok) throw new Error("Detailed route data unavailable");
    const d=await r.json();
    selectedFlight={...f,...(d.flight||{}),aircraft:d.aircraft,destination:d.destination,route:d.route||[],flight_plan:d.flight_plan};
  }catch{selectedFlight=f}
  await showWikiPhoto(selectedFlight);
  renderFlightDetails(selectedFlight);
}
async function showWikiPhoto(f){
  const query=[f.livery_name,f.aircraft_type,f.callsign].filter(Boolean).join(" ");
  if(!query)return;
  const url="https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch="+encodeURIComponent(query+" aircraft")+"&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url&iiurlwidth=800&format=json&origin=*";
  try{
    const d=await (await fetch(url)).json();const pages=d?.query?.pages||{};const p=Object.values(pages)[0];
    if(p?.imageinfo?.[0]) f.wiki_photo={url:p.imageinfo[0].thumburl||p.imageinfo[0].url,title:p.title,description:p.imageinfo[0].descriptionurl};
  }catch{}
}
function renderFlightDetails(f){
  lastSelectedId=String(f.flight_id||"");
  $("details").className="";
  const aircraftName=f.aircraft?.aircraft_name||"Aircraft type unavailable";
  const liveryName=f.aircraft?.livery_name||"Livery unavailable";
  const dest=f.destination?.identifier||f.destination?.name||"Unknown";
  const routeText=Array.isArray(f.route)&&f.route.length?f.route.length+" route points":"Route history unavailable";
  $("details").innerHTML=
    '<div class="card">'+
    (f.wiki_photo?'<img class="photo" src="'+escapeHtml(f.wiki_photo.url)+'" alt="Aircraft photo"><div class="photo-credit">Wikimedia Commons · '+escapeHtml(f.wiki_photo.title||"")+'</div>':"")+
    '<div class="aircraft">'+escapeHtml(f.callsign||"Unknown callsign")+'</div>'+
    '<div class="muted">'+escapeHtml(aircraftName)+" · "+escapeHtml(liveryName)+'</div>'+
    '<div class="grid">'+
    '<div><div class="label">Pilot</div><div class="value">'+escapeHtml(f.username||"—")+'</div></div>'+
    '<div><div class="label">Flight ID</div><div class="value">'+escapeHtml(f.flight_id||"—")+'</div></div>'+
    '<div><div class="label">Destination</div><div class="value"><span class="route-badge">'+escapeHtml(dest)+'</span></div></div>'+
    '<div><div class="label">Trail</div><div class="value">'+escapeHtml(routeText)+'</div></div>'+
    '<div><div class="label">Altitude</div><div class="value">'+formatNumber(f.altitude_ft)+' ft</div></div>'+
    '<div><div class="label">Speed</div><div class="value">'+formatNumber(f.speed_kt)+' kt</div></div>'+
    '<div><div class="label">Heading</div><div class="value">'+formatNumber(f.heading_deg)+'°</div></div>'+
    '<div><div class="label">Vertical speed</div><div class="value">'+formatNumber(f.vertical_speed_fpm)+' ft/min</div></div>'+
    '<div><div class="label">Position</div><div class="value">'+formatNumber(f.latitude,4)+", "+formatNumber(f.longitude,4)+'</div></div>'+
    '<div><div class="label">Track</div><div class="value">'+formatNumber(f.track_deg)+'°</div></div>'+
    '<div><div class="label">Aircraft ID</div><div class="value">'+escapeHtml(f.aircraft_id||"—")+'</div></div>'+
    '<div><div class="label">Livery ID</div><div class="value">'+escapeHtml(f.livery_id||"—")+'</div></div>'+
    '<div class="wide"><div class="label">Last report</div><div class="value">'+escapeHtml(formatReport(f.last_report))+'</div></div>'+
    '</div><div class="detail-actions"><button class="small-btn" id="bookBtn">Business class seats</button><button class="small-btn" id="routeBtn">Show route</button></div><div id="bookingBox"></div></div>';
  $("bookBtn").addEventListener("click",()=>showBooking(f));
  $("routeBtn").addEventListener("click",()=>showRoute(f));
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
function drawSelectedRoute(f){
  if(selectedRouteLayer){map.removeLayer(selectedRouteLayer);selectedRouteLayer=null;}
  const pts=(f.route||[]).map(p=>[Number(p.latitude),Number(p.longitude)]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  const planPts=(f.flight_plan?.flightPlanItems||[]).flatMap(x=>{const a=x?.location;return a&&Number.isFinite(Number(a.latitude))&&Number.isFinite(Number(a.longitude))?[[Number(a.latitude),Number(a.longitude)]]:[]});
  if(pts.length>1){
    selectedRouteLayer=L.layerGroup([L.polyline(pts,{color:"#aeb6bd",weight:2,opacity:.65})]).addTo(map);
    map.fitBounds(L.latLngBounds(pts),{padding:[40,40],maxZoom:7});
  }
  if(planPts.length>1){
    if(!selectedRouteLayer)selectedRouteLayer=L.layerGroup().addTo(map);
    L.polyline(planPts,{color:"#8d969f",weight:2,opacity:.55,dashArray:"5 6"}).addTo(selectedRouteLayer);
  }
}
function showRoute(f){
  const pts=(f.route||[]).map(p=>[Number(p.latitude),Number(p.longitude)]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(pts.length>1){map.fitBounds(L.latLngBounds(pts),{padding:[40,40],maxZoom:7});}
}
function showBooking(f){
  selectedSeat=null;const seats=["1A","1C","1D","1F","2A","2C","2D","2F","3A","3C","3D","3F"];
  $("bookingBox").innerHTML='<div class="booking"><div class="label">Business class · seat selection</div><div class="muted">Demo booking only. No real ticket or payment is processed.</div><div class="seat-grid">'+seats.map(s=>'<button class="seat '+(s==="1D"?"taken":"")+'" data-seat="'+s+'" '+(s==="1D"?"disabled":"")+'>'+s+'</button>').join("")+'</div><button class="book-btn" id="confirmSeat">Reserve demo seat</button></div>';
  document.querySelectorAll(".seat:not(.taken)").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".seat").forEach(x=>x.classList.remove("selected"));b.classList.add("selected");selectedSeat=b.dataset.seat;}));
  $("confirmSeat").addEventListener("click",()=>{$("confirmSeat").textContent=selectedSeat?"Demo reservation · "+selectedSeat:"Select a seat first";});
}
function renderAirportResults(data){
  const airport=data.airport||{};const list=airportTab==="arrivals"?data.inbound||[]:data.outbound||[];
  $("airportPanel").classList.remove("hidden");
  $("airportPanel").innerHTML='<div class="airport-title">'+escapeHtml(airport.icao||"Airport")+'</div><div class="muted">'+escapeHtml(airport.name||"")+'</div><div class="tabs"><button class="'+(airportTab==="arrivals"?"active":"")+'" id="arrivalsTab">Arrivals ('+(airport.inbound_count||0)+')</button><button class="'+(airportTab==="departures"?"active":"")+'" id="departuresTab">Departures ('+(airport.outbound_count||0)+')</button></div>'+list.map(x=>{const f=x.flight||{};const other=airportTab==="arrivals"?(x.origin?.name||x.origin?.identifier||"Unknown origin"):(x.destination?.name||x.destination?.identifier||"Unknown destination");const eta=x.eta?new Date(x.eta).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"—";return '<div class="flight-row" data-flight="'+escapeHtml(f.flight_id||"")+'"><div class="flight-main"><strong>'+escapeHtml(f.callsign||"Unknown")+'</strong><span class="route-badge">'+escapeHtml(other)+'</span></div><div class="muted">'+escapeHtml(f.username||"")+' · '+escapeHtml(f.aircraft_id||"")+" · "+(airportTab==="arrivals"?"ETA ":"Departure ") +eta+'</div></div>'}).join("")||'<div class="empty">No live flights returned.</div>';
  $("arrivalsTab").addEventListener("click",()=>{airportTab="arrivals";loadAirport(airport.icao)});
  $("departuresTab").addEventListener("click",()=>{airportTab="departures";loadAirport(airport.icao)});
  document.querySelectorAll(".flight-row").forEach(r=>r.addEventListener("click",()=>{const f=allFlights.find(x=>String(x.flight_id)===r.dataset.flight);if(f)loadFlightDetail(f)}));
}
async function loadAirport(icao){
  $("airportPanel").classList.remove("hidden");$("airportPanel").innerHTML='<div class="airport-title">'+escapeHtml(icao)+'</div><div class="muted">Loading live airport traffic…</div>';
  try{const r=await fetch(API+"?detail=airport&airport="+encodeURIComponent(icao),{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.message||"Airport unavailable");renderAirportResults(d)}catch(e){$("airportPanel").innerHTML='<div class="error">'+escapeHtml(e.message)+'</div>'}
}
$("airportBtn").addEventListener("click",()=>{const q=$("search").value.trim().toUpperCase();if(/^[A-Z0-9]{4}$/.test(q))loadAirport(q);else $("search").focus()});


// Live aircraft history trails
const trailLayer=L.layerGroup().addTo(map),trailHistory=new Map(),trailLines=new Map();
function updateTrails(flights){for(const f of flights){const id=String(f.flight_id||''),lat=Number(f.latitude),lon=Number(f.longitude);if(!id||!Number.isFinite(lat)||!Number.isFinite(lon))continue;const h=trailHistory.get(id)||[];const last=h[h.length-1];if(!last||Math.abs(last[0]-lat)>1e-5||Math.abs(last[1]-lon)>1e-5){h.push([lat,lon]);if(h.length>80)h.shift();trailHistory.set(id,h)}let line=trailLines.get(id);if(!line){line=L.polyline(h,{color:'#9aa3ad',weight:2,opacity:.65}).addTo(trailLayer);trailLines.set(id,line)}else line.setLatLngs(h)}for(const [id,line] of trailLines){if(!flights.some(f=>String(f.flight_id||'')===id)){trailLayer.removeLayer(line);trailLines.delete(id);trailHistory.delete(id)}}}
const _load=load;load=async function(){await _load();updateTrails(visibleFlights)};
