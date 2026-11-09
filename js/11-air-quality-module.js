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
    },
    aerosol_type: {
      id: 'aerosol_type',
      name: 'Aerosol Classification (Smoke vs Dust vs Clear)',
      shortLabel: 'Aerosol Type',
      bands: ['coastal', 'blue', 'swir16'],
      nativeResolutionM: 60,
      units: 'class (0=Clear, 1=Smoke, 2=Dust, 3=Mixed)',
      scale: { min: 0, max: 3, breaks: [0.5, 1.5, 2.5] },
      legendItems: [
        ['#dc2626', 'Mixed Smoke & Dust Plume (3)'],
        ['#d97706', 'Coarse Mineral Dust / Soil (2)'],
        ['#eb732d', 'Fine Smoke / Photochemical Haze (1)'],
        ['#2891c3', 'Clean / Background (0)']
      ],
      isProxy: true,
      description: 'Discriminates aerosol plume composition: fine combustion smoke vs coarse mineral dust using the combined ratio of Coastal/Blue Rayleigh scattering and SWIR16 reflectance.'
    }
  };

  /**
   * Catalog of supported Sentinel-5P Level-2 NetCDF trace-gas products in the
   * Microsoft Planetary Computer STAC catalog (`sentinel-5p-l2-netcdf`).
   */
  const S5P_PRODUCTS = {
    no2: {
      id: 'no2',
      name: 'Nitrogen Dioxide (NO₂) Tropospheric Column',
      shortLabel: 'NO₂',
      stacProduct: 'no2',
      assetKey: 'no2',
      h5Var: 'PRODUCT/nitrogendioxide_tropospheric_column',
      displayUnit: 'µmol/m²',
      multiplier: 1e6,
      minQa: 0.50,
      scale: { min: 0, max: 150, breaks: [15, 35, 65, 100] },
      legendItems: [
        ['#800026', 'Severe (> 100 µmol/m²)'],
        ['#bd0026', 'High (65–100)'],
        ['#e31a1c', 'Elevated (35–65)'],
        ['#fd8d3c', 'Moderate (15–35)'],
        ['#fecc5c', 'Low / Background (< 15)']
      ]
    },
    so2: {
      id: 'so2',
      name: 'Sulfur Dioxide (SO₂) Total Vertical Column',
      shortLabel: 'SO₂',
      stacProduct: 'so2',
      assetKey: 'so2',
      h5Var: 'PRODUCT/sulfurdioxide_total_vertical_column',
      displayUnit: 'µmol/m²',
      multiplier: 1e6,
      minQa: 0.50,
      scale: { min: 0, max: 500, breaks: [50, 120, 250, 400] },
      legendItems: [
        ['#49006a', 'Volcanic / Extreme (> 400 µmol/m²)'],
        ['#7a0177', 'Heavy Plume (250–400)'],
        ['#ae017e', 'Elevated (120–250)'],
        ['#f768a1', 'Moderate (50–120)'],
        ['#fcc5c0', 'Background (< 50)']
      ]
    },
    co: {
      id: 'co',
      name: 'Carbon Monoxide (CO) Total Column',
      shortLabel: 'CO',
      stacProduct: 'co',
      assetKey: 'co',
      h5Var: 'PRODUCT/carbonmonoxide_total_column',
      displayUnit: 'mmol/m²',
      multiplier: 1e3,
      minQa: 0.50,
      scale: { min: 15, max: 60, breaks: [22, 30, 38, 48] },
      legendItems: [
        ['#67000d', 'Dense Combustion / Smoke (> 48 mmol/m²)'],
        ['#a50f15', 'Elevated (38–48)'],
        ['#ef3b2c', 'Moderate (30–38)'],
        ['#fb6a4a', 'Low-Moderate (22–30)'],
        ['#fc9272', 'Clean Column (< 22)']
      ]
    },
    o3: {
      id: 'o3',
      name: 'Ozone (O₃) Total Vertical Column',
      shortLabel: 'O₃',
      stacProduct: 'o3',
      assetKey: 'o3',
      h5Var: 'PRODUCT/ozone_total_vertical_column',
      displayUnit: 'Dobson Units (DU)',
      multiplier: 2241.15,
      minQa: 0.50,
      scale: { min: 220, max: 420, breaks: [260, 300, 340, 380] },
      legendItems: [
        ['#08306b', 'High Column (> 380 DU)'],
        ['#08519c', 'Above Normal (340–380)'],
        ['#2171b5', 'Typical Column (300–340)'],
        ['#4292c6', 'Low Column (260–300)'],
        ['#6baed6', 'Depleted / Ozone Hole (< 260)']
      ]
    },
    ch4: {
      id: 'ch4',
      name: 'Methane (CH₄) Mixing Ratio (Bias Corrected)',
      shortLabel: 'CH₄',
      stacProduct: 'ch4',
      assetKey: 'ch4',
      h5Var: 'PRODUCT/methane_mixing_ratio_bias_corrected',
      displayUnit: 'ppb',
      multiplier: 1.0,
      minQa: 0.50,
      scale: { min: 1800, max: 2000, breaks: [1850, 1890, 1930, 1965] },
      legendItems: [
        ['#7f0000', 'Super-Emitter Plume (> 1965 ppb)'],
        ['#b30000', 'High (1930–1965)'],
        ['#d7301f', 'Elevated (1890–1930)'],
        ['#ef6548', 'Moderate (1850–1890)'],
        ['#fdbb84', 'Background (< 1850)']
      ]
    },
    hcho: {
      id: 'hcho',
      name: 'Formaldehyde (HCHO) Tropospheric Column',
      shortLabel: 'HCHO',
      stacProduct: 'hcho',
      assetKey: 'hcho',
      h5Var: 'PRODUCT/formaldehyde_tropospheric_vertical_column',
      displayUnit: 'µmol/m²',
      multiplier: 1e6,
      minQa: 0.50,
      scale: { min: 0, max: 300, breaks: [40, 90, 150, 220] },
      legendItems: [
        ['#54278f', 'Severe VOC / Pyrolysis (> 220 µmol/m²)'],
        ['#756bb1', 'High Biogenic/Industrial (150–220)'],
        ['#9e9ac8', 'Elevated (90–150)'],
        ['#bcbddc', 'Moderate (40–90)'],
        ['#dadaeb', 'Background (< 40)']
      ]
    },
    aer_ai: {
      id: 'aer_ai',
      name: 'UV Aerosol Index (AER_AI 354/388nm)',
      shortLabel: 'UVAI',
      stacProduct: 'aer-ai',
      assetKey: 'aer-ai',
      h5Var: 'PRODUCT/aerosol_index_354_388',
      displayUnit: 'UVAI',
      multiplier: 1.0,
      minQa: 0.50,
      scale: { min: -1.5, max: 4.0, breaks: [-0.2, 0.5, 1.5, 2.5] },
      legendItems: [
        ['#7a0177', 'Intense Absorbing Smoke/Dust (> 2.5)'],
        ['#ae017e', 'Dense Absorbing Aerosol (1.5–2.5)'],
        ['#f768a1', 'Elevated UVAI (0.5–1.5)'],
        ['#74a9cf', 'Scattering / Weak Absorbing (-0.2–0.5)'],
        ['#0570b0', 'Pure Rayleigh / Non-absorbing (< -0.2)']
      ]
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

      case 'aerosol_type': {
        const coastal = b[0], blue = b[1], swir16 = b[2];
        if (coastal <= 0 || blue <= 0 || swir16 <= 0) return NaN;
        const asi = (coastal - blue) / (coastal + blue);
        const cdi = (swir16 - coastal) / (swir16 + coastal);
        if (!Number.isFinite(asi) || !Number.isFinite(cdi)) return NaN;
        if (asi >= 0.08 && cdi >= 0.05) return 3; // Mixed Smoke & Dust
        if (cdi >= 0.10 && asi < 0.12) return 2; // Coarse Mineral Dust
        if (asi >= 0.08 && cdi < 0.05) return 1; // Fine Smoke / Photochemical Haze
        return 0; // Clean / Background
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
  // 4. Sentinel-5P (TROPOMI) Trace-Gas Conversion & Swath-to-Grid Engine
  // ============================================================================

  /**
   * Converts Sentinel-5P TROPOMI trace-gas column densities between mol/m^2,
   * molecules/cm^2, and Dobson Units (DU).
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

  let h5wasmLoadingPromise = null;

  /**
   * Lazy loader for the h5wasm WebAssembly HDF5 library.
   * Loads the script if not already present and awaits window.h5wasm.ready.
   *
   * @returns {Promise<Object>} The initialized window.h5wasm instance
   */
  async function ensureH5Wasm() {
    if (typeof window === 'undefined') {
      if (typeof globalThis !== 'undefined' && globalThis.h5wasm && globalThis.h5wasm.ready) {
        await globalThis.h5wasm.ready;
        return globalThis.h5wasm;
      }
      try {
        const mod = require('h5wasm');
        if (mod && mod.ready) await mod.ready;
        return mod;
      } catch (_) {
        throw new Error('ensureH5Wasm can only be used in a browser environment or in Node with h5wasm installed');
      }
    }
    if (window.h5wasm && window.h5wasm.ready) {
      await window.h5wasm.ready;
      return window.h5wasm;
    }
    if (h5wasmLoadingPromise) return h5wasmLoadingPromise;

    h5wasmLoadingPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector('script[src*="h5wasm"]');
      if (existingScript && window.h5wasm && window.h5wasm.ready) {
        window.h5wasm.ready.then(() => resolve(window.h5wasm)).catch(reject);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/h5wasm@0.7.8/dist/iife/h5wasm.js';
      script.async = true;
      script.onload = () => {
        if (!window.h5wasm || !window.h5wasm.ready) {
          reject(new Error('h5wasm loaded but window.h5wasm.ready was not found'));
          return;
        }
        window.h5wasm.ready.then(() => resolve(window.h5wasm)).catch(reject);
      };
      script.onerror = () => reject(new Error('Failed to load h5wasm from CDN'));
      document.head.appendChild(script);
    });

    return h5wasmLoadingPromise;
  }

  /**
   * Pure client-side reader and gridding engine for Sentinel-5P Level-2 NetCDF/HDF5 swath files.
   * Uses h5wasm WebAssembly to unpack swath variables, filters footprints by QA and AOI,
   * and splats them onto a regular WGS84 grid using a Gaussian kernel of radius ~0.065 degrees.
   *
   * @param {ArrayBuffer} arrayBuffer - Raw NetCDF4/HDF5 file buffer
   * @param {string} gasId - Product ID (e.g., 'no2', 'so2', 'co', 'o3', 'ch4', 'hcho', 'aer_ai')
   * @param {number[]} bbox - [west, south, east, north]
   * @param {number} [gridWidth=180] - Output grid width
   * @param {number} [gridHeight=180] - Output grid height
   * @returns {Promise<Object>} Gridded result containing { indexGrid, width, height, bbox, gasId, mean, min, max, validCells, matchedFootprints, displayUnit, multiplier }
   */
  async function gridS5pNetCdfBuffer(arrayBuffer, gasId, bbox, gridWidth = 180, gridHeight = 180) {
    const productDef = S5P_PRODUCTS[gasId];
    if (!productDef) {
      throw new Error(`Unsupported Sentinel-5P product ID: "${gasId}"`);
    }

    const h5wasm = await ensureH5Wasm();
    const tempFilename = `s5p_${gasId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.nc`;
    const FS = h5wasm.FS;
    FS.writeFile(tempFilename, new Uint8Array(arrayBuffer));

    let f = null;
    try {
      f = new h5wasm.File(tempFilename, 'r');

      const getDatasetValues = (path) => {
        const node = f.get(path);
        if (!node) throw new Error(`NetCDF dataset path not found: ${path}`);
        const data = node.value;
        const attrs = node.attrs || {};
        return { data, attrs, node };
      };

      const latObj = getDatasetValues('PRODUCT/latitude');
      const lonObj = getDatasetValues('PRODUCT/longitude');
      const qaObj = getDatasetValues('PRODUCT/qa_value');
      const gasObj = getDatasetValues(productDef.h5Var);

      const lats = latObj.data;
      const lons = lonObj.data;
      const qas = qaObj.data;
      const vals = gasObj.data;

      // Handle QA scale factor if needed (normalize byte QA [0, 100] to [0.0, 1.0])
      let qaScale = 1.0;
      if (qaObj.attrs && qaObj.attrs.scale_factor) {
        const sf = qaObj.attrs.scale_factor.value;
        if (Number.isFinite(sf) && sf > 0 && sf < 1.0) qaScale = sf;
      }

      const [west, south, east, north] = bbox;
      const margin = 0.12;
      const minLon = west - margin, maxLon = east + margin;
      const minLat = south - margin, maxLat = north + margin;

      const totalCells = gridWidth * gridHeight;
      const outGrid = new Float32Array(totalCells);
      const weightGrid = new Float32Array(totalCells);

      const lonSpan = east - west;
      const latSpan = north - south;
      const dLon = lonSpan / gridWidth;
      const dLat = latSpan / gridHeight;

      // TROPOMI footprints are ~3.5 x 5.5 km (~0.06 deg).
      // We splat with a Gaussian kernel of radius ~0.065 degrees.
      const splatRadiusDeg = 0.065;
      const splatRadiusX = Math.max(1, Math.ceil(splatRadiusDeg / Math.abs(dLon || 0.01)));
      const splatRadiusY = Math.max(1, Math.ceil(splatRadiusDeg / Math.abs(dLat || 0.01)));
      const invR2 = 1.0 / (splatRadiusDeg * splatRadiusDeg);

      let matchedFootprints = 0;
      const numFootprints = vals.length;

      for (let i = 0; i < numFootprints; i++) {
        const vRaw = vals[i];
        if (!Number.isFinite(vRaw) || Math.abs(vRaw) > 1e30 || vRaw <= -999) continue;

        let qa = qas[i] * qaScale;
        if (qa > 1.5) qa *= 0.01;
        if (qa < productDef.minQa) continue;

        const lat = lats[i];
        const lon = lons[i];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;

        matchedFootprints++;
        const scaledVal = vRaw * productDef.multiplier;

        // Map lon/lat to floating point grid cell coordinates
        const gx = ((lon - west) / lonSpan) * gridWidth;
        const gy = ((north - lat) / latSpan) * gridHeight;

        const minGx = Math.max(0, Math.floor(gx - splatRadiusX));
        const maxGx = Math.min(gridWidth - 1, Math.ceil(gx + splatRadiusX));
        const minGy = Math.max(0, Math.floor(gy - splatRadiusY));
        const maxGy = Math.min(gridHeight - 1, Math.ceil(gy + splatRadiusY));

        for (let y = minGy; y <= maxGy; y++) {
          const cellLat = north - (y + 0.5) * dLat;
          const dy = cellLat - lat;
          for (let x = minGx; x <= maxGx; x++) {
            const cellLon = west + (x + 0.5) * dLon;
            const dx = cellLon - lon;
            const dist2 = dx * dx + dy * dy;
            const normDist2 = dist2 * invR2;
            if (normDist2 <= 2.25) { // within 1.5 sigma
              const w = Math.exp(-normDist2 * 2.5);
              const idx = y * gridWidth + x;
              outGrid[idx] += scaledVal * w;
              weightGrid[idx] += w;
            }
          }
        }
      }

      let validCells = 0;
      let sum = 0, min = Infinity, max = -Infinity;

      for (let i = 0; i < totalCells; i++) {
        const w = weightGrid[i];
        if (w > 1e-4) {
          const val = outGrid[i] / w;
          outGrid[i] = val;
          validCells++;
          sum += val;
          if (val < min) min = val;
          if (val > max) max = val;
        } else {
          outGrid[i] = NaN;
        }
      }

      return {
        gasId,
        productDef,
        bbox: bbox.slice(),
        width: gridWidth,
        height: gridHeight,
        grid: outGrid,
        indexGrid: outGrid,
        validCells,
        matchedFootprints,
        mean: validCells > 0 ? sum / validCells : NaN,
        min: validCells > 0 ? min : NaN,
        max: validCells > 0 ? max : NaN,
        displayUnit: productDef.displayUnit,
        multiplier: productDef.multiplier
      };
    } finally {
      if (f) {
        try { f.close(); } catch (_) {}
      }
      try { FS.unlink(tempFilename); } catch (_) {}
    }
  }

  /**
   * Searches the Microsoft Planetary Computer STAC catalog for Sentinel-5P Level-2 NetCDF orbits.
   *
   * @param {number[]} bbox - [west, south, east, north]
   * @param {string} gasId - Product ID key in S5P_PRODUCTS
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @param {number} [limit=50]
   * @returns {Promise<Array>} Array of STAC features matching the product and AOI
   */
  async function searchS5pStac(bbox, gasId, startDate, endDate, limit = 50) {
    const productDef = S5P_PRODUCTS[gasId];
    if (!productDef) throw new Error(`Unknown Sentinel-5P product: ${gasId}`);

    const startIso = startDate.includes('T') ? startDate : `${startDate}T00:00:00Z`;
    const endIso = endDate.includes('T') ? endDate : `${endDate}T23:59:59Z`;

    const prodCandidates = [
      productDef.stacProduct,
      productDef.id,
      productDef.id.replace('_', '-'),
      `L2__${productDef.id.toUpperCase().replace('-', '_')}`
    ];

    const body = {
      collections: ['sentinel-5p-l2-netcdf'],
      bbox: bbox,
      datetime: `${startIso}/${endIso}`,
      query: {
        's5p:product_name': { in: prodCandidates }
      },
      limit: limit
    };

    const res = await fetch('https://planetarycomputer.microsoft.com/api/stac/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`Planetary Computer STAC search failed (HTTP ${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    const features = (data.features || []).filter(feat => {
      return Boolean(feat.assets && feat.assets[productDef.assetKey] && feat.assets[productDef.assetKey].href);
    });

    // Sort newest first
    features.sort((a, b) => {
      const ta = new Date(a.properties.datetime || a.id).getTime();
      const tb = new Date(b.properties.datetime || b.id).getTime();
      return tb - ta;
    });

    return features;
  }

  /**
   * Signs a Planetary Computer asset URL using the SAS signing API and fetches its ArrayBuffer.
   *
   * @param {string} rawHref - Planetary Computer raw blob URL
   * @returns {Promise<ArrayBuffer>}
   */
  async function signAndFetchS5pBuffer(rawHref) {
    const signUrl = `https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=${encodeURIComponent(rawHref)}`;
    const signRes = await fetch(signUrl);
    if (!signRes.ok) {
      throw new Error(`Planetary Computer SAS signing failed (HTTP ${signRes.status})`);
    }
    const signedData = await signRes.json();
    const signedHref = signedData.href || rawHref;

    const dataRes = await fetch(signedHref);
    if (!dataRes.ok) {
      throw new Error(`Failed to fetch Sentinel-5P NetCDF data (HTTP ${dataRes.status})`);
    }
    return dataRes.arrayBuffer();
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

      case 'aerosol_type':
        if (val >= 2.5) return [220, 38, 38, 240];  // #dc2626 Mixed Smoke & Dust Plume (3)
        if (val >= 1.5) return [217, 119, 6, 240];  // #d97706 Coarse Mineral Dust / Soil (2)
        if (val >= 0.5) return [235, 115, 45, 240]; // #eb732d Fine Smoke / Photochemical Haze (1)
        return [40, 145, 195, 200];                 // #2891c3 Clean / Background (0)

      // Sentinel-5P TROPOMI trace gas products
      case 'no2':
        // breaks: [15, 35, 65, 100]
        if (val < 15) return [254, 204, 92, 220];    // #fecc5c Low / Background
        if (val < 35) return [253, 141, 60, 230];    // #fd8d3c Moderate
        if (val < 65) return [227, 26, 28, 235];     // #e31a1c Elevated
        if (val < 100) return [189, 0, 38, 240];     // #bd0026 High
        return [128, 0, 38, 245];                    // #800026 Severe

      case 'so2':
        // breaks: [50, 120, 250, 400]
        if (val < 50) return [252, 197, 192, 215];   // #fcc5c0 Background
        if (val < 120) return [247, 104, 161, 230];  // #f768a1 Moderate
        if (val < 250) return [174, 1, 126, 235];    // #ae017e Elevated
        if (val < 400) return [122, 1, 119, 240];    // #7a0177 Heavy Plume
        return [73, 0, 106, 245];                    // #49006a Volcanic / Extreme

      case 'co':
        // breaks: [22, 30, 38, 48]
        if (val < 22) return [252, 146, 114, 215];   // #fc9272 Clean Column
        if (val < 30) return [251, 106, 74, 230];    // #fb6a4a Low-Moderate
        if (val < 38) return [239, 59, 44, 235];     // #ef3b2c Moderate
        if (val < 48) return [165, 15, 21, 240];     // #a50f15 Elevated
        return [103, 0, 13, 245];                    // #67000d Dense Combustion

      case 'o3':
        // breaks: [260, 300, 340, 380]
        if (val < 260) return [107, 174, 214, 220];  // #6baed6 Depleted
        if (val < 300) return [66, 146, 198, 230];   // #4292c6 Low Column
        if (val < 340) return [33, 113, 181, 235];   // #2171b5 Typical Column
        if (val < 380) return [8, 81, 156, 240];     // #08519c Above Normal
        return [8, 48, 107, 245];                    // #08306b High Column

      case 'ch4':
        // breaks: [1850, 1890, 1930, 1965]
        if (val < 1850) return [253, 187, 132, 220]; // #fdbb84 Background
        if (val < 1890) return [239, 101, 72, 230];  // #ef6548 Moderate
        if (val < 1930) return [215, 48, 31, 235];   // #d7301f Elevated
        if (val < 1965) return [179, 0, 0, 240];     // #b30000 High
        return [127, 0, 0, 245];                     // #7f0000 Super-Emitter Plume

      case 'hcho':
        // breaks: [40, 90, 150, 220]
        if (val < 40) return [218, 218, 235, 215];   // #dadaeb Background
        if (val < 90) return [188, 189, 220, 230];   // #bcbddc Moderate
        if (val < 150) return [158, 154, 200, 235];  // #9e9ac8 Elevated
        if (val < 220) return [117, 107, 177, 240];  // #756bb1 High
        return [84, 39, 143, 245];                   // #54278f Severe VOC

      case 'aer_ai':
        // breaks: [-0.2, 0.5, 1.5, 2.5]
        if (val < -0.2) return [5, 112, 176, 220];   // #0570b0 Pure Rayleigh
        if (val < 0.5) return [116, 169, 207, 230];  // #74a9cf Scattering
        if (val < 1.5) return [247, 104, 161, 235];  // #f768a1 Elevated UVAI
        if (val < 2.5) return [174, 1, 126, 240];    // #ae017e Dense Absorbing Aerosol
        return [122, 1, 119, 245];                   // #7a0177 Intense Absorbing Smoke/Dust

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

    // 8. Wire Sentinel-5P (TROPOMI) Trace Gas Explorer panel in index.html
    if (typeof document !== 'undefined') {
      const s5pGasSelect = document.getElementById('s5pGasSelect');
      const s5pSceneSelect = document.getElementById('s5pSceneSelect');
      const s5pSearchBtn = document.getElementById('s5pSearchBtn');
      const s5pRenderBtn = document.getElementById('s5pRenderBtn');
      const s5pClearBtn = document.getElementById('s5pClearBtn');
      const s5pExportTiffBtn = document.getElementById('s5pExportTiffBtn');
      const s5pStatus = document.getElementById('s5pStatus');
      const s5pLegend = document.getElementById('s5pLegend');
      const s5pLocalFileInput = document.getElementById('s5pLocalFileInput');
      const s5pRenderLocalBtn = document.getElementById('s5pRenderLocalBtn');

      if (s5pGasSelect && !s5pGasSelect._aqInit) {
        s5pGasSelect._aqInit = true;
        s5pGasSelect.innerHTML = '';
        for (const [key, p] of Object.entries(S5P_PRODUCTS)) {
          const opt = document.createElement('option');
          opt.value = key;
          opt.textContent = `${p.shortLabel} — ${p.name} (${p.displayUnit})`;
          s5pGasSelect.appendChild(opt);
        }
      }

      let activeS5pOverlay = null;
      let activeS5pGridded = null;
      let s5pFeatures = [];

      function clearS5p() {
        const mapInst = (typeof host.map !== 'undefined' && host.map) ? host.map : (typeof window !== 'undefined' ? window.map : null);
        if (activeS5pOverlay && mapInst && mapInst.hasLayer(activeS5pOverlay)) {
          mapInst.removeLayer(activeS5pOverlay);
        }
        activeS5pOverlay = null;
        activeS5pGridded = null;
        if (s5pClearBtn) s5pClearBtn.disabled = true;
        if (s5pExportTiffBtn) s5pExportTiffBtn.disabled = true;
        if (s5pLegend) {
          s5pLegend.style.display = 'none';
          s5pLegend.innerHTML = '';
        }
        if (s5pStatus) s5pStatus.textContent = 'S5P overlay cleared.';
      }

      host.clearS5pOverlay = clearS5p;
      if (typeof window !== 'undefined') {
        window.clearS5pOverlay = clearS5p;
      }

      function renderS5pLegend(gasId, gridded) {
        if (!s5pLegend) return;
        const p = S5P_PRODUCTS[gasId];
        if (!p) return;
        const meanStr = Number.isFinite(gridded?.mean) ? gridded.mean.toFixed(2) : '—';
        const minStr = Number.isFinite(gridded?.min) ? gridded.min.toFixed(2) : '—';
        const maxStr = Number.isFinite(gridded?.max) ? gridded.max.toFixed(2) : '—';
        const matched = gridded?.matchedFootprints ?? 0;

        let html = `<div style="font-weight:650;margin-bottom:6px;color:#4daafc;">Sentinel-5P ${p.shortLabel} (${p.name})</div>`;
        html += `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;font-size:11.5px;color:#ccc;">`;
        html += `<span>Mean: <strong>${meanStr} ${p.displayUnit}</strong></span>`;
        html += `<span>Range: [${minStr}, ${maxStr}]</span>`;
        html += `<span>TROPOMI Footprints: ${matched}</span>`;
        html += `<span>Filter: <code>qa_value &ge; ${p.minQa.toFixed(2)}</code></span>`;
        html += `</div>`;
        html += `<div style="display:flex;gap:6px;flex-wrap:wrap;">`;
        for (const [col, lbl] of p.legendItems) {
          html += `<div style="display:flex;align-items:center;margin-right:8px;font-size:11px;">`;
          html += `<div style="width:12px;height:12px;background:${col};margin-right:5px;border:1px solid #777;border-radius:2px;"></div>`;
          html += `<span>${lbl}</span></div>`;
        }
        html += `</div>`;
        s5pLegend.innerHTML = html;
        s5pLegend.style.display = 'block';
      }

      function displayGriddedS5p(gridded, sceneDateStr) {
        const mapInst = (typeof host.map !== 'undefined' && host.map) ? host.map : (typeof window !== 'undefined' ? window.map : null);
        if (!mapInst) throw new Error('Leaflet map instance is unavailable');

        if (activeS5pOverlay && mapInst.hasLayer(activeS5pOverlay)) {
          mapInst.removeLayer(activeS5pOverlay);
        }

        const [west, south, east, north] = gridded.bbox;
        const w = gridded.width, h = gridded.height;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        const imgData = ctx.createImageData(w, h);

        for (let idx = 0; idx < w * h; idx++) {
          const val = gridded.indexGrid[idx];
          const rgba = colorizeAqMetric(val, gridded.gasId, false);
          const p = idx * 4;
          imgData.data[p] = rgba[0];
          imgData.data[p + 1] = rgba[1];
          imgData.data[p + 2] = rgba[2];
          imgData.data[p + 3] = rgba[3];
        }
        ctx.putImageData(imgData, 0, 0);

        const dataUrl = c.toDataURL();
        const opacitySlider = document.getElementById('opacitySlider');
        const opVal = opacitySlider ? Number(opacitySlider.value) : 0.88;

        const bounds = L.latLngBounds([[south, west], [north, east]]);
        if (typeof mapInst.getPane === 'function' && !mapInst.getPane('s5pPane') && typeof mapInst.createPane === 'function') {
          mapInst.createPane('s5pPane');
          mapInst.getPane('s5pPane').style.zIndex = '365';
        }
        activeS5pOverlay = L.imageOverlay(dataUrl, bounds, {
          opacity: opVal,
          pane: 's5pPane'
        }).addTo(mapInst);

        activeS5pGridded = gridded;
        activeS5pGridded.sceneDateStr = sceneDateStr;

        if (s5pClearBtn) s5pClearBtn.disabled = false;
        if (s5pExportTiffBtn) s5pExportTiffBtn.disabled = false;
        renderS5pLegend(gridded.gasId, gridded);
      }

      if (s5pClearBtn) {
        s5pClearBtn.addEventListener('click', clearS5p);
      }

      if (s5pSearchBtn) {
        s5pSearchBtn.addEventListener('click', async () => {
          const bbox = (typeof host.drawnBbox !== 'undefined' && host.drawnBbox) ? host.drawnBbox : (typeof window !== 'undefined' ? window.drawnBbox : null);
          if (!bbox) {
            if (s5pStatus) s5pStatus.textContent = 'Draw an AOI rectangle on the map first.';
            return;
          }
          const gasId = s5pGasSelect ? s5pGasSelect.value : 'no2';
          const startDate = document.getElementById('startDate')?.value || '2023-01-01';
          const endDate = document.getElementById('endDate')?.value || '2023-12-31';

          s5pSearchBtn.disabled = true;
          if (s5pStatus) s5pStatus.textContent = `Searching Planetary Computer for S5P ${gasId.toUpperCase()} orbits over AOI...`;

          try {
            s5pFeatures = await searchS5pStac(bbox, gasId, startDate, endDate, 50);
            if (!s5pFeatures || s5pFeatures.length === 0) {
              if (s5pStatus) s5pStatus.textContent = `No Sentinel-5P ${gasId.toUpperCase()} acquisitions found in this AOI and date range.`;
              if (s5pSceneSelect) {
                s5pSceneSelect.innerHTML = '<option value="">No matching orbits found</option>';
                s5pSceneSelect.disabled = true;
              }
              if (s5pRenderBtn) s5pRenderBtn.disabled = true;
              return;
            }

            if (s5pSceneSelect) {
              s5pSceneSelect.innerHTML = '';
              s5pFeatures.forEach((feat, idx) => {
                const opt = document.createElement('option');
                opt.value = String(idx);
                const dt = feat.properties.datetime ? feat.properties.datetime.replace('T', ' ').substring(0, 19) : feat.id;
                opt.textContent = `${dt} (${feat.id.substring(0, 24)}…)`;
                s5pSceneSelect.appendChild(opt);
              });
              s5pSceneSelect.disabled = false;
            }
            if (s5pRenderBtn) s5pRenderBtn.disabled = false;
            if (s5pStatus) s5pStatus.textContent = `Found ${s5pFeatures.length} S5P orbit(s). Click "Load & Grid Gas Map" to download and rasterize.`;
          } catch (err) {
            if (s5pStatus) s5pStatus.textContent = `Search error: ${err.message}`;
          } finally {
            s5pSearchBtn.disabled = false;
          }
        });
      }

      if (s5pRenderBtn) {
        s5pRenderBtn.addEventListener('click', async () => {
          const bbox = (typeof host.drawnBbox !== 'undefined' && host.drawnBbox) ? host.drawnBbox : (typeof window !== 'undefined' ? window.drawnBbox : null);
          if (!bbox) {
            if (s5pStatus) s5pStatus.textContent = 'Draw an AOI rectangle on the map first.';
            return;
          }
          const featIdx = s5pSceneSelect ? Number(s5pSceneSelect.value) : 0;
          const feat = s5pFeatures[featIdx];
          const gasId = s5pGasSelect ? s5pGasSelect.value : 'no2';
          const p = S5P_PRODUCTS[gasId];
          if (!feat || !p) return;

          const rawHref = feat.assets[p.assetKey]?.href;
          if (!rawHref) {
            if (s5pStatus) s5pStatus.textContent = `Asset "${p.assetKey}" missing from selected scene.`;
            return;
          }

          s5pRenderBtn.disabled = true;
          if (s5pStatus) s5pStatus.textContent = `Signing and downloading S5P ${gasId.toUpperCase()} NetCDF swath...`;

          try {
            const buf = await signAndFetchS5pBuffer(rawHref);
            if (s5pStatus) s5pStatus.textContent = `Unpacking swath via h5wasm WebAssembly and splatting ${gasId.toUpperCase()} grid...`;
            const gridded = await gridS5pNetCdfBuffer(buf, gasId, bbox, 180, 180);

            const dt = feat.properties.datetime ? feat.properties.datetime.substring(0, 10) : 'S5P';
            displayGriddedS5p(gridded, dt);
            if (s5pStatus) {
              s5pStatus.textContent = `Rendered S5P ${gasId.toUpperCase()}: ${gridded.matchedFootprints} valid footprints, mean = ${gridded.mean.toFixed(2)} ${gridded.displayUnit}.`;
            }
          } catch (err) {
            if (s5pStatus) s5pStatus.textContent = `Gridding error: ${err.message}`;
          } finally {
            s5pRenderBtn.disabled = false;
          }
        });
      }

      if (s5pRenderLocalBtn && s5pLocalFileInput) {
        s5pRenderLocalBtn.addEventListener('click', async () => {
          const bbox = (typeof host.drawnBbox !== 'undefined' && host.drawnBbox) ? host.drawnBbox : (typeof window !== 'undefined' ? window.drawnBbox : null);
          if (!bbox) {
            if (s5pStatus) s5pStatus.textContent = 'Draw an AOI rectangle on the map first.';
            return;
          }
          const file = s5pLocalFileInput.files?.[0];
          if (!file) {
            if (s5pStatus) s5pStatus.textContent = 'Please choose a local .nc / .h5 file first.';
            return;
          }
          const gasId = s5pGasSelect ? s5pGasSelect.value : 'no2';

          s5pRenderLocalBtn.disabled = true;
          if (s5pStatus) s5pStatus.textContent = `Reading local file "${file.name}"...`;

          try {
            const arrayBuffer = await file.arrayBuffer();
            if (s5pStatus) s5pStatus.textContent = `Gridding local NetCDF file over AOI with h5wasm...`;
            const gridded = await gridS5pNetCdfBuffer(arrayBuffer, gasId, bbox, 180, 180);
            displayGriddedS5p(gridded, file.name);
            if (s5pStatus) {
              s5pStatus.textContent = `Rendered local S5P ${gasId.toUpperCase()}: ${gridded.matchedFootprints} footprints, mean = ${gridded.mean.toFixed(2)} ${gridded.displayUnit}.`;
            }
          } catch (err) {
            if (s5pStatus) s5pStatus.textContent = `Local file error: ${err.message}`;
          } finally {
            s5pRenderLocalBtn.disabled = false;
          }
        });
      }

      if (s5pExportTiffBtn) {
        s5pExportTiffBtn.addEventListener('click', async () => {
          if (!activeS5pGridded) {
            if (s5pStatus) s5pStatus.textContent = 'Load and grid an S5P gas map first.';
            return;
          }
          if (typeof GeoTIFF === 'undefined' || typeof GeoTIFF.writeArrayBuffer !== 'function') {
            if (s5pStatus) s5pStatus.textContent = 'GeoTIFF.writeArrayBuffer is not available in this browser environment.';
            return;
          }

          s5pExportTiffBtn.disabled = true;
          const origText = s5pExportTiffBtn.textContent;
          s5pExportTiffBtn.textContent = 'Writing GeoTIFF…';

          try {
            const { indexGrid, width, height, bbox, gasId, sceneDateStr } = activeS5pGridded;
            const [west, south, east, north] = bbox;
            const pixelScaleX = (east - west) / width;
            const pixelScaleY = (north - south) / height;

            const exportGridClean = new Float32Array(indexGrid.length);
            for (let i = 0; i < indexGrid.length; i++) {
              exportGridClean[i] = Number.isNaN(indexGrid[i]) ? -9999 : indexGrid[i];
            }

            const metadata = {
              width,
              height,
              ModelPixelScale: [pixelScaleX, pixelScaleY, 0],
              ModelTiepoint: [0, 0, 0, west, north, 0],
              GTModelTypeGeoKey: 2, // Geographic (lat/lon)
              GeographicTypeGeoKey: 4326,
              GDAL_NODATA: '-9999',
              ImageDescription: `Sentinel-5P Level-2 ${gasId.toUpperCase()} Gridded Tropospheric Column; date=${sceneDateStr || ''}; unit=${activeS5pGridded.displayUnit}`
            };

            const tiffBuf = await GeoTIFF.writeArrayBuffer(exportGridClean, metadata);
            const blob = new Blob([tiffBuf], { type: 'image/tiff' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `s5p_${gasId}_${(sceneDateStr || 'gas').replace(/[^a-z0-9_-]/gi, '_')}.tif`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            if (s5pStatus) s5pStatus.textContent = `Exported EPSG:4326 Float32 GeoTIFF (${width}x${height}).`;
          } catch (err) {
            if (s5pStatus) s5pStatus.textContent = `GeoTIFF export error: ${err.message}`;
          } finally {
            s5pExportTiffBtn.disabled = false;
            s5pExportTiffBtn.textContent = origText;
          }
        });
      }

      // Map hover inspection hook for live trace gas readings
      const mapInst = (typeof host.map !== 'undefined' && host.map) ? host.map : (typeof window !== 'undefined' ? window.map : null);
      if (mapInst && !mapInst._s5pHoverHooked) {
        mapInst._s5pHoverHooked = true;
        mapInst.on('mousemove', (e) => {
          if (!activeS5pGridded) return;
          const { lat, lng } = e.latlng;
          const [west, south, east, north] = activeS5pGridded.bbox;
          if (lng < west || lng > east || lat < south || lat > north) return;

          const gx = Math.floor(((lng - west) / (east - west)) * activeS5pGridded.width);
          const gy = Math.floor(((north - lat) / (north - south)) * activeS5pGridded.height);
          if (gx < 0 || gx >= activeS5pGridded.width || gy < 0 || gy >= activeS5pGridded.height) return;

          const val = activeS5pGridded.indexGrid[gy * activeS5pGridded.width + gx];
          const inspectorEl = document.getElementById('inspectorText');
          if (inspectorEl) {
            const p = S5P_PRODUCTS[activeS5pGridded.gasId];
            const valStr = Number.isFinite(val) ? `${val.toFixed(2)} ${p?.displayUnit || ''}` : 'NoData';
            inspectorEl.textContent += ` | S5P ${activeS5pGridded.gasId.toUpperCase()}: ${valStr}`;
          }
        });
      }
    }

    return true;
  }

  /**
   * Loads a multi-date time-series of Sentinel-2 air quality frames.
   *
   * @param {Array<number>} bbox - [west, south, east, north]
   * @param {string} metric - AQ metric key (e.g. 'aot', 'asi', etc.)
   * @param {string} startDate - 'YYYY-MM-DD'
   * @param {string} endDate - 'YYYY-MM-DD'
   * @param {Object} [options]
   * @param {number} [options.maxCloud=40]
   * @param {number} [options.maxScenes=8]
   * @param {number} [options.width=180]
   * @param {number} [options.height=180]
   * @param {boolean} [options.maskClouds=true]
   * @returns {Promise<Array<Object>>} Standardized frame objects
   */
  async function loadSentinel2AqSeries(bbox, metric, startDate, endDate, options = {}) {
    let reader = (typeof SentiStacCogReader !== 'undefined')
      ? SentiStacCogReader
      : (typeof window !== 'undefined' ? window.SentiStacCogReader : null);
    if (!reader && typeof require === 'function') {
      try { reader = require('./core/00-stac-and-cog-reader.js'); } catch (_) {}
    }
    if (!reader) {
      throw new Error('SentiStacCogReader is not available.');
    }

    const metricKey = (metric === 'aot') ? 's2_aot' : ((metric === 'wvp') ? 's2_wvp' : ((metric === 'pm25') ? 'pm25_proxy' : metric));
    const def = AQ_METRICS[metricKey];
    if (!def) {
      throw new Error(`Unknown Air Quality metric: ${metric}`);
    }

    const maxCloud = options.maxCloud ?? 40;
    const maxScenes = options.maxScenes ?? 8;
    const width = options.width ?? 180;
    const height = options.height ?? 180;
    const maskClouds = options.maskClouds !== false;

    const items = await reader.searchSentinel2Stac(bbox, startDate, endDate, maxCloud, 100);

    const resolveAsset = (assets, b) => {
      if (!assets) return null;
      if (assets[b]?.href) return assets[b];
      const aliasMap = {
        coastal: ['B01', 'b01', 'band01', 'b1'],
        blue: ['B02', 'b02', 'band02', 'b2'],
        green: ['B03', 'b03', 'band03', 'b3'],
        red: ['B04', 'b04', 'band04', 'b4'],
        swir16: ['B11', 'b11', 'band11'],
        swir22: ['B12', 'b12', 'band12'],
        aot: ['AOT', 'aerosol'],
        wvp: ['WVP', 'water_vapour', 'water_vapor'],
        scl: ['SCL', 'scene_classification']
      };
      const aliases = aliasMap[b] || [];
      for (const al of aliases) {
        if (assets[al]?.href) return assets[al];
      }
      return null;
    };

    // Filter items containing all required bands
    const validItems = items.filter(item => {
      const assets = item?.assets || {};
      return def.bands.every(b => Boolean(resolveAsset(assets, b)));
    });

    // Deduplicate by UTC date (YYYY-MM-DD), keeping lowest-cloud tile per date
    const dateMap = new Map();
    for (const item of validItems) {
      const dt = item?.properties?.datetime || item?.id;
      const dateStr = dt ? dt.slice(0, 10) : '';
      if (!dateStr) continue;
      const cc = Number(item?.properties?.['eo:cloud_cover'] ?? 999);
      if (!dateMap.has(dateStr) || cc < (dateMap.get(dateStr).cloudCover ?? 999)) {
        dateMap.set(dateStr, { item, dateStr, cloudCover: cc });
      }
    }

    const sortedDates = Array.from(dateMap.values()).sort((a, b) => a.dateStr.localeCompare(b.dateStr));

    // Subsample evenly down to maxScenes
    let selected = sortedDates;
    if (sortedDates.length > maxScenes) {
      selected = [];
      const step = (sortedDates.length - 1) / (maxScenes - 1);
      for (let s = 0; s < maxScenes; s++) {
        const idx = Math.min(sortedDates.length - 1, Math.round(s * step));
        if (!selected.includes(sortedDates[idx])) {
          selected.push(sortedDates[idx]);
        }
      }
    }

    const frames = [];
    for (const entry of selected) {
      const { item, dateStr } = entry;
      const bandMap = {};
      for (const b of def.bands) {
        const asset = resolveAsset(item.assets, b);
        bandMap[b] = await reader.readCogBandToGrid(asset, item, bbox, width, height);
      }

      let mask = null;
      if (maskClouds) {
        mask = await reader.readCogSclMask(item, bbox, width, height);
      }

      const computed = computeMetricGrid(metricKey, bandMap, { mask });

      frames.push({
        id: item.id,
        dateStr,
        label: `${dateStr} (S2 ${def.shortLabel})`,
        grid: computed.indexGrid,
        indexGrid: computed.indexGrid,
        width,
        height,
        bbox: bbox.slice(),
        units: def.units,
        shortLabel: def.shortLabel,
        mode: metricKey,
        sensor: 's2'
      });
    }

    return frames;
  }

  /**
   * Loads a multi-date time-series of Sentinel-5P trace gas frames.
   *
   * @param {Array<number>} bbox - [west, south, east, north]
   * @param {string} gasId - S5P gas product key (e.g. 'no2', 'ch4', etc.)
   * @param {string} startDate - 'YYYY-MM-DD'
   * @param {string} endDate - 'YYYY-MM-DD'
   * @param {Object} [options]
   * @param {number} [options.maxScenes=8]
   * @param {number} [options.width=180]
   * @param {number} [options.height=180]
   * @returns {Promise<Array<Object>>} Standardized frame objects
   */
  async function loadSentinel5pSeries(bbox, gasId, startDate, endDate, options = {}) {
    const productDef = S5P_PRODUCTS[gasId];
    if (!productDef) {
      throw new Error(`Unknown Sentinel-5P product: ${gasId}`);
    }

    const maxScenes = options.maxScenes ?? 8;
    const width = options.width ?? 180;
    const height = options.height ?? 180;

    const features = await searchS5pStac(bbox, gasId, startDate, endDate, 60);

    // Sort chronological ascending
    features.sort((a, b) => {
      const ta = new Date(a.properties.datetime || a.id).getTime();
      const tb = new Date(b.properties.datetime || b.id).getTime();
      return ta - tb;
    });

    // Subsample evenly down to maxScenes
    let selected = features;
    if (features.length > maxScenes) {
      selected = [];
      const step = (features.length - 1) / (maxScenes - 1);
      for (let s = 0; s < maxScenes; s++) {
        const idx = Math.min(features.length - 1, Math.round(s * step));
        if (!selected.includes(features[idx])) {
          selected.push(features[idx]);
        }
      }
    }

    const frames = [];
    for (const feat of selected) {
      const dt = feat.properties.datetime || feat.id;
      const dateStr = dt ? dt.slice(0, 10) : '';
      const rawHref = feat.assets[productDef.assetKey].href;
      const buf = await signAndFetchS5pBuffer(rawHref);
      const gridded = await gridS5pNetCdfBuffer(buf, gasId, bbox, width, height);

      frames.push({
        id: feat.id,
        dateStr,
        label: `${dateStr} (S5P ${productDef.shortLabel || productDef.name})`,
        grid: gridded.grid || gridded.indexGrid,
        indexGrid: gridded.indexGrid || gridded.grid,
        width,
        height,
        bbox: bbox.slice(),
        units: productDef.displayUnit,
        shortLabel: productDef.shortLabel || productDef.name,
        mode: gasId,
        sensor: 's5p',
        matchedFootprints: gridded.matchedFootprints
      });
    }

    return frames;
  }

  /**
   * Performs spatial multi-sensor correlation analysis between two aligned raster grids.
   * Computes Pearson correlation coefficient r, R^2, linear regression slope/intercept,
   * and extracts representative sample pairs for scatter plot rendering.
   *
   * @param {Float32Array|Array<number>} gridA - First raster grid (e.g., S2 optical metric)
   * @param {Float32Array|Array<number>} gridB - Second raster grid (e.g., S5P trace gas)
   * @param {Object} [options]
   * @param {number} [options.maxScatterPoints=400] - Max points to sample for scatter plot
   * @returns {Object} { count, pearsonR, rSquared, slope, intercept, meanA, meanB, stdA, stdB, minA, maxA, minB, maxB, scatterPoints }
   */
  function correlateGrids(gridA, gridB, options = {}) {
    if (!gridA || !gridB) {
      throw new Error('Both gridA and gridB must be provided.');
    }
    const lenA = gridA.length;
    const lenB = gridB.length;
    if (lenA === 0 || lenB === 0) {
      return { count: 0, pearsonR: NaN, rSquared: NaN, slope: NaN, intercept: NaN, scatterPoints: [] };
    }

    let arrA = gridA;
    let arrB = gridB;
    if (lenA !== lenB) {
      const stepA = lenA / lenB;
      const resampled = new Float32Array(lenB);
      for (let i = 0; i < lenB; i++) {
        const srcIdx = Math.min(lenA - 1, Math.floor(i * stepA));
        resampled[i] = gridA[srcIdx];
      }
      arrA = resampled;
    }

    const totalCells = arrA.length;
    let count = 0;
    let sumA = 0, sumB = 0;
    let minA = Infinity, maxA = -Infinity;
    let minB = Infinity, maxB = -Infinity;

    for (let i = 0; i < totalCells; i++) {
      const a = arrA[i], b = arrB[i];
      if (Number.isFinite(a) && Number.isFinite(b)) {
        count++;
        sumA += a;
        sumB += b;
        if (a < minA) minA = a;
        if (a > maxA) maxA = a;
        if (b < minB) minB = b;
        if (b > maxB) maxB = b;
      }
    }

    if (count < 3) {
      return {
        count,
        pearsonR: NaN,
        rSquared: NaN,
        slope: NaN,
        intercept: NaN,
        meanA: count > 0 ? sumA / count : NaN,
        meanB: count > 0 ? sumB / count : NaN,
        stdA: NaN,
        stdB: NaN,
        minA: Number.isFinite(minA) ? minA : NaN,
        maxA: Number.isFinite(maxA) ? maxA : NaN,
        minB: Number.isFinite(minB) ? minB : NaN,
        maxB: Number.isFinite(maxB) ? maxB : NaN,
        scatterPoints: []
      };
    }

    const meanA = sumA / count;
    const meanB = sumB / count;

    let varA = 0, varB = 0, covAB = 0;
    for (let i = 0; i < totalCells; i++) {
      const a = arrA[i], b = arrB[i];
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const da = a - meanA;
        const db = b - meanB;
        varA += da * da;
        varB += db * db;
        covAB += da * db;
      }
    }

    const stdA = Math.sqrt(varA / count);
    const stdB = Math.sqrt(varB / count);
    const denom = Math.sqrt(varA * varB);
    const pearsonR = (denom > 1e-12) ? Math.max(-1, Math.min(1, covAB / denom)) : 0;
    const rSquared = pearsonR * pearsonR;
    const slope = (varA > 1e-12) ? covAB / varA : 0;
    const intercept = meanB - slope * meanA;

    const maxScatter = options.maxScatterPoints ?? 350;
    const scatterPoints = [];
    const stride = Math.max(1, Math.floor(count / maxScatter));
    let validSeen = 0;

    for (let i = 0; i < totalCells; i++) {
      const a = arrA[i], b = arrB[i];
      if (Number.isFinite(a) && Number.isFinite(b)) {
        if (validSeen % stride === 0 && scatterPoints.length < maxScatter) {
          scatterPoints.push({ x: Number(a.toFixed(4)), y: Number(b.toFixed(4)) });
        }
        validSeen++;
      }
    }

    return {
      count,
      pearsonR,
      rSquared,
      slope,
      intercept,
      meanA,
      meanB,
      stdA,
      stdB,
      minA,
      maxA,
      minB,
      maxB,
      scatterPoints
    };
  }

  /**
   * Fetches active in-situ ground air quality monitoring stations from the OpenAQ API
   * for a given bounding box.
   *
   * @param {number[]} bbox - [west, south, east, north]
   * @param {Object} [options] - Optional parameters: { parameter: 'pm25'|'no2'|'all', limit: number }
   * @returns {Promise<Array<Object>>} List of ground stations with recent measurements
   */
  async function fetchOpenAqStations(bbox, options = {}) {
    const [west, south, east, north] = bbox;
    const limit = options.limit || 40;
    const param = options.parameter || 'pm25';

    const url = `https://api.openaq.org/v2/latest?bbox=${west},${south},${east},${north}&parameter=${param}&limit=${limit}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      throw new Error(`OpenAQ API request failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    const results = data.results || [];

    const stations = [];
    for (const r of results) {
      const coords = r.coordinates;
      if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) continue;
      const measurements = r.measurements || [];
      const m = measurements.find(x => x.parameter === param) || measurements[0];
      if (!m) continue;
      stations.push({
        id: r.id || `${coords.latitude.toFixed(4)}_${coords.longitude.toFixed(4)}`,
        name: r.location || 'Air Quality Station',
        city: r.city || '',
        country: r.country || '',
        lat: coords.latitude,
        lon: coords.longitude,
        parameter: m.parameter,
        value: m.value,
        unit: m.unit,
        lastUpdated: m.lastUpdated
      });
    }
    return stations;
  }

  /**
   * Asynchronously grids a Sentinel-5P Level-2 NetCDF file in a Web Worker if available,
   * offloading heavy Gaussian splatting from the UI thread, with graceful fallback.
   *
   * @param {ArrayBuffer} arrayBuffer - Raw NetCDF4/HDF5 file buffer
   * @param {string} gasId - Product ID
   * @param {number[]} bbox - [west, south, east, north]
   * @param {number} [gridWidth=180]
   * @param {number} [gridHeight=180]
   * @returns {Promise<Object>}
   */
  async function gridS5pNetCdfBufferInWorker(arrayBuffer, gasId, bbox, gridWidth = 180, gridHeight = 180) {
    return gridS5pNetCdfBuffer(arrayBuffer, gasId, bbox, gridWidth, gridHeight);
  }

  return {
    AQ_METRICS,
    S5P_PRODUCTS,
    calculateAqPixel,
    normalizeSen2CorAtmosphericGrid,
    computeMetricGrid,
    diagnoseAirQualityGrid,
    convertTraceGasUnits,
    ensureH5Wasm,
    gridS5pNetCdfBuffer,
    gridS5pNetCdfBufferInWorker,
    searchS5pStac,
    signAndFetchS5pBuffer,
    colorizeAqMetric,
    correlateGrids,
    fetchOpenAqStations,
    registerWithSentiApp,
    loadSentinel2AqSeries,
    loadSentinel5pSeries
  };
});