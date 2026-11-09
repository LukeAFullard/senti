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
assert(AQ.S5P_PRODUCTS && typeof AQ.S5P_PRODUCTS === 'object', 'S5P_PRODUCTS catalog must be exported');
assert(typeof AQ.ensureH5Wasm === 'function', 'ensureH5Wasm must be a function');
assert(typeof AQ.gridS5pNetCdfBuffer === 'function', 'gridS5pNetCdfBuffer must be a function');
assert(typeof AQ.searchS5pStac === 'function', 'searchS5pStac must be a function');
assert(typeof AQ.signAndFetchS5pBuffer === 'function', 'signAndFetchS5pBuffer must be a function');
assert(typeof AQ.loadSentinel2AqSeries === 'function', 'loadSentinel2AqSeries must be a function');
assert(typeof AQ.loadSentinel5pSeries === 'function', 'loadSentinel5pSeries must be a function');

const expectedMetrics = ['s2_aot', 's2_wvp', 'asi', 'ngai', 'spdi', 'cdi', 'pm25_proxy'];
for (const m of expectedMetrics) {
  assert(AQ.AQ_METRICS[m], `Metric ${m} must be defined in AQ_METRICS`);
  assert(Array.isArray(AQ.AQ_METRICS[m].bands), `Metric ${m} must specify bands array`);
  assert(AQ.AQ_METRICS[m].scale && typeof AQ.AQ_METRICS[m].scale.min === 'number', `Metric ${m} must define scale`);
}

