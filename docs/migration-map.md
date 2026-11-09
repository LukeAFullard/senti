# Function-to-file migration map

This map records the current extraction boundaries and the intended next destination for reusable APIs. Current code remains in ordered classic scripts to preserve behaviour; the “next destination” column is a plan, not a claim that the function is already isolated.

| Existing responsibility / symbols | Current file | Next reusable boundary |
|---|---|---|
| GIF89a encoder (`encodeAnimatedGIF`, `lzwEncode`) | `js/01-runtime-and-map.js` | `export/gif.js`; pure encoder accepts canvases and delay, returns `Blob` |
| Universal Finite State Machine, lifecycle events, transition history, and agent snapshot APIs (`SentiStateMachine`) | `js/core/00-state-machine.js` | `core/state-machine.js`; pure deterministic FSM engine and pub/sub bus |
| DOM references, input listeners, shared state, map setup, Leaflet Draw and point-selection interaction | `js/01-runtime-and-map.js` | `ui/app-shell.js`, `core/state.js`, `core/map.js`, `features/point-probes.js`; pass dependencies through an app context |
| CPU worker pool, zero-copy buffer transfers, bounded concurrency, CPU task execution, and Otsu thresholding (`SentiWorkerPool`) | `js/core/00-worker-pool.js` | `core/worker-pool.js`; pure task handlers, injectable worker pool, and Otsu water/flood segmentation |
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
| GeoJSON, GeoTIFF, reproducibility report, HTML escaping/download helper, CSV builders (`SentiExportServices`) | `js/core/00-export-services.js` | `core/export-services.js`; pure GeoTIFF metadata, RFC 7946 GeoJSON, CSV, reproducibility report, and download services |
| Seasonal DOY window, numeric-grid resampling, anomaly baseline/score/overlay/export | `js/09-seasonal-anomaly-and-radar-discovery.js` | `analysis/anomalies.js` for pure calculations and `features/seasonal-anomalies.js` for UI/map/export |
| Sentinel-1 STAC search, asset signing, remote/local RTC reads, radar display and optical/radar comparison | `js/09-seasonal-anomaly-and-radar-discovery.js`, `js/10-radar-rendering-and-comparison.js` | `data/sentinel1.js`, `analysis/radar-analysis.js`, `features/radar-comparison.js`; keep optional and isolate provider auth/CORS limitations |
| Air quality optical proxy indices (ASI, NGAI, SPDI, CDI), Sen2Cor DDV fallback diagnostics, S5P TROPOMI trace gas gridding (NO₂, SO₂, CO, O₃, CH₄, HCHO, UVAI), unit conversion, and host app wrapping | `js/11-air-quality-module.js` | `features/air-quality.js`, `data/sentinel5p.js`, `analysis/atmospheric.js` |
| Standalone public air quality observatory application controller logic | `js/apps/aq-dashboard-app.js` | `apps/aq-observatory.js` |

## Key contracts to define before further extraction

1. **Raster grid:** `data`, `width`, `height`, CRS, affine transform or origin/resolution, bounds, nodata and source metadata.
2. **Scene:** stable scene ID, acquisition timestamp, cloud metadata, collection/provider, asset references and properties.
3. **Analysis result:** metric ID/name, units, grid, validity/support mask, date/baseline metadata and method parameters.
4. **Feature lifecycle:** `registerFeature(appContext)` plus optional `dispose()`; feature owns its controls/handlers and cleans them up.
5. **Data-source contract:** search scenes and resolve/read assets; provider-specific URLs/auth remain inside the adapter.

## What was actually verified in this pass

- All JavaScript files pass `node --check`.
- The pure core libraries `js/core/00-toolkit-core.js`, `js/core/00-stac-and-cog-reader.js`, `js/core/00-state-machine.js`, `js/core/00-worker-pool.js`, and `js/core/00-export-services.js` pass automated unit tests in `tests/test_toolkit_core.js` (7/7 tests passed), `tests/test_stac_and_cog_reader.js` (7/7 tests passed), `tests/test_state_machine.js` (10/10 tests passed), `tests/test_worker_pool.js` (10/10 tests passed), and `tests/test_export_services.js` (9/9 tests passed).
- The air quality module `js/11-air-quality-module.js` passes all 15 automated test suites in `tests/test_air_quality.js` including pixel metrics, grid calculation with masking, Sen2Cor DDV fallback diagnostics, trace gas unit conversion, color ramps, host app registration, Web Worker interception, live/mock STAC query formation, NetCDF swath gridding, Sentinel-2 / Sentinel-5P time series loading, multi-sensor grid correlation, and OpenAQ ground monitor fetching.
- Simulated sequential script execution in classic order verified no unhandled globals or collisions.
- HTML entries (`index.html`, `air-quality-dashboard.html`, `test-app.html`) load modules in correct dependency order.

