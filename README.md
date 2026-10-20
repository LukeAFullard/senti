# Satellite Toolkit — first extraction pass

This project is the first, behaviour-preserving decomposition of the existing Sentinel-2 satellite monitoring app. The original single-file source is retained as `original-single-file.html` for regression comparison. The modular entry point is `index.html`.

## Run it

Serve this folder over HTTP(S), for example with Python:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`. Do not rely on opening `index.html` with `file://`; browsers commonly restrict local script/resource loading.

## Current status — important

The JavaScript is split into ten ordered **classic scripts**, not yet fully isolated ES modules. This is deliberate for the first pass: the existing application relies heavily on shared top-level lexical variables and direct DOM references. Keeping the scripts in their original execution order minimises regression risk. It also means some files cannot yet be selected independently in another app just by adding one script tag. The next pass should replace implicit shared state with explicit module APIs and extract pure functions first.

The app's existing HTML and CSS are preserved. External libraries and data providers remain as in the source. This refactor does not change the satellite-only data policy or claim that Sentinel-1 remote asset access is guaranteed.

## File inventory

| File | Responsibility | Coupling / notes |
|---|---|---|
| `js/01-runtime-and-map.js` | GIF encoder, DOM references, shared state, map setup, drawing/point interaction and common helpers | Foundational; currently owns many globals and DOM bindings |
| `js/02-raster-and-index-analysis.js` | Raster access, CRS/pixel-window calculations, Sentinel-2 band reads, index formulas and OPTRAM calculations | Uses shared AOI, settings and cache state; good candidate for API extraction |
| `js/03-composites-and-legend.js` | Temporal composites, support counts, legend range/stretch and colour mapping | Depends on raster/index result shapes and UI controls |
| `js/04-map-rendering.js` | Basemap tile stitching, warping and visual rendering helpers | Depends on Leaflet map, canvas, rendered-state structures and basemap settings |
| `js/05-pixel-inspector.js` | Pixel inspector and hover sampling | Depends on rendered-state and raster grid structures |
| `js/06-transects-polygon-stats-and-charts.js` | Transect sampling, polygon summaries, chart updates and comparison graph | Mixes useful analysis routines with UI updates; split further when API contracts are explicit |
| `js/07-scene-pipeline.js` | STAC scene search, scene loading, analysis pipeline and primary exports | Orchestrates other sections; should remain an orchestration layer |
| `js/08-reports-and-geospatial-exports.js` | Reproducibility report, geospatial exports and OPTRAM diagnostics | Depends on result state and export metadata |
| `js/09-seasonal-anomaly-and-radar-discovery.js` | Seasonal anomaly calculations/overlays/exports and Sentinel-1 discovery/access helpers | Radar provider access is optional and may be restricted; anomaly calculation is satellite-only |
| `js/10-radar-rendering-and-comparison.js` | Sentinel-1 raster loading/rendering, optical-radar comparison and radar UI event handlers | Optional feature, but currently references core state and specific DOM controls |

## Dependency direction intended for the next refactor

`app config / entry point` → `UI adapters` → `feature workflows` → `analysis services` → `raster and data-source adapters`.

Shared utilities and typed/plain data structures should sit below those layers. Analysis functions should not read DOM elements or mutate the map directly. UI modules should call analysis services and render returned results. Data adapters should return normalised scene/raster objects and not own application-specific controls.

## Reuse boundaries to extract next

1. **Pure utilities first:** quantiles, median/MAD, array statistics, normalized differences, seasonal DOY distance, robust anomaly score, coordinate/pixel conversions where inputs are explicit.
2. **Raster contracts:** standardise `{ data, width, height, bounds, crs, transform, nodata, metadata }` and document grid alignment/resampling rules before extracting mosaics.
3. **Data adapters:** make STAC search and Sentinel-2 asset resolution independent of the app's form controls; retain Sentinel-1 as a separately enabled adapter.
4. **Feature API:** each feature should export `registerFeature(appContext)` or `createFeature(appContext)` and declare its UI controls, required services, and cleanup/dispose behaviour.
5. **App composition:** configuration should list enabled features and data adapters. A second small app should be built from the toolkit to prove reuse before declaring the extraction complete.

## Regression checklist

- [ ] Map starts at the same default location and loads normally.
- [ ] Rectangle/polygon drawing completes and point selection remains separate.
- [ ] STAC search supports the existing scene-limit and all-scenes options.
- [ ] Raster reads, CRS transforms, cloud masking, mosaics and index calculations match the original.
- [ ] Temporal composites, legend ranges, chart and pixel inspector work.
- [ ] Transect and polygon statistics work.
- [ ] CSV, PNG, GIF, GeoTIFF, GeoJSON and reproducibility report exports work.
- [ ] Seasonal anomaly calculations and export work.
- [ ] Sentinel-1 controls fail gracefully when remote assets are unavailable; local RTC loading remains available.

Syntax checks are run for each extracted script. These checks do not replace live browser regression tests; those still need to be performed.
