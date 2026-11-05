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
