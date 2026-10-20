// Extracted from the original single-file app.
// Load order is significant; see ../README.md before moving/removing scripts.
// STAC scene search, scene loading, analysis pipeline and primary exports

'use strict';

  // Chunked STAC Search Pipeline & Export Actions
  // ============================================================================
  async function fetchStacChunk(requestBody, onPage = null) {
    let url = STAC_SEARCH_URL;
    let method = 'POST';
    let body = requestBody;
    let headers = { 'Content-Type': 'application/json' };
    const items = [];
    const seenItems = new Set();
    const seenPages = new Set();
    let pageCount = 0;

    while (url) {
      const pageKey = `${method}:${url}:${method === 'GET' ? '' : JSON.stringify(body || {})}`;
      if (seenPages.has(pageKey)) throw new Error('STAC pagination repeated a page link; stopped to avoid an infinite loop.');
      seenPages.add(pageKey);

      const init = { method, headers: { ...headers } };
      if (method !== 'GET') init.body = JSON.stringify(body || requestBody);
      const response = await fetch(url, init);
      if (!response.ok) throw new Error(`STAC HTTP ${response.status}`);
      const data = await response.json();
      const features = Array.isArray(data.features) ? data.features : [];
      for (const feature of features) {
        const key = feature?.id ? `${feature.collection || ''}:${feature.id}` : null;
        if (key && !seenItems.has(key)) {
          seenItems.add(key);
          items.push(feature);
        }
      }
      pageCount++;
      if (typeof onPage === 'function') onPage(pageCount, items.length, features.length);

      const next = Array.isArray(data.links) ? data.links.find(link => link.rel === 'next' && link.href) : null;
      if (!next || features.length === 0) break;
      url = new URL(next.href, STAC_SEARCH_URL).href;
      method = String(next.method || 'GET').toUpperCase();
      headers = { 'Content-Type': 'application/json', ...(next.headers || {}) };
      if (method === 'GET') {
        body = null;
      } else if (next.body && next.merge) {
        body = { ...(body || requestBody), ...next.body };
      } else {
        body = next.body || requestBody;
      }
    }
    return items;
  }

  function getAcquisitionGroupKey(item) {
    const p = item?.properties || {};
    const date = getSceneDateStr(item);
    // Adjacent MGRS tiles normally share the datatake ID. If the provider omits it,
    // group by UTC date as a practical fallback, but do not join separate datatakes
    // when a reliable datatake ID is available.
    const datatake = p['s2:datatake_id'] || 'daily';
    return `${date}|${datatake}`;
  }

  function makeAcquisitionMosaics(items) {
    const groups = new Map();
    for (const item of items) {
      const key = getAcquisitionGroupKey(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const mosaics = [];
    let serial = 0;
    for (const [groupKey, tiles] of groups.entries()) {
      tiles.sort((a, b) => {
        const cloudDiff = getCloudCover(a) - getCloudCover(b);
        if (Math.abs(cloudDiff) > 1e-9) return cloudDiff;
        return bboxOverlapFraction(b, drawnBbox) - bboxOverlapFraction(a, drawnBbox);
      });
      const first = tiles[0];
      const weightedCloud = tiles.reduce((acc, tile) => {
        const cloud = getCloudCover(tile);
        const overlap = bboxOverlapFraction(tile, drawnBbox);
        if (!Number.isFinite(cloud)) return acc;
        const weight = overlap > 0 ? overlap : 1;
        acc.weighted += cloud * weight;
        acc.weight += weight;
        return acc;
      }, { weighted: 0, weight: 0 });
      const mosaicCloud = weightedCloud.weight > 0 ? weightedCloud.weighted / weightedCloud.weight : null;
      mosaics.push({
        id: `mosaic_${serial++}_${groupKey.replace(/[^A-Za-z0-9_-]/g, '_')}`,
        properties: {
          datetime: first?.properties?.datetime,
          'eo:cloud_cover': mosaicCloud,
          's2:datatake_id': first?.properties?.['s2:datatake_id'] || null
        },
        tiles,
        tileCount: tiles.length,
        acquisitionKey: groupKey
      });
    }
    return mosaics.sort((a, b) => new Date(a.properties.datetime) - new Date(b.properties.datetime));
  }

  function bboxOverlapFraction(item, aoi) {
    const b = Array.isArray(item?.bbox) ? item.bbox : null;
    if (!b || b.length < 4) return 0;
    const west = Math.max(aoi[0], b[0]);
    const south = Math.max(aoi[1], b[1]);
    const east = Math.min(aoi[2], b[2]);
    const north = Math.min(aoi[3], b[3]);
    if (east <= west || north <= south) return 0;
    const aoiArea = Math.max(1e-12, (aoi[2] - aoi[0]) * (aoi[3] - aoi[1]));
    return ((east - west) * (north - south)) / aoiArea;
  }

  async function runPipeline() {
    if (!drawnBbox) return;
    resetResults();

    const modes = getActiveModes();
    const start = startDateInput.value || '2023-12-01';
    const end = endDateInput.value || '2024-03-01';
    const maxCloud = Math.max(0, Math.min(100, Number(maxCloudInput.value) || 0));
    const rawLimit = Number(sceneLimitInput.value);
    const limit = allScenesChk.checked ? Infinity : (Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.floor(rawLimit) : 20);
    if (!allScenesChk.checked) sceneLimitInput.value = String(limit);

    runBtn.disabled = true;
    runBtn.textContent = 'Searching…';
    logOutput.textContent = `Searching Sentinel-2 (${start} to ${end}, scene clouds <= ${maxCloud}%; ${allScenesChk.checked ? 'all matching dates' : `max ${limit} dates`})...`;

    try {
      // Split wide date ranges into <=180-day chunks to prevent STAC 502/504 Gateway Timeouts
      const startMs = new Date(`${start}T00:00:00Z`).getTime();
      const endMs = new Date(`${end}T23:59:59Z`).getTime();
      if (!(endMs >= startMs)) throw new Error('End Date must be on or after Start Date.');

      const CHUNK_MS = 180 * 24 * 60 * 60 * 1000;
      const chunks = [];
      for (let t = startMs; t <= endMs; t += CHUNK_MS) {
        const cStart = new Date(t).toISOString().split('.')[0] + 'Z';
        const cEnd = new Date(Math.min(endMs, t + CHUNK_MS - 1000)).toISOString().split('.')[0] + 'Z';
        chunks.push(`${cStart}/${cEnd}`);
      }

      const allFeatures = [];

      for (let i = 0; i < chunks.length; i++) {
        if (chunks.length > 1) {
          log(`Querying time window ${i + 1}/${chunks.length} (${chunks[i].substring(0, 10)} to ${chunks[i].substring(21, 31)})...`);
        }

        const requestBody = {
          collections: [STAC_COLLECTION],
          bbox: drawnBbox,
          datetime: chunks[i],
          limit: 100,
          sortby: [{ field: 'properties.datetime', direction: 'asc' }]
        };
        // Do not filter tiles by scene-wide cloud cover here: it can discard a tile
        // needed to complete an AOI mosaic. Cloud cover is applied after grouping tiles
        // into acquisitions; SCL still masks individual cloudy pixels during rendering.

        try {
          const chunkItems = await fetchStacChunk(requestBody, (page, total, pageItems) => {
            if (page === 1 || page % 5 === 0) log(`Window ${i + 1}: STAC page ${page}; ${total} unique item(s) retrieved so far.`);
          });
          allFeatures.push(...chunkItems);
          log(`Retrieved ${chunkItems.length} unique STAC item(s) for window ${i + 1} across all pages.`);
        } catch (err) {
          throw new Error(`Search window ${i + 1} failed: ${err.message}`);
        }
      }

      // Qualify individual STAC items first, then group all intersecting tiles from
      // the same datatake into one virtual acquisition. Rendering computes a spatial
      // mosaic; tiles are no longer discarded merely because another tile overlaps
      // more of the AOI.
      const qualifyingItems = [];
      const seenItemIds = new Set();
      for (const item of allFeatures) {
        const itemKey = `${item.collection || ''}:${item.id}`;
        if (seenItemIds.has(itemKey)) continue;
        seenItemIds.add(itemKey);
        if (Number.isFinite(getCloudCover(item)) && hasRequiredAssetsForModes(item, modes)) qualifyingItems.push(item);
      }
      if (qualifyingItems.length === 0) throw new Error('No scenes matched your criteria.');

      const allAcquisitions = makeAcquisitionMosaics(qualifyingItems);
      const candidates = allAcquisitions.filter(item => getCloudCover(item) <= maxCloud);
      const totalTiles = candidates.reduce((sum, item) => sum + item.tiles.length, 0);
      const multiTileCount = candidates.filter(item => item.tiles.length > 1).length;
      log(`Found ${candidates.length} matching acquisition(s) from ${totalTiles} tile item(s); ${multiTileCount} acquisition(s) require mosaicking. ${allAcquisitions.length - candidates.length} acquisition(s) excluded by the cloud-cover threshold.`);
      if (candidates.length === 0) throw new Error('No acquisitions matched the cloud-cover threshold and selected bands.');

      if (Number.isFinite(limit) && candidates.length > limit) {
        const sampled = [];
        if (limit === 1) {
          sampled.push(candidates[Math.floor((candidates.length - 1) / 2)]);
        } else {
          for (let i = 0; i < limit; i++) {
            const idx = Math.round((i * (candidates.length - 1)) / (limit - 1));
            sampled.push(candidates[idx]);
          }
        }
        validScenes = sampled;
        optramCalibration = null;
        optramCalibrationPromise = null;
        log(`Found ${candidates.length} matching acquisitions; sampled ${validScenes.length} evenly across ${start} to ${end}.`);
      } else {
        validScenes = candidates;
        optramCalibration = null;
        optramCalibrationPromise = null;
        log(`Loaded all ${validScenes.length} matching acquisition(s)${allScenesChk.checked ? ' (unlimited mode)' : ''}.`);
      }

      sliderBox.style.display = 'block';
      rebuildDisplaySteps();
      seasonalAnomalyBtn.disabled = validScenes.length < 2;

      pngBtn.disabled = false;
      plotAllBtn.disabled = displaySteps.length < 2;
      updateCsvButtonState();
      updateOptramPersistenceUI();

      await displayStepByIndex(displaySteps.length - 1);
    } catch (error) {
      log('ERROR: ' + error.message);
    } finally {
      runBtn.disabled = !drawnBbox;
      runBtn.textContent = 'Search & Render Scenes';
    }
  }

  sceneSlider.addEventListener('input', () => displayStepByIndex(Number(sceneSlider.value)));
  [outputMode, modePanel2, modePanel3, modePanel4, maskCloudsChk, includeBasemapChk, waterOnlyChk, waterMaskThresholdInput].forEach(el => {
    el.addEventListener('change', () => {
      if (el === waterMaskThresholdInput) {
        const value = Number(waterMaskThresholdInput.value);
        waterMaskThresholdInput.value = String(Number.isFinite(value) ? Math.max(-0.5, Math.min(0.5, value)) : 0);
      }
      compositeCache.clear();
      if (el === outputMode && displaySteps.length > 0) rebuildDisplaySteps();
      updateCsvButtonState();
      updateOptramPersistenceUI();
      if (displaySteps.length > 0) displayStepByIndex(Number(sceneSlider.value));
      else updatePolygonStatsPanel(null, null);
    });
  });

  diffModeChk.addEventListener('change', () => {
    baselineSelect.disabled = !diffModeChk.checked || displaySteps.length < 2;
    if (displaySteps.length > 0) displayStepByIndex(Number(sceneSlider.value));
    updateRadarCompareButton();
  });
  baselineSelect.addEventListener('change', () => {
    if (diffModeChk.checked && displaySteps.length > 0) displayStepByIndex(Number(sceneSlider.value));
    updateRadarCompareButton();
  });

  plotAllBtn.addEventListener('click', async () => {
    if (displaySteps.length === 0) return;
    plotAllBtn.disabled = true;
    const mode = outputMode.value;
    const maskClouds = maskCloudsChk.checked;
    try {
      for (let i = 0; i < displaySteps.length; i++) {
        plotAllBtn.textContent = `Loading ${i + 1}/${displaySteps.length}…`;
        await computeStepRaw(i, mode, maskClouds);
        updateChart();
      }
      log('All views loaded into chart.');
    } catch (err) {
      log('Batch load error: ' + err.message);
    } finally {
      plotAllBtn.disabled = false;
      plotAllBtn.textContent = 'Load All for Chart';
    }
  });

  pngBtn.addEventListener('click', () => {
    if (!activeRenderedState) return;
    const a = document.createElement('a');
    a.href = activeRenderedState.canvas.toDataURL('image/png');
    a.download = `sentinel2_${gridLayout.value}_${temporalMode.value}_${activeRenderedState.raw.dateStr.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    a.click();
    log('PNG downloaded.');
  });

  gifBtn.addEventListener('click', async () => {
    if (displaySteps.length < 2) return;
    gifBtn.disabled = true;
    const canvases = [];
    try {
      for (let i = 0; i < displaySteps.length; i++) {
        gifBtn.textContent = `Rendering ${i + 1}/${displaySteps.length}…`;
        log(`Rendering GIF frame ${i + 1} / ${displaySteps.length}...`);
        const res = await renderVisualForStep(i);
        canvases.push(res.canvas);
      }
      gifBtn.textContent = 'Encoding GIF…';
      const blob = encodeAnimatedGIF(canvases, 80);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sentinel2_${gridLayout.value}_${temporalMode.value}_${startDateInput.value}_to_${endDateInput.value}.gif`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      log('GIF downloaded successfully.');
    } catch (err) {
      log('GIF failed: ' + err.message);
    } finally {
      gifBtn.disabled = false;
      gifBtn.textContent = 'Download GIF';
    }
  });

  updateOptramPersistenceUI();
  // --------------------------------------------------------------------------
