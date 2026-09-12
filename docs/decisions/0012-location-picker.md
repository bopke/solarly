# 0012. Location picker: tile provider, timezone approximation, debounce

Status: accepted

## Context

Issue #12 needed a location picker: a Nominatim-backed search box plus a
MapLibre GL map with a draggable pin, resolving to
`{ lat, lon, utcOffsetHours }`. A few choices weren't fully pinned down by
the spec and are worth recording:

- Which free vector tile provider/style to use with MapLibre.
- How to get a UTC offset value without pulling in a full IANA
  timezone-database dependency, which the spec explicitly deferred past M1.
- How aggressively to debounce search-as-you-type calls to `geocode()`.

## Decision

**Tile provider:** OpenFreeMap's `liberty` style
(`https://tiles.openfreemap.org/styles/liberty`). It's free, requires no
API key or account, and is CORS-enabled for browser use — simpler to wire
up for M1 than MapTiler's free tier, which requires a signup and an API
key even on the free plan. Revisit if OpenFreeMap's hosted service proves
unreliable; MapTiler is the documented fallback per the spec.

**Timezone approximation:** derive a rough whole-hour UTC offset from
longitude alone (`round(lon / 15)`, clamped to the real UTC offset range
of -12..+14), returned as a **number** (`utcOffsetHours`) rather than a
display string. `approximateTimezone()` returns that number; a separate
`formatUtcOffset()` turns it into a `"≈ UTC±N"` label (the leading "≈" is
deliberate — see below) for anywhere the UI needs to show it. Keeping the
payload numeric means solar-math consumers don't have to parse a string
back into a number, and it avoids the field's name/type inviting someone
to pass it where an IANA id (e.g. `Europe/Berlin`) is expected.

This is a deliberate simplification, not a real timezone lookup — it
ignores actual timezone boundaries, political/non-hour offsets (e.g. India
at UTC+5:30, or the many countries whose borders don't follow longitude),
and **daylight saving time entirely** (it always returns the
longitude-derived "standard time" offset, never a DST-adjusted one). For
example, Berlin's longitude (≈13.39°E) resolves to `utcOffsetHours: 1`
year-round — correct for CET (winter) but one hour behind Berlin's actual
CEST offset (UTC+2) for roughly half the year. The `"≈ UTC+1"` label is
worded to flag that inexactness rather than assert a precise value. It's
"close enough" for M1's solar-generation estimates, which only need an
approximate local time-of-day for irradiance calculations. A real lookup
(e.g. `tz-lookup`, or a timezone API) is tracked as future work — see the
spec's tech stack summary, which explicitly scopes a full timezone
database lookup out of M1. The implementation lives in
`src/ui/timezone.ts` so swapping it out later is a one-file change.

**Search debounce:** 350ms after the user stops typing, as a component
prop (`debounceMs`) defaulting to 350 so it can be tuned without a code
change. This is comfortably above typical inter-keystroke intervals (so we
don't fire one request per keystroke) while still feeling responsive. It
is purely a typing-pause filter, though — it does **not** provide headroom
under Nominatim's usage-policy throttle. That throttle
(`MIN_REQUEST_INTERVAL_MS = 1100`ms in `nominatim.ts`) is what actually
enforces the ~1 request/second policy, and it's ~3× slower than the
350ms debounce: back-to-back distinct searches (e.g. type, pause, edit,
pause again before the first request lands) can still queue up behind
each other inside `createThrottle` rather than being smoothed out by the
debounce. That's fine — the throttle is designed to absorb exactly this —
but the two shouldn't be conflated as both doing the same job.

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
