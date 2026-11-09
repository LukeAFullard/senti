/**
 * @file tests/test_hydrology_core.js
 * Automated unit test suite for js/core/00-hydrology-core.js (SentiHydrologyCore).
 */

const test = require('node:test');
const assert = require('node:assert');
const Hydrology = require('../js/core/00-hydrology-core.js');

test('SentiHydrologyCore exports, palettes, and presets structure', () => {
  assert.strictEqual(typeof Hydrology, 'object');
  assert.strictEqual(typeof Hydrology.computeDeltaBackscatter, 'function');
  assert.strictEqual(typeof Hydrology.detectFloodFromBackscatter, 'function');
  assert.strictEqual(typeof Hydrology.calculateAreaStats, 'function');
  assert.strictEqual(typeof Hydrology.computeInundationFrequency, 'function');
  assert.strictEqual(typeof Hydrology.classifyWetlandZones, 'function');
  assert.strictEqual(typeof Hydrology.detectEmergentWetlandCanopy, 'function');
  assert.strictEqual(typeof Hydrology.colorizeClassifiedGrid, 'function');

  assert(Array.isArray(Hydrology.FLOOD_PALETTE.classes));
  assert.strictEqual(Hydrology.FLOOD_PALETTE.classes.length, 4);

  assert(Array.isArray(Hydrology.WETLAND_HYDROPERIOD_PALETTE.classes));
  assert.strictEqual(Hydrology.WETLAND_HYDROPERIOD_PALETTE.classes.length, 4);

  assert(Hydrology.HYDROLOGY_PRESETS.hawkes_bay, 'Hawke’s Bay preset must be defined');
  assert(Hydrology.HYDROLOGY_PRESETS.derna, 'Derna preset must be defined');
  assert(Hydrology.HYDROLOGY_PRESETS.indus, 'Indus preset must be defined');
  assert(Hydrology.HYDROLOGY_PRESETS.whangamarino, 'Whangamarino preset must be defined');
  assert(Hydrology.HYDROLOGY_PRESETS.okavango, 'Okavango preset must be defined');
  assert(Hydrology.HYDROLOGY_PRESETS.everglades, 'Everglades preset must be defined');
});

test('computeDeltaBackscatter SAR change detection', () => {
  const event = new Float32Array([-18.5, -12.0, -20.0, NaN]);
  const base = new Float32Array([-11.0, -11.5, NaN, -10.0]);

  const delta = Hydrology.computeDeltaBackscatter(event, base);
  assert.strictEqual(delta.length, 4);
  // Pixel 0: -18.5 - (-11.0) = -7.5 dB drop (flooded)
  assert(Math.abs(delta[0] - (-7.5)) < 1e-4);
  // Pixel 1: -12.0 - (-11.5) = -0.5 dB
  assert(Math.abs(delta[1] - (-0.5)) < 1e-4);
  // Pixel 2 & 3: NaN propagation
  assert(Number.isNaN(delta[2]));
  assert(Number.isNaN(delta[3]));

  // Dimension mismatch
  assert.throws(() => {
    Hydrology.computeDeltaBackscatter(new Float32Array(2), new Float32Array(3));
  }, /identical dimensions/);
});

test('detectFloodFromBackscatter flood extent classification', () => {
  // 4 pixels:
  // 0: Baseline was dry (-10 dB), event dropped to specular water (-18 dB) -> Flood (1)
  // 1: Baseline was already water (-19 dB), event is water (-20 dB) -> Permanent water (2)
  // 2: Baseline dry (-8 dB), event slightly wetter (-11 dB, but not <= -15 dB) -> Dry land (0)
  // 3: Invalid / NaN -> 0
  const event = new Float32Array([-18.0, -20.0, -11.0, NaN]);
  const base = new Float32Array([-10.0, -19.0, -8.0, -10.0]);

  const res = Hydrology.detectFloodFromBackscatter(event, base, {
    deltaThreshold: -3.5,
    absoluteThreshold: -15.0
  });

  assert.strictEqual(res.floodMask[0], 1, 'Pixel 0 should be newly flooded');
  assert.strictEqual(res.floodMask[1], 2, 'Pixel 1 should be permanent water');
  assert.strictEqual(res.floodMask[2], 0, 'Pixel 2 should be non-flooded');
  assert.strictEqual(res.floodMask[3], 0, 'Pixel 3 is NaN');

  assert.strictEqual(res.stats.floodPixels, 1);
  assert.strictEqual(res.stats.baselineWaterPixels, 1);
  assert.strictEqual(res.stats.totalValid, 3);
});

