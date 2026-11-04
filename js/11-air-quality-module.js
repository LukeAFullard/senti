/**
 * @file 11-air-quality-module.js
 * @description Standalone, zero-DOM-dependency Remote Sensing Air Quality Module.
 * Supports Sentinel-2 L2A native atmospheric assets (AOT, WVP), spectral aerosol/smoke/dust
 * indices (ASI, NGAI, SPDI, CDI), heuristic PM2.5 screening, Sen2Cor DDV fallback diagnostics,
 * and Sentinel-5P trace-gas unit conversions.
 *
 * Designed for reuse across arbitrary browser/Worker/Node applications, with an optional
 * adapter (`registerWithSentiApp`) that wires directly into the `senti` browser toolkit.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AirQualityRemoteSensing = factory();
    // Auto-register with the Senti global environment if present
    if (typeof root.INDEX_DEFS === 'object' && typeof root.COLOR_STRETCH_SCALES === 'object') {
      root.AirQualityRemoteSensing.registerWithSentiApp(root);
    }
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ============================================================================
  // 1. Metric Catalog & Physical Metadata
  // ============================================================================

  /**
   * Complete specification of supported Air Quality remote sensing metrics.
   * Band names follow standard Earth Search STAC (`sentinel-2-c1-l2a`) asset keys:
   * - `aot`: Aerosol Optical Thickness at 550nm (Sen2Cor L2A product, 20m/60m)
   * - `wvp`: Columnar Water Vapour in g/cm^2 (Sen2Cor L2A product, 20m/60m)
   * - `coastal`: Band 1 (443nm, 60m)
   * - `blue`: Band 2 (490nm, 10m)
   * - `green`: Band 3 (560nm, 10m)
   * - `red`: Band 4 (665nm, 10m)
   * - `swir16`: Band 11 (1610nm, 20m)
   * - `swir22`: Band 12 (2190nm, 20m)
   */
  const AQ_METRICS = {
    s2_aot: {
      id: 's2_aot',
      name: 'Aerosol Optical Thickness (AOT 550nm)',
      shortLabel: 'AOT₅₅₀',
      bands: ['aot'],
      nativeResolutionM: 20,
      units: 'dimensionless (τ₅₅₀)',
      scale: { min: 0.0, max: 1.0, breaks: [0.1, 0.25, 0.45, 0.7] },
      legendItems: [
        ['#91144b', 'Severe plume (> 0.70)'],
        ['#eb732d', 'Polluted / smoke (0.45–0.70)'],
        ['#f0cd4b', 'Moderate haze (0.25–0.45)'],
        ['#6ec387', 'Low aerosol (0.10–0.25)'],
        ['#2891c3', 'Clean background (< 0.10)']
      ],
      defaultAssetScale: { scale: 0.001, offset: 0, nodata: 0 },
      isProxy: false,
      description: 'Sen2Cor DDV-derived column aerosol optical thickness at 550nm. Values <0.1 indicate clean air; >0.4 indicate heavy haze, smoke, or dust. Note: Sen2Cor defaults to ~0.20 if Dark Dense Vegetation pixels are absent.'
    },
    s2_wvp: {
      id: 's2_wvp',
      name: 'Columnar Water Vapour (WVP)',
      shortLabel: 'WVP (g/cm²)',
      bands: ['wvp'],
      nativeResolutionM: 20,
      units: 'g/cm² (precipitable cm)',
      scale: { min: 0.0, max: 5.0, breaks: [0.8, 1.6, 2.6, 3.8] },
      legendItems: [
        ['#142d82', 'Very humid (> 3.8 g/cm²)'],
        ['#2369c3', 'High moisture (2.6–3.8)'],
        ['#41afd7', 'Humid (1.6–2.6)'],
        ['#91cd9b', 'Moderate (0.8–1.6)'],
        ['#d7be7d', 'Dry column (< 0.8)']
      ],
      defaultAssetScale: { scale: 0.001, offset: 0, nodata: 0 },
      isProxy: false,
      description: 'Column-integrated atmospheric water vapour derived from Sentinel-2 B09 (945nm). Critical for evaluating hygroscopic aerosol swelling.'
    },
    asi: {
      id: 'asi',
      name: 'Aerosol Scattering Index (ASI)',
      shortLabel: 'ASI (B01/B02)',
      bands: ['coastal', 'blue'],
      nativeResolutionM: 60,
      units: 'normalized index (-1 to 1)',
      scale: { min: -0.25, max: 0.35, breaks: [-0.08, 0.0, 0.08, 0.18] },
      legendItems: [
        ['#9b1946', 'High shortwave scattering (> 0.18)'],
        ['#eb7d32', 'Elevated (0.08–0.18)'],
        ['#ebd25a', 'Moderate (0.00–0.08)'],
        ['#69b49b', 'Low (-0.08–0.00)'],
        ['#2d6ea5', 'Minimal (< -0.08)']
      ],
      isProxy: true,
      description: 'Normalized difference between Coastal Aerosol (443nm) and Blue (490nm). Highlights enhanced shortwave Rayleigh/Mie scattering from fine-mode aerosols.'
    },
    ngai: {
      id: 'ngai',
      name: 'Normalized Green-Aerosol Index (NGAI)',
      shortLabel: 'NGAI (B01/B03)',
      bands: ['coastal', 'green'],
      nativeResolutionM: 60,
      units: 'normalized index (-1 to 1)',
      scale: { min: -0.35, max: 0.35, breaks: [-0.15, -0.02, 0.08, 0.2] },
      legendItems: [
        ['#9b1946', 'Strong haze signal (> 0.18)'],
        ['#eb7d32', 'Elevated (0.08–0.18)'],
        ['#ebd25a', 'Moderate (0.00–0.08)'],
        ['#69b49b', 'Low (-0.08–0.00)'],
        ['#2d6ea5', 'Clear (< -0.08)']
      ],
      isProxy: true,
      description: 'Normalized difference between Coastal Aerosol (443nm) and Green (560nm). Provides wider spectral leverage for mapping urban smog and regional haze.'
    },
    spdi: {
      id: 'spdi',
      name: 'Smoke Plume Separation Index (SPDI)',
      shortLabel: 'SPDI (Smoke vs Cloud/Soil)',
      bands: ['coastal', 'swir22'],
      nativeResolutionM: 60,
      units: 'normalized index (-1 to 1)',
      scale: { min: -0.5, max: 0.7, breaks: [-0.15, 0.05, 0.25, 0.45] },
      legendItems: [
        ['#8c1455', 'Core fine smoke plume (> 0.45)'],
        ['#e66e2d', 'Dense smoke (0.25–0.45)'],
        ['#ebcd55', 'Thin smoke / haze (0.05–0.25)'],
        ['#5a9b87', 'Clear land (-0.15–0.05)'],
        ['#785f46', 'Bare soil / SWIR bright (< -0.15)']
      ],
      isProxy: true,
      description: 'Exploits strong Mie scattering of fine combustion smoke at 443nm (B01) versus high transparency at 2190nm (B12) to separate smoke plumes from soil and clouds.'
    },
    cdi: {
      id: 'cdi',
      name: 'Coarse Dust Index (CDI)',
      shortLabel: 'CDI (Coarse Dust)',
      bands: ['swir16', 'coastal'],
      nativeResolutionM: 60,
      units: 'normalized index (-1 to 1)',
      scale: { min: -0.4, max: 0.6, breaks: [-0.1, 0.08, 0.22, 0.38] },
      legendItems: [
        ['#9b4119', 'Heavy coarse dust (> 0.38)'],
        ['#d77d32', 'Elevated dust/soil (0.22–0.38)'],
        ['#e6c35f', 'Moderate (0.08–0.22)'],
        ['#7db98c', 'Low (-0.10–0.08)'],
        ['#3782b9', 'Fine/clear (< -0.10)']
      ],
      isProxy: true,
      description: 'Contrasts SWIR1 (1610nm) scattering against 443nm absorption/scattering to distinguish coarse mineral dust/ash plumes from fine-mode smoke.'
    },
    pm25_proxy: {
      id: 'pm25_proxy',
      name: 'Heuristic Surface PM2.5 Screening Proxy',
      shortLabel: 'PM₂.₅ Proxy (µg/m³)',
      bands: ['aot', 'wvp'],
      nativeResolutionM: 20,
      units: 'relative µg/m³ proxy',
      scale: { min: 0, max: 150, breaks: [12, 35, 55, 100] },
      legendItems: [
        ['#7d145f', 'Very Unhealthy / Hazardous (> 100)'],
        ['#c3232d', 'Unhealthy (55–100)'],
        ['#f0822d', 'Unhealthy for Sensitive (35–55)'],
        ['#ebcd46', 'Moderate (12–35)'],
        ['#2da573', 'Good (< 12)']
      ],
      isProxy: true,
      description: 'Screening-level surface PM2.5 proxy combining AOT₅₅₀ with a WVP hygroscopic growth correction and assumed boundary-layer height. Requires local ground calibration.'
    }
  };

  // ============================================================================
  // 2. Pure Per-Pixel & Typed-Array Calculation Engine
  // ============================================================================

  /**
   * Computes a single pixel value for a given Air Quality metric.
   * Pure function suitable for main thread or Web Worker injection.
   *
   * @param {string} mode - Metric key from `AQ_METRICS`
   * @param {number[]} b - Array of band values in the order defined by `AQ_METRICS[mode].bands`
   * @param {Object} [options] - Optional physical parameters for `pm25_proxy`
   * @returns {number} Calculated metric or NaN
   */
  function calculateAqPixel(mode, b, options) {
    if (!b || b.length === 0) return NaN;
    for (let i = 0; i < b.length; i++) {
      if (!Number.isFinite(b[i])) return NaN;
    }

    const nd = (x, y) => {
      const denom = x + y;
      return Number.isFinite(denom) && Math.abs(denom) > 1e-6
        ? Math.max(-1, Math.min(1, (x - y) / denom))
        : NaN;
    };

    switch (mode) {
      case 's2_aot': {
        let aot = b[0];
        // Auto-normalize if the caller passed raw unscaled DN (e.g., 200 instead of 0.200)
        // Standard Sentinel-2 L2A reflectance pipeline applies (DN * 0.0001 - 0.1) if raster:bands
        // metadata is missing; we detect and invert that if needed, or clamp valid τ_550 range.
        if (aot > 10 && aot <= 10000) aot *= 0.001;
        return aot >= 0 && aot <= 5.0 ? aot : NaN;
      }

      case 's2_wvp': {
        let wvp = b[0];
        if (wvp > 20 && wvp <= 20000) wvp *= 0.001;
        return wvp >= 0 && wvp <= 15.0 ? wvp : NaN;
      }

      case 'asi':
      case 'ngai':
      case 'spdi':
      case 'cdi':
        return nd(b[0], b[1]);

      case 'pm25_proxy': {
        let aot = b[0];
        let wvp = b[1];
        if (aot > 10 && aot <= 10000) aot *= 0.001;
        if (wvp > 20 && wvp <= 20000) wvp *= 0.001;
        if (aot < 0 || aot > 5.0 || wvp < 0) return NaN;

        const pblHeightKm = (options && Number.isFinite(options.pblHeightKm)) ? options.pblHeightKm : 1.0;
        const massExtinctionCoeff = (options && Number.isFinite(options.massExtinctionCoeff)) ? options.massExtinctionCoeff : 85.0;
        // Hygroscopic swelling correction: higher column water vapour increases light extinction
        // per unit dry aerosol mass. Moderate empirical damping factor f(WVP) in [1.0, 2.2].
        const hygroscopicFactor = 1.0 + 0.18 * Math.min(5.0, Math.max(0, wvp));
        return Math.max(0, (aot * massExtinctionCoeff) / (pblHeightKm * hygroscopicFactor));
      }

      default:
        return NaN;
    }
  }

  /**
   * Repairs an AOT or WVP Float32Array if it was inadvertently scaled using the
   * Sentinel-2 surface reflectance fallback (`scale: 0.0001, offset: -0.1`) instead
   * of the Sen2Cor atmospheric quantification (`scale: 0.001, offset: 0`).
   *
   * @param {Float32Array} grid - Input raster array
   * @returns {Float32Array} Corrected Float32Array
   */
  function normalizeSen2CorAtmosphericGrid(grid) {
    if (!grid || !grid.length) return grid;
    let valid = 0, negativeCount = 0, minVal = Infinity, maxVal = -Infinity;
    const step = Math.max(1, Math.floor(grid.length / 4000));
    for (let i = 0; i < grid.length; i += step) {
      const v = grid[i];
      if (!Number.isFinite(v)) continue;
      valid++;
      if (v < 0) negativeCount++;
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
    // If >30% of values are negative and lie between -0.1 and +0.9, the reflectance offset (-0.1)
    // and 0.0001 scale were applied instead of Sen2Cor's 0.001 scale + 0 offset.
    if (valid > 0 && negativeCount / valid > 0.3 && minVal >= -0.1001 && maxVal < 1.5) {
      const out = new Float32Array(grid.length);
      for (let i = 0; i < grid.length; i++) {
        const v = grid[i];
        if (!Number.isFinite(v)) {
          out[i] = NaN;
        } else {
          const dn = (v + 0.1) / 0.0001;
          out[i] = dn > 0 ? dn * 0.001 : NaN;
        }
      }
      return out;
    }
    return grid;
  }

  /**
   * Computes a full Float32Array raster grid for any Air Quality metric.
   *
   * @param {string} mode - Metric ID (`s2_aot`, `s2_wvp`, `asi`, `ngai`, `spdi`, `cdi`, `pm25_proxy`)
   * @param {Object.<string, Float32Array>} bandMap - Dictionary mapping band names to Float32Arrays
   * @param {Object} [options] - `{ mask: Uint8Array, pblHeightKm: number }`
   * @returns {{ indexGrid: Float32Array, meanVal: number, validCount: number }}
   */
  function computeMetricGrid(mode, bandMap, options = {}) {
    const def = AQ_METRICS[mode];
    if (!def) throw new Error(`Unknown Air Quality metric: ${mode}`);

    const arrays = def.bands.map(key => {
      const arr = bandMap[key];
      if (!arr) throw new Error(`Missing required band "${key}" for Air Quality metric "${mode}"`);
      return (key === 'aot' || key === 'wvp') ? normalizeSen2CorAtmosphericGrid(arr) : arr;
    });

    const length = arrays[0].length;
    const mask = options.mask || null;
    const out = new Float32Array(length);
    const pixelBuf = new Array(arrays.length);
    let sum = 0, count = 0;

    for (let i = 0; i < length; i++) {
      if (mask && mask[i] === 1) {
        out[i] = NaN;
        continue;
      }
      for (let j = 0; j < arrays.length; j++) {
        pixelBuf[j] = arrays[j][i];
      }
      const val = calculateAqPixel(mode, pixelBuf, options);
      out[i] = val;
      if (Number.isFinite(val)) {
        sum += val;
        count++;
      }
    }

    return {
      indexGrid: out,
      meanVal: count > 0 ? sum / count : NaN,
      validCount: count
    };
  }

  // ============================================================================
  // 3. Diagnostics & Quality Assurance (Sen2Cor DDV Fallback & Plume Screening)
  // ============================================================================

  /**
   * Evaluates an Air Quality grid for retrieval anomalies, specifically checking whether
   * Sen2Cor's AOT retrieval lacked Dense Dark Vegetation (DDV) pixels and defaulted to a
   * constant visibility value (~0.20), and classifies aerosol/smoke severity.
   *
   * @param {Float32Array} grid - Computed metric grid
   * @param {string} mode - Metric ID
   * @returns {Object} Diagnostic report
   */
  function diagnoseAirQualityGrid(grid, mode = 's2_aot') {
    if (!grid || !grid.length) {
      return { validCount: 0, validFraction: 0, status: 'No data' };
    }

    const sample = [];
    const stride = Math.max(1, Math.floor(grid.length / 25000));
    let sum = 0, sumSq = 0, validCount = 0;

    for (let i = 0; i < grid.length; i += stride) {
      const v = grid[i];
      if (Number.isFinite(v)) {
        sample.push(v);
        sum += v;
        sumSq += v * v;
        validCount++;
      }
    }

    if (validCount === 0) {
      return { validCount: 0, validFraction: 0, status: 'All pixels masked or NoData' };
    }

    sample.sort((a, b) => a - b);
    const q = p => sample[Math.min(sample.length - 1, Math.max(0, Math.floor((sample.length - 1) * p)))];
    const mean = sum / validCount;
    const sd = Math.sqrt(Math.max(0, sumSq / validCount - mean * mean));
    const p05 = q(0.05), median = q(0.50), p95 = q(0.95);

    // Sen2Cor DDV Fallback Check: When DDV pixels are sparse/absent, Sen2Cor fills the
    // AOT map with a near-constant value (often 0.20 for 40km visibility).
    const isConstantFallback = (mode === 's2_aot' || mode === 'pm25_proxy') && sd < 0.0025 && (p95 - p05) < 0.006;

    let category = 'Normal';
    if (mode === 's2_aot') {
      if (p95 > 0.65) category = 'Severe Aerosol / Smoke / Dust Plume';
      else if (p95 > 0.35) category = 'Elevated Haze / Moderately Polluted';
      else if (median < 0.12) category = 'Clean Background Air';
      else category = 'Moderate Background Aerosol';
    } else if (mode === 'spdi') {
      if (p95 > 0.35) category = 'Strong Fine-Mode Smoke Plume Signature';
      else if (p95 > 0.15) category = 'Moderate Haze / Smoke Signature';
      else category = 'Low Smoke Signal';
    }

    return {
      mode,
      validSamples: validCount,
      validFraction: validCount / Math.ceil(grid.length / stride),
      mean,
      median,
      sd,
      p05,
      p95,
      isConstantFallback,
      category,
      warning: isConstantFallback
        ? 'Low spatial variance detected in AOT (SD < 0.0025). Sen2Cor likely lacked Dark Dense Vegetation (DDV) reference pixels in this AOI and defaulted to a constant visibility assumption.'
        : null
    };
  }

  // ============================================================================
  // 4. Sentinel-5P (TROPOMI) Trace-Gas Conversion Helpers
  // ============================================================================

  /**
   * Converts Sentinel-5P TROPOMI trace-gas column densities between mol/m^2,
   * molecules/cm^2, and Dobson Units (DU). Useful when loading pre-gridded S5P COGs.
   *
   * - 1 mol/m^2 = 6.02214076e19 molecules/cm^2
   * - 1 mol/m^2 = 2241.15 Dobson Units (DU)
   *
   * @param {number} value - Input trace gas column value
   * @param {'mol_m2'|'molec_cm2'|'du'} fromUnit
   * @param {'mol_m2'|'molec_cm2'|'du'} toUnit
   * @returns {number}
   */
  function convertTraceGasUnits(value, fromUnit, toUnit) {
    if (!Number.isFinite(value)) return NaN;
    if (fromUnit === toUnit) return value;
    let molM2 = value;
    if (fromUnit === 'molec_cm2') molM2 = value / 6.02214076e19;
    else if (fromUnit === 'du') molM2 = value / 2241.15;

    if (toUnit === 'mol_m2') return molM2;
    if (toUnit === 'molec_cm2') return molM2 * 6.02214076e19;
    if (toUnit === 'du') return molM2 * 2241.15;
    return NaN;
  }

  // ============================================================================
  // 5. Color Palettes & Visualization
  // ============================================================================

  /**
   * Maps a metric value (or delta value) to an RGBA tuple `[R, G, B, A]`.
   *
   * @param {number} val - Pixel value
   * @param {string} mode - Metric key
   * @param {boolean} [isDiff=false] - Whether rendering a change-detection layer
   * @returns {number[]} `[r, g, b, a]`
   */
  function colorizeAqMetric(val, mode, isDiff = false) {
    if (!Number.isFinite(val)) return [0, 0, 0, 0];

    if (isDiff) {
      // For air quality, an increase in AOT/Smoke/PM2.5 is a degradation (warm red/purple)
      // and a decrease is cleaner air (teal/blue).
      let t1 = 0.04, t2 = 0.15;
      if (mode === 's2_wvp') { t1 = 0.2; t2 = 0.7; }
      else if (mode === 'pm25_proxy') { t1 = 5; t2 = 20; }
      if (val < -t2) return [20, 110, 180, 235];
      if (val < -t1) return [90, 185, 215, 230];
      if (val <= t1) return [225, 225, 225, 175];
      if (val <= t2) return [240, 140, 55, 235];
      return [175, 20, 45, 240];
    }

    switch (mode) {
      case 's2_aot':
        if (val < 0.10) return [40, 145, 195, 225];  // Clean background
        if (val < 0.25) return [110, 195, 135, 230]; // Low-moderate aerosol
        if (val < 0.45) return [240, 205, 75, 235];  // Hazy
        if (val < 0.70) return [235, 115, 45, 240];  // Polluted / Smoke
        return [145, 20, 75, 245];                   // Thick plume / Severe

      case 's2_wvp':
        if (val < 0.8) return [215, 190, 125, 225];  // Very dry column
        if (val < 1.6) return [145, 205, 155, 230];  // Moderate
        if (val < 2.6) return [65, 175, 215, 235];   // Humid
        if (val < 3.8) return [35, 105, 195, 240];   // High moisture
        return [20, 45, 130, 245];                   // Tropical / very wet column

      case 'asi':
      case 'ngai':
        if (val < -0.08) return [45, 110, 165, 225];
        if (val < 0.00) return [105, 180, 155, 225];
        if (val < 0.08) return [235, 210, 90, 230];
        if (val < 0.18) return [235, 125, 50, 235];
        return [155, 25, 70, 245];

      case 'spdi':
        if (val < -0.15) return [120, 95, 70, 215];  // Bare soil / SWIR-bright
        if (val < 0.05) return [90, 155, 135, 220];  // Clear land / vegetation
        if (val < 0.25) return [235, 205, 85, 235];  // Thin haze / smoke
        if (val < 0.45) return [230, 110, 45, 240];  // Dense smoke plume
        return [140, 20, 85, 245];                   // Core smoke plume

      case 'cdi':
        if (val < -0.10) return [55, 130, 185, 220];
        if (val < 0.08) return [125, 185, 140, 225];
        if (val < 0.22) return [230, 195, 95, 235];
        if (val < 0.38) return [215, 125, 50, 240];
        return [155, 65, 25, 245];

      case 'pm25_proxy':
        if (val < 12) return [45, 165, 115, 225];    // Good
        if (val < 35) return [235, 205, 70, 230];    // Moderate
        if (val < 55) return [240, 130, 45, 235];    // Unhealthy for Sensitive Groups
        if (val < 100) return [195, 35, 45, 240];    // Unhealthy
        return [125, 20, 95, 245];                   // Very Unhealthy / Hazardous

      default:
        return [0, 0, 0, 0];
    }
  }

  // ============================================================================
  // 6. Drop-in Adapter for the `senti` Browser Application
  // ============================================================================

  /**
   * Registers the Air Quality metrics, scales, band resolutions, UI dropdown options,
   * and calculation hooks into the host `senti` app if present.
   *
   * @param {Window|Object} host - Global scope containing `INDEX_DEFS`, `COLOR_STRETCH_SCALES`, etc.
   */
  function registerWithSentiApp(host) {
    if (!host || typeof host !== 'object') return false;

    // 1. Register index definitions
    if (host.INDEX_DEFS) {
      for (const [key, def] of Object.entries(AQ_METRICS)) {
        host.INDEX_DEFS[key] = {
          bands: def.bands.slice(),
          formula: key
        };
      }
    }

    // 2. Register color stretch scales
    if (host.COLOR_STRETCH_SCALES) {
      for (const [key, def] of Object.entries(AQ_METRICS)) {
        host.COLOR_STRETCH_SCALES[key] = {
          min: def.scale.min,
          max: def.scale.max,
          breaks: def.scale.breaks.slice()
        };
      }
    }

    // 3. Wrap `runCpuWorkerTask` so air quality modes bypass the hardcoded worker
    // and cleanly fall back to the main thread where calculateIndexValue is registered.
    if (typeof host.runCpuWorkerTask === 'function' && !host.runCpuWorkerTask._aqWrapped) {
      const origRunCpuWorkerTask = host.runCpuWorkerTask;
      host.runCpuWorkerTask = function (type, payload) {
        if (type === 'index-grid' && payload && Object.prototype.hasOwnProperty.call(AQ_METRICS, payload.mode)) {
          return Promise.reject(new Error('AQ_MAIN_THREAD_DELEGATE'));
        }
        return origRunCpuWorkerTask.call(this, type, payload);
      };
      host.runCpuWorkerTask._aqWrapped = true;
    }

    // 4. Wrap `updateLegend` so Air Quality metrics display custom legend items and stretch UI
    // rather than being hidden by the local scales check in 03-composites-and-legend.js.
    if (typeof host.updateLegend === 'function' && !host.updateLegend._aqWrapped) {
      const origUpdateLegend = host.updateLegend;
      host.updateLegend = function (mode, isDiff) {
        if (!Object.prototype.hasOwnProperty.call(AQ_METRICS, mode)) {
          return origUpdateLegend.call(this, mode, isDiff);
        }
        const legendEl = (typeof host.legend !== 'undefined' && host.legend)
          ? host.legend
          : (typeof document !== 'undefined' ? document.getElementById('legend') : null);
        if (!legendEl) return;

        if (isDiff) {
          let t1 = 0.04, t2 = 0.15;
          if (mode === 's2_wvp') { t1 = 0.2; t2 = 0.7; }
          else if (mode === 'pm25_proxy') { t1 = 5; t2 = 20; }
          const fmt = v => Number(v).toFixed(v < 0.1 ? 2 : 1);
          legendEl.innerHTML = `<strong>Δ ${AQ_METRICS[mode].shortLabel} (Change)</strong>
        <div class="legend-item"><div class="color-box" style="background:#af142d;"></div>Strong Increase / Plume (+${fmt(t2)}+)</div>
        <div class="legend-item"><div class="color-box" style="background:#f08c37;"></div>Moderate Increase (+${fmt(t1)} to +${fmt(t2)})</div>
        <div class="legend-item"><div class="color-box" style="background:#e1e1e1;"></div>Minor Change (-${fmt(t1)} to +${fmt(t1)})</div>
        <div class="legend-item"><div class="color-box" style="background:#5ab9d7;"></div>Moderate Decrease (-${fmt(t2)} to -${fmt(t1)})</div>
        <div class="legend-item"><div class="color-box" style="background:#146eb4;"></div>Strong Decrease / Clearing (&lt; -${fmt(t2)})</div>`;
          legendEl.style.display = 'flex';
          return;
        }

        const def = AQ_METRICS[mode];
        if (typeof host.ensureLegendStretch === 'function' && typeof host.customLegendMarkup === 'function' && typeof host.updateLegendStretchUI === 'function') {
          host.ensureLegendStretch(mode, host.activeRenderedState?.raw?.indexGrid);
          legendEl.innerHTML = `<strong>${def.shortLabel} — ${def.units}</strong>` +
            host.customLegendMarkup(mode) +
            `<p class="small-note">${def.description}</p>` +
            host.updateLegendStretchUI(mode, isDiff);
        } else {
          legendEl.innerHTML = `<strong>${def.shortLabel} Scale</strong>` +
            def.legendItems.map(([col, lbl]) => `<div class="legend-item"><div class="color-box" style="background:${col};"></div>${lbl}</div>`).join('');
        }
        legendEl.style.display = 'flex';
      };
      host.updateLegend._aqWrapped = true;
    }

    // 5. Wrap `getAssetBandInfo` so `aot` and `wvp` use Sen2Cor quantification (scale=0.001, offset=0)
    // when STAC `raster:bands` metadata is omitted by a provider.
    if (typeof host.getAssetBandInfo === 'function' && !host.getAssetBandInfo._aqWrapped) {
      const origGetAssetBandInfo = host.getAssetBandInfo;
      host.getAssetBandInfo = function (asset, fallback) {
        const href = String(asset?.href || '').toLowerCase();
        const title = String(asset?.title || '').toLowerCase();
        const isAtmosphericAsset = /\b(aot|wvp)\b/.test(href) || /aerosol|water\s*vapou?r/.test(title);
        const defaultFallback = isAtmosphericAsset
          ? { scale: 0.001, offset: 0.0, nodata: 0 }
          : fallback;
        return origGetAssetBandInfo.call(this, asset, defaultFallback);
      };
      host.getAssetBandInfo._aqWrapped = true;
    }

    // 4. Wrap `getNativeResolution` so `aot` and `wvp` default to 20m
    if (typeof host.getNativeResolution === 'function' && !host.getNativeResolution._aqWrapped) {
      const origGetNativeRes = host.getNativeResolution;
      host.getNativeResolution = function (asset, key) {
        if (key === 'aot' || key === 'wvp') {
          const val = Number(asset?.['raster:bands']?.[0]?.spatial_resolution);
          return Number.isFinite(val) && val > 0 ? val : 20;
        }
        return origGetNativeRes.call(this, asset, key);
      };
      host.getNativeResolution._aqWrapped = true;
    }

    // 5. Wrap `calculateIndexValue` to compute Air Quality metrics
    if (typeof host.calculateIndexValue === 'function' && !host.calculateIndexValue._aqWrapped) {
      const origCalcIndex = host.calculateIndexValue;
      host.calculateIndexValue = function (mode, bands) {
        if (Object.prototype.hasOwnProperty.call(AQ_METRICS, mode)) {
          return calculateAqPixel(mode, bands);
        }
        return origCalcIndex.call(this, mode, bands);
      };
      host.calculateIndexValue._aqWrapped = true;
    }

    // 6. Wrap `colorizeIndex` to render Air Quality palettes
    if (typeof host.colorizeIndex === 'function' && !host.colorizeIndex._aqWrapped) {
      const origColorize = host.colorizeIndex;
      host.colorizeIndex = function (val, mode, isDiff = false) {
        if (Object.prototype.hasOwnProperty.call(AQ_METRICS, mode)) {
          const scaledVal = (!isDiff && typeof host.transformedLegendValue === 'function')
            ? host.transformedLegendValue(val, mode)
            : val;
          return colorizeAqMetric(scaledVal, mode, isDiff);
        }
        return origColorize.call(this, val, mode, isDiff);
      };
      host.colorizeIndex._aqWrapped = true;
    }

    // 7. Inject options into `<select>` elements if running in browser DOM
    if (typeof document !== 'undefined') {
      const selectIds = ['outputMode', 'modePanel2', 'modePanel3', 'modePanel4'];
      for (const id of selectIds) {
        const selectEl = document.getElementById(id);
        if (!selectEl || selectEl.querySelector('optgroup[data-aq-module="true"]')) continue;
        const group = document.createElement('optgroup');
        group.label = 'Air Quality & Atmospheric Plumes';
        group.dataset.aqModule = 'true';
        for (const def of Object.values(AQ_METRICS)) {
          const opt = document.createElement('option');
          opt.value = def.id;
          opt.textContent = `${def.shortLabel} — ${def.name}`;
          group.appendChild(opt);
        }
        selectEl.appendChild(group);
      }
    }

    return true;
  }

  return {
    AQ_METRICS,
    calculateAqPixel,
    normalizeSen2CorAtmosphericGrid,
    computeMetricGrid,
    diagnoseAirQualityGrid,
    convertTraceGasUnits,
    colorizeAqMetric,
    registerWithSentiApp
  };
});