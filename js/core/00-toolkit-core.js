/**
 * @file js/core/00-toolkit-core.js
 * @description Pure, zero-DOM-dependency geospatial, statistical, caching, and export utilities.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SentiToolkitCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 1. Bounded LRU Cache
  class LRUCache {
    constructor(maxSize = 12) {
      this.maxSize = maxSize;
      this.cache = new Map();
    }
    get(key) {
      if (!this.cache.has(key)) return undefined;
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    set(key, value) {
      if (this.cache.has(key)) {
        this.cache.delete(key);
      } else if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      this.cache.set(key, value);
    }
    has(key) { return this.cache.has(key); }
    clear() { this.cache.clear(); }
  }

  // 2. Bounded Concurrency Runner
  async function mapConcurrent(items, concurrency, workerFn) {
    const results = new Array(items.length);
    let nextIndex = 0;
    async function runner() {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        results[index] = await workerFn(items[index], index);
      }
    }
    const runners = Array.from(
      { length: Math.min(items.length, Math.max(1, concurrency)) },
      () => runner()
    );
    await Promise.all(runners);
    return results;
  }

  // 3. Quickselect & Array Statistics
  function quickSelect(arr, left, right, k) {
    while (left < right) {
      const pivotIndex = left + Math.floor(Math.random() * (right - left + 1));
      const pivotValue = arr[pivotIndex];
      arr[pivotIndex] = arr[right];
      arr[right] = pivotValue;
      let storeIndex = left;
      for (let i = left; i < right; i++) {
        if (arr[i] < pivotValue) {
          const temp = arr[i];
          arr[i] = arr[storeIndex];
          arr[storeIndex] = temp;
          storeIndex++;
        }
      }
      arr[right] = arr[storeIndex];
      arr[storeIndex] = pivotValue;
      if (k === storeIndex) return arr[k];
      else if (k < storeIndex) right = storeIndex - 1;
      else left = storeIndex + 1;
    }
    return arr[k];
  }

  function calcArrayStat(validVals, count, stat, pVal = 50) {
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
    const q = stat === 'median' ? 0.5 : (stat === 'p90' ? 0.90 : Math.max(0.01, Math.min(0.99, pVal / 100)));
    const pos = (count - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    const val1 = quickSelect(sub, 0, count - 1, base);
    if (rest > 0 && base + 1 < count) {
      let val2 = Infinity;
      for (let i = base + 1; i < count; i++) {
        if (sub[i] < val2) val2 = sub[i];
      }
      return val1 + rest * (val2 - val1);
    }
    return val1;
  }

  function compositeGrids(grids, stat = 'median', pVal = 50) {
    if (!grids || !grids.length) return new Float32Array(0);
    const len = grids[0].length;
    const out = new Float32Array(len);
    const scratch = new Float32Array(grids.length);
    for (let i = 0; i < len; i++) {
      let n = 0;
      for (let g = 0; g < grids.length; g++) {
        const v = grids[g][i];
        if (Number.isFinite(v)) scratch[n++] = v;
      }
      out[i] = n > 0 ? calcArrayStat(scratch, n, stat, pVal) : NaN;
    }
    return out;
  }

  // 4. Polygon & Transect Geometry
  function pointInPolygon(x, y, ring) {
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

  function summarizeWgs84Grid(grid, width, height, bbox, polygonRing = null) {
    const [west, south, east, north] = bbox;
    const vals = [];
    let sum = 0, sumSq = 0;
    for (let y = 0; y < height; y++) {
      const lat = north - ((y + 0.5) / height) * (north - south);
      for (let x = 0; x < width; x++) {
        const lon = west + ((x + 0.5) / width) * (east - west);
        if (polygonRing && polygonRing.length >= 3 && !pointInPolygon(lon, lat, polygonRing)) continue;
        const v = grid[y * width + x];
        if (Number.isFinite(v)) {
          vals.push(v);
          sum += v;
          sumSq += v * v;
        }
      }
    }
    if (!vals.length) {
      return { count: 0, mean: NaN, sd: NaN, min: NaN, p25: NaN, median: NaN, p75: NaN, p90: NaN, max: NaN };
    }
    vals.sort((a, b) => a - b);
    const q = p => {
      const pos = (vals.length - 1) * p;
      const lo = Math.floor(pos), frac = pos - lo;
      return lo + 1 < vals.length ? vals[lo] + frac * (vals[lo + 1] - vals[lo]) : vals[lo];
    };
    const mean = sum / vals.length;
    return {
      count: vals.length,
      mean,
      sd: Math.sqrt(Math.max(0, sumSq / vals.length - mean * mean)),
      min: vals[0],
      p25: q(0.25),
      median: q(0.50),
      p75: q(0.75),
      p90: q(0.90),
      max: vals[vals.length - 1]
    };
  }

  function buildTransectPoints(lineCoords, numSamples = 120) {
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

  // 5. Self-Contained GIF89a Encoder
  function encodeAnimatedGIF(canvases, delayCs = 80) {
    const width = canvases[0].width;
    const height = canvases[0].height;
    const bytes = [];
    const writeByte = b => bytes.push(b & 0xff);
    const writeShort = s => { writeByte(s); writeByte(s >> 8); };
    const writeStr = s => { for (let i = 0; i < s.length; i++) writeByte(s.charCodeAt(i)); };

    writeStr('GIF89a');
    writeShort(width);
    writeShort(height);
    writeByte(0x70); writeByte(0); writeByte(0);
    writeByte(0x21); writeByte(0xff); writeByte(11);
    writeStr('NETSCAPE2.0');
    writeByte(3); writeByte(1); writeShort(0); writeByte(0);

    const palette = [];
    for (let r = 0; r < 6; r++) {
      for (let g = 0; g < 6; g++) {
        for (let b = 0; b < 6; b++) {
          palette.push([Math.round(r * 255 / 5), Math.round(g * 255 / 5), Math.round(b * 255 / 5)]);
        }
      }
    }
    while (palette.length < 256) palette.push([0, 0, 0]);

    function lzwEncode(indices, minCodeSize) {
      const out = [];
      const clearCode = 1 << minCodeSize;
      const eoiCode = clearCode + 1;
      let codeSize = minCodeSize + 1;
      let nextCode = eoiCode + 1;
      let dict = new Map();
      let bitBuf = 0, bitCnt = 0;
      const emit = code => {
        bitBuf |= (code << bitCnt);
        bitCnt += codeSize;
        while (bitCnt >= 8) { out.push(bitBuf & 0xff); bitBuf >>= 8; bitCnt -= 8; }
      };
      emit(clearCode);
      let prefix = indices[0];
      for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const key = (prefix << 8) | k;
        const found = dict.get(key);
        if (found !== undefined) prefix = found;
        else {
          emit(prefix);
          if (nextCode < 4096) {
            dict.set(key, nextCode++);
            if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
          } else {
            emit(clearCode); dict.clear(); codeSize = minCodeSize + 1; nextCode = eoiCode + 1;
          }
          prefix = k;
        }
      }
      emit(prefix); emit(eoiCode);
      if (bitCnt > 0) out.push(bitBuf & 0xff);
      return out;
    }

    for (const srcCanvas of canvases) {
      const ctx = srcCanvas.getContext('2d');
      const imgData = ctx.getImageData(0, 0, width, height).data;
      const indices = new Uint8Array(width * height);
      for (let i = 0, p = 0; i < imgData.length; i += 4, p++) {
        if (imgData[i + 3] < 40) indices[p] = 255;
        else {
          const r = Math.round(imgData[i] * 5 / 255);
          const g = Math.round(imgData[i + 1] * 5 / 255);
          const b = Math.round(imgData[i + 2] * 5 / 255);
          indices[p] = r * 36 + g * 6 + b;
        }
      }
      writeByte(0x21); writeByte(0xf9); writeByte(4); writeByte(0x09);
      writeShort(delayCs); writeByte(255); writeByte(0);
      writeByte(0x2c); writeShort(0); writeShort(0); writeShort(width); writeShort(height); writeByte(0x87);
      for (let i = 0; i < 256; i++) {
        writeByte(palette[i][0]); writeByte(palette[i][1]); writeByte(palette[i][2]);
      }
      const minCodeSize = 8;
      writeByte(minCodeSize);
      const compressed = lzwEncode(indices, minCodeSize);
      for (let i = 0; i < compressed.length; i += 255) {
        const chunk = compressed.slice(i, i + 255);
        writeByte(chunk.length);
        for (let j = 0; j < chunk.length; j++) writeByte(chunk[j]);
      }
      writeByte(0);
    }
    writeByte(0x3b);
    return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
  }

  // 6. WGS84 GeoTIFF Blob Writer
  async function writeWgs84GeoTiffBlob(grid, width, height, bbox, description = 'Satellite Analysis') {
    if (typeof GeoTIFF === 'undefined' || typeof GeoTIFF.writeArrayBuffer !== 'function') {
      throw new Error('GeoTIFF.writeArrayBuffer is not available.');
    }
    const [west, south, east, north] = bbox;
    const clean = new Float32Array(grid.length);
    for (let i = 0; i < grid.length; i++) {
      clean[i] = Number.isFinite(grid[i]) ? grid[i] : -9999;
    }
    const buf = await GeoTIFF.writeArrayBuffer(clean, {
      width,
      height,
      ModelPixelScale: [(east - west) / width, (north - south) / height, 0],
      ModelTiepoint: [0, 0, 0, west, north, 0],
      GTModelTypeGeoKey: 2,
      GeographicTypeGeoKey: 4326,
      GDAL_NODATA: '-9999',
      ImageDescription: description
    });
    return new Blob([buf], { type: 'image/tiff' });
  }

  return {
    LRUCache,
    mapConcurrent,
    quickSelect,
    calcArrayStat,
    compositeGrids,
    pointInPolygon,
    summarizeWgs84Grid,
    buildTransectPoints,
    encodeAnimatedGIF,
    writeWgs84GeoTiffBlob
  };
});
