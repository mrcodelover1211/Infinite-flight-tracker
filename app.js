const API="https://vbifkgzmczbndtawawre.supabase.co/functions/v1/flights";
const POLL_MS=15000;
const map=L.map("map",{worldCopyJump:true,zoomControl:true,preferCanvas:true}).setView([20,0],2);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap contributors"}).addTo(map);

const markers=new Map();
const trailLines=new Map();
const trailHistory=new Map();
let selectedRouteLayer=null;
let allFlights=[];
let visibleFlights=[];
let loading=false;
let selectedFlight=null;
let selectedSeat=null;
let airportTab="arrivals";

const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
const formatNumber=(value,digits=0)=>{const n=Number(value);return Number.isFinite(n)?n.toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits}):"—"};
const formatReport=value=>{if(!value)return"—";const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString()};

function setStatus(text,state=""){ $("status").textContent=text; $("status").className="status "+state; }
function showError(message){$("error").textContent=message;$("error").classList.remove("hidden")}
function clearError(){$("error").classList.add("hidden")}

function aircraftIcon(){
  return L.divIcon({className:"plane-marker",html:'<div class="plane-glyph">✈</div>',iconSize:[28,28],iconAnchor:[14,14]});
}
const planeIcon=aircraftIcon();

function rotateMarker(marker,heading){
  const el=marker.getElement()?.querySelector(".plane-glyph");
  if(el)el.style.transform="rotate("+(Number.isFinite(Number(heading))?Number(heading):0)+"deg)";
}

function updateTrail(id,lat,lon){
  const h=trailHistory.get(id)||[];
  const last=h[h.length-1];
  if(!last||Math.abs(last[0]-lat)>0.0001||Math.abs(last[1]-lon)>0.0001){
    h.push([lat,lon]);
    if(h.length>80)h.shift();
    trailHistory.set(id,h);
  }
  let line=trailLines.get(id);
  if(!line){
    line=L.polyline(h,{color:"#8e98a3",weight:2,opacity:.55,interactive:false}).addTo(map);
    trailLines.set(id,line);
  }else line.setLatLngs(h);
}

