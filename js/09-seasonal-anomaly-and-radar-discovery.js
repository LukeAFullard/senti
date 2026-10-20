// Extracted from the original single-file app.
// Load order is significant; see ../README.md before moving/removing scripts.
// Seasonal anomaly tools and Sentinel-1 scene discovery/access helpers

'use strict';

  // Sentinel-1 RTC: public STAC search, short-lived asset URL signing, and local
  // raster analysis. RTC backscatter is expressed as relative dB after scaling.
  // --------------------------------------------------------------------------
  function getDoyInfo(item) {
    const date = new Date((item?.properties?.datetime || '') + '');
    if (!Number.isFinite(date.getTime())) return null;
    const year = date.getUTCFullYear();
    const start = Date.UTC(year, 0, 1);
    const doy = Math.floor((Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - start) / 86400000) + 1;
    const yearDays = (Date.UTC(year + 1, 0, 1) - start) / 86400000;
    return { year, doy, fraction: (doy - 1) / yearDays, date: date.toISOString().slice(0,10) };
  }

  function seasonalDoyDistanceDays(a, b) {
    const ai = getDoyInfo(a), bi = getDoyInfo(b);
    if (!ai || !bi) return Infinity;
    const raw = Math.abs(ai.fraction - bi.fraction);
    return Math.min(raw, 1 - raw) * 365.2425;
  }

  async function resampleNumericGridToTarget(sourceRaw, sourceGrid, targetRaw, progressLabel = '', statusElement = seasonalAnomalyStatus) {
    if (!sourceRaw || !sourceGrid || !targetRaw) throw new Error('A source or target raster grid is missing.');
    if (gridsShareGeometry(sourceRaw, targetRaw)) return sourceGrid;
    const out = new Float32Array(targetRaw.width * targetRaw.height);
    out.fill(NaN);
    for (let y = 0; y < targetRaw.height; y++) {
      for (let x = 0; x < targetRaw.width; x++) {
        const [lon, lat] = rawPixelToLonLat(targetRaw, x, y);
        const value = sampleValueAtLonLat(sourceRaw, sourceGrid, lon, lat);
        out[y * targetRaw.width + x] = typeof value === 'number' && Number.isFinite(value) ? value : NaN;
      }
      if (y % 24 === 23) {
        if (progressLabel && statusElement) statusElement.textContent = progressLabel + ` Aligning grids (${Math.round(100 * (y + 1) / targetRaw.height)}%)…`;
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }
    return out;
  }

  function seasonalAnomalyColor(value, limit) {
    if (!Number.isFinite(value)) return [0,0,0,0];
    const stops = [
      [-1, [33, 85, 165, 238]], [-0.5, [119, 183, 216, 225]],
      [0, [216, 216, 216, 190]], [0.5, [239, 164, 95, 225]], [1, [165, 29, 45, 238]]
    ];
    const t = Math.max(-1, Math.min(1, value / limit));
    for (let i=1;i<stops.length;i++) {
      if (t <= stops[i][0]) {
        const [x0,c0] = stops[i-1], [x1,c1] = stops[i];
        const f = Math.max(0, Math.min(1, (t-x0)/(x1-x0)));
        return c0.map((v,j)=>Math.round(v+(c1[j]-v)*f));
      }
    }
    return stops[stops.length-1][1];
  }

  function buildColorCanvas(grid, width, height, colorFn) {
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(width, height);
    for (let i=0;i<grid.length;i++) {
      const rgba = colorFn(grid[i]), j=i*4;
      img.data[j]=rgba[0]; img.data[j+1]=rgba[1]; img.data[j+2]=rgba[2]; img.data[j+3]=rgba[3];
    }
    ctx.putImageData(img,0,0);
    return c;
  }

  seasonalAnomalyBtn.addEventListener('click', async () => {
    if (!drawnBbox || !validScenes.length || !displaySteps.length) {
      seasonalAnomalyStatus.textContent = 'Draw an AOI and load Sentinel-2 scenes first.'; return;
    }
    const mode = outputMode.value;
    if (['rgb','rgb_bands','false_color','obs_count'].includes(mode)) {
      seasonalAnomalyStatus.textContent = 'Choose a numeric spectral index or OPTRAM in Primary Mode before calculating an anomaly.'; return;
    }
    if (temporalMode.value !== 'single') {
      seasonalAnomalyStatus.textContent = 'Set Temporal View to Individual Dates, then select the acquisition you want to assess.'; return;
    }
    const stepIndex = Number(sceneSlider.value);
    const targetStep = displaySteps[stepIndex];
    const targetItem = targetStep?.scenes?.length === 1 ? targetStep.scenes[0] : null;
    if (!targetItem) { seasonalAnomalyStatus.textContent = 'Select an individual Sentinel-2 acquisition.'; return; }
    const targetInfo = getDoyInfo(targetItem);
    if (!targetInfo) { seasonalAnomalyStatus.textContent = 'The selected acquisition date could not be read.'; return; }
    const windowDays = Math.max(15, Math.min(120, Number(anomalyWindowDaysInput.value) || 45));
    anomalyWindowDaysInput.value = String(windowDays);
    const minObs = Math.max(2, Math.min(12, Math.floor(Number(anomalyMinObservationsInput.value) || 3)));
    anomalyMinObservationsInput.value = String(minObs);
    const maxZ = Math.max(1, Math.min(5, Number(anomalyZLimitInput.value) || 3));
    anomalyZLimitInput.value = String(maxZ);
    // Require other years so the target acquisition cannot leak into its own seasonal reference.
    let candidates = validScenes.filter(sc => {
      const info = getDoyInfo(sc);
      return info && info.year !== targetInfo.year && seasonalDoyDistanceDays(sc, targetItem) <= windowDays;
    });
    // Chronological ordering lets the memory cap select a representative spread of years.
    candidates.sort((a,b)=>new Date(a.properties.datetime)-new Date(b.properties.datetime));
    if (candidates.length < minObs) {
      seasonalAnomalyStatus.textContent = `Not enough other-year observations around this season: found ${candidates.length} scene(s) within ±${windowDays} days; need at least ${minObs}. Extend the date range across more years, enable all matching scenes, or widen the season window.`;
      return;
    }
    // Bound memory while preserving temporal spread if the selected range is very large.
    const candidateTotal = candidates.length;
    const maxReferenceScenes = 24;
    if (candidates.length > maxReferenceScenes) {
      const selected = [];
      for (let i=0;i<maxReferenceScenes;i++) selected.push(candidates[Math.round(i*(candidates.length-1)/(maxReferenceScenes-1))]);
      candidates = Array.from(new Map(selected.map(sc=>[sc.id,sc])).values());
    }
    seasonalAnomalyBtn.disabled = true;
    seasonalAnomalyBtn.textContent = 'Calculating…';
    seasonalAnomalyStatus.textContent = `Loading ${candidates.length} clear-masked reference scenes from other years for ${targetInfo.date}…`;
    clearSeasonalAnomalyOverlay();
    try {
      const targetRaw = await computeSceneRaw(targetItem, mode, true);
      if (!targetRaw.indexGrid) throw new Error('The selected image did not produce a numeric index grid.');
      const baselineRaws = await mapConcurrent(candidates, SCENE_CONCURRENCY, async (item, ix) => {
        seasonalAnomalyStatus.textContent = `Reading seasonal reference ${ix + 1}/${candidates.length} (${getSceneDateStr(item)})…`;
        return computeSceneRaw(item, mode, true);
      });
      const alignedGrids = [];
      for (let i=0;i<baselineRaws.length;i++) {
        seasonalAnomalyStatus.textContent = `Aligning reference ${i + 1}/${baselineRaws.length} to the selected grid…`;
        alignedGrids.push(await resampleNumericGridToTarget(baselineRaws[i], baselineRaws[i].indexGrid, targetRaw, seasonalAnomalyStatus.textContent));
      }
      let result;
      try {
        result = await runCpuWorkerTask('seasonal-anomaly', {
          length: targetRaw.width * targetRaw.height,
          target: targetRaw.indexGrid,
          baselines: alignedGrids,
          minObs,
          maxZ
        });
      } catch (workerErr) {
        seasonalAnomalyStatus.textContent = 'Worker unavailable; calculating seasonal statistics in responsive batches…';
        const nPix = targetRaw.width * targetRaw.height;
        const out = new Float32Array(nPix), medians = new Float32Array(nPix), support = new Uint16Array(nPix);
        const vals = new Float32Array(alignedGrids.length), devs = new Float32Array(alignedGrids.length);
        const medianOf = (arr,n) => { const sorted=Array.from(arr.subarray(0,n)).sort((a,b)=>a-b); const m=Math.floor(n/2); return n%2?sorted[m]:(sorted[m-1]+sorted[m])/2; };
        for (let i=0;i<nPix;i++) {
          const target=targetRaw.indexGrid[i];
          if (!Number.isFinite(target)) { out[i]=NaN; medians[i]=NaN; support[i]=0; continue; }
          let n=0; for(const grid of alignedGrids){const v=grid[i];if(Number.isFinite(v))vals[n++]=v;}
          support[i]=n; if(n<minObs){out[i]=NaN;medians[i]=NaN;continue;}
          const med=medianOf(vals,n); medians[i]=med;
          for(let j=0;j<n;j++)devs[j]=Math.abs(vals[j]-med);
          const scale=1.4826*medianOf(devs,n), delta=target-med;
          out[i]=Number.isFinite(scale)&&scale>1e-7?delta/scale:(Math.abs(delta)<=1e-7?0:Math.sign(delta)*maxZ);
          if(i%40000===39999) await new Promise(resolve=>requestAnimationFrame(resolve));
        }
        result={indexGrid:out,baselineMedian:medians,support};
      }
      const anomalyRaw = { ...targetRaw, indexGrid: result.indexGrid, mode: 'seasonal_anomaly', dateStr: targetInfo.date };
      seasonalAnomalyResult = { raw: anomalyRaw, targetMode: mode, targetDate: targetInfo.date, targetYear: targetInfo.year, baselineMedian: result.baselineMedian, support: result.support, referenceIds: candidates.map(sc=>sc.id), referenceCount: candidates.length, candidatesBeforeCap: candidateTotal, windowDays, minObs, maxZ };
      const colorCanvas = buildColorCanvas(result.indexGrid, targetRaw.width, targetRaw.height, value => seasonalAnomalyColor(value, maxZ));
      const warped = warpCanvasToWebMercator(colorCanvas, targetRaw.refImage, targetRaw.refWindow, targetRaw.refCrs, MAX_MAP_OVERLAY_DIMENSION);
      seasonalAnomalyOverlay = L.imageOverlay(warped.warpedCanvas.toDataURL('image/png'), warped.bounds, { opacity: 0.86, pane: 'anomalyPane' }).addTo(map);
      clearAnomalyBtn.disabled = false;
      exportAnomalyBtn.disabled = false;
      seasonalAnomalyLegend.style.display = 'block';
      let n=0,pos=0,neg=0,absSum=0,wellSupported=0;
      for(let i=0;i<result.indexGrid.length;i++){
        const z=result.indexGrid[i];if(!Number.isFinite(z))continue;n++;if(z>=1)pos++;if(z<=-1)neg++;absSum+=Math.abs(z);
        if(result.support[i]>=minObs)wellSupported++;
      }
      const validPct=100*n/Math.max(1,result.indexGrid.length);
      seasonalAnomalyStatus.innerHTML = `<strong>${escapeHtml(targetInfo.date)} · ${escapeHtml(mode.toUpperCase())} seasonal anomaly</strong><br>Other-year references used: ${candidates.length}${candidateTotal>candidates.length?` of ${candidateTotal} eligible scenes (memory cap)`:''}; season window: ±${windowDays} days; minimum clear observations per pixel: ${minObs}.<br>Pixels with a supported anomaly: ${validPct.toFixed(1)}%; score ≥ +1: ${(100*pos/Math.max(1,n)).toFixed(1)}%; score ≤ −1: ${(100*neg/Math.max(1,n)).toFixed(1)}%; mean absolute score: ${(absSum/Math.max(1,n)).toFixed(2)}.<br><span class="small-note">Positive means the index is higher than its other-year seasonal median; negative means lower. Where the historical MAD is zero but the target differs, the score saturates at the display limit. Only display colours are capped; exported anomaly values are capped robust scores.</span>`;
      log(`Seasonal anomaly complete for ${targetInfo.date} (${mode}): ${candidates.length} other-year references; ${validPct.toFixed(1)}% valid pixels.`);
    } catch (err) {
      seasonalAnomalyStatus.textContent = 'Seasonal anomaly failed: ' + err.message;
      log('Seasonal anomaly error: ' + err.message);
    } finally {
      seasonalAnomalyBtn.disabled = false;
      seasonalAnomalyBtn.textContent = 'Calculate Seasonal Anomaly';
    }
  });

  clearAnomalyBtn.addEventListener('click', () => {
    clearSeasonalAnomalyOverlay();
    seasonalAnomalyStatus.textContent = 'Seasonal anomaly overlay cleared. Recalculate to show it again.';
  });

  exportAnomalyBtn.addEventListener('click', async () => {
    const result = seasonalAnomalyResult;
    if (!result?.raw?.indexGrid) return;
    if (typeof GeoTIFF === 'undefined' || typeof GeoTIFF.writeArrayBuffer !== 'function') {
      seasonalAnomalyStatus.textContent = 'GeoTIFF writing is unavailable in this build.'; return;
    }
    exportAnomalyBtn.disabled = true;
    try {
      const raw = result.raw, w = raw.refWindow;
      const scaleX = Math.abs(raw.refRes[0] * (w[2]-w[0]) / raw.width);
      const scaleY = Math.abs(raw.refRes[1] * (w[3]-w[1]) / raw.height);
      const tieX = raw.refOrigin[0] + w[0] * raw.refRes[0];
      const tieY = raw.refOrigin[1] + w[1] * raw.refRes[1];
      const match = String(raw.refCrs || '').match(/EPSG\s*:\s*(\d+)/i);
      if (!match) throw new Error('Could not identify an EPSG code for this grid.');
      const epsg = Number(match[1]);
      const exportGridClean = new Float32Array(raw.indexGrid.length);
      for (let i = 0; i < raw.indexGrid.length; i++) {
        exportGridClean[i] = Number.isNaN(raw.indexGrid[i]) ? -9999 : raw.indexGrid[i];
      }
      const buffer = await GeoTIFF.writeArrayBuffer(exportGridClean, {
        width: raw.width, height: raw.height, ModelPixelScale: [scaleX, scaleY, 0], ModelTiepoint: [0,0,0,tieX,tieY,0],
        GTModelTypeGeoKey: epsg === 4326 ? 2 : 1,
        ...(epsg === 4326 ? { GeographicTypeGeoKey: 4326 } : { ProjectedCSTypeGeoKey: epsg }),
        GDAL_NODATA: '-9999',
        ImageDescription: `Sentinel-2 seasonal robust anomaly; index=${result.targetMode}; date=${result.targetDate}; baseline-scenes=${result.referenceCount}; window-days=±${result.windowDays}; min-obs=${result.minObs}; units=robust score 1.4826*MAD; display-capped ±${result.maxZ}; no independent ground validation; ${new Date().toISOString()}`
      });
      triggerDownload(new Blob([buffer], {type:'image/tiff'}), `sentinel2_seasonal_anomaly_${result.targetMode}_${result.targetDate}.tif`);
      log('Exported seasonal anomaly GeoTIFF with projection metadata.');
    } catch (err) {
      seasonalAnomalyStatus.textContent = 'Anomaly export failed: ' + err.message;
    } finally { exportAnomalyBtn.disabled = false; }
  });

  const RADAR_STAC_SEARCH_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';
