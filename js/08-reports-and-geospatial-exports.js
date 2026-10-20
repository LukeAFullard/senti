// Extracted from the original single-file app.
// Load order is significant; see ../README.md before moving/removing scripts.
// Reproducibility report, geospatial exports and OPTRAM diagnostics

'use strict';

  // Reproducibility, geospatial exports and diagnostics (no ground data needed)
  // --------------------------------------------------------------------------
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 6000);
  }

  geoJsonBtn.addEventListener('click', () => {
    const features = [];
    aoiGroup.eachLayer(layer => {
      const feature = layer.toGeoJSON();
      feature.properties = { ...(feature.properties || {}), role: 'analysis_aoi_rectangle' };
      features.push(feature);
    });
    probeGroup.eachLayer(layer => {
      const feature = layer.toGeoJSON();
      feature.properties = { ...(feature.properties || {}), role: feature.geometry?.type === 'Polygon' ? 'summary_polygon' : feature.geometry?.type === 'LineString' ? 'transect' : 'sample_point' };
      features.push(feature);
    });
    if (!features.length) { log('Draw an AOI rectangle or a point/line/polygon before exporting GeoJSON.'); return; }
    // RFC 7946 GeoJSON coordinates are WGS84 longitude/latitude; omit the deprecated `crs` member.
    const collection = { type: 'FeatureCollection', name: 'Sentinel-2 analysis geometry', features };
    triggerDownload(new Blob([JSON.stringify(collection, null, 2)], { type: 'application/geo+json;charset=utf-8' }), 'sentinel_analysis_geometries.geojson');
    log(`Exported ${features.length} AOI / drawing feature(s) as GeoJSON (WGS84 longitude/latitude).`);
  });

  geoTiffBtn.addEventListener('click', async () => {
    const state = activeRenderedState;
    if (!state?.raw || !state.raw.indexGrid || ['rgb', 'rgb_bands', 'false_color'].includes(outputMode.value)) {
      log('Select a numeric spectral index or observation-count layer before exporting GeoTIFF.'); return;
    }
    const raw = state.raw;
    const exportGrid = state.isDiff && state.inspectGrid ? state.inspectGrid : raw.indexGrid;
    if (typeof GeoTIFF === 'undefined' || typeof GeoTIFF.writeArrayBuffer !== 'function') {
      log('GeoTIFF writing is not available in this GeoTIFF build.'); return;
    }
    geoTiffBtn.disabled = true;
    const original = geoTiffBtn.textContent;
    geoTiffBtn.textContent = 'Writing GeoTIFF…';
    try {
      const w = raw.refWindow;
      const sw = w[2] - w[0], sh = w[3] - w[1];
      const scaleX = Math.abs(raw.refRes[0] * sw / raw.width);
      const scaleY = Math.abs(raw.refRes[1] * sh / raw.height);
      const tieX = raw.refOrigin[0] + w[0] * raw.refRes[0];
      const tieY = raw.refOrigin[1] + w[1] * raw.refRes[1];
      const epsgMatch = String(raw.refCrs || '').match(/EPSG\s*:\s*(\d+)/i);
      if (!epsgMatch) throw new Error('Could not identify an EPSG code for this grid; GeoTIFF export cancelled to avoid an unreferenced raster.');
      const epsg = Number(epsgMatch[1]);
      const exportGridClean = new Float32Array(exportGrid.length);
      for (let i = 0; i < exportGrid.length; i++) {
        exportGridClean[i] = Number.isNaN(exportGrid[i]) ? -9999 : exportGrid[i];
      }

      const metadata = {
        width: raw.width, height: raw.height,
        ModelPixelScale: [scaleX, scaleY, 0],
        ModelTiepoint: [0, 0, 0, tieX, tieY, 0],
        GTModelTypeGeoKey: epsg === 4326 ? 2 : 1,
        ...(epsg === 4326 ? { GeographicTypeGeoKey: 4326 } : { ProjectedCSTypeGeoKey: epsg }),
        GDAL_NODATA: '-9999',
        ImageDescription: `${state.isDiff ? 'Change layer' : 'Sentinel-2 analysis'}; mode=${raw.mode || outputMode.value}; date=${raw.dateStr || ''}; ${new Date().toISOString()}`
      };
      const buffer = await GeoTIFF.writeArrayBuffer(exportGridClean, metadata);
      const label = state.isDiff ? 'change' : (raw.mode || outputMode.value);
      triggerDownload(new Blob([buffer], { type: 'image/tiff' }), `sentinel_${label}_${String(raw.dateStr || 'analysis').replace(/[^a-z0-9_-]/gi, '_')}.tif`);
      log(`Exported georeferenced ${raw.width}×${raw.height} Float32 GeoTIFF (EPSG:${epsg}). Values are analysis-grid values, not native-resolution pixels.`);
    } catch (err) {
      log('GeoTIFF export failed: ' + err.message);
    } finally {
      geoTiffBtn.textContent = original;
      geoTiffBtn.disabled = !activeRenderedState?.raw?.indexGrid || ['rgb', 'rgb_bands', 'false_color'].includes(outputMode.value);
    }
  });

  reportBtn.addEventListener('click', () => {
    if (!validScenes.length || !activeRenderedState) { log('Load an analysis first to create a reproducibility report.'); return; }
    const mode = outputMode.value;
    const raw = activeRenderedState.raw || {};
    const selectedStretch = COLOR_STRETCH_SCALES[mode] ? legendStretchByMode.get(mode) : null;
    const supportSummary = (() => {
      const support = Array.from(dataSupportCache.values())[0];
      if (!support?.indexGrid?.length) return 'Not calculated in this session';
      const grid = support.indexGrid;
      let zero = 0, threePlus = 0, sum = 0, max = 0;
      for (let i = 0; i < grid.length; i++) {
        const value = grid[i];
        if (!Number.isFinite(value)) continue;
        if (value === 0) zero++;
        if (value >= 3) threePlus++;
        sum += value; max = Math.max(max, value);
      }
      const n = grid.length || 1;
      return `mean=${(sum/n).toFixed(2)} clear valid observations/cell; 0 observations=${(100*zero/n).toFixed(1)}% of cells; ≥3 observations=${(100*threePlus/n).toFixed(1)}%; max=${max}; grid=${support.width}×${support.height}`;
    })();
    const selectedRadar = radarScenes.find(item => item.id === radarSceneSelect.value);
    const settings = [
      ['Data scope', 'Satellite imagery and satellite acquisition metadata only; no ground measurements or meteorological reanalysis inputs'],
      ['Start date', startDateInput.value], ['End date', endDateInput.value],
      ['Analysis mode', mode], ['Temporal view', temporalMode.value],
      ['Map colour stretch', selectedStretch ? `${mode}: ${fmtLegendValue(selectedStretch.low, mode)} to ${fmtLegendValue(selectedStretch.high, mode)} (visual only; analysis values unchanged)` : 'Default palette or non-stretched mode'],
      ['Composite statistic', compositeStat.value], ['Custom percentile', percentileVal.value],
      ['Maximum scene cloud', `${maxCloudInput.value}%`], ['Cloud/shadow/snow mask (SCL)', maskCloudsChk.checked ? 'enabled for ordinary index layers; observation support and OPTRAM calibration mask independently' : 'disabled for ordinary index display; observation support and OPTRAM calibration still mask independently'],
      ['Valid-observation support summary', supportSummary],
      ['Sentinel-1 RTC selected item', selectedRadar ? selectedRadar.id : 'Not selected'],
      ['Sentinel-1 display mode', radarOverlay && selectedRadar ? `${radarMode.value}; overlay currently shown` : 'Not displayed'],
      ['Seasonal anomaly', seasonalAnomalyResult ? `${seasonalAnomalyResult.targetMode} on ${seasonalAnomalyResult.targetDate}; ${seasonalAnomalyResult.referenceCount} other-year reference scenes; ±${seasonalAnomalyResult.windowDays} days; at least ${seasonalAnomalyResult.minObs} clear observations/pixel` : 'Not calculated in this session'],
      ['Optical–radar comparison', radarCompareOverlay ? `Displayed; optical index=${mode}; radar metric=${radarMode.value}; directional agreement only` : 'Not displayed'],
      ['Water-only filter', waterOnlyChk.checked ? `enabled; MNDWI > ${waterMaskThresholdInput.value}` : 'disabled'],
      ['Loaded selected acquisition dates', validScenes.length], ['Displayed output', raw.dateStr || activeRenderedState.stampLabel || ''],
      ['Analysis grid', `${raw.width || 'N/A'} × ${raw.height || 'N/A'}; up to ${MAX_OUTPUT_DIMENSION} cells per side`],
      ['Data source', `Earth Search STAC ${STAC_SEARCH_URL}; collection ${STAC_COLLECTION}`],
      ['AOI bbox (west,south,east,north)', drawnBbox ? drawnBbox.map(v => Number(v).toFixed(7)).join(', ') : 'Not available'],
      ['OPTRAM calibration', optramCalibration ? `${optramCalibration.scenesUsed} scenes; ${optramCalibration.sampleCount} valid sample visits; global dry STR p10=${optramCalibration.globalDry}; global wet STR p90=${optramCalibration.globalWet}` : 'Not fitted in current app session'],
      ['Independent validation', 'No ground measurements were supplied; results are remote-sensing proxies/internal diagnostics, not independently validated estimates.']
    ];
    const sceneRows = validScenes.map(sc => `<tr><td>${escapeHtml(getSceneDateStr(sc))}</td><td>${escapeHtml(sc.id)}</td><td>${Number.isFinite(getCloudCover(sc)) ? getCloudCover(sc).toFixed(1) + '%' : 'N/A'}</td><td>${escapeHtml(sc.properties?.['s2:product_uri'] || '')}</td></tr>`).join('');
    const settingRows = settings.map(([k,v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sentinel analysis reproducibility report</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#222}h1,h2{line-height:1.2}table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:13px}th,td{border:1px solid #bbb;padding:6px;text-align:left;overflow-wrap:anywhere}th{background:#eee}p{max-width:850px}.warning{border-left:4px solid #b8860b;padding:8px 12px;background:#fff8e5}</style></head><body><h1>Sentinel analysis reproducibility report</h1><p>Generated ${escapeHtml(new Date().toISOString())} by the browser-based Sentinel-2 Wetness Explorer.</p><p class="warning"><strong>Interpretation note:</strong> no ground data are available for independent validation. Index and radar products are screening evidence; OPTRAM is relative wetness, not volumetric soil moisture. Water-quality indices are spectral proxies, not concentration estimates.</p><h2>Analysis settings</h2><table>${settingRows}</table><h2>Selected Sentinel-2 acquisitions</h2><p>Scene cloud cover is catalogue metadata; it is not a substitute for AOI-level valid-pixel coverage. The valid-observation count mode estimates pixel support on the app's analysis grid after applying the SCL mask.</p><table><thead><tr><th>Date</th><th>STAC item ID</th><th>Scene cloud cover</th><th>Product URI (if supplied)</th></tr></thead><tbody>${sceneRows}</tbody></table><h2>Methods and limitations</h2><p>The app uses cloud-optimised raster assets from Earth Search and calculates spectral indices client-side. Spatial summaries operate on the app's capped analysis grid and may be coarser than the native source bands. Calibration diagnostics describe the fitted AOI/date-range data only; they do not constitute ground validation.</p><p>Save this report alongside exported GeoTIFF, GeoJSON and CSV outputs to preserve the settings used for analysis.</p></body></html>`;
    triggerDownload(new Blob([html], { type: 'text/html;charset=utf-8' }), `sentinel_reproducibility_${new Date().toISOString().slice(0,10)}.html`);
    log('Downloaded reproducibility report with settings, scene IDs, AOI metadata and limitations.');
  });

  optramDiagnosticsBtn.addEventListener('click', async () => {
    if (!validScenes.length) { optramDiagnosticsText.textContent = 'Draw an AOI, search Sentinel-2, and load dates first.'; return; }
    optramDiagnosticsBtn.disabled = true;
    optramDiagnosticsText.textContent = 'Fitting OPTRAM using clear observations and building the wet/dry edge diagnostic...';
    try {
      const model = await ensureOptramCalibration();
      const edgeRows = model.edges || [];
      const fmt = v => Number.isFinite(v) ? Number(v).toFixed(4) : 'N/A';
      optramDiagnosticsText.innerHTML = `<strong>Calibration diagnostics</strong><br>Acquisitions contributing data: ${model.scenesUsed}; valid sample visits before per-bin caps: ${model.sampleCount.toLocaleString()}; NDVI bins with edge estimates: ${edgeRows.length}/12.<br>Global STR dry edge (p10): ${fmt(model.globalDry)}; wet edge (p90): ${fmt(model.globalWet)}; edge separation: ${fmt(model.globalWet - model.globalDry)}.<br><em>Small edge separation, sparse bins or weak seasonal moisture contrast can make the relative wetness map unstable. No ground measurements means absolute moisture accuracy is unknown.</em>`;
      const ctx = document.getElementById('optramCalibrationChart').getContext('2d');
      if (optramCalibrationChart) optramCalibrationChart.destroy();
      const allEdges = edgeRows.length >= 2 ? edgeRows : [{ ndvi: 0, dry: model.globalDry, wet: model.globalWet }, { ndvi: 1, dry: model.globalDry, wet: model.globalWet }];
      optramCalibrationChart = new Chart(ctx, {
        type: 'scatter',
        data: { datasets: [
          { label: 'Dry edge (STR p10)', data: allEdges.map(e => ({ x: e.ndvi, y: e.dry })), showLine: true, borderColor: '#d9822b', backgroundColor: '#d9822b', pointRadius: 4, tension: 0.15 },
          { label: 'Wet edge (STR p90)', data: allEdges.map(e => ({ x: e.ndvi, y: e.wet })), showLine: true, borderColor: '#3689d6', backgroundColor: '#3689d6', pointRadius: 4, tension: 0.15 }
        ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'nearest', intersect: false }, plugins: { title: { display: true, text: 'OPTRAM feature-space edge fit', color: '#eee' }, legend: { labels: { color: '#ccc' } } }, scales: { x: { type: 'linear', min: 0.05, max: 1, title: { display: true, text: 'NDVI', color: '#aaa' }, ticks: { color: '#aaa' } }, y: { title: { display: true, text: 'Transformed SWIR reflectance (STR)', color: '#aaa' }, ticks: { color: '#aaa' } } } }
      });
      log(`OPTRAM diagnostics shown: ${model.scenesUsed} acquisitions, ${edgeRows.length} usable NDVI bins.`);
    } catch (err) {
      optramDiagnosticsText.textContent = 'Could not fit OPTRAM diagnostics: ' + err.message;
      log('OPTRAM diagnostics error: ' + err.message);
    } finally { optramDiagnosticsBtn.disabled = false; }
  });

  // --------------------------------------------------------------------------
