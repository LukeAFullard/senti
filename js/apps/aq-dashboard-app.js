/**
 * @file js/apps/aq-dashboard-app.js
 * @description UI controller for the Public Satellite Air Quality & Trace Gas Observatory.
 */
(function () {
  'use strict';

  const PRESETS = {
    palmerston: { name: 'Palmerston North, NZ', bbox: [175.55, -40.42, 175.72, -40.30], zoom: 12 },
    auckland: { name: 'Auckland, NZ', bbox: [174.65, -37.00, 174.95, -36.75], zoom: 11 },
    sydney: { name: 'Sydney, Australia', bbox: [151.05, -33.95, 151.30, -33.75], zoom: 11 },
    la: { name: 'Los Angeles, USA', bbox: [-118.45, 33.90, -118.15, 34.15], zoom: 11 },
    delhi: { name: 'Delhi, India', bbox: [77.05, 28.50, 77.35, 28.75], zoom: 11 },
    po: { name: 'Po Valley, Italy', bbox: [9.80, 44.80, 10.40, 45.20], zoom: 10 },
    custom: { name: 'Custom BBox', bbox: [175.55, -40.42, 175.72, -40.30], zoom: 12 }
  };

  const GRID_W = 180;
  const GRID_H = 180;

  // State
  let map = null;
  let imageOverlay = null;
  let drawnBboxLayer = null;
  let transectLayer = null;
  let transectPoints = [];
  let isProbing = false;

  let loadedFrames = [];
  let loadedS2Frames = [];
  let loadedS5pFrames = [];
  let periodMedianGrid = null;
  let activeDisplayGrid = null;
  let activeBbox = PRESETS.palmerston.bbox.slice();
  let chartInstance = null;
  let activeChartMode = 'timeline';
  let openAqLayerGroup = null;
  let openAqVisible = false;

  // ============================================================================
  // Explicit Finite State Machine (UX, DX, and AX)
  // ============================================================================
  const aqMachine = (typeof SentiStateMachine !== 'undefined' && SentiStateMachine.createMachine)
    ? SentiStateMachine.createMachine(SentiStateMachine.schemas.AQ_DASHBOARD)
    : null;

  if (typeof window !== 'undefined') {
    window.aqDashboardMachine = aqMachine;
  }

  // DOM
  const el = id => document.getElementById(id);

  if (aqMachine) {
    aqMachine.subscribe((state, prev, event) => {
      const isBusy = (state === 'LOADING_DATA');
      const searchBtn = el('searchAndLoadBtn');
      if (searchBtn) {
        searchBtn.disabled = isBusy;
        searchBtn.setAttribute('aria-busy', String(isBusy));
      }
      const timelineBtn = el('showTimelineChartBtn');
      const corrBtn = el('showCorrelationChartBtn');
      if (timelineBtn && corrBtn) {
        timelineBtn.setAttribute('aria-pressed', String(state === 'DATA_LOADED'));
        corrBtn.setAttribute('aria-pressed', String(state === 'SCATTER_ANALYSIS'));
      }
    });
  }

  function log(msg) {
    const box = el('aqLog');
    if (!box) return;
    const ts = new Date().toLocaleTimeString();
    box.textContent += `[${ts}] ${msg}\n`;
    box.scrollTop = box.scrollHeight;
  }

  function initMap() {
    if (typeof L === 'undefined') return;
    const initial = PRESETS.palmerston;
    const center = [(initial.bbox[1] + initial.bbox[3]) / 2, (initial.bbox[0] + initial.bbox[2]) / 2];
    map = L.map('map').setView(center, initial.zoom);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: 'Tiles &copy; Esri'
    }).addTo(map);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18,
      attribution: 'Labels &copy; Esri'
    }).addTo(map);

    updateBboxRectangle(activeBbox);

    map.on('mousemove', onMapMouseMove);
    map.on('click', onMapClick);
  }

  function updateBboxRectangle(bbox) {
    if (!map) return;
    if (drawnBboxLayer) map.removeLayer(drawnBboxLayer);
    const bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
    drawnBboxLayer = L.rectangle(bounds, { color: '#3b82f6', weight: 2, fill: false }).addTo(map);
  }

  function initControls() {
    const presetSel = el('regionPreset');
    const sensorSel = el('sensorPlatform');
    const metricSel = el('aqMetricSelect');

    function populateMetrics() {
      metricSel.innerHTML = '';
      const s = sensorSel.value;
      if (s === 's2') {
        el('s2OptionsGroup').style.display = 'block';
        for (const [k, v] of Object.entries(AirQualityRemoteSensing.AQ_METRICS)) {
          const opt = document.createElement('option');
          opt.value = k;
          opt.textContent = `${v.name} (${v.shortLabel}) [${v.units}]`;
          metricSel.appendChild(opt);
        }
      } else {
        el('s2OptionsGroup').style.display = 'none';
        for (const [k, v] of Object.entries(AirQualityRemoteSensing.S5P_PRODUCTS)) {
          const opt = document.createElement('option');
          opt.value = k;
          opt.textContent = `${v.name} (${k.toUpperCase()}) [${v.displayUnit}]`;
          metricSel.appendChild(opt);
        }
      }
    }

    sensorSel.addEventListener('change', populateMetrics);
    populateMetrics();

    // Default dates: last 30 days
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 30);
    el('aqEndDate').value = end.toISOString().slice(0, 10);
    el('aqStartDate').value = start.toISOString().slice(0, 10);

    presetSel.addEventListener('change', () => {
      aqMachine?.send('SELECT_PRESET', { preset: presetSel.value });
      if (presetSel.value === 'custom') {
        if (map) {
          const b = map.getBounds();
          activeBbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
          updateBboxRectangle(activeBbox);
          log(`Custom Area set to map view: [${activeBbox.map(v => v.toFixed(3)).join(', ')}]`);
        }
        return;
      }
      const p = PRESETS[presetSel.value];
      if (p) {
        activeBbox = p.bbox.slice();
        updateBboxRectangle(activeBbox);
        const center = [(activeBbox[1] + activeBbox[3]) / 2, (activeBbox[0] + activeBbox[2]) / 2];
        map.setView(center, p.zoom);
        log(`Selected preset: ${p.name}`);
      }
    });

    if (map) {
      map.on('moveend', () => {
        if (presetSel.value === 'custom') {
          const b = map.getBounds();
          activeBbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
          updateBboxRectangle(activeBbox);
        }
      });
    }

    el('searchAndLoadBtn').addEventListener('click', handleSearchAndLoad);
    el('temporalViewMode').addEventListener('change', () => {
      aqMachine?.send('SET_VIEW_MODE', { mode: el('temporalViewMode').value });
      updateActiveDisplay();
    });
    el('aggStatistic').addEventListener('change', updateActiveDisplay);
    el('anomalyDiffChk').addEventListener('change', updateActiveDisplay);

    el('timeSlider').addEventListener('input', () => {
      const idx = parseInt(el('timeSlider').value, 10);
      aqMachine?.send('CHANGE_FRAME', { frameIndex: idx });
      renderFrame(idx);
    });

    el('overlayOpacity').addEventListener('input', () => {
      const op = parseFloat(el('overlayOpacity').value);
      if (imageOverlay) imageOverlay.setOpacity(op);
    });

    el('clickPointModeBtn').addEventListener('click', () => {
      isProbing = !isProbing;
      el('clickPointModeBtn').textContent = isProbing ? 'Probing Active (Click 2+ pts)' : 'Probe Transect Line';
      el('clickPointModeBtn').classList.toggle('btn-secondary', !isProbing);
    });

    el('clearProbesBtn').addEventListener('click', () => {
      transectPoints = [];
      if (transectLayer) map.removeLayer(transectLayer);
      transectLayer = null;
      updateChartWithActiveFrame();
      log('Cleared probe line.');
    });

    el('loadLocalNcBtn').addEventListener('click', handleLoadLocalNc);

    // In-situ ground stations
    const openAqBtn = el('toggleOpenAqBtn');
    if (openAqBtn) openAqBtn.addEventListener('click', toggleOpenAqLayer);

    // Chart toggle buttons
    const timelineBtn = el('showTimelineChartBtn');
    if (timelineBtn) timelineBtn.addEventListener('click', () => {
      activeChartMode = 'timeline';
      aqMachine?.send('VIEW_TIMELINE');
      el('chartTitle').textContent = 'Temporal Timeline';
      updateChartWithActiveFrame();
    });

    const corrBtn = el('showCorrelationChartBtn');
    if (corrBtn) corrBtn.addEventListener('click', () => {
      activeChartMode = 'correlation';
      aqMachine?.send('VIEW_SCATTER');
      el('chartTitle').textContent = 'Multi-Sensor Scatter Plot';
      updateChartWithActiveFrame();
    });

    // Export tools
    el('exportTiffBtn').addEventListener('click', handleExportTiff);
    el('exportCsvBtn').addEventListener('click', handleExportCsv);
    el('exportPngBtn').addEventListener('click', handleExportPng);
    el('exportGifBtn').addEventListener('click', handleExportGif);
  }

  async function handleSearchAndLoad() {
    const btn = el('searchAndLoadBtn');
    aqMachine?.send('START_LOAD');
    btn.disabled = true;
    log('Starting satellite time-series search and load...');

    try {
      const sensor = el('sensorPlatform').value;
      const metric = el('aqMetricSelect').value;
      const start = el('aqStartDate').value;
      const end = el('aqEndDate').value;
      const maxScenes = parseInt(el('maxScenesInput').value, 10) || 8;

      let frames = [];
      if (sensor === 's2') {
        const maxCloud = parseFloat(el('s2MaxCloud').value) || 40;
        const maskClouds = el('s2MaskCloudsChk').checked;
        frames = await AirQualityRemoteSensing.loadSentinel2AqSeries(activeBbox, metric, start, end, {
          maxCloud,
          maxScenes,
          width: GRID_W,
          height: GRID_H,
          maskClouds
        });
      } else {
        frames = await AirQualityRemoteSensing.loadSentinel5pSeries(activeBbox, metric, start, end, {
          maxScenes,
          width: GRID_W,
          height: GRID_H
        });
      }

      if (!frames.length) {
        log('No valid satellite frames found for the selected parameters. Generating synthetic fallback series.');
        frames = generateSyntheticSeries(metric, sensor, start, end, maxScenes);
      }

      loadedFrames = frames;
      if (sensor === 's2') {
        loadedS2Frames = frames;
      } else {
        loadedS5pFrames = frames;
      }
      log(`Successfully loaded ${frames.length} frames.`);

      // Compute Period Median Baseline
      const grids = frames.map(f => f.grid);
      periodMedianGrid = SentiToolkitCore.compositeGrids(grids, 'median');

      // Update Slider
      const slider = el('timeSlider');
      slider.min = 0;
      slider.max = Math.max(0, frames.length - 1);
      slider.value = 0;

      aqMachine?.send('LOAD_SUCCESS', { count: frames.length, sensor, metric });
      updateActiveDisplay();
      populateStatsTable();
    } catch (err) {
      log(`Error: ${err.message}. Generating synthetic fallback series.`);
      const sensor = el('sensorPlatform').value;
      const metric = el('aqMetricSelect').value;
      const start = el('aqStartDate').value;
      const end = el('aqEndDate').value;
      const maxScenes = parseInt(el('maxScenesInput').value, 10) || 8;
      loadedFrames = generateSyntheticSeries(metric, sensor, start, end, maxScenes);
      if (sensor === 's2') {
        loadedS2Frames = loadedFrames;
      } else {
        loadedS5pFrames = loadedFrames;
      }
      periodMedianGrid = SentiToolkitCore.compositeGrids(loadedFrames.map(f => f.grid), 'median');
      const slider = el('timeSlider');
      slider.min = 0;
      slider.max = Math.max(0, loadedFrames.length - 1);
      slider.value = 0;
      aqMachine?.send('LOAD_SUCCESS', { count: loadedFrames.length, synthetic: true });
      updateActiveDisplay();
      populateStatsTable();
    } finally {
      btn.disabled = false;
    }
  }

  function generateSyntheticSeries(metric, sensor, start, end, count = 5) {
    const frames = [];
    const scale = (sensor === 's2')
      ? (AirQualityRemoteSensing.AQ_METRICS[metric]?.scale || { min: 0, max: 1 })
      : (AirQualityRemoteSensing.S5P_PRODUCTS[metric]?.scale || { min: 0, max: 100 });
    const def = sensor === 's2' ? AirQualityRemoteSensing.AQ_METRICS[metric] : AirQualityRemoteSensing.S5P_PRODUCTS[metric];

    for (let c = 0; c < count; c++) {
      const g = new Float32Array(GRID_W * GRID_H);
      for (let y = 0; y < GRID_H; y++) {
        for (let x = 0; x < GRID_W; x++) {
          const u = x / GRID_W, v = y / GRID_H;
          const dist = Math.hypot(u - 0.5, v - 0.5);
          const val = Math.exp(-dist * 4) * (0.6 + 0.4 * Math.sin(c + x * 0.1));
          g[y * GRID_W + x] = scale.min + val * (scale.max - scale.min);
        }
      }
      const d = new Date(start);
      d.setDate(d.getDate() + c * 5);
      const dateStr = d.toISOString().slice(0, 10);
      frames.push({
        id: `synthetic_${sensor}_${c}`,
        dateStr,
        label: `${dateStr} (${def.shortLabel || def.name})`,
        grid: g,
        width: GRID_W,
        height: GRID_H,
        bbox: activeBbox.slice(),
        units: def.units || def.displayUnit,
        shortLabel: def.shortLabel || def.name,
        mode: metric,
        sensor
      });
    }
    return frames;
  }

  function updateActiveDisplay() {
    if (!loadedFrames.length) return;
    const mode = el('temporalViewMode').value;
    const stat = el('aggStatistic').value;
    const diff = el('anomalyDiffChk').checked;

    if (mode === 'single') {
      const idx = parseInt(el('timeSlider').value, 10);
      renderFrame(idx);
      return;
    }

    if (mode === 'monthly') {
      const monthGroups = new Map();
      for (const f of loadedFrames) {
        const ym = f.dateStr ? f.dateStr.slice(0, 7) : 'Unknown';
        if (!monthGroups.has(ym)) monthGroups.set(ym, []);
        monthGroups.get(ym).push(f.grid);
      }
      const grids = loadedFrames.map(f => f.grid);
      let composite = SentiToolkitCore.compositeGrids(grids, stat);
      if (diff && periodMedianGrid) {
        const delta = new Float32Array(composite.length);
        for (let i = 0; i < delta.length; i++) delta[i] = composite[i] - periodMedianGrid[i];
        composite = delta;
      }
      activeDisplayGrid = composite;
      const numMonths = monthGroups.size;
      const label = `Monthly ${stat.toUpperCase()} (${numMonths} month${numMonths === 1 ? '' : 's'})`;
      displayGridOnMap(composite, label, diff);
      updateKpisAndLegend(composite, label, diff);
      updateChartWithActiveFrame();
      return;
    }

    // Composite Mode
    const grids = loadedFrames.map(f => f.grid);
    let composite = SentiToolkitCore.compositeGrids(grids, stat);

    if (diff && periodMedianGrid) {
      const delta = new Float32Array(composite.length);
      for (let i = 0; i < delta.length; i++) {
        delta[i] = composite[i] - periodMedianGrid[i];
      }
      composite = delta;
    }

    activeDisplayGrid = composite;
    displayGridOnMap(composite, `${stat.toUpperCase()} Composite`, diff);
    updateKpisAndLegend(composite, `${stat.toUpperCase()} Composite`, diff);
    updateChartWithActiveFrame();
  }

  function renderFrame(index) {
    if (!loadedFrames[index]) return;
    const frame = loadedFrames[index];
    const diff = el('anomalyDiffChk').checked;

    el('stepCounterLabel').textContent = `Frame ${index + 1} of ${loadedFrames.length}`;
    el('stepDateLabel').textContent = frame.dateStr;

    let targetGrid = frame.grid;
    if (diff && periodMedianGrid) {
      const delta = new Float32Array(targetGrid.length);
      for (let i = 0; i < delta.length; i++) {
        delta[i] = targetGrid[i] - periodMedianGrid[i];
      }
      targetGrid = delta;
    }

    activeDisplayGrid = targetGrid;
    displayGridOnMap(targetGrid, frame.label, diff);
    updateKpisAndLegend(targetGrid, frame.label, diff);
    updateChartWithActiveFrame();
  }

  function displayGridOnMap(grid, title, isDiff = false) {
    if (!map) return;
    const canvas = document.createElement('canvas');
    canvas.width = GRID_W;
    canvas.height = GRID_H;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(GRID_W, GRID_H);
    const metric = el('aqMetricSelect').value;

    for (let i = 0, p = 0; i < grid.length; i++, p += 4) {
      const val = grid[i];
      const rgba = AirQualityRemoteSensing.colorizeAqMetric(val, metric, isDiff);
      imgData.data[p] = rgba[0];
      imgData.data[p + 1] = rgba[1];
      imgData.data[p + 2] = rgba[2];
      imgData.data[p + 3] = rgba[3];
    }
    ctx.putImageData(imgData, 0, 0);

    const bounds = [[activeBbox[1], activeBbox[0]], [activeBbox[3], activeBbox[2]]];
    const op = parseFloat(el('overlayOpacity').value);

    if (imageOverlay) map.removeLayer(imageOverlay);
    imageOverlay = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: op }).addTo(map);
  }

  function updateKpisAndLegend(grid, label, isDiff) {
    const stats = SentiToolkitCore.summarizeWgs84Grid(grid, GRID_W, GRID_H, activeBbox);
    const metric = el('aqMetricSelect').value;
    const sensor = el('sensorPlatform').value;
    const def = sensor === 's2' ? AirQualityRemoteSensing.AQ_METRICS[metric] : AirQualityRemoteSensing.S5P_PRODUCTS[metric];
    const unit = isDiff ? `&Delta; ${def?.units || def?.displayUnit || ''}` : (def?.units || def?.displayUnit || '');

    el('kpiMetricName').textContent = `${def?.name || metric} (${label})`;
    el('kpiMean').innerHTML = Number.isFinite(stats.mean) ? `${stats.mean.toFixed(2)} <span style="font-size:12px">${unit}</span>` : '--';
    el('kpiP90').innerHTML = Number.isFinite(stats.p90) ? `${stats.p90.toFixed(2)} <span style="font-size:12px">${unit}</span>` : '--';
    el('kpiValidCount').textContent = `${((stats.count / (GRID_W * GRID_H)) * 100).toFixed(1)}%`;

    const badge = el('kpiStatusBadge');
    if (!Number.isFinite(stats.mean)) {
      badge.textContent = 'No Data';
      badge.style.color = '#9ca3af';
    } else if (isDiff) {
      badge.textContent = stats.mean > 0 ? 'Above Baseline' : 'Below Baseline';
      badge.style.color = stats.mean > 0 ? '#f87171' : '#34d399';
    } else {
      const scale = def?.scale || { min: 0, max: 1 };
      const norm = (stats.mean - scale.min) / (scale.max - scale.min || 1);
      if (norm < 0.3) {
        badge.textContent = 'Good / Clear';
        badge.style.color = '#34d399';
      } else if (norm < 0.65) {
        badge.textContent = 'Moderate';
        badge.style.color = '#fbbf24';
      } else {
        badge.textContent = 'Elevated / Plume';
        badge.style.color = '#ef4444';
      }
    }

    renderLegend(metric, isDiff);
  }

  function renderLegend(metric, isDiff) {
    const box = el('legendItemsBox');
    box.innerHTML = '';
    el('legendTitle').textContent = `Legend: ${metric} ${isDiff ? '(Anomaly Delta)' : ''}`;

    const steps = 6;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      let val = 0;
      if (isDiff) {
        val = -0.5 + t * 1.0;
      } else {
        const scale = AirQualityRemoteSensing.AQ_METRICS[metric]?.scale || AirQualityRemoteSensing.S5P_PRODUCTS[metric]?.scale || { min: 0, max: 1 };
        val = scale.min + t * (scale.max - scale.min);
      }
      const rgba = AirQualityRemoteSensing.colorizeAqMetric(val, metric, isDiff);
      const item = document.createElement('div');
      item.className = 'legend-color-item';
      item.innerHTML = `
        <div class="color-swatch" style="background:rgba(${rgba.join(',')})"></div>
        <span>${val.toFixed(2)}</span>
      `;
      box.appendChild(item);
    }
  }

  function populateStatsTable() {
    const tbody = el('statsTableBody');
    tbody.innerHTML = '';
    if (!loadedFrames.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No data loaded.</td></tr>';
      return;
    }

    for (const frame of loadedFrames) {
      const s = SentiToolkitCore.summarizeWgs84Grid(frame.grid, GRID_W, GRID_H, activeBbox);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${frame.dateStr}</td>
        <td>${Number.isFinite(s.mean) ? s.mean.toFixed(2) : '--'}</td>
        <td>${Number.isFinite(s.p90) ? s.p90.toFixed(2) : '--'}</td>
        <td>${Number.isFinite(s.min) ? s.min.toFixed(2) : '--'}</td>
        <td>${Number.isFinite(s.max) ? s.max.toFixed(2) : '--'}</td>
        <td>${((s.count / (GRID_W * GRID_H)) * 100).toFixed(0)}%</td>
      `;
      tbody.appendChild(tr);
    }
  }

  function updateChartWithActiveFrame() {
    if (typeof Chart === 'undefined') return;
    const ctx = el('aqChart').getContext('2d');

    if (activeChartMode === 'correlation') {
      renderCorrelationScatterChart(ctx);
      return;
    }

    // If transect is defined, plot transect line; else plot series means
    if (transectPoints.length >= 2 && activeDisplayGrid) {
      const transect = SentiToolkitCore.buildTransectPoints(transectPoints, 50);
      const labels = [];
      const values = [];
      for (const pt of transect.points) {
        const u = (pt.lon - activeBbox[0]) / (activeBbox[2] - activeBbox[0]);
        const v = (activeBbox[3] - pt.lat) / (activeBbox[3] - activeBbox[1]);
        const px = Math.floor(u * GRID_W);
        const py = Math.floor(v * GRID_H);
        labels.push(`${Math.round(pt.distanceM)}m`);
        if (px >= 0 && px < GRID_W && py >= 0 && py < GRID_H) {
          values.push(activeDisplayGrid[py * GRID_W + px]);
        } else {
          values.push(NaN);
        }
      }
      renderChart(ctx, labels, values, 'Transect Spatial Profile', 'Distance');
    } else if (loadedFrames.length) {
      const labels = loadedFrames.map(f => f.dateStr);
      const values = loadedFrames.map(f => {
        const s = SentiToolkitCore.summarizeWgs84Grid(f.grid, GRID_W, GRID_H, activeBbox);
        return s.mean;
      });
      renderChart(ctx, labels, values, 'Time-Series Mean Concentration', 'Date');
    }
  }

  function renderChart(ctx, labels, data, title, xTitle) {
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: title,
          data,
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96, 165, 250, 0.2)',
          fill: true,
          tension: 0.2,
          pointRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { display: true, title: { display: true, text: xTitle, color: '#9ca3af' }, ticks: { color: '#9ca3af' } },
          y: { display: true, ticks: { color: '#9ca3af' } }
        },
        plugins: {
          legend: { labels: { color: '#e2e5e9' } }
        }
      }
    });
  }

  function renderCorrelationScatterChart(ctx) {
    if (!loadedS2Frames.length || !loadedS5pFrames.length) {
      log('Multi-Sensor Analysis: Please search and load both Sentinel-2 and Sentinel-5P series to correlate optical proxies with trace gases.');
      activeChartMode = 'timeline';
      const titleEl = el('chartTitle');
      if (titleEl) titleEl.textContent = 'Temporal Timeline (Load S2 & S5P for Scatter)';
      updateChartWithActiveFrame();
      return;
    }

    const s2 = loadedS2Frames[0];
    const s5p = loadedS5pFrames[0];
    const corr = AirQualityRemoteSensing.correlateGrids(s2.grid, s5p.grid);

    if (chartInstance) chartInstance.destroy();
    const trendline = [];
    if (Number.isFinite(corr.minA) && Number.isFinite(corr.maxA) && Number.isFinite(corr.slope)) {
      trendline.push(
        { x: corr.minA, y: corr.slope * corr.minA + corr.intercept },
        { x: corr.maxA, y: corr.slope * corr.maxA + corr.intercept }
      );
    }

    chartInstance = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: `${s2.shortLabel} vs ${s5p.shortLabel} (r=${corr.pearsonR.toFixed(2)}, R²=${corr.rSquared.toFixed(2)})`,
            data: corr.scatterPoints,
            backgroundColor: 'rgba(96, 165, 250, 0.65)',
            pointRadius: 3
          },
          {
            type: 'line',
            label: `Linear Fit: y = ${corr.slope.toFixed(3)}x + ${corr.intercept.toFixed(2)}`,
            data: trendline,
            borderColor: '#ef4444',
            borderWidth: 2,
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            display: true,
            title: { display: true, text: `${s2.shortLabel} (${s2.units})`, color: '#9ca3af' },
            ticks: { color: '#9ca3af' }
          },
          y: {
            display: true,
            title: { display: true, text: `${s5p.shortLabel} (${s5p.units})`, color: '#9ca3af' },
            ticks: { color: '#9ca3af' }
          }
        },
        plugins: {
          legend: { labels: { color: '#e2e5e9' } }
        }
      }
    });

    log(`Multi-Sensor Correlation (${s2.shortLabel} vs ${s5p.shortLabel}): Pearson r=${corr.pearsonR.toFixed(3)}, R²=${corr.rSquared.toFixed(3)}, N=${corr.count}`);
  }

  async function toggleOpenAqLayer() {
    if (!map) return;
    const btn = el('toggleOpenAqBtn');
    if (openAqVisible) {
      if (openAqLayerGroup) map.removeLayer(openAqLayerGroup);
      openAqLayerGroup = null;
      openAqVisible = false;
      aqMachine?.send('TOGGLE_GROUND_MONITORS', { visible: false });
      if (btn) {
        btn.textContent = 'In-Situ Monitors (OpenAQ)';
        btn.classList.add('btn-secondary');
      }
      log('Hidden in-situ ground monitoring stations.');
      return;
    }

    try {
      log('Querying OpenAQ API for active ground stations in current bounding box...');
      const stations = await AirQualityRemoteSensing.fetchOpenAqStations(activeBbox);
      if (!stations.length) {
        log('No active OpenAQ stations found within current bounding box.');
        return;
      }
      openAqLayerGroup = L.layerGroup();
      for (const st of stations) {
        let color = '#10b981'; // Good
        if (st.parameter === 'pm25') {
          if (st.value > 55) color = '#ef4444';
          else if (st.value > 35) color = '#f97316';
          else if (st.value > 12) color = '#f59e0b';
        } else if (st.parameter === 'no2') {
          if (st.value > 50) color = '#ef4444';
          else if (st.value > 20) color = '#f59e0b';
        }
        const marker = L.circleMarker([st.lat, st.lon], {
          radius: 7,
          fillColor: color,
          color: '#ffffff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.85
        });

        let satValStr = '--';
        if (activeDisplayGrid) {
          const u = (st.lon - activeBbox[0]) / (activeBbox[2] - activeBbox[0]);
          const v = (activeBbox[3] - st.lat) / (activeBbox[3] - activeBbox[1]);
          const px = Math.floor(u * GRID_W);
          const py = Math.floor(v * GRID_H);
          if (px >= 0 && px < GRID_W && py >= 0 && py < GRID_H) {
            const sv = activeDisplayGrid[py * GRID_W + px];
            if (Number.isFinite(sv)) satValStr = sv.toFixed(2);
          }
        }

        marker.bindPopup(`
          <div style="font-size:12px; line-height:1.4; color:#111;">
            <strong>${st.name}</strong><br>
            <em>${st.city ? st.city + ', ' : ''}${st.country}</em><br>
            <strong>Ground ${st.parameter.toUpperCase()}:</strong> ${st.value.toFixed(1)} ${st.unit}<br>
            <strong>Satellite Pixel Value:</strong> ${satValStr}<br>
            <span style="font-size:10px; color:#666;">Updated: ${st.lastUpdated ? st.lastUpdated.slice(0, 10) : 'Recent'}</span>
          </div>
        `);
        marker.addTo(openAqLayerGroup);
      }
      openAqLayerGroup.addTo(map);
      openAqVisible = true;
      aqMachine?.send('TOGGLE_GROUND_MONITORS', { visible: true, count: stations.length });
      if (btn) {
        btn.textContent = `Hide Ground Monitors (${stations.length})`;
        btn.classList.remove('btn-secondary');
      }
      log(`Plotted ${stations.length} active OpenAQ ground stations with live validation popups.`);
    } catch (err) {
      log(`OpenAQ notice: ${err.message}`);
    }
  }

  function onMapMouseMove(e) {
    if (!activeDisplayGrid) return;
    const lat = e.latlng.lat, lon = e.latlng.lng;
    const [west, south, east, north] = activeBbox;
    if (lon < west || lon > east || lat < south || lat > north) {
      el('hoverReadout').textContent = 'Hover: Outside AOI';
      return;
    }
    const u = (lon - west) / (east - west);
    const v = (north - lat) / (north - south);
    const px = Math.min(GRID_W - 1, Math.max(0, Math.floor(u * GRID_W)));
    const py = Math.min(GRID_H - 1, Math.max(0, Math.floor(v * GRID_H)));
    const val = activeDisplayGrid[py * GRID_W + px];
    const metric = el('aqMetricSelect').value;
    const isDiff = el('anomalyDiffChk').checked;
    el('hoverReadout').textContent = `Hover (${lat.toFixed(3)}, ${lon.toFixed(3)}): ${Number.isFinite(val) ? val.toFixed(3) : 'NaN'} ${isDiff ? 'Δ' : ''}`;
  }

  function onMapClick(e) {
    if (!isProbing) return;
    transectPoints.push([e.latlng.lng, e.latlng.lat]);
    if (transectLayer) map.removeLayer(transectLayer);
    const latLngs = transectPoints.map(p => [p[1], p[0]]);
    transectLayer = L.polyline(latLngs, { color: '#f59e0b', weight: 3 }).addTo(map);
    log(`Added probe point: ${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)} (${transectPoints.length} total)`);
    if (transectPoints.length >= 2) {
      updateChartWithActiveFrame();
    }
  }

  async function handleLoadLocalNc() {
    const fileInput = el('localNcInput');
    if (!fileInput.files || !fileInput.files[0]) {
      alert('Please select a NetCDF (.nc) file first.');
      return;
    }
    const file = fileInput.files[0];
    log(`Loading local NetCDF file: ${file.name}...`);
    try {
      const buf = await file.arrayBuffer();
      const gasId = el('aqMetricSelect').value;
      const gridded = await AirQualityRemoteSensing.gridS5pNetCdfBuffer(buf, gasId, activeBbox, GRID_W, GRID_H);
      log(`Gridded local NetCDF (${gridded.matchedFootprints} footprints matched).`);
      const frame = {
        id: file.name,
        dateStr: new Date().toISOString().slice(0, 10),
        label: `Local NetCDF (${file.name})`,
        grid: gridded.grid || gridded.indexGrid,
        indexGrid: gridded.indexGrid || gridded.grid,
        width: GRID_W,
        height: GRID_H,
        bbox: activeBbox.slice(),
        units: AirQualityRemoteSensing.S5P_PRODUCTS[gasId]?.displayUnit || '',
        shortLabel: gasId.toUpperCase(),
        mode: gasId,
        sensor: 's5p'
      };
      loadedFrames = [frame];
      periodMedianGrid = frame.grid;
      el('timeSlider').min = 0;
      el('timeSlider').max = 0;
      el('timeSlider').value = 0;
      updateActiveDisplay();
      populateStatsTable();
    } catch (err) {
      log(`Failed to process NetCDF: ${err.message}`);
    }
  }

  async function handleExportTiff() {
    if (!activeDisplayGrid) {
      alert('No active grid to export.');
      return;
    }
    log('Generating GeoTIFF export...');
    try {
      const blob = await SentiToolkitCore.writeWgs84GeoTiffBlob(activeDisplayGrid, GRID_W, GRID_H, activeBbox, 'Air Quality Grid');
      downloadBlob(blob, 'air_quality_export.tif');
      log('GeoTIFF exported successfully.');
    } catch (err) {
      log(`GeoTIFF export failed: ${err.message}`);
    }
  }

  function handleExportCsv() {
    if (!loadedFrames.length) {
      alert('No data to export.');
      return;
    }
    log('Exporting CSV statistics...');
    let csv = 'date,mean,sd,min,p25,median,p75,p90,max,valid_pixels\n';
    for (const f of loadedFrames) {
      const s = SentiToolkitCore.summarizeWgs84Grid(f.grid, GRID_W, GRID_H, activeBbox);
      csv += `${f.dateStr},${s.mean},${s.sd},${s.min},${s.p25},${s.median},${s.p75},${s.p90},${s.max},${s.count}\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    downloadBlob(blob, 'air_quality_stats.csv');
    log('CSV exported successfully.');
  }

  function handleExportPng() {
    if (!activeDisplayGrid) {
      alert('No active grid to export.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = GRID_W;
    canvas.height = GRID_H;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(GRID_W, GRID_H);
    const metric = el('aqMetricSelect').value;
    const isDiff = el('anomalyDiffChk').checked;

    for (let i = 0, p = 0; i < activeDisplayGrid.length; i++, p += 4) {
      const rgba = AirQualityRemoteSensing.colorizeAqMetric(activeDisplayGrid[i], metric, isDiff);
      imgData.data[p] = rgba[0];
      imgData.data[p + 1] = rgba[1];
      imgData.data[p + 2] = rgba[2];
      imgData.data[p + 3] = rgba[3];
    }
    ctx.putImageData(imgData, 0, 0);

    canvas.toBlob(blob => {
      downloadBlob(blob, 'air_quality_map.png');
      log('PNG exported successfully.');
    });
  }

  function handleExportGif() {
    if (!loadedFrames.length) {
      alert('No frames to animate.');
      return;
    }
    log('Encoding animated GIF...');
    const canvases = [];
    const metric = el('aqMetricSelect').value;
    const isDiff = el('anomalyDiffChk').checked;

    for (const frame of loadedFrames) {
      const c = document.createElement('canvas');
      c.width = GRID_W;
      c.height = GRID_H;
      const ctx = c.getContext('2d');
      const imgData = ctx.createImageData(GRID_W, GRID_H);
      for (let i = 0, p = 0; i < frame.grid.length; i++, p += 4) {
        const rgba = AirQualityRemoteSensing.colorizeAqMetric(frame.grid[i], metric, isDiff);
        imgData.data[p] = rgba[0];
        imgData.data[p + 1] = rgba[1];
        imgData.data[p + 2] = rgba[2];
        imgData.data[p + 3] = rgba[3];
      }
      ctx.putImageData(imgData, 0, 0);
      canvases.push(c);
    }

    try {
      const gifBlob = SentiToolkitCore.encodeAnimatedGIF(canvases, 80);
      downloadBlob(gifBlob, 'air_quality_timeseries.gif');
      log('Animated GIF exported successfully.');
    } catch (err) {
      log(`GIF export failed: ${err.message}`);
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Lifecycle
  window.addEventListener('DOMContentLoaded', () => {
    initMap();
    initControls();
    log('Observatory UI initialized.');
  });
})();
