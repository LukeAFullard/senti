// Extracted from the original single-file app.
// Load order is significant; see ../README.md before moving/removing scripts.
// Transect sampling, polygon summaries and charts

'use strict';

  // High-Density Transect Sampling & CSV Export
  // ============================================================================
  function getTransectGeometry(lineCoords) {
    if (!lineCoords || lineCoords.length < 2) return null;
    const dists = [0];
    let totalDist = 0;
    for (let i = 1; i < lineCoords.length; i++) {
      const [lon1, lat1] = lineCoords[i - 1], [lon2, lat2] = lineCoords[i];
      const dx = (lon2 - lon1) * Math.cos((lat1 + lat2) * Math.PI / 360) * 111320;
      const dy = (lat2 - lat1) * 110540;
      totalDist += Math.hypot(dx, dy);
      dists.push(totalDist);
    }
    if (totalDist === 0) return null;

    let numSamples = Number(transectSamplesInput.value) || 150;
    numSamples = Math.max(2, Math.min(1000, Math.floor(numSamples)));
    if (auto10mChk.checked) {
      numSamples = Math.max(20, Math.min(1000, Math.ceil(totalDist / 10) + 1));
      transectSamplesInput.value = String(numSamples);
    }

    const points = [];
    for (let s = 0; s < numSamples; s++) {
      const targetD = (s / (numSamples - 1)) * totalDist;
      let seg = 0;
      while (seg < dists.length - 2 && dists[seg + 1] < targetD) seg++;
      const segLen = dists[seg + 1] - dists[seg];
      const t = segLen > 0 ? (targetD - dists[seg]) / segLen : 0;
      const lon = lineCoords[seg][0] + t * (lineCoords[seg + 1][0] - lineCoords[seg][0]);
      const lat = lineCoords[seg][1] + t * (lineCoords[seg + 1][1] - lineCoords[seg][1]);
      points.push({ index: s, distanceM: targetD, lon, lat });
    }
    return { totalDist, numSamples, points };
  }

  function sampleTransectLine(rawObj, grid, lineCoords) {
    const geom = getTransectGeometry(lineCoords);
    if (!geom || !grid) return { labels: [], values: [] };
    const labels = [];
    const values = [];
    for (const pt of geom.points) {
      labels.push(`${Math.round(pt.distanceM)}m`);
      const v = sampleValueAtLonLat(rawObj, grid, pt.lon, pt.lat);
      values.push(typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(4)) : null);
    }
    return { labels, values, numSamples: geom.numSamples };
  }

  function pointInProjectedPolygon(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const crosses = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-30) + xi);
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function summarizePolygon(rawObj, grid, polygonCoords = probePolygon) {
    if (!rawObj || !grid || !polygonCoords || polygonCoords.length < 3) return null;
    const ring = polygonCoords.map(([lon, lat]) => proj4('EPSG:4326', rawObj.refCrs, [lon, lat]));
    const win = rawObj.refWindow;
    const winW = win[2] - win[0], winH = win[3] - win[1];
    const values = [];
    for (let y = 0; y < rawObj.height; y++) {
      const py = win[1] + ((y + 0.5) / rawObj.height) * winH;
      const mapY = rawObj.refOrigin[1] + py * rawObj.refRes[1];
      for (let x = 0; x < rawObj.width; x++) {
        const px = win[0] + ((x + 0.5) / rawObj.width) * winW;
        const mapX = rawObj.refOrigin[0] + px * rawObj.refRes[0];
        if (!pointInProjectedPolygon(mapX, mapY, ring)) continue;
        const value = grid[y * rawObj.width + x];
        if (Number.isFinite(value)) values.push(value);
      }
    }
    if (values.length === 0) return { count: 0, mean: NaN, median: NaN, sd: NaN, min: NaN, p25: NaN, p75: NaN, max: NaN };
    let sum = 0, sumSq = 0, min = Infinity, max = -Infinity;
    for (const v of values) { sum += v; sumSq += v * v; min = Math.min(min, v); max = Math.max(max, v); }
    values.sort((a, b) => a - b);
    const quantile = q => {
      const pos = (values.length - 1) * q;
      const base = Math.floor(pos), rest = pos - base;
      return base + 1 < values.length ? values[base] + rest * (values[base + 1] - values[base]) : values[base];
    };
    const mean = sum / values.length;
    return {
      count: values.length, mean, median: quantile(0.5), sd: Math.sqrt(Math.max(0, sumSq / values.length - mean * mean)),
      min, p25: quantile(0.25), p75: quantile(0.75), max
    };
  }

  async function summarizePolygonAsync(rawObj, grid, polygonCoords = probePolygon) {
    if (!rawObj || !grid || !polygonCoords || polygonCoords.length < 3) return null;
    try {
      const ring = polygonCoords.map(([lon, lat]) => proj4('EPSG:4326', rawObj.refCrs, [lon, lat]));
      return await runCpuWorkerTask('polygon-stats', {
        width: rawObj.width, height: rawObj.height,
        win: rawObj.refWindow, origin: rawObj.refOrigin, res: rawObj.refRes,
        ring, grid
      });
    } catch (err) {
      // Preserve functionality if worker creation is blocked or a task fails.
      return summarizePolygon(rawObj, grid, polygonCoords);
    }
  }

  let polygonStatsRequestId = 0;
  function updateOptramPersistenceUI() {
    const isOptram = outputMode.value === 'optram';
    optramPersistenceControls.style.display = isOptram ? 'block' : 'none';
    optramPersistenceBtn.disabled = !isOptram || !probePolygon || !validScenes.length || optramPersistenceRunning;
  }

  async function updatePolygonStatsPanel(rawObj, inspectGrid = null) {
    const requestId = ++polygonStatsRequestId;
    updateOptramPersistenceUI();
    if (!probePolygon) {
      polygonStatsContent.textContent = 'Draw a polygon on the map after loading imagery to calculate pixel statistics for that area.';
      return;
    }
    const mode = outputMode.value;
    if (['rgb', 'rgb_bands', 'false_color'].includes(mode)) {
      polygonStatsContent.textContent = 'Choose a spectral index in Primary Mode to calculate numeric polygon statistics.';
      return;
    }
    if (!rawObj || !rawObj.indexGrid) {
      polygonStatsContent.textContent = 'Polygon saved. Load imagery to calculate statistics.';
      return;
    }
    const grid = inspectGrid || rawObj.indexGrid;
    polygonStatsContent.textContent = 'Calculating polygon statistics…';
    const stats = await summarizePolygonAsync(rawObj, grid, probePolygon);
    if (requestId !== polygonStatsRequestId) return;
    if (!stats || stats.count === 0) {
      polygonStatsContent.textContent = 'No valid pixels fall inside this polygon for the selected date/index. Try a larger polygon or review cloud and water masks.';
      return;
    }
    const fmt = v => Number.isFinite(v) ? v.toFixed(4) : 'N/A';
    const title = activeRenderedState?.isDiff ? 'Δ index' : mode.toUpperCase();
    polygonStatsContent.innerHTML = `<strong>${title}</strong> | valid analysis cells: ${stats.count.toLocaleString()}<br>` +
      `Mean: ${fmt(stats.mean)} &nbsp; Median: ${fmt(stats.median)} &nbsp; SD: ${fmt(stats.sd)}<br>` +
      `Min: ${fmt(stats.min)} &nbsp; P25: ${fmt(stats.p25)} &nbsp; P75: ${fmt(stats.p75)} &nbsp; Max: ${fmt(stats.max)}` +
      (mode === 'optram' ? '<br><em>OPTRAM is a relative 0–1 AOI/date-range model; it is not volumetric soil moisture.</em>' : '');
    updateOptramPersistenceUI();
  }

  optramPersistenceBtn.addEventListener('click', async () => {
    if (!probePolygon || !validScenes.length || outputMode.value !== 'optram' || optramPersistenceRunning) return;
    const thresholdRaw = Number(optramWetThresholdInput.value);
    const threshold = Number.isFinite(thresholdRaw) ? Math.max(0.1, Math.min(0.95, thresholdRaw)) : 0.60;
    optramWetThresholdInput.value = threshold.toFixed(2);
    optramPersistenceRunning = true;
    optramPersistenceBtn.disabled = true;
    const originalText = optramPersistenceBtn.textContent;
    optramPersistenceBtn.textContent = 'Calculating…';
    optramPersistenceContent.textContent = 'Reading each individual acquisition and summarising the polygon. This may take a while for long date ranges.';
    const sceneMeans = [];
    const sceneDates = [];
    let validCellSum = 0;
    try {
      for (let i = 0; i < validScenes.length; i++) {
        const scene = validScenes[i];
        optramPersistenceBtn.textContent = `Calculating ${i + 1}/${validScenes.length}…`;
        const raw = await computeSceneRaw(scene, 'optram', maskCloudsChk.checked);
        const stats = summarizePolygon(raw, raw.indexGrid, probePolygon);
        if (stats && stats.count > 0 && Number.isFinite(stats.mean)) {
          sceneMeans.push(stats.mean);
          sceneDates.push(getSceneDateStr(scene));
          validCellSum += stats.count;
        }
        if ((i + 1) % 4 === 0) {
          optramPersistenceContent.textContent = `Processing acquisition ${i + 1} of ${validScenes.length}…`;
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      if (!sceneMeans.length) {
        optramPersistenceContent.textContent = 'No valid polygon observations were available. Try a larger polygon, check cloud masking, or expand the date range.';
        return;
      }
      const sorted = sceneMeans.slice().sort((a, b) => a - b);
      const median = quantileSorted(sorted, 0.5);
      const mean = sceneMeans.reduce((a, b) => a + b, 0) / sceneMeans.length;
      const wetCount = sceneMeans.filter(v => v >= threshold).length;
      const veryWetCount = sceneMeans.filter(v => v >= 0.8).length;
      const pctWet = 100 * wetCount / sceneMeans.length;
      const pctVeryWet = 100 * veryWetCount / sceneMeans.length;
      const first = sceneDates[0], last = sceneDates[sceneDates.length - 1];
      optramPersistenceContent.innerHTML = `<strong>Relative wetness persistence</strong> (${first} to ${last})<br>` +
        `Valid acquisitions: ${sceneMeans.length} / ${validScenes.length} &nbsp; | &nbsp; Approx. valid cell-date observations: ${validCellSum.toLocaleString()}<br>` +
        `Mean OPTRAM: ${mean.toFixed(3)} &nbsp; Median: ${median.toFixed(3)}<br>` +
        `Dates with polygon mean ≥ ${threshold.toFixed(2)}: <strong>${pctWet.toFixed(1)}%</strong> (${wetCount}/${sceneMeans.length})<br>` +
        `Dates with polygon mean ≥ 0.80: ${pctVeryWet.toFixed(1)}% (${veryWetCount}/${sceneMeans.length})<br>` +
        `<span class="small-note">Relative to this AOI's fitted model. Clear-scene gaps can miss short wet periods; this is not a water-table or subsurface drainage assessment.</span>`;
      log(`OPTRAM persistence calculated: ${pctWet.toFixed(1)}% of ${sceneMeans.length} valid polygon observations met threshold ${threshold.toFixed(2)}.`);
      updateChart();
    } catch (err) {
      optramPersistenceContent.textContent = `Could not calculate wetness persistence: ${err.message}`;
      log('OPTRAM persistence error: ' + err.message);
    } finally {
      optramPersistenceRunning = false;
      optramPersistenceBtn.textContent = originalText;
      updateOptramPersistenceUI();
    }
  });

  function updateCsvButtonState() {
    const hasProbe = Boolean(probePoints.length || probeLine || probePolygon);
    const rgbMode = ['rgb', 'rgb_bands', 'false_color'].includes(outputMode.value);
    csvBtn.disabled = displaySteps.length === 0 || !hasProbe || (Boolean(probePolygon) && rgbMode);
  }

  csvBtn.addEventListener('click', async () => {
    if (displaySteps.length === 0 || (!probeLine && !probePoints.length && !probePolygon)) return;
    csvBtn.disabled = true;
    const mode = outputMode.value;
    const maskClouds = maskCloudsChk.checked;

    try {
      const isRgbMode = mode === 'rgb' || mode === 'rgb_bands' || mode === 'false_color';
      if (probePolygon && isRgbMode) throw new Error('Choose a spectral index before exporting polygon summary statistics.');
      const rows = probePolygon
        ? ['step_label,date_str,mode,valid_cells,mean,median,standard_deviation,min,p25,p75,max,scene_cloud_pct,aoi_cloud_pct']
        : [isRgbMode
          ? 'step_label,date_str,point_id,sample_index,distance_m,longitude,latitude,mode,value,red,green,blue,scene_cloud_pct,aoi_cloud_pct'
          : 'step_label,date_str,point_id,sample_index,distance_m,longitude,latitude,mode,value,scene_cloud_pct,aoi_cloud_pct'];
      const csvCell = value => {
        const str = String(value ?? '');
        return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
      };
      const valueCells = (raw, lon, lat) => {
        if (isRgbMode && raw?.rgbChannels) {
          const rgb = sampleValueAtLonLat(raw, null, lon, lat);
          if (typeof rgb === 'string') {
            const match = rgb.match(/^RGB\((\d+),\s*(\d+),\s*(\d+)\)$/);
            if (match) return [csvCell(rgb), match[1], match[2], match[3]];
          }
          return ['', '', '', ''];
        }
        const v = sampleValueAtLonLat(raw, raw?.indexGrid, lon, lat);
        return [typeof v === 'number' && Number.isFinite(v) ? v.toFixed(5) : ''];
      };
      const geom = probeLine ? getTransectGeometry(probeLine) : null;

      for (let i = 0; i < displaySteps.length; i++) {
        csvBtn.textContent = `Extracting ${i + 1}/${displaySteps.length}…`;
        const raw = await computeStepRaw(i, mode, maskClouds);
        const stepLabel = csvCell(displaySteps[i].label);

        if (probePolygon) {
          let polygonGrid = raw?.indexGrid;
          let polygonMode = mode.toUpperCase();
          if (diffModeChk.checked && displaySteps.length > 1 && raw?.indexGrid) {
            const baseIdx = Number(baselineSelect.value) || 0;
            const baseRaw = await computeStepRaw(baseIdx, mode, maskClouds);
            const diffGrid = new Float32Array(raw.width * raw.height);
            for (let px = 0; px < raw.width * raw.height; px++) {
              let baseValue;
              if (gridsShareGeometry(raw, baseRaw)) {
                baseValue = baseRaw.indexGrid?.[px];
              } else {
                const x = px % raw.width, y = Math.floor(px / raw.width);
                const [lon, lat] = rawPixelToLonLat(raw, x, y);
                baseValue = sampleCompositeIndex(baseRaw, lon, lat);
              }
              const currentValue = raw.indexGrid[px];
              diffGrid[px] = Number.isFinite(currentValue) && Number.isFinite(baseValue) ? currentValue - baseValue : NaN;
            }
            polygonGrid = diffGrid;
            polygonMode = `DELTA_${mode.toUpperCase()}`;
          }
          const stats = summarizePolygon(raw, polygonGrid, probePolygon);
          const f = value => Number.isFinite(value) ? value.toFixed(6) : '';
          const scC = Number.isFinite(raw.sceneCloudPct) ? raw.sceneCloudPct.toFixed(2) : '';
          const aoiC = Number.isFinite(raw.aoiCloudPct) ? raw.aoiCloudPct.toFixed(2) : '';
          rows.push([stepLabel, csvCell(raw.dateStr), polygonMode, stats?.count ?? 0, f(stats?.mean), f(stats?.median), f(stats?.sd), f(stats?.min), f(stats?.p25), f(stats?.p75), f(stats?.max), scC, aoiC].join(','));
          continue;
        }
        if (geom) {
          const scC = Number.isFinite(raw.sceneCloudPct) ? raw.sceneCloudPct.toFixed(2) : '';
          const aoiC = Number.isFinite(raw.aoiCloudPct) ? raw.aoiCloudPct.toFixed(2) : '';
          for (const pt of geom.points) {
            const vals = valueCells(raw, pt.lon, pt.lat);
            rows.push([stepLabel, csvCell(raw.dateStr), '', pt.index, pt.distanceM.toFixed(2), pt.lon.toFixed(6), pt.lat.toFixed(6), mode.toUpperCase(), ...vals, scC, aoiC].join(','));
          }
        } else if (probePoints.length) {
          const scC = Number.isFinite(raw.sceneCloudPct) ? raw.sceneCloudPct.toFixed(2) : '';
          const aoiC = Number.isFinite(raw.aoiCloudPct) ? raw.aoiCloudPct.toFixed(2) : '';
          for (let pointIndex = 0; pointIndex < probePoints.length; pointIndex++) {
            const point = probePoints[pointIndex];
            const vals = valueCells(raw, point.lon, point.lat);
            rows.push([stepLabel, csvCell(raw.dateStr), csvCell(point.label), pointIndex, '0.00', point.lon.toFixed(6), point.lat.toFixed(6), mode.toUpperCase(), ...vals, scC, aoiC].join(','));
          }
        }
      }

      const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const probeName = probePolygon ? 'polygon_summary' : (probeLine ? 'transect' : (probePoints.length > 1 ? 'points' : 'point'));
      a.download = `sentinel2_${probeName}_${mode}_${temporalMode.value}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      log(`Exported ${rows.length - 1} rows to CSV.`);
      updateChart();
    } catch (err) {
      log('CSV export error: ' + err.message);
    } finally {
      updateCsvButtonState();
      csvBtn.textContent = 'Export Point / Transect / Polygon CSV';
    }
  });

  function updateChart() {
    const mode = outputMode.value;
    const maskClouds = maskCloudsChk.checked;
    const stat = compositeStat.value;
    const pVal = Number(percentileVal.value) || 50;
    const ctx = document.getElementById('timeChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    if (mode === 'obs_count') {
      const grid = activeRenderedState?.inspectGrid || activeRenderedState?.raw?.indexGrid;
      const labels = ['0', '1–2', '3–5', '6–10', '11–20', '>20'];
      const bins = [0, 0, 0, 0, 0, 0];
      if (grid) {
        for (let i = 0; i < grid.length; i++) {
          const value = grid[i];
          if (!Number.isFinite(value)) continue;
          if (value === 0) bins[0]++;
          else if (value <= 2) bins[1]++;
          else if (value <= 5) bins[2]++;
          else if (value <= 10) bins[3]++;
          else if (value <= 20) bins[4]++;
          else bins[5]++;
        }
      }
      const total = bins.reduce((a, b) => a + b, 0) || 1;
      const percent = bins.map(n => Number((100 * n / total).toFixed(2)));
      chartInstance = new Chart(ctx, {
        type: 'bar', data: { labels, datasets: [{ label: 'Share of analysis-grid cells (%)', data: percent, backgroundColor: 'rgba(77,170,252,0.45)', borderColor: '#4daafc', borderWidth: 1 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: 'Valid-observation support distribution (grid-cell %)', color: '#eee' }, legend: { labels: { color: '#aaa' } } }, scales: { x: { ticks: { color: '#aaa' }, title: { display: true, text: 'Clear valid acquisitions per grid cell', color: '#aaa' } }, y: { beginAtZero: true, max: 100, ticks: { color: '#aaa', callback: value => value + '%' }, title: { display: true, text: 'Grid cells (%)', color: '#aaa' } } } }
      });
      return;
    }

    if (mode === 'rgb' || mode === 'rgb_bands' || mode === 'false_color') {
      chartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: { plugins: { title: { display: true, text: 'Select a spectral index in Primary Mode to view charts', color: '#aaa' } } }
      });
      return;
    }

    if (probeLine && probeLine.length >= 2 && activeRenderedState?.inspectGrid) {
      const prof = sampleTransectLine(activeRenderedState.raw, activeRenderedState.inspectGrid, probeLine);
      chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: prof.labels,
          datasets: [{
            label: `${activeRenderedState.raw.dateStr} (${prof.numSamples} pts)`,
            data: prof.values,
            borderColor: '#ffcc00',
            backgroundColor: 'rgba(255, 204, 0, 0.15)',
            pointRadius: prof.numSamples > 100 ? 0 : 2,
            borderWidth: 1.8,
            fill: true,
            tension: 0.15,
            spanGaps: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: `Spatial Transect Profile (${prof.numSamples} samples)`, color: '#eee' } },
          scales: {
            x: { ticks: { color: '#aaa', maxTicksLimit: 10 }, title: { display: true, text: 'Distance along line (m)', color: '#aaa' } },
            y: { ticks: { color: '#aaa' }, title: { display: true, text: mode.toUpperCase(), color: '#aaa' } }
          }
        }
      });
      return;
    }

    const labels = [];
    const meanData = [];
    const pointDataById = new Map(probePoints.map(point => [point.id, []]));
    const polygonMeanData = [];

    for (const step of displaySteps) {
      labels.push(step.shortDate || step.label);
      const cached = step.isComposite
        ? compositeCache.get(`${step.id}_${mode}_${maskClouds}_${stat}_${pVal}_${waterOnlyChk.checked && WATER_QUALITY_PROXY_MODES.has(mode)}_${Math.max(-0.5, Math.min(0.5, Number(waterMaskThresholdInput.value) || 0))}`)
        : sceneRawCache.get(`${step.scenes[0].id}_${mode}_${maskClouds}_${waterOnlyChk.checked && WATER_QUALITY_PROXY_MODES.has(mode)}_${Math.max(-0.5, Math.min(0.5, Number(waterMaskThresholdInput.value) || 0))}`);

      if (cached && cached.indexGrid) {
        meanData.push(Number.isFinite(cached.meanVal) ? Number(cached.meanVal.toFixed(3)) : null);
        for (const point of probePoints) {
          const pv = sampleValueAtLonLat(cached, cached.indexGrid, point.lon, point.lat);
          pointDataById.get(point.id).push(typeof pv === 'number' && Number.isFinite(pv) ? Number(pv.toFixed(3)) : null);
        }
        if (probePolygon) {
          const ps = cached.indexGrid ? summarizePolygon(cached, cached.indexGrid, probePolygon) : null;
          polygonMeanData.push(ps && Number.isFinite(ps.mean) ? Number(ps.mean.toFixed(3)) : null);
        }
      } else {
        meanData.push(null);
        for (const point of probePoints) pointDataById.get(point.id).push(null);
        if (probePolygon) polygonMeanData.push(null);
      }
    }

    const datasets = [{
      label: `AOI Mean ${mode.toUpperCase()}`,
      data: meanData,
      borderColor: '#4daafc',
      backgroundColor: 'rgba(77, 170, 252, 0.15)',
      tension: 0.2,
      spanGaps: true
    }];

    if (probePolygon) {
      datasets.push({
        label: `Polygon Mean ${mode.toUpperCase()}`,
        data: polygonMeanData,
        borderColor: '#c58aff',
        backgroundColor: 'rgba(197, 138, 255, 0.16)',
        borderDash: [2, 3],
        tension: 0.2,
        spanGaps: true
      });
    }

    probePoints.forEach((point, index) => {
      const color = POINT_LINE_COLORS[index % POINT_LINE_COLORS.length];
      datasets.push({
        label: `${point.label} (${point.lat.toFixed(4)}, ${point.lon.toFixed(4)})`,
        data: pointDataById.get(point.id),
        borderColor: color,
        backgroundColor: color + '22',
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
        tension: 0.2,
        fill: false,
        spanGaps: true
      });
    });

    chartInstance = new Chart(ctx, {
      type: displaySteps.length === 1 ? 'bar' : 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: probePolygon ? 'Series: AOI Mean vs. Polygon Mean' : (probePoints.length ? `Series: AOI Mean vs. ${probePoints.length} comparison point(s)` : 'Series: AOI Mean (add comparison points, a line or a polygon)'),
            color: '#eee',
            font: { size: 12 }
          }
        },
        scales: {
          x: { ticks: { color: '#aaa' } },
          y: { ticks: { color: '#aaa' }, title: { display: true, text: mode.toUpperCase(), color: '#aaa' } }
        }
      }
    });
  }

  // ============================================================================