test('calculateAreaStats surface area calculations', () => {
  // 10,000 pixels at 10m resolution = 1,000,000 m² = 100 hectares = 1.0 km²
  const stats = Hydrology.calculateAreaStats(10000, 10);
  assert.strictEqual(stats.pixelCount, 10000);
  assert.strictEqual(stats.squareMeters, 1000000);
  assert.strictEqual(stats.hectares, 100);
  assert.strictEqual(stats.squareKm, 1.0);

  // 20m resolution
  const stats20m = Hydrology.calculateAreaStats(2500, 20);
  assert.strictEqual(stats20m.squareMeters, 1000000);
  assert.strictEqual(stats20m.hectares, 100);
});

test('computeInundationFrequency hydroperiod mapping', () => {
  // 4 epochs over 3 pixels:
  // Pixel 0: Inundated in 4/4 epochs -> IF = 100%
  // Pixel 1: Inundated in 2/4 epochs -> IF = 50%
  // Pixel 2: Inundated in 0/4 epochs -> IF = 0%
  const ep1 = new Uint8Array([1, 1, 0]);
  const ep2 = new Uint8Array([1, 0, 0]);
  const ep3 = new Uint8Array([1, 1, 0]);
  const ep4 = new Uint8Array([1, 0, 0]);

  const ifGrid = Hydrology.computeInundationFrequency([ep1, ep2, ep3, ep4]);
  assert.strictEqual(ifGrid.length, 3);
  assert.strictEqual(ifGrid[0], 100.0);
  assert.strictEqual(ifGrid[1], 50.0);
  assert.strictEqual(ifGrid[2], 0.0);
});

test('classifyWetlandZones Ramsar hydroperiod classification', () => {
  const ifGrid = new Float32Array([85.0, 45.0, 15.0, 2.0, NaN]);
  const res = Hydrology.classifyWetlandZones(ifGrid);

  assert.strictEqual(res.zoneGrid[0], 3, '85% IF should be Permanent Water (3)');
  assert.strictEqual(res.zoneGrid[1], 2, '45% IF should be Seasonal Wetland (2)');
  assert.strictEqual(res.zoneGrid[2], 1, '15% IF should be Ephemeral Wetland (1)');
  assert.strictEqual(res.zoneGrid[3], 0, '2% IF should be Upland (0)');
  assert.strictEqual(res.zoneGrid[4], 255, 'NaN should be NODATA (255)');

  assert.strictEqual(res.classCounts.permanent, 1);
  assert.strictEqual(res.classCounts.seasonal, 1);
  assert.strictEqual(res.classCounts.ephemeral, 1);
  assert.strictEqual(res.classCounts.upland, 1);
  assert.strictEqual(res.classCounts.total, 4);
});

test('detectEmergentWetlandCanopy double-bounce detection', () => {
  // Pixel 0: High NDVI (0.6) and elevated SAR backscatter (-8 dB) -> emergent sub-canopy water (1)
  // Pixel 1: High NDVI (0.6) but low SAR backscatter (-18 dB) -> dry canopy / open water without double bounce (0)
  // Pixel 2: Low NDVI (0.1) and elevated backscatter (-8 dB) -> urban / rocky soil without canopy (0)
  const sar = new Float32Array([-8.0, -18.0, -8.0]);
  const ndvi = new Float32Array([0.6, 0.6, 0.1]);

  const mask = Hydrology.detectEmergentWetlandCanopy(sar, ndvi);
  assert.strictEqual(mask[0], 1);
  assert.strictEqual(mask[1], 0);
  assert.strictEqual(mask[2], 0);
});

test('colorizeClassifiedGrid RGBA buffer generation', () => {
  const mask = new Uint8Array([0, 1, 2, 3]);
  const rgba = Hydrology.colorizeClassifiedGrid(mask, Hydrology.FLOOD_PALETTE);

  assert.strictEqual(rgba.length, 16);
  // Class 0 (Dry land): transparent
  assert.strictEqual(rgba[3], 0);
  // Class 1 (Flood): blue color with alpha
  const c1 = Hydrology.FLOOD_PALETTE.classes[1].rgba;
  assert.strictEqual(rgba[4], c1[0]);
  assert.strictEqual(rgba[5], c1[1]);
  assert.strictEqual(rgba[6], c1[2]);
  assert.strictEqual(rgba[7], c1[3]);
});
