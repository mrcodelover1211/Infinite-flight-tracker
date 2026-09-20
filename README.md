# Infinite Flight Tracker

A public live flight tracker for Infinite Flight, built for fast map rendering on desktops, tablets and lower-powered devices.

## Current features

- Casual, Training and Expert server selection with a three-position slider
- Live aircraft map refreshed every 15 seconds
- Canvas-rendered aircraft markers to avoid thousands of DOM elements
- Direct normalized longitude handling so aircraft cannot drift to invalid world-copy positions
- No continuous trail for every aircraft; only the selected/followed aircraft gets a short live trail
- Aircraft-type-aware marker sizing/category styling
- Callsign, pilot, aircraft, livery, virtual-airline and flight-ID search
- Debounced filters so typing does not redraw the map on every keystroke
- Click an aircraft for detailed live information
- Double-click an aircraft to follow it
- Route and flight-plan display with antimeridian-safe route splitting
- Airport markers and airport search by ICAO
- Airport inbound/outbound traffic panels
- Active ATC markers
- Live data timestamps and source metadata
- Wikimedia Commons aircraft/livery reference images when matching media is available
- Runtime AI-readable endpoint for current flight data
- Automatic idle pause after 15 minutes without interaction to reduce battery and network use

## Performance notes

The previous map used one HTML marker and an animation loop for every aircraft on every refresh, plus an 80-point trail for every flight. That scales badly on phones and tablets.

The current frontend uses Leaflet Canvas circle markers, updates marker coordinates only when they actually change, avoids per-flight DOM icons, keeps trails only for the selected/followed aircraft, debounces filters, and limits airport/ATC overlays to the current map view. This is intended to keep the main map responsive when a server has a large number of active flights.

The tracker intentionally avoids animating every aircraft between reports. Live API data is reported at 15-second intervals, and doing hundreds or thousands of simultaneous animation loops wastes CPU without adding meaningful tracking accuracy.

## AI runtime endpoint

The same Supabase Edge Function can be queried by an external AI integration at runtime:

https://vbifkgzmczbndtawawre.supabase.co/functions/v1/flights?server=expert&detail=ai&q=CALLSIGN

Examples:

- ?server=expert&detail=ai&callsign=TK546
- ?server=training&detail=ai&username=PilotName
- ?server=casual&detail=ai&airport=LTFM

The response identifies the source as Infinite Flight Live API, marks the data as live and non-simulated, and includes a retrieval timestamp.

This endpoint is for runtime lookup. Live API responses must not be retained for model training, tuning, evaluation, dataset creation, or long-term storage.

## Architecture

- GitHub Pages: public static frontend.
- Supabase Edge Function: server-side proxy.
- Infinite Flight Live API: live source.
- Browser and external AI integrations consume the normalized response.
- The Infinite Flight API key is stored only as the Supabase Edge Function secret INFINITE_FLIGHT_API_KEY.

## Live API compliance

- Flight polling is kept at the documented 15-second minimum.
- Session and metadata data are cached longer.
- Live data is held only in short-lived operational caches.
- World-status requests do not fetch the full live flight list first.
- Airport traffic requests use the already-fetched live flight list and airport status instead of requesting a route and flight plan for every airport row.
- No Infinite Flight Live API flight dataset is written to the Supabase database.
- The API key is never included in frontend code.
- Runtime LLM use is limited to current data needed for the request.

Infinite Flight's current best-practices documentation states that flight lists, flight details, ATC and airport status should not be polled more frequently than every 15 seconds, temporary operational caching is permitted, and Live API data must not be used to train, fine-tune, evaluate, distill or otherwise improve AI/ML systems. Runtime LLM use is allowed when only the minimum current data needed is sent and responses are not retained for training or dataset creation.

Official documentation:
https://infiniteflight.com/guide/developer-reference/live-api/overview
https://infiniteflight.com/guide/developer-reference/live-api/best-practices

## Attribution

Infinite Flight Live API data is provided by Infinite Flight. This project is unofficial and is not affiliated with or endorsed by Infinite Flight or Flying Development Studio.

Map tiles © OpenStreetMap contributors.

## License

Mozilla Public License 2.0.
