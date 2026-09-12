# 0012. Location picker: tile provider, timezone approximation, debounce

Status: accepted

## Context

Issue #12 needed a location picker: a Nominatim-backed search box plus a
MapLibre GL map with a draggable pin, resolving to `{ lat, lon, timezone }`.
A few choices weren't fully pinned down by the spec and are worth
recording:

- Which free vector tile provider/style to use with MapLibre.
- How to get a `timezone` value without pulling in a full IANA
  timezone-database dependency, which the spec explicitly deferred past M1.
- How aggressively to debounce search-as-you-type calls to `geocode()`.

## Decision

**Tile provider:** OpenFreeMap's `liberty` style
(`https://tiles.openfreemap.org/styles/liberty`). It's free, requires no
API key or account, and is CORS-enabled for browser use — simpler to wire
up for M1 than MapTiler's free tier, which requires a signup and an API
key even on the free plan. Revisit if OpenFreeMap's hosted service proves
unreliable; MapTiler is the documented fallback per the spec.

**Timezone approximation:** derive a rough `UTC±N` offset from longitude
alone (`round(lon / 15)`, clamped to the real UTC offset range of -12..+14).
This is a deliberate simplification, not a real timezone lookup — it
ignores actual timezone boundaries, political/non-hour offsets (e.g. India
at UTC+5:30, or the many countries whose borders don't follow longitude),
and daylight saving time. It's "close enough" for M1's solar-generation
estimates, which only need an approximate local time-of-day for irradiance
calculations. A real lookup (e.g. `tz-lookup`, or a timezone API) is
tracked as future work — see the spec's tech stack summary, which
explicitly scopes a full timezone database lookup out of M1. The
implementation lives in `src/ui/timezone.ts` so swapping it out later is a
one-file change.

**Search debounce:** 350ms after the user stops typing, as a component
prop (`debounceMs`) defaulting to 350 so it can be tuned without a code
change. This is comfortably above typical inter-keystroke intervals (so we
don't fire one request per keystroke) while still feeling responsive, and
leaves headroom under Nominatim's ~1 request/second usage-policy throttle
already enforced in `nominatim.ts`.

## Consequences

- The timezone value shown to users is approximate and should not be
  relied on for anything requiring an exact local time (e.g. DST-aware
  scheduling). This is acceptable for M1's solar generation estimates but
  should be called out if the UI is ever used for something time-precise.
- Switching tile providers later (e.g. to MapTiler, if OpenFreeMap access
  becomes unreliable) only requires changing the `mapStyleUrl` prop's
  default in `LocationPicker.tsx` — the component accepts it as a prop
  specifically to make this swap low-friction.
- MapLibre GL JS requires WebGL2, which jsdom doesn't provide, so the map
  itself isn't covered by the component test suite (`maplibre-gl` is
  mocked out); rendering, tile loading, and WebGL-specific interactions
  need manual/browser verification, which was done for this PR (search,
  map click, and pin drag all confirmed working in a real browser).
