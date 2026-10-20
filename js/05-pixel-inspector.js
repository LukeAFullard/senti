// Extracted from the original single-file app.
// Load order is significant; see ../README.md before moving/removing scripts.
// Pixel inspector and hover sampling

'use strict';

  // Pixel Inspector (Map Hover + Multi-Panel Canvas Hover)
  // ============================================================================
  function sampleValueAtLonLat(rawObj, grid, lon, lat) {
    if (!rawObj) return null;
    const pt = proj4('EPSG:4326', rawObj.refCrs, [lon, lat]);
    const px = (pt[0] - rawObj.refOrigin[0]) / rawObj.refRes[0];
    const py = (pt[1] - rawObj.refOrigin[1]) / rawObj.refRes[1];
    const win = rawObj.refWindow;
    if (px < win[0] || px >= win[2] || py < win[1] || py >= win[3]) return null;
    const gx = Math.floor(((px - win[0]) / (win[2] - win[0])) * rawObj.width);
    const gy = Math.floor(((py - win[1]) / (win[3] - win[1])) * rawObj.height);
    if (gx < 0 || gy < 0 || gx >= rawObj.width || gy >= rawObj.height) return null;
    const idx = gy * rawObj.width + gx;
    if (grid) return grid[idx];
    if (rawObj.rgbChannels) {
      const [r, g, b, a] = rawObj.rgbChannels;
      return a[idx] === 0 ? null : `RGB(${r[idx]}, ${g[idx]}, ${b[idx]})`;
    }
    return null;
  }

  map.on('mousemove', function (e) {
    const { lat, lng } = e.latlng;
    if (!activeRenderedState) {
      inspectorText.textContent = `Lat: ${lat.toFixed(5)}, Lon: ${lng.toFixed(5)}`;
      return;
    }
    const parts = [`Lat: ${lat.toFixed(5)}, Lon: ${lng.toFixed(5)}`];
    for (const p of activeRenderedState.panels) {
      const val = sampleValueAtLonLat(p.raw, p.inspectGrid, lng, lat);
      const lbl = p.isDiff ? `Δ${p.mode.toUpperCase()}` : p.mode.toUpperCase();
      if (val === null || (typeof val === 'number' && !Number.isFinite(val))) {
        parts.push(`${lbl}: NoData`);
      } else if (typeof val === 'number') {
        parts.push(`${lbl}: ${val.toFixed(3)}`);
      } else {
        parts.push(`${lbl}: ${val}`);
      }
    }
    inspectorText.textContent = parts.join(' | ');
  });

  canvas.addEventListener('mousemove', function (e) {
    if (!activeRenderedState) return;
    const rect = canvas.getBoundingClientRect();
    const cx = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    const cy = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
    const panels = activeRenderedState.panels;
    const pw = panels[0].panelCanvas.width;
    const ph = panels[0].panelCanvas.height;
    const col = cx >= pw + 2 && panels.length > 1 ? 1 : 0;
    const row = cy >= ph + 2 && panels.length > 2 ? 1 : 0;
    const pIdx = Math.min(panels.length - 1, row * 2 + col);
    const panel = panels[pIdx];

    const localX = cx - col * (pw + 4);
    const localY = cy - row * (ph + 4);
    if (localX < 0 || localY < 0 || localX >= pw || localY >= ph) return;

    const gx = Math.min(panel.raw.width - 1, Math.floor((localX / pw) * panel.raw.width));
    const gy = Math.min(panel.raw.height - 1, Math.floor((localY / ph) * panel.raw.height));
    const idx = gy * panel.raw.width + gx;
    const prefix = panel.isDiff ? `Δ ${panel.mode.toUpperCase()}` : panel.mode.toUpperCase();

    if (panel.inspectGrid) {
      const v = panel.inspectGrid[idx];
      inspectorText.textContent = `[Panel ${pIdx + 1}: ${prefix}] Pixel (${gx}, ${gy}) | ${Number.isFinite(v) ? v.toFixed(3) : 'NoData / Masked'}`;
    } else if (panel.raw.rgbChannels) {
      const [r, g, b, a] = panel.raw.rgbChannels;
      inspectorText.textContent = `[Panel ${pIdx + 1}: ${prefix}] Pixel (${gx}, ${gy}) | ${a[idx] ? `RGB(${r[idx]}, ${g[idx]},${b[idx]})` : 'NoData / Masked'}`;
    }
  });

  // ============================================================================
