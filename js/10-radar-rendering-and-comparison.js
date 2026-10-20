// Extracted from the original single-file app.
// Load order is significant; see ../README.md before moving/removing scripts.
// Radar rendering, optical-radar comparison and radar UI event handlers

'use strict';

  const RADAR_SAS_SIGN_URL = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign';

  function clearRadarOverlay() {
    if (radarOverlay && map.hasLayer(radarOverlay)) map.removeLayer(radarOverlay);
    radarOverlay = null;
    radarClearBtn.disabled = true;
  }

  function clearSeasonalAnomalyOverlay() {
    if (seasonalAnomalyOverlay && map.hasLayer(seasonalAnomalyOverlay)) map.removeLayer(seasonalAnomalyOverlay);
    seasonalAnomalyOverlay = null;
    seasonalAnomalyResult = null;
    clearAnomalyBtn.disabled = true;
    exportAnomalyBtn.disabled = true;
    seasonalAnomalyLegend.style.display = 'none';
  }

  function clearRadarCompareOverlay() {
    if (radarCompareOverlay && map.hasLayer(radarCompareOverlay)) map.removeLayer(radarCompareOverlay);
    radarCompareOverlay = null;
    radarCompareClearBtn.disabled = true;
    radarCompareLegend.style.display = 'none';
  }

  async function signPlanetaryComputerAsset(href) {
    if (!href || !/^https:\/\//i.test(href)) throw new Error('Radar asset URL is missing or is not HTTPS.');
    if (/[?&](?:sig|se)=/i.test(href)) return href;
    const url = new URL(RADAR_SAS_SIGN_URL);
    url.searchParams.set('href', href);
    const response = await fetch(url.toString());
    if (response.status === 401 || response.status === 403) {
      throw new Error('The Sentinel-1 RTC asset-signing service requires access that this no-login HTML app cannot provide. Try an eligible Planetary Computer account workflow, or use Sentinel-2-only mode.');
    }
    if (!response.ok) throw new Error(`Asset signing service returned HTTP ${response.status}.`);
    const data = await response.json();
    if (!data.href) throw new Error('Asset signing service did not return a signed href.');
    return data.href;
  }

  radarSearchBtn.addEventListener('click', async () => {
    if (!drawnBbox) { radarStatus.textContent = 'Draw the AOI rectangle on the map first.'; return; }
    const start = startDateInput.value || '2023-12-01';
    const end = endDateInput.value || '2024-03-01';
    if (new Date(end) < new Date(start)) { radarStatus.textContent = 'End date must be on or after start date.'; return; }
    radarSearchBtn.disabled = true;
    radarSearchBtn.textContent = 'Searching…';
    radarStatus.textContent = 'Searching the public Sentinel-1 RTC STAC catalogue...';
    try {
      const response = await fetch(RADAR_STAC_SEARCH_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collections: ['sentinel-1-rtc'], bbox: drawnBbox, datetime: `${start}T00:00:00Z/${end}T23:59:59Z`, limit: 100 })
      });
      if (!response.ok) throw new Error(`Sentinel-1 STAC HTTP ${response.status}.`);
      const data = await response.json();
      const remoteRadarScenes = (data.features || []).filter(item => {
        const a = item.assets || {};
        return Boolean((a.vv?.href && a.vh?.href) || (a.hh?.href && a.hv?.href) || a.vv?.href || a.hh?.href);
      });
      const seenRadarIds = new Set(remoteRadarScenes.map(item => item.id));
      radarScenes = [...remoteRadarScenes, ...radarLocalItems.filter(item => !seenRadarIds.has(item.id))]
        .sort((a,b) => new Date(a.properties?.datetime || 0) - new Date(b.properties?.datetime || 0));
      radarRawCache.clear();
      radarSceneSelect.innerHTML = '';
      if (!radarScenes.length) {
        radarSceneSelect.innerHTML = '<option value="">No matching RTC scenes</option>';
        radarBaselineSelect.innerHTML = '<option value="">No matching RTC scenes</option>';
        radarSceneSelect.disabled = true; radarBaselineSelect.disabled = true; radarRenderBtn.disabled = true; radarCompareBtn.disabled = true;
        radarStatus.textContent = 'No Sentinel-1 RTC scenes with supported polarization assets matched this AOI/date range. Try a longer date range.';
        return;
      }
      radarBaselineSelect.innerHTML = '';
      for (const item of radarScenes) {
        const option = document.createElement('option');
        option.value = item.id;
        const props = item.properties || {};
        const pols = (props['sar:polarizations'] || []).join('/');
        const orbit = props['sat:orbit_state'] || 'orbit ?';
        option.textContent = `${getSceneDateStr(item)} | ${pols || 'SAR'} | ${orbit} | ${item.id}`;
        radarSceneSelect.appendChild(option);
        radarBaselineSelect.appendChild(option.cloneNode(true));
      }
      if (radarScenes.length > 1) {
        radarSceneSelect.value = radarScenes[radarScenes.length - 1].id;
        radarBaselineSelect.value = radarScenes[0].id;
      }
      radarSceneSelect.disabled = false;
      radarBaselineSelect.disabled = radarScenes.length < 2;
      radarRenderBtn.disabled = false;
      radarCompareBtn.disabled = !(radarScenes.length > 1 && diffModeChk.checked && activeRenderedState?.isDiff);
      radarStatus.textContent = `${radarScenes.length} Sentinel-1 RTC item(s) found. Select current and baseline dates for a radar layer or optical–radar change comparison. Showing up to 100 results from the public catalogue.`;
      log(`Sentinel-1 RTC search returned ${radarScenes.length} scene(s) for ${start} to ${end}.`);
    } catch (err) {
      radarStatus.textContent = `Radar search failed: ${err.message}. Check your internet connection and retry.`;
      log('Sentinel-1 search error: ' + err.message);
    } finally { radarSearchBtn.disabled = false; radarSearchBtn.textContent = 'Search Sentinel-1 RTC'; }
  });

  async function readRadarAsset(asset, item, bbox, reference = null) {
    const href = await signPlanetaryComputerAsset(asset.href);
    const tiff = await GeoTIFF.fromUrl(href);
    const image = await tiff.getImage();
    const crs = getRasterCrs(image, item, bbox);
    const pixelInfo = reference
      ? calculatePixelWindowForReferenceGrid(reference, image, crs)
      : calculatePixelWindow(bbox, image, crs);
    const size = reference?.size || getOutputSize(pixelInfo.window);
    const raw = await image.readRasters(rasterReadOptions({ window: pixelInfo.window, width: size.width, height: size.height, resampleMethod: 'bilinear' }));
    const bandMeta = Array.isArray(asset['raster:bands']) ? asset['raster:bands'][0] || {} : {};
    const dataType = String(bandMeta.data_type || '').toLowerCase();
    const scale = Number.isFinite(Number(bandMeta.scale)) ? Number(bandMeta.scale) : (/u?int(16|32)/.test(dataType) ? 0.0001 : 1);
    const offset = Number.isFinite(Number(bandMeta.offset)) ? Number(bandMeta.offset) : 0;
    const nodata = bandMeta.nodata !== undefined ? Number(bandMeta.nodata) : 0;
    const values = new Float32Array(raw[0].length);
    for (let i = 0; i < values.length; i++) {
      const v = Number(raw[0][i]);
      values[i] = (!Number.isFinite(v) || v === nodata || v <= 0) ? NaN : v * scale + offset;
    }
    return { values, image, pixelInfo, size, crs, scaleUsed: scale, nodata };
  }

  async function computeRadarScene(item) {
    if (radarRawCache.has(item.id)) return radarRawCache.get(item.id);
    if (!drawnBbox) throw new Error('Draw an AOI rectangle first.');
    if (item.localFileConfig) return computeLocalRadarScene(item);
    const a = item.assets || {};
    const coKey = a.vv?.href ? 'vv' : (a.hh?.href ? 'hh' : null);
    const crossKey = coKey === 'vv' ? (a.vh?.href ? 'vh' : null) : (coKey === 'hh' && a.hv?.href ? 'hv' : null);
    if (!coKey) throw new Error('This RTC scene has no supported co-polarisation asset.');
    const co = await readRadarAsset(a[coKey], item, drawnBbox);
    let cross = null;
    if (crossKey) cross = await readRadarAsset(a[crossKey], item, drawnBbox, { crs: co.crs, pixelInfo: co.pixelInfo, size: co.size });
    const total = co.values.length;
    const dCo = new Float32Array(total), dCross = cross ? new Float32Array(total) : null;
    for (let i=0; i<total; i++) {
      dCo[i] = Number.isFinite(co.values[i]) && co.values[i] > 0 ? 10 * Math.log10(co.values[i]) : NaN;
      if (dCross) dCross[i] = Number.isFinite(cross.values[i]) && cross.values[i] > 0 ? 10 * Math.log10(cross.values[i]) : NaN;
    }
    const raw = {
      id: item.id, dateStr: getSceneDateStr(item), width: co.size.width, height: co.size.height,
      refImage: {
        getOrigin: () => co.pixelInfo.origin.slice(),
        getResolution: () => co.pixelInfo.resolution.slice(),
        getWidth: () => co.size.width,
        getHeight: () => co.size.height
      }, refWindow: co.pixelInfo.window, refCrs: co.crs,
      refOrigin: co.pixelInfo.origin, refRes: co.pixelInfo.resolution, pixelInfo: co.pixelInfo,
      coDb: dCo, crossDb: dCross, coKey, crossKey, scaleUsed: co.scaleUsed,
      properties: item.properties || {}, asset: a[coKey]
    };
    radarRawCache.set(item.id, raw);
    return raw;
  }

  async function readLocalRadarCogs(file, bbox, reference, encoding) {
    if (!file) throw new Error('Choose a local Sentinel-1 RTC GeoTIFF file.');
    const tiff = await GeoTIFF.fromBlob(file);
    const image = await tiff.getImage();
    const crs = getRasterCrs(image, { properties: {} }, bbox);
    const pixelInfo = reference
      ? calculatePixelWindowForReferenceGrid(reference, image, crs)
      : calculatePixelWindow(bbox, image, crs);
    const size = reference?.size || getOutputSize(pixelInfo.window);
    const raster = await image.readRasters(rasterReadOptions({ window: pixelInfo.window, width: size.width, height: size.height, resampleMethod: 'bilinear' }));
    let nodata = null;
    try { if (typeof image.getGDALNoData === 'function') nodata = Number(image.getGDALNoData()); } catch (_) {}
    const values = new Float32Array(raster[0].length);
    for (let i=0;i<values.length;i++) {
      const v=Number(raster[0][i]);
      if (!Number.isFinite(v) || (Number.isFinite(nodata) && v===nodata)) { values[i]=NaN; continue; }
      if (encoding === 'linear') values[i] = v > 0 ? 10*Math.log10(v) : NaN;
      else values[i] = v;
    }
    return { values, image, pixelInfo, size, crs };
  }

  async function computeLocalRadarScene(item) {
    const cfg=item.localFileConfig;
    radarLocalStatus.textContent=`Reading local RTC raster${cfg.crossFile?' pair':' (co-polarisation only)'} for ${getSceneDateStr(item)}…`;
    const co=await readLocalRadarCogs(cfg.coFile,drawnBbox,null,cfg.encoding);
    const cross=cfg.crossFile ? await readLocalRadarCogs(cfg.crossFile,drawnBbox,{crs:co.crs,pixelInfo:co.pixelInfo,size:co.size},cfg.encoding) : null;
    const raw={
      id:item.id,dateStr:getSceneDateStr(item),width:co.size.width,height:co.size.height,
      refImage:{
        getOrigin: () => co.pixelInfo.origin.slice(),
        getResolution: () => co.pixelInfo.resolution.slice(),
        getWidth: () => co.size.width,
        getHeight: () => co.size.height
      },refWindow:co.pixelInfo.window,refCrs:co.crs,
      refOrigin:co.pixelInfo.origin,refRes:co.pixelInfo.resolution,pixelInfo:co.pixelInfo,
      coDb:co.values,crossDb:cross?cross.values:null,coKey:cfg.coLabel||'VV/HH',crossKey:cross?(cfg.crossLabel||'VH/HV'):null,
      scaleUsed:cfg.encoding==='linear'?'linear calibrated backscatter → 10·log10(value)':'already dB; no scaling',
      properties:item.properties||{},asset:null,localFile:true
    };
    radarRawCache.set(item.id,raw);
    return raw;
  }

  function populateRadarSceneControls(selectedCurrent=null, selectedBaseline=null) {
    const fill=(select, emptyLabel)=>{
      select.innerHTML='';
      if(!radarScenes.length){select.innerHTML=`<option value="">${escapeHtml(emptyLabel)}</option>`;return;}
      for(const item of radarScenes){
        const option=document.createElement('option'); option.value=item.id;
        const p=item.properties||{};
        const pols=(p['sar:polarizations']||[]).join('/');
        const source=item.localFileConfig?'Local RTC COG':'STAC RTC';
        option.textContent=`${getSceneDateStr(item)} | ${pols||'SAR'} | ${p['sat:orbit_state']||source} | ${item.id}`;
        select.appendChild(option);
      }
    };
    fill(radarSceneSelect,'Search for or load radar scenes first');
    fill(radarBaselineSelect,'At least two radar scenes required');
    radarSceneSelect.disabled = radarScenes.length === 0;
    radarBaselineSelect.disabled = radarScenes.length < 2;
    if(radarScenes.length){
      radarSceneSelect.value=selectedCurrent||radarScenes[radarScenes.length-1].id;
      radarBaselineSelect.value=selectedBaseline||radarScenes[0].id;
    }
    radarRenderBtn.disabled=!radarScenes.length;
    radarCompareBtn.disabled=!(radarScenes.length>1&&diffModeChk.checked&&(activeRenderedState?.panels?.[0]||activeRenderedState)?.isDiff);
    updateRadarCompareButton();
  }

  radarLoadLocalBtn.addEventListener('click', async () => {
    if (!drawnBbox) { radarLocalStatus.textContent='Draw the AOI rectangle first.'; return; }
    const nowCo=radarLocalCurrentCoInput.files?.[0], baseCo=radarLocalBaseCoInput.files?.[0];
    if(!nowCo||!baseCo){radarLocalStatus.textContent='Choose both current and baseline co-polarised RTC GeoTIFFs.';return;}
    const nowDate=radarLocalCurrentDateInput.value, baseDate=radarLocalBaseDateInput.value;
    if(!nowDate||!baseDate||nowDate===baseDate){radarLocalStatus.textContent='Provide two different acquisition dates for current and baseline rasters.';return;}
    const nowCross=radarLocalCurrentCrossInput.files?.[0]||null, baseCross=radarLocalBaseCrossInput.files?.[0]||null;
    radarLoadLocalBtn.disabled=true; radarLoadLocalBtn.textContent='Reading local rasters…';
    try{
      // Validate both local RTC files and clip them to the current AOI immediately.
      const encoding=radarLocalEncodingSelect.value;
      const nowCfg={coFile:nowCo,crossFile:nowCross,encoding,coLabel:'VV/HH local',crossLabel:'VH/HV local'};
      const baseCfg={coFile:baseCo,crossFile:baseCross,encoding,coLabel:'VV/HH local',crossLabel:'VH/HV local'};
      const makeItem=(date,tag,cfg)=>({
        id:`local_rtc_${tag}_${date}_${(cfg.coFile.name||'raster').replace(/[^a-z0-9_-]/gi,'_')}`,
        type:'Feature',collection:'local-sentinel-1-rtc',bbox:drawnBbox.slice(),
        properties:{datetime:`${date}T12:00:00Z`,'sar:polarizations':cfg.crossFile?['VV','VH']:['VV'],'sat:orbit_state':'local RTC COG'},
        assets:{},localFileConfig:cfg
      });
      const nowItem=makeItem(nowDate,'current',nowCfg), baseItem=makeItem(baseDate,'baseline',baseCfg);
      await Promise.all([computeLocalRadarScene(nowItem),computeLocalRadarScene(baseItem)]);
      for(const item of [nowItem,baseItem]){
        const old=radarLocalItems.findIndex(existing=>existing.id===item.id);
        if(old>=0){radarRawCache.delete(radarLocalItems[old].id);radarLocalItems.splice(old,1);}
        radarLocalItems.push(item);
      }
      radarScenes=[...radarScenes.filter(item=>!item.localFileConfig),...radarLocalItems]
        .sort((a,b)=>new Date(a.properties?.datetime||0)-new Date(b.properties?.datetime||0));
      populateRadarSceneControls(nowItem.id,baseItem.id);
      radarLocalStatus.innerHTML=`Loaded current (${escapeHtml(nowDate)}) and baseline (${escapeHtml(baseDate)}) RTC rasters locally. Current raster grid: ${nowItem.localFileConfig? (radarRawCache.get(nowItem.id)?.width||'')+' × '+(radarRawCache.get(nowItem.id)?.height||'') : 'ready'}. Files remain in this browser session only.`;
      radarStatus.textContent='Local Sentinel-1 RTC rasters are ready. Choose the current item to render the radar map.';
      log(`Loaded local Sentinel-1 RTC current/baseline files (${nowDate}, ${baseDate}) without uploading data.`);
    }catch(err){radarLocalStatus.textContent='Could not read local RTC GeoTIFFs: '+err.message;log('Local Sentinel-1 RTC load error: '+err.message);}
    finally{radarLoadLocalBtn.disabled=false;radarLoadLocalBtn.textContent='Load Local RTC Current + Baseline';}
  });

  function radarColor(value, mode) {
    if (!Number.isFinite(value)) return [0,0,0,0];
    if (mode === 'pol_diff') {
      if (value < 2) return [35,65,150,235];
      if (value < 5) return [45,165,200,235];
      if (value < 8) return [100,195,130,235];
      if (value < 12) return [245,205,70,240];
      return [195,55,40,240];
    }
    if (value < -25) return [25,55,125,235];
    if (value < -20) return [45,135,190,235];
    if (value < -15) return [70,180,130,235];
    if (value < -10) return [235,205,70,240];
    if (value < -5) return [235,125,45,240];
    return [165,35,45,240];
  }

  radarRenderBtn.addEventListener('click', async () => {
    const item = radarScenes.find(sc => sc.id === radarSceneSelect.value);
    if (!item) { radarStatus.textContent = 'Search for Sentinel-1 RTC scenes first.'; return; }
    radarRenderBtn.disabled = true;
    const original = radarRenderBtn.textContent;
    radarRenderBtn.textContent = 'Loading radar…';
    radarStatus.textContent = `Loading ${getSceneDateStr(item)} radar assets; this may take a moment for the first read...`;
    try {
      const raw = await computeRadarScene(item);
      const mode = radarMode.value;
      if (mode !== 'vv_db' && mode !== 'vh_db' && !raw.crossDb) throw new Error('This scene has only one polarisation; co-pol minus cross-pol is unavailable.');
      if (mode === 'vh_db' && !raw.crossDb) throw new Error('This scene has no cross-polarisation asset.');
      const values = mode === 'vv_db' ? raw.coDb : mode === 'vh_db' ? raw.crossDb : raw.coDb.map((v,i) => Number.isFinite(v) && Number.isFinite(raw.crossDb[i]) ? v - raw.crossDb[i] : NaN);
      const output = document.createElement('canvas'); output.width = raw.width; output.height = raw.height;
      const ctx = output.getContext('2d'); const img = ctx.createImageData(raw.width, raw.height);
      for (let i=0; i<values.length; i++) {
        const rgba = radarColor(values[i], mode), p = i*4;
        img.data[p]=rgba[0]; img.data[p+1]=rgba[1]; img.data[p+2]=rgba[2]; img.data[p+3]=rgba[3];
      }
      ctx.putImageData(img,0,0);
      const warped = warpCanvasToWebMercator(output, raw.refImage, raw.refWindow, raw.refCrs, MAX_MAP_OVERLAY_DIMENSION);
      clearRadarOverlay();
      radarOverlay = L.imageOverlay(warped.warpedCanvas.toDataURL('image/png'), warped.bounds, { opacity: 0.82, pane: 'radarPane' }).addTo(map);
      radarClearBtn.disabled = false;
      const label = mode === 'vv_db' ? `${raw.coKey.toUpperCase()} backscatter (dB)` : mode === 'vh_db' ? `${raw.crossKey.toUpperCase()} backscatter (dB)` : `${raw.coKey.toUpperCase()} − ${raw.crossKey.toUpperCase()} (dB)`;
      radarStatus.innerHTML = `<strong>${escapeHtml(raw.dateStr)} | ${escapeHtml(label)}</strong><br>Item: ${escapeHtml(raw.id)}<br>Orbit: ${escapeHtml(raw.properties['sat:orbit_state'] || 'not supplied')} | Instrument mode: ${escapeHtml(raw.properties['sar:instrument_mode'] || 'not supplied')} | Approx. grid: ${raw.width} × ${raw.height}.<br><span class="small-note">Asset scale applied: ${raw.scaleUsed}. The renderer converts positive RTC backscatter to dB; verify source asset scale metadata if using values quantitatively. The visual is clipped to the AOI and displayed above Sentinel-2.</span>`;
      log(`Sentinel-1 RTC layer displayed: ${raw.dateStr} ${label}.`);
    } catch (err) {
      radarStatus.textContent = `Could not render radar layer: ${err.message}`;
      log('Sentinel-1 render error: ' + err.message);
    } finally { radarRenderBtn.textContent = original; radarRenderBtn.disabled = !radarScenes.length; }
  });

  function radarGridForMode(raw, mode) {
    if (mode === 'vv_db') return raw.coDb;
    if (mode === 'vh_db') return raw.crossDb;
    if (!raw.crossDb) return null;
    const out = new Float32Array(raw.coDb.length);
    for (let i=0;i<out.length;i++) out[i]=Number.isFinite(raw.coDb[i])&&Number.isFinite(raw.crossDb[i])?raw.coDb[i]-raw.crossDb[i]:NaN;
    return out;
  }

  function updateRadarCompareButton() {
    const panel = activeRenderedState?.panels?.[0] || activeRenderedState;
    radarCompareBtn.disabled = !(radarScenes.length > 1 && diffModeChk.checked && panel?.isDiff && panel?.inspectGrid);
  }

  radarCompareBtn.addEventListener('click', async () => {
    const optPanel = activeRenderedState?.panels?.[0] || activeRenderedState;
    if (!diffModeChk.checked || !optPanel?.isDiff || !optPanel?.inspectGrid) {
      radarCompareStatus.textContent = 'Enable optical Change Detection, choose an optical baseline, and display the resulting Δ index first.'; return;
    }
    const radarNowItem = radarScenes.find(sc=>sc.id===radarSceneSelect.value);
    const radarBaseItem = radarScenes.find(sc=>sc.id===radarBaselineSelect.value);
    if (!radarNowItem || !radarBaseItem || radarNowItem.id===radarBaseItem.id) {
      radarCompareStatus.textContent = 'Choose two different Sentinel-1 acquisitions for current and baseline.'; return;
    }
    const opticalMode = outputMode.value;
    if (['rgb','rgb_bands','false_color','obs_count'].includes(opticalMode)) {
      radarCompareStatus.textContent = 'Choose a numeric optical index before comparing change direction.'; return;
    }
    if (temporalMode.value !== 'single') {
      radarCompareStatus.textContent = 'Use Individual Dates so optical current and baseline each represent one acquisition.'; return;
    }
    const opticalCurrentItem = displaySteps[Number(sceneSlider.value)]?.scenes?.[0];
    const opticalBaseItem = displaySteps[Number(baselineSelect.value)]?.scenes?.[0];
    if (!opticalCurrentItem || !opticalBaseItem) {
      radarCompareStatus.textContent = 'The current optical time-series step and baseline must each refer to a single acquisition.'; return;
    }
    const opticalGapDays = Math.abs(new Date(getSceneDateStr(opticalCurrentItem)+'T00:00:00Z')-new Date(getSceneDateStr(radarNowItem)+'T00:00:00Z'))/86400000;
    const baseGapDays = Math.abs(new Date(getSceneDateStr(opticalBaseItem)+'T00:00:00Z')-new Date(getSceneDateStr(radarBaseItem)+'T00:00:00Z'))/86400000;
    const opticalThreshold = Math.max(0, Number(opticalDeltaThresholdInput.value) || 0.02);
    const radarThreshold = Math.max(0, Number(radarDeltaThresholdInput.value) || 1.5);
    opticalDeltaThresholdInput.value = String(opticalThreshold);
    radarDeltaThresholdInput.value = String(radarThreshold);
    radarCompareBtn.disabled = true;
    radarCompareBtn.textContent = 'Comparing…';
    clearRadarCompareOverlay();
    try {
      radarCompareStatus.textContent = 'Loading radar current and baseline rasters…';
      const [radarNow, radarBase] = await Promise.all([computeRadarScene(radarNowItem), computeRadarScene(radarBaseItem)]);
      const nowVals = radarGridForMode(radarNow, radarMode.value);
      const baseValsSource = radarGridForMode(radarBase, radarMode.value);
      if (!nowVals || !baseValsSource) throw new Error('The selected radar display requires polarisation bands not present in one of the chosen acquisitions.');
      const baseVals = await resampleNumericGridToTarget(radarBase, baseValsSource, radarNow, 'Aligning radar baseline', radarCompareStatus);
      const radarDelta = new Float32Array(nowVals.length);
      for(let i=0;i<radarDelta.length;i++) radarDelta[i]=Number.isFinite(nowVals[i])&&Number.isFinite(baseVals[i])?nowVals[i]-baseVals[i]:NaN;
      const opticalRaw = optPanel.raw;
      const opticalDeltaOnRadar = await resampleNumericGridToTarget(opticalRaw, optPanel.inspectGrid, radarNow, 'Aligning optical change', radarCompareStatus);
      const out = new Uint8Array(radarDelta.length);
      let bothPos=0,bothNeg=0,opposite=0,oneOnly=0,quiet=0,total=0;
      for(let i=0;i<out.length;i++) {
        const od=opticalDeltaOnRadar[i], rd=radarDelta[i];
        if(!Number.isFinite(od)||!Number.isFinite(rd)) {out[i]=0;continue;}
        total++;
        const ob=Math.abs(od)>opticalThreshold, rb=Math.abs(rd)>radarThreshold;
        if(!ob&&!rb){out[i]=1;quiet++;}
        else if(ob!==rb){out[i]=2;oneOnly++;}
        else if(Math.sign(od)===Math.sign(rd)&&od>0){out[i]=3;bothPos++;}
        else if(Math.sign(od)===Math.sign(rd)&&od<0){out[i]=4;bothNeg++;}
        else {out[i]=5;opposite++;}
      }
      const colorForClass = c => c===1?[133,133,133,195]:c===2?[230,178,40,225]:c===3?[35,155,113,230]:c===4?[40,120,207,230]:c===5?[189,73,182,230]:[0,0,0,0];
      const classCanvas = document.createElement('canvas'); classCanvas.width=radarNow.width; classCanvas.height=radarNow.height;
      const cctx=classCanvas.getContext('2d'), img=cctx.createImageData(radarNow.width,radarNow.height);
      for(let i=0;i<out.length;i++){const rgba=colorForClass(out[i]),j=i*4;img.data[j]=rgba[0];img.data[j+1]=rgba[1];img.data[j+2]=rgba[2];img.data[j+3]=rgba[3];}
      cctx.putImageData(img,0,0);
      const warped=warpCanvasToWebMercator(classCanvas,radarNow.refImage,radarNow.refWindow,radarNow.refCrs,MAX_MAP_OVERLAY_DIMENSION);
      clearRadarCompareOverlay();
      radarCompareOverlay=L.imageOverlay(warped.warpedCanvas.toDataURL('image/png'),warped.bounds,{opacity:0.9,pane:'radarComparePane'}).addTo(map);
      radarCompareClearBtn.disabled=false; radarCompareLegend.style.display='block';
      const pct=n=>100*n/Math.max(1,total);
      const radarGapDays=Math.abs(new Date(getSceneDateStr(radarNowItem)+'T00:00:00Z')-new Date(getSceneDateStr(radarBaseItem)+'T00:00:00Z'))/86400000;
      radarCompareStatus.innerHTML=`<strong>Optical–radar directional change comparison</strong><br>Optical: Δ${escapeHtml(opticalMode.toUpperCase())}, ${escapeHtml(getSceneDateStr(opticalCurrentItem))} vs ${escapeHtml(getSceneDateStr(opticalBaseItem))}. Radar: ${escapeHtml(radarMode.value)}, ${escapeHtml(getSceneDateStr(radarNowItem))} vs ${escapeHtml(getSceneDateStr(radarBaseItem))} (${radarGapDays.toFixed(0)} days apart).<br>Paired raster cells: ${total.toLocaleString()}; same-sign positive: ${pct(bothPos).toFixed(1)}%; same-sign negative: ${pct(bothNeg).toFixed(1)}%; opposite directions: ${pct(opposite).toFixed(1)}%; only one exceeds threshold: ${pct(oneOnly).toFixed(1)}%; both below threshold: ${pct(quiet).toFixed(1)}%.<br><span class="small-note">The current observation dates differ by ${opticalGapDays.toFixed(0)} days and baseline dates differ by ${baseGapDays.toFixed(0)} days across the two sensors. Interpret cautiously when dates differ substantially. Agreement means only that the numeric changes have the same sign; it is not validation or proof of the same physical response.</span>`;
      log(`Optical–radar comparison displayed: ${total} paired cells; current optical/radar dates differ by ${opticalGapDays.toFixed(1)} days.`);
    } catch(err) {
      radarCompareStatus.textContent='Optical–radar comparison failed: '+err.message;
      log('Optical–radar comparison error: '+err.message);
    } finally {
      radarCompareBtn.textContent='Compare Optical + Radar Changes';
      updateRadarCompareButton();
    }
  });

  radarCompareClearBtn.addEventListener('click',()=>{
    clearRadarCompareOverlay();
    radarCompareStatus.textContent='Optical–radar comparison overlay cleared.';
  });

  radarClearBtn.addEventListener('click', () => {
    clearRadarOverlay(); radarStatus.textContent = 'Radar overlay cleared; selected scene remains available.';
  });
  radarMode.addEventListener('change', () => { if (radarOverlay && radarSceneSelect.value) radarRenderBtn.disabled = false; updateRadarCompareButton(); });
  radarSceneSelect.addEventListener('change', updateRadarCompareButton);
  radarBaselineSelect.addEventListener('change', updateRadarCompareButton);

  // Keep the calibration panel visibly relevant without auto-running a model fit.
  outputMode.addEventListener('change', () => {
    optramDiagnostics.style.borderColor = outputMode.value === 'optram' ? '#4daafc' : '#444';
  });

  runBtn.addEventListener('click', runPipeline);
