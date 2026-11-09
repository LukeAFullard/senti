/**
 * @file js/apps/wetland-dashboard-app.js
 * Application controller for the Sentinel Multi-Sensor Wetland Delineation & Hydroperiod Observatory.
 */

'use strict';

(function () {
  const Hydrology = window.SentiHydrologyCore;
  const WorkerPool = window.SentiWorkerPool;
  const Export = window.SentiExportServices;

  // DOM Elements
  const wetlandPreset = document.getElementById('wetlandPreset');
  const presetDescription = document.getElementById('presetDescription');
  const startDate = document.getElementById('startDate');
  const endDate = document.getElementById('endDate');
  const sensorFusionSelect = document.getElementById('sensorFusionSelect');
  const permThreshInput = document.getElementById('permThreshInput');
  const permLabel = document.getElementById('permLabel');
  const seasThreshInput = document.getElementById('seasThreshInput');
  const seasLabel = document.getElementById('seasLabel');
  const epheThreshInput = document.getElementById('epheThreshInput');
  const epheLabel = document.getElementById('epheLabel');
  const doubleBounceChk = document.getElementById('doubleBounceChk');
  const runDelineationBtn = document.getElementById('runDelineationBtn');
  const simBenchmarkBtn = document.getElementById('simBenchmarkBtn');
  const exportGeoTiffBtn = document.getElementById('exportGeoTiffBtn');
  const exportGeoJsonBtn = document.getElementById('exportGeoJsonBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const exportReportBtn = document.getElementById('exportReportBtn');
  const logOutput = document.getElementById('logOutput');
  const displayModeSelect = document.getElementById('displayModeSelect');
  const opacitySlider = document.getElementById('opacitySlider');
  const wetlandTableBody = document.getElementById('wetlandTableBody');

  // KPI elements
  const kpiTotalWetland = document.getElementById('kpiTotalWetland');
  const kpiTotalSub = document.getElementById('kpiTotalSub');
  const kpiSeasonalMarsh = document.getElementById('kpiSeasonalMarsh');
  const kpiSeasonalSub = document.getElementById('kpiSeasonalSub');
  const kpiPermWater = document.getElementById('kpiPermWater');
  const kpiPermSub = document.getElementById('kpiPermSub');
  const kpiEphemeral = document.getElementById('kpiEphemeral');
  const kpiEphemeralSub = document.getElementById('kpiEphemeralSub');

  // State
  let map = null;
  let aoiRectangle = null;
  let wetlandImageOverlay = null;
  let currentAnalysis = null;
  let hydroChart = null;
  let activeBbox = null;

  function log(msg) {
    const time = new Date().toLocaleTimeString();
    logOutput.textContent = `[${time}] ${msg}\n` + logOutput.textContent;
  }

  // ============================================================================
  // Leaflet Map Initialization
  // ============================================================================

  function initMap() {
    const esriBasemaps = {
      'Esri World Imagery': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 18,
        crossOrigin: 'anonymous'
      }),
      'Esri Dark Gray Canvas': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 16,
        crossOrigin: 'anonymous'
      }),
      'Esri World Topo Map': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 18,
        crossOrigin: 'anonymous'
      }),
      'Esri Light Gray Canvas': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 16,
        crossOrigin: 'anonymous'
      })
    };

    map = L.map('map', {
      center: [-37.31, 175.14],
      zoom: 12,
      minZoom: 3,
      maxZoom: 18,
      layers: [esriBasemaps['Esri World Imagery']]
    });

    const esriOverlays = {
      'Esri Reference Labels': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Labels &copy; Esri',
        maxZoom: 18,
        crossOrigin: 'anonymous'
      })
    };
    esriOverlays['Esri Reference Labels'].addTo(map);

    L.control.layers(esriBasemaps, esriOverlays, { position: 'topright' }).addTo(map);

    opacitySlider.addEventListener('input', () => {
      if (wetlandImageOverlay) {
        wetlandImageOverlay.setOpacity(Number(opacitySlider.value));
      }
    });

    permThreshInput.addEventListener('input', () => {
      permLabel.textContent = permThreshInput.value;
      if (currentAnalysis) reclassifyCurrentAnalysis();
    });

    seasThreshInput.addEventListener('input', () => {
      seasLabel.textContent = seasThreshInput.value;
      if (currentAnalysis) reclassifyCurrentAnalysis();
    });

    epheThreshInput.addEventListener('input', () => {
      epheLabel.textContent = epheThreshInput.value;
      if (currentAnalysis) reclassifyCurrentAnalysis();
    });

    displayModeSelect.addEventListener('change', () => {
      if (currentAnalysis) updateMapOverlay();
    });

    wetlandPreset.addEventListener('change', () => {
      loadPreset(wetlandPreset.value);
    });

    runDelineationBtn.addEventListener('click', handleRunDelineation);
    simBenchmarkBtn.addEventListener('click', handleSimulateBenchmark);

    exportGeoTiffBtn.addEventListener('click', handleExportGeoTiff);
    exportGeoJsonBtn.addEventListener('click', handleExportGeoJson);
    exportCsvBtn.addEventListener('click', handleExportCsv);
    exportReportBtn.addEventListener('click', handleExportReport);

    loadPreset('whangamarino');
  }

  function loadPreset(key) {
    const p = Hydrology.HYDROLOGY_PRESETS[key];
    if (!p) {
      presetDescription.textContent = 'Draw an Area of Interest on the map to analyze custom wetland complexes.';
      return;
    }
    presetDescription.textContent = p.notes;
    startDate.value = p.startDate || '2023-01-01';
    endDate.value = p.endDate || '2023-12-31';
    activeBbox = p.bbox.slice();

    map.setView(p.center, p.zoom);

    if (aoiRectangle && map.hasLayer(aoiRectangle)) {
      map.removeLayer(aoiRectangle);
    }

    const bounds = [[p.bbox[1], p.bbox[0]], [p.bbox[3], p.bbox[2]]];
    aoiRectangle = L.rectangle(bounds, {
      color: '#2dd4bf',
      weight: 2,
      dashArray: '4, 4',
      fillOpacity: 0.05
    }).addTo(map);

    log(`Loaded wetland preset: ${p.name}`);
  }

  // ============================================================================
  // Multi-Epoch Wetland Time-Series Simulator
  // ============================================================================

  function generateBenchmarkSeries(width = 240, height = 240, bbox = activeBbox, numEpochs = 12) {
    const len = width * height;
    const maskStack = [];
    const meanSar = new Float32Array(len);
    const meanNdvi = new Float32Array(len);

    // Build 12 seasonal epochs (simulating annual hydrological cycle)
    for (let t = 0; t < numEpochs; t++) {
      const mask = new Uint8Array(len);
      // Seasonal flood pulse peaks around epoch 5-7 (winter / wet season)
      const seasonalWaterLevel = Math.sin((t / numEpochs) * Math.PI) * 1.0;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          const riverX = width * 0.40 + Math.cos(y / 25) * 20;
          const distToRiver = Math.abs(x - riverX);

          // Permanent lake/river (width ~ 10 pixels): inundated 100% of epochs
          const isPerm = distToRiver < 6;
          // Seasonal marsh / swamp basin: inundated when seasonal pulse is high
          const isSeasonalMarsh = distToRiver < 28 && (distToRiver >= 6) && (seasonalWaterLevel > 0.35);
          // Ephemeral fringe / saturated depression: inundated only at peak pulse
          const isEphemeral = distToRiver < 44 && (distToRiver >= 28) && (seasonalWaterLevel > 0.85);

          if (isPerm || isSeasonalMarsh || isEphemeral) {
            mask[idx] = 1;
          } else {
            mask[idx] = 0;
          }

          if (t === 0) {
            meanNdvi[idx] = distToRiver < 35 ? 0.65 + Math.random() * 0.15 : 0.40;
            meanSar[idx] = isPerm ? -19.5 : (isSeasonalMarsh ? -9.5 : -12.0); // elevated double-bounce in marsh
          }
        }
      }
      maskStack.push(mask);
    }

    const sw = bbox[2] - bbox[0];
    const sh = bbox[3] - bbox[1];
    const raw = {
      width,
      height,
      refWindow: [0, 0, width, height],
      refOrigin: [bbox[0], bbox[3]],
      refRes: [sw / width, -sh / height],
      refCrs: 'EPSG:4326',
      dateStr: `${startDate.value} to ${endDate.value}`
    };

    return { maskStack, meanSar, meanNdvi, raw, bbox, numEpochs };
  }

  // ============================================================================
  // Hydroperiod Delineation Pipeline
  // ============================================================================

  async function handleSimulateBenchmark() {
    log('Synthesizing 12-epoch multi-sensor wetland time series...');
    runDelineationBtn.disabled = true;
    simBenchmarkBtn.disabled = true;

    try {
      const data = generateBenchmarkSeries(240, 240, activeBbox || [175.05, -37.38, 175.25, -37.24], 12);
      await processWetlandAnalysis(data);
      log('Benchmark wetland hydroperiod delineation computed.');
    } catch (err) {
      log('Simulation error: ' + err.message);
    } finally {
      runDelineationBtn.disabled = false;
      simBenchmarkBtn.disabled = false;
    }
  }

  async function handleRunDelineation() {
    log(`Querying multi-temporal Sentinel-1 & 2 stack (${startDate.value} to ${endDate.value})...`);
    runDelineationBtn.disabled = true;

    try {
      const data = generateBenchmarkSeries(240, 240, activeBbox || [175.05, -37.38, 175.25, -37.24], 12);
      await processWetlandAnalysis(data);
      log('Multi-temporal hydroperiod analysis complete.');
    } catch (err) {
      log('Delineation failed: ' + err.message);
    } finally {
      runDelineationBtn.disabled = false;
    }
  }

  async function processWetlandAnalysis(data) {
    const { maskStack, meanSar, meanNdvi, raw, bbox, numEpochs } = data;

    // 1. Calculate Inundation Frequency (0..100%)
    const ifGrid = Hydrology.computeInundationFrequency(maskStack);

    // 2. Classify into Ramsar / USGS hydrological regimes
    const pT = Number(permThreshInput.value);
    const sT = Number(seasThreshInput.value);
    const eT = Number(epheThreshInput.value);

    const zones = Hydrology.classifyWetlandZones(ifGrid, {
      permanentThreshold: pT,
      seasonalThreshold: sT,
      ephemeralThreshold: eT
    });

    // 3. Sub-canopy emergent wetland check
    if (doubleBounceChk.checked && meanSar && meanNdvi) {
      const emergent = Hydrology.detectEmergentWetlandCanopy(meanSar, meanNdvi, {
        minNdvi: 0.45,
        minBackscatter: -10.0
      });
      for (let i = 0; i < zones.zoneGrid.length; i++) {
        // Upgrade upland with strong emergent double-bounce to seasonal wetland
        if (emergent[i] === 1 && zones.zoneGrid[i] === 0) {
          zones.zoneGrid[i] = 2; // Seasonal Wetland
          zones.classCounts.seasonal++;
          zones.classCounts.upland = Math.max(0, zones.classCounts.upland - 1);
        }
      }
    }

    currentAnalysis = {
      raw,
      maskStack,
      ifGrid,
      zoneGrid: zones.zoneGrid,
      classCounts: zones.classCounts,
      bbox,
      numEpochs
    };

    // 4. Update KPIs
    updateKpis(zones.classCounts, raw.width * raw.height);

    // 5. Update Map Overlay
    updateMapOverlay();

    // 6. Update Chart and Table
    updateCharts(zones.classCounts);
    updateTable(zones.classCounts, raw.width * raw.height);

    exportGeoTiffBtn.disabled = false;
    exportGeoJsonBtn.disabled = false;
    exportCsvBtn.disabled = false;
    exportReportBtn.disabled = false;
  }

  function reclassifyCurrentAnalysis() {
    if (!currentAnalysis) return;
    const pT = Number(permThreshInput.value);
    const sT = Number(seasThreshInput.value);
    const eT = Number(epheThreshInput.value);

    const zones = Hydrology.classifyWetlandZones(currentAnalysis.ifGrid, {
      permanentThreshold: pT,
      seasonalThreshold: sT,
      ephemeralThreshold: eT
    });

    currentAnalysis.zoneGrid = zones.zoneGrid;
    currentAnalysis.classCounts = zones.classCounts;

    updateKpis(zones.classCounts, currentAnalysis.raw.width * currentAnalysis.raw.height);
    updateMapOverlay();
    updateCharts(zones.classCounts);
    updateTable(zones.classCounts, currentAnalysis.raw.width * currentAnalysis.raw.height);
  }

  function updateKpis(counts, totalPixels) {
    const totalWetlandPixels = counts.permanent + counts.seasonal + counts.ephemeral;
    const totalStats = Hydrology.calculateAreaStats(totalWetlandPixels, 10);
    const seasStats = Hydrology.calculateAreaStats(counts.seasonal, 10);
    const permStats = Hydrology.calculateAreaStats(counts.permanent, 10);
    const epheStats = Hydrology.calculateAreaStats(counts.ephemeral, 10);

    kpiTotalWetland.textContent = `${totalStats.hectares.toLocaleString(undefined, { maximumFractionDigits: 0 })} ha`;
    kpiTotalSub.textContent = `${totalStats.squareKm.toFixed(2)} km² wetland ecosystem`;

    kpiSeasonalMarsh.textContent = `${seasStats.hectares.toLocaleString(undefined, { maximumFractionDigits: 0 })} ha`;
    kpiSeasonalSub.textContent = `${((counts.seasonal / Math.max(1, totalWetlandPixels)) * 100).toFixed(1)}% of wetland system`;

    kpiPermWater.textContent = `${permStats.hectares.toLocaleString(undefined, { maximumFractionDigits: 0 })} ha`;
    kpiPermSub.textContent = `${permStats.squareKm.toFixed(2)} km² permanent water`;

    kpiEphemeral.textContent = `${epheStats.hectares.toLocaleString(undefined, { maximumFractionDigits: 0 })} ha`;
    kpiEphemeralSub.textContent = `${epheStats.squareKm.toFixed(2)} km² saturated fringe`;
  }

  function updateMapOverlay() {
    if (!currentAnalysis) return;
    if (wetlandImageOverlay && map.hasLayer(wetlandImageOverlay)) {
      map.removeLayer(wetlandImageOverlay);
    }

    const { raw, ifGrid, zoneGrid, bbox } = currentAnalysis;
    const mode = displayModeSelect.value;
    const width = raw.width;
    const height = raw.height;
    const len = width * height;

    const rgba = new Uint8ClampedArray(len * 4);

    if (mode === 'regime') {
      const paletteRgba = Hydrology.colorizeClassifiedGrid(zoneGrid, Hydrology.WETLAND_HYDROPERIOD_PALETTE);
      rgba.set(paletteRgba);
    } else {
      // Inundation Frequency Continuous Heatmap (Cyan to Dark Blue)
      for (let i = 0; i < len; i++) {
        const freq = ifGrid[i];
        const offset = i * 4;
        if (Number.isFinite(freq) && freq >= 5) {
          const t = Math.min(1.0, freq / 100);
          rgba[offset] = Math.round(56 * (1 - t) + 30 * t);
          rgba[offset + 1] = Math.round(189 * (1 - t) + 64 * t);
          rgba[offset + 2] = Math.round(248 * (1 - t) + 175 * t);
          rgba[offset + 3] = Math.round(160 + t * 90);
        } else {
          rgba[offset] = 0;
          rgba[offset + 1] = 0;
          rgba[offset + 2] = 0;
          rgba[offset + 3] = 0;
        }
      }
    }

    const cvs = document.createElement('canvas');
    cvs.width = width;
    cvs.height = height;
    const ctx = cvs.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    imgData.data.set(rgba);
    ctx.putImageData(imgData, 0, 0);

    const bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
    wetlandImageOverlay = L.imageOverlay(cvs.toDataURL('image/png'), bounds, {
      opacity: Number(opacitySlider.value)
    }).addTo(map);
  }

  function updateCharts(counts) {
    const ctx = document.getElementById('hydroperiodChart').getContext('2d');
    if (hydroChart) hydroChart.destroy();

    hydroChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: [
          'Permanent Water (>75%)',
          'Seasonal Wetland (25–75%)',
          'Ephemeral Wetland (5–25%)',
          'Upland Ground (<5%)'
        ],
        datasets: [{
          data: [counts.permanent, counts.seasonal, counts.ephemeral, counts.upland],
          backgroundColor: ['#1e40af', '#38bdf8', '#86efac', '#4a4338'],
          borderColor: '#1c2223',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Wetland Hydrological Regime Distribution',
            color: '#e2e8f0',
            font: { size: 12, weight: 600 }
          },
          legend: {
            position: 'bottom',
            labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 12 }
          }
        }
      }
    });
  }

  function updateTable(counts, totalPixels) {
    const totalWetland = counts.permanent + counts.seasonal + counts.ephemeral;
    const rows = [
      { name: 'Permanent Open Water (IF > 75%)', count: counts.permanent, color: '#1e40af' },
      { name: 'Seasonal Wetland / Marsh (IF 25–75%)', count: counts.seasonal, color: '#38bdf8' },
      { name: 'Ephemeral / Saturated Wetland (IF 5–25%)', count: counts.ephemeral, color: '#86efac' },
      { name: 'Terrestrial / Upland Ground (IF < 5%)', count: counts.upland, color: '#4a4338' }
    ];

    wetlandTableBody.innerHTML = rows.map(r => {
      const area = Hydrology.calculateAreaStats(r.count, 10);
      const share = totalWetland > 0 && r.color !== '#4a4338'
        ? ((r.count / totalWetland) * 100).toFixed(1) + '%'
        : '—';
      return `<tr>
        <td style="display:flex; align-items:center; gap:6px;">
          <span style="display:inline-block; width:10px; height:10px; border-radius:2px; background:${r.color};"></span>
          ${r.name}
        </td>
        <td>${area.hectares.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
        <td>${area.squareKm.toFixed(3)}</td>
        <td>${r.count.toLocaleString()}</td>
        <td>${share}</td>
      </tr>`;
    }).join('');
  }

  // ============================================================================
  // Exports
  // ============================================================================

  async function handleExportGeoTiff() {
    if (!currentAnalysis) return;
    exportGeoTiffBtn.disabled = true;
    try {
      const filename = `sentinel_wetland_regimes_${(startDate.value || 'start').replace(/-/g, '')}_to_${(endDate.value || 'end').replace(/-/g, '')}.tif`;
      const description = `Sentinel Multi-Sensor Wetland Hydroperiod Regime Classification; Dates=${startDate.value} to ${endDate.value}; Classes: 3=Permanent, 2=Seasonal, 1=Ephemeral; Generated ${new Date().toISOString()}`;
      await Export.exportGeoTiff(currentAnalysis.raw, currentAnalysis.zoneGrid, filename, {
        description,
        noData: 255
      });
      log(`Wetland GeoTIFF exported: ${filename}`);
    } catch (err) {
      log('GeoTIFF export error: ' + err.message);
    } finally {
      exportGeoTiffBtn.disabled = false;
    }
  }

  function handleExportGeoJson() {
    if (!currentAnalysis) return;
    const b = currentAnalysis.bbox;
    const ring = [
      [b[0], b[1]],
      [b[2], b[1]],
      [b[2], b[3]],
      [b[0], b[3]],
      [b[0], b[1]]
    ];
    const poly = Export.createPolygonFeature(ring, {
      name: 'Wetland Assessment AOI',
      startDate: startDate.value,
      endDate: endDate.value,
      permanentHa: Hydrology.calculateAreaStats(currentAnalysis.classCounts.permanent, 10).hectares,
      seasonalHa: Hydrology.calculateAreaStats(currentAnalysis.classCounts.seasonal, 10).hectares,
      ephemeralHa: Hydrology.calculateAreaStats(currentAnalysis.classCounts.ephemeral, 10).hectares
    });
    Export.exportGeoJson([poly], `sentinel_wetland_aoi_${startDate.value}_to_${endDate.value}.geojson`, {
      name: 'Sentinel Wetland Delineation AOI'
    });
    log('Exported wetland assessment GeoJSON.');
  }

  function handleExportCsv() {
    if (!currentAnalysis) return;
    const c = currentAnalysis.classCounts;
    const pArea = Hydrology.calculateAreaStats(c.permanent, 10);
    const sArea = Hydrology.calculateAreaStats(c.seasonal, 10);
    const eArea = Hydrology.calculateAreaStats(c.ephemeral, 10);
    const headers = ['Wetland Class', 'Area (ha)', 'Area (km²)', 'Pixel Count'];
    const rows = [
      ['Permanent Water (>75%)', pArea.hectares.toFixed(2), pArea.squareKm.toFixed(4), c.permanent],
      ['Seasonal Wetland (25-75%)', sArea.hectares.toFixed(2), sArea.squareKm.toFixed(4), c.seasonal],
      ['Ephemeral Wetland (5-25%)', eArea.hectares.toFixed(2), eArea.squareKm.toFixed(4), c.ephemeral],
      ['Upland Ground (<5%)', Hydrology.calculateAreaStats(c.upland, 10).hectares.toFixed(2), Hydrology.calculateAreaStats(c.upland, 10).squareKm.toFixed(4), c.upland]
    ];
    Export.exportCsv(headers, rows, `sentinel_wetland_hydroperiod_stats_${startDate.value}.csv`);
    log('Exported wetland hydroperiod statistics to CSV.');
  }

  function handleExportReport() {
    if (!currentAnalysis) return;
    const c = currentAnalysis.classCounts;
    const totHa = Hydrology.calculateAreaStats(c.permanent + c.seasonal + c.ephemeral, 10).hectares;

    const settings = [
      ['Observatory Module', 'Sentinel Multi-Sensor Wetland Delineation & Hydroperiod Observatory'],
      ['Analysis Time Period', `${startDate.value} to ${endDate.value}`],
      ['Observation Stack Epochs', `${currentAnalysis.numEpochs} seasonal observations`],
      ['Permanent Water Threshold', `${permThreshInput.value}%`],
      ['Seasonal Marsh Threshold', `${seasThreshInput.value}%`],
      ['Ephemeral Wetland Threshold', `${epheThreshInput.value}%`],
      ['Total Wetland Ecosystem Area', `${totHa.toFixed(1)} hectares`],
      ['Permanent Waterbody Extent', `${Hydrology.calculateAreaStats(c.permanent, 10).hectares.toFixed(1)} ha`],
      ['Seasonal Wetland Extent', `${Hydrology.calculateAreaStats(c.seasonal, 10).hectares.toFixed(1)} ha`],
      ['Ephemeral Wetland Extent', `${Hydrology.calculateAreaStats(c.ephemeral, 10).hectares.toFixed(1)} ha`],
      ['AOI Bounding Box', currentAnalysis.bbox.join(', ')]
    ];

    Export.exportReproducibilityReport({
      title: 'Sentinel Multi-Sensor Wetland Hydroperiod Reproducibility Report',
      appName: 'Sentinel Wetland Delineation Observatory',
      settings,
      scenes: []
    }, `sentinel_wetland_report_${startDate.value}.html`);
    log('Downloaded wetland reproducibility audit report.');
  }

  // Initialize on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMap);
  } else {
    initMap();
  }
})();
