// Extracted from the original single-file app.
// Load order is significant; see ../README.md before moving/removing scripts.
// Basemap stitching and visual rendering helpers

'use strict';

  // Basemap Tile Fetching & Stitching for Image/GIF Export
  // ============================================================================
  async function getBasemapCanvasForExtent(extent, width, height) {
    const cacheKey = `${activeBasemapName}_${extent.minX.toFixed(1)}_${extent.minY.toFixed(1)}_${extent.maxX.toFixed(1)}_${extent.maxY.toFixed(1)}_${width}_${height}`;
    if (basemapCanvasCache.has(cacheKey)) return basemapCanvasCache.get(cacheKey);

    const def = basemapDefs[activeBasemapName] || basemapDefs['Esri World Imagery'];
    const maxZ = def.options.maxZoom || 18;
    const worldSize = 20037508.342789244 * 2;
    const targetRes = (extent.maxX - extent.minX) / width;
    let z = Math.round(Math.log2(worldSize / (256 * targetRes)));
    z = Math.max(1, Math.min(maxZ, z));

    const numTiles = 1 << z;
    const mercToTileX = x => ((x + 20037508.342789244) / worldSize) * numTiles;
    const mercToTileY = y => ((20037508.342789244 - y) / worldSize) * numTiles;

    const minTx = Math.floor(mercToTileX(extent.minX));
    const maxTx = Math.floor(mercToTileX(extent.maxX));
    const minTy = Math.floor(mercToTileY(extent.maxY));
    const maxTy = Math.floor(mercToTileY(extent.minY));

    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = width;
    bgCanvas.height = height;
    const ctx = bgCanvas.getContext('2d');
    ctx.fillStyle = '#171717';
    ctx.fillRect(0, 0, width, height);

    const promises = [];
    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        const wrappedTx = ((tx % numTiles) + numTiles) % numTiles;
        if (ty < 0 || ty >= numTiles) continue;
        const url = def.url.replace('{z}', z).replace('{x}', wrappedTx).replace('{y}', ty);

        const tileLeftMerc = (tx / numTiles) * worldSize - 20037508.342789244;
        const tileRightMerc = ((tx + 1) / numTiles) * worldSize - 20037508.342789244;
        const tileTopMerc = 20037508.342789244 - (ty / numTiles) * worldSize;
        const tileBottomMerc = 20037508.342789244 - ((ty + 1) / numTiles) * worldSize;

        const dx = ((tileLeftMerc - extent.minX) / (extent.maxX - extent.minX)) * width;
        const dy = ((extent.maxY - tileTopMerc) / (extent.maxY - extent.minY)) * height;
        const dw = ((tileRightMerc - tileLeftMerc) / (extent.maxX - extent.minX)) * width;
        const dh = ((tileTopMerc - tileBottomMerc) / (extent.maxY - extent.minY)) * height;

        promises.push(new Promise(resolve => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            ctx.drawImage(img, dx, dy, dw + 0.5, dh + 0.5);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = url;
        }));
      }
    }

    await Promise.all(promises);
    basemapCanvasCache.set(cacheKey, bgCanvas);
    return bgCanvas;
  }

  function getWindowWebMercatorExtent(image, window, rasterCrs) {
    const origin = image.getOrigin(), resolution = image.getResolution();
    const [left, top, right, bottom] = window;
    const pts = [];
    for (let i = 0; i <= BBOX_EDGE_SEGMENTS; i++) {
      const t = i / BBOX_EDGE_SEGMENTS;
      const px = [[left + (right - left) * t, top], [left + (right - left) * t, bottom], [left, top + (bottom - top) * t], [right, top + (bottom - top) * t]];
      for (const p of px) pts.push([origin[0] + p[0] * resolution[0], origin[1] + p[1] * resolution[1]]);
    }
    const webPts = pts.map(p => proj4(rasterCrs, 'EPSG:3857', p));
    const xs = webPts.map(p => p[0]), ys = webPts.map(p => p[1]);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }

  function warpCanvasToWebMercator(sourceCanvas, image, window, rasterCrs, maxDim = MAX_MAP_OVERLAY_DIMENSION) {
    const extent = getWindowWebMercatorExtent(image, window, rasterCrs);
    const sw = sourceCanvas.width, sh = sourceCanvas.height;
    const srcPixels = sourceCanvas.getContext('2d').getImageData(0, 0, sw, sh).data;
    const rOrigin = image.getOrigin(), rRes = image.getResolution();
    const aspect = (extent.maxX - extent.minX) / (extent.maxY - extent.minY);

    let width = sw, height = Math.max(1, Math.round(width / aspect));
    if (height > sh) { height = sh; width = Math.max(1, Math.round(height * aspect)); }
    const red = Math.min(1, maxDim / Math.max(width, height));
    width = Math.max(1, Math.round(width * red));
    height = Math.max(1, Math.round(height * red));

    const warped = document.createElement('canvas');
    warped.width = width; warped.height = height;
    const tCtx = warped.getContext('2d');
    const tImg = tCtx.createImageData(width, height);
    const tData = tImg.data;
    const winW = window[2] - window[0], winH = window[3] - window[1];

    for (let y = 0; y < height; y++) {
      const webY = extent.maxY - ((y + 0.5) / height) * (extent.maxY - extent.minY);
      for (let x = 0; x < width; x++) {
        const webX = extent.minX + ((x + 0.5) / width) * (extent.maxX - extent.minX);
        const rp = proj4('EPSG:3857', rasterCrs, [webX, webY]);
        const rpx = (rp[0] - rOrigin[0]) / rRes[0];
        const rpy = (rp[1] - rOrigin[1]) / rRes[1];
        const sx = Math.floor(((rpx - window[0]) / winW) * sw);
        const sy = Math.floor(((rpy - window[1]) / winH) * sh);
        if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
        const sIdx = (sy * sw + sx) * 4, dIdx = (y * width + x) * 4;
        tData[dIdx] = srcPixels[sIdx]; tData[dIdx + 1] = srcPixels[sIdx + 1];
        tData[dIdx + 2] = srcPixels[sIdx + 2]; tData[dIdx + 3] = srcPixels[sIdx + 3];
      }
    }
    tCtx.putImageData(tImg, 0, 0);

    const swLl = proj4('EPSG:3857', 'EPSG:4326', [extent.minX, extent.minY]);
    const neLl = proj4('EPSG:3857', 'EPSG:4326', [extent.maxX, extent.maxY]);
    const bounds = L.latLngBounds([[swLl[1], swLl[0]], [neLl[1], neLl[0]]]);
    return { warpedCanvas: warped, bounds, extent };
  }

  async function renderSinglePanel(stepIdx, mode) {
    const maskClouds = maskCloudsChk.checked;
    const isDiff = diffModeChk.checked && !['rgb', 'rgb_bands', 'false_color', 'obs_count'].includes(mode) && displaySteps.length > 1;
    const baseIdx = Number(baselineSelect.value) || 0;

    const currentRaw = await computeStepRaw(stepIdx, mode, maskClouds);
    let baseRaw = null;
    if (isDiff) {
      baseRaw = await computeStepRaw(baseIdx, mode, maskClouds);
    }

    const width = currentRaw.width, height = currentRaw.height;
    if (!isDiff && !currentRaw.rgbChannels && COLOR_STRETCH_SCALES[mode]) {
      ensureLegendStretch(mode, currentRaw.indexGrid);
    }
    const rawCanvas = document.createElement('canvas');
    rawCanvas.width = width; rawCanvas.height = height;
    const ctx = rawCanvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    let inspectGrid = null;

    if (currentRaw.rgbChannels) {
      const [r, g, b, a] = currentRaw.rgbChannels;
      for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        imgData.data[idx] = r[i]; imgData.data[idx + 1] = g[i];
        imgData.data[idx + 2] = b[i]; imgData.data[idx + 3] = a[i];
      }
    } else if (isDiff && baseRaw && baseRaw.indexGrid) {
      inspectGrid = new Float32Array(width * height);
      for (let i = 0; i < width * height; i++) {
        let bVal;
        if (gridsShareGeometry(currentRaw, baseRaw)) {
          bVal = baseRaw.indexGrid[i];
        } else {
          const x = i % width, y = Math.floor(i / width);
          const [lon, lat] = rawPixelToLonLat(currentRaw, x, y);
          bVal = sampleCompositeIndex(baseRaw, lon, lat);
        }
        const currentVal = currentRaw.indexGrid[i];
        const diff = Number.isFinite(currentVal) && Number.isFinite(bVal) ? currentVal - bVal : NaN;
        inspectGrid[i] = diff;
        const rgba = colorizeIndex(diff, mode, true);
        const idx = i * 4;
        imgData.data[idx] = rgba[0]; imgData.data[idx + 1] = rgba[1];
        imgData.data[idx + 2] = rgba[2]; imgData.data[idx + 3] = rgba[3];
      }
    } else {
      inspectGrid = currentRaw.indexGrid;
      for (let i = 0; i < width * height; i++) {
        const rgba = colorizeIndex(inspectGrid[i], mode, false);
        const idx = i * 4;
        imgData.data[idx] = rgba[0]; imgData.data[idx + 1] = rgba[1];
        imgData.data[idx + 2] = rgba[2]; imgData.data[idx + 3] = rgba[3];
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const stampLabel = isDiff
      ? `Δ ${mode.toUpperCase()}: ${currentRaw.dateStr} vs ${baseRaw.dateStr}`
      : `${currentRaw.dateStr} | ${mode.toUpperCase()}`;

    const warpedObj = warpCanvasToWebMercator(rawCanvas, currentRaw.refImage, currentRaw.refWindow, currentRaw.refCrs, MAX_OUTPUT_DIMENSION);

    let panelCanvas;
    if (includeBasemapChk.checked) {
      const w = warpedObj.warpedCanvas.width, h = warpedObj.warpedCanvas.height;
      const bgCanvas = await getBasemapCanvasForExtent(warpedObj.extent, w, h);
      panelCanvas = document.createElement('canvas');
      panelCanvas.width = w; panelCanvas.height = h;
      const pCtx = panelCanvas.getContext('2d');
      pCtx.drawImage(bgCanvas, 0, 0);
      pCtx.save();
      pCtx.globalAlpha = Number(opacitySlider.value);
      pCtx.drawImage(warpedObj.warpedCanvas, 0, 0);
      pCtx.restore();
      stampDateOnCanvas(pCtx, stampLabel);
    } else {
      panelCanvas = document.createElement('canvas');
      panelCanvas.width = width; panelCanvas.height = height;
      const pCtx = panelCanvas.getContext('2d');
      pCtx.drawImage(rawCanvas, 0, 0);
      stampDateOnCanvas(pCtx, stampLabel);
    }

    return {
      panelCanvas,
      overlayUrl: warpedObj.warpedCanvas.toDataURL('image/png'),
      bounds: warpedObj.bounds,
      raw: currentRaw,
      inspectGrid,
      isDiff,
      stampLabel,
      mode
    };
  }

  async function renderVisualForStep(stepIdx) {
    const modes = getActiveModes();
    const panels = await Promise.all(modes.map(m => renderSinglePanel(stepIdx, m)));
    const primary = panels[0];

    if (panels.length === 1) {
      return {
        canvas: primary.panelCanvas,
        overlayUrl: primary.overlayUrl,
        bounds: primary.bounds,
        raw: primary.raw,
        inspectGrid: primary.inspectGrid,
        isDiff: primary.isDiff,
        stampLabel: primary.stampLabel,
        panels
      };
    }

    const pw = primary.panelCanvas.width;
    const ph = primary.panelCanvas.height;
    const gap = 4;
    const cols = 2;
    const rows = panels.length > 2 ? 2 : 1;

    const comp = document.createElement('canvas');
    comp.width = pw * cols + gap * (cols - 1);
    comp.height = ph * rows + gap * (rows - 1);
    const cCtx = comp.getContext('2d');
    cCtx.fillStyle = '#333333';
    cCtx.fillRect(0, 0, comp.width, comp.height);

    panels.forEach((p, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = col * (pw + gap);
      const y = row * (ph + gap);
      cCtx.drawImage(p.panelCanvas, x, y, pw, ph);
    });

    const multiLabel = `${primary.raw.dateStr} | Grid: ${modes.map(m => m.toUpperCase()).join(' + ')}`;
    return {
      canvas: comp,
      overlayUrl: primary.overlayUrl,
      bounds: primary.bounds,
      raw: primary.raw,
      inspectGrid: primary.inspectGrid,
      isDiff: primary.isDiff,
      stampLabel: multiLabel,
      panels
    };
  }

  async function displayStepByIndex(idx) {
    if (!displaySteps[idx]) return;
    const step = displaySteps[idx];
    const mode = outputMode.value;

    try {
      const rendered = await renderVisualForStep(idx);
      activeRenderedState = rendered;
      geoTiffBtn.disabled = !rendered.raw?.indexGrid || ['rgb', 'rgb_bands', 'false_color'].includes(mode);
      reportBtn.disabled = false;
      updatePolygonStatsPanel(rendered.raw, rendered.inspectGrid);
      updateCsvButtonState();

      const scCloud = rendered.raw.sceneCloudPct;
      const aoiCloud = rendered.raw.aoiCloudPct;
      sceneCounter.textContent = `View ${idx + 1} / ${displaySteps.length}`;
      sceneMetaLabel.textContent = `${step.label} | Avg Scene Cloud: ${Number.isFinite(scCloud) ? scCloud.toFixed(1) + '%' : 'N/A'} | Local AOI Cloud: ${aoiCloud !== null ? aoiCloud.toFixed(1) + '%' : 'N/A'}`;

      canvas.width = rendered.canvas.width;
      canvas.height = rendered.canvas.height;
      canvas.style.display = 'block';
      canvas.getContext('2d').drawImage(rendered.canvas, 0, 0);

      clearResultOverlay();
      resultOverlay = L.imageOverlay(rendered.overlayUrl, rendered.bounds, {
        opacity: Number(opacitySlider.value),
        pane: 'resultPane'
      }).addTo(map);

      updateLegend(mode, rendered.isDiff);
      resultTitle.textContent = rendered.stampLabel;
      updateChart();
      updateRadarCompareButton();
    } catch (err) {
      log(`Step ${step.label} error: ${err.message}`);
    }
  }

  // ============================================================================
