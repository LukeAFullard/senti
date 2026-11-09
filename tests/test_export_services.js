/**
 * @file tests/test_export_services.js
 * Automated test suite for js/core/00-export-services.js (SentiExportServices).
 */

const test = require('node:test');
const assert = require('node:assert');
const Export = require('../js/core/00-export-services.js');

test('SentiExportServices module exports and structure', () => {
  assert.strictEqual(typeof Export, 'object');
  assert.strictEqual(typeof Export.escapeHtml, 'function');
  assert.strictEqual(typeof Export.formatCsvCell, 'function');
  assert.strictEqual(typeof Export.buildCsvString, 'function');
  assert.strictEqual(typeof Export.parseEpsgCode, 'function');
  assert.strictEqual(typeof Export.buildGeoJsonFeatureCollection, 'function');
  assert.strictEqual(typeof Export.createPolygonFeature, 'function');
  assert.strictEqual(typeof Export.createPointFeature, 'function');
  assert.strictEqual(typeof Export.createLineStringFeature, 'function');
  assert.strictEqual(typeof Export.buildGeoTiffMetadata, 'function');
  assert.strictEqual(typeof Export.cleanRasterData, 'function');
  assert.strictEqual(typeof Export.writeGeoTiffBuffer, 'function');
  assert.strictEqual(typeof Export.generateReproducibilityReportHtml, 'function');
  assert.strictEqual(typeof Export.triggerBlobDownload, 'function');
  assert.strictEqual(typeof Export.exportGeoJson, 'function');
  assert.strictEqual(typeof Export.exportCsv, 'function');
  assert.strictEqual(typeof Export.exportReproducibilityReport, 'function');
  assert.strictEqual(typeof Export.exportGeoTiff, 'function');
});

