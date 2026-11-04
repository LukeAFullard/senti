/**
 * @file tests/test_air_quality.js
 * Test suite for js/11-air-quality-module.js
 */

const assert = require('assert');
const path = require('path');

// 1. Test Node.js CommonJS module import
const AQ = require('../js/11-air-quality-module.js');

console.log('--- 1. Testing Module Structure & Exports ---');
assert(AQ && typeof AQ === 'object', 'AirQualityRemoteSensing should export an object');
assert(typeof AQ.calculateAqPixel === 'function', 'calculateAqPixel must be a function');
assert(typeof AQ.computeMetricGrid === 'function', 'computeMetricGrid must be a function');
assert(typeof AQ.diagnoseAirQualityGrid === 'function', 'diagnoseAirQualityGrid must be a function');
assert(typeof AQ.convertTraceGasUnits === 'function', 'convertTraceGasUnits must be a function');
assert(typeof AQ.colorizeAqMetric === 'function', 'colorizeAqMetric must be a function');
assert(typeof AQ.registerWithSentiApp === 'function', 'registerWithSentiApp must be a function');
assert(typeof AQ.normalizeSen2CorAtmosphericGrid === 'function', 'normalizeSen2CorAtmosphericGrid must be a function');

const expectedMetrics = ['s2_aot', 's2_wvp', 'asi', 'ngai', 'spdi', 'cdi', 'pm25_proxy'];
for (const m of expectedMetrics) {
  assert(AQ.AQ_METRICS[m], `Metric ${m} must be defined in AQ_METRICS`);
  assert(Array.isArray(AQ.AQ_METRICS[m].bands), `Metric ${m} must specify bands array`);
  assert(AQ.AQ_METRICS[m].scale && typeof AQ.AQ_METRICS[m].scale.min === 'number', `Metric ${m} must define scale`);
}
console.log('✓ Module exports and metric definitions verified.');

console.log('--- 2. Testing Pixel-level Metric Calculations ---');
// Test AOT
const aotClean = AQ.calculateAqPixel('s2_aot', [0.08]);
assert.strictEqual(aotClean, 0.08, 'AOT 0.08 should return 0.08');
// Test AOT unscaled DN auto-normalization (e.g. 200 -> 0.2)
const aotUnscaled = AQ.calculateAqPixel('s2_aot', [200]);
assert(Math.abs(aotUnscaled - 0.2) < 1e-5, 'AOT 200 DN should normalize to 0.2');

// Test WVP
const wvpNormal = AQ.calculateAqPixel('s2_wvp', [1.5]);
assert.strictEqual(wvpNormal, 1.5, 'WVP 1.5 should return 1.5');
const wvpUnscaled = AQ.calculateAqPixel('s2_wvp', [1500]);
assert(Math.abs(wvpUnscaled - 1.5) < 1e-5, 'WVP 1500 DN should normalize to 1.5');

// Test ASI (Normalized difference B01 coastal vs B02 blue)
// (0.2 - 0.1) / (0.2 + 0.1) = 0.1 / 0.3 = 0.3333...
const asiVal = AQ.calculateAqPixel('asi', [0.2, 0.1]);
assert(Math.abs(asiVal - 1 / 3) < 1e-5, `ASI calculation mismatch: ${asiVal}`);

// Test SPDI (Normalized difference B01 coastal vs B12 swir22)
// (0.3 - 0.1) / (0.3 + 0.1) = 0.2 / 0.4 = 0.5
const spdiVal = AQ.calculateAqPixel('spdi', [0.3, 0.1]);
assert(Math.abs(spdiVal - 0.5) < 1e-5, `SPDI calculation mismatch: ${spdiVal}`);

// Test CDI (Normalized difference B11 swir16 vs B01 coastal)
// (0.25 - 0.15) / (0.25 + 0.15) = 0.1 / 0.4 = 0.25
const cdiVal = AQ.calculateAqPixel('cdi', [0.25, 0.15]);
assert(Math.abs(cdiVal - 0.25) < 1e-5, `CDI calculation mismatch: ${cdiVal}`);

