// Extracted from the original single-file app.
// Load order is significant; see ../README.md before moving/removing scripts.
// Runtime, DOM references, shared state, map setup and interaction

'use strict';

  'use strict';

  // ============================================================================
  // Self-Contained GIF89a Encoder (Zero External Dependencies)
  // ============================================================================
  const encodeAnimatedGIF = window.SentiToolkitCore.encodeAnimatedGIF;

  // ============================================================================
  // DOM & Application State
  // ============================================================================
  const logOutput = document.getElementById('logOutput');
  const runBtn = document.getElementById('runBtn');
  const plotAllBtn = document.getElementById('plotAllBtn');
  const csvBtn = document.getElementById('csvBtn');
  const pngBtn = document.getElementById('pngBtn');
  const gifBtn = document.getElementById('gifBtn');
  const geoTiffBtn = document.getElementById('geoTiffBtn');
  const geoJsonBtn = document.getElementById('geoJsonBtn');
  const reportBtn = document.getElementById('reportBtn');
  const optramDiagnosticsBtn = document.getElementById('optramDiagnosticsBtn');
  const optramDiagnosticsText = document.getElementById('optramDiagnosticsText');
  const optramDiagnostics = document.getElementById('optramDiagnostics');
  const radarMode = document.getElementById('radarMode');
  const radarSceneSelect = document.getElementById('radarSceneSelect');
  const radarBaselineSelect = document.getElementById('radarBaselineSelect');
  const radarCompareBtn = document.getElementById('radarCompareBtn');
  const radarCompareClearBtn = document.getElementById('radarCompareClearBtn');
  const radarCompareStatus = document.getElementById('radarCompareStatus');
  const radarCompareLegend = document.getElementById('radarCompareLegend');
  const radarLocalCurrentCoInput = document.getElementById('radarLocalCurrentCo');
  const radarLocalCurrentCrossInput = document.getElementById('radarLocalCurrentCross');
  const radarLocalCurrentDateInput = document.getElementById('radarLocalCurrentDate');
  const radarLocalBaseCoInput = document.getElementById('radarLocalBaseCo');
  const radarLocalBaseCrossInput = document.getElementById('radarLocalBaseCross');
  const radarLocalBaseDateInput = document.getElementById('radarLocalBaseDate');
  const radarLocalEncodingSelect = document.getElementById('radarLocalEncoding');
  const radarLoadLocalBtn = document.getElementById('radarLoadLocalBtn');
  const radarLocalStatus = document.getElementById('radarLocalStatus');
  const opticalDeltaThresholdInput = document.getElementById('opticalDeltaThreshold');
  const radarDeltaThresholdInput = document.getElementById('radarDeltaThreshold');
  const seasonalAnomalyBtn = document.getElementById('seasonalAnomalyBtn');
  const clearAnomalyBtn = document.getElementById('clearAnomalyBtn');
  const exportAnomalyBtn = document.getElementById('exportAnomalyBtn');
  const seasonalAnomalyStatus = document.getElementById('seasonalAnomalyStatus');
  const seasonalAnomalyLegend = document.getElementById('seasonalAnomalyLegend');
  const anomalyWindowDaysInput = document.getElementById('anomalyWindowDays');
  const anomalyMinObservationsInput = document.getElementById('anomalyMinObservations');
  const anomalyZLimitInput = document.getElementById('anomalyZLimit');
  const radarSearchBtn = document.getElementById('radarSearchBtn');
  const radarRenderBtn = document.getElementById('radarRenderBtn');
  const radarClearBtn = document.getElementById('radarClearBtn');
  const radarStatus = document.getElementById('radarStatus');
  const outputMode = document.getElementById('outputMode');
  const temporalMode = document.getElementById('temporalMode');
  const compositeConfigBox = document.getElementById('compositeConfigBox');
  const compositeStat = document.getElementById('compositeStat');
  const percentileBox = document.getElementById('percentileBox');
  const percentileVal = document.getElementById('percentileVal');
  const gridLayout = document.getElementById('gridLayout');
  const gridConfigBox = document.getElementById('gridConfigBox');
  const modePanel2 = document.getElementById('modePanel2');
  const modePanel3 = document.getElementById('modePanel3');
  const modePanel4 = document.getElementById('modePanel4');
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  const maxCloudInput = document.getElementById('maxCloud');
  const cloudValLabel = document.getElementById('cloudVal');
  const sceneLimitInput = document.getElementById('sceneLimit');
  const allScenesChk = document.getElementById('allScenesChk');
  const polygonStatsContent = document.getElementById('polygonStatsContent');
  const optramPersistenceControls = document.getElementById('optramPersistenceControls');
  const optramPersistenceBtn = document.getElementById('optramPersistenceBtn');
  const optramPersistenceContent = document.getElementById('optramPersistenceContent');
  const optramWetThresholdInput = document.getElementById('optramWetThreshold');
  const maskCloudsChk = document.getElementById('maskCloudsChk');
  const waterOnlyChk = document.getElementById('waterOnlyChk');
  const waterMaskThresholdInput = document.getElementById('waterMaskThreshold');
  const includeBasemapChk = document.getElementById('includeBasemapChk');
  const transectSamplesInput = document.getElementById('transectSamples');
  const auto10mChk = document.getElementById('auto10mChk');
  const opacitySlider = document.getElementById('opacitySlider');
  const inspectorText = document.getElementById('inspectorText');
  const sliderBox = document.getElementById('sliderBox');
  const sceneSlider = document.getElementById('sceneSlider');
  const sceneCounter = document.getElementById('sceneCounter');
  const sceneMetaLabel = document.getElementById('sceneMetaLabel');
  const diffModeChk = document.getElementById('diffModeChk');
  const baselineSelect = document.getElementById('baselineSelect');
  const canvas = document.getElementById('ndviCanvas');
  const legend = document.getElementById('legend');
  const resultTitle = document.getElementById('resultTitle');
  const resultHint = document.getElementById('resultHint');

  document.getElementById('helpBtn').addEventListener('click', () => document.getElementById('helpModal').showModal());
  maxCloudInput.addEventListener('input', () => { cloudValLabel.textContent = maxCloudInput.value; });
  allScenesChk.addEventListener('change', () => {
    sceneLimitInput.disabled = allScenesChk.checked;
    sceneLimitInput.setAttribute('aria-disabled', String(allScenesChk.checked));
  });
  allScenesChk.dispatchEvent(new Event('change'));
  auto10mChk.addEventListener('change', () => {
    transectSamplesInput.disabled = auto10mChk.checked;
    if (probeLine) updateChart();
  });
  transectSamplesInput.disabled = auto10mChk.checked;
  transectSamplesInput.addEventListener('change', () => { if (probeLine) updateChart(); });

  gridLayout.addEventListener('change', () => {
    const val = gridLayout.value;
    gridConfigBox.style.display = val === '1x1' ? 'none' : 'grid';
    document.querySelectorAll('.quad-only').forEach(el => {
      el.style.display = val === '2x2' ? 'block' : 'none';
    });
    if (displaySteps.length > 0) displayStepByIndex(Number(sceneSlider.value));
  });

  temporalMode.addEventListener('change', () => {
    const isComp = temporalMode.value !== 'single';
    compositeConfigBox.style.display = isComp ? 'grid' : 'none';
    s2PipelineMachine?.send('CHANGE_TEMPORAL', { temporalMode: temporalMode.value });
    if (validScenes.length > 0) {
      rebuildDisplaySteps();
      displayStepByIndex(Number(sceneSlider.value));
    }
  });

  compositeStat.addEventListener('change', () => {
    percentileBox.style.display = compositeStat.value === 'percentile' ? 'block' : 'none';
    compositeCache.clear();
    if (displaySteps.length > 0) displayStepByIndex(Number(sceneSlider.value));
  });

  percentileVal.addEventListener('change', () => {
    compositeCache.clear();
    if (displaySteps.length > 0) displayStepByIndex(Number(sceneSlider.value));
  });

  const STAC_SEARCH_URL = 'https://earth-search.aws.element84.com/v1/search';
  const STAC_COLLECTION = 'sentinel-2-c1-l2a';
  const MAX_OUTPUT_DIMENSION = 640;
  const MAX_MAP_OVERLAY_DIMENSION = 480;
  const BBOX_EDGE_SEGMENTS = 28;

  // GeoTIFF's decoder pool parallelises supported decompression work in Web Workers.
  // Initialise it lazily on the first raster read, not at page startup: map/UI
  // initialisation must still work if the browser blocks workers or the CDN fails.
  const HARDWARE_THREADS = Math.max(1, Number(navigator.hardwareConcurrency) || 2);
  const DEVICE_MEMORY_GB = Number(navigator.deviceMemory) || 4;
  const GEO_TIFF_WORKERS = Math.max(1, Math.min(4, HARDWARE_THREADS - 1, DEVICE_MEMORY_GB <= 2 ? 1 : 4));
  const SCENE_CONCURRENCY = Math.max(1, Math.min(3, HARDWARE_THREADS >= 8 && DEVICE_MEMORY_GB >= 8 ? 3 : 2));
  let geotiffPool = null;
  let geotiffPoolAttempted = false;

  function rasterReadOptions(options) {
    if (!geotiffPoolAttempted) {
      geotiffPoolAttempted = true;
      try {
        if (typeof GeoTIFF !== 'undefined' && typeof GeoTIFF.Pool === 'function') {
          geotiffPool = new GeoTIFF.Pool(GEO_TIFF_WORKERS);
        }
      } catch (err) {
        console.warn('GeoTIFF worker pool unavailable; using normal raster decoding.', err);
        geotiffPool = null;
      }
    }
    return geotiffPool ? { ...options, pool: geotiffPool } : options;
  }

  // Offload CPU-heavy per-pixel calculations to SentiWorkerPool.
  // SentiWorkerPool manages lazy Web Worker initialization, zero-copy buffer transfers,
  // concurrency pooling, and graceful fallback to the main thread.
  let cpuWorker = null;
  let cpuWorkerAttempted = false;

  function runCpuWorkerTask(type, payload) {
    cpuWorkerAttempted = true;
    if (typeof SentiWorkerPool !== 'undefined') {
      const status = SentiWorkerPool.getStatus();
      cpuWorker = status.isSupported ? true : null;
      return SentiWorkerPool.runTask(type, payload);
    }
    return Promise.reject(new Error('SentiWorkerPool module is not loaded.'));
  }

  // Run async jobs in small batches to balance network latency against memory use.
  const mapConcurrent = window.SentiToolkitCore.mapConcurrent;
  const LRUCache = window.SentiToolkitCore.LRUCache;

  proj4.defs('EPSG:3857', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs');

  let drawnBbox = null;
  let pipelineGeneration = 0;
  let probePoints = []; // [{ id, label, lon, lat, layer }]
  let nextProbePointId = 1;
  let pointSelectionMode = false;
  let probeLine = null;
  let probeLineLayer = null;
  let probePolygon = null;
  let probePolygonLayer = null;
  let resultOverlay = null;
  const pointStatus = document.getElementById('pointStatus');
  const clearPointsBtn = document.getElementById('clearPointsBtn');
  const pointModeBtn = document.getElementById('pointModeBtn');
  const POINT_LINE_COLORS = ['#7ce38b', '#ffcc66', '#f28bff', '#6de0e8', '#ff7d7d', '#b5a0ff', '#a6d96a', '#f4a261', '#80b1d3', '#e78ac3', '#c9a227', '#8dd3c7'];
  let validScenes = [];
  let displaySteps = [];
  let activeRenderedState = null;

  // ============================================================================
  // Explicit Finite State Machines (UX, DX, and AX)
  // ============================================================================
  const s2PipelineMachine = (typeof SentiStateMachine !== 'undefined' && SentiStateMachine.createMachine)
    ? SentiStateMachine.createMachine(SentiStateMachine.schemas.S2_PIPELINE)
    : null;

  const mapInteractionMachine = (typeof SentiStateMachine !== 'undefined' && SentiStateMachine.createMachine)
    ? SentiStateMachine.createMachine(SentiStateMachine.schemas.MAP_INTERACTION)
    : null;

  if (typeof window !== 'undefined') {
    window.s2PipelineMachine = s2PipelineMachine;
    window.mapInteractionMachine = mapInteractionMachine;
  }

  // Subscribe UI to Pipeline State transitions for deterministic button & ARIA states
  if (s2PipelineMachine) {
    s2PipelineMachine.subscribe((state, prev, event) => {
      const isBusy = (state === 'SEARCHING_STAC' || state === 'LOADING_DATA' || state === 'RENDERING_SCENE');
      if (runBtn) {
        runBtn.disabled = isBusy || !drawnBbox;
        runBtn.setAttribute('aria-busy', String(isBusy));
      }
      if (state === 'DISPLAY_READY') {
        if (pngBtn) pngBtn.disabled = !activeRenderedState;
      }
    });
  }

  const sceneRawCache = new LRUCache(12);
  const compositeCache = new LRUCache(6);
  let optramCalibration = null;
  let optramCalibrationPromise = null;
  let optramPersistenceRunning = false;
  const basemapCanvasCache = new Map();
  let chartInstance = null;

  const basemapDefs = {
    'Esri World Imagery': {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: { attribution: 'Tiles &copy; Esri', maxZoom: 19, crossOrigin: 'anonymous' }
    },
    'Esri Dark Gray Canvas': {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      options: { attribution: 'Tiles &copy; Esri', maxZoom: 16, crossOrigin: 'anonymous' }
    },
    'Esri Light Gray Canvas': {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      options: { attribution: 'Tiles &copy; Esri', maxZoom: 16, crossOrigin: 'anonymous' }
    },
    'Esri World Topo Map': {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      options: { attribution: 'Tiles &copy; Esri', maxZoom: 18, crossOrigin: 'anonymous' }
    },
    'Esri World Street Map': {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      options: { attribution: 'Tiles &copy; Esri', maxZoom: 18, crossOrigin: 'anonymous' }
    }
  };

  // Compatibility aliases so any legacy or cached basemap names resolve to free Esri tiles without error
  const legacyBasemapAliases = {
    'CartoDB Dark Matter': 'Esri Dark Gray Canvas',
    'OpenStreetMap': 'Esri World Street Map',
    'OpenTopoMap': 'Esri World Topo Map'
  };
  if (typeof window !== 'undefined') {
    window.legacyBasemapAliases = legacyBasemapAliases;
  }

  let activeBasemapName = 'Esri World Imagery';
  const basemaps = {};
  for (const [name, def] of Object.entries(basemapDefs)) {
    basemaps[name] = L.tileLayer(def.url, def.options);
  }

  const map = L.map('map', { layers: [basemaps[activeBasemapName]] }).setView([-40.35, 175.61], 12);
  L.control.layers(basemaps, null, { position: 'topright' }).addTo(map);

  map.on('baselayerchange', function (e) {
    activeBasemapName = e.name;
    basemapCanvasCache.clear();
    if (includeBasemapChk.checked && displaySteps.length > 0) {
      displayStepByIndex(Number(sceneSlider.value));
    }
  });

  map.createPane('resultPane');
  map.getPane('resultPane').style.zIndex = '350';
  map.createPane('radarPane');
  map.getPane('radarPane').style.zIndex = '360';
  map.createPane('anomalyPane');
  map.getPane('anomalyPane').style.zIndex = '370';
  map.createPane('radarComparePane');
  map.getPane('radarComparePane').style.zIndex = '380';
  map.createPane('s5pPane');
  map.getPane('s5pPane').style.zIndex = '365';

  let radarScenes = [];
  const radarLocalItems = [];
  let radarOverlay = null;
  let radarCompareOverlay = null;
  let seasonalAnomalyOverlay = null;
  let seasonalAnomalyResult = null;
  const radarRawCache = new Map();
  let optramCalibrationChart = null;
  const dataSupportCache = new Map();

  const aoiGroup = new L.FeatureGroup().addTo(map);
  const probeGroup = new L.FeatureGroup().addTo(map);

  map.addControl(new L.Control.Draw({
    draw: {
      // Leaflet.Draw 1.0.4 can throw inside GeometryUtil.readableArea while
      // updating rectangle/polygon tooltips in some browsers. Because that call
      // happens before the shape is rendered, the drag appears stuck and the
      // shape may never complete. Disable the built-in area tooltip; the app's
      // own AOI/zonal-statistics UI provides analysis information after drawing.
      polygon: { shapeOptions: { color: '#b77cff', weight: 2.5, fillOpacity: 0.16 }, showArea: false },
      circle: false, circlemarker: false,
      rectangle: { shapeOptions: { color: '#4daafc', weight: 2.5, fillOpacity: 0.04 }, showArea: false },
      polyline: { shapeOptions: { color: '#ffcc00', weight: 3 } },
      marker: true
    },
    edit: { featureGroup: probeGroup, remove: true }
  }));

  function updatePointStatus() {
    pointStatus.textContent = `Selected comparison points: ${probePoints.length}` +
      (probePoints.length ? ` (${probePoints.map(p => p.label).join(', ')})` : '');
    clearPointsBtn.disabled = probePoints.length === 0;
  }

  function clearProbeSelection() {
    probeGroup.clearLayers();
    probePoints = [];
    probeLine = null;
    probeLineLayer = null;
    probePolygon = null;
    probePolygonLayer = null;
    updatePointStatus();
    if (mapInteractionMachine) {
      if (mapInteractionMachine.getState() === 'POINT_PROBING') {
        mapInteractionMachine.send('CLEAR_POINTS');
      } else if (mapInteractionMachine.getState() === 'TRANSECT_ACTIVE') {
        mapInteractionMachine.send('CLEAR_TRANSECT');
      } else if (mapInteractionMachine.getState() === 'POLYGON_ACTIVE') {
        mapInteractionMachine.send('CLEAR_POLYGON');
      }
    }
  }

  function setPointSelectionMode(enabled) {
    pointSelectionMode = Boolean(enabled);
    if (pointSelectionMode) {
      mapInteractionMachine?.send('ENABLE_POINT_MODE');
    } else if (mapInteractionMachine?.getState() === 'POINT_PROBING') {
      mapInteractionMachine.send('DISABLE_POINT_MODE');
    }
    pointModeBtn.setAttribute('aria-pressed', String(pointSelectionMode));
    pointModeBtn.textContent = pointSelectionMode ? 'Click-to-Add Points: ON' : 'Enable Click-to-Add Points';
    pointModeBtn.style.background = pointSelectionMode ? '#247a46' : '';
    map.getContainer().style.cursor = pointSelectionMode ? 'crosshair' : '';
  }

  function addComparisonPoint(layer) {
    // Point mode is exclusive with a transect or summary polygon. Existing points are retained.
    if (probeLine || probePolygon) clearProbeSelection();
    const ll = layer.getLatLng();
    const id = nextProbePointId++;
    const point = { id: `P${id}`, label: `Point ${id}`, lon: ll.lng, lat: ll.lat, layer };
    point.layer.bindTooltip(point.label, { permanent: true, direction: 'top', offset: [0, -8] });
    probePoints.push(point);
    probeGroup.addLayer(layer);
    updatePointStatus();
    updateCsvButtonState();
    updatePolygonStatsPanel(activeRenderedState?.raw || null, activeRenderedState?.inspectGrid || null);
    log(`${point.label} added at [${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}]. ${probePoints.length} point(s) selected.`);
    updateChart();
  }

  pointModeBtn.addEventListener('click', () => setPointSelectionMode(!pointSelectionMode));
  map.on('click', function (event) {
    if (!pointSelectionMode) return;
    addComparisonPoint(L.marker(event.latlng));
  });
  // Avoid interpreting vertices from a rectangle, line or polygon drawing as comparison points.
  let currentDrawHandler = null;
  // Instead of relying on e.handler (which is missing in some Leaflet.Draw versions on drawstart),
  // Leaflet.Draw attaches the handler to map under map._toolbars... or map.on.
  // Actually, we can just trigger the disable on the map instance safely by clearing drawing state.
  map.on('draw:drawstart', function (e) {
    setPointSelectionMode(false);
    const layerType = e.layerType;
    if (layerType === 'rectangle') {
      mapInteractionMachine?.send('DRAW_AOI_START');
    } else if (layerType === 'polyline') {
      mapInteractionMachine?.send('DRAW_TRANSECT_START');
    } else if (layerType === 'polygon') {
      mapInteractionMachine?.send(drawnBbox ? 'DRAW_POLYGON_START' : 'DRAW_AOI_START');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.keyCode === 27) {
      // Leaflet.Draw natively supports firing a toolbar cancel if we access it,
      // but an easier robust fallback is to dispatch a custom disable if it's active.
      if (window.L && L.Draw && L.Draw.Event) {
          // If a drawing is in progress, any Leaflet vector draw handler listens to cancel.
          const toolbars = Object.values(map._toolbars || {});
          for (const tb of toolbars) {
             if (tb && typeof tb.disable === 'function') tb.disable();
          }
      }
      setPointSelectionMode(false);
      mapInteractionMachine?.send('CANCEL');
    }
  });

  map.on(L.Draw.Event.CREATED, function (event) {
    const type = event.layerType;
    const layer = event.layer;

    if (type === 'rectangle') {
      aoiGroup.clearLayers();
      clearProbeSelection();
      resetResults();
      updatePolygonStatsPanel(null, null);
      clearRadarOverlay();
      radarScenes = []; radarRawCache.clear();
      radarSceneSelect.innerHTML = '<option value="">Search for RTC scenes first</option>';
      radarBaselineSelect.innerHTML = '<option value="">Search for at least two scenes</option>';
      radarSceneSelect.disabled = true; radarBaselineSelect.disabled = true; radarRenderBtn.disabled = true; radarCompareBtn.disabled = true; radarStatus.textContent = 'AOI changed; search Sentinel-1 RTC again.';
      clearRadarCompareOverlay();
      aoiGroup.addLayer(layer);
      const b = layer.getBounds();
      drawnBbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      s2PipelineMachine?.send('SET_AOI', { bbox: drawnBbox });
      mapInteractionMachine?.send('AOI_COMPLETE');
      log('AOI Rectangle set: ' + drawnBbox.map(v => v.toFixed(5)).join(', '));
      runBtn.disabled = false;
      runBtn.textContent = 'Search & Render Scenes';
      map.fitBounds(b, { padding: [18, 18], maxZoom: 15 });
    } else if (type === 'polygon' && (!probePolygon || probePolygon.length === 0 || !drawnBbox)) {
      // Treat the first polygon or a polygon drawn when no AOI exists as the main Analysis AOI
      aoiGroup.clearLayers();
      clearProbeSelection();
      resetResults();
      updatePolygonStatsPanel(null, null);
      clearRadarOverlay();
      radarScenes = []; radarRawCache.clear();
      radarSceneSelect.innerHTML = '<option value="">Search for RTC scenes first</option>';
      radarBaselineSelect.innerHTML = '<option value="">Search for at least two scenes</option>';
      radarSceneSelect.disabled = true; radarBaselineSelect.disabled = true; radarRenderBtn.disabled = true; radarCompareBtn.disabled = true; radarStatus.textContent = 'AOI changed; search Sentinel-1 RTC again.';
      clearRadarCompareOverlay();

      aoiGroup.addLayer(layer);

      const rings = layer.getLatLngs();
      const outerRing = Array.isArray(rings[0]) ? rings[0] : rings;
      probePolygonLayer = layer;
      probePolygon = outerRing.map(ll => [ll.lng, ll.lat]);

      const b = layer.getBounds();
      drawnBbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      s2PipelineMachine?.send('SET_AOI', { bbox: drawnBbox });
      mapInteractionMachine?.send('AOI_COMPLETE');

      log(`Analysis Polygon AOI set (${probePolygon.length} edges). BBox: ` + drawnBbox.map(v => v.toFixed(5)).join(', '));
      runBtn.disabled = false;
      runBtn.textContent = 'Search & Render Scenes';
      map.fitBounds(b, { padding: [18, 18], maxZoom: 15 });
    } else if (type === 'marker') {
      addComparisonPoint(layer);
    } else if (type === 'polyline') {
      clearProbeSelection();
      probeGroup.addLayer(layer);
      probeLineLayer = layer;
      probeLine = layer.getLatLngs().map(ll => [ll.lng, ll.lat]);
      mapInteractionMachine?.send('TRANSECT_COMPLETE');
      updateCsvButtonState();
      updatePolygonStatsPanel(activeRenderedState?.raw || null, activeRenderedState?.inspectGrid || null);
      log(`Transect line drawn (${probeLine.length} vertices).`);
      updateChart();
    } else if (type === 'polygon') {
      clearProbeSelection();
      probeGroup.addLayer(layer);
      probePolygonLayer = layer;
      const rings = layer.getLatLngs();
      const outerRing = Array.isArray(rings[0]) ? rings[0] : rings;
      probePolygon = outerRing.map(ll => [ll.lng, ll.lat]);
      mapInteractionMachine?.send('POLYGON_COMPLETE');
      updateCsvButtonState();
      log(`Summary polygon drawn (${Math.max(0, probePolygon.length)} edges).`);
      updatePolygonStatsPanel(activeRenderedState?.raw || null, activeRenderedState?.inspectGrid || null);
      updateChart();
    }
  });

  map.on(L.Draw.Event.DELETED, function (event) {
    event.layers.eachLayer(layer => {
      probePoints = probePoints.filter(point => point.layer !== layer);
      if (layer === probeLineLayer) { probeLine = null; probeLineLayer = null; }
      if (layer === probePolygonLayer) { probePolygon = null; probePolygonLayer = null; }
    });
    updatePointStatus();
    updateCsvButtonState();
    updatePolygonStatsPanel(activeRenderedState?.raw || null, activeRenderedState?.inspectGrid || null);
    updateChart();
  });

  map.on(L.Draw.Event.EDITED, function (event) {
    event.layers.eachLayer(layer => {
      if (layer instanceof L.Marker) {
        const ll = layer.getLatLng();
        const point = probePoints.find(p => p.layer === layer);
        if (point) { point.lon = ll.lng; point.lat = ll.lat; }
      } else if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
        probeLineLayer = layer;
        probeLine = layer.getLatLngs().map(ll => [ll.lng, ll.lat]);
      } else if (layer instanceof L.Polygon) {
        probePolygonLayer = layer;
        const rings = layer.getLatLngs();
        const outerRing = Array.isArray(rings[0]) ? rings[0] : rings;
        probePolygon = outerRing.map(ll => [ll.lng, ll.lat]);
      }
    });
    updatePointStatus();
    updateCsvButtonState();
    updatePolygonStatsPanel(activeRenderedState?.raw || null, activeRenderedState?.inspectGrid || null);
    updateChart();
  });

  clearPointsBtn.addEventListener('click', () => {
    // Clear only markers; leave an active transect/polygon untouched (normally these are exclusive).
    for (const point of probePoints) probeGroup.removeLayer(point.layer);
    probePoints = [];
    updatePointStatus();
    updateCsvButtonState();
    updateChart();
    log('Comparison points cleared.');
  });
  updatePointStatus();

  opacitySlider.addEventListener('input', () => {
    if (resultOverlay) resultOverlay.setOpacity(Number(opacitySlider.value));
    if (includeBasemapChk.checked && displaySteps.length > 0) {
      displayStepByIndex(Number(sceneSlider.value));
    }
  });

  if (typeof window !== 'undefined') {
    window.runCpuWorkerTask = runCpuWorkerTask;
    Object.defineProperty(window, 'map', { get: () => map, configurable: true });
    Object.defineProperty(window, 'drawnBbox', {
      get: () => drawnBbox,
      set: (val) => { drawnBbox = val; },
      configurable: true
    });
    Object.defineProperty(window, 'activeRenderedState', {
      get: () => activeRenderedState,
      configurable: true
    });
    Object.defineProperty(window, 'legend', { get: () => legend, configurable: true });
  }
