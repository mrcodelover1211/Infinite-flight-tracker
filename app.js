const API="https://vbifkgzmczbndtawawre.supabase.co/functions/v1/flights";
const POLL_MS=15000;
let selectedServer=new URLSearchParams(location.search).get("server")?.toLowerCase()||"expert";
if(!["expert","training","casual"].includes(selectedServer))selectedServer="expert";
const map=L.map("map",{worldCopyJump:false,zoomControl:true,preferCanvas:true,maxBounds:[[-85,-180],[85,180]],maxBoundsViscosity:.75,minZoom:2,maxZoom:12}).setView([20,0],2);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap contributors"}).addTo(map);
L.control.scale({imperial:true,metric:true}).addTo(map);

const markers=new Map(), trailLines=new Map(), trailHistory=new Map(), worldMarkers=new Map(), atcMarkers=new Map();
let selectedRouteLayer=null, allFlights=[], visibleFlights=[], loading=false, selectedFlight=null, selectedSeat=null, airportTab="arrivals", airportsVisible=false, atcVisible=true, followingFlightId=null, filterAircraft="", filterLivery="", filterVA="";
const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
const formatNumber=(value,digits=0)=>{const n=Number(value);return Number.isFinite(n)?n.toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits}):"—"};
const formatReport=value=>{if(!value)return"—";const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString()};
const normLon=x=>{let n=Number(x);if(!Number.isFinite(n))return NaN;while(n>180)n-=360;while(n<-180)n+=360;return n};