// Test PM2.5 proxy
// AOT = 0.3, WVP = 2.0, default pblHeightKm = 1.0, massExtinctionCoeff = 85.0
// hygroscopicFactor = 1.0 + 0.18 * 2.0 = 1.36
// pm25 = (0.3 * 85) / (1.0 * 1.36) = 25.5 / 1.36 = 18.75
const pm25Val = AQ.calculateAqPixel('pm25_proxy', [0.3, 2.0]);
assert(Math.abs(pm25Val - 18.75) < 1e-3, `PM2.5 calculation mismatch: ${pm25Val}`);

// Test invalid inputs
assert(Number.isNaN(AQ.calculateAqPixel('s2_aot', [NaN])), 'NaN input should return NaN');
assert(Number.isNaN(AQ.calculateAqPixel('unknown_mode', [1.0])), 'Unknown mode should return NaN');
console.log('✓ All pixel-level calculations verified.');

console.log('--- 3. Testing Grid Calculations & Masks ---');
const len = 10;
const coastalGrid = new Float32Array([0.2, 0.3, 0.4, 0.1, 0.2, 0.5, 0.3, 0.2, 0.1, 0.2]);
const blueGrid = new Float32Array([0.1, 0.1, 0.2, 0.1, 0.1, 0.1, 0.2, 0.1, 0.1, 0.1]);
const maskGrid = new Uint8Array([0, 0, 1, 0, 0, 0, 0, 0, 0, 0]); // index 2 masked

const asiGridResult = AQ.computeMetricGrid('asi', { coastal: coastalGrid, blue: blueGrid }, { mask: maskGrid });
assert(asiGridResult && asiGridResult.indexGrid instanceof Float32Array, 'Grid result must contain Float32Array');
assert(Number.isNaN(asiGridResult.indexGrid[2]), 'Masked pixel must be NaN');
assert(!Number.isNaN(asiGridResult.indexGrid[0]), 'Unmasked pixel 0 must be finite');
assert.strictEqual(asiGridResult.validCount, 9, 'Valid count should exclude masked pixel');
assert(Number.isFinite(asiGridResult.meanVal), 'Mean value should be finite');
console.log('✓ Grid computation with masking verified.');

console.log('--- 4. Testing Sen2Cor DDV Fallback Diagnostics ---');
// Synthesize a fallback grid with near-zero standard deviation (e.g., constant 0.20)
const constantAot = new Float32Array(500);
constantAot.fill(0.20);
const fallbackDiag = AQ.diagnoseAirQualityGrid(constantAot, 's2_aot');
assert.strictEqual(fallbackDiag.isConstantFallback, true, 'Constant AOT grid should trigger isConstantFallback');
assert(fallbackDiag.warning && fallbackDiag.warning.includes('Dark Dense Vegetation'), 'Warning message should mention DDV');

// Synthesize a varied AOT grid with smoke plume
const variedAot = new Float32Array(500);
for (let i = 0; i < 500; i++) {
  variedAot[i] = 0.10 + 0.70 * (i / 500); // 0.10 to 0.80
}
const normalDiag = AQ.diagnoseAirQualityGrid(variedAot, 's2_aot');
assert.strictEqual(normalDiag.isConstantFallback, false, 'Varied AOT grid should not trigger fallback');
assert.strictEqual(normalDiag.warning, null, 'No warning should be emitted for normal grid');
assert(normalDiag.p95 > 0.65, 'p95 should reflect plume');
console.log('✓ Sen2Cor DDV fallback diagnostics verified.');

