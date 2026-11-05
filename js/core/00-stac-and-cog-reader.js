/**
 * @file js/core/00-stac-and-cog-reader.js
 * @description DOM-free STAC search pagination, UTM CRS detection, and GeoTIFF window reader.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SentiStacCogReader = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_S2_STAC_URL = 'https://earth-search.aws.element84.com/v1/search';
  const BBOX_EDGE_SEGMENTS = 24;

  function parseEpsg(value) {
    if (!value) return null;
    if (Number.isInteger(Number(value))) return Number(value);
    const match = String(value).match(/(?:EPSG:)?(\d{4,6})/i);
    return match ? Number(match[1]) : null;
  }

  function isUtmEpsg(code) {
    return Number.isInteger(code) && ((code >= 32601 && code <= 32660) || (code >= 32701 && code <= 32760));
  }

  function getRasterCrs(image, item, bbox) {
    const properties = item?.properties || {};
    let geoKeys = {};
    try { if (typeof image.getGeoKeys === 'function') geoKeys = image.getGeoKeys() || {}; } catch (_) {}
    const candidates = [
      parseEpsg(properties['proj:epsg']),
      parseEpsg(properties['proj:code']),
      parseEpsg(geoKeys.ProjectedCSTypeGeoKey)
    ];
    let epsg = candidates.find(isUtmEpsg);
    if (!epsg) {
      const lon = (bbox[0] + bbox[2]) / 2, lat = (bbox[1] + bbox[3]) / 2;
      const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
      epsg = (lat < 0 ? 32700 : 32600) + zone;
    }
    const zone = epsg % 100;
    const isSouth = epsg >= 32701 && epsg <= 32760;
    const crsName = 'EPSG:' + epsg;
    if (typeof proj4 !== 'undefined') {
      proj4.defs(crsName, '+proj=utm +zone=' + zone + (isSouth ? ' +south' : '') + ' +datum=WGS84 +units=m +no_defs +type=crs');
    }
    return crsName;
  }

  function transformBboxPerimeter(bbox, sourceCrs, targetCrs, segments = BBOX_EDGE_SEGMENTS) {
    const [west, south, east, north] = bbox;
    const perimeter = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      perimeter.push(
        [west + (east - west) * t, south],
        [west + (east - west) * t, north],
        [west, south + (north - south) * t],
        [east, south + (north - south) * t]
      );
    }
    return perimeter.map(pt => proj4(sourceCrs, targetCrs, pt));
  }

  function calculatePixelWindow(bbox, image, rasterCrs) {
    const origin = image.getOrigin();
    const resolution = image.getResolution();
    const imageWidth = image.getWidth(), imageHeight = image.getHeight();
    const projected = transformBboxPerimeter(bbox, 'EPSG:4326', rasterCrs, BBOX_EDGE_SEGMENTS);
    const pixelX = projected.map(p => (p[0] - origin[0]) / resolution[0]);
    const pixelY = projected.map(p => (p[1] - origin[1]) / resolution[1]);
    const window = [
      Math.max(0, Math.floor(Math.min(...pixelX))),
      Math.max(0, Math.floor(Math.min(...pixelY))),
      Math.min(imageWidth, Math.ceil(Math.max(...pixelX))),
      Math.min(imageHeight, Math.ceil(Math.max(...pixelY)))
    ];
    if (window[0] >= window[2] || window[1] >= window[3]) {
      throw new Error('Selected bounding box does not overlap this scene tile.');
    }
    return { window, origin, resolution };
  }

  function getAssetBandInfo(asset, fallback = { scale: 0.0001, offset: -0.1, nodata: 0 }) {
    const href = String(asset?.href || '').toLowerCase();
    const title = String(asset?.title || '').toLowerCase();
    const isAtm = /\b(aot|wvp)\b/.test(href) || /aerosol|water\s*vapou?r/.test(title);
    const defaultFb = isAtm ? { scale: 0.001, offset: 0.0, nodata: 0 } : fallback;
    const band = asset && Array.isArray(asset['raster:bands']) ? asset['raster:bands'][0] : null;
    return {
      scale: band && Number.isFinite(Number(band.scale)) ? Number(band.scale) : defaultFb.scale,
      offset: band && Number.isFinite(Number(band.offset)) ? Number(band.offset) : defaultFb.offset,
      nodata: band && band.nodata !== undefined ? Number(band.nodata) : defaultFb.nodata
    };
  }

  async function readCogBandToGrid(asset, item, bbox, width, height, pool = null) {
    if (!asset?.href) throw new Error('Missing Sentinel-2 band asset href.');
    const tiff = await GeoTIFF.fromUrl(asset.href);
    const image = await tiff.getImage();
    const crs = getRasterCrs(image, item, bbox);
    const { window } = calculatePixelWindow(bbox, image, crs);
    const opts = { window, width, height, resampleMethod: 'bilinear' };
    if (pool) opts.pool = pool;
    const raw = await image.readRasters(opts);
    const info = getAssetBandInfo(asset);
    const scaled = new Float32Array(raw[0].length);
    for (let i = 0; i < scaled.length; i++) {
      const v = Number(raw[0][i]);
      scaled[i] = (!Number.isFinite(v) || v === info.nodata) ? NaN : v * info.scale + info.offset;
    }
    return scaled;
  }

  async function readCogSclMask(item, bbox, width, height, pool = null) {
    const sclAsset = item?.assets?.scl;
    if (!sclAsset?.href) return null;
    const tiff = await GeoTIFF.fromUrl(sclAsset.href);
    const image = await tiff.getImage();
    const crs = getRasterCrs(image, item, bbox);
    const { window } = calculatePixelWindow(bbox, image, crs);
    const opts = { window, width, height, resampleMethod: 'nearest' };
    if (pool) opts.pool = pool;
    const raw = await image.readRasters(opts);
    const scl = raw[0];
    const mask = new Uint8Array(scl.length);
    for (let i = 0; i < scl.length; i++) {
      const c = Number(scl[i]);
      if (c === 0 || c === 1 || c === 3 || c === 8 || c === 9 || c === 10 || c === 11) {
        mask[i] = 1;
      }
    }
    return mask;
  }

  async function searchSentinel2Stac(bbox, startDate, endDate, maxCloud = 40, limit = 80, stacUrl = DEFAULT_S2_STAC_URL) {
    const startIso = startDate.includes('T') ? startDate : `${startDate}T00:00:00Z`;
    const endIso = endDate.includes('T') ? endDate : `${endDate}T23:59:59Z`;
    const res = await fetch(stacUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-2-c1-l2a'],
        bbox,
        datetime: `${startIso}/${endIso}`,
        limit,
        sortby: [{ field: 'properties.datetime', direction: 'asc' }]
      })
    });
    if (!res.ok) throw new Error(`Sentinel-2 STAC HTTP ${res.status}`);
    const data = await res.json();
    return (data.features || []).filter(item => {
      const cc = Number(item?.properties?.['eo:cloud_cover']);
      return Number.isFinite(cc) && cc <= maxCloud;
    });
  }

  return {
    parseEpsg,
    isUtmEpsg,
    getRasterCrs,
    transformBboxPerimeter,
    calculatePixelWindow,
    getAssetBandInfo,
    readCogBandToGrid,
    readCogSclMask,
    searchSentinel2Stac
  };
});
