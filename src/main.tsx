import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setWorkerUrl } from 'maplibre-gl'
import MaplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import './index.css'
import './ui/tokens.css'
import App from './App.tsx'

// maplibre-gl resolves its worker script via a runtime-computed
// `new URL('./maplibre-gl-worker.mjs', import.meta.url)` inside its own
// bundle (see node_modules/maplibre-gl/dist/maplibre-gl.mjs). That path is
// built from a template string, not a static literal, so Vite's production
// build can't detect it and never emits the worker file — the browser then
// gets a 404/wrong-MIME-type response and silently never loads any vector
// tile data (map style/sprites/raster background still load fine, since
// those aren't worker-dependent). Works fine under `npm run dev` because
// Vite's dev server can resolve arbitrary node_modules paths on demand.
//
// Fix: import the worker file with Vite's `?worker&url` suffix. A plain
// `?url` only copies the file byte-for-byte as a static asset — but
// maplibre-gl-worker.mjs itself imports ~60 bindings from a sibling
// maplibre-gl-shared.mjs chunk, which never gets emitted under `?url`,
// so the worker's own module load fails with the exact same
// wrong-MIME-type error one level deeper. `?worker` tells Vite to treat
// the file as a genuine worker entry point, bundling its dependencies
// into one self-contained output file; `&url` then gives us that real
// built URL to register with maplibre-gl's own `setWorkerUrl` escape
// hatch, before any Map is created.
setWorkerUrl(MaplibreWorker)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
