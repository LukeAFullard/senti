const test = require('node:test');
const assert = require('node:assert/strict');
const reader = require('../js/core/00-stac-and-cog-reader.js');

test('SentiStacCogReader exports', () => {
  const expectedKeys = [
    'parseEpsg',
    'isUtmEpsg',
    'getRasterCrs',
    'transformBboxPerimeter',
    'calculatePixelWindow',
    'getAssetBandInfo',
    'readCogBandToGrid',
    'readCogSclMask',
    'searchSentinel2Stac'
  ];
  for (const key of expectedKeys) {
    assert.ok(reader[key] !== undefined, `Missing export: ${key}`);
  }
});

test('parseEpsg & isUtmEpsg', () => {
  assert.equal(reader.parseEpsg(32632), 32632);
  assert.equal(reader.parseEpsg('EPSG:32632'), 32632);
  assert.equal(reader.parseEpsg('32718'), 32718);
  assert.equal(reader.parseEpsg('invalid'), null);
  assert.equal(reader.parseEpsg(null), null);

  assert.equal(reader.isUtmEpsg(32601), true);
  assert.equal(reader.isUtmEpsg(32660), true);
  assert.equal(reader.isUtmEpsg(32701), true);
  assert.equal(reader.isUtmEpsg(32760), true);
  assert.equal(reader.isUtmEpsg(4326), false);
  assert.equal(reader.isUtmEpsg(3857), false);
});

test('getAssetBandInfo', () => {
  // Atmospheric band
  const atmAsset = { href: 'https://example.com/aot.tif', title: 'Aerosol Optical Thickness' };
  const atmInfo = reader.getAssetBandInfo(atmAsset);
  assert.equal(atmInfo.scale, 0.001);
  assert.equal(atmInfo.offset, 0.0);

  // Surface reflectance band
  const b04Asset = { href: 'https://example.com/b04.tif', title: 'Red' };
  const b04Info = reader.getAssetBandInfo(b04Asset);
  assert.equal(b04Info.scale, 0.0001);
  assert.equal(b04Info.offset, -0.1);

  // Explicit raster:bands overrides
  const customAsset = {
    href: 'https://example.com/custom.tif',
    'raster:bands': [{ scale: 0.05, offset: 1.5, nodata: -999 }]
  };
  const customInfo = reader.getAssetBandInfo(customAsset);
  assert.equal(customInfo.scale, 0.05);
  assert.equal(customInfo.offset, 1.5);
  assert.equal(customInfo.nodata, -999);
});

test('getRasterCrs fallback calculation', () => {
  const bbox = [12.0, 41.0, 13.0, 42.0]; // Italy, UTM Zone 33N
  const crs = reader.getRasterCrs({}, {}, bbox);
  assert.equal(crs, 'EPSG:32633');

  const southBbox = [18.0, -34.0, 19.0, -33.0]; // Cape Town, UTM Zone 34S
  const southCrs = reader.getRasterCrs({}, {}, southBbox);
  assert.equal(southCrs, 'EPSG:32734');
});

test('transformBboxPerimeter error when proj4 is missing', () => {
  const origProj4 = globalThis.proj4;
  delete globalThis.proj4;
  try {
    assert.throws(
      () => reader.transformBboxPerimeter([10, 40, 11, 41], 'EPSG:4326', 'EPSG:32632'),
      /proj4 is not available/
    );
  } finally {
    globalThis.proj4 = origProj4;
  }
});

test('transformBboxPerimeter transforms edge segments with proj4', () => {
  const origProj4 = globalThis.proj4;
  globalThis.proj4 = (src, dst, pt) => [pt[0] * 10, pt[1] * 20];
  try {
    const bbox = [0, 0, 10, 10];
    const segments = 2;
    const pts = reader.transformBboxPerimeter(bbox, 'EPSG:4326', 'EPSG:3857', segments);
    // (segments + 1) * 4 points = 12 points
    assert.equal(pts.length, 12);
    // Point [0, 0] becomes [0, 0]
    assert.deepEqual(pts[0], [0, 0]);
    // Point [10, 10] becomes [100, 200]
    assert.ok(pts.some(p => p[0] === 100 && p[1] === 200));
  } finally {
    globalThis.proj4 = origProj4;
  }
});

test('calculatePixelWindow valid bbox and overlap checking', () => {
  const origProj4 = globalThis.proj4;
  // Mock projection: maps degrees directly to projected coordinates [x * 10, y * 10]
  globalThis.proj4 = (src, dst, pt) => [pt[0] * 10, pt[1] * 10];
  try {
    const mockImage = {
      getOrigin: () => [0, 1000],
      getResolution: () => [1, -1],
      getWidth: () => 1000,
      getHeight: () => 1000
    };

    // Valid overlapping bbox: x in [10, 20] -> projected [100, 200] -> pixelX [100, 200]
    // y in [10, 20] -> projected [100, 200] -> pixelY (200 - 1000)/-1 = 800, (100 - 1000)/-1 = 900
    const res = reader.calculatePixelWindow([10, 10, 20, 20], mockImage, 'EPSG:32632');
    assert.deepEqual(res.window, [100, 800, 200, 900]);
    assert.deepEqual(res.origin, [0, 1000]);
    assert.deepEqual(res.resolution, [1, -1]);

    // Non-overlapping bbox: outside image bounds
    assert.throws(
      () => reader.calculatePixelWindow([200, 200, 300, 300], mockImage, 'EPSG:32632'),
      /Selected bounding box does not overlap this scene tile/
    );
  } finally {
    globalThis.proj4 = origProj4;
  }
});