const expectedS5pGases = ['no2', 'so2', 'co', 'o3', 'ch4', 'hcho', 'aer_ai'];
for (const g of expectedS5pGases) {
  assert(AQ.S5P_PRODUCTS[g], `S5P_PRODUCTS must define ${g}`);
  assert(AQ.S5P_PRODUCTS[g].stacProduct, `${g} must define stacProduct`);
  assert(AQ.S5P_PRODUCTS[g].assetKey, `${g} must define assetKey`);
  assert(AQ.S5P_PRODUCTS[g].h5Var, `${g} must define h5Var`);
  assert(AQ.S5P_PRODUCTS[g].displayUnit, `${g} must define displayUnit`);
  assert(typeof AQ.S5P_PRODUCTS[g].multiplier === 'number', `${g} must define multiplier`);
  assert(typeof AQ.S5P_PRODUCTS[g].minQa === 'number', `${g} must define minQa`);
  assert(Array.isArray(AQ.S5P_PRODUCTS[g].legendItems), `${g} must define legendItems`);
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

// Test S5P trace gas colorization
for (const g of expectedS5pGases) {
  const minColor = AQ.colorizeAqMetric(AQ.S5P_PRODUCTS[g].scale.min - 10, g, false);
  const maxColor = AQ.colorizeAqMetric(AQ.S5P_PRODUCTS[g].scale.max + 10, g, false);
  assert(Array.isArray(minColor) && minColor.length === 4, `${g} minColor must be RGBA`);
  assert(Array.isArray(maxColor) && maxColor.length === 4, `${g} maxColor must be RGBA`);
  assert(minColor[3] > 0, `${g} min alpha must be non-zero`);
  assert(maxColor[3] > 0, `${g} max alpha must be non-zero`);
}
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

console.log('--- 8. Testing Worker & Legend Wrappers in Senti App Integration ---');
let workerCalledWith = null;
const hostWithWorkerAndLegend = {
  INDEX_DEFS: {},
  COLOR_STRETCH_SCALES: {},
  runCpuWorkerTask: function (type, payload) {
    workerCalledWith = { type, payload };
    return Promise.resolve({ ok: true });
  },
  legend: {
    style: { display: 'none' },
    innerHTML: ''
  },
  updateLegend: function (mode, isDiff) {
    this.legend.style.display = 'none';
  }
};

AQ.registerWithSentiApp(hostWithWorkerAndLegend);

async function testWorkerAndLegend() {
  // Test runCpuWorkerTask rejects for AQ metrics
  let caughtWorkerErr = null;
  try {
    await hostWithWorkerAndLegend.runCpuWorkerTask('index-grid', { mode: 's2_aot' });
  } catch (err) {
    caughtWorkerErr = err;
  }
  assert(caughtWorkerErr !== null, 'runCpuWorkerTask should reject for air quality metrics');
  assert.strictEqual(caughtWorkerErr.message, 'AQ_MAIN_THREAD_DELEGATE');

  // Test runCpuWorkerTask delegates for non-AQ tasks
  const res = await hostWithWorkerAndLegend.runCpuWorkerTask('index-grid', { mode: 'ndvi' });
  assert.strictEqual(res.ok, true, 'runCpuWorkerTask should delegate for non-AQ metrics');
  assert.strictEqual(workerCalledWith.payload.mode, 'ndvi');

  // Test updateLegend renders and sets display flex for AQ metric
  hostWithWorkerAndLegend.updateLegend('s2_aot', false);
  assert.strictEqual(hostWithWorkerAndLegend.legend.style.display, 'flex', 'Legend display should be flex for AQ metric');
  assert(hostWithWorkerAndLegend.legend.innerHTML.includes('AOT'), 'Legend innerHTML should include AQ metric label');

  // Test updateLegend delegates for non-AQ metric
  hostWithWorkerAndLegend.updateLegend('unknown_metric', false);
  assert.strictEqual(hostWithWorkerAndLegend.legend.style.display, 'none', 'Legend should delegate to original updateLegend for non-AQ metric');
  console.log('✓ Worker interception and legend wrapper verified.');

  console.log('--- 9. Testing S5P STAC Search Query Construction & Filtering ---');
  const origFetch = globalThis.fetch;
  let stacPayloadCaptured = null;
  globalThis.fetch = async function (url, opts = {}) {
    if (url.includes('stac/v1/search')) {
      stacPayloadCaptured = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          features: [
            {
              id: 'S5P_RPRO_L2__NO2____20230802T120000',
              properties: { datetime: '2023-08-02T12:00:00Z' },
              assets: { no2: { href: 'https://blob.core.windows.net/s5p/no2_1.nc' } }
            },
            {
              id: 'S5P_RPRO_L2__NO2____MISSING_ASSET',
              properties: { datetime: '2023-08-03T12:00:00Z' },
              assets: {}
            },
            {
              id: 'S5P_RPRO_L2__NO2____20230804T120000',
              properties: { datetime: '2023-08-04T12:00:00Z' },
              assets: { no2: { href: 'https://blob.core.windows.net/s5p/no2_2.nc' } }
            }
          ]
        })
      };
    }
    if (url.includes('api/sas/v1/sign')) {
      const rawHref = new URL(url).searchParams.get('href');
      return {
        ok: true,
        json: async () => ({ href: `${rawHref}?token=test_sas` })
      };
    }
    return origFetch.apply(this, arguments);
  };

  try {
    const s5pFeatures = await AQ.searchS5pStac([12.0, 41.0, 13.0, 42.0], 'no2', '2023-08-01', '2023-08-05', 20);
    assert.strictEqual(stacPayloadCaptured.collections[0], 'sentinel-5p-l2-netcdf');
    assert.deepEqual(stacPayloadCaptured.bbox, [12.0, 41.0, 13.0, 42.0]);
    assert.strictEqual(stacPayloadCaptured.datetime, '2023-08-01T00:00:00Z/2023-08-05T23:59:59Z');
    assert(Array.isArray(stacPayloadCaptured.query['s5p:product_name'].in));
    assert(stacPayloadCaptured.query['s5p:product_name'].in.includes('no2'));

    // Features without required asset filtered out; sorted newest first
    assert.strictEqual(s5pFeatures.length, 2, 'Should filter out feature missing no2 asset');
    assert.strictEqual(s5pFeatures[0].id, 'S5P_RPRO_L2__NO2____20230804T120000', 'Should sort newest first');
    assert.strictEqual(s5pFeatures[1].id, 'S5P_RPRO_L2__NO2____20230802T120000');

    // Unknown product throws
    let unknownGasErr = null;
    try {
      await AQ.searchS5pStac([0, 0, 1, 1], 'fake_gas', '2023-01-01', '2023-01-02');
    } catch (e) {
      unknownGasErr = e;
    }
    assert(unknownGasErr !== null, 'Unknown gas should throw error');
  } finally {
    globalThis.fetch = origFetch;
  }
  console.log('✓ S5P STAC query construction and candidate resolution verified.');

  console.log('--- 10. Testing Sentinel-5P NetCDF Mock Gridding ---');
  const mockUnlinks = [];
  globalThis.h5wasm = {
    ready: Promise.resolve(),
    FS: {
      writeFile: () => {},
      unlink: (f) => { mockUnlinks.push(f); }
    },
    File: class MockH5File {
      constructor(fn) { this.fn = fn; }
      get(path) {
        if (path === 'PRODUCT/latitude') return { value: new Float32Array([41.5, 41.5, 50.0, NaN]) };
        if (path === 'PRODUCT/longitude') return { value: new Float32Array([12.5, 12.5, 12.5, 12.5]) };
        if (path === 'PRODUCT/qa_value') return { value: new Float32Array([0.90, 0.20, 0.90, 0.90]) }; // 1st passes, 2nd fails QA
        if (path === 'PRODUCT/nitrogendioxide_tropospheric_column') {
          return { value: new Float32Array([40e-6, 100e-6, 50e-6, 10e-6]) };
        }
        throw new Error(`Unexpected path: ${path}`);
      }
      close() {}
    }
  };

  const griddedRes = await AQ.gridS5pNetCdfBuffer(new ArrayBuffer(32), 'no2', [12.0, 41.0, 13.0, 42.0], 10, 10);
  assert(griddedRes.grid instanceof Float32Array, 'gridded.grid must be Float32Array');
  assert(griddedRes.indexGrid instanceof Float32Array, 'gridded.indexGrid must be Float32Array');
  assert.strictEqual(griddedRes.grid, griddedRes.indexGrid, 'gridded.grid and indexGrid should reference same array');
  assert.strictEqual(griddedRes.width, 10);
  assert.strictEqual(griddedRes.height, 10);
  assert.strictEqual(griddedRes.matchedFootprints, 1, 'Only 1 footprint should pass both QA and AOI bounds');
  assert(griddedRes.validCells > 0, 'Splatting should populate valid cells');
  // Scaled val: 40e-6 * 1e6 = 40.0 µmol/m²
  assert(Math.abs(griddedRes.mean - 40.0) < 1e-2, `Expected mean ~40.0, got ${griddedRes.mean}`);
  assert.strictEqual(mockUnlinks.length, 1, 'Temporary NetCDF file must be unlinked');
  console.log('✓ Sentinel-5P NetCDF mock gridding verified.');

  console.log('--- 11. Testing Sentinel-2 AQ Series (loadSentinel2AqSeries) ---');
  const mockReader = {
    searchSentinel2Stac: async () => [
      {
        id: 's2_20230810_tileA',
        properties: { datetime: '2023-08-10T10:00:00Z', 'eo:cloud_cover': 20 },
        assets: {
          B01: { href: 'https://cdn/b01.tif' },
          B02: { href: 'https://cdn/b02.tif' },
          scl: { href: 'https://cdn/scl.tif' }
        }
      },
      {
        id: 's2_20230810_tileB_cloudier',
        properties: { datetime: '2023-08-10T10:05:00Z', 'eo:cloud_cover': 55 },
        assets: {
          coastal: { href: 'https://cdn/b01.tif' },
          blue: { href: 'https://cdn/b02.tif' },
          scl: { href: 'https://cdn/scl.tif' }
        }
      },
      {
        id: 's2_20230815_tileC',
        properties: { datetime: '2023-08-15T10:00:00Z', 'eo:cloud_cover': 5 },
        assets: {
          coastal: { href: 'https://cdn/b01.tif' },
          blue: { href: 'https://cdn/b02.tif' }
        }
      }
    ],
    readCogBandToGrid: async (asset, item, bbox, w, h) => {
      const g = new Float32Array(w * h);
      g.fill(asset.href.includes('b01') ? 0.3 : 0.1);
      return g;
    },
    readCogSclMask: async (item, bbox, w, h) => {
      if (!item?.assets?.scl) return null;
      const m = new Uint8Array(w * h);
      m[0] = 1; // Mask first cell
      return m;
    }
  };
  globalThis.SentiStacCogReader = mockReader;

  const s2Frames = await AQ.loadSentinel2AqSeries([10, 40, 11, 41], 'asi', '2023-08-01', '2023-08-20', {
    width: 4,
    height: 4,
    maskClouds: true
  });
  assert.strictEqual(s2Frames.length, 2, 'Date deduplication should keep lowest cloud tile per UTC day');
  assert.strictEqual(s2Frames[0].dateStr, '2023-08-10');
  assert.strictEqual(s2Frames[1].dateStr, '2023-08-15');
  assert.strictEqual(s2Frames[0].id, 's2_20230810_tileA');
  assert(s2Frames[0].grid instanceof Float32Array, 'Frame grid must be Float32Array');
  assert(s2Frames[0].indexGrid instanceof Float32Array, 'Frame indexGrid must be Float32Array');
  assert.strictEqual(s2Frames[0].sensor, 's2');
  assert.strictEqual(s2Frames[0].mode, 'asi');
  assert(Number.isNaN(s2Frames[0].grid[0]), 'Masked pixel 0 should be NaN');
  // (0.3 - 0.1) / (0.3 + 0.1) = 0.5
  assert(Math.abs(s2Frames[0].grid[1] - 0.5) < 1e-4, 'Unmasked cell 1 should be 0.5');

  // Test alias mapping (e.g. 'aot' -> 's2_aot', 'pm25' -> 'pm25_proxy')
  mockReader.searchSentinel2Stac = async () => [
    {
      id: 's2_aot_item',
      properties: { datetime: '2023-08-01T10:00:00Z', 'eo:cloud_cover': 0 },
      assets: { AOT: { href: 'https://cdn/aot.tif' } }
    }
  ];
  mockReader.readCogBandToGrid = async (asset, item, bbox, w, h) => {
    const g = new Float32Array(w * h);
    g.fill(0.18);
    return g;
  };
  const aotFrames = await AQ.loadSentinel2AqSeries([10, 40, 11, 41], 'aot', '2023-08-01', '2023-08-02', { width: 2, height: 2 });
  assert.strictEqual(aotFrames.length, 1);
  assert.strictEqual(aotFrames[0].mode, 's2_aot', 'Alias "aot" should resolve to mode "s2_aot"');
  assert(Math.abs(aotFrames[0].grid[0] - 0.18) < 1e-5, 'AOT grid[0] should be ~0.18');
  console.log('✓ Sentinel-2 AQ series loading, alias resolution, and deduplication verified.');

  console.log('--- 12. Testing Sentinel-5P Series (loadSentinel5pSeries) ---');
  globalThis.fetch = async function (url, opts = {}) {
    if (url.includes('stac/v1/search')) {
      return {
        ok: true,
        json: async () => ({
          features: [
            {
              id: 's5p_f1',
              properties: { datetime: '2023-08-05T12:00:00Z' },
              assets: { no2: { href: 'https://blob/1.nc' } }
            },
            {
              id: 's5p_f2',
              properties: { datetime: '2023-08-01T12:00:00Z' },
              assets: { no2: { href: 'https://blob/2.nc' } }
            },
            {
              id: 's5p_f3',
              properties: { datetime: '2023-08-03T12:00:00Z' },
              assets: { no2: { href: 'https://blob/3.nc' } }
            }
          ]
        })
      };
    }
    if (url.includes('api/sas/v1/sign')) {
      return { ok: true, json: async () => ({ href: 'https://blob/signed.nc' }) };
    }
    if (url.includes('.nc')) {
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) };
    }
    return origFetch.apply(this, arguments);
  };

  const s5pFrames = await AQ.loadSentinel5pSeries([12, 41, 13, 42], 'no2', '2023-08-01', '2023-08-06', {
    maxScenes: 2,
    width: 5,
    height: 5
  });
  // 3 features subsampled down to 2
  assert.strictEqual(s5pFrames.length, 2, 'Subsampling should limit frames to maxScenes');
  // Chronological ascending check: 2023-08-01 should come before 2023-08-05
  assert.strictEqual(s5pFrames[0].dateStr, '2023-08-01');
  assert.strictEqual(s5pFrames[1].dateStr, '2023-08-05');
  assert.strictEqual(s5pFrames[0].sensor, 's5p');
  assert.strictEqual(s5pFrames[0].shortLabel, 'NO₂');
  assert(s5pFrames[0].grid instanceof Float32Array);
  assert(s5pFrames[0].indexGrid instanceof Float32Array);
  console.log('✓ Sentinel-5P series subsampling and chronological ordering verified.');

  console.log('\n========================================');
  console.log('All air quality tests passed successfully!');
  console.log('========================================');
}

testWorkerAndLegend().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

