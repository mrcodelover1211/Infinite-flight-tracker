# Infinite Flight Tracker - Project Handoff

Last checked: 2026-09-20
Repository: mrcodelover1211/Infinite-flight-tracker
Current main HEAD checked: 4b9b45ea57856fd8f365135076044eeec9f8c060
Latest successful GitHub Pages deployment: run 105, commit 4b9b45ea57856fd8f365135076044eeec9f8c060.
No local test files or local repo copies should be created. Work directly through GitHub.

## User's required behavior

- This is an Infinite Flight Live tracker inspired by professional trackers such as Waypoint, Flightradar24, ADS-B Exchange, FlightAware, Plane Finder and RadarBox.
- Keep live data real. Do not simulate flights.
- Infinite Flight public Live API refresh cadence is 15 seconds. Frontend interpolation may make movement look continuous between reports.
- If an aircraft is outside the current map viewport, its map marker should disappear. When it re-enters the viewport, it should render again.
- Clicking/tapping a plane must open its details and automatically show its route/flight plan. Do NOT add a separate "Route" button.
- Do not add generic breadcrumb/trail behavior where the user expects the selected flight's actual route. The selected flight should show the actual fetched route and flight plan.
- Origin and destination should be determined accurately from the flight plan / World Status. Prefer World Status endpoint mapping when present, then flight-plan endpoints as fallback.
- Aircraft photo selection must be conservative. Use the Infinite Flight API's aircraft type/model and livery name to identify the aircraft, query multiple public sources, score the candidates, and show an image only when there is strong textual evidence for the exact model/livery. A wrong aircraft image is worse than no image.
- Avoid unrelated/person/accident images.
- Preserve the existing graceful "Backend error" behavior rather than crashing the page.
- User explicitly does NOT want local test files.

## Current frontend

Files:
- index.html
- styles.css
- app.js

Current frontend cache-busting script:
app.js?v=228d2288fb6cff1528d466c092206d74018079b9

Implemented areas include:
- Casual / Training / Expert server selector
- live aircraft map
- viewport-based aircraft rendering
- interpolation between 15s reports
- aircraft-type-specific map icons
- flight list and search
- airport search and airport traffic panel
- arrivals / departures
- live ATC points
- flight details
- route and flight-plan display on aircraft selection
- waypoint markers, next waypoint, ETA, progress, cross-track distance
- short-lived in-memory replay
- altitude/speed/vertical-speed graphs
- fleet board
- live stats
- traffic filters including aircraft, airport, altitude, speed, vertical speed, livery, VA and aircraft class
- data-quality/status badges
- weather radar layer
- density/day-night/range-ring layers
- 3D globe
- favorites/share/follow tools
- simulated booking/ticket UI
- responsive desktop/tablet/phone layout
- performance limits for Expert and weaker devices
- no separate Route button
- selected-flight route is drawn automatically after detail fetch

## Current photo matching

app.js currently queries:
- Wikipedia API
- Wikimedia Commons API

It uses aircraft model + livery evidence and rejects weak candidates. Current verification requires model evidence and, when a livery is supplied, livery evidence.

Important next improvement:
- These are two endpoints from the same Wikimedia ecosystem, so they are not truly independent sources.
- The user's requirement is stronger: use multiple genuinely independent sources and only accept an exact image when evidence agrees. Add independent sources only when they can be queried safely from the frontend/backend without creating unreliable or broken image URLs.
- Never silently substitute a generic aircraft photo when the exact livery/model is not verified.

## Current backend

Supabase project:
vbifkgzmczbndtawawre

Edge Function:
flights

Current deployed version when checked:
v22, ACTIVE, verify_jwt=false

The backend currently:
- caches sessions 10m
- caches flights 15s
- caches world/airport data 15s
- caches aircraft/livery metadata 10m
- hides the Infinite Flight API key in Supabase secrets
- fetches aircraft metadata and livery metadata
- maps live World Status outbound/inbound flight IDs to airport endpoints
- fetches selected-flight route and flightplan
- flattens nested flight-plan items into waypoint data
- derives origin/destination from flight-plan 4-character identifiers as fallback
- calculates next waypoint, route remaining, progress, ETA, waypoint ETAs and cross-track distance
- returns live/non-simulated data
- returns explicit 502 JSON errors for upstream failures
- uses CORS and no-store headers

The current v22 source no longer has the older duplicate-destination return-field bug. Do not reintroduce it.

## Waypoint comparison checked

Waypoint currently advertises:
- all three Infinite Flight servers
- 15-second live updates
- tap a flight for route, altitude profile, flight plan and pilot stats
- 3D flight path
- airport ATC and arrival/departure information
- fleet board
- replay
- follow/share/search
- airport ground layouts/gates

Use Waypoint as a behavior/reference target, not as a source of copied code or proprietary assets.

## Known bugs / verification notes from the latest code review

1. The current map renderer intentionally removes aircraft outside the viewport. This matches the user's requirement. Do not "fix" this by keeping off-screen markers visible.
2. Selecting a plane clears the previous selected route and the new flight's route is fetched/drawn automatically. No Route button was found in index.html/app.js.
3. Generic trail function exists, but selected-flight route rendering is the important path. Do not add a separate route control.
4. The current aircraft photo matcher is conservative, but its two sources are both Wikimedia-family APIs. Strengthen this to genuinely independent source verification in the next photo-system pass.
5. The current summary filter-state indicator does not include every advanced filter (speed, vertical speed, livery, VA, aircraft class). This is a UI correctness/polish issue, not a live-data failure, and should be fixed later.
6. Any new backend changes must preserve Infinite Flight rate limits and short-lived caching. Do not build permanent Live API history storage.
7. Do not create local test files. Use GitHub Actions/deployment checks and direct GitHub source inspection for verification.

## Implementation roadmap still desired

Continue the previously agreed large tracker upgrade:
1. Core tracker: stronger aircraft detail, exact photo verification, universal search, airport dashboard, ATC panel, aircraft/livery pages.
2. Professional map: clustering/thinning, layers, density, day/night, range rings, nearby aircraft, viewport performance.
3. Playback: short-lived session replay, timeline, altitude/speed/VS graphs, multi-flight replay where feasible without persistent Live API history.
4. Advanced: 3D terrain/path, weather, NOTAM/oceanic overlays where reliable data is available, airline/aircraft comparison, favorites and alerts.
5. Polish: mobile/desktop layout, keyboard/accessibility, share URLs, animations, error recovery, cache busting.

## Important constraints

- No AI branding or AI wording in the tracker UI.
- No permanent storage of Infinite Flight Live API traffic/history.
- No fake/simulated live aircraft.
- No separate Route button.
- No local test files.
- Preserve the booking UI as a simulation only.
- Preserve backend error handling.
- Preserve the user's preference for a clean map without airport-marker spam/jump scares.


## Photo verification upgrade completed

- Aircraft photo verification now uses **two genuinely independent ecosystems**:
  - Wikimedia Commons supplies the displayed image.
  - Planespotters.net independently corroborates the aircraft model and operator/livery text through the Supabase backend.
- Wikipedia is no longer treated as an independent second source for aircraft photos.
- If Planespotters cannot corroborate the model/operator, the tracker shows **no aircraft photo** instead of falling back to a generic or weakly matched image.
- The Supabase `flights` Edge Function is now v23 and exposes `detail=photo_verify` for this runtime-only corroboration.
- The frontend keeps the existing conservative model/livery scoring on Wikimedia results.
- No permanent photo-verification or Live API history is stored.
- Verified display images remain linked to their source page.