function render(flights){
  $("summary").textContent=flights.length.toLocaleString()+" flight"+(flights.length===1?"":"s")+" shown";
  const active=new Set();
  for(const f of flights){
    const lat=Number(f.latitude),lon=Number(f.longitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    const id=String(f.flight_id||((f.callsign||"flight")+":"+lat+":"+lon));
    active.add(id);
    updateTrail(id,lat,lon);
    let marker=markers.get(id);
    if(!marker){
      marker=L.marker([lat,lon],{icon:planeIcon,keyboard:false});
      marker.bindTooltip(f.callsign||f.username||"Flight",{direction:"top"});
      marker.on("click",()=>loadFlightDetail(f));
      marker.addTo(map);
      markers.set(id,marker);
    }else{
      marker.setLatLng([lat,lon]);
      marker.off("click").on("click",()=>loadFlightDetail(f));
    }
    rotateMarker(marker,f.heading_deg);
  }
  for(const [id,marker] of markers){
    if(!active.has(id)){
      map.removeLayer(marker);markers.delete(id);
      const line=trailLines.get(id);if(line){map.removeLayer(line);trailLines.delete(id)}
      trailHistory.delete(id);
    }
  }
}

function applySearch(){
  const term=$("search").value.trim().toLowerCase();
  visibleFlights=!term?allFlights:allFlights.filter(f=>Object.values(f).some(v=>String(v??"").toLowerCase().includes(term)));
  render(visibleFlights);
}

async function loadFlightDetail(f){
  selectedFlight=f;
  try{
    const r=await fetch(API+"?detail=flight&flightId="+encodeURIComponent(f.flight_id),{cache:"no-store"});
    const d=await r.json();
    if(!r.ok)throw new Error(d.message||"Detailed route data unavailable");
    selectedFlight={...f,...(d.flight||{})};
  }catch{selectedFlight=f}
  await showWikiPhoto(selectedFlight);
  renderFlightDetails(selectedFlight);
}

async function showWikiPhoto(f){
  const query=[f.livery_name,f.aircraft_type,f.callsign].filter(Boolean).join(" ");
  if(!query)return;
  const url="https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch="+encodeURIComponent(query+" aircraft")+"&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url&iiurlwidth=800&format=json&origin=*";
  try{
    const d=await(await fetch(url,{cache:"no-store"})).json();
    const p=Object.values(d?.query?.pages||{})[0];
    if(p?.imageinfo?.[0])f.wiki_photo={url:p.imageinfo[0].thumburl||p.imageinfo[0].url,title:p.title,description:p.imageinfo[0].descriptionurl};
  }catch{}
}

function renderFlightDetails(f){
  $("details").className="";
  const aircraftName=f.aircraft_type||"Aircraft type unavailable";
  const liveryName=f.livery_name||"Livery unavailable";
  const dest=f.destination?.identifier||f.destination?.name||"Unknown";
  const routeText=Array.isArray(f.route)&&f.route.length?f.route.length+" route points":"Route unavailable";
  $("details").innerHTML='<div class="card">'+
    (f.wiki_photo?'<img class="photo" src="'+escapeHtml(f.wiki_photo.url)+'" alt="Aircraft photo"><div class="photo-credit">Wikimedia Commons · '+escapeHtml(f.wiki_photo.title||"")+"</div>":"")+
    '<div class="aircraft">'+escapeHtml(f.callsign||"Unknown callsign")+"</div>"+
    '<div class="muted">'+escapeHtml(aircraftName)+" · "+escapeHtml(liveryName)+"</div>"+
    '<div class="grid">'+
    '<div><div class="label">Pilot</div><div class="value">'+escapeHtml(f.username||"—")+"</div></div>"+
    '<div><div class="label">Flight ID</div><div class="value">'+escapeHtml(f.flight_id||"—")+"</div></div>"+
    '<div><div class="label">Destination</div><div class="value"><span class="route-badge">'+escapeHtml(dest)+"</span></div></div>"+
    '<div><div class="label">Route</div><div class="value">'+escapeHtml(routeText)+"</div></div>"+
    '<div><div class="label">Altitude</div><div class="value">'+formatNumber(f.altitude_ft)+" ft</div></div>"+
    '<div><div class="label">Speed</div><div class="value">'+formatNumber(f.speed_kt)+" kt</div></div>"+
    '<div><div class="label">Heading</div><div class="value">'+formatNumber(f.heading_deg)+"°</div></div>"+
    '<div><div class="label">Vertical speed</div><div class="value">'+formatNumber(f.vertical_speed_fpm)+" ft/min</div></div>"+
    '<div><div class="label">Position</div><div class="value">'+formatNumber(f.latitude,4)+", "+formatNumber(f.longitude,4)+"</div></div>"+
    '<div><div class="label">Track</div><div class="value">'+formatNumber(f.track_deg)+"°</div></div>"+
    '<div><div class="label">Aircraft ID</div><div class="value">'+escapeHtml(f.aircraft_id||"—")+"</div></div>"+
    '<div><div class="label">Livery ID</div><div class="value">'+escapeHtml(f.livery_id||"—")+"</div></div>"+
    '<div class="wide"><div class="label">Last report</div><div class="value">'+escapeHtml(formatReport(f.last_report))+"</div></div></div>"+
    '<div class="detail-actions"><button class="small-btn" id="bookBtn">Business class seats</button><button class="small-btn" id="routeBtn">Show route</button></div><div id="bookingBox"></div></div>';
  $("bookBtn").addEventListener("click",()=>showBooking(f));
  $("routeBtn").addEventListener("click",()=>showRoute(f));
}

function fitAircraft(){
  const points=visibleFlights.map(f=>[Number(f.latitude),Number(f.longitude)]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(points.length===1)map.setView(points[0],7);else if(points.length>1)map.fitBounds(L.latLngBounds(points),{padding:[30,30],maxZoom:7});
}

async function load(){
  if(loading)return;
  loading=true;setStatus("Updating…");clearError();
  try{
    const response=await fetch(API,{cache:"no-store"});
    const data=await response.json();
    if(!response.ok)throw new Error(data.message||data.error||("Backend returned HTTP "+response.status));
    if(data.simulated===true)throw new Error("Backend returned simulated data. The tracker refuses to display it.");
    allFlights=Array.isArray(data.flights)?data.flights:[];
    applySearch();
    $("updated").textContent="Updated "+new Date().toLocaleTimeString();
    setStatus("● Live","live");
  }catch(error){setStatus("● Backend error","error");showError(error instanceof Error?error.message:"Unknown backend error")}
  finally{loading=false}
}

async function loadAirport(icao){
  icao=String(icao||"").trim().toUpperCase();
  if(!/^[A-Z0-9]{4}$/.test(icao)){
    $("airportPanel").classList.remove("hidden");
    $("airportPanel").innerHTML='<div class="error">Enter a valid four-character ICAO code, such as LTFM.</div>';
    return;
  }
  $("airportPanel").classList.remove("hidden");
  $("airportPanel").innerHTML='<div class="airport-title">'+escapeHtml(icao)+'</div><div class="muted">Loading live airport traffic…</div>';
  try{
    const r=await fetch(API+"?detail=airport&airport="+encodeURIComponent(icao),{cache:"no-store"});
    const d=await r.json();
    if(!r.ok)throw new Error(d.message||d.error||"Airport unavailable");
    renderAirportResults(d);
  }catch(e){$("airportPanel").innerHTML='<div class="error">'+escapeHtml(e.message||"Airport unavailable")+"</div>"}
}

function renderAirportResults(data){
  const airport=data.airport||{};
  const list=airportTab==="arrivals"?(data.inbound||[]):(data.outbound||[]);
  $("airportPanel").innerHTML='<div class="airport-title">'+escapeHtml(airport.icao||"Airport")+"</div>"+
    '<div class="muted">'+escapeHtml(airport.name||"")+"</div>"+
    '<div class="tabs"><button class="'+(airportTab==="arrivals"?"active":"")+'" id="arrivalsTab">Arrivals ('+(data.inbound_count??0)+')</button><button class="'+(airportTab==="departures"?"active":"")+'" id="departuresTab">Departures ('+(data.outbound_count??0)+')</button></div>"+
    list.map(x=>{
      const f=x.flight||{};
      const other=airportTab==="arrivals"?(x.origin?.identifier||x.origin?.name||"Unknown origin"):(x.destination?.identifier||x.destination?.name||"Unknown destination");
      const time=x.eta?new Date(x.eta).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"—";
      return '<div class="flight-row" data-flight="'+escapeHtml(f.flight_id||"")+'"><div class="flight-main"><strong>'+escapeHtml(f.callsign||"Unknown")+'</strong><span class="route-badge">'+escapeHtml(other)+"</span></div><div class="muted">'+escapeHtml(f.username||"")+" · "+escapeHtml(f.aircraft_type||"")+" · "+(airportTab==="arrivals"?"ETA ":"Departure ")+time+"</div></div>";
    }).join("")||'<div class="empty">No live '+(airportTab==="arrivals"?"arrivals":"departures")+" returned.</div>";
  $("arrivalsTab").addEventListener("click",()=>{airportTab="arrivals";loadAirport(airport.icao)});
  $("departuresTab").addEventListener("click",()=>{airportTab="departures";loadAirport(airport.icao)});
  document.querySelectorAll(".flight-row").forEach(row=>row.addEventListener("click",()=>{
    const f=allFlights.find(x=>String(x.flight_id)===row.dataset.flight);
    if(f)loadFlightDetail(f);
  }));
}

function showBooking(f){
  selectedSeat=null;
  const seats=["1A","1C","1D","1F","2A","2C","2D","2F","3A","3C","3D","3F"];
  $("bookingBox").innerHTML='<div class="booking"><div class="label">Business class · seat selection</div><div class="muted">Demo booking only. No real ticket or payment is processed.</div><div class="seat-grid">'+seats.map(s=>'<button class="seat '+(s==="1D"?"taken":"")+'" data-seat="'+s+'" '+(s==="1D"?"disabled":"")+'>'+s+"</button>").join("")+'</div><button class="book-btn" id="confirmSeat">Reserve demo seat</button></div>';
  document.querySelectorAll(".seat:not(.taken)").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".seat").forEach(x=>x.classList.remove("selected"));b.classList.add("selected");selectedSeat=b.dataset.seat}));
  $("confirmSeat").addEventListener("click",()=>{$("confirmSeat").textContent=selectedSeat?"Demo reservation · "+selectedSeat:"Select a seat first"});
}