test('escapeHtml sanitizes dangerous characters', () => {
  assert.strictEqual(Export.escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  assert.strictEqual(Export.escapeHtml("AT&T 'special'"), 'AT&amp;T &#39;special&#39;');
  assert.strictEqual(Export.escapeHtml(null), '');
  assert.strictEqual(Export.escapeHtml(undefined), '');
  assert.strictEqual(Export.escapeHtml(123.45), '123.45');
});

test('formatCsvCell and buildCsvString RFC 4180 compliance', () => {
  assert.strictEqual(Export.formatCsvCell('simple'), 'simple');
  assert.strictEqual(Export.formatCsvCell('hello, world'), '"hello, world"');
  assert.strictEqual(Export.formatCsvCell('line1\nline2'), '"line1\nline2"');
  assert.strictEqual(Export.formatCsvCell('say "hello"'), '"say ""hello"""');

  const headers = ['date', 'station', 'val'];
  const rows = [
    ['2023-08-15', 'Central, Site A', 12.5],
    ['2023-08-16', 'Site "B"', 18.2]
  ];
  const csv = Export.buildCsvString(headers, rows);
  const expected = [
    'date,station,val',
    '2023-08-15,"Central, Site A",12.5',
    '2023-08-16,"Site ""B""",18.2'
  ].join('\n');
  assert.strictEqual(csv, expected);
});

test('parseEpsgCode extracts integer projection code', () => {
  assert.strictEqual(Export.parseEpsgCode('EPSG:32632'), 32632);
  assert.strictEqual(Export.parseEpsgCode('epsg:4326'), 4326);
  assert.strictEqual(Export.parseEpsgCode('EPSG::3857'), 3857);
  assert.strictEqual(Export.parseEpsgCode(32633), 32633);
  assert.strictEqual(Export.parseEpsgCode('urn:ogc:def:crs:EPSG::32759'), 32759);
  assert.strictEqual(Export.parseEpsgCode('WGS84'), null);
  assert.strictEqual(Export.parseEpsgCode(null), null);
});

test('GeoJSON vector features and FeatureCollection', () => {
  // Point
  const pt = Export.createPointFeature(175.61, -40.35, { name: 'Probe 1', value: 0.75 });
  assert.strictEqual(pt.type, 'Feature');
  assert.strictEqual(pt.geometry.type, 'Point');
  assert.deepStrictEqual(pt.geometry.coordinates, [175.61, -40.35]);
  assert.strictEqual(pt.properties.name, 'Probe 1');

  // LineString
  const line = Export.createLineStringFeature([[0, 0], [1, 1], [2, 2]], { role: 'transect' });
  assert.strictEqual(line.geometry.type, 'LineString');
  assert.strictEqual(line.geometry.coordinates.length, 3);

  // Polygon (auto-closing unclosed ring)
  const unclosed = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const poly = Export.createPolygonFeature(unclosed, { role: 'aoi' });
  assert.strictEqual(poly.geometry.type, 'Polygon');
  const ring = poly.geometry.coordinates[0];
  assert.strictEqual(ring.length, 5);
  assert.deepStrictEqual(ring[0], ring[4]); // closed

  // FeatureCollection
  const fc = Export.buildGeoJsonFeatureCollection([pt, line, poly], { name: 'Analysis AOI' });
  assert.strictEqual(fc.type, 'FeatureCollection');
  assert.strictEqual(fc.name, 'Analysis AOI');
  assert.strictEqual(fc.features.length, 3);
  // Ensure no deprecated root crs member per RFC 7946
  assert.strictEqual(fc.crs, undefined);
});

test('GeoTIFF metadata computation and raster data cleaning', () => {
  const raw = {
    width: 200,
    height: 100,
    refWindow: [10, 20, 110, 70], // sw = 100, sh = 50
    refOrigin: [500000, 4600000],
    refRes: [10, -10],
    refCrs: 'EPSG:32632'
  };

  const meta = Export.buildGeoTiffMetadata(raw, { noData: '-9999', description: 'Test GeoTIFF' });
  assert.strictEqual(meta.width, 200);
  assert.strictEqual(meta.height, 100);
  assert.strictEqual(meta.GTModelTypeGeoKey, 1); // Projected
  assert.strictEqual(meta.ProjectedCSTypeGeoKey, 32632);
  assert.strictEqual(meta.GDAL_NODATA, '-9999');
  assert.strictEqual(meta.ImageDescription, 'Test GeoTIFF');

  // Scale: |10 * 100 / 200| = 5, | -10 * 50 / 100 | = 5
  assert.deepStrictEqual(meta.ModelPixelScale, [5, 5, 0]);

  // Tiepoint: tieX = 500000 + 10 * 10 = 500100; tieY = 4600000 + 20 * (-10) = 4599800
  assert.deepStrictEqual(meta.ModelTiepoint, [0, 0, 0, 500100, 4599800, 0]);

  // Data cleaning
  const inputGrid = new Float32Array([0.5, NaN, 1.2, Infinity, -Infinity, 0.0]);
  const cleaned = Export.cleanRasterData(inputGrid, -9999);
  assert.strictEqual(cleaned[0], 0.5);
  assert.strictEqual(cleaned[1], -9999);
  assert(Math.abs(cleaned[2] - 1.2) < 1e-6);
  assert.strictEqual(cleaned[3], -9999);
  assert.strictEqual(cleaned[4], -9999);
  assert.strictEqual(cleaned[5], 0.0);
});

test('writeGeoTiffBuffer calls GeoTIFF writer with metadata and clean array', async () => {
  let capturedData = null;
  let capturedMeta = null;
  const mockGeoTiffLib = {
    writeArrayBuffer: async (data, metadata) => {
      capturedData = data;
      capturedMeta = metadata;
      return new ArrayBuffer(64);
    }
  };

  const raw = {
    width: 2,
    height: 2,
    refWindow: [0, 0, 2, 2],
    refOrigin: [0, 0],
    refRes: [10, -10],
    refCrs: 'EPSG:4326'
  };
  const grid = new Float32Array([1.0, NaN, 2.0, 3.0]);

  const buf = await Export.writeGeoTiffBuffer(raw, grid, { geoTiffLib: mockGeoTiffLib });
  assert(buf instanceof ArrayBuffer);
  assert.strictEqual(buf.byteLength, 64);
  assert.strictEqual(capturedMeta.width, 2);
  assert.strictEqual(capturedMeta.GTModelTypeGeoKey, 2); // Geographic
  assert.strictEqual(capturedMeta.GeographicTypeGeoKey, 4326);
  assert.strictEqual(capturedData[1], -9999); // NaN cleaned
});

test('generateReproducibilityReportHtml produces self-contained audit document', () => {
  const html = Export.generateReproducibilityReportHtml({
    title: 'Custom Test Report',
    appName: 'Senti Earth Observation Suite',
    settings: [
      ['Analysis mode', 'NDVI'],
      ['Temporal view', 'Median composite'],
      ['Threshold', '0.4']
    ],
    scenes: [
      { id: 'S2A_MSIL2A_20230815', dateStr: '2023-08-15', sceneCloudPct: 4.2 }
    ]
  });

  assert(html.includes('Custom Test Report'));
  assert(html.includes('Senti Earth Observation Suite'));
  assert(html.includes('NDVI'));
  assert(html.includes('Median composite'));
  assert(html.includes('S2A_MSIL2A_20230815'));
  assert(html.includes('4.2%'));
  assert(html.includes('<!doctype html>'));
  assert(html.includes('Scientific Interpretation &amp; Limitations'));
});

test('Headless triggerBlobDownload fallback', () => {
  const res = Export.triggerBlobDownload('test,content', 'sample.csv', 'text/csv');
  assert.strictEqual(res.downloaded, false);
  assert.strictEqual(res.filename, 'sample.csv');
  assert.strictEqual(res.size, 12);

  const resJson = Export.exportGeoJson([], 'test.geojson');
  assert.strictEqual(resJson.downloaded, false);
  assert.strictEqual(resJson.filename, 'test.geojson');

  const resCsv = Export.exportCsv(['col1'], [['val1']], 'test.csv');
  assert.strictEqual(resCsv.downloaded, false);
  assert.strictEqual(resCsv.filename, 'test.csv');

  const resReport = Export.exportReproducibilityReport({}, 'report.html');
  assert.strictEqual(resReport.downloaded, false);
  assert.strictEqual(resReport.filename, 'report.html');
});