console.log('--- 5. Testing Sentinel-5P Unit Conversions ---');
// 1 mol/m^2 = 2241.15 DU
const duVal = AQ.convertTraceGasUnits(1.0, 'mol_m2', 'du');
assert(Math.abs(duVal - 2241.15) < 1e-4, 'mol/m2 to DU conversion mismatch');
// reverse
const molVal = AQ.convertTraceGasUnits(2241.15, 'du', 'mol_m2');
assert(Math.abs(molVal - 1.0) < 1e-4, 'DU to mol/m2 conversion mismatch');
// 1 mol/m^2 = 6.02214076e19 molec/cm^2
const molecVal = AQ.convertTraceGasUnits(1.0, 'mol_m2', 'molec_cm2');
assert(Math.abs(molecVal - 6.02214076e19) < 1e12, 'mol/m2 to molec/cm2 conversion mismatch');
console.log('✓ Sentinel-5P trace gas unit conversions verified.');

console.log('--- 6. Testing Color Palettes & Diff Rendering ---');
const cleanColor = AQ.colorizeAqMetric(0.05, 's2_aot');
assert(Array.isArray(cleanColor) && cleanColor.length === 4, 'Color should be [R,G,B,A]');
assert(cleanColor[3] > 0, 'Alpha should be non-zero');

const diffClean = AQ.colorizeAqMetric(-0.25, 's2_aot', true);
const diffPolluted = AQ.colorizeAqMetric(0.25, 's2_aot', true);
assert(diffClean[2] > diffClean[0], 'Cleaner air diff should have higher blue than red');
assert(diffPolluted[0] > diffPolluted[2], 'Polluted air diff should have higher red than blue');
console.log('✓ Colorization and diff palettes verified.');

console.log('--- 7. Testing registerWithSentiApp Host Integration ---');
const mockHost = {
  INDEX_DEFS: {
    ndvi: { bands: ['nir', 'red'], formula: 'nd' }
  },
  COLOR_STRETCH_SCALES: {
    ndvi: { min: -1, max: 1, breaks: [0, 0.5] }
  },
  getAssetBandInfo: function (asset, fallback) {
    return fallback;
  },
  getNativeResolution: function (asset, key) {
    return 10;
  },
  calculateIndexValue: function (mode, bands) {
    return 999;
  },
  colorizeIndex: function (val, mode, isDiff) {
    return [1, 2, 3, 4];
  }
};

const regSuccess = AQ.registerWithSentiApp(mockHost);
assert.strictEqual(regSuccess, true, 'registerWithSentiApp should return true');

// Verify INDEX_DEFS registration
for (const m of expectedMetrics) {
  assert(mockHost.INDEX_DEFS[m], `Host INDEX_DEFS should contain ${m}`);
  assert(mockHost.COLOR_STRETCH_SCALES[m], `Host COLOR_STRETCH_SCALES should contain ${m}`);
}

// Verify wrapped calculateIndexValue
const calcAot = mockHost.calculateIndexValue('s2_aot', [0.22]);
assert.strictEqual(calcAot, 0.22, 'calculateIndexValue should intercept air quality metrics');
const calcNdvi = mockHost.calculateIndexValue('ndvi', [0.8, 0.2]);
assert.strictEqual(calcNdvi, 999, 'calculateIndexValue should delegate original indices to original function');

// Verify wrapped getAssetBandInfo
const aotAssetInfo = mockHost.getAssetBandInfo({ href: 'https://example.com/scene/aot.tif' }, { scale: 0.0001, offset: -0.1, nodata: 0 });
assert.strictEqual(aotAssetInfo.scale, 0.001, 'Atmospheric asset scale fallback should default to 0.001');
assert.strictEqual(aotAssetInfo.offset, 0, 'Atmospheric asset offset fallback should default to 0');

// Verify wrapped getNativeResolution
assert.strictEqual(mockHost.getNativeResolution({}, 'aot'), 20, 'aot native resolution should default to 20m');
assert.strictEqual(mockHost.getNativeResolution({}, 'wvp'), 20, 'wvp native resolution should default to 20m');
assert.strictEqual(mockHost.getNativeResolution({}, 'blue'), 10, 'other bands should delegate to original');

console.log('✓ Host application registration and wrapping verified.');

console.log('\n========================================');
console.log('All air quality tests passed successfully!');
console.log('========================================');
