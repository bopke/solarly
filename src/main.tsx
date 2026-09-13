import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
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
// Fix: import the worker file with Vite's `?url` suffix (a *static* import
// Vite's bundler can see and correctly copy/hash into the build output),
// then hand that real URL to maplibre-gl via its public `setWorkerUrl`
// escape hatch before any Map is created.
setWorkerUrl(maplibreWorkerUrl)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
