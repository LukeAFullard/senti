// Extracted from the original single-file app.
// Load order is significant; see ../README.md before moving/removing scripts.
// Raster access, CRS handling, spectral indices and OPTRAM calculations

'use strict';


  function log(message) {
    const time = new Date().toISOString().substring(11, 19);
    logOutput.textContent += '\n[' + time + '] ' + message;
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  function clearResultOverlay() {
    if (resultOverlay && map.hasLayer(resultOverlay)) map.removeLayer(resultOverlay);
    resultOverlay = null;
  }

  function resetResults() {
    clearResultOverlay();
    clearSeasonalAnomalyOverlay();
    clearRadarCompareOverlay();
    seasonalAnomalyBtn.disabled = true;
    canvas.style.display = 'none';
    legend.style.display = 'none';
    sliderBox.style.display = 'none';
    gifBtn.disabled = true;
    pngBtn.disabled = true;
    plotAllBtn.disabled = true;
    csvBtn.disabled = true;
    validScenes = [];
    displaySteps = [];
    activeRenderedState = null;
    sceneRawCache.clear();
    compositeCache.clear();
    dataSupportCache.clear();
    geoTiffBtn.disabled = true;
    reportBtn.disabled = true;
    optramCalibration = null;
    optramCalibrationPromise = null;
    optramPersistenceContent.textContent = 'Choose OPTRAM and draw a polygon to assess relative wetness across the loaded individual acquisitions.';
    optramPersistenceBtn.disabled = true;
    basemapCanvasCache.clear();
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  }

  function getSceneDateStr(item) {
    return item?.properties?.datetime ? item.properties.datetime.substring(0, 10) : 'Unknown';
  }

  function getCloudCover(item) {
    const raw = item?.properties?.['eo:cloud_cover'];
    return (raw !== null && raw !== undefined && Number.isFinite(Number(raw))) ? Number(raw) : Infinity;
  }

  function parseEpsg(value) {
    if (!value) return null;
    if (Number.isInteger(Number(value))) return Number(value);
    const match = String(value).match(/(?:EPSG:)?(\d{4,6})/i);
    return match ? Number(match[1]) : null;
  }

  function isUtmEpsg(code) {
    return Number.isInteger(code) && ((code >= 32601 && code <= 32660) || (code >= 32701 && code <= 32760));
  }

  function getRasterCrs(image, item, bbox) {
    const properties = item?.properties || {};
    let geoKeys = {};
    try { if (typeof image.getGeoKeys === 'function') geoKeys = image.getGeoKeys() || {}; } catch (_) {}
    const candidates = [parseEpsg(properties['proj:epsg']), parseEpsg(properties['proj:code']), parseEpsg(geoKeys.ProjectedCSTypeGeoKey)];
    let epsg = candidates.find(isUtmEpsg);
    if (!epsg) {
      const lon = (bbox[0] + bbox[2]) / 2, lat = (bbox[1] + bbox[3]) / 2;
      const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
      epsg = (lat < 0 ? 32700 : 32600) + zone;
    }
    const zone = epsg % 100;
    const isSouth = epsg >= 32701 && epsg <= 32760;
    const crsName = 'EPSG:' + epsg;
    proj4.defs(crsName, '+proj=utm +zone=' + zone + (isSouth ? ' +south' : '') + ' +datum=WGS84 +units=m +no_defs +type=crs');
    return crsName;
  }

  function transformBboxPerimeter(bbox, sourceCrs, targetCrs, segments) {
    const [west, south, east, north] = bbox;
    const perimeter = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      perimeter.push([west + (east - west) * t, south], [west + (east - west) * t, north], [west, south + (north - south) * t], [east, south + (north - south) * t]);
    }
    return perimeter.map(point => proj4(sourceCrs, targetCrs, point));
  }

  function calculatePixelWindow(bbox, image, rasterCrs) {
    const origin = image.getOrigin();
    const resolution = image.getResolution();
    const imageWidth = image.getWidth(), imageHeight = image.getHeight();
    const projected = transformBboxPerimeter(bbox, 'EPSG:4326', rasterCrs, BBOX_EDGE_SEGMENTS);
    const pixelX = projected.map(p => (p[0] - origin[0]) / resolution[0]);
    const pixelY = projected.map(p => (p[1] - origin[1]) / resolution[1]);

    const window = [
      Math.max(0, Math.floor(Math.min(...pixelX))),
      Math.max(0, Math.floor(Math.min(...pixelY))),
      Math.min(imageWidth, Math.ceil(Math.max(...pixelX))),
      Math.min(imageHeight, Math.ceil(Math.max(...pixelY)))
    ];
    if (window[0] >= window[2] || window[1] >= window[3]) {
      throw new Error('Selected rectangle does not overlap this scene.');
    }
    return { window, origin, resolution };
  }

  function calculatePixelWindowForReferenceGrid(referenceGrid, image, targetCrs) {
    const origin = image.getOrigin();
    const resolution = image.getResolution();
    const imageWidth = image.getWidth(), imageHeight = image.getHeight();
    const rOrigin = referenceGrid.pixelInfo.origin;
    const rRes = referenceGrid.pixelInfo.resolution;
    const [left, top, right, bottom] = referenceGrid.pixelInfo.window;
    const perimeter = [];
    for (let i = 0; i <= BBOX_EDGE_SEGMENTS; i++) {
      const t = i / BBOX_EDGE_SEGMENTS;
      const pixels = [
        [left + (right - left) * t, top],
        [left + (right - left) * t, bottom],
        [left, top + (bottom - top) * t],
        [right, top + (bottom - top) * t]
      ];
      for (const [px, py] of pixels) {
        perimeter.push([rOrigin[0] + px * rRes[0], rOrigin[1] + py * rRes[1]]);
      }
    }
    const projected = perimeter.map(point => proj4(referenceGrid.crs, targetCrs, point));
    const pixelX = projected.map(point => (point[0] - origin[0]) / resolution[0]);
    const pixelY = projected.map(point => (point[1] - origin[1]) / resolution[1]);
    const window = [
      Math.max(0, Math.floor(Math.min(...pixelX))),
      Math.max(0, Math.floor(Math.min(...pixelY))),
      Math.min(imageWidth, Math.ceil(Math.max(...pixelX))),
      Math.min(imageHeight, Math.ceil(Math.max(...pixelY)))
    ];
    if (window[0] >= window[2] || window[1] >= window[3]) {
      throw new Error('Reference band footprint does not overlap this scene asset.');
    }
    return { window, origin, resolution };
  }

  function getAssetBandInfo(asset, fallback = { scale: 0.0001, offset: -0.1, nodata: 0 }) {
    const band = asset && Array.isArray(asset['raster:bands']) ? asset['raster:bands'][0] : null;
    return {
      scale: band && Number.isFinite(Number(band.scale)) ? Number(band.scale) : fallback.scale,
      offset: band && Number.isFinite(Number(band.offset)) ? Number(band.offset) : fallback.offset,
      nodata: band && band.nodata !== undefined ? Number(band.nodata) : fallback.nodata
    };
  }

  function getOutputSize(window) {
    const sw = window[2] - window[0], sh = window[3] - window[1];
    const factor = Math.min(1, MAX_OUTPUT_DIMENSION / Math.max(sw, sh));
    return { width: Math.max(1, Math.round(sw * factor)), height: Math.max(1, Math.round(sh * factor)) };
  }

  function getNirNarrowAsset(assets) {
    return assets?.nir08?.href ? assets.nir08 : assets?.nir;
  }

  async function readBandScaled(asset, bbox, targetSize = null, refCrs = null, item = null, referenceGrid = null) {
    if (!asset?.href) throw new Error('A required Sentinel-2 band asset is missing.');
    const tiff = await GeoTIFF.fromUrl(asset.href);
    const image = await tiff.getImage();
    const crs = refCrs || getRasterCrs(image, item, bbox);
    const pixelInfo = referenceGrid
      ? calculatePixelWindowForReferenceGrid(referenceGrid, image, crs)
      : calculatePixelWindow(bbox, image, crs);
    const size = targetSize || getOutputSize(pixelInfo.window);
    const raw = await image.readRasters(rasterReadOptions({
      window: pixelInfo.window,
      width: size.width,
      height: size.height,
      resampleMethod: 'bilinear'
    }));
    const info = getAssetBandInfo(asset);
    const scaled = new Float32Array(raw[0].length);
    for (let i = 0; i < raw[0].length; i++) {
      const v = Number(raw[0][i]);
      scaled[i] = (!Number.isFinite(v) || v === info.nodata) ? NaN : v * info.scale + info.offset;
    }
    return { data: scaled, image, pixelInfo, size, crs };
  }

  async function readSclMask(item, bbox, targetSize, crs, referenceGrid = null) {
    const sclAsset = item?.assets?.scl;
    if (!sclAsset?.href) return { mask: null, aoiCloudPct: null };
    try {
      const tiff = await GeoTIFF.fromUrl(sclAsset.href);
      const image = await tiff.getImage();
      const pixelInfo = referenceGrid
        ? calculatePixelWindowForReferenceGrid(referenceGrid, image, crs)
        : calculatePixelWindow(bbox, image, crs);
      const raw = await image.readRasters(rasterReadOptions({
        window: pixelInfo.window,
        width: targetSize.width,
        height: targetSize.height,
        resampleMethod: 'nearest'
      }));
      const scl = raw[0];
      const mask = new Uint8Array(scl.length);
      let validCount = 0, cloudCount = 0;
      for (let i = 0; i < scl.length; i++) {
        const c = Number(scl[i]);
        if (c === 0 || c === 1) { mask[i] = 1; continue; }
        validCount++;
        // SCL 3=cloud shadow, 8/9=clouds, 10=cirrus, 11=snow/ice.
        if (c === 3 || c === 8 || c === 9 || c === 10 || c === 11) {
          mask[i] = 1;
          cloudCount++;
        }
      }
      const aoiCloudPct = validCount > 0 ? (cloudCount / validCount) * 100 : 0;
      return { mask, aoiCloudPct };
    } catch (_) {
      return { mask: null, aoiCloudPct: null };
    }
  }

  function getActiveModes() {
    const layout = gridLayout.value;
    const m1 = outputMode.value;
    if (layout === '1x1') return [m1];
    if (layout === '2x1') return [m1, modePanel2.value];
    return [m1, modePanel2.value, modePanel3.value, modePanel4.value];
  }

  // Asset keys and formula definitions for every index mode. Values use scaled
  // surface reflectance (normally 0–1); bands marked as 20 m remain 20 m.
  const WATER_QUALITY_PROXY_MODES = new Set(['ndci', 'chl_ratio', 'mci', 'fai', 'ndti', 'turbidity_ratio']);

  const INDEX_DEFS = {
    ndvi: { bands: ['nir', 'red'], formula: 'nd' },
    ndwi: { bands: ['green', 'nir'], formula: 'nd' },
    ndmi: { bands: ['nir', 'swir16'], formula: 'nd' },
    msi: { bands: ['swir16', 'nir'], formula: 'ratio' },
    nmdi: { bands: ['nir', 'swir16', 'swir22'], formula: 'nmdi' },
    nsmi: { bands: ['swir16', 'swir22'], formula: 'nd' },
    str: { bands: ['swir22'], formula: 'str' },
    optram: { bands: ['red', 'nir', 'swir22'], formula: 'optram' },
    smi: { bands: ['nir08', 'swir16'], formula: 'nd' },
    s2wi: { bands: ['nir08', 'swir16', 'swir22'], formula: 's2wi' },
    nbr: { bands: ['nir', 'swir22'], formula: 'nd' },
    bsi: { bands: ['swir16', 'red', 'nir', 'blue'], formula: 'bsi' },
    ndbi: { bands: ['swir16', 'nir'], formula: 'nd' },
    evi: { bands: ['nir', 'red', 'blue'], formula: 'evi' },
    mndwi: { bands: ['green', 'swir16'], formula: 'nd' },
    ndci: { bands: ['rededge1', 'red'], formula: 'nd' },
    chl_ratio: { bands: ['rededge1', 'red'], formula: 'ratio' },
    mci: { bands: ['rededge1', 'red', 'rededge2'], formula: 'mci' },
    fai: { bands: ['nir', 'red', 'swir16'], formula: 'fai' },
    ndti: { bands: ['red', 'green'], formula: 'nd' },
    turbidity_ratio: { bands: ['red', 'green'], formula: 'ratio' },
    awei_nsh: { bands: ['green', 'swir16', 'nir', 'swir22'], formula: 'awei_nsh' }
  };

  function getBandAsset(assets, key) {
    return assets && assets[key] ? assets[key] : null;
  }

  function getNativeResolution(asset, key) {
    const val = Number(asset?.['raster:bands']?.[0]?.spatial_resolution);
    if (Number.isFinite(val) && val > 0) return val;
    if (/^(rededge[123]|nir08|swir16|swir22)$/.test(key)) return 20;
    if (/^(coastal|nir09|cirrus|scl)$/.test(key)) return 60;
    return 10;
  }

  function calculateIndexValue(mode, bands) {
    if (!bands.every(Number.isFinite)) return NaN;
    const normalizedDifference = (a, b) => {
      const denom = a + b;
      return Number.isFinite(denom) && Math.abs(denom) > 1e-6
        ? Math.max(-1, Math.min(1, (a - b) / denom)) : NaN;
    };

    switch (mode) {
      case 'ndvi': case 'ndwi': case 'ndmi': case 'smi': case 'nbr':
      case 'ndbi': case 'mndwi': case 'ndci': case 'ndti': case 'nsmi':
        return normalizedDifference(bands[0], bands[1]);
      case 'nmdi': {
        const [nir, swir1, swir2] = bands;
        const delta = swir1 - swir2;
        const denom = nir + delta;
        return Number.isFinite(denom) && Math.abs(denom) > 1e-6
          ? Math.max(-1, Math.min(1, (nir - delta) / denom)) : NaN;
      }
      case 'str': {
        const swir = bands[0];
        return swir > 0.005 && swir <= 1.2 ? ((1 - swir) * (1 - swir)) / (2 * swir) : NaN;
      }
      case 's2wi': {
        const denom = bands[0] + bands[1] + bands[2];
        return Math.abs(denom) > 1e-6
          ? Math.max(-1, Math.min(1, (bands[0] - bands[1] - bands[2]) / denom)) : NaN;
      }
      case 'bsi': {
        const denom = (bands[0] + bands[1]) + (bands[2] + bands[3]);
        return Math.abs(denom) > 1e-6
          ? Math.max(-1, Math.min(1, ((bands[0] + bands[1]) - (bands[2] + bands[3])) / denom)) : NaN;
      }
      case 'evi': {
        const [nir, red, blue] = bands;
        const denom = nir + 6 * red - 7.5 * blue + 1;
        return Math.abs(denom) > 1e-6 ? 2.5 * (nir - red) / denom : NaN;
      }
      case 'chl_ratio': case 'msi':
        return bands[1] > 1e-6 ? bands[0] / bands[1] : NaN;
      case 'mci': {
        // Sentinel-2 approximation: line height at B05 (~705 nm), using B04 (~665)
        // and B06 (~740 nm) as the baseline. Do not clamp: line height is not ND-like.
        const [b05, b04, b06] = bands;
        return b05 - (b04 + (b06 - b04) * (705 - 665) / (740 - 665));
      }
      case 'fai': {
        // Sentinel-2 adaptation of FAI: B08 (~842 nm) relative to B04/B11 baseline.
        const [nir, red, swir1] = bands;
        return nir - (red + (swir1 - red) * (842 - 665) / (1610 - 665));
      }
      case 'turbidity_ratio':
        return bands[1] > 1e-6 ? bands[0] / bands[1] : NaN;
      case 'awei_nsh': {
        const [green, swir1, nir, swir2] = bands;
        return 4 * (green - swir1) - (0.25 * nir + 2.75 * swir2);
      }
      default:
        return NaN;
    }
  }

  function hasRequiredAssetsForModes(item, modes) {
    const a = item?.assets || {};
    for (const mode of modes) {
      if (mode === 'rgb') {
        if (!Boolean(a.visual?.href || (a.red?.href && a.green?.href && a.blue?.href))) return false;
        continue;
      }
      if (mode === 'rgb_bands') {
        if (!['red', 'green', 'blue'].every(k => Boolean(a[k]?.href))) return false;
        continue;
      }
      if (mode === 'false_color') {
        if (!['nir', 'red', 'green'].every(k => Boolean(a[k]?.href))) return false;
        continue;
      }
      if (mode === 'obs_count') {
        if (!a.nir?.href || !a.swir16?.href) return false;
        continue;
      }
      const def = INDEX_DEFS[mode];
      if (!def || !def.bands.every(k => Boolean(a[k]?.href))) return false;
      if (waterOnlyChk.checked && WATER_QUALITY_PROXY_MODES.has(mode) &&
          !Boolean(a.green?.href && a.swir16?.href)) return false;
    }
    return true;
  }

  // Read NDVI and transformed SWIR reflectance on the native/coarsest B12 grid.
  // These paired grids are used to fit one robust OPTRAM-style model for the AOI
  // and the selected date range, so relative wetness is comparable between dates.
  async function readOptramInputsSingleItem(item, applyCloudMask = true) {
    const assets = item?.assets || {};
    if (!assets.red?.href || !assets.nir?.href || !assets.swir22?.href) {
      throw new Error('OPTRAM requires Sentinel-2 B04, B08 and B12 assets.');
    }
    const b12 = await readBandScaled(assets.swir22, drawnBbox, null, null, item);
    const [red, nir, sclObj] = await Promise.all([
      readBandScaled(assets.red, drawnBbox, b12.size, b12.crs, item, b12),
      readBandScaled(assets.nir, drawnBbox, b12.size, b12.crs, item, b12),
      readSclMask(item, drawnBbox, b12.size, b12.crs, b12)
    ]);
    const ndvi = new Float32Array(b12.data.length);
    const str = new Float32Array(b12.data.length);
    ndvi.fill(NaN);
    str.fill(NaN);
    const mask = applyCloudMask ? sclObj.mask : null;
    for (let i = 0; i < b12.data.length; i++) {
      if (mask && mask[i] === 1) continue;
      const r = red.data[i], n = nir.data[i], sw = b12.data[i];
      if (!Number.isFinite(r) || !Number.isFinite(n) || !Number.isFinite(sw) || sw <= 0.005 || sw > 1.2) continue;
      const denom = n + r;
      if (!Number.isFinite(denom) || Math.abs(denom) < 1e-6) continue;
      const nv = (n - r) / denom;
      const sv = ((1 - sw) * (1 - sw)) / (2 * sw);
      if (!Number.isFinite(nv) || nv < 0.05 || nv > 1 || !Number.isFinite(sv)) continue;
      ndvi[i] = nv;
      str[i] = sv;
    }
    return {
      id: item.id,
      dateStr: getSceneDateStr(item),
      width: b12.size.width, height: b12.size.height,
      refImage: b12.image, refWindow: b12.pixelInfo.window, refCrs: b12.crs,
      refOrigin: b12.pixelInfo.origin, refRes: b12.pixelInfo.resolution,
      pixelInfo: b12.pixelInfo, size: b12.size, crs: b12.crs,
      ndvi, str, sclMask: sclObj.mask, aoiCloudPct: sclObj.aoiCloudPct
    };
  }

  function quantileSorted(values, q) {
    if (!values.length) return NaN;
    const sorted = values.slice().sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), frac = pos - lo;
    return lo + 1 < sorted.length ? sorted[lo] + frac * (sorted[lo + 1] - sorted[lo]) : sorted[lo];
  }

  function getOptramSceneSignature() {
    let hash = 2166136261;
    const source = `${drawnBbox?.join(',') || ''}|${validScenes.map(sc => sc.id).join('|')}`;
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `${validScenes.length}_${(hash >>> 0).toString(16)}`;
  }

  async function ensureOptramCalibration() {
    const key = getOptramSceneSignature();
    if (optramCalibration?.key === key) return optramCalibration;
    if (optramCalibrationPromise) return optramCalibrationPromise;
    optramCalibrationPromise = (async () => {
      if (!validScenes.length) throw new Error('Load Sentinel-2 scenes before using OPTRAM.');
      const maxCalibrationScenes = 48;
      if (validScenes.length < 3) {
        throw new Error('OPTRAM needs at least 3 valid acquisitions to fit a multi-date wet/dry relationship. For more reliable results, use 10 or more clear dates covering different moisture conditions.');
      }
      const selected = [];
      const n = Math.min(maxCalibrationScenes, validScenes.length);
      if (n === 1) selected.push(validScenes[0]);
      else {
        for (let i = 0; i < n; i++) {
          const idx = Math.round(i * (validScenes.length - 1) / (n - 1));
          selected.push(validScenes[idx]);
        }
      }
      const binCount = 12;
      const ndviMin = 0.05, ndviMax = 1.0;
      const binWidth = (ndviMax - ndviMin) / binCount;
      const bins = Array.from({ length: binCount }, () => []);
      let validSamples = 0, inputTiles = 0, scenesUsed = 0;
      log(`Fitting AOI OPTRAM wet/dry edges using up to ${selected.length} date-spread acquisitions...`);
      for (let si = 0; si < selected.length; si++) {
        const sc = selected[si];
        const tiles = Array.isArray(sc.tiles) ? sc.tiles : [sc];
        let hadData = false;
        for (const tile of tiles) {
          try {
            // Calibration always masks clouds/shadows even if the display mask is off.
            const input = await readOptramInputsSingleItem(tile, true);
            inputTiles++;
            const total = input.ndvi.length;
            const stride = Math.max(1, Math.ceil(total / 5000));
            for (let i = 0; i < total; i += stride) {
              const nv = input.ndvi[i], sv = input.str[i];
              if (!Number.isFinite(nv) || !Number.isFinite(sv) || nv < ndviMin || nv > ndviMax) continue;
              const bin = Math.max(0, Math.min(binCount - 1, Math.floor((nv - ndviMin) / binWidth)));
              const bucket = bins[bin];
              // Reservoir sampling bounds memory and avoids first-scene dominance.
              const seen = bucket._seen = (bucket._seen || 0) + 1;
              const cap = 7000;
              if (bucket.length < cap) bucket.push(sv);
              else {
                const pseudoRandom = (Math.imul(seen, 1664525) + 1013904223) >>> 0;
                const replace = pseudoRandom % seen;
                if (replace < cap) bucket[replace] = sv;
              }
              validSamples++;
              hadData = true;
            }
          } catch (err) {
            log(`OPTRAM calibration skipped tile ${tile.id || '(unknown)'}: ${err.message}`);
          }
        }
        if (hadData) scenesUsed++;
        if ((si + 1) % 8 === 0 || si === selected.length - 1) {
          log(`OPTRAM calibration progress: ${si + 1}/${selected.length} dates scanned.`);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      if (validSamples < 100 || bins.reduce((sum, b) => sum + b.length, 0) < 100) {
        throw new Error('Not enough clear, valid land observations to fit OPTRAM. Try a larger AOI or a longer date range with more clear scenes.');
      }
      const edges = [];
      for (let i = 0; i < bins.length; i++) {
        if (bins[i].length < 40) continue;
        const low = quantileSorted(bins[i], 0.10);
        const high = quantileSorted(bins[i], 0.90);
        if (Number.isFinite(low) && Number.isFinite(high) && high - low > 1e-5) {
          edges.push({ ndvi: ndviMin + (i + 0.5) * binWidth, dry: low, wet: high, count: bins[i].length });
        }
      }
      const allVals = bins.flat();
      let globalDry = quantileSorted(allVals, 0.10);
      let globalWet = quantileSorted(allVals, 0.90);
      if (!(Number.isFinite(globalDry) && Number.isFinite(globalWet) && globalWet - globalDry > 1e-5)) {
        throw new Error('OPTRAM calibration could not separate dry and wet STR distributions in this AOI.');
      }
      if (getOptramSceneSignature() !== key) {
        throw new Error('The AOI or loaded scene list changed during OPTRAM calibration. Run the analysis again.');
      }
      const model = {
        key, edges, globalDry, globalWet,
        sampleCount: validSamples, scenesUsed, tilesUsed: inputTiles,
        calibrationDates: selected.map(sc => getSceneDateStr(sc))
      };
      optramCalibration = model;
      const edgeLabel = edges.length >= 3 ? `${edges.length} NDVI-binned edges` : 'global robust-percentile edges (limited NDVI-bin coverage)';
      log(`OPTRAM model ready: ${model.scenesUsed} sampled acquisitions, ${model.sampleCount.toLocaleString()} valid sample visits, ${edgeLabel}.`);
      return model;
    })().finally(() => { optramCalibrationPromise = null; });
    return optramCalibrationPromise;
  }

  function interpolateOptramEdges(ndvi, model) {
    const edges = model.edges || [];
    if (edges.length < 2) return [model.globalDry, model.globalWet];
    if (ndvi <= edges[0].ndvi) return [edges[0].dry, edges[0].wet];
    if (ndvi >= edges[edges.length - 1].ndvi) {
      const last = edges[edges.length - 1];
      return [last.dry, last.wet];
    }
    for (let i = 1; i < edges.length; i++) {
      if (ndvi <= edges[i].ndvi) {
        const a = edges[i - 1], b = edges[i];
        const f = (ndvi - a.ndvi) / (b.ndvi - a.ndvi);
        return [a.dry + f * (b.dry - a.dry), a.wet + f * (b.wet - a.wet)];
      }
    }
    return [model.globalDry, model.globalWet];
  }

  async function computeSingleItemRaw(item, mode, applyCloudMask) {
    const sceneStartedAt = performance.now();
    const waterMaskOn = waterOnlyChk.checked && WATER_QUALITY_PROXY_MODES.has(mode);
    const waterThreshold = Math.max(-0.5, Math.min(0.5, Number(waterMaskThresholdInput.value) || 0));
    const key = `${item.id}_${mode}_${applyCloudMask}_${waterMaskOn}_${waterThreshold}`;
    if (sceneRawCache.has(key)) return sceneRawCache.get(key);

    const dateStr = getSceneDateStr(item);
    const assets = item.assets;
    let width, height, refImage, refWindow, refCrs, refOrigin, refRes;
    let indexGrid = null;
    let rgbChannels = null;
    let aoiCloudPct = null;

    if (mode === 'rgb' && assets.visual?.href) {
      const tiff = await GeoTIFF.fromUrl(assets.visual.href);
      refImage = await tiff.getImage();
      refCrs = getRasterCrs(refImage, item, drawnBbox);
      const pixelInfo = calculatePixelWindow(drawnBbox, refImage, refCrs);
      refWindow = pixelInfo.window; refOrigin = pixelInfo.origin; refRes = pixelInfo.resolution;
      const size = getOutputSize(refWindow);
      width = size.width; height = size.height;

      const [rgb, sclObj] = await Promise.all([
        refImage.readRasters(rasterReadOptions({ window: refWindow, width, height, interleave: false, resampleMethod: 'bilinear' })),
        readSclMask(item, drawnBbox, size, refCrs, { pixelInfo, crs: refCrs })
      ]);
      aoiCloudPct = sclObj.aoiCloudPct;
      const mask = applyCloudMask ? sclObj.mask : null;

      const rCh = new Uint8ClampedArray(width * height);
      const gCh = new Uint8ClampedArray(width * height);
      const bCh = new Uint8ClampedArray(width * height);
      const aCh = new Uint8ClampedArray(width * height);

      for (let i = 0; i < width * height; i++) {
        const r = Number(rgb[0][i]), g = Number(rgb[1][i]), b = Number(rgb[2][i]);
        if ((r === 0 && g === 0 && b === 0) || (mask && mask[i] === 1)) {
          aCh[i] = 0; continue;
        }
        rCh[i] = r; gCh[i] = g; bCh[i] = b; aCh[i] = 255;
      }
      rgbChannels = [rCh, gCh, bCh, aCh];
    } else if (mode === 'rgb' || mode === 'rgb_bands' || mode === 'false_color') {
      const bandKeys = mode === 'false_color' ? ['nir', 'red', 'green'] : ['red', 'green', 'blue'];
      const b1 = await readBandScaled(assets[bandKeys[0]], drawnBbox, null, null, item);
      const [b2, b3, sclObj] = await Promise.all([
        readBandScaled(assets[bandKeys[1]], drawnBbox, b1.size, b1.crs, item, b1),
        readBandScaled(assets[bandKeys[2]], drawnBbox, b1.size, b1.crs, item, b1),
        readSclMask(item, drawnBbox, b1.size, b1.crs, b1)
      ]);
      refImage = b1.image; refWindow = b1.pixelInfo.window; refCrs = b1.crs;
      refOrigin = b1.pixelInfo.origin; refRes = b1.pixelInfo.resolution;
      width = b1.size.width; height = b1.size.height;
      aoiCloudPct = sclObj.aoiCloudPct;
      const mask = applyCloudMask ? sclObj.mask : null;

      const rCh = new Uint8ClampedArray(width * height);
      const gCh = new Uint8ClampedArray(width * height);
      const bCh = new Uint8ClampedArray(width * height);
      const aCh = new Uint8ClampedArray(width * height);

      for (let i = 0; i < width * height; i++) {
        if (Number.isNaN(b1.data[i]) || Number.isNaN(b2.data[i]) || Number.isNaN(b3.data[i]) || (mask && mask[i] === 1)) {
          aCh[i] = 0; continue;
        }
        rCh[i] = reflectanceToByte(b1.data[i]);
        gCh[i] = reflectanceToByte(b2.data[i]);
        bCh[i] = reflectanceToByte(b3.data[i]);
        aCh[i] = 255;
      }
      rgbChannels = [rCh, gCh, bCh, aCh];
    } else if (mode === 'optram') {
      const input = await readOptramInputsSingleItem(item, applyCloudMask);
      const model = await ensureOptramCalibration();
      width = input.width; height = input.height;
      refImage = input.refImage; refWindow = input.refWindow; refCrs = input.refCrs;
      refOrigin = input.refOrigin; refRes = input.refRes;
      aoiCloudPct = input.aoiCloudPct;
      indexGrid = new Float32Array(width * height);
      indexGrid.fill(NaN);
      for (let i = 0; i < indexGrid.length; i++) {
        const nv = input.ndvi[i], sv = input.str[i];
        if (!Number.isFinite(nv) || !Number.isFinite(sv)) continue;
        const [dry, wet] = interpolateOptramEdges(nv, model);
        if (!Number.isFinite(dry) || !Number.isFinite(wet) || wet - dry <= 1e-5) continue;
        indexGrid[i] = Math.max(0, Math.min(1, (sv - dry) / (wet - dry)));
      }
    } else {
      const def = INDEX_DEFS[mode];
      if (!def) throw new Error(`Unsupported spectral mode: ${mode}`);
      const waterMaskOn = waterOnlyChk.checked && WATER_QUALITY_PROXY_MODES.has(mode);
      const waterThreshold = Math.max(-0.5, Math.min(0.5, Number(waterMaskThresholdInput.value) || 0));
      const readKeys = Array.from(new Set(def.bands.concat(waterMaskOn ? ['green', 'swir16'] : [])));

      // Use the coarsest native band as the output grid. This prevents a 20 m
      // red-edge/SWIR index from being presented as if it contained 10 m detail.
      const refKey = readKeys.reduce((best, key) => {
        return getNativeResolution(assets[key], key) > getNativeResolution(assets[best], best) ? key : best;
      }, readKeys[0]);
      const refBand = await readBandScaled(getBandAsset(assets, refKey), drawnBbox, null, null, item);
      const loaded = await Promise.all(readKeys.map(async key => {
        if (key === refKey) return [key, refBand];
        const result = await readBandScaled(getBandAsset(assets, key), drawnBbox, refBand.size, refBand.crs, item, refBand);
        return [key, result];
      }));
      const bandResults = Object.fromEntries(loaded);
      const bandArrays = def.bands.map(key => bandResults[key].data);
      const greenForMask = waterMaskOn ? bandResults.green.data : null;
      const swirForMask = waterMaskOn ? bandResults.swir16.data : null;
      const [sclObj] = await Promise.all([readSclMask(item, drawnBbox, refBand.size, refBand.crs, refBand)]);

      refImage = refBand.image;
      refWindow = refBand.pixelInfo.window;
      refCrs = refBand.crs;
      refOrigin = refBand.pixelInfo.origin;
      refRes = refBand.pixelInfo.resolution;
      width = refBand.size.width;
      height = refBand.size.height;
      aoiCloudPct = sclObj.aoiCloudPct;
      const mask = applyCloudMask ? sclObj.mask : null;

      const calcStartedAt = performance.now();
      try {
        const workerResult = await runCpuWorkerTask('index-grid', {
          length: width * height,
          mode,
          bandArrays,
          mask: mask || null,
          waterMaskOn,
          waterValid: null,
          green: greenForMask,
          swir: swirForMask,
          waterThreshold
        });
        indexGrid = workerResult.indexGrid;
        // Keep worker-derived mean only as a local hint; the shared reduction below
        // remains the single source of truth for the cached raw object.
      } catch (workerErr) {
        // Robust fallback for browsers that block Blob workers / worker execution.
        indexGrid = new Float32Array(width * height);
        for (let i = 0; i < indexGrid.length; i++) {
          if (mask && mask[i] === 1) { indexGrid[i] = NaN; continue; }
          if (waterMaskOn) {
            const green = greenForMask[i], swir = swirForMask[i];
            const denom = green + swir;
            const mndwi = Number.isFinite(green) && Number.isFinite(swir) && Math.abs(denom) > 1e-6
              ? (green - swir) / denom : NaN;
            if (!Number.isFinite(mndwi) || mndwi <= waterThreshold) { indexGrid[i] = NaN; continue; }
          }
          const pixelBands = bandArrays.map(arr => arr[i]);
          indexGrid[i] = calculateIndexValue(mode, pixelBands);
        }
        if (!cpuWorkerAttempted || !cpuWorker) {
          console.info('Index calculation used the main thread because a CPU worker was unavailable.');
        } else {
          console.warn('Index calculation worker failed; used the main-thread fallback.', workerErr);
        }
      }
      const calcElapsedMs = performance.now() - calcStartedAt;
      if (calcElapsedMs >= 100) log(`Index calculation: ${(calcElapsedMs / 1000).toFixed(2)} s (${width}×${height} pixels).`);
    }

    let meanVal = NaN;
    if (indexGrid) {
      let sum = 0, cnt = 0;
      for (let i = 0; i < indexGrid.length; i++) {
        if (Number.isFinite(indexGrid[i])) { sum += indexGrid[i]; cnt++; }
      }
      if (cnt > 0) meanVal = sum / cnt;
    }

    const rawObj = {
      id: item.id, dateStr, mode, width, height,
      refImage: {
        getOrigin: () => refOrigin.slice(),
        getResolution: () => refRes.slice(),
        getWidth: () => width,
        getHeight: () => height
      }, refWindow, refCrs, refOrigin, refRes,
      indexGrid, rgbChannels, meanVal,
      sceneCloudPct: getCloudCover(item),
      aoiCloudPct
    };
    sceneRawCache.set(key, rawObj);
    const sceneElapsedMs = performance.now() - sceneStartedAt;
    if (sceneElapsedMs >= 500) {
      log(`Scene processing ${dateStr}: ${(sceneElapsedMs / 1000).toFixed(2)} s.`);
    }
    return rawObj;
  }

  // Mosaic all STAC tiles belonging to the same Sentinel-2 acquisition. The target
  // grid covers the complete AOI in the first tile's UTM CRS, using no finer than
  // the coarsest input-band resolution (and limiting output dimensions for memory).
  async function computeSceneRaw(item, mode, applyCloudMask) {
    if (!Array.isArray(item?.tiles)) return computeSingleItemRaw(item, mode, applyCloudMask);

    const waterMaskOn = waterOnlyChk.checked && WATER_QUALITY_PROXY_MODES.has(mode);
    const waterThreshold = Math.max(-0.5, Math.min(0.5, Number(waterMaskThresholdInput.value) || 0));
    const cacheKey = `${item.id}_${mode}_${applyCloudMask}_${waterMaskOn}_${waterThreshold}`;
    if (sceneRawCache.has(cacheKey)) return sceneRawCache.get(cacheKey);

    const tileRaws = [];
    const sortedTiles = item.tiles.slice().sort((a, b) => getCloudCover(a) - getCloudCover(b));
    for (const tile of sortedTiles) {
      try {
        tileRaws.push(await computeSingleItemRaw(tile, mode, applyCloudMask));
      } catch (err) {
        log(`Tile ${tile.id} skipped for ${getSceneDateStr(item)}: ${err.message}`);
      }
    }
    if (tileRaws.length === 0) throw new Error(`No intersecting tiles could be read for ${getSceneDateStr(item)}.`);

    // Alias single-tile acquisitions to the virtual acquisition ID so all charts,
    // cache lookups and exports use the same scene structure.
    if (tileRaws.length === 1) {
      const single = { ...tileRaws[0], id: item.id, dateStr: getSceneDateStr(item), tileCount: item.tiles.length, sceneCloudPct: getCloudCover(item) };
      sceneRawCache.set(cacheKey, single);
      return single;
    }

    const ref = tileRaws[0];
    const projected = transformBboxPerimeter(drawnBbox, 'EPSG:4326', ref.refCrs, BBOX_EDGE_SEGMENTS);
    const minX = Math.min(...projected.map(p => p[0]));
    const maxX = Math.max(...projected.map(p => p[0]));
    const minY = Math.min(...projected.map(p => p[1]));
    const maxY = Math.max(...projected.map(p => p[1]));
    const extentW = Math.max(1, maxX - minX);
    const extentH = Math.max(1, maxY - minY);
    let cellSize = Math.max(Math.abs(ref.refRes[0]), Math.abs(ref.refRes[1]));
    if (!Number.isFinite(cellSize) || cellSize <= 0) cellSize = 20;
    cellSize *= Math.max(1, extentW / (MAX_OUTPUT_DIMENSION * cellSize), extentH / (MAX_OUTPUT_DIMENSION * cellSize));
    const width = Math.max(1, Math.min(MAX_OUTPUT_DIMENSION, Math.ceil(extentW / cellSize)));
    const height = Math.max(1, Math.min(MAX_OUTPUT_DIMENSION, Math.ceil(extentH / cellSize)));
    const refOrigin = [minX, maxY];
    const refRes = [extentW / width, -extentH / height];
    const refWindow = [0, 0, width, height];
    const refImage = {
      getOrigin: () => refOrigin.slice(),
      getResolution: () => refRes.slice(),
      getWidth: () => width,
      getHeight: () => height
    };

    const isRgb = tileRaws.some(r => Boolean(r.rgbChannels));
    let indexGrid = null;
    let rgbChannels = null;
    const total = width * height;

    const tileTransforms = tileRaws.map(raw => {
      const tlLonLat = proj4(ref.refCrs, 'EPSG:4326', [refOrigin[0], refOrigin[1]]);
      const trLonLat = proj4(ref.refCrs, 'EPSG:4326', [refOrigin[0] + width * refRes[0], refOrigin[1]]);
      const blLonLat = proj4(ref.refCrs, 'EPSG:4326', [refOrigin[0], refOrigin[1] + height * refRes[1]]);

      const tl = proj4('EPSG:4326', raw.refCrs, tlLonLat);
      const tr = proj4('EPSG:4326', raw.refCrs, trLonLat);
      const bl = proj4('EPSG:4326', raw.refCrs, blLonLat);

      const dxX = (tr[0] - tl[0]) / width;
      const dxY = (tr[1] - tl[1]) / width;
      const dyX = (bl[0] - tl[0]) / height;
      const dyY = (bl[1] - tl[1]) / height;

      return { raw, tl, dxX, dxY, dyX, dyY };
    });

    if (isRgb) {
      const r = new Uint8ClampedArray(total), g = new Uint8ClampedArray(total);
      const b = new Uint8ClampedArray(total), a = new Uint8ClampedArray(total);
      for (let y = 0; y < height; y++) {
        if (y > 0 && y % 24 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          for (const { raw, tl, dxX, dxY, dyX, dyY } of tileTransforms) {
            const ptX = tl[0] + (x + 0.5) * dxX + (y + 0.5) * dyX;
            const ptY = tl[1] + (x + 0.5) * dxY + (y + 0.5) * dyY;
            const px = (ptX - raw.refOrigin[0]) / raw.refRes[0];
            const py = (ptY - raw.refOrigin[1]) / raw.refRes[1];
            const win = raw.refWindow;
            if (px < win[0] || px >= win[2] || py < win[1] || py >= win[3]) continue;
            const gx = Math.floor(((px - win[0]) / (win[2] - win[0])) * raw.width);
            const gy = Math.floor(((py - win[1]) / (win[3] - win[1])) * raw.height);
            if (gx < 0 || gy < 0 || gx >= raw.width || gy >= raw.height) continue;
            const si = gy * raw.width + gx;
            if (!raw.rgbChannels || raw.rgbChannels[3][si] === 0) continue;
            r[i] = raw.rgbChannels[0][si]; g[i] = raw.rgbChannels[1][si]; b[i] = raw.rgbChannels[2][si]; a[i] = 255;
            break; // tiles sorted by scene cloud cover; use first valid pixel
          }
        }
      }
      rgbChannels = [r, g, b, a];
    } else {
      indexGrid = new Float32Array(total);
      indexGrid.fill(NaN);
      for (let y = 0; y < height; y++) {
        if (y > 0 && y % 24 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          for (const { raw, tl, dxX, dxY, dyX, dyY } of tileTransforms) {
            const ptX = tl[0] + (x + 0.5) * dxX + (y + 0.5) * dyX;
            const ptY = tl[1] + (x + 0.5) * dxY + (y + 0.5) * dyY;
            const px = (ptX - raw.refOrigin[0]) / raw.refRes[0];
            const py = (ptY - raw.refOrigin[1]) / raw.refRes[1];
            const win = raw.refWindow;
            if (px < win[0] || px >= win[2] || py < win[1] || py >= win[3]) continue;
            const gx = Math.floor(((px - win[0]) / (win[2] - win[0])) * raw.width);
            const gy = Math.floor(((py - win[1]) / (win[3] - win[1])) * raw.height);
            if (gx < 0 || gy < 0 || gx >= raw.width || gy >= raw.height || !raw.indexGrid) continue;
            const value = raw.indexGrid[gy * raw.width + gx];
            if (Number.isFinite(value)) { indexGrid[i] = value; break; }
          }
        }
      }
    }

    let sum = 0, count = 0;
    if (indexGrid) for (const v of indexGrid) if (Number.isFinite(v)) { sum += v; count++; }
    const clouds = tileRaws.map(r => r.sceneCloudPct).filter(Number.isFinite);
    const aoiClouds = tileRaws.map(r => r.aoiCloudPct).filter(Number.isFinite);
    const mosaic = {
      id: item.id, dateStr: getSceneDateStr(item), mode, width, height,
      refImage, refWindow, refCrs: ref.refCrs, refOrigin, refRes,
      indexGrid, rgbChannels, meanVal: count ? sum / count : NaN,
      sceneCloudPct: getCloudCover(item),
      aoiCloudPct: aoiClouds.length ? aoiClouds.reduce((a, b) => a + b, 0) / aoiClouds.length : null,
      tileCount: item.tiles.length, tileIds: item.tiles.map(t => t.id)
    };
    sceneRawCache.set(cacheKey, mosaic);
    log(`Mosaicked ${item.tiles.length} tiles for ${getSceneDateStr(item)} (${width}×${height} output grid).`);
    return mosaic;
  }

  function gridsShareGeometry(a, b) {
    if (!a || !b || a.width !== b.width || a.height !== b.height || a.refCrs !== b.refCrs) return false;
    const sameArray = (x, y) => Array.isArray(x) && Array.isArray(y) && x.length === y.length &&
      x.every((v, i) => Math.abs(v - y[i]) < 1e-7);
    return sameArray(a.refWindow, b.refWindow) && sameArray(a.refOrigin, b.refOrigin) && sameArray(a.refRes, b.refRes);
  }

  function rawPixelToLonLat(rawObj, x, y) {
    const win = rawObj.refWindow;
    const px = win[0] + ((x + 0.5) / rawObj.width) * (win[2] - win[0]);
    const py = win[1] + ((y + 0.5) / rawObj.height) * (win[3] - win[1]);
    const projected = [rawObj.refOrigin[0] + px * rawObj.refRes[0], rawObj.refOrigin[1] + py * rawObj.refRes[1]];
    return proj4(rawObj.refCrs, 'EPSG:4326', projected);
  }

  function sampleCompositeIndex(rawObj, lon, lat) {
    const value = sampleValueAtLonLat(rawObj, rawObj.indexGrid, lon, lat);
    return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  }

  function sampleCompositeRgb(rawObj, lon, lat) {
    const value = sampleValueAtLonLat(rawObj, null, lon, lat);
    if (typeof value !== 'string') return null;
    const match = value.match(/^RGB\((\d+),\s*(\d+),\s*(\d+)\)$/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  }

  // ============================================================================
