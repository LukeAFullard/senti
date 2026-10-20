# Function-to-file migration map

This map records the current extraction boundaries and the intended next destination for reusable APIs. Current code remains in ordered classic scripts to preserve behaviour; the “next destination” column is a plan, not a claim that the function is already isolated.

| Existing responsibility / symbols | Current file | Next reusable boundary |
|---|---|---|
| GIF89a encoder (`encodeAnimatedGIF`, `lzwEncode`) | `js/01-runtime-and-map.js` | `export/gif.js`; pure encoder accepts canvases and delay, returns `Blob` |
| DOM references, input listeners, shared state, map setup, Leaflet Draw and point-selection interaction | `js/01-runtime-and-map.js` | `ui/app-shell.js`, `core/state.js`, `core/map.js`, `features/point-probes.js`; pass dependencies through an app context |
| CPU worker creation, CPU task execution, bounded concurrency | `js/01-runtime-and-map.js` | `core/workers.js`; make worker implementation injectable and expose lifecycle/cleanup |
| Scene metadata helpers, CRS parsing, bounds transforms, pixel-window calculations | `js/02-raster-and-index-analysis.js` | `core/projection.js`, `data/scene-metadata.js` |
| Band asset selection, band reads/scaling, SCL/cloud masking, index calculations | `js/02-raster-and-index-analysis.js` | `data/sentinel2.js`, `core/raster.js`, `analysis/indices.js`, `analysis/masking.js` |
| OPTRAM input sampling, calibration fit, edge interpolation, wetness calculation | `js/02-raster-and-index-analysis.js` | `features/optram.js` calling `analysis/statistics.js` and `core/raster.js` |
| Composite statistics, output grid steps, data-support count and rendering colour ramps | `js/03-composites-and-legend.js` | `analysis/statistics.js`, `analysis/timeseries.js`, `ui/legend.js`, `ui/layers.js` |
| Basemap tile fetching/stitching, extent warping, display panel rendering | `js/04-map-rendering.js` | `ui/map-renderer.js`; basemap capture should be an optional presentation service, not a dependency of analysis |
| Pixel inspector sampling from numeric/RGB grids | `js/05-pixel-inspector.js` | `features/pixel-inspector.js` using a standard raster-grid contract |
| Transect geometry, line sampling, polygon inclusion and summaries | `js/06-transects-polygon-stats-and-charts.js` | `features/transects.js`, `features/polygon-stats.js`, `analysis/statistics.js` |
| Chart construction and multi-point/temporal comparison | `js/06-transects-polygon-stats-and-charts.js` | `ui/charts.js` with chart data prepared by analysis services |
| Chunked STAC search, scene grouping/mosaics, main `runPipeline` orchestration | `js/07-scene-pipeline.js` | `data/stac-client.js`, `data/scene-loader.js`, `core/mosaic.js`, `app.js` orchestration |
| CSV/PNG/GIF and main action wiring | `js/07-scene-pipeline.js` plus `js/01-runtime-and-map.js` | `export/csv.js`, `export/images.js`, UI event wiring in feature modules |
| GeoJSON, GeoTIFF, reproducibility report, HTML escaping/download helper, OPTRAM diagnostics | `js/08-reports-and-geospatial-exports.js` | `export/geospatial.js`, `export/report.js`, `core/utils.js`, `features/optram.js` |
| Seasonal DOY window, numeric-grid resampling, anomaly baseline/score/overlay/export | `js/09-seasonal-anomaly-and-radar-discovery.js` | `analysis/anomalies.js` for pure calculations and `features/seasonal-anomalies.js` for UI/map/export |
| Sentinel-1 STAC search, asset signing, remote/local RTC reads, radar display and optical/radar comparison | `js/09-seasonal-anomaly-and-radar-discovery.js`, `js/10-radar-rendering-and-comparison.js` | `data/sentinel1.js`, `analysis/radar-analysis.js`, `features/radar-comparison.js`; keep optional and isolate provider auth/CORS limitations |

## Key contracts to define before further extraction

1. **Raster grid:** `data`, `width`, `height`, CRS, affine transform or origin/resolution, bounds, nodata and source metadata.
2. **Scene:** stable scene ID, acquisition timestamp, cloud metadata, collection/provider, asset references and properties.
3. **Analysis result:** metric ID/name, units, grid, validity/support mask, date/baseline metadata and method parameters.
4. **Feature lifecycle:** `registerFeature(appContext)` plus optional `dispose()`; feature owns its controls/handlers and cleans them up.
5. **Data-source contract:** search scenes and resolve/read assets; provider-specific URLs/auth remain inside the adapter.

## What was actually verified in this pass

- All ten extracted JavaScript files pass `node --check`.
- The extracted script bodies, when concatenated in the declared order, match the original inline JavaScript body; only file headers and additional per-script strict-mode directives were added.
- `index.html` references all ten files in order.
- A live Chromium smoke test could not be completed in this execution environment because navigation to the local HTTP server was blocked by the environment (`ERR_BLOCKED_BY_ADMINISTRATOR`). Do not treat the refactor as browser-regression-tested yet.
