/**
 * @file js/core/00-hydrology-core.js
 * Universal, zero-DOM remote sensing engine for Flood Extent Mapping and Wetland Delineation.
 *
 * Designed to elevate UX, DX, and AX (Agent Experience):
 * - UX: Fast client-side radar change detection (Δσ0), Otsu water binarization,
 *       inundation frequency (hydroperiod) mapping, and accurate surface area statistics (ha/km²).
 * - DX: Clean, modular APIs combining Sentinel-1 SAR C-band specular backscatter with
 *       Sentinel-2 optical water indices (MNDWI, AWEI), complete with pre-configured color palettes.
 * - AX: Pure, headless-testable mathematical functions (`computeDeltaBackscatter`,
 *       `computeInundationFrequency`, `classifyWetlandZones`, `calculateAreaStats`).
 *
 * UMD module: CommonJS (Node.js) + Browser window.SentiHydrologyCore.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SentiHydrologyCore = factory();
    if (typeof window !== 'undefined') {
      window.SentiHydrologyCore = root.SentiHydrologyCore;
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ============================================================================
  // Scientific Color Palettes & Legend Definitions
  // ============================================================================

  const FLOOD_PALETTE = {
    classes: [
      { id: 0, label: 'Dry / Non-flooded Land', color: '#26292e', rgba: [38, 41, 46, 180] },
      { id: 1, label: 'Newly Inundated / Flood Extent', color: '#3b82f6', rgba: [59, 130, 246, 230] },
      { id: 2, label: 'Permanent Water Baseline', color: '#1e3a8a', rgba: [30, 58, 138, 200] },
      { id: 3, label: 'Vegetated / Urban Flooding (Double-bounce)', color: '#f59e0b', rgba: [245, 158, 11, 230] }
    ]
  };

  const WETLAND_HYDROPERIOD_PALETTE = {
    classes: [
      { id: 0, label: 'Upland / Terrestrial (IF < 5%)', color: '#4a4338', rgba: [74, 67, 56, 160] },
      { id: 1, label: 'Ephemeral Wetland (IF 5–25%)', color: '#86efac', rgba: [134, 239, 172, 220] },
      { id: 2, label: 'Seasonal Wetland / Marsh (IF 25–75%)', color: '#38bdf8', rgba: [56, 189, 248, 220] },
      { id: 3, label: 'Permanent Open Water (IF > 75%)', color: '#1e40af', rgba: [30, 64, 175, 230] }
    ]
  };

  // Preset environmental observatory locations with geographic bounds
  const HYDROLOGY_PRESETS = {
    hawkes_bay: {
      name: 'Hawke’s Bay, NZ (Cyclone Gabrielle Floods)',
      center: [-39.52, 176.85],
      zoom: 11,
      bbox: [176.65, -39.68, 177.05, -39.38],
      type: 'flood',
      eventDate: '2023-02-16',
      baselineDate: '2023-01-15',
      notes: 'Catastrophic river overflows and valley inundation following Cyclone Gabrielle.'
    },
    derna: {
      name: 'Derna, Libya (Wadi Derna Dam Collapse)',
      center: [32.76, 22.64],
      zoom: 12,
      bbox: [22.58, 32.70, 22.70, 32.80],
      type: 'flood',
      eventDate: '2023-09-13',
      baselineDate: '2023-08-20',
      notes: 'Sudden flash flooding from catastrophic dam breaches during Storm Daniel.'
    },
    indus: {
      name: 'Indus River Basin, Pakistan (2022 Super Flood)',
      center: [27.50, 68.20],
      zoom: 9,
      bbox: [67.80, 27.10, 68.70, 27.90],
      type: 'flood',
      eventDate: '2022-09-01',
      baselineDate: '2022-06-15',
      notes: 'Monsoon super-floods covering one-third of the country in standing water.'
    },
    whangamarino: {
      name: 'Whangamarino Wetland, NZ (Ramsar Site)',
      center: [-37.31, 175.14],
      zoom: 12,
      bbox: [175.05, -37.38, 175.25, -37.24],
      type: 'wetland',
      startDate: '2023-01-01',
      endDate: '2023-12-31',
      notes: 'Peat bog, swamp, and marsh complex supporting threatened wetland avifauna.'
    },
    okavango: {
      name: 'Okavango Delta, Botswana',
      center: [-19.30, 22.60],
      zoom: 10,
      bbox: [22.20, -19.65, 23.00, -18.95],
      type: 'wetland',
      startDate: '2023-01-01',
      endDate: '2023-12-31',
      notes: 'World-famous inland delta with seasonal flood pulse spreading across Kalahari sands.'
    },
    everglades: {
      name: 'Everglades & Water Conservation Areas, USA',
      center: [26.05, -80.60],
      zoom: 11,
      bbox: [-80.75, 25.90, -80.45, 26.20],
      type: 'wetland',
      startDate: '2023-01-01',
      endDate: '2023-12-31',
      notes: 'Expansive subtropical sawgrass marsh, sloughs, and tree island hydroperiod dynamics.'
    }
  };

  // ============================================================================
  // SAR Radar & Multi-Temporal Change Detection Algorithms
  // ============================================================================

  /**
   * Computes logarithmic difference (change) between two aligned SAR backscatter grids:
   * Δσ0 = σ0_event - σ0_baseline (in dB).
   * Calm standing water exhibits specular reflection, causing backscatter drops (negative Δσ0).
   *
   * @param {Float32Array} eventGrid - SAR backscatter intensity in dB during event
   * @param {Float32Array} baselineGrid - SAR backscatter intensity in dB before event
   * @returns {Float32Array} Difference grid (Δσ0 in dB)
   */
  function computeDeltaBackscatter(eventGrid, baselineGrid) {
    if (!eventGrid || !baselineGrid || eventGrid.length !== baselineGrid.length) {
      throw new Error('Event and baseline grids must be non-null and share identical dimensions.');
    }
    const len = eventGrid.length;
    const delta = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const e = eventGrid[i];
      const b = baselineGrid[i];
      delta[i] = Number.isFinite(e) && Number.isFinite(b) ? e - b : NaN;
    }
    return delta;
  }

  /**
   * Detects flooded areas by thresholding radar change detection and/or absolute specular backscatter.
   *
   * Recommended Practice (UN-SPIDER / Copernicus Emergency Management Service):
   * - Inundated: Δσ0 <= deltaThreshold (typically -3.0 dB to -4.5 dB)
   *   AND event σ0 <= absoluteThreshold (typically -15.0 dB to -18.0 dB in VV/VH).
   *
   * @param {Float32Array} eventGrid - Crisis SAR backscatter (dB)
   * @param {Float32Array} baselineGrid - Pre-flood baseline SAR backscatter (dB)
   * @param {Object} [options={}]
   * @param {number} [options.deltaThreshold=-3.5] - dB drop indicating inundation
   * @param {number} [options.absoluteThreshold=-15.0] - Maximum backscatter for calm water
   * @param {Uint8Array} [options.permanentWaterMask] - Optional permanent water mask
   * @returns {{ floodMask: Uint8Array, stats: { floodPixels: number, baselineWaterPixels: number, totalValid: number } }}
   */
  function detectFloodFromBackscatter(eventGrid, baselineGrid, options = {}) {
    const len = eventGrid.length;
    const deltaThreshold = options.deltaThreshold !== undefined ? options.deltaThreshold : -3.5;
    const absoluteThreshold = options.absoluteThreshold !== undefined ? options.absoluteThreshold : -15.0;
    const permMask = options.permanentWaterMask;

    const floodMask = new Uint8Array(len);
    let floodPixels = 0;
    let baselineWaterPixels = 0;
    let totalValid = 0;

    for (let i = 0; i < len; i++) {
      const e = eventGrid[i];
      const b = baselineGrid ? baselineGrid[i] : NaN;
      if (!Number.isFinite(e)) continue;
      totalValid++;

      // Check if pixel was already permanent water in baseline
      const isBaselineWater = permMask ? permMask[i] === 1 : (Number.isFinite(b) && b <= absoluteThreshold);
      if (isBaselineWater) {
        floodMask[i] = 2; // Permanent water
        baselineWaterPixels++;
        continue;
      }

      // Check for flood inundation
      let isFlooded = false;
      if (Number.isFinite(b)) {
        const delta = e - b;
        isFlooded = (delta <= deltaThreshold) && (e <= absoluteThreshold);
      } else {
        isFlooded = (e <= absoluteThreshold);
      }

      if (isFlooded) {
        floodMask[i] = 1; // Newly flooded ground
        floodPixels++;
      } else {
        floodMask[i] = 0; // Dry land
      }
    }

    return {
      floodMask,
      stats: {
        floodPixels,
        baselineWaterPixels,
        totalValid
      }
    };
  }

  /**
   * Calculates surface area metrics from classified pixel count.
   *
   * @param {number} pixelCount - Number of classified pixels
   * @param {number} [pixelResolutionMeters=10] - Spatial resolution in meters per pixel
   * @returns {{ pixelCount: number, squareMeters: number, hectares: number, squareKm: number }}
   */
  function calculateAreaStats(pixelCount, pixelResolutionMeters = 10) {
    const count = Math.max(0, Number(pixelCount) || 0);
    const res = Math.max(0.1, Number(pixelResolutionMeters) || 10);
    const pixelAreaM2 = res * res;
    const squareMeters = count * pixelAreaM2;
    const hectares = squareMeters / 10000;
    const squareKm = squareMeters / 1000000;

    return {
      pixelCount: count,
      squareMeters,
      hectares,
      squareKm
    };
  }

  // ============================================================================
  // Wetland Delineation & Inundation Frequency (Hydroperiod) Algorithms
  // ============================================================================

  /**
   * Computes Inundation Frequency (IF) percentage across a multi-temporal stack:
   * IF(x, y) = (Sum_{t=1..T} Inundated(x, y, t) / ValidObservations(x, y)) * 100%
   *
   * @param {Array<Uint8Array>} maskStack - Array of binary water masks (1 = water/inundated, 0 = dry)
   * @returns {Float32Array} Inundation frequency grid [0.0 .. 100.0%]
   */
  function computeInundationFrequency(maskStack) {
    if (!maskStack || !maskStack.length) {
      throw new Error('Mask stack must contain at least one observation epoch.');
    }
    const len = maskStack[0].length;
    const ifGrid = new Float32Array(len);
    const numEpochs = maskStack.length;

    for (let i = 0; i < len; i++) {
      let inundatedCount = 0;
      let validCount = 0;

      for (let t = 0; t < numEpochs; t++) {
        const val = maskStack[t][i];
        if (val === 1) {
          inundatedCount++;
          validCount++;
        } else if (val === 0) {
          validCount++;
        }
        // val === 255 or other values can represent clouds/NODATA
      }

      ifGrid[i] = validCount > 0 ? (inundatedCount / validCount) * 100 : NaN;
    }

    return ifGrid;
  }

  /**
   * Classifies wetland regimes based on Inundation Frequency (IF):
   * - Class 3: Permanent Water (IF >= 75%)
   * - Class 2: Seasonal Wetland / Marsh (25% <= IF < 75%)
   * - Class 1: Ephemeral / Temporary Inundated Wetland (5% <= IF < 25%)
   * - Class 0: Upland / Terrestrial (IF < 5%)
   *
   * @param {Float32Array} ifGrid - Inundation frequency grid (0..100)
   * @param {Object} [options={}]
   * @param {number} [options.permanentThreshold=75]
   * @param {number} [options.seasonalThreshold=25]
   * @param {number} [options.ephemeralThreshold=5]
   * @returns {{ zoneGrid: Uint8Array, classCounts: { permanent: number, seasonal: number, ephemeral: number, upland: number, total: number } }}
   */
  function classifyWetlandZones(ifGrid, options = {}) {
    const permT = options.permanentThreshold !== undefined ? options.permanentThreshold : 75;
    const seasT = options.seasonalThreshold !== undefined ? options.seasonalThreshold : 25;
    const epheT = options.ephemeralThreshold !== undefined ? options.ephemeralThreshold : 5;

    const len = ifGrid.length;
    const zoneGrid = new Uint8Array(len);
    let permanent = 0, seasonal = 0, ephemeral = 0, upland = 0, total = 0;

    for (let i = 0; i < len; i++) {
      const v = ifGrid[i];
      if (!Number.isFinite(v)) {
        zoneGrid[i] = 255; // NODATA
        continue;
      }
      total++;
      if (v >= permT) {
        zoneGrid[i] = 3;
        permanent++;
      } else if (v >= seasT) {
        zoneGrid[i] = 2;
        seasonal++;
      } else if (v >= epheT) {
        zoneGrid[i] = 1;
        ephemeral++;
      } else {
        zoneGrid[i] = 0;
        upland++;
      }
    }

    return {
      zoneGrid,
      classCounts: { permanent, seasonal, ephemeral, upland, total }
    };
  }

  /**
   * Detects emergent sub-canopy wetland flooding by combining optical vegetation
   * indices (NDVI) with dual-polarization SAR double-bounce backscatter.
   * Standing water beneath reed beds, mangroves, or flooded crops creates strong
   * dihedral reflections that increase cross-polarization (VH) or co-polarization (VV).
   *
   * @param {Float32Array} sarBackscatterGrid - SAR intensity (dB)
   * @param {Float32Array} ndviGrid - Optical NDVI grid (-1..1)
   * @param {Object} [options={}]
   * @param {number} [options.minNdvi=0.30] - Minimum NDVI indicating dense canopy
   * @param {number} [options.minBackscatter=-11.0] - Elevated backscatter indicating double-bounce
   * @returns {Uint8Array} Binary mask (1 = sub-canopy water detected, 0 = other)
   */
  function detectEmergentWetlandCanopy(sarBackscatterGrid, ndviGrid, options = {}) {
    const len = sarBackscatterGrid.length;
    const minNdvi = options.minNdvi !== undefined ? options.minNdvi : 0.30;
    const minDb = options.minBackscatter !== undefined ? options.minBackscatter : -11.0;
    const mask = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
      const sar = sarBackscatterGrid[i];
      const ndvi = ndviGrid[i];
      if (Number.isFinite(sar) && Number.isFinite(ndvi) && ndvi >= minNdvi && sar >= minDb) {
        mask[i] = 1;
      } else {
        mask[i] = 0;
      }
    }

    return mask;
  }

  // ============================================================================
  // Canvas Raster Colorization Helpers
  // ============================================================================

  /**
   * Renders a classified mask into an RGBA Uint8ClampedArray for HTML5 canvas rendering.
   * @param {Uint8Array} mask - Grid of class IDs (0..3)
   * @param {Object} palette - Palette with classes array containing rgba: [r, g, b, a]
   * @returns {Uint8ClampedArray} 4-channel RGBA pixel buffer
   */
  function colorizeClassifiedGrid(mask, palette) {
    const len = mask.length;
    const rgba = new Uint8ClampedArray(len * 4);
    const classMap = new Map();
    for (const c of palette.classes) {
      classMap.set(c.id, c.rgba);
    }

    for (let i = 0; i < len; i++) {
      const cls = mask[i];
      const c = classMap.get(cls);
      const offset = i * 4;
      if (c && cls !== 0) { // Keep class 0 transparent or semi-transparent
        rgba[offset] = c[0];
        rgba[offset + 1] = c[1];
        rgba[offset + 2] = c[2];
        rgba[offset + 3] = c[3];
      } else {
        rgba[offset] = 0;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 0;
        rgba[offset + 3] = 0;
      }
    }

    return rgba;
  }

  return {
    FLOOD_PALETTE,
    WETLAND_HYDROPERIOD_PALETTE,
    HYDROLOGY_PRESETS,
    computeDeltaBackscatter,
    detectFloodFromBackscatter,
    calculateAreaStats,
    computeInundationFrequency,
    classifyWetlandZones,
    detectEmergentWetlandCanopy,
    colorizeClassifiedGrid
  };
});
