# Infinite Flight Tracker

Live web tracker for Infinite Flight using the official Infinite Flight Live API through a Supabase Edge Function.

## Architecture

- GitHub Pages: static map UI.
- Supabase Edge Function: server-side proxy for Infinite Flight.
- Browser: consumes normalized live JSON and renders the map.
- AI integrations: can consume the same JSON endpoint. No separate AI dataset is created.

## Endpoint

https://vbifkgzmczbndtawawre.supabase.co/functions/v1/flights

Query parameters: q, callsign, username, flightId.

## API key security

The Infinite Flight Live API key must NOT be placed in GitHub, browser JavaScript, GitHub Pages, or a committed .env file.

Set the Supabase Edge Function secret named INFINITE_FLIGHT_API_KEY. The function reads it with Deno.env.get("INFINITE_FLIGHT_API_KEY").

## Live-data handling

The project does not write Infinite Flight Live API flight data to the Supabase database. The Edge Function uses short-lived in-memory operational caching and follows the documented polling cadence.

## License

Mozilla Public License 2.0.