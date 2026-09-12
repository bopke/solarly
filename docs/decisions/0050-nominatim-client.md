# 0050. Nominatim geocoding client: identification and rate limiting

Status: accepted

## Context

Issue #8 (M1 milestone, `data-sources/`) asks for a `geocode()` client
against Nominatim's public search API
(https://nominatim.org/release-docs/latest/api/Search/). Nominatim's usage
policy for the public `nominatim.openstreetmap.org` instance
(https://operations.osmfoundation.org/policies/nominatim/) requires:

- An identifying `User-Agent` or HTTP `Referer` so operators can contact
  the app owner if something goes wrong.
- No more than **1 request per second**.
- Results **must be cached client-side**; repeatedly sending the same
  query may get the client classified as faulty and blocked.
- Attribution to OpenStreetMap/Nominatim must be clearly displayed
  wherever results are shown.

Solarly is a pure client-side app (per the M1 design doc) — `geocode()`
runs directly in the user's browser via `fetch`, with no backend proxy to
attach headers on the server side. Two things don't translate cleanly from
a typical server-side API client to this environment:

1. **The `User-Agent` header is unsettable from browser `fetch`.** It's on
   the [forbidden request-header
   list](https://fetch.spec.whatwg.org/#forbidden-request-header) — the
   browser silently ignores any attempt to set it and sends its own
   browser UA string instead. `Referer` is also browser-controlled, not
   settable via `fetch` headers, though the browser _does_ send it
   automatically, populated with the page's own URL. Once Solarly is
   deployed to a real domain, that auto-sent `Referer` will point at
   Solarly's own site, which functionally satisfies the "identify the
   application" intent of the policy — but it's the browser's doing, not
   something this client code controls, and it will be blank/inconsistent
   in local dev, tests, or any embedding context that strips referrers.

2. **A hard client-side rate limiter, not just a note in a comment.** Since
   there's no backend, "please don't exceed 1 req/sec" has no
   server-side enforcement point — it has to live in the browser client
   itself, and it has to hold across every caller within a page/tab (the
   location search box today; potentially other future callers), not just
   within a single call site.

## Decision

- **Identification: use Nominatim's documented `email` query parameter
  instead of trying to fight the `User-Agent` limitation.** Nominatim's
  search API explicitly documents an optional `email=<address>` param
  precisely for "if you are making large numbers of requests please
  include an appropriate email address to contact you in the event of a
  problem" — this is the one identification channel that _is_ fully
  controllable from browser `fetch` (it's just a query string value, no
  forbidden-header restriction). The client reads it from
  `import.meta.env.VITE_NOMINATIM_CONTACT_EMAIL` and only appends it when
  set, so a deployment can opt in without code changes. **The client
  defaults to `contact@bopke.dev`** when `VITE_NOMINATIM_CONTACT_EMAIL`
  is unset, so requests self-identify out of the box without requiring
  manual `.env` setup; set `VITE_NOMINATIM_CONTACT_EMAIL` (see
  `.env.example`) to override it for a fork or a different deployment.
  The browser's automatic `Referer` (pointing at Solarly's real domain
  once deployed) remains an additional, passive identification signal,
  but is not something this code sets directly.
- **If traffic grows enough that the public instance's policy becomes a
  real constraint** (not just a documented pad in the client), the actual
  fix is not more client-side cleverness — it's routing through a small
  proxy that can set a real `User-Agent`/`Referer` server-side, or moving
  to a paid Nominatim-compatible hosted provider (e.g. Nominatim's own
  commercial hosting, or LocationIQ/Geoapify/etc., several of which are
  Nominatim-API-compatible). That's out of scope for this client — flagged
  here so it isn't re-discovered from scratch later.
- **Rate limiting: a small in-module throttle queue
  (`src/data-sources/rate-limit.ts`, `createThrottle(minIntervalMs)`)
  rather than a debounce on the UI input.** `geocode()` schedules every
  request through a single module-level `createThrottle(1100)` instance
  (1100ms, padded slightly over Nominatim's 1000ms floor for clock-drift
  headroom), so calls are serialized and spaced at least that far apart
  _regardless of how many places in the app call `geocode()` concurrently_.
  A pure UI-level debounce (delay before firing a search-box request) was
  considered but rejected as the _only_ mechanism: it protects against
  fast typing but doesn't cap overall throughput if multiple UI elements
  or programmatic calls invoke `geocode()` around the same time — the
  throttle in the data-sources client is the actual policy-compliance
  guarantee; a debounce on the search input (left to the `ui/` module) is
  a complementary UX nicety layered on top, not documented further here.
  A failed request does not wedge the queue — later scheduled requests
  still get their turn (see `rate-limit.test.ts`). The throttle also
  accepts an optional `AbortSignal` per scheduled task: a task whose
  signal fires while still queued (waiting for its throttle slot) is
  rejected immediately with an `AbortError`-named error, rather than
  sleeping out its full wait first — so an aborted/cancelled request
  frees its slot right away instead of blocking whatever's scheduled
  after it.
- **Caching: a simple in-memory, session-lifetime cache keyed on the
  normalized (trimmed, lower-cased) query string.** `geocode()` checks
  this cache before scheduling a request and populates it after a
  successful response. No TTL and no persistence (e.g. `localStorage`) —
  the cache lives only for the page's lifetime and is cleared on reload.
  This is enough to satisfy the policy's "don't repeatedly send the same
  query" requirement for the target use case (a location search box,
  where re-typing/re-searching the same place is the common case); a
  persistent cache was judged unnecessary complexity for M1 and can be
  revisited if usage patterns show it's needed.
- **Request timeout and abort handling.** Each request is bounded by
  `AbortSignal.timeout(...)` (default 9s, overridable via
  `options.timeoutMs`), combined with any caller-supplied `AbortSignal`
  via `AbortSignal.any([...])`, so either can cancel the request — and so
  a stalled `fetch` can't wedge the shared throttle queue for every
  caller in the tab indefinitely. Errors from an aborted fetch (whether
  from the caller's own signal or the timeout) preserve `name ===
'AbortError'` rather than being rewrapped into a generic `Error`, so
  callers can distinguish cancellation from a genuine failure.
- **Attribution is out of scope for this module.** `GeocodeResult` and
  this client don't render UI; whoever builds the location picker in
  `src/ui/` is responsible for clearly displaying OSM/Nominatim
  attribution alongside results, per the usage policy. Flagged here (and
  with a code comment in `nominatim.ts`) so it isn't rediscovered later.

## Consequences

- `geocode()` is safe to call from multiple UI call sites without any
  caller needing to know about or re-implement the rate limit; correctness
  of "stay under 1 req/sec" lives in one place
  (`src/data-sources/rate-limit.ts`).
- The throttle is an in-memory, per-tab/per-page-load singleton — it does
  **not** coordinate across multiple open tabs of the app, and resets on
  reload. This is an accepted limitation for a client-only, keyless public
  API; a multi-tab-aware limiter (e.g. via `BroadcastChannel` or
  `localStorage`) was judged not worth the complexity for M1.
- Nominatim identification defaults to `contact@bopke.dev` out of the
  box (via a hardcoded fallback in `nominatim.ts`), so no manual `.env`
  setup is required before requests self-identify; a deployment can
  still override it via `VITE_NOMINATIM_CONTACT_EMAIL` (see
  `.env.example`) if a different contact address is preferred.
- The in-memory result cache and per-tab throttle both reset on reload,
  so a user who reloads mid-session loses the "don't repeat this query"
  protection for queries they'd already made — an accepted trade-off for
  M1 given no persistence layer exists yet.
- If usage grows past what the free public instance's policy comfortably
  allows, the follow-up is a proxy or a paid geocoding provider — not a
  bigger client-side workaround.