function drawSelectedRoute(f){
  if(selectedRouteLayer){map.removeLayer(selectedRouteLayer);selectedRouteLayer=null}
  const pts=(f.route||[]).map(p=>[Number(p.latitude),Number(p.longitude)]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  const planPts=(f.flight_plan?.flightPlanItems||[]).flatMap(x=>{const a=x?.location;return a&&Number.isFinite(Number(a.latitude))&&Number.isFinite(Number(a.longitude))?[[Number(a.latitude),Number(a.longitude)]]:[]});
  const layers=[];
  if(pts.length>1)layers.push(L.polyline(pts,{color:"#aeb6bd",weight:2,opacity:.65}));
  if(planPts.length>1)layers.push(L.polyline(planPts,{color:"#8d969f",weight:2,opacity:.55,dashArray:"5 6"}));
  if(layers.length){selectedRouteLayer=L.layerGroup(layers).addTo(map);map.fitBounds(L.latLngBounds([...(pts.length?pts:[]),...(planPts.length?planPts:[])]),{padding:[40,40],maxZoom:7})}
}
function showRoute(f){drawSelectedRoute(f)}

$("searchBtn").addEventListener("click",applySearch);
$("resetBtn").addEventListener("click",()=>{$("search").value="";applySearch()});
$("fitBtn").addEventListener("click",fitAircraft);
$("refreshBtn").addEventListener("click",load);
$("search").addEventListener("keydown",e=>{if(e.key==="Enter")applySearch()});
$("airportBtn").addEventListener("click",()=>{
  const box=$("airportSearch");
  const open=box.classList.toggle("hidden")===false;
  $("airportBtn").setAttribute("aria-expanded",String(open));
  if(open){$("airportInput").focus();$("airportInput").select()}
});
$("airportGo").addEventListener("click",()=>loadAirport($("airportInput").value));
$("airportInput").addEventListener("keydown",e=>{if(e.key==="Enter")loadAirport(e.target.value)});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")load()});
load();
setInterval(()=>{if(document.visibilityState==="visible")load()},POLL_MS);
