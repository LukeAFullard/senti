const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../js/core/00-toolkit-core.js');

test('SentiToolkitCore exports', () => {
  const expectedKeys = [
    'LRUCache',
    'mapConcurrent',
    'quickSelect',
    'calcArrayStat',
    'compositeGrids',
    'pointInPolygon',
    'summarizeWgs84Grid',
    'buildTransectPoints',
    'encodeAnimatedGIF',
    'writeWgs84GeoTiffBlob'
  ];
  for (const key of expectedKeys) {
    assert.ok(core[key] !== undefined, `Missing export: ${key}`);
  }
});

test('LRUCache functionality', () => {
  const cache = new core.LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1);
  cache.set('c', 3); // should evict 'b'
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('c'), true);
  cache.clear();
  assert.equal(cache.has('a'), false);
});

test('mapConcurrent functionality', async () => {
  const items = [1, 2, 3, 4, 5];
  const results = await core.mapConcurrent(items, 2, async (item) => item * 2);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test('quickSelect & calcArrayStat functionality', () => {
  const arr = new Float32Array([5, 1, 3, 2, 4]);
  const med = core.calcArrayStat(arr, 5, 'median');
  assert.equal(med, 3);
  const mean = core.calcArrayStat(arr, 5, 'mean');
  assert.equal(mean, 3);
  const max = core.calcArrayStat(arr, 5, 'max');
  assert.equal(max, 5);
  const min = core.calcArrayStat(arr, 5, 'min');
  assert.equal(min, 1);
});

test('compositeGrids functionality', () => {
  const g1 = new Float32Array([1, 2, NaN]);
  const g2 = new Float32Array([3, 4, 5]);
  const comp = core.compositeGrids([g1, g2], 'mean');
  assert.equal(comp[0], 2);
  assert.equal(comp[1], 3);
  assert.equal(comp[2], 5);
});

test('pointInPolygon & summarizeWgs84Grid', () => {
  const ring = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0]
  ];
  assert.equal(core.pointInPolygon(5, 5, ring), true);
  assert.equal(core.pointInPolygon(15, 5, ring), false);

  const grid = new Float32Array([
    10, 20,
    30, 40
  ]);
  const bbox = [0, 0, 10, 10];
  const summary = core.summarizeWgs84Grid(grid, 2, 2, bbox);
  assert.equal(summary.count, 4);
  assert.equal(summary.mean, 25);
  assert.equal(summary.min, 10);
  assert.equal(summary.max, 40);
});

test('buildTransectPoints functionality', () => {
  const coords = [
    [0, 0],
    [0, 1]
  ];
  const res = core.buildTransectPoints(coords, 5);
  assert.equal(res.numSamples, 5);
  assert.equal(res.points.length, 5);
  assert.equal(res.points[0].lat, 0);
  assert.equal(res.points[4].lat, 1);
});
