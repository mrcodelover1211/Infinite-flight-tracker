# Infinite Flight Tracker

A public live flight tracker for Infinite Flight, inspired by useful radar-style tracker features.

## Current features
- Expert, Training and Casual server switching
- Live aircraft map with 15-second refreshes
- Aircraft-type-aware map icons
- Smooth interpolation between Live API reports
- Safe longitude normalization and world-map bounds so aircraft do not disappear across the dateline
- Aircraft, livery and virtual-airline filters
- Callsign/pilot/free-text search
- Click aircraft for detailed live information
- Follow an aircraft by double-clicking it
- Route and flight-plan display
- Airport markers for active airports
- Airport search by ICAO
- Airport inbound/outbound traffic panels
- Active ATC markers
- Live data timestamps and source metadata
- Wikimedia Commons aircraft/livery reference images when matching media is available
- AI-readable runtime endpoint for current flight data

## AI runtime endpoint

The same Supabase Edge Function can be queried by an AI assistant at runtime:

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
- Flight/ATC polling is kept at or above the documented 15-second interval.
- Session/metadata caching is longer-lived.
- Live data is held only in short-lived operational caches.
- No Infinite Flight Live API flight dataset is written to the Supabase database.
- The API key is never included in frontend code.
- Runtime LLM use is limited to current data needed for the request.

See the official Infinite Flight Live API documentation:
https://infiniteflight.com/guide/developer-reference/live-api/overview

## Attribution
Infinite Flight Live API data is provided by Infinite Flight. This project is unofficial and is not affiliated with or endorsed by Infinite Flight or Flying Development Studio.

Map tiles © OpenStreetMap contributors.

## License
Mozilla Public License 2.0.