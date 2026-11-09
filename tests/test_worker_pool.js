/**
 * @file tests/test_worker_pool.js
 * Automated test suite for js/core/00-worker-pool.js (SentiWorkerPool).
 */

const test = require('node:test');
const assert = require('node:assert');
const SentiWorkerPool = require('../js/core/00-worker-pool.js');

test('SentiWorkerPool exports and API structure', () => {
  assert.strictEqual(typeof SentiWorkerPool, 'object');
  assert.strictEqual(typeof SentiWorkerPool.isSupported, 'function');
  assert.strictEqual(typeof SentiWorkerPool.insidePolygon, 'function');
  assert.strictEqual(typeof SentiWorkerPool.quickSelect, 'function');
  assert.strictEqual(typeof SentiWorkerPool.medianOf, 'function');
  assert.strictEqual(typeof SentiWorkerPool.calculateIndexPixel, 'function');
  assert.strictEqual(typeof SentiWorkerPool.otsuThreshold, 'function');
  assert.strictEqual(typeof SentiWorkerPool.TASK_HANDLERS, 'object');
  assert.strictEqual(typeof SentiWorkerPool.WorkerPool, 'function');
  assert.strictEqual(typeof SentiWorkerPool.createPool, 'function');
  assert.strictEqual(typeof SentiWorkerPool.runTask, 'function');
  assert.strictEqual(typeof SentiWorkerPool.executeFallback, 'function');
  assert.strictEqual(typeof SentiWorkerPool.getStatus, 'function');
});

test('insidePolygon ray-casting algorithm', () => {
  const square = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10]
  ];
  // Inside
  assert.strictEqual(SentiWorkerPool.insidePolygon(5, 5, square), true);
  assert.strictEqual(SentiWorkerPool.insidePolygon(1, 1, square), true);
  // Outside
  assert.strictEqual(SentiWorkerPool.insidePolygon(-1, 5, square), false);
  assert.strictEqual(SentiWorkerPool.insidePolygon(15, 5, square), false);
  assert.strictEqual(SentiWorkerPool.insidePolygon(5, 12, square), false);
});

test('quickSelect and medianOf statistical helpers', () => {
  const arr = new Float32Array([10, 2, 5, 8, 1, 9, 3]);
  // Median of 7 elements (1, 2, 3, 5, 8, 9, 10) is 5
  const med = SentiWorkerPool.medianOf(arr, 7);
  assert.strictEqual(med, 5);

  const arrEven = new Float32Array([10, 2, 8, 4]); // 2, 4, 8, 10 -> median = 6
  const medEven = SentiWorkerPool.medianOf(arrEven, 4);
  assert.strictEqual(medEven, 6);

  // Quickselect 2nd smallest element (index 1 -> 4)
  const clone = new Float32Array([10, 2, 8, 4]);
  const val = SentiWorkerPool.quickSelect(clone, 0, 3, 1);
  assert.strictEqual(val, 4);
});

test('calculateIndexPixel remote sensing equations', () => {
  // NDVI: (NIR - Red) / (NIR + Red) -> (0.8 - 0.2) / 1.0 = 0.6
  const ndvi = SentiWorkerPool.calculateIndexPixel('ndvi', [0.8, 0.2]);
  assert(Math.abs(ndvi - 0.6) < 1e-5);

  // MNDWI: (Green - SWIR) / (Green + SWIR) -> (0.6 - 0.2) / 0.8 = 0.5
  const mndwi = SentiWorkerPool.calculateIndexPixel('mndwi', [0.6, 0.2]);
  assert(Math.abs(mndwi - 0.5) < 1e-5);

  // EVI
  const evi = SentiWorkerPool.calculateIndexPixel('evi', [0.6, 0.1, 0.05]);
  assert(Number.isFinite(evi));

  // S2 AOT scaling (10..10000 -> /1000)
  const aot = SentiWorkerPool.calculateIndexPixel('s2_aot', [250]);
  assert.strictEqual(aot, 0.25);

  // PM2.5 proxy
  const pm25 = SentiWorkerPool.calculateIndexPixel('pm25_proxy', [250, 1500]);
  assert(Number.isFinite(pm25));
  assert(pm25 > 0);

  // Aerosol classification
  const aerosol = SentiWorkerPool.calculateIndexPixel('aerosol_type', [0.2, 0.15, 0.3]);
  assert(Number.isInteger(aerosol));

  // NaN propagation on invalid bands
  assert(Number.isNaN(SentiWorkerPool.calculateIndexPixel('ndvi', [NaN, 0.2])));
});