function setStatus(text,state=""){$("status").textContent=text;$("status").className="status "+state}
function showError(message){$("error").textContent=message;$("error").classList.remove("hidden")}
function clearError(){$("error").classList.add("hidden")}
function setServer(server){
  selectedServer=server;
  document.querySelectorAll(".server-btn").forEach(b=>b.classList.toggle("active",b.dataset.server===server));
  $("serverLabel").textContent=server[0].toUpperCase()+server.slice(1);
  history.replaceState(null,"",location.pathname+"?server="+encodeURIComponent(server));
  clearFlightLayers(); load();
}
function clearFlightLayers(){
  for(const m of markers.values())map.removeLayer(m);
  for(const l of trailLines.values())map.removeLayer(l);
  markers.clear();trailLines.clear();trailHistory.clear();
  allFlights=[];visibleFlights=[];
}
function aircraftIcon(f){
  const type=String(f?.aircraft_type||"").toLowerCase();
  const glyph=type.includes("helicopter")||type.includes("ec-")?"🚁":type.includes("cessna")||type.includes("piper")||type.includes("cirrus")||type.includes("tbm")?"🛩️":"✈";
  const size=type.includes("a380")||type.includes("747")||type.includes("777")||type.includes("a350")?28:type.includes("737")||type.includes("a320")||type.includes("a330")?25:22;
  return L.divIcon({className:"plane-marker",html:'<div class="plane-glyph" style="font-size:'+size+'px">'+glyph+'</div>',iconSize:[32,32],iconAnchor:[16,16]});
}
function rotateMarker(marker,heading){const el=marker.getElement()?.querySelector(".plane-glyph");if(el)el.style.transform="rotate("+(Number.isFinite(Number(heading))?Number(heading):0)+"deg)"}
function animateMarker(marker,toLat,toLon,duration=13500){
  const from=marker.getLatLng(), start=performance.now();
  let targetLon=toLon, startLon=from.lng;
  while(targetLon-startLon>180)targetLon-=360;
  while(targetLon-startLon<-180)targetLon+=360;
  function step(now){
    const p=Math.min(1,(now-start)/duration), e=p<.5?2*p*p:1-Math.pow(-2*p+2,2)/2;
    marker.setLatLng([from.lat+(toLat-from.lat)*e,startLon+(targetLon-startLon)*e]);
    if(p<1)requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function updateTrail(id,lat,lon){
  const h=trailHistory.get(id)||[], last=h[h.length-1];
  if(!last||Math.abs(last[0]-lat)>0.0001||Math.abs(last[1]-lon)>0.0001){h.push([lat,lon]);if(h.length>80)h.shift();trailHistory.set(id,h)}
  let line=trailLines.get(id);
  if(!line){line=L.polyline(h,{color:"#8e98a3",weight:2,opacity:.45,interactive:false,noClip:true}).addTo(map);trailLines.set(id,line)}else line.setLatLngs(h)
}
function render(flights){
  $("summary").textContent=flights.length.toLocaleString()+" flight"+(flights.length===1?"":"s")+" shown · "+selectedServer[0].toUpperCase()+selectedServer.slice(1);
  const active=new Set();
  for(const f of flights){
    const lat=Number(f.latitude),lon=normLon(f.longitude);
    if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180)continue;
    const id=String(f.flight_id||f.callsign||("flight:"+lat+":"+lon));active.add(id);
    updateTrail(id,lat,lon);
    let marker=markers.get(id);
    const icon=aircraftIcon(f);
    if(!marker){
      marker=L.marker([lat,lon],{icon,keyboard:true,zIndexOffset:100});
      marker.bindTooltip(f.callsign||f.username||"Flight",{direction:"top",offset:[0,-12]});
      marker.addTo(map);markers.set(id,marker);
    }else{
      marker.setIcon(icon);
      animateMarker(marker,lat,lon);
      marker.setTooltipContent(f.callsign||f.username||"Flight");
    }
    marker.off("click").on("click",()=>loadFlightDetail(f));
    marker.off("dblclick").on("dblclick",()=>followFlight(f));
    rotateMarker(marker,f.heading_deg);
    if(followingFlightId===id) marker.setZIndexOffset(1000);
  }
  for(const [id,marker] of markers)if(!active.has(id)){
    map.removeLayer(marker);markers.delete(id);
    const line=trailLines.get(id);if(line)map.removeLayer(line);
    trailLines.delete(id);trailHistory.delete(id);
    if(followingFlightId===id) followingFlightId=null;
  }
  if(followingFlightId){
    const f=flights.find(x=>String(x.flight_id)===followingFlightId);
    if(f&&Number.isFinite(Number(f.latitude))&&Number.isFinite(normLon(f.longitude))) map.panTo([Number(f.latitude),normLon(f.longitude)],{animate:true,duration:.5});
  }
}
function followFlight(f){
  followingFlightId=String(f.flight_id||"");
  selectedFlight=f;
  map.setView([Number(f.latitude),normLon(f.longitude)],8,{animate:true});
  loadFlightDetail(f);
}
function stopFollowing(){followingFlightId=null;render(visibleFlights)}
function applySearch(){
  const term=$("search").value.trim().toLowerCase();
  visibleFlights=allFlights.filter(f=>{
    const hay=Object.values(f).map(v=>String(v??"").toLowerCase()).join(" ");
    return (!term||hay.includes(term))
      &&(!filterAircraft||String(f.aircraft_type||"").toLowerCase().includes(filterAircraft))
      &&(!filterLivery||String(f.livery_name||"").toLowerCase().includes(filterLivery))
      &&(!filterVA||String(f.virtual_organization||"").toLowerCase().includes(filterVA));
  });
  render(visibleFlights);
}
async function loadFlightDetail(f){
  selectedFlight=f;
  try{
    const r=await fetch(API+"?server="+encodeURIComponent(selectedServer)+"&detail=flight&flightId="+encodeURIComponent(f.flight_id),{cache:"no-store"});
    const d=await r.json();if(!r.ok)throw new Error(d.message||"Detailed route data unavailable");
    selectedFlight={...f,...(d.flight||{})};
  }catch{selectedFlight=f}
  await showWikiPhoto(selectedFlight);renderFlightDetails(selectedFlight);
}
async function commonsSearch(query){
  const url="https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch="+encodeURIComponent(query)+"&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=900&format=json&origin=*";
  try{
    const d=await(await fetch(url,{cache:"no-store"})).json();
    return Object.values(d?.query?.pages||{}).map(p=>({title:p.title,info:p.imageinfo?.[0]})).filter(x=>x.info?.thumburl||x.info?.url);
  }catch{return[]}
}
async function showWikiPhoto(f){
  const model=String(f.aircraft_type||"").trim();
  const livery=String(f.livery_name||"").trim();
  const exact=[livery,model].filter(Boolean).join(" ");
  const modelResults=model?await commonsSearch(model+" aircraft"):[],
        liveryResults=livery?await commonsSearch(livery+" "+model+" aircraft"):await commonsSearch(exact+" aircraft");
  const pick=(items,needle)=>{
    const n=String(needle||"").toLowerCase();
    return items.find(x=>String(x.title||"").toLowerCase().includes(n))||items[0]||null;
  };
  const aircraftPhoto=pick(modelResults,model);
  const liveryPhoto=pick(liveryResults,livery);
  f.wiki_photo=aircraftPhoto?.info?{url:aircraftPhoto.info.thumburl||aircraftPhoto.info.url,title:aircraftPhoto.title,descriptionurl:aircraftPhoto.info.descriptionurl,match:"aircraft"}:null;
  f.wiki_livery_photo=liveryPhoto?.info?{url:liveryPhoto.info.thumburl||liveryPhoto.info.url,title:liveryPhoto.title,descriptionurl:liveryPhoto.info.descriptionurl,match:"livery"}:null;
}
function renderFlightDetails(f){
  $("details").className="";
  const aircraftName=f.aircraft_type||"Aircraft type unavailable",
    liveryName=f.livery_name||"Livery unavailable",
    dest=f.destination?.identifier||f.destination?.name||"Unknown",
    origin=f.origin?.identifier||f.origin?.name||"Unknown",
    routeText=Array.isArray(f.route)&&f.route.length?f.route.length+" route points":"Route unavailable",
    isFollowing=followingFlightId===String(f.flight_id);
  $("details").innerHTML='<div class="card">'
  +(f.wiki_photo?'<img class="photo" src="'+escapeHtml(f.wiki_photo.url)+'" alt="'+escapeHtml(aircraftName)+'"><div class="photo-credit">Wikimedia Commons · '+escapeHtml(f.wiki_photo.title||"")+'</div>':"")
  +(f.wiki_livery_photo?'<img class="photo photo-secondary" src="'+escapeHtml(f.wiki_livery_photo.url)+'" alt="'+escapeHtml(liveryName)+'"><div class="photo-credit">Livery reference · Wikimedia Commons · '+escapeHtml(f.wiki_livery_photo.title||"")+'</div>':"")
  +'<div class="aircraft">'+escapeHtml(f.callsign||"Unknown callsign")+'</div><div class="muted">'+escapeHtml(aircraftName)+" · "+escapeHtml(liveryName)+'</div>'
  +'<div class="chips"><span class="chip">'+escapeHtml(selectedServer)+'</span><span class="chip">'+(f.connected?"Connected":"Disconnected")+'</span><span class="chip">'+escapeHtml(f.pilot_state_label||"Active")+'</span></div>'
  +'<div class="grid"><div><div class="label">Pilot</div><div class="value">'+escapeHtml(f.username||"—")+'</div></div><div><div class="label">Virtual airline</div><div class="value">'+escapeHtml(f.virtual_organization||"—")+'</div></div>'
  +'<div><div class="label">Origin</div><div class="value"><span class="route-badge">'+escapeHtml(origin)+'</span></div></div><div><div class="label">Destination</div><div class="value"><span class="route-badge">'+escapeHtml(dest)+'</span></div></div>'
  +'<div><div class="label">Altitude</div><div class="value">'+formatNumber(f.altitude_ft)+' ft</div></div><div><div class="label">Speed</div><div class="value">'+formatNumber(f.speed_kt)+' kt</div></div>'
  +'<div><div class="label">Heading</div><div class="value">'+formatNumber(f.heading_deg)+'°</div></div><div><div class="label">Vertical speed</div><div class="value">'+formatNumber(f.vertical_speed_fpm)+' ft/min</div></div>'
  +'<div><div class="label">Position</div><div class="value">'+formatNumber(f.latitude,4)+", "+formatNumber(f.longitude,4)+'</div></div><div><div class="label">Track</div><div class="value">'+formatNumber(f.track_deg)+'°</div></div>'
  +'<div><div class="label">ETA</div><div class="value">'+escapeHtml(f.eta?formatReport(f.eta):"—")+'</div></div><div><div class="label">Last report</div><div class="value">'+escapeHtml(formatReport(f.last_report))+'</div></div>'
  +'<div class="wide"><div class="label">Live data</div><div class="value">Infinite Flight Live API · '+escapeHtml(f.retrieved_at?formatReport(f.retrieved_at):"current request")+'</div></div></div>'
  +'<div class="detail-actions"><button class="small-btn" id="routeBtn">Show route</button><button class="small-btn" id="focusBtn">Focus</button><button class="small-btn" id="followBtn">'+(isFollowing?"Stop following":"Follow")+'</button><button class="small-btn" id="aiBtn">AI data</button></div>'
  +'</div>';
  $("routeBtn").addEventListener("click",()=>drawSelectedRoute(f));
  $("focusBtn").addEventListener("click",()=>map.setView([Number(f.latitude),normLon(f.longitude)],8,{animate:true}));
  $("followBtn").addEventListener("click",()=>isFollowing?stopFollowing():followFlight(f));
  $("aiBtn").addEventListener("click",()=>copyAIUrl(f));
}
async function copyAIUrl(f){
  const url=API+"?server="+encodeURIComponent(selectedServer)+"&detail=ai&flightId="+encodeURIComponent(f.flight_id);
  try{await navigator.clipboard.writeText(url);setStatus("AI endpoint copied","live");setTimeout(()=>setStatus("● Live","live"),1800)}
  catch{window.prompt("Copy this live AI endpoint:",url)}
}
function fitAircraft(){
  const points=visibleFlights.map(f=>[Number(f.latitude),normLon(f.longitude)]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  if(points.length===1)map.setView(points[0],7);else if(points.length>1)map.fitBounds(L.latLngBounds(points),{padding:[30,30],maxZoom:7});
}
async function load(){
  if(loading)return;loading=true;setStatus("Updating…");clearError();
  try{
    const response=await fetch(API+"?server="+encodeURIComponent(selectedServer),{cache:"no-store"}),data=await response.json();
    if(!response.ok)throw new Error(data.message||data.error||("Backend returned HTTP "+response.status));
    if(data.simulated===true)throw new Error("Backend returned simulated data. The tracker refuses to display it.");
    allFlights=Array.isArray(data.flights)?data.flights.map(f=>({...f,retrieved_at:data.retrieved_at,pilot_state_label:["Active","Away in flight","Away parked","In background"][Number(f.pilot_state)]||"Unknown"})):[];applySearch();
    $("updated").textContent="Updated "+new Date().toLocaleTimeString()+" · "+(data.retrieved_at?new Date(data.retrieved_at).toLocaleTimeString():"live");
    setStatus("● Live","live");
    $("serverCounts").textContent=(data.server_counts||{})[selectedServer]??allFlights.length;
  }catch(error){setStatus("● Backend error","error");showError(error instanceof Error?error.message:"Unknown error")}
  finally{loading=false}
}
async function loadWorld(){
  const r=await fetch(API+"?server="+encodeURIComponent(selectedServer)+"&detail=world",{cache:"no-store"}),d=await r.json();
  if(!r.ok)throw new Error(d.message||"World data unavailable");
  for(const m of worldMarkers.values())map.removeLayer(m);worldMarkers.clear();
  for(const m of atcMarkers.values())map.removeLayer(m);atcMarkers.clear();
  for(const a of (d.airports||[])){
    const lat=Number(a.latitude),lon=normLon(a.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    const marker=L.circleMarker([lat,lon],{radius:5,weight:1,fillOpacity:.65,opacity:.9});
    marker.bindTooltip(a.icao||a.name||"Airport",{direction:"top"});
    marker.on("click",()=>loadAirport(a.icao));marker.addTo(map);worldMarkers.set(a.icao||String(lat)+":"+lon,marker);
  }
  for(const a of (d.atc||[])){
    const lat=Number(a.latitude),lon=normLon(a.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    const marker=L.circleMarker([lat,lon],{radius:7,weight:2,fillOpacity:.35,opacity:.9});
    marker.bindTooltip("ATC · "+(a.airport||"Center")+" · "+(a.username||"Unknown"),{direction:"top"});
    marker.addTo(map);atcMarkers.set((a.airport||"ATC")+":"+(a.username||"")+":"+lat,marker);
  }
  $("airportCount").textContent=(d.airports||[]).length+" airports · "+(d.atc||[]).length+" ATC";
}
function toggleAirports(){
  airportsVisible=!airportsVisible;$("airportsToggle").classList.toggle("active",airportsVisible);
  if(airportsVisible)loadWorld().catch(e=>showError(e.message));else {for(const m of worldMarkers.values())map.removeLayer(m);for(const m of atcMarkers.values())map.removeLayer(m);worldMarkers.clear();atcMarkers.clear();}
}
async function loadAirport(icao){
  icao=String(icao||"").trim().toUpperCase();
  if(!/^[A-Z0-9]{4}$/.test(icao)){ $("airportPanel").classList.remove("hidden");$("airportPanel").innerHTML='<div class="error">Enter a valid four-character ICAO code, such as LTFM.</div>';return}
  $("airportPanel").classList.remove("hidden");$("airportPanel").innerHTML='<div class="airport-title">'+escapeHtml(icao)+'</div><div class="muted">Loading live airport traffic…</div>';
  try{const r=await fetch(API+"?server="+encodeURIComponent(selectedServer)+"&detail=airport&airport="+encodeURIComponent(icao),{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.message||d.error||"Airport unavailable");renderAirportResults(d);map.setView([Number(d.airport?.latitude)||0,normLon(d.airport?.longitude)||0],8)}catch(e){$("airportPanel").innerHTML='<div class="error">'+escapeHtml(e.message||"Airport unavailable")+"</div>"}
}
function renderAirportResults(data){
  const airport=data.airport||{},list=airportTab==="arrivals"?(data.inbound||[]):(data.outbound||[]);
  $("airportPanel").innerHTML='<div class="airport-title">'+escapeHtml(airport.icao||"Airport")+'</div><div class="muted">'+escapeHtml(airport.name||"")+'</div>'+
  '<div class="tabs"><button class="'+(airportTab==="arrivals"?"active":"")+'" id="arrivalsTab">Arrivals ('+(data.inbound_count??0)+')</button><button class="'+(airportTab==="departures"?"active":"")+'" id="departuresTab">Departures ('+(data.outbound_count??0)+')</button></div>'+
  list.map(x=>{const f=x.flight||{},other=airportTab==="arrivals"?(x.origin?.identifier||x.origin?.name||"Unknown origin"):(x.destination?.identifier||x.destination?.name||"Unknown destination"),time=x.eta?new Date(x.eta).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"—";return '<div class="flight-row" data-flight="'+escapeHtml(f.flight_id||"")+'"><div class="flight-main"><strong>'+escapeHtml(f.callsign||"Unknown")+'</strong><span class="route-badge">'+escapeHtml(other)+'</span></div><div class="muted">'+escapeHtml(f.username||"")+" · "+escapeHtml(f.aircraft_type||"")+" · "+(airportTab==="arrivals"?"ETA ":"Departure ")+time+"</div></div>"}).join("")||'<div class="empty">No live '+(airportTab==="arrivals"?"arrivals":"departures")+" returned.</div>";
  $("arrivalsTab").addEventListener("click",()=>{airportTab="arrivals";loadAirport(airport.icao)});$("departuresTab").addEventListener("click",()=>{airportTab="departures";loadAirport(airport.icao)});
  document.querySelectorAll(".flight-row").forEach(row=>row.addEventListener("click",()=>{const f=allFlights.find(x=>String(x.flight_id)===row.dataset.flight);if(f)loadFlightDetail(f)}));
}
function drawSelectedRoute(f){
  if(selectedRouteLayer){map.removeLayer(selectedRouteLayer);selectedRouteLayer=null}
  const pts=(f.route||[]).map(p=>[Number(p.latitude),normLon(p.longitude)]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  const planPts=(f.flight_plan?.flightPlanItems||[]).flatMap(x=>{const a=x?.location;return a&&Number.isFinite(Number(a.latitude))&&Number.isFinite(Number(a.longitude))?[[Number(a.latitude),normLon(a.longitude)]]:[]});
  const layers=[];if(pts.length>1)layers.push(L.polyline(pts,{weight:3,opacity:.65,noClip:true}));if(planPts.length>1)layers.push(L.polyline(planPts,{weight:2,opacity:.5,dashArray:"5 6",noClip:true}));
  if(layers.length){selectedRouteLayer=L.layerGroup(layers).addTo(map);map.fitBounds(L.latLngBounds([...pts,...planPts]),{padding:[40,40],maxZoom:7})}
}
$("searchBtn").addEventListener("click",applySearch);$("resetBtn").addEventListener("click",()=>{$("search").value="";filterAircraft="";filterLivery="";filterVA="";$("aircraftFilter").value="";$("liveryFilter").value="";$("vaFilter").value="";applySearch()});
$("aircraftFilter").addEventListener("input",e=>{filterAircraft=e.target.value.trim().toLowerCase();applySearch()});
$("liveryFilter").addEventListener("input",e=>{filterLivery=e.target.value.trim().toLowerCase();applySearch()});
$("vaFilter").addEventListener("input",e=>{filterVA=e.target.value.trim().toLowerCase();applySearch()});$("fitBtn").addEventListener("click",fitAircraft);$("refreshBtn").addEventListener("click",load);$("airportsToggle").addEventListener("click",toggleAirports);
$("search").addEventListener("keydown",e=>{if(e.key==="Enter")applySearch()});$("airportBtn").addEventListener("click",()=>{const box=$("airportSearch"),open=box.classList.toggle("hidden")===false;$("airportBtn").setAttribute("aria-expanded",String(open));if(open){$("airportInput").focus();$("airportInput").select()}});
$("airportGo").addEventListener("click",()=>loadAirport($("airportInput").value));$("airportInput").addEventListener("keydown",e=>{if(e.key==="Enter")loadAirport(e.target.value)});
document.querySelectorAll(".server-btn").forEach(b=>b.addEventListener("click",()=>setServer(b.dataset.server)));
document.querySelectorAll(".server-btn").forEach(b=>b.classList.toggle("active",b.dataset.server===selectedServer));
$("serverLabel").textContent=selectedServer[0].toUpperCase()+selectedServer.slice(1);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")load()});
load();setInterval(()=>{if(document.visibilityState==="visible")load()},POLL_MS);
