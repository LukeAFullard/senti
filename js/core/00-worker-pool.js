/**
 * @file js/core/00-worker-pool.js
 * Universal, zero-DOM Web Worker pool and CPU-bound task execution engine.
 *
 * Designed to elevate UX, DX, and AX (Agent Experience):
 * - UX: Non-blocking off-thread raster index crunching, temporal compositing,
 *       seasonal anomaly MAD scoring, and Otsu water/flood thresholding.
 * - DX: Clean async task interface (`runTask(type, payload)`), automatic zero-copy
 *       ArrayBuffer transfers without cache mutation, unified pure task handlers,
 *       and seamless zero-DOM fallback for headless/Node.js testing or file:// deployments.
 * - AX: Introspectable worker pool status, deterministic fallback execution,
 *       and machine-testable pure computational functions (`TASK_HANDLERS`).
 *
 * UMD module: CommonJS (Node.js) + Browser window.SentiWorkerPool.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SentiWorkerPool = factory();
    if (typeof window !== 'undefined') {
      window.SentiWorkerPool = root.SentiWorkerPool;
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ============================================================================
  // Pure Mathematical & Remote Sensing Algorithms
  // (Zero DOM dependencies; shared identically across Worker & Fallback)
  // ============================================================================

  /**
   * Ray-casting algorithm to test whether a 2D point (x, y) is inside a polygon ring.
   * @param {number} x
   * @param {number} y
   * @param {Array<[number, number]>} ring - Array of [x, y] coordinates
   * @returns {boolean}
   */
  function insidePolygon(x, y, ring) {
    let yes = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-30) + xi)) {
        yes = !yes;
      }
    }
    return yes;
  }

  /**
   * In-place quickselect algorithm to find the k-th smallest element in O(N) average time.
   * @param {Float32Array|Array<number>} arr
   * @param {number} l - Left index
   * @param {number} r - Right index
   * @param {number} k - Target k-th index
   * @returns {number}
   */
  function quickSelect(arr, l, r, k) {
    while (l < r) {
      const pI = l + Math.floor(Math.random() * (r - l + 1));
      const pV = arr[pI];
      arr[pI] = arr[r];
      arr[r] = pV;
      let sI = l;
      for (let x = l; x < r; x++) {
        if (arr[x] < pV) {
          const t = arr[x];
          arr[x] = arr[sI];
          arr[sI] = t;
          sI++;
        }
      }
      arr[r] = arr[sI];
      arr[sI] = pV;
      if (k === sI) return arr[k];
      else if (k < sI) r = sI - 1;
      else l = sI + 1;
    }
    return arr[k];
  }

  /**
   * Computes median of the first n elements of an array.
   * @param {Float32Array|Array<number>} arr
   * @param {number} n
   * @returns {number}
   */
  function medianOf(arr, n) {
    if (n <= 0) return NaN;
    const sorted = Array.from(arr.subarray ? arr.subarray(0, n) : arr.slice(0, n)).sort((a, b) => a - b);
    const mid = Math.floor(n / 2);
    return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Evaluates per-pixel remote sensing spectral indices and air-quality proxies.
   * @param {string} mode
   * @param {Array<number>} b - Array of band reflectance / physical values
   * @returns {number}
   */
  function calculateIndexPixel(mode, b) {
    for (let i = 0; i < b.length; i++) {
      if (!Number.isFinite(b[i])) return NaN;
    }
    const nd = (a, c) => {
      const d = a + c;
      return Number.isFinite(d) && Math.abs(d) > 1e-6 ? Math.max(-1, Math.min(1, (a - c) / d)) : NaN;
    };

    switch (mode) {
      case 'ndvi': case 'ndwi': case 'ndmi': case 'smi': case 'nbr':
      case 'ndbi': case 'mndwi': case 'ndci': case 'ndti': case 'nsmi':
        return nd(b[0], b[1]);
      case 'nmdi': {
        const d = b[1] - b[2], den = b[0] + d;
        return Number.isFinite(den) && Math.abs(den) > 1e-6 ? Math.max(-1, Math.min(1, (b[0] - d) / den)) : NaN;
      }
      case 'str':
        return b[0] > 0.005 && b[0] <= 1.2 ? ((1 - b[0]) * (1 - b[0])) / (2 * b[0]) : NaN;
      case 's2wi': {
        const d = b[0] + b[1] + b[2];
        return Math.abs(d) > 1e-6 ? Math.max(-1, Math.min(1, (b[0] - b[1] - b[2]) / d)) : NaN;
      }
      case 'bsi': {
        const d = (b[0] + b[1]) + (b[2] + b[3]);
        return Math.abs(d) > 1e-6 ? Math.max(-1, Math.min(1, ((b[0] + b[1]) - (b[2] + b[3])) / d)) : NaN;
      }
      case 'evi': {
        const d = b[0] + 6 * b[1] - 7.5 * b[2] + 1;
        return Math.abs(d) > 1e-6 ? 2.5 * (b[0] - b[1]) / d : NaN;
      }
      case 'chl_ratio': case 'msi':
        return b[1] > 1e-6 ? b[0] / b[1] : NaN;
      case 'mci':
        return b[0] - (b[1] + (b[2] - b[1]) * (705 - 665) / (740 - 665));
      case 'fai':
        return b[0] - (b[1] + (b[2] - b[1]) * (842 - 665) / (1610 - 665));
      case 'turbidity_ratio':
        return b[1] > 1e-6 ? b[0] / b[1] : NaN;
      case 'awei_nsh':
        return 4 * (b[0] - b[1]) - (0.25 * b[2] + 2.75 * b[3]);
      case 'asi': case 'ngai': case 'spdi': case 'cdi':
        return nd(b[0], b[1]);
      case 's2_aot': {
        let v = b[0];
        if (v > 10 && v <= 10000) v *= 0.001;
        return v >= 0 && v <= 5.0 ? v : NaN;
      }
      case 's2_wvp': {
        let v = b[0];
        if (v > 20 && v <= 20000) v *= 0.001;
        return v >= 0 && v <= 15.0 ? v : NaN;
      }
      case 'pm25_proxy': {
        let a = b[0], w = b[1];
        if (a > 10 && a <= 10000) a *= 0.001;
        if (w > 20 && w <= 20000) w *= 0.001;
        if (a < 0 || a > 5.0 || w < 0) return NaN;
        return Math.max(0, (a * 85.0) / (1.0 * (1.0 + 0.18 * Math.min(5.0, Math.max(0, w)))));
      }
      case 'aerosol_type': {
        const c = b[0], bl = b[1], s = b[2];
        if (c <= 0 || bl <= 0 || s <= 0) return NaN;
        const asi = (c - bl) / (c + bl), cdi = (s - c) / (s + c);
        if (!Number.isFinite(asi) || !Number.isFinite(cdi)) return NaN;
        if (asi >= 0.08 && cdi >= 0.05) return 3;
        if (cdi >= 0.10 && asi < 0.12) return 2;
        if (asi >= 0.08 && cdi < 0.05) return 1;
        return 0;
      }
      default:
        return NaN;
    }
  }

  /**
   * Otsu's thresholding algorithm for bimodal image segmentation.
   * Widely used for SAR radar flood extent binarization (specular water backscatter)
   * and optical water delineation (MNDWI / AWEI water separation).
   *
   * @param {Float32Array|Array<number>} grid - Numeric data array
   * @param {Object} [options={}]
   * @param {number} [options.numBins=256] - Number of histogram bins
   * @param {string} [options.polarity='less'] - 'less' for SAR backscatter (water < T), 'greater' for MNDWI (water >= T)
   * @param {boolean} [options.createMask=false] - If true, generates a Uint8Array binary mask
   * @param {number} [options.minVal] - Optional lower clamp for histogram bounds
   * @param {number} [options.maxVal] - Optional upper clamp for histogram bounds
   * @returns {{ threshold: number, optimalBin: number, betweenClassVariance: number, min: number, max: number, count: number, mask?: Uint8Array }}
   */
  function otsuThreshold(grid, options = {}) {
    if (!grid || !grid.length) {
      return { threshold: NaN, optimalBin: -1, betweenClassVariance: 0, min: NaN, max: NaN, count: 0 };
    }

    const numBins = Math.max(16, Math.min(1024, options.numBins || 256));
    const polarity = options.polarity === 'greater' ? 'greater' : 'less';
    const createMask = Boolean(options.createMask);

    let min = options.minVal !== undefined ? options.minVal : Infinity;
    let max = options.maxVal !== undefined ? options.maxVal : -Infinity;
    let count = 0;

    // Scan min, max, count if not specified
    if (options.minVal === undefined || options.maxVal === undefined) {
      for (let i = 0; i < grid.length; i++) {
        const v = grid[i];
        if (Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
          count++;
        }
      }
    } else {
      for (let i = 0; i < grid.length; i++) {
        const v = grid[i];
        if (Number.isFinite(v) && v >= min && v <= max) count++;
      }
    }

    if (count === 0 || !Number.isFinite(min) || !Number.isFinite(max)) {
      return { threshold: NaN, optimalBin: -1, betweenClassVariance: 0, min: NaN, max: NaN, count: 0 };
    }

    if (min === max) {
      const mask = createMask ? new Uint8Array(grid.length) : undefined;
      if (createMask) {
        for (let i = 0; i < grid.length; i++) {
          const v = grid[i];
          if (Number.isFinite(v)) {
            mask[i] = (polarity === 'less' ? v < min : v >= min) ? 1 : 0;
          }
        }
      }
      return { threshold: min, optimalBin: 0, betweenClassVariance: 0, min, max, count, ...(mask ? { mask } : {}) };
    }

    // Build histogram
    const hist = new Int32Array(numBins);
    const binWidth = (max - min) / numBins;
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      if (Number.isFinite(v) && v >= min && v <= max) {
        let b = Math.floor((v - min) / binWidth);
        if (b >= numBins) b = numBins - 1;
        if (b < 0) b = 0;
        hist[b]++;
      }
    }

    // Compute Otsu inter-class variance
    let totalSum = 0;
    for (let i = 0; i < numBins; i++) {
      totalSum += i * hist[i];
    }

    let w0 = 0;
    let sum0 = 0;
    let maxVariance = -1;
    let optimalBin = 0;

    for (let t = 0; t < numBins - 1; t++) {
      w0 += hist[t];
      if (w0 === 0) continue;
      const w1 = count - w0;
      if (w1 === 0) break;

      sum0 += t * hist[t];
      const m0 = sum0 / w0;
      const m1 = (totalSum - sum0) / w1;
      const variance = w0 * w1 * (m0 - m1) * (m0 - m1);

      if (variance > maxVariance) {
        maxVariance = variance;
        optimalBin = t;
      }
    }

    const threshold = min + (optimalBin + 1) * binWidth;
    const normalizedVariance = count > 0 ? maxVariance / (count * count) : 0;

    let mask;
    if (createMask) {
      mask = new Uint8Array(grid.length);
      for (let i = 0; i < grid.length; i++) {
        const v = grid[i];
        if (Number.isFinite(v)) {
          mask[i] = (polarity === 'less' ? v < threshold : v >= threshold) ? 1 : 0;
        }
      }
    }

    return {
      threshold,
      optimalBin,
      betweenClassVariance: normalizedVariance,
      min,
      max,
      count,
      ...(mask ? { mask } : {})
    };
  }

  // ============================================================================
  // Task Handlers (Zero DOM; Shared by Worker and Main-Thread Fallback)
  // ============================================================================

  const TASK_HANDLERS = {
    /**
     * Calculates index grid for a single scene with optional water masking and polygon clipping.
     */
    'index-grid': function (m) {
      const out = new Float32Array(m.length);
      let sum = 0, count = 0;
      const usePoly = m.polygon && m.polygon.length > 2 && m.win && m.origin && m.res;
      const ww = usePoly ? (m.win[2] - m.win[0]) : 0;
      const wh = usePoly ? (m.win[3] - m.win[1]) : 0;

      for (let i = 0; i < m.length; i++) {
        if (m.mask && m.mask[i] === 1) {
          out[i] = NaN;
          continue;
        }
        if (usePoly) {
          const x = i % m.width, y = Math.floor(i / m.width);
          const px = m.win[0] + ((x + 0.5) / m.width) * ww;
          const py = m.win[1] + ((y + 0.5) / m.height) * wh;
          const mapX = m.origin[0] + px * m.res[0];
          const mapY = m.origin[1] + py * m.res[1];
          if (!insidePolygon(mapX, mapY, m.polygon)) {
            out[i] = NaN;
            continue;
          }
        }
        if (m.waterMaskOn) {
          const g = m.green[i], sw = m.swir[i], den = g + sw;
          const mndwi = Number.isFinite(g) && Number.isFinite(sw) && Math.abs(den) > 1e-6 ? (g - sw) / den : NaN;
          if (!Number.isFinite(mndwi) || mndwi <= m.waterThreshold) {
            out[i] = NaN;
            continue;
          }
        }
        const bands = new Array(m.bandArrays.length);
        for (let j = 0; j < m.bandArrays.length; j++) {
          bands[j] = m.bandArrays[j][i];
        }
        const v = calculateIndexPixel(m.mode, bands);
        out[i] = v;
        if (Number.isFinite(v)) {
          sum += v;
          count++;
        }
      }
      return { indexGrid: out, meanVal: count ? sum / count : NaN };
    },

    /**
     * Composites multiple aligned index grids using statistical reduction.
     */
    'composite-index': function (m) {
      const out = new Float32Array(m.length);
      const vals = new Float32Array(m.grids.length);

      for (let i = 0; i < m.length; i++) {
        let n = 0;
        for (let j = 0; j < m.grids.length; j++) {
          const v = m.grids[j][i];
          if (Number.isFinite(v)) vals[n++] = v;
        }
        if (!n) {
          out[i] = NaN;
          continue;
        }
        if (m.stat === 'mean') {
          let sum = 0;
          for (let j = 0; j < n; j++) sum += vals[j];
          out[i] = sum / n;
        } else if (m.stat === 'max') {
          let v = -Infinity;
          for (let j = 0; j < n; j++) if (vals[j] > v) v = vals[j];
          out[i] = v;
        } else if (m.stat === 'min') {
          let v = Infinity;
          for (let j = 0; j < n; j++) if (vals[j] < v) v = vals[j];
          out[i] = v;
        } else {
          const sub = vals.subarray(0, n);
          const q = m.stat === 'median' ? 0.5 : Math.max(0.01, Math.min(0.99, m.pVal / 100));
          const pos = (n - 1) * q, base = Math.floor(pos), frac = pos - base;
          const v1 = quickSelect(sub, 0, n - 1, base);
          if (frac > 0 && base + 1 < n) {
            let v2 = Infinity;
            for (let x = base + 1; x < n; x++) if (sub[x] < v2) v2 = sub[x];
            out[i] = v1 + frac * (v2 - v1);
          } else {
            out[i] = v1;
          }
        }
      }
      return { indexGrid: out };
    },

    /**
     * Composites multiple 4-channel [R, G, B, A] layers into a single RGB composite.
     */
    'composite-rgb': function (m) {
      const r = new Uint8ClampedArray(m.length);
      const g = new Uint8ClampedArray(m.length);
      const b = new Uint8ClampedArray(m.length);
      const a = new Uint8ClampedArray(m.length);
      const vals = new Float32Array(m.channels.length);

      function statValue(n) {
        if (!n) return NaN;
        if (m.stat === 'mean') {
          let sum = 0;
          for (let j = 0; j < n; j++) sum += vals[j];
          return sum / n;
        }
        if (m.stat === 'max') {
          let v = -Infinity;
          for (let j = 0; j < n; j++) if (vals[j] > v) v = vals[j];
          return v;
        }
        if (m.stat === 'min') {
          let v = Infinity;
          for (let j = 0; j < n; j++) if (vals[j] < v) v = vals[j];
          return v;
        }
        const sub = vals.subarray(0, n);
        const q = m.stat === 'median' ? 0.5 : Math.max(0.01, Math.min(0.99, m.pVal / 100));
        const pos = (n - 1) * q, base = Math.floor(pos), frac = pos - base;
        const v1 = quickSelect(sub, 0, n - 1, base);
        if (frac > 0 && base + 1 < n) {
          let v2 = Infinity;
          for (let x = base + 1; x < n; x++) if (sub[x] < v2) v2 = sub[x];
          return v1 + frac * (v2 - v1);
        }
        return v1;
      }

      for (let i = 0; i < m.length; i++) {
        let n = 0;
        for (let j = 0; j < m.channels.length; j++) if (m.channels[j][3][i] > 0) vals[n++] = m.channels[j][0][i];
        r[i] = n ? Math.round(statValue(n)) : 0;

        n = 0;
        for (let j = 0; j < m.channels.length; j++) if (m.channels[j][3][i] > 0) vals[n++] = m.channels[j][1][i];
        g[i] = n ? Math.round(statValue(n)) : 0;

        n = 0;
        for (let j = 0; j < m.channels.length; j++) if (m.channels[j][3][i] > 0) vals[n++] = m.channels[j][2][i];
        b[i] = n ? Math.round(statValue(n)) : 0;

        a[i] = m.channels.some(ch => ch[3][i] > 0) ? 255 : 0;
      }
      return { rgbChannels: [r, g, b, a] };
    },

    /**
     * Evaluates robust seasonal anomalies using Median Absolute Deviation (MAD).
     */
    'seasonal-anomaly': function (m) {
      const out = new Float32Array(m.length);
      const medians = new Float32Array(m.length);
      const support = new Uint16Array(m.length);
      const vals = new Float32Array(m.baselines.length);
      const devs = new Float32Array(m.baselines.length);

      for (let i = 0; i < m.length; i++) {
        const target = m.target[i];
        if (!Number.isFinite(target)) {
          out[i] = NaN;
          medians[i] = NaN;
          support[i] = 0;
          continue;
        }
        let n = 0;
        for (let j = 0; j < m.baselines.length; j++) {
          const v = m.baselines[j][i];
          if (Number.isFinite(v)) vals[n++] = v;
        }
        support[i] = n;
        if (n < m.minObs) {
          out[i] = NaN;
          medians[i] = NaN;
          continue;
        }
        const med = medianOf(vals, n);
        medians[i] = med;
        for (let j = 0; j < n; j++) devs[j] = Math.abs(vals[j] - med);
        const mad = medianOf(devs, n);
        const delta = target - med;
        const scale = 1.4826 * mad;
        if (Number.isFinite(scale) && scale > 1e-7) {
          out[i] = delta / scale;
        } else {
          out[i] = Math.abs(delta) <= 1e-7 ? 0 : Math.sign(delta) * m.maxZ;
        }
      }
      return { indexGrid: out, baselineMedian: medians, support };
    },

    /**
     * Calculates spatial distribution statistics within a polygon boundary.
     */
    'polygon-stats': function (m) {
      const vals = [];
      const ww = m.win[2] - m.win[0], wh = m.win[3] - m.win[1];
      for (let y = 0; y < m.height; y++) {
        const py = m.win[1] + ((y + 0.5) / m.height) * wh;
        const mapY = m.origin[1] + py * m.res[1];
        for (let x = 0; x < m.width; x++) {
          const px = m.win[0] + ((x + 0.5) / m.width) * ww;
          const mapX = m.origin[0] + px * m.res[0];
          if (!insidePolygon(mapX, mapY, m.ring)) continue;
          const v = m.grid[y * m.width + x];
          if (Number.isFinite(v)) vals.push(v);
        }
      }
      if (!vals.length) {
        return { count: 0, mean: NaN, median: NaN, sd: NaN, min: NaN, p25: NaN, p75: NaN, max: NaN };
      }
      let sum = 0, sumSq = 0, min = Infinity, max = -Infinity;
      for (const v of vals) {
        sum += v;
        sumSq += v * v;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      vals.sort((a, b) => a - b);
      const quantile = q => {
        const pos = (vals.length - 1) * q, base = Math.floor(pos), frac = pos - base;
        return base + 1 < vals.length ? vals[base] + frac * (vals[base + 1] - vals[base]) : vals[base];
      };
      const mean = sum / vals.length;
      return {
        count: vals.length,
        mean,
        median: quantile(0.5),
        sd: Math.sqrt(Math.max(0, sumSq / vals.length - mean * mean)),
        min,
        p25: quantile(0.25),
        p75: quantile(0.75),
        max
      };
    },

    /**
     * Otsu's thresholding task for SAR flood extent or optical water binarization.
     */
    'otsu-threshold': function (m) {
      return otsuThreshold(m.grid, m);
    }
  };

  // ============================================================================
  // Worker Script Generation
  // (Serializes the pure algorithms into a self-contained Web Worker script)
  // ============================================================================

  function buildWorkerSource() {
    return `
      ${insidePolygon.toString()}
      ${quickSelect.toString()}
      ${medianOf.toString()}
      ${calculateIndexPixel.toString()}
      ${otsuThreshold.toString()}

      const TASK_HANDLERS = {
        'index-grid': ${TASK_HANDLERS['index-grid'].toString()},
        'composite-index': ${TASK_HANDLERS['composite-index'].toString()},
        'composite-rgb': ${TASK_HANDLERS['composite-rgb'].toString()},
        'seasonal-anomaly': ${TASK_HANDLERS['seasonal-anomaly'].toString()},
        'polygon-stats': ${TASK_HANDLERS['polygon-stats'].toString()},
        'otsu-threshold': ${TASK_HANDLERS['otsu-threshold'].toString()}
      };

      self.onmessage = function (e) {
        const m = e.data;
        try {
          const handler = TASK_HANDLERS[m.type];
          if (!handler) throw new Error('Unknown CPU worker task type: ' + m.type);
          const result = handler(m);
          const transfer = [];
          if (result) {
            if (result.indexGrid && result.indexGrid.buffer) transfer.push(result.indexGrid.buffer);
            if (result.baselineMedian && result.baselineMedian.buffer) transfer.push(result.baselineMedian.buffer);
            if (result.support && result.support.buffer) transfer.push(result.support.buffer);
            if (result.mask && result.mask.buffer) transfer.push(result.mask.buffer);
            if (result.rgbChannels && Array.isArray(result.rgbChannels)) {
              for (let i = 0; i < result.rgbChannels.length; i++) {
                if (result.rgbChannels[i] && result.rgbChannels[i].buffer) {
                  transfer.push(result.rgbChannels[i].buffer);
                }
              }
            }
          }
          self.postMessage({ id: m.id, ok: true, result }, transfer);
        } catch (err) {
          self.postMessage({ id: m.id, ok: false, error: err && err.message ? err.message : String(err) });
        }
      };
    `;
  }

  // ============================================================================
  // Worker Pool Engine
  // ============================================================================

  /**
   * Checks whether Web Workers and Blob URLs are supported in the current environment.
   * @returns {boolean}
   */
  function isSupported() {
    return typeof Worker !== 'undefined' &&
           typeof Blob !== 'undefined' &&
           typeof URL !== 'undefined' &&
           typeof URL.createObjectURL === 'function';
  }

  /**
   * Prepares payload for zero-copy worker transfer by making defensive copies of
   * typed arrays, ensuring caller-side caches are not detached.
   * @param {string} type
   * @param {Object} payload
   * @returns {{ payloadCopy: Object, transferList: Array<ArrayBuffer> }}
   */
  function prepareTransferPayload(type, payload) {
    const transferList = [];
    const payloadCopy = { ...payload };

    if (type === 'index-grid' && payload.bandArrays) {
      payloadCopy.bandArrays = payload.bandArrays.map(arr => {
        const copy = new Float32Array(arr);
        transferList.push(copy.buffer);
        return copy;
      });
      if (payload.mask) {
        payloadCopy.mask = new Uint8Array(payload.mask);
        transferList.push(payloadCopy.mask.buffer);
      }
      if (payload.green) {
        payloadCopy.green = new Float32Array(payload.green);
        transferList.push(payloadCopy.green.buffer);
      }
      if (payload.swir) {
        payloadCopy.swir = new Float32Array(payload.swir);
        transferList.push(payloadCopy.swir.buffer);
      }
    } else if (type === 'composite-index' && payload.grids) {
      payloadCopy.grids = payload.grids.map(grid => {
        const copy = new Float32Array(grid);
        transferList.push(copy.buffer);
        return copy;
      });
    } else if (type === 'composite-rgb' && payload.channels) {
      payloadCopy.channels = payload.channels.map(ch => {
        return ch.map(c => {
          const cCopy = new Uint8ClampedArray(c);
          transferList.push(cCopy.buffer);
          return cCopy;
        });
      });
    } else if (type === 'seasonal-anomaly' && payload.baselines) {
      payloadCopy.baselines = payload.baselines.map(b => {
        const copy = new Float32Array(b);
        transferList.push(copy.buffer);
        return copy;
      });
      if (payload.target) {
        payloadCopy.target = new Float32Array(payload.target);
        transferList.push(payloadCopy.target.buffer);
      }
    } else if (type === 'otsu-threshold' && payload.grid) {
      const copy = new Float32Array(payload.grid);
      payloadCopy.grid = copy;
      transferList.push(copy.buffer);
    }

    return { payloadCopy, transferList };
  }

  /**
   * Managed Worker Pool class.
   */
  class WorkerPool {
    /**
     * @param {Object} [options={}]
     * @param {number} [options.maxWorkers=1] - Maximum concurrent workers
     * @param {boolean} [options.fallbackOnly=false] - Force main-thread fallback execution
     */
    constructor(options = {}) {
      this.maxWorkers = Math.max(1, Math.min(8, options.maxWorkers || 1));
      this.fallbackOnly = Boolean(options.fallbackOnly);
      this.workers = []; // [{ worker, busy: boolean, id: number }]
      this.pendingTasks = new Map(); // id -> { resolve, reject, workerItem }
      this.taskQueue = []; // [{ type, payload, resolve, reject }]
      this.taskId = 0;
      this.isTerminated = false;
      this.workerBlobUrl = null;
    }

    /**
     * Synchronous/microtask fallback execution on the current thread.
     * @param {string} type
     * @param {Object} payload
     * @returns {Promise<any>}
     */
    executeFallback(type, payload) {
      return new Promise((resolve, reject) => {
        try {
          const handler = TASK_HANDLERS[type];
          if (!handler) {
            return reject(new Error('Unknown task type: ' + type));
          }
          const result = handler(payload);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    }

    /**
     * Creates a new worker instance from the dynamically compiled Blob script.
     * @private
     */
    _createWorkerItem() {
      if (!isSupported()) return null;
      try {
        if (!this.workerBlobUrl) {
          const source = buildWorkerSource();
          const blob = new Blob([source], { type: 'text/javascript' });
          this.workerBlobUrl = URL.createObjectURL(blob);
        }
        const worker = new Worker(this.workerBlobUrl);
        const workerItem = {
          id: this.workers.length + 1,
          worker,
          busy: false
        };

        worker.onmessage = (event) => {
          const msg = event.data || {};
          const pending = this.pendingTasks.get(msg.id);
          if (!pending) return;
          this.pendingTasks.delete(msg.id);
          workerItem.busy = false;

          if (msg.ok) {
            pending.resolve(msg.result);
          } else {
            pending.reject(new Error(msg.error || 'CPU worker task failed.'));
          }

          // Process next queued task
          this._drainQueue();
        };

        worker.onerror = (event) => {
          const errMessage = (event && event.message) || 'Web Worker execution error';
          for (const [id, pending] of this.pendingTasks.entries()) {
            if (pending.workerItem === workerItem) {
              pending.reject(new Error(errMessage));
              this.pendingTasks.delete(id);
            }
          }
          workerItem.busy = false;
          try { worker.terminate(); } catch (_) {}
          const idx = this.workers.indexOf(workerItem);
          if (idx !== -1) this.workers.splice(idx, 1);
        };

        this.workers.push(workerItem);
        return workerItem;
      } catch (err) {
        console.warn('[SentiWorkerPool] Failed to instantiate worker:', err);
        return null;
      }
    }

    /**
     * Drains pending tasks from the FIFO queue to idle workers.
     * @private
     */
    _drainQueue() {
      if (this.isTerminated || !this.taskQueue.length) return;

      let idleWorker = this.workers.find(w => !w.busy);
      if (!idleWorker && this.workers.length < this.maxWorkers) {
        idleWorker = this._createWorkerItem();
      }

      if (!idleWorker) return;

      const nextTask = this.taskQueue.shift();
      if (!nextTask) return;

      const id = ++this.taskId;
      idleWorker.busy = true;

      this.pendingTasks.set(id, {
        resolve: nextTask.resolve,
        reject: nextTask.reject,
        workerItem: idleWorker
      });

      try {
        const { payloadCopy, transferList } = prepareTransferPayload(nextTask.type, nextTask.payload);
        payloadCopy.type = nextTask.type;
        payloadCopy.id = id;
        idleWorker.worker.postMessage(payloadCopy, transferList);
      } catch (err) {
        this.pendingTasks.delete(id);
        idleWorker.busy = false;
        nextTask.reject(err);
        this._drainQueue();
      }
    }

    /**
     * Submits a CPU task to the worker pool or falls back to main thread.
     * @param {string} type - Task name (e.g. 'index-grid', 'composite-index', 'otsu-threshold')
     * @param {Object} payload - Task inputs
     * @returns {Promise<any>}
     */
    runTask(type, payload) {
      if (this.isTerminated) {
        return Promise.reject(new Error('SentiWorkerPool has been terminated.'));
      }

      // Headless / fallback mode
      if (this.fallbackOnly || !isSupported()) {
        return this.executeFallback(type, payload);
      }

      return new Promise((resolve, reject) => {
        this.taskQueue.push({ type, payload, resolve, reject });
        this._drainQueue();
      });
    }

    /**
     * Terminates all running workers and frees resources.
     */
    terminate() {
      this.isTerminated = true;
      for (const item of this.workers) {
        try { item.worker.terminate(); } catch (_) {}
      }
      this.workers = [];
      if (this.workerBlobUrl) {
        try { URL.revokeObjectURL(this.workerBlobUrl); } catch (_) {}
        this.workerBlobUrl = null;
      }
      for (const pending of this.pendingTasks.values()) {
        pending.reject(new Error('Worker pool terminated.'));
      }
      this.pendingTasks.clear();
      this.taskQueue = [];
    }

    /**
     * Returns runtime introspection status for Agent Experience (AX).
     */
    getStatus() {
      return {
        isSupported: isSupported(),
        fallbackOnly: this.fallbackOnly,
        maxWorkers: this.maxWorkers,
        activeWorkers: this.workers.length,
        busyWorkers: this.workers.filter(w => w.busy).length,
        queuedTasks: this.taskQueue.length,
        pendingTasks: this.pendingTasks.size,
        isTerminated: this.isTerminated
      };
    }
  }

  // ============================================================================
  // Global Singleton & Public API
  // ============================================================================

  let defaultPool = null;

  function getDefaultPool() {
    if (!defaultPool) {
      const concurrency = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? Math.max(1, Math.min(4, navigator.hardwareConcurrency - 1))
        : 1;
      defaultPool = new WorkerPool({ maxWorkers: concurrency });
    }
    return defaultPool;
  }

  return {
    isSupported,
    insidePolygon,
    quickSelect,
    medianOf,
    calculateIndexPixel,
    otsuThreshold,
    TASK_HANDLERS,
    prepareTransferPayload,
    WorkerPool,
    createPool: (options) => new WorkerPool(options),
    runTask: (type, payload) => getDefaultPool().runTask(type, payload),
    executeFallback: (type, payload) => getDefaultPool().executeFallback(type, payload),
    getStatus: () => getDefaultPool().getStatus(),
    terminate: () => {
      if (defaultPool) {
        defaultPool.terminate();
        defaultPool = null;
      }
    }
  };
});