test('otsuThreshold bimodal water/flood binarization', () => {
  // Bimodal distribution: 50 water pixels around -20 dB, 50 land pixels around -8 dB
  const data = new Float32Array(100);
  for (let i = 0; i < 50; i++) data[i] = -22 + (i % 5); // [-22 .. -18]
  for (let i = 50; i < 100; i++) data[i] = -10 + (i % 5); // [-10 .. -6]

  const result = SentiWorkerPool.otsuThreshold(data, {
    numBins: 64,
    polarity: 'less',
    createMask: true
  });

  assert(Number.isFinite(result.threshold), 'Threshold should be finite');
  // Optimal threshold should cleanly separate [-22..-18] and [-10..-6], so between -18 and -10 (e.g. -14)
  assert(result.threshold > -18 && result.threshold < -10, `Threshold ${result.threshold} should fall between clusters`);
  assert(result.betweenClassVariance > 0, 'Variance should be positive');
  assert.strictEqual(result.count, 100);

  // Check mask: first 50 should be 1 (water), last 50 should be 0 (land)
  assert.strictEqual(result.mask.length, 100);
  for (let i = 0; i < 50; i++) assert.strictEqual(result.mask[i], 1, `Pixel ${i} should be classified as water`);
  for (let i = 50; i < 100; i++) assert.strictEqual(result.mask[i], 0, `Pixel ${i} should be classified as land`);

  // Edge cases: empty array
  const empty = SentiWorkerPool.otsuThreshold(new Float32Array(0));
  assert(Number.isNaN(empty.threshold));

  // Uniform array
  const uniform = SentiWorkerPool.otsuThreshold(new Float32Array([5, 5, 5, 5]));
  assert.strictEqual(uniform.threshold, 5);
  assert.strictEqual(uniform.count, 4);
});

test('TASK_HANDLERS index-grid calculation', () => {
  const b1 = new Float32Array([0.8, 0.7, 0.9, 0.1]);
  const b2 = new Float32Array([0.2, 0.3, 0.1, 0.5]);
  const res = SentiWorkerPool.TASK_HANDLERS['index-grid']({
    length: 4,
    width: 2,
    height: 2,
    mode: 'ndvi',
    bandArrays: [b1, b2],
    mask: new Uint8Array([0, 0, 1, 0]), // pixel 2 masked
    waterMaskOn: false
  });

  assert.strictEqual(res.indexGrid.length, 4);
  assert(Math.abs(res.indexGrid[0] - 0.6) < 1e-4); // (0.8-0.2)/(0.8+0.2) = 0.6
  assert(Math.abs(res.indexGrid[1] - 0.4) < 1e-4); // (0.7-0.3)/(0.7+0.3) = 0.4
  assert(Number.isNaN(res.indexGrid[2])); // masked
  assert(Math.abs(res.indexGrid[3] - (-0.6666)) < 1e-3); // (0.1-0.5)/(0.1+0.5) = -0.6666
  assert(Number.isFinite(res.meanVal));
});

