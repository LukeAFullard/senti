/**
 * @file js/core/00-export-services.js
 * Universal, zero-DOM geospatial and media export engine.
 *
 * Designed to elevate UX, DX, and AX (Agent Experience):
 * - UX: Fast, reliable downloads of GeoTIFF rasters, RFC 7946 GeoJSON vectors,
 *       audit-grade reproducibility HTML reports, CSV time series, and GIF animations.
 * - DX: Clean, modular APIs (`exportGeoTiff`, `exportGeoJson`, `exportCsv`, `exportReproducibilityReport`)
 *       eliminating duplicated raster-window calculations and download boilerplate across modules.
 * - AX: Pure, headless-testable generation functions (`buildGeoTiffMetadata`, `buildGeoJsonFeatureCollection`,
 *       `buildCsvString`, `generateReproducibilityReportHtml`) that run cleanly in Node.js and browser environments.
 *
 * UMD module: CommonJS (Node.js) + Browser window.SentiExportServices.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SentiExportServices = factory();
    if (typeof window !== 'undefined') {
      window.SentiExportServices = root.SentiExportServices;
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ============================================================================
  // String & HTML Escaping Utilities (Pure Zero-DOM)
  // ============================================================================

  /**
   * Sanitizes string for safe embedding into HTML.
   * @param {any} value
   * @returns {string}
   */
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  /**
   * Formats a single value as an RFC 4180 compliant CSV cell.
   * @param {any} value
   * @returns {string}
   */
  function formatCsvCell(value) {
    const str = String(value ?? '');
    return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  }

  /**
   * Serializes headers and tabular rows into a standard CSV string.
   * @param {Array<string>} headers
   * @param {Array<Array<any>>} rows
   * @returns {string}
   */
  function buildCsvString(headers, rows) {
    const headerLine = headers.map(formatCsvCell).join(',');
    const rowLines = (rows || []).map(row => row.map(formatCsvCell).join(','));
    return [headerLine, ...rowLines].join('\n');
  }

  /**
   * Extracts EPSG integer from a CRS string (e.g. "EPSG:32632", "urn:ogc:def:crs:EPSG::4326") or number.
   * @param {string|number} crs
   * @returns {number|null}
   */
  function parseEpsgCode(crs) {
    if (typeof crs === 'number' && Number.isInteger(crs)) return crs;
    if (!crs) return null;
    const match = String(crs).match(/EPSG\s*(?::+|(?:\s+))(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  // ============================================================================
  // RFC 7946 GeoJSON Vector Builders (Pure Zero-DOM)
  // ============================================================================

  /**
   * Constructs an RFC 7946 compliant GeoJSON FeatureCollection.
   * Coordinates MUST be WGS84 [longitude, latitude]; deprecated root `crs` is omitted.
   *
   * @param {Array<Object>} features - Array of GeoJSON Feature objects
   * @param {Object} [options={}]
   * @param {string} [options.name='Sentinel Analysis Geometry']
   * @returns {Object}
   */
  function buildGeoJsonFeatureCollection(features = [], options = {}) {
    return {
      type: 'FeatureCollection',
      name: options.name || 'Sentinel Analysis Geometry',
      features: Array.isArray(features) ? features : []
    };
  }

  /**
   * Creates a GeoJSON Polygon Feature from ring coordinates.
   * @param {Array<[number, number]>} ring - Array of [lon, lat] coordinates
   * @param {Object} [properties={}]
   * @returns {Object}
   */
  function createPolygonFeature(ring, properties = {}) {
    // Ensure polygon ring is closed
    const coordinates = ring.slice();
    if (coordinates.length >= 3) {
      const first = coordinates[0];
      const last = coordinates[coordinates.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coordinates.push([first[0], first[1]]);
      }
    }
    return {
      type: 'Feature',
      properties: { ...properties },
      geometry: {
        type: 'Polygon',
        coordinates: [coordinates]
      }
    };
  }

  /**
   * Creates a GeoJSON Point Feature.
   * @param {number} lon
   * @param {number} lat
   * @param {Object} [properties={}]
   * @returns {Object}
   */
  function createPointFeature(lon, lat, properties = {}) {
    return {
      type: 'Feature',
      properties: { ...properties },
      geometry: {
        type: 'Point',
        coordinates: [Number(lon), Number(lat)]
      }
    };
  }

  /**
   * Creates a GeoJSON LineString Feature from transect coordinates.
   * @param {Array<[number, number]>} coordinates - Array of [lon, lat] points
   * @param {Object} [properties={}]
   * @returns {Object}
   */
  function createLineStringFeature(coordinates, properties = {}) {
    return {
      type: 'Feature',
      properties: { ...properties },
      geometry: {
        type: 'LineString',
        coordinates: coordinates.slice()
      }
    };
  }

  // ============================================================================
  // GeoTIFF Georeferencing & Serialization (Pure Zero-DOM Calculations)
  // ============================================================================

  /**
   * Prepares georeferenced GeoTIFF metadata tags (ModelPixelScale, ModelTiepoint, GeoKeys).
   *
   * @param {Object} raw - Raster descriptor object
   * @param {number} raw.width - Analysis raster width
   * @param {number} raw.height - Analysis raster height
   * @param {Array<number>} raw.refWindow - Sub-pixel window [xMin, yMin, xMax, yMax]
   * @param {Array<number>} raw.refOrigin - Reference image origin [originX, originY]
   * @param {Array<number>} raw.refRes - Native resolution [resX, resY]
   * @param {string|number} raw.refCrs - Projected CRS or EPSG identifier
   * @param {Object} [options={}]
   * @param {string} [options.description] - Custom ImageDescription tag
   * @param {string|number} [options.noData='-9999'] - NODATA string tag
   * @returns {Object} GeoTIFF metadata dictionary ready for GeoTIFF.writeArrayBuffer
   */
  function buildGeoTiffMetadata(raw, options = {}) {
    if (!raw || !raw.refWindow || !raw.refOrigin || !raw.refRes) {
      throw new Error('Raster reference metadata (refWindow, refOrigin, refRes) is required to build GeoTIFF tags.');
    }

    const epsg = parseEpsgCode(raw.refCrs);
    if (!epsg) {
      throw new Error('Could not identify a valid EPSG code for this grid; export cancelled to prevent unreferenced GeoTIFF.');
    }

    const w = raw.refWindow;
    const sw = w[2] - w[0];
    const sh = w[3] - w[1];

    const scaleX = Math.abs((raw.refRes[0] * sw) / raw.width);
    const scaleY = Math.abs((raw.refRes[1] * sh) / raw.height);
    const tieX = raw.refOrigin[0] + w[0] * raw.refRes[0];
    const tieY = raw.refOrigin[1] + w[1] * raw.refRes[1];

    return {
      width: raw.width,
      height: raw.height,
      ModelPixelScale: [scaleX, scaleY, 0],
      ModelTiepoint: [0, 0, 0, tieX, tieY, 0],
      GTModelTypeGeoKey: epsg === 4326 ? 2 : 1,
      ...(epsg === 4326 ? { GeographicTypeGeoKey: 4326 } : { ProjectedCSTypeGeoKey: epsg }),
      GDAL_NODATA: String(options.noData ?? '-9999'),
      ImageDescription: options.description || `Sentinel Remote Sensing Analysis; EPSG:${epsg}; ${new Date().toISOString()}`
    };
  }

  /**
   * Sanitizes a numeric grid replacing NaNs and Infinities with the designated NODATA value.
   * @param {Float32Array|Array<number>} grid
   * @param {number} [noData=-9999]
   * @returns {Float32Array}
   */
  function cleanRasterData(grid, noData = -9999) {
    const clean = new Float32Array(grid.length);
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      clean[i] = Number.isFinite(v) ? v : noData;
    }
    return clean;
  }

  /**
   * Encodes a georeferenced raster grid into a binary GeoTIFF ArrayBuffer.
   * Requires GeoTIFF.writeArrayBuffer (available in browser GeoTIFF library).
   *
   * @param {Object} raw - Raster descriptor
   * @param {Float32Array|Array<number>} grid - Numeric data grid
   * @param {Object} [options={}]
   * @returns {Promise<ArrayBuffer>}
   */
  async function writeGeoTiffBuffer(raw, grid, options = {}) {
    const geoTiffLib = options.geoTiffLib || (typeof GeoTIFF !== 'undefined' ? GeoTIFF : null);
    if (!geoTiffLib || typeof geoTiffLib.writeArrayBuffer !== 'function') {
      throw new Error('GeoTIFF.writeArrayBuffer is not available in the current environment.');
    }

    const noData = options.noData !== undefined ? Number(options.noData) : -9999;
    const cleanData = cleanRasterData(grid, noData);
    const metadata = buildGeoTiffMetadata(raw, { ...options, noData });

    return await geoTiffLib.writeArrayBuffer(cleanData, metadata);
  }

  // ============================================================================
  // Reproducibility Audit Report Generator (Pure Zero-DOM)
  // ============================================================================

  /**
   * Generates a self-contained HTML audit document detailing analysis parameters,
   * STAC acquisition IDs, cloud statistics, and scientific methodological caveats.
   *
   * @param {Object} options
   * @param {string} [options.title='Sentinel Analysis Reproducibility Report']
   * @param {Array<[string, any]>} options.settings - Array of [Key, Value] parameter pairs
   * @param {Array<Object>} [options.scenes=[]] - Array of STAC scene items or descriptors
   * @param {string} [options.appName='Sentinel-2 & Multi-Sensor Earth Observation Explorer']
   * @returns {string} Complete HTML document string
   */
  function generateReproducibilityReportHtml(options = {}) {
    const title = escapeHtml(options.title || 'Sentinel Analysis Reproducibility Report');
    const appName = escapeHtml(options.appName || 'Sentinel-2 & Multi-Sensor Earth Observation Explorer');
    const timestamp = escapeHtml(new Date().toISOString());

    const settings = options.settings || [];
    const settingRows = settings
      .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
      .join('');

    const scenes = options.scenes || [];
    const sceneRows = scenes.map(sc => {
      const dateStr = sc.dateStr || (sc.properties && sc.properties.datetime ? sc.properties.datetime.slice(0, 10) : 'N/A');
      const id = sc.id || 'N/A';
      const cloud = Number.isFinite(sc.sceneCloudPct)
        ? `${sc.sceneCloudPct.toFixed(1)}%`
        : (sc.properties && Number.isFinite(sc.properties['eo:cloud_cover'])
            ? `${sc.properties['eo:cloud_cover'].toFixed(1)}%`
            : 'N/A');
      const uri = (sc.properties && sc.properties['s2:product_uri']) || '';
      return `<tr><td>${escapeHtml(dateStr)}</td><td>${escapeHtml(id)}</td><td>${escapeHtml(cloud)}</td><td>${escapeHtml(uri)}</td></tr>`;
    }).join('');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    body { font: 15px/1.5 system-ui, -apple-system, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    h1, h2 { line-height: 1.2; color: #111; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 13px; }
    th, td { border: 1px solid #bbb; padding: 7px 10px; text-align: left; overflow-wrap: anywhere; }
    th { background: #eee; font-weight: 600; }
    p { max-width: 850px; }
    .warning { border-left: 4px solid #b8860b; padding: 10px 14px; background: #fff8e5; margin: 1.5rem 0; font-size: 14px; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-family: monospace; background: #e0e0e0; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>Generated <span class="badge">${timestamp}</span> by the browser-based ${appName}.</p>
  <div class="warning">
    <strong>Scientific Interpretation &amp; Limitations:</strong> Satellite indices, radar backscatter, and trace gas proxies are remote-sensing screening evidence; they are not direct in-situ concentration or moisture measurements. Cloud, shadow, and atmospheric interference can affect pixel fidelity. Results should be interpreted within regional environmental context.
  </div>

  <h2>Analysis Configuration & Parameters</h2>
  <table>
    <tbody>
      ${settingRows}
    </tbody>
  </table>

  <h2>Contributed Satellite Acquisitions</h2>
  <p>Scene cloud cover reflects whole-tile catalogue metadata. Observation support grids reflect valid, clear pixels over the selected Area of Interest (AOI) after cloud, shadow, and snow classification.</p>
  <table>
    <thead>
      <tr>
        <th>Acquisition Date</th>
        <th>STAC Item Identifier</th>
        <th>Scene Cloud Cover</th>
        <th>Product URI</th>
      </tr>
    </thead>
    <tbody>
      ${sceneRows || '<tr><td colspan="4" style="text-align:center;color:#666;">No individual scenes recorded.</td></tr>'}
    </tbody>
  </table>

  <h2>Methods, Algorithms & Data Provenance</h2>
  <p>The analysis pipeline streams cloud-optimized GeoTIFFs (COGs) and STAC catalog metadata on demand, processing spectral bands and SAR backscatter directly on the client. Spatial summaries are calculated over the project's analysis grid. Save this document alongside associated GeoTIFF, GeoJSON, and CSV exports to maintain a complete scientific audit trail.</p>
</body>
</html>`;
  }

  // ============================================================================
  // Browser Download Facilitator
  // ============================================================================

  /**
   * Triggers a browser file download from a Blob, typed array, or text string.
   * Safe in headless/Node.js environments (returns descriptor object instead of throwing).
   *
   * @param {Blob|ArrayBuffer|string} content
   * @param {string} filename
   * @param {string} [mimeType='application/octet-stream']
   * @returns {{ downloaded: boolean, filename: string, size?: number }}
   */
  function triggerBlobDownload(content, filename, mimeType = 'application/octet-stream') {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      const size = content ? (content.byteLength || content.length || (content.size !== undefined ? content.size : 0)) : 0;
      return { downloaded: false, filename, size };
    }

    let blob;
    if (content instanceof Blob) {
      blob = content;
    } else if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
      blob = new Blob([content], { type: mimeType });
    } else {
      blob = new Blob([String(content)], { type: mimeType });
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 6000);

    return { downloaded: true, filename, size: blob.size };
  }

  // ============================================================================
  // High-Level Export Functions
  // ============================================================================

  /**
   * Exports features as an RFC 7946 GeoJSON file.
   * @param {Array<Object>} features
   * @param {string} [filename='sentinel_geometries.geojson']
   * @param {Object} [options={}]
   * @returns {Object} Download result
   */
  function exportGeoJson(features, filename = 'sentinel_geometries.geojson', options = {}) {
    const collection = buildGeoJsonFeatureCollection(features, options);
    const jsonStr = JSON.stringify(collection, null, 2);
    return triggerBlobDownload(jsonStr, filename, 'application/geo+json;charset=utf-8');
  }

  /**
   * Exports tabular data as a CSV file.
   * @param {Array<string>} headers
   * @param {Array<Array<any>>} rows
   * @param {string} [filename='sentinel_data.csv']
   * @returns {Object} Download result
   */
  function exportCsv(headers, rows, filename = 'sentinel_data.csv') {
    const csvContent = buildCsvString(headers, rows);
    return triggerBlobDownload(csvContent, filename, 'text/csv;charset=utf-8;');
  }

  /**
   * Exports a reproducibility audit report as a self-contained HTML file.
   * @param {Object} options
   * @param {string} [filename='sentinel_reproducibility.html']
   * @returns {Object} Download result
   */
  function exportReproducibilityReport(options = {}, filename = 'sentinel_reproducibility.html') {
    const html = generateReproducibilityReportHtml(options);
    return triggerBlobDownload(html, filename, 'text/html;charset=utf-8');
  }

  /**
   * Exports a georeferenced GeoTIFF raster.
   * @param {Object} raw - Raster metadata descriptor
   * @param {Float32Array} grid - Pixel values
   * @param {string} [filename='sentinel_raster.tif']
   * @param {Object} [options={}]
   * @returns {Promise<Object>} Download result
   */
  async function exportGeoTiff(raw, grid, filename = 'sentinel_raster.tif', options = {}) {
    const buffer = await writeGeoTiffBuffer(raw, grid, options);
    return triggerBlobDownload(buffer, filename, 'image/tiff');
  }

  return {
    escapeHtml,
    formatCsvCell,
    buildCsvString,
    parseEpsgCode,
    buildGeoJsonFeatureCollection,
    createPolygonFeature,
    createPointFeature,
    createLineStringFeature,
    buildGeoTiffMetadata,
    cleanRasterData,
    writeGeoTiffBuffer,
    generateReproducibilityReportHtml,
    triggerBlobDownload,
    exportGeoJson,
    exportCsv,
    exportReproducibilityReport,
    exportGeoTiff
  };
});
