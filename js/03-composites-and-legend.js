// Extracted from the original single-file app.
// Load order is significant; see ../README.md before moving/removing scripts.
// Temporal composites, support maps, colour mapping and legend controls

'use strict';

  // Temporal Composite Engine (Mean, Median, Max, Min, Percentile)
  // ============================================================================
  function calcArrayStat(validVals, count, stat, pVal) {
    if (count === 0) return NaN;
    if (stat === 'mean') {
      let sum = 0;
      for (let i = 0; i < count; i++) sum += validVals[i];
      return sum / count;
    }
    if (stat === 'max') {
      let m = -Infinity;
      for (let i = 0; i < count; i++) if (validVals[i] > m) m = validVals[i];
      return m;
    }
    if (stat === 'min') {
      let m = Infinity;
      for (let i = 0; i < count; i++) if (validVals[i] < m) m = validVals[i];
      return m;
    }
    const sub = validVals.subarray(0, count);
    sub.sort();
    const q = stat === 'median' ? 0.5 : Math.max(0.01, Math.min(0.99, pVal / 100));
    const pos = (count - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return base + 1 < count ? sub[base] + rest * (sub[base + 1] - sub[base]) : sub[base];
  }

  function getStatShortLabel() {
    const st = compositeStat.value;
    if (st === 'percentile') return `P${percentileVal.value}`;
    return st.charAt(0).toUpperCase() + st.slice(1);
  }

  function rebuildDisplaySteps() {
    compositeCache.clear();
    const tMode = temporalMode.value;

    // Observation support is one map across the full selected acquisition set,
    // not a time-series of repeated identical frames.
    if (outputMode.value === 'obs_count') {
      const start = validScenes.length ? getSceneDateStr(validScenes[0]) : 'N/A';
      const end = validScenes.length ? getSceneDateStr(validScenes[validScenes.length - 1]) : 'N/A';
      displaySteps = [{
        id: `valid_observation_support_${validScenes.length}`,
        label: `Clear valid observations (${validScenes.length} acquisitions: ${start} to ${end})`,
        shortDate: `Observation support (n=${validScenes.length})`,
        scenes: validScenes.slice(),
        isComposite: true
      }];
    } else if (tMode === 'single') {
      displaySteps = validScenes.map(sc => ({
        id: sc.id,
        label: sc.tiles?.length > 1 ? `${getSceneDateStr(sc)} (${sc.tiles.length}-tile mosaic)` : getSceneDateStr(sc),
        scenes: [sc],
        isComposite: false
      }));
    } else if (tMode === 'all') {
      const start = getSceneDateStr(validScenes[0]);
      const end = getSceneDateStr(validScenes[validScenes.length - 1]);
      displaySteps = [{
        id: `comp_all_${validScenes.length}`,
        label: `Composite (${validScenes.length} scenes: ${start} to ${end})`,
        shortDate: `${getStatShortLabel()} (${validScenes.length} scenes)`,
        scenes: validScenes.slice(),
        isComposite: true
      }];
    } else if (tMode === 'monthly') {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const buckets = Array.from({ length: 12 }, () => []);
      for (const sc of validScenes) {
        const m = new Date(sc.properties.datetime).getUTCMonth();
        buckets[m].push(sc);
      }
      displaySteps = [];
      buckets.forEach((arr, m) => {
        if (arr.length > 0) {
          displaySteps.push({
            id: `comp_month_${m}_${arr.length}`,
            label: `${monthNames[m]} (${arr.length} scene${arr.length > 1 ? 's' : ''})`,
            shortDate: `${monthNames[m]} ${getStatShortLabel()} (n=${arr.length})`,
            scenes: arr,
            isComposite: true
          });
        }
      });
    } else if (tMode === 'seasonal') {
      const isSouth = drawnBbox && (drawnBbox[1] + drawnBbox[3]) / 2 < 0;
      const seasonDefs = [
        { key: 'DJF', name: isSouth ? 'Summer (DJF)' : 'Winter (DJF)', months: [11, 0, 1] },
        { key: 'MAM', name: isSouth ? 'Autumn (MAM)' : 'Spring (MAM)', months: [2, 3, 4] },
        { key: 'JJA', name: isSouth ? 'Winter (JJA)' : 'Summer (JJA)', months: [5, 6, 7] },
        { key: 'SON', name: isSouth ? 'Spring (SON)' : 'Autumn (SON)', months: [8, 9, 10] }
      ];
      displaySteps = [];
      for (const sDef of seasonDefs) {
        const arr = validScenes.filter(sc => sDef.months.includes(new Date(sc.properties.datetime).getUTCMonth()));
        if (arr.length > 0) {
          displaySteps.push({
            id: `comp_season_${sDef.key}_${arr.length}`,
            label: `${sDef.name} (${arr.length} scene${arr.length > 1 ? 's' : ''})`,
            shortDate: `${sDef.key} ${getStatShortLabel()} (n=${arr.length})`,
            scenes: arr,
            isComposite: true
          });
        }
      }
    }

    sceneSlider.max = String(Math.max(0, displaySteps.length - 1));
    sceneSlider.value = String(Math.max(0, displaySteps.length - 1));

    baselineSelect.innerHTML = displaySteps
      .map((st, i) => `<option value="${i}">${st.label}</option>`)
      .join('');
    baselineSelect.value = '0';
    baselineSelect.disabled = !diffModeChk.checked || displaySteps.length < 2;
    gifBtn.disabled = displaySteps.length < 2;
    plotAllBtn.disabled = displaySteps.length < 2 && tMode === 'single';
  }

  async function computeDataSupportRaw() {
    const signature = `${validScenes.map(sc => sc.id).join('|')}|SCL-clear`;
    if (dataSupportCache.has(signature)) return dataSupportCache.get(signature);
    if (!validScenes.length) throw new Error('Load Sentinel-2 scenes before calculating observation support.');
    log(`Calculating clear-observation support from ${validScenes.length} selected acquisitions...`);
    const raws = await mapConcurrent(validScenes, SCENE_CONCURRENCY, async (scene, index) => {
      const raw = await computeSceneRaw(scene, 'ndmi', true);
      if ((index + 1) % 4 === 0) log(`Observation support: loaded ${index + 1}/${validScenes.length} acquisitions...`);
      return raw;
    });
    const ref = raws[0], width = ref.width, height = ref.height;
    const indexGrid = new Float32Array(width * height);
    const sameGeometry = raws.map(raw => gridsShareGeometry(ref, raw));
    const start = performance.now();
    let sumCounts = 0;
    for (let i = 0; i < indexGrid.length; i++) {
      let lonLat = null;
      let count = 0;
      for (let r = 0; r < raws.length; r++) {
        let value;
        if (sameGeometry[r]) {
          value = raws[r].indexGrid[i];
        } else {
          if (!lonLat) {
            const x = i % width, y = Math.floor(i / width);
            lonLat = rawPixelToLonLat(ref, x, y);
          }
          value = sampleCompositeIndex(raws[r], lonLat[0], lonLat[1]);
        }
        if (Number.isFinite(value)) count++;
      }
      indexGrid[i] = count;
      sumCounts += count;
    }
    const support = {
      ...ref, id: 'valid-observation-count', mode: 'obs_count', dateStr: 'All selected dates',
      indexGrid, rgbChannels: null, meanVal: indexGrid.length ? sumCounts / indexGrid.length : NaN,
      sceneCount: validScenes.length, isComposite: true,
      sceneCloudPct: raws.reduce((sum, raw) => sum + (Number.isFinite(raw.sceneCloudPct) ? raw.sceneCloudPct : 0), 0) / raws.length,
      aoiCloudPct: raws.some(raw => Number.isFinite(raw.aoiCloudPct)) ? raws.reduce((sum, raw) => sum + (Number.isFinite(raw.aoiCloudPct) ? raw.aoiCloudPct : 0), 0) / raws.filter(raw => Number.isFinite(raw.aoiCloudPct)).length : null
    };
    const elapsed = (performance.now() - start) / 1000;
    log(`Observation support map complete (${width}×${height}; ${raws.length} acquisitions; aggregation ${elapsed.toFixed(2)} s).`);
    dataSupportCache.set(signature, support);
    return support;
  }

  async function computeStepRaw(stepIndex, mode, applyCloudMask) {
    const step = displaySteps[stepIndex];
    if (mode === 'obs_count') return computeDataSupportRaw();
    if (!step.isComposite && step.scenes.length === 1) {
      return computeSceneRaw(step.scenes[0], mode, applyCloudMask);
    }

    const stat = compositeStat.value;
    const pVal = Number(percentileVal.value) || 50;
    const waterMaskOn = waterOnlyChk.checked && WATER_QUALITY_PROXY_MODES.has(mode);
    const waterThreshold = Math.max(-0.5, Math.min(0.5, Number(waterMaskThresholdInput.value) || 0));
    const cacheKey = `${step.id}_${mode}_${applyCloudMask}_${stat}_${pVal}_${waterMaskOn}_${waterThreshold}`;
    if (compositeCache.has(cacheKey)) return compositeCache.get(cacheKey);

    // Scene reads are independent. Process a small number concurrently while
    // retaining the original order needed for deterministic composite statistics.
    log(`Loading ${step.scenes.length} scenes for ${step.label} (up to ${SCENE_CONCURRENCY} concurrently; ${GEO_TIFF_WORKERS} GeoTIFF decoder worker(s))...`);
    let completedScenes = 0;
    const raws = await mapConcurrent(step.scenes, SCENE_CONCURRENCY, async (sc) => {
      const result = await computeSceneRaw(sc, mode, applyCloudMask);
      completedScenes++;
      log(`Loaded ${completedScenes}/${step.scenes.length} scenes for ${step.label}...`);
      return result;
    });

    const ref = raws[0];
    const width = ref.width, height = ref.height;
    const totalPixels = width * height;
    const nScenes = raws.length;

    let indexGrid = null;
    let rgbChannels = null;
    const scratch = new Float32Array(nScenes);

    if (ref.rgbChannels) {
      const sameGeometry = raws.every(sr => gridsShareGeometry(ref, sr));
      let rgbWorkerUsed = false;
      if (sameGeometry) {
        try {
          const workerResult = await runCpuWorkerTask('composite-rgb', {
            length: totalPixels, channels: raws.map(sr => sr.rgbChannels), stat, pVal
          });
          rgbChannels = workerResult.rgbChannels;
          rgbWorkerUsed = true;
        } catch (workerErr) {
          console.warn('RGB composite worker unavailable; using main-thread composite.', workerErr);
        }
      }
      if (!rgbWorkerUsed) {
        const rCh = new Uint8ClampedArray(totalPixels);
        const gCh = new Uint8ClampedArray(totalPixels);
        const bCh = new Uint8ClampedArray(totalPixels);
        const aCh = new Uint8ClampedArray(totalPixels);
        const rScratch = new Float32Array(nScenes);
        const gScratch = new Float32Array(nScenes);
        const bScratch = new Float32Array(nScenes);
        for (let i = 0; i < totalPixels; i++) {
          const rx = i % width;
          const ry = Math.floor(i / width);
          let cnt = 0;
          for (let s = 0; s < nScenes; s++) {
            const sr = raws[s];
            let rgb = null;
            if (gridsShareGeometry(ref, sr)) {
              if (sr.rgbChannels[3][i] > 0) rgb = [sr.rgbChannels[0][i], sr.rgbChannels[1][i], sr.rgbChannels[2][i]];
            } else {
              const [lon, lat] = rawPixelToLonLat(ref, rx, ry);
              rgb = sampleCompositeRgb(sr, lon, lat);
            }
            if (rgb) { rScratch[cnt] = rgb[0]; gScratch[cnt] = rgb[1]; bScratch[cnt] = rgb[2]; cnt++; }
          }
          if (cnt === 0) aCh[i] = 0;
          else {
            rCh[i] = Math.round(calcArrayStat(rScratch, cnt, stat, pVal));
            gCh[i] = Math.round(calcArrayStat(gScratch, cnt, stat, pVal));
            bCh[i] = Math.round(calcArrayStat(bScratch, cnt, stat, pVal));
            aCh[i] = 255;
          }
        }
        rgbChannels = [rCh, gCh, bCh, aCh];
      }
    } else {
      indexGrid = new Float32Array(totalPixels);
      const sameGeometry = raws.every(sr => gridsShareGeometry(ref, sr));
      let compositeWorkerUsed = false;
      if (sameGeometry) {
        try {
          const workerResult = await runCpuWorkerTask('composite-index', {
            length: totalPixels, grids: raws.map(sr => sr.indexGrid), stat, pVal
          });
          indexGrid = workerResult.indexGrid;
          compositeWorkerUsed = true;
        } catch (workerErr) {
          console.warn('Composite worker unavailable; using main-thread composite.', workerErr);
        }
      }
      if (!compositeWorkerUsed) {
        for (let i = 0; i < totalPixels; i++) {
          const rx = i % width;
          const ry = Math.floor(i / width);
          let cnt = 0;
          for (let s = 0; s < nScenes; s++) {
            const sr = raws[s];
            let v;
            if (gridsShareGeometry(ref, sr)) {
              v = sr.indexGrid[i];
            } else {
              const [lon, lat] = rawPixelToLonLat(ref, rx, ry);
              v = sampleCompositeIndex(sr, lon, lat);
            }
            if (Number.isFinite(v)) scratch[cnt++] = v;
          }
          indexGrid[i] = cnt > 0 ? calcArrayStat(scratch, cnt, stat, pVal) : NaN;
        }
      }
    }

    let meanVal = NaN;
    if (indexGrid) {
      let sum = 0, cnt = 0;
      for (let i = 0; i < indexGrid.length; i++) {
        if (Number.isFinite(indexGrid[i])) { sum += indexGrid[i]; cnt++; }
      }
      if (cnt > 0) meanVal = sum / cnt;
    }

    let avgAoiCloud = null;
    const validClouds = raws.map(r => r.aoiCloudPct).filter(c => c !== null && Number.isFinite(c));
    if (validClouds.length > 0) {
      avgAoiCloud = validClouds.reduce((a, b) => a + b, 0) / validClouds.length;
    }

    const compRaw = {
      id: step.id,
      dateStr: step.shortDate || step.label,
      mode, width, height,
      refImage: ref.refImage,
      refWindow: ref.refWindow,
      refCrs: ref.refCrs,
      refOrigin: ref.refOrigin,
      refRes: ref.refRes,
      indexGrid, rgbChannels, meanVal,
      sceneCloudPct: raws.reduce((a, r) => a + r.sceneCloudPct, 0) / nScenes,
      aoiCloudPct: avgAoiCloud,
      isComposite: true,
      sceneCount: nScenes
    };
    compositeCache.set(cacheKey, compRaw);
    return compRaw;
  }

  function reflectanceToByte(reflectance) {
    if (!Number.isFinite(reflectance)) return 0;
    const stretched = Math.max(0, Math.min(1, reflectance / 0.30));
    return Math.round(255 * Math.pow(stretched, 1 / 2.2));
  }

  // The colour stretch changes only the visual map palette. The underlying
  // indexGrid, chart values, pixel inspection, CSV and GeoTIFF data stay untouched.
  // Bounds are selected in real index units; palette breakpoints are remapped
  // between those user bounds to increase contrast over the range of interest.
  const COLOR_STRETCH_SCALES = {
    ndvi: { min: -1, max: 1, breaks: [0, 0.2, 0.5] },
    evi: { min: -1, max: 1, breaks: [0, 0.2, 0.5] },
    ndwi: { min: -1, max: 1, breaks: [-0.3, 0, 0.2] },
    mndwi: { min: -1, max: 1, breaks: [-0.15, 0.05, 0.3] },
    ndci: { min: -0.2, max: 0.4, breaks: [-0.05, 0.03, 0.12, 0.25] },
    chl_ratio: { min: 0, max: 3, breaks: [0.7, 1.1, 1.6, 2.2] },
    mci: { min: -0.02, max: 0.05, breaks: [-0.003, 0.003, 0.01, 0.02] },
    fai: { min: -0.02, max: 0.05, breaks: [-0.003, 0.003, 0.01, 0.02] },
    ndti: { min: -1, max: 1, breaks: [-0.05, 0.02, 0.1, 0.25] },
    turbidity_ratio: { min: 0, max: 2.5, breaks: [0.55, 0.9, 1.3, 1.8] },
    awei_nsh: { min: -1, max: 1, breaks: [-0.25, 0, 0.15] },
    ndmi: { min: -1, max: 1, breaks: [-0.1, 0.1, 0.35] },
    smi: { min: -1, max: 1, breaks: [-0.1, 0.1, 0.35] },
    s2wi: { min: -1, max: 1, breaks: [-0.35, -0.15, 0.05] },
    nbr: { min: -1, max: 1, breaks: [-0.25, -0.1, 0.1, 0.3] },
    bsi: { min: -1, max: 1, breaks: [-0.15, 0.02, 0.2] },
    ndbi: { min: -1, max: 1, breaks: [-0.1, 0.1] },
    optram: { min: 0, max: 1, breaks: [0.2, 0.4, 0.6, 0.8] },
    msi: { min: 0, max: 3, breaks: [0.7, 1, 1.3, 1.8] },
    nmdi: { min: -1, max: 1, breaks: [-0.2, 0, 0.2, 0.4] },
    nsmi: { min: -1, max: 1, breaks: [-0.3, -0.1, 0.1, 0.3] },
    str: { min: 0, max: 6, breaks: [0.8, 1.5, 2.5, 4] }
  };
  const legendStretchByMode = new Map();

  function legendStepForMode(mode) {
    const scale = COLOR_STRETCH_SCALES[mode];
    if (!scale) return 0.001;
    const magnitude = scale.max - scale.min;
    return magnitude >= 1 ? magnitude / 1000 : magnitude / 1000;
  }

  function fmtLegendValue(value, mode) {
    if (!Number.isFinite(value)) return '—';
    const step = legendStepForMode(mode);
    const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))));
    return value.toFixed(decimals);
  }

  function sampledQuantiles(grid, lowerPercent = 2, upperPercent = 98) {
    if (!grid || !grid.length) return null;
    const values = [];
    const stride = Math.max(1, Math.ceil(grid.length / 50000));
    for (let i = 0; i < grid.length; i += stride) {
      const value = grid[i];
      if (Number.isFinite(value)) values.push(value);
    }
    if (!values.length) return null;
    values.sort((a, b) => a - b);
    const at = q => {
      const pos = (values.length - 1) * q;
      const base = Math.floor(pos), frac = pos - base;
      return base + 1 < values.length ? values[base] + frac * (values[base + 1] - values[base]) : values[base];
    };
    return { low: at(lowerPercent / 100), high: at(upperPercent / 100) };
  }

  function autoLegendStretch(mode, grid) {
    const scale = COLOR_STRETCH_SCALES[mode];
    if (!scale) return null;
    const q = sampledQuantiles(grid, 2, 98);
    if (!q) return { low: scale.min, high: scale.max, auto: true };
    let low = Math.max(scale.min, Math.min(scale.max, q.low));
    let high = Math.max(scale.min, Math.min(scale.max, q.high));
    const step = legendStepForMode(mode);
    if (high - low < step * 2) {
      const center = Math.max(scale.min, Math.min(scale.max, (q.low + q.high) / 2));
      low = Math.max(scale.min, center - (scale.max - scale.min) * 0.025);
      high = Math.min(scale.max, center + (scale.max - scale.min) * 0.025);
      if (high - low < step * 2) { low = scale.min; high = scale.max; }
    }
    return { low, high, auto: true };
  }

  function ensureLegendStretch(mode, grid) {
    if (!COLOR_STRETCH_SCALES[mode]) return null;
    if (!legendStretchByMode.has(mode)) legendStretchByMode.set(mode, autoLegendStretch(mode, grid));
    return legendStretchByMode.get(mode);
  }

  function transformedLegendValue(value, mode) {
    const scale = COLOR_STRETCH_SCALES[mode];
    const stretch = legendStretchByMode.get(mode);
    if (!scale || !stretch || !(stretch.high > stretch.low)) return value;
    const fraction = (value - stretch.low) / (stretch.high - stretch.low);
    return scale.min + fraction * (scale.max - scale.min);
  }

  function updateLegendStretchUI(mode, isDiff) {
    if (!COLOR_STRETCH_SCALES[mode] || isDiff) return '';
    const scale = COLOR_STRETCH_SCALES[mode];
    const stretch = ensureLegendStretch(mode, activeRenderedState?.raw?.indexGrid);
    if (!stretch) return '';
    const step = legendStepForMode(mode);
    return `<div class="legend-stretch-controls" data-mode="${mode}">
      <strong>Colour stretch — ${mode.toUpperCase()}</strong>
      <label for="legendMinSlider">Lower bound <span id="legendMinValue">${fmtLegendValue(stretch.low, mode)}</span></label>
      <input type="range" id="legendMinSlider" data-mode="${mode}" min="${scale.min}" max="${scale.max}" step="${step}" value="${stretch.low}" aria-label="Lower colour stretch bound">
      <label for="legendMaxSlider">Upper bound <span id="legendMaxValue">${fmtLegendValue(stretch.high, mode)}</span></label>
      <input type="range" id="legendMaxSlider" data-mode="${mode}" min="${scale.min}" max="${scale.max}" step="${step}" value="${stretch.high}" aria-label="Upper colour stretch bound">
      <div class="btn-row" style="margin-top:4px;"><button type="button" class="btn-secondary" data-action="legend-auto" data-mode="${mode}">Auto range (2–98%)</button></div>
      <p class="small-note">Adjust the actual index-value limits to increase contrast in the range of interest. Values outside the range use the end colours. This changes map colours only; chart values, pixel readings, CSV and GeoTIFF numbers remain unchanged. The range stays fixed while you browse dates, enabling visual comparison.</p>
    </div>`;
  }

  function customLegendMarkup(mode) {
    const scale = COLOR_STRETCH_SCALES[mode];
    const stretch = legendStretchByMode.get(mode);
    if (!scale || !stretch) return '';
    const paletteBounds = [scale.min, ...scale.breaks, scale.max].sort((a, b) => a - b);
    let html = '<div class="legend-stretch-bands"><strong>Displayed value bands</strong>';
    for (let i = 0; i < paletteBounds.length - 1; i++) {
      const a = paletteBounds[i], b = paletteBounds[i + 1];
      const paletteMid = (a + b) / 2;
      const actualMid = stretch.low + ((paletteMid - scale.min) / (scale.max - scale.min)) * (stretch.high - stretch.low);
      const rgba = colorizeIndex(actualMid, mode, false);
      const hex = '#' + [rgba[0], rgba[1], rgba[2]].map(v => v.toString(16).padStart(2, '0')).join('');
      const actualA = stretch.low + ((a - scale.min) / (scale.max - scale.min)) * (stretch.high - stretch.low);
      const actualB = stretch.low + ((b - scale.min) / (scale.max - scale.min)) * (stretch.high - stretch.low);
      let label;
      if (i === 0) label = `≤ ${fmtLegendValue(actualB, mode)}`;
      else if (i === paletteBounds.length - 2) label = `> ${fmtLegendValue(actualA, mode)}`;
      else label = `${fmtLegendValue(actualA, mode)} to ${fmtLegendValue(actualB, mode)}`;
      html += `<div class="legend-item"><div class="color-box" style="background:${hex};"></div>${label}</div>`;
    }
    return html + '</div>';
  }

  function colorizeIndex(val, mode, isDiff = false) {
    if (!Number.isFinite(val)) return [0, 0, 0, 0];
    if (mode === 'obs_count') {
      if (val < 0.5) return [70, 70, 78, 225];
      if (val < 2.5) return [125, 190, 220, 230];
      if (val < 5.5) return [80, 180, 135, 235];
      if (val < 10.5) return [245, 205, 75, 240];
      if (val < 20.5) return [235, 125, 48, 240];
      return [155, 38, 65, 245];
    }
    if (isDiff) {
      let t1 = 0.08, t2 = 0.25;
      if (mode === 'mci' || mode === 'fai') { t1 = 0.003; t2 = 0.01; }
      else if (mode === 'chl_ratio' || mode === 'turbidity_ratio') { t1 = 0.15; t2 = 0.4; }
      else if (mode === 'awei_nsh') { t1 = 0.15; t2 = 0.5; }
      if (val < -t2) return [180, 20, 20, 235];
      if (val < -t1) return [235, 120, 60, 235];
      if (val <= t1) return [230, 230, 230, 180];
      if (val <= t2) return [80, 200, 100, 235];
      return [0, 110, 40, 235];
    }
    if (!isDiff && COLOR_STRETCH_SCALES[mode]) {
      val = transformedLegendValue(val, mode);
    }
    if (mode === 'ndvi' || mode === 'evi') {
      if (val < 0) return [0, 0, 255, 235];
      if (val < 0.2) return [220, 180, 100, 235];
      if (val < 0.5) return [68, 170, 0, 235];
      return [0, 68, 0, 235];
    }
    if (mode === 'ndwi') {
      if (val > 0.2) return [0, 68, 255, 235];
      if (val > 0) return [68, 204, 255, 235];
      if (val > -0.3) return [68, 170, 0, 235];
      return [170, 119, 68, 235];
    }
    if (mode === 'mndwi') {
      if (val > 0.3) return [0, 65, 230, 240];
      if (val > 0.05) return [40, 190, 240, 235];
      if (val > -0.15) return [210, 205, 130, 225];
      return [145, 95, 65, 235];
    }
    if (mode === 'ndci') {
      if (val > 0.25) return [145, 0, 85, 240];
      if (val > 0.12) return [230, 40, 95, 235];
      if (val > 0.03) return [250, 150, 40, 235];
      if (val > -0.05) return [230, 220, 95, 225];
      return [50, 120, 150, 235];
    }
    if (mode === 'chl_ratio') {
      if (val > 2.2) return [125, 0, 80, 240];
      if (val > 1.6) return [220, 35, 90, 235];
      if (val > 1.1) return [245, 145, 45, 235];
      if (val > 0.7) return [230, 220, 95, 225];
      return [60, 115, 150, 235];
    }
    if (mode === 'mci') {
      if (val > 0.02) return [145, 0, 85, 240];
      if (val > 0.01) return [230, 35, 95, 235];
      if (val > 0.003) return [250, 150, 40, 235];
      if (val > -0.003) return [235, 225, 110, 220];
      return [50, 120, 150, 235];
    }
    if (mode === 'fai') {
      if (val > 0.02) return [145, 0, 85, 240];
      if (val > 0.01) return [230, 35, 95, 235];
      if (val > 0.003) return [250, 150, 40, 235];
      if (val > -0.003) return [235, 225, 110, 220];
      return [45, 100, 145, 235];
    }
    if (mode === 'ndti') {
      if (val > 0.25) return [150, 20, 30, 240];
      if (val > 0.1) return [230, 90, 35, 235];
      if (val > 0.02) return [245, 190, 50, 235];
      if (val > -0.05) return [110, 190, 165, 225];
      return [35, 100, 180, 235];
    }
    if (mode === 'turbidity_ratio') {
      if (val > 1.8) return [150, 20, 30, 240];
      if (val > 1.3) return [230, 90, 35, 235];
      if (val > 0.9) return [245, 190, 50, 235];
      if (val > 0.55) return [110, 190, 165, 225];
      return [35, 100, 180, 235];
    }
    if (mode === 'awei_nsh') {
      if (val > 0.15) return [0, 75, 220, 240];
      if (val > 0) return [45, 190, 230, 235];
      if (val > -0.25) return [220, 205, 120, 225];
      return [150, 95, 65, 235];
    }
    if (mode === 'ndmi' || mode === 'smi') {
      if (val > 0.35) return [0, 75, 204, 235];
      if (val > 0.1) return [68, 195, 145, 235];
      if (val > -0.1) return [221, 204, 85, 235];
      return [175, 70, 35, 235];
    }
    if (mode === 's2wi') {
      if (val > 0.05) return [0, 75, 210, 235];
      if (val > -0.15) return [65, 190, 150, 235];
      if (val > -0.35) return [220, 195, 85, 235];
      return [175, 68, 34, 235];
    }
    if (mode === 'nbr') {
      if (val > 0.3) return [0, 110, 40, 235];
      if (val > 0.1) return [120, 200, 80, 235];
      if (val > -0.1) return [230, 190, 80, 235];
      if (val > -0.25) return [225, 100, 30, 235];
      return [145, 15, 20, 235];
    }
    if (mode === 'bsi') {
      if (val > 0.2) return [195, 35, 25, 235];
      if (val > 0.02) return [225, 155, 60, 235];
      if (val > -0.15) return [160, 195, 90, 235];
      return [25, 120, 45, 235];
    }
    if (mode === 'ndbi') {
      if (val > 0.1) return [221, 34, 34, 235];
      if (val > -0.1) return [221, 170, 68, 235];
      return [34, 136, 51, 235];
    }
    if (mode === 'optram') {
      if (val >= 0.8) return [0, 65, 170, 240];
      if (val >= 0.6) return [35, 150, 220, 235];
      if (val >= 0.4) return [95, 190, 150, 230];
      if (val >= 0.2) return [220, 200, 95, 230];
      return [170, 75, 35, 235];
    }
    if (mode === 'msi') {
      if (val < 0.7) return [0, 80, 180, 235];
      if (val < 1.0) return [45, 165, 190, 235];
      if (val < 1.3) return [210, 200, 90, 230];
      if (val < 1.8) return [220, 125, 55, 235];
      return [145, 35, 30, 235];
    }
    if (mode === 'nmdi') {
      if (val > 0.4) return [0, 75, 190, 235];
      if (val > 0.2) return [45, 165, 190, 235];
      if (val > 0) return [205, 200, 90, 230];
      if (val > -0.2) return [220, 130, 50, 235];
      return [145, 35, 30, 235];
    }
    if (mode === 'nsmi') {
      if (val > 0.3) return [0, 75, 190, 235];
      if (val > 0.1) return [45, 165, 190, 235];
      if (val > -0.1) return [205, 200, 90, 230];
      if (val > -0.3) return [220, 130, 50, 235];
      return [145, 35, 30, 235];
    }
    if (mode === 'str') {
      if (val > 4) return [0, 65, 170, 240];
      if (val > 2.5) return [35, 150, 220, 235];
      if (val > 1.5) return [95, 190, 150, 230];
      if (val > 0.8) return [220, 200, 95, 230];
      return [170, 75, 35, 235];
    }
    return [0, 0, 0, 0];
  }

  function updateLegend(mode, isDiff) {
    if (isDiff && !['rgb', 'rgb_bands', 'false_color'].includes(mode)) {
      let t1 = 0.08, t2 = 0.25;
      if (mode === 'mci' || mode === 'fai') { t1 = 0.003; t2 = 0.01; }
      else if (mode === 'chl_ratio' || mode === 'turbidity_ratio') { t1 = 0.15; t2 = 0.4; }
      else if (mode === 'awei_nsh') { t1 = 0.15; t2 = 0.5; }
      const fmt = v => Number(v).toFixed(Math.max(2, (Math.abs(v) < 0.01 ? 3 : 2)));
      legend.innerHTML = `<strong>Δ ${mode.toUpperCase()} (Change)</strong>
        <div class="legend-item"><div class="color-box" style="background:#006e28;"></div>Strong Increase (&gt; +${fmt(t2)})</div>
        <div class="legend-item"><div class="color-box" style="background:#50c864;"></div>Moderate Increase (+${fmt(t1)} to +${fmt(t2)})</div>
        <div class="legend-item"><div class="color-box" style="background:#e6e6e6;"></div>No / Minor Change (-${fmt(t1)} to +${fmt(t1)})</div>
        <div class="legend-item"><div class="color-box" style="background:#eb783c;"></div>Moderate Decrease (-${fmt(t2)} to -${fmt(t1)})</div>
        <div class="legend-item"><div class="color-box" style="background:#b41414;"></div>Strong Decrease (&lt; -${fmt(t2)})</div>`;
      legend.style.display = 'flex';
      return;
    }

    const scales = {
      obs_count: [['#46464e', '0 clear observations'], ['#7dbedc', '1–2 observations'], ['#50b487', '3–5 observations'], ['#f5cd4b', '6–10 observations'], ['#eb7d30', '11–20 observations'], ['#9b2641', '>20 observations']],
      ndvi: [['#004400', 'Dense veg (> 0.5)'], ['#44aa00', 'Moderate veg (0.2–0.5)'], ['#ddaa55', 'Soil / sparse (0–0.2)'], ['#0000ff', 'Water (< 0)']],
      evi: [['#004400', 'High biomass (> 0.5)'], ['#44aa00', 'Moderate veg (0.2–0.5)'], ['#ddaa55', 'Sparse / soil (0–0.2)'], ['#0000ff', 'Water (< 0)']],
      ndwi: [['#0044ff', 'Open water (> 0.2)'], ['#44ccff', 'Wet / shallow (0–0.2)'], ['#44aa00', 'Vegetation (-0.3–0)'], ['#aa7744', 'Dry land (< -0.3)']],
      mndwi: [['#0041e6', 'Strong water signal (> 0.3)'], ['#28bef0', 'Possible water (0.05–0.3)'], ['#d2cd82', 'Mixed / uncertain (-0.15–0.05)'], ['#915f41', 'Likely non-water (< -0.15)']],
      ndci: [['#910055', 'High relative red-edge signal (> 0.25)'], ['#e6285f', 'Elevated (0.12–0.25)'], ['#fa9628', 'Moderate (0.03–0.12)'], ['#e6dc5f', 'Low / near zero'], ['#327896', 'Negative']],
      chl_ratio: [['#7d0050', 'Very high B05/B04 (> 2.2)'], ['#dc235a', 'High (1.6–2.2)'], ['#f5912d', 'Moderate (1.1–1.6)'], ['#e6dc5f', 'Lower (0.7–1.1)'], ['#3c7396', 'Very low (< 0.7)']],
      mci: [['#910055', 'Strong positive line height (> 0.02)'], ['#e6235f', 'Positive (0.01–0.02)'], ['#fa9628', 'Slight positive (0.003–0.01)'], ['#ebe16e', 'Near zero'], ['#327896', 'Negative']],
      fai: [['#910055', 'Strong positive anomaly (> 0.02)'], ['#e6235f', 'Positive (0.01–0.02)'], ['#fa9628', 'Slight positive (0.003–0.01)'], ['#ebe16e', 'Near zero'], ['#2d6491', 'Negative']],
      ndti: [['#96141e', 'Higher red-vs-green signal (> 0.25)'], ['#e65a23', 'Elevated (0.1–0.25)'], ['#f5be32', 'Moderate (0.02–0.1)'], ['#6ebea5', 'Near zero'], ['#2364b4', 'Negative']],
      turbidity_ratio: [['#96141e', 'High red/green ratio (> 1.8)'], ['#e65a23', 'Elevated (1.3–1.8)'], ['#f5be32', 'Moderate (0.9–1.3)'], ['#6ebea5', 'Low (0.55–0.9)'], ['#2364b4', 'Very low (< 0.55)']],
      awei_nsh: [['#004bde', 'Strong water signal (> 0.15)'], ['#2dbedc', 'Possible water (0–0.15)'], ['#dccd78', 'Mixed (-0.25–0)'], ['#965f41', 'Likely non-water (< -0.25)']],
      ndmi: [['#004bcc', 'Higher NDMI (> 0.35)'], ['#44c391', 'Moderate (0.1–0.35)'], ['#ddcc55', 'Near zero (-0.1–0.1)'], ['#af4623', 'Lower (< -0.1)']],
      msi: [['#004fb4', 'Low MSI (< 0.7): relatively lower stress'], ['#2da5be', '0.7–1.0'], ['#d2c855', '1.0–1.3'], ['#dc7d37', '1.3–1.8'], ['#91231e', 'High MSI (> 1.8): relatively higher stress']],
      nmdi: [['#004bbd', 'Higher NMDI (> 0.4)'], ['#2da5be', '0.2–0.4'], ['#cdc855', '0–0.2'], ['#dc8232', '-0.2–0'], ['#91231e', 'Lower (< -0.2)']],
      nsmi: [['#004bbd', 'Higher NSMI (> 0.3)'], ['#2da5be', '0.1–0.3'], ['#cdc855', '-0.1–0.1'], ['#dc8232', '-0.3–-0.1'], ['#91231e', 'Lower (< -0.3)']],
      str: [['#0041aa', 'High STR (> 4)'], ['#2396dc', '2.5–4'], ['#5fbe96', '1.5–2.5'], ['#dcc85f', '0.8–1.5'], ['#aa4b23', 'Lower STR (< 0.8)']],
      optram: [['#0041aa', 'High relative wetness (≥ 0.8)'], ['#2396dc', 'Relatively wet (0.6–0.8)'], ['#5fbe96', 'Intermediate (0.4–0.6)'], ['#dcc85f', 'Relatively dry (0.2–0.4)'], ['#aa4b23', 'Low relative wetness (< 0.2)']],
      smi: [['#004bcc', 'Higher SMI (> 0.35)'], ['#44c391', 'Moderate (0.1–0.35)'], ['#ddcc55', 'Transition (-0.1–0.1)'], ['#af4623', 'Lower (< -0.1)']],
      s2wi: [['#004bd2', 'Saturated topsoil (> 0.05)'], ['#41be96', 'Moist topsoil (-0.15–0.05)'], ['#dcc355', 'Low moisture (-0.35 to -0.15)'], ['#af4422', 'Dry topsoil (< -0.35)']],
      nbr: [['#006e28', 'Healthy / unburned (> 0.3)'], ['#78c850', 'Low / recovering (0.1–0.3)'], ['#e6be50', 'Low burn (-0.1–0.1)'], ['#e1641e', 'Moderate burn (-0.25 to -0.1)'], ['#910f14', 'Severe burn scar (< -0.25)']],
      bsi: [['#c32319', 'Exposed slip / bare (> 0.2)'], ['#e19b3c', 'Sparse / disturbed (0.02–0.2)'], ['#a0c35a', 'Light cover (-0.15–0.02)'], ['#19782d', 'Dense veg (< -0.15)']],
      ndbi: [['#dd2222', 'Built-up / bare (> 0.1)'], ['#ddaa44', 'Mixed (-0.1–0.1)'], ['#228833', 'Vegetation (< -0.1)']]
    };
    if (!scales[mode]) { legend.style.display = 'none'; return; }
    const proxyModes = ['ndci', 'chl_ratio', 'mci', 'fai', 'ndti', 'turbidity_ratio'];
    if (COLOR_STRETCH_SCALES[mode]) {
      ensureLegendStretch(mode, activeRenderedState?.raw?.indexGrid);
      legend.innerHTML = `<strong>${mode.toUpperCase()} Colour Scale</strong>` +
        customLegendMarkup(mode) +
        (proxyModes.includes(mode) ? '<p class="small-note">Relative screening scale only; thresholds are not universal and must not be interpreted as concentration units.</p>' : '') +
        (waterOnlyChk.checked && WATER_QUALITY_PROXY_MODES.has(mode) ? '<p class="small-note">Water-only filter active: MNDWI must exceed ' + waterMaskThresholdInput.value + '.</p>' : '') +
        updateLegendStretchUI(mode, isDiff);
    } else {
      legend.innerHTML = `<strong>${mode.toUpperCase()} Scale</strong>` +
        scales[mode].map(([col, lbl]) => `<div class="legend-item"><div class="color-box" style="background:${col};"></div>${lbl}</div>`).join('') +
        (proxyModes.includes(mode) ? '<p class="small-note">Relative screening scale only; thresholds are not universal and must not be interpreted as concentration units.</p>' : '') +
        (waterOnlyChk.checked && WATER_QUALITY_PROXY_MODES.has(mode) ? '<p class="small-note">Water-only filter active: MNDWI must exceed ' + waterMaskThresholdInput.value + '.</p>' : '');
    }
    legend.style.display = 'flex';
  }

  let legendRenderTimer = null;
  legend.addEventListener('input', event => {
    const target = event.target;
    if (target.id !== 'legendMinSlider' && target.id !== 'legendMaxSlider') return;
    const mode = target.dataset.mode;
    const scale = COLOR_STRETCH_SCALES[mode];
    if (!scale) return;
    const stretch = ensureLegendStretch(mode, activeRenderedState?.raw?.indexGrid);
    if (!stretch) return;
    const step = legendStepForMode(mode);
    const requested = Number(target.value);
    if (target.id === 'legendMinSlider') {
      stretch.low = Math.max(scale.min, Math.min(scale.max, Math.min(requested, stretch.high - step)));
    } else {
      stretch.high = Math.min(scale.max, Math.max(scale.min, Math.max(requested, stretch.low + step)));
    }
    stretch.auto = false;
    const minInput = document.getElementById('legendMinSlider');
    const maxInput = document.getElementById('legendMaxSlider');
    const minReadout = document.getElementById('legendMinValue');
    const maxReadout = document.getElementById('legendMaxValue');
    if (minInput) minInput.value = String(stretch.low);
    if (maxInput) maxInput.value = String(stretch.high);
    if (minReadout) minReadout.textContent = fmtLegendValue(stretch.low, mode);
    if (maxReadout) maxReadout.textContent = fmtLegendValue(stretch.high, mode);
    if (legendRenderTimer) clearTimeout(legendRenderTimer);
    legendRenderTimer = setTimeout(() => {
      legendRenderTimer = null;
      displayStepByIndex(Number(sceneSlider.value) || 0);
    }, 180);
  });

  legend.addEventListener('click', event => {
    const button = event.target.closest('button[data-action="legend-auto"]');
    if (!button) return;
    const mode = button.dataset.mode;
    const scale = COLOR_STRETCH_SCALES[mode];
    if (!scale) return;
    const raw = activeRenderedState?.raw;
    const grid = raw?.indexGrid;
    legendStretchByMode.set(mode, autoLegendStretch(mode, grid));
    displayStepByIndex(Number(sceneSlider.value) || 0);
  });

  function stampDateOnCanvas(ctx, labelText) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const minDim = Math.min(w, h);
    const fontSize = Math.max(9, Math.min(18, Math.round(minDim * 0.042)));
    const padX = Math.max(4, Math.round(fontSize * 0.45));
    const margin = Math.max(4, Math.round(minDim * 0.02));
    const bh = Math.round(fontSize * 1.65);

    ctx.save();
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    const bw = Math.min(w - margin * 2, ctx.measureText(labelText).width + padX * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(margin, margin, bw, bh);
    ctx.strokeStyle = '#4daafc';
    ctx.lineWidth = Math.max(1, fontSize * 0.08);
    ctx.strokeRect(margin, margin, bw, bh);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, margin + padX, margin + bh / 2, bw - padX * 2);
    ctx.restore();
  }

  // ============================================================================