test('TASK_HANDLERS composite-index statistics', () => {
  const g1 = new Float32Array([0.2, 0.4]);
  const g2 = new Float32Array([0.6, 0.8]);
  const g3 = new Float32Array([0.4, 0.6]);

  // Mean
  const meanRes = SentiWorkerPool.TASK_HANDLERS['composite-index']({
    length: 2,
    grids: [g1, g2, g3],
    stat: 'mean'
  });
  assert(Math.abs(meanRes.indexGrid[0] - 0.4) < 1e-5);
  assert(Math.abs(meanRes.indexGrid[1] - 0.6) < 1e-5);

  // Max
  const maxRes = SentiWorkerPool.TASK_HANDLERS['composite-index']({
    length: 2,
    grids: [g1, g2, g3],
    stat: 'max'
  });
  assert(Math.abs(maxRes.indexGrid[0] - 0.6) < 1e-5);
  assert(Math.abs(maxRes.indexGrid[1] - 0.8) < 1e-5);

  // Median
  const medRes = SentiWorkerPool.TASK_HANDLERS['composite-index']({
    length: 2,
    grids: [g1, g2, g3],
    stat: 'median'
  });
  assert(Math.abs(medRes.indexGrid[0] - 0.4) < 1e-5);
  assert(Math.abs(medRes.indexGrid[1] - 0.6) < 1e-5);
});

test('TASK_HANDLERS seasonal-anomaly calculation', () => {
  const target = new Float32Array([1.5, 0.5]);
  const b1 = new Float32Array([0.5, 0.5]);
  const b2 = new Float32Array([0.6, 0.5]);
  const b3 = new Float32Array([0.4, 0.5]);

  const res = SentiWorkerPool.TASK_HANDLERS['seasonal-anomaly']({
    length: 2,
    target,
    baselines: [b1, b2, b3],
    minObs: 3,
    maxZ: 5
  });

  assert.strictEqual(res.indexGrid.length, 2);
  assert.strictEqual(res.baselineMedian.length, 2);
  assert.strictEqual(res.support.length, 2);

  // Baseline median for pixel 0 is 0.5, target is 1.5 -> positive anomaly
  assert(Math.abs(res.baselineMedian[0] - 0.5) < 1e-5);
  assert(res.indexGrid[0] > 0, 'Target exceeds baseline, Z-score should be positive');
  assert.strictEqual(res.support[0], 3);

  // Pixel 1: target matches baseline perfectly -> Z-score is 0
  assert.strictEqual(res.indexGrid[1], 0);
});

test('TASK_HANDLERS polygon-stats calculation', () => {
  const grid = new Float32Array([
    10, 20,
    30, 40
  ]);
  const stats = SentiWorkerPool.TASK_HANDLERS['polygon-stats']({
    width: 2,
    height: 2,
    win: [0, 0, 2, 2],
    origin: [0, 0],
    res: [1, 1],
    ring: [[-1, -1], [3, -1], [3, 3], [-1, 3]], // encloses all 4 pixels
    grid
  });

  assert.strictEqual(stats.count, 4);
  assert.strictEqual(stats.mean, 25);
  assert.strictEqual(stats.min, 10);
  assert.strictEqual(stats.max, 40);
  assert(Number.isFinite(stats.sd));
  assert(Number.isFinite(stats.median));
});

test('SentiWorkerPool runTask execution with fallback and status introspection', async () => {
  const pool = SentiWorkerPool.createPool({ fallbackOnly: true });
  const status = pool.getStatus();
  assert.strictEqual(status.fallbackOnly, true);
  assert.strictEqual(status.activeWorkers, 0);

  const res = await pool.runTask('otsu-threshold', {
    grid: new Float32Array([1, 2, 3, 10, 11, 12]),
    numBins: 32
  });
  assert(Number.isFinite(res.threshold));
  assert(res.threshold > 3 && res.threshold < 10);

  // Error handling for unknown task
  await assert.rejects(
    async () => {
      await pool.runTask('unknown-task', {});
    },
    /Unknown task type/
  );

  pool.terminate();
  assert.strictEqual(pool.getStatus().isTerminated, true);
});
