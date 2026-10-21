// Extracted from the original single-file app.
// Load order is significant; see ../README.md before moving/removing scripts.
// Runtime, DOM references, shared state, map setup and interaction

'use strict';

  'use strict';

  // ============================================================================
  // Self-Contained GIF89a Encoder (Zero External Dependencies)
  // ============================================================================
  function encodeAnimatedGIF(canvases, delayCs = 80) {
    const width = canvases[0].width;
    const height = canvases[0].height;
    const bytes = [];
    const writeByte = b => bytes.push(b & 0xff);
    const writeShort = s => { writeByte(s); writeByte(s >> 8); };
    const writeStr = s => { for (let i = 0; i < s.length; i++) writeByte(s.charCodeAt(i)); };

    writeStr('GIF89a');
    writeShort(width);
    writeShort(height);
    writeByte(0x70);
    writeByte(0);
    writeByte(0);

    writeByte(0x21); writeByte(0xff); writeByte(11);
    writeStr('NETSCAPE2.0');
    writeByte(3); writeByte(1); writeShort(0); writeByte(0);

    const palette = [];
    for (let r = 0; r < 6; r++) {
      for (let g = 0; g < 6; g++) {
        for (let b = 0; b < 6; b++) {
          palette.push([Math.round(r * 255 / 5), Math.round(g * 255 / 5), Math.round(b * 255 / 5)]);
        }
      }
    }
    while (palette.length < 256) palette.push([0, 0, 0]);

    function lzwEncode(indices, minCodeSize) {
      const out = [];
      const clearCode = 1 << minCodeSize;
      const eoiCode = clearCode + 1;
      let codeSize = minCodeSize + 1;
      let nextCode = eoiCode + 1;
      let dict = new Map();
      let bitBuf = 0, bitCnt = 0;

      const emit = code => {
        bitBuf |= (code << bitCnt);
        bitCnt += codeSize;
        while (bitCnt >= 8) {
          out.push(bitBuf & 0xff);
          bitBuf >>= 8;
          bitCnt -= 8;
        }
      };

      emit(clearCode);
      let prefix = indices[0];
      for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const key = (prefix << 8) | k;
        const found = dict.get(key);
        if (found !== undefined) {
          prefix = found;
        } else {
          emit(prefix);
          if (nextCode < 4096) {
            dict.set(key, nextCode++);
            if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
          } else {
            emit(clearCode);
            dict.clear();
            codeSize = minCodeSize + 1;
            nextCode = eoiCode + 1;
          }
          prefix = k;
        }
      }
      emit(prefix);
      emit(eoiCode);
      if (bitCnt > 0) out.push(bitBuf & 0xff);
      return out;
    }

    for (const srcCanvas of canvases) {
      const ctx = srcCanvas.getContext('2d');
      const imgData = ctx.getImageData(0, 0, width, height).data;
      const indices = new Uint8Array(width * height);

      for (let i = 0, p = 0; i < imgData.length; i += 4, p++) {
        if (imgData[i + 3] < 40) {
          indices[p] = 255;
        } else {
          const r = Math.round(imgData[i] * 5 / 255);
          const g = Math.round(imgData[i + 1] * 5 / 255);
          const b = Math.round(imgData[i + 2] * 5 / 255);
          indices[p] = r * 36 + g * 6 + b;
        }
      }

      writeByte(0x21); writeByte(0xf9); writeByte(4);
      writeByte(0x09);
      writeShort(delayCs);
      writeByte(255);
      writeByte(0);

      writeByte(0x2c);
      writeShort(0); writeShort(0);
      writeShort(width); writeShort(height);
      writeByte(0x87);

      for (let i = 0; i < 256; i++) {
        writeByte(palette[i][0]);
        writeByte(palette[i][1]);
        writeByte(palette[i][2]);
      }

      const minCodeSize = 8;
      writeByte(minCodeSize);
      const compressed = lzwEncode(indices, minCodeSize);
      for (let i = 0; i < compressed.length; i += 255) {
        const chunk = compressed.slice(i, i + 255);
        writeByte(chunk.length);
        for (let j = 0; j < chunk.length; j++) writeByte(chunk[j]);
      }
      writeByte(0);
    }

    writeByte(0x3b);
    return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
  }

  // ============================================================================
  // DOM & Application State
  // ============================================================================
  const logOutput = document.getElementById('logOutput');
  const runBtn = document.getElementById('runBtn');
  const plotAllBtn = document.getElementById('plotAllBtn');
  const csvBtn = document.getElementById('csvBtn');
  const pngBtn = document.getElementById('pngBtn');
  const gifBtn = document.getElementById('gifBtn');
  const geoTiffBtn = document.getElementById('geoTiffBtn');
  const geoJsonBtn = document.getElementById('geoJsonBtn');
  const reportBtn = document.getElementById('reportBtn');
  const optramDiagnosticsBtn = document.getElementById('optramDiagnosticsBtn');
  const optramDiagnosticsText = document.getElementById('optramDiagnosticsText');
  const optramDiagnostics = document.getElementById('optramDiagnostics');
  const radarMode = document.getElementById('radarMode');
  const radarSceneSelect = document.getElementById('radarSceneSelect');
  const radarBaselineSelect = document.getElementById('radarBaselineSelect');
  const radarCompareBtn = document.getElementById('radarCompareBtn');
  const radarCompareClearBtn = document.getElementById('radarCompareClearBtn');
  const radarCompareStatus = document.getElementById('radarCompareStatus');
  const radarCompareLegend = document.getElementById('radarCompareLegend');
  const radarLocalCurrentCoInput = document.getElementById('radarLocalCurrentCo');
  const radarLocalCurrentCrossInput = document.getElementById('radarLocalCurrentCross');
  const radarLocalCurrentDateInput = document.getElementById('radarLocalCurrentDate');
  const radarLocalBaseCoInput = document.getElementById('radarLocalBaseCo');
  const radarLocalBaseCrossInput = document.getElementById('radarLocalBaseCross');
  const radarLocalBaseDateInput = document.getElementById('radarLocalBaseDate');
  const radarLocalEncodingSelect = document.getElementById('radarLocalEncoding');
  const radarLoadLocalBtn = document.getElementById('radarLoadLocalBtn');
  const radarLocalStatus = document.getElementById('radarLocalStatus');
  const opticalDeltaThresholdInput = document.getElementById('opticalDeltaThreshold');
  const radarDeltaThresholdInput = document.getElementById('radarDeltaThreshold');
  const seasonalAnomalyBtn = document.getElementById('seasonalAnomalyBtn');
  const clearAnomalyBtn = document.getElementById('clearAnomalyBtn');
  const exportAnomalyBtn = document.getElementById('exportAnomalyBtn');
  const seasonalAnomalyStatus = document.getElementById('seasonalAnomalyStatus');
  const seasonalAnomalyLegend = document.getElementById('seasonalAnomalyLegend');
  const anomalyWindowDaysInput = document.getElementById('anomalyWindowDays');
  const anomalyMinObservationsInput = document.getElementById('anomalyMinObservations');
  const anomalyZLimitInput = document.getElementById('anomalyZLimit');
  const radarSearchBtn = document.getElementById('radarSearchBtn');
  const radarRenderBtn = document.getElementById('radarRenderBtn');
  const radarClearBtn = document.getElementById('radarClearBtn');
  const radarStatus = document.getElementById('radarStatus');
  const outputMode = document.getElementById('outputMode');
  const temporalMode = document.getElementById('temporalMode');
  const compositeConfigBox = document.getElementById('compositeConfigBox');
  const compositeStat = document.getElementById('compositeStat');
  const percentileBox = document.getElementById('percentileBox');
  const percentileVal = document.getElementById('percentileVal');
  const gridLayout = document.getElementById('gridLayout');
  const gridConfigBox = document.getElementById('gridConfigBox');
  const modePanel2 = document.getElementById('modePanel2');
  const modePanel3 = document.getElementById('modePanel3');
  const modePanel4 = document.getElementById('modePanel4');
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  const maxCloudInput = document.getElementById('maxCloud');
  const cloudValLabel = document.getElementById('cloudVal');
  const sceneLimitInput = document.getElementById('sceneLimit');
  const allScenesChk = document.getElementById('allScenesChk');
  const polygonStatsContent = document.getElementById('polygonStatsContent');
  const optramPersistenceControls = document.getElementById('optramPersistenceControls');
  const optramPersistenceBtn = document.getElementById('optramPersistenceBtn');
  const optramPersistenceContent = document.getElementById('optramPersistenceContent');
  const optramWetThresholdInput = document.getElementById('optramWetThreshold');
  const maskCloudsChk = document.getElementById('maskCloudsChk');
  const waterOnlyChk = document.getElementById('waterOnlyChk');
  const waterMaskThresholdInput = document.getElementById('waterMaskThreshold');
  const includeBasemapChk = document.getElementById('includeBasemapChk');
  const transectSamplesInput = document.getElementById('transectSamples');
  const auto10mChk = document.getElementById('auto10mChk');
  const opacitySlider = document.getElementById('opacitySlider');
  const inspectorText = document.getElementById('inspectorText');
  const sliderBox = document.getElementById('sliderBox');
  const sceneSlider = document.getElementById('sceneSlider');
  const sceneCounter = document.getElementById('sceneCounter');
  const sceneMetaLabel = document.getElementById('sceneMetaLabel');
  const diffModeChk = document.getElementById('diffModeChk');
  const baselineSelect = document.getElementById('baselineSelect');
  const canvas = document.getElementById('ndviCanvas');
  const legend = document.getElementById('legend');
  const resultTitle = document.getElementById('resultTitle');
  const resultHint = document.getElementById('resultHint');

  document.getElementById('helpBtn').addEventListener('click', () => document.getElementById('helpModal').showModal());
  maxCloudInput.addEventListener('input', () => { cloudValLabel.textContent = maxCloudInput.value; });
  allScenesChk.addEventListener('change', () => {
    sceneLimitInput.disabled = allScenesChk.checked;
    sceneLimitInput.setAttribute('aria-disabled', String(allScenesChk.checked));
  });
  allScenesChk.dispatchEvent(new Event('change'));
  auto10mChk.addEventListener('change', () => {
    transectSamplesInput.disabled = auto10mChk.checked;
    if (probeLine) updateChart();
  });
  transectSamplesInput.disabled = auto10mChk.checked;
  transectSamplesInput.addEventListener('change', () => { if (probeLine) updateChart(); });

  gridLayout.addEventListener('change', () => {
    const val = gridLayout.value;
    gridConfigBox.style.display = val === '1x1' ? 'none' : 'grid';
    document.querySelectorAll('.quad-only').forEach(el => {
      el.style.display = val === '2x2' ? 'block' : 'none';
    });
    if (displaySteps.length > 0) displayStepByIndex(Number(sceneSlider.value));
  });

  temporalMode.addEventListener('change', () => {
    const isComp = temporalMode.value !== 'single';
    compositeConfigBox.style.display = isComp ? 'grid' : 'none';
    if (validScenes.length > 0) {
      rebuildDisplaySteps();
      displayStepByIndex(Number(sceneSlider.value));
    }
  });

  compositeStat.addEventListener('change', () => {
    percentileBox.style.display = compositeStat.value === 'percentile' ? 'block' : 'none';
    compositeCache.clear();
    if (displaySteps.length > 0) displayStepByIndex(Number(sceneSlider.value));
  });

  percentileVal.addEventListener('change', () => {
    compositeCache.clear();
    if (displaySteps.length > 0) displayStepByIndex(Number(sceneSlider.value));
  });

  const STAC_SEARCH_URL = 'https://earth-search.aws.element84.com/v1/search';
  const STAC_COLLECTION = 'sentinel-2-c1-l2a';
  const MAX_OUTPUT_DIMENSION = 640;
  const MAX_MAP_OVERLAY_DIMENSION = 480;
  const BBOX_EDGE_SEGMENTS = 28;

  // GeoTIFF's decoder pool parallelises supported decompression work in Web Workers.
  // Initialise it lazily on the first raster read, not at page startup: map/UI
  // initialisation must still work if the browser blocks workers or the CDN fails.
  const HARDWARE_THREADS = Math.max(1, Number(navigator.hardwareConcurrency) || 2);
  const DEVICE_MEMORY_GB = Number(navigator.deviceMemory) || 4;
  const GEO_TIFF_WORKERS = Math.max(1, Math.min(4, HARDWARE_THREADS - 1, DEVICE_MEMORY_GB <= 2 ? 1 : 4));
  const SCENE_CONCURRENCY = Math.max(1, Math.min(3, HARDWARE_THREADS >= 8 && DEVICE_MEMORY_GB >= 8 ? 3 : 2));
  let geotiffPool = null;
  let geotiffPoolAttempted = false;

  function rasterReadOptions(options) {
    if (!geotiffPoolAttempted) {
      geotiffPoolAttempted = true;
      try {
        if (typeof GeoTIFF !== 'undefined' && typeof GeoTIFF.Pool === 'function') {
          geotiffPool = new GeoTIFF.Pool(GEO_TIFF_WORKERS);
        }
      } catch (err) {
        console.warn('GeoTIFF worker pool unavailable; using normal raster decoding.', err);
        geotiffPool = null;
      }
    }
    return geotiffPool ? { ...options, pool: geotiffPool } : options;
  }

  // Offload CPU-heavy per-pixel calculations to a reusable Web Worker.
  // Worker startup is lazy, and every task has a main-thread fallback so that
  // restrictive browsers or file:// deployments can still use the app.
  let cpuWorker = null;
  let cpuWorkerAttempted = false;
  let cpuWorkerTaskId = 0;
  const cpuWorkerPending = new Map();

  function getCpuWorker() {
    if (cpuWorkerAttempted) return cpuWorker;
    cpuWorkerAttempted = true;
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || !URL.createObjectURL) return null;
    const source = `
      function idx(mode, b) {
        for (let i = 0; i < b.length; i++) if (!Number.isFinite(b[i])) return NaN;
        const nd = (a,c) => {
          const d=a+c;
          return Number.isFinite(d) && Math.abs(d)>1e-6 ? Math.max(-1,Math.min(1,(a-c)/d)) : NaN;
        };
        switch(mode) {
          case 'ndvi': case 'ndwi': case 'ndmi': case 'smi': case 'nbr':
          case 'ndbi': case 'mndwi': case 'ndci': case 'ndti': case 'nsmi': return nd(b[0],b[1]);
          case 'nmdi': { const d=b[1]-b[2], den=b[0]+d; return Number.isFinite(den)&&Math.abs(den)>1e-6?Math.max(-1,Math.min(1,(b[0]-d)/den)):NaN; }
          case 'str': return b[0]>0.005&&b[0]<=1.2?((1-b[0])*(1-b[0]))/(2*b[0]):NaN;
          case 's2wi': { const d=b[0]+b[1]+b[2]; return Math.abs(d)>1e-6?Math.max(-1,Math.min(1,(b[0]-b[1]-b[2])/d)):NaN; }
          case 'bsi': { const d=(b[0]+b[1])+(b[2]+b[3]); return Math.abs(d)>1e-6?Math.max(-1,Math.min(1,((b[0]+b[1])-(b[2]+b[3]))/d)):NaN; }
          case 'evi': { const d=b[0]+6*b[1]-7.5*b[2]+1; return Math.abs(d)>1e-6?2.5*(b[0]-b[1])/d:NaN; }
          case 'chl_ratio': case 'msi': return b[1]>1e-6?b[0]/b[1]:NaN;
          case 'mci': return b[0]-(b[1]+(b[2]-b[1])*(705-665)/(740-665));
          case 'fai': return b[0]-(b[1]+(b[2]-b[1])*(842-665)/(1610-665));
          case 'turbidity_ratio': return b[1]>1e-6?b[0]/b[1]:NaN;
          case 'awei_nsh': return 4*(b[0]-b[1])-(0.25*b[2]+2.75*b[3]);
          default: return NaN;
        }
      }
      self.onmessage = function(e) {
        const m=e.data;
        try {
          if (m.type === 'index-grid') {
            const out=new Float32Array(m.length);
            let sum=0,count=0;
            function inside(x,y,ring) {
              let yes=false;
              for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
                const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
                if(((yi>y)!==(yj>y))&&(x<((xj-xi)*(y-yi))/((yj-yi)||1e-30)+xi)) yes=!yes;
              }
              return yes;
            }
            const usePoly = m.polygon && m.polygon.length > 2 && m.win && m.origin && m.res;
            const ww=usePoly ? (m.win[2]-m.win[0]) : 0;
            const wh=usePoly ? (m.win[3]-m.win[1]) : 0;
            for(let i=0;i<m.length;i++) {
              if (m.mask && m.mask[i]===1) { out[i]=NaN; continue; }
              if (usePoly) {
                 const x = i % m.width, y = Math.floor(i / m.width);
                 const px=m.win[0]+((x+0.5)/m.width)*ww, mapX=m.origin[0]+px*m.res[0];
                 const py=m.win[1]+((y+0.5)/m.height)*wh, mapY=m.origin[1]+py*m.res[1];
                 // NOTE: Inside worker, proj4 is not available directly, so polygon should have been transformed prior to sending, or checked against lonLat.
                 // The polygon is passed as lon/lat. We must either pass a transformed polygon, or not check it here if proj is needed.
                 // Actually, it's simpler to pass the polygon coordinates ALREADY in the target CRS from main thread, rather than EPSG:4326.
                 if (!inside(mapX, mapY, m.polygon)) { out[i]=NaN; continue; }
              }
              if(m.waterMaskOn) {
                const g=m.green[i], sw=m.swir[i], den=g+sw;
                const mndwi=Number.isFinite(g)&&Number.isFinite(sw)&&Math.abs(den)>1e-6?(g-sw)/den:NaN;
                if(!Number.isFinite(mndwi)||mndwi<=m.waterThreshold){out[i]=NaN;continue;}
              }
              const bands=new Array(m.bandArrays.length);
              for(let j=0;j<m.bandArrays.length;j++) bands[j]=m.bandArrays[j][i];
              const v=idx(m.mode,bands);
              out[i]=v;
              if(Number.isFinite(v)){sum+=v;count++;}
            }
            self.postMessage({id:m.id,ok:true,result:{indexGrid:out,meanVal:count?sum/count:NaN}},[out.buffer]);
          } else if (m.type === 'composite-index') {
            const out=new Float32Array(m.length), vals=new Float32Array(m.grids.length);
            function qSelect(a,l,r,k){
              while(l<r){
                const pI=l+Math.floor(Math.random()*(r-l+1)), pV=a[pI];
                a[pI]=a[r];a[r]=pV;
                let sI=l;
                for(let x=l;x<r;x++){if(a[x]<pV){const t=a[x];a[x]=a[sI];a[sI]=t;sI++;}}
                a[r]=a[sI];a[sI]=pV;
                if(k===sI)return a[k];else if(k<sI)r=sI-1;else l=sI+1;
              }
              return a[k];
            }
            for(let i=0;i<m.length;i++) {
              let n=0;
              for(let j=0;j<m.grids.length;j++) { const v=m.grids[j][i]; if(Number.isFinite(v)) vals[n++]=v; }
              if(!n) { out[i]=NaN; continue; }
              if(m.stat==='mean') { let sum=0; for(let j=0;j<n;j++) sum+=vals[j]; out[i]=sum/n; }
              else if(m.stat==='max') { let v=-Infinity; for(let j=0;j<n;j++) if(vals[j]>v)v=vals[j]; out[i]=v; }
              else if(m.stat==='min') { let v=Infinity; for(let j=0;j<n;j++) if(vals[j]<v)v=vals[j]; out[i]=v; }
              else {
                const sub=vals.subarray(0,n);
                const q=m.stat==='median'?0.5:Math.max(0.01,Math.min(0.99,m.pVal/100));
                const pos=(n-1)*q, base=Math.floor(pos), frac=pos-base;
                const v1=qSelect(sub,0,n-1,base);
                if(frac>0 && base+1<n){
                  let v2=Infinity;
                  for(let x=base+1;x<n;x++)if(sub[x]<v2)v2=sub[x];
                  out[i]=v1+frac*(v2-v1);
                } else out[i]=v1;
              }
            }
            self.postMessage({id:m.id,ok:true,result:{indexGrid:out}},[out.buffer]);
          } else if (m.type === 'composite-rgb') {
            const r=new Uint8ClampedArray(m.length), g=new Uint8ClampedArray(m.length), b=new Uint8ClampedArray(m.length), a=new Uint8ClampedArray(m.length);
            const vals=new Float32Array(m.channels.length);
            function qSelectRgb(a,l,rBound,k){
              while(l<rBound){
                const pI=l+Math.floor(Math.random()*(rBound-l+1)), pV=a[pI];
                a[pI]=a[rBound];a[rBound]=pV;
                let sI=l;
                for(let x=l;x<rBound;x++){if(a[x]<pV){const t=a[x];a[x]=a[sI];a[sI]=t;sI++;}}
                a[rBound]=a[sI];a[sI]=pV;
                if(k===sI)return a[k];else if(k<sI)rBound=sI-1;else l=sI+1;
              }
              return a[k];
            }
            function statValue(n) {
              if(!n) return NaN;
              if(m.stat==='mean'){let sum=0;for(let j=0;j<n;j++)sum+=vals[j];return sum/n;}
              if(m.stat==='max'){let v=-Infinity;for(let j=0;j<n;j++)if(vals[j]>v)v=vals[j];return v;}
              if(m.stat==='min'){let v=Infinity;for(let j=0;j<n;j++)if(vals[j]<v)v=vals[j];return v;}
              const sub=vals.subarray(0,n), q=m.stat==='median'?0.5:Math.max(0.01,Math.min(0.99,m.pVal/100));
              const pos=(n-1)*q, base=Math.floor(pos), frac=pos-base;
              const v1=qSelectRgb(sub,0,n-1,base);
              if(frac>0 && base+1<n){
                let v2=Infinity;
                for(let x=base+1;x<n;x++)if(sub[x]<v2)v2=sub[x];
                return v1+frac*(v2-v1);
              }
              return v1;
            }
            for(let i=0;i<m.length;i++) {
              let n=0;
              for(let j=0;j<m.channels.length;j++) if(m.channels[j][3][i]>0) vals[n++]=m.channels[j][0][i];
              r[i]=n?Math.round(statValue(n)):0;
              n=0; for(let j=0;j<m.channels.length;j++) if(m.channels[j][3][i]>0) vals[n++]=m.channels[j][1][i];
              g[i]=n?Math.round(statValue(n)):0;
              n=0; for(let j=0;j<m.channels.length;j++) if(m.channels[j][3][i]>0) vals[n++]=m.channels[j][2][i];
              b[i]=n?Math.round(statValue(n)):0;
              a[i]=(m.channels.some(ch=>ch[3][i]>0))?255:0;
            }
            self.postMessage({id:m.id,ok:true,result:{rgbChannels:[r,g,b,a]}},[r.buffer,g.buffer,b.buffer,a.buffer]);
          } else if (m.type === 'seasonal-anomaly') {
            const out = new Float32Array(m.length);
            const medians = new Float32Array(m.length);
            const support = new Uint16Array(m.length);
            const vals = new Float32Array(m.baselines.length);
            const devs = new Float32Array(m.baselines.length);
            function medianOf(arr,n) {
              const sorted = Array.from(arr.subarray(0,n)).sort((a,b)=>a-b);
              const mid = Math.floor(n/2);
              return n % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
            }
            for(let i=0;i<m.length;i++) {
              const target = m.target[i];
              if(!Number.isFinite(target)){out[i]=NaN;medians[i]=NaN;support[i]=0;continue;}
              let n=0;
              for(let j=0;j<m.baselines.length;j++) {
                const v=m.baselines[j][i];
                if(Number.isFinite(v)) vals[n++]=v;
              }
              support[i]=n;
              if(n<m.minObs){out[i]=NaN;medians[i]=NaN;continue;}
              const med=medianOf(vals,n); medians[i]=med;
              for(let j=0;j<n;j++) devs[j]=Math.abs(vals[j]-med);
              const mad=medianOf(devs,n);
              const delta=target-med;
              const scale=1.4826*mad;
              if(Number.isFinite(scale)&&scale>1e-7) out[i]=delta/scale;
              else out[i]=Math.abs(delta)<=1e-7?0:Math.sign(delta)*m.maxZ;
            }
            self.postMessage({id:m.id,ok:true,result:{indexGrid:out,baselineMedian:medians,support}},[out.buffer,medians.buffer,support.buffer]);
          } else if (m.type === 'polygon-stats') {
            function inside(x,y,ring) {
              let yes=false;
              for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
                const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
                if(((yi>y)!==(yj>y))&&(x<((xj-xi)*(y-yi))/((yj-yi)||1e-30)+xi)) yes=!yes;
              }
              return yes;
            }
            const vals=[]; const ww=m.win[2]-m.win[0], wh=m.win[3]-m.win[1];
            for(let y=0;y<m.height;y++) {
              const py=m.win[1]+((y+0.5)/m.height)*wh, mapY=m.origin[1]+py*m.res[1];
              for(let x=0;x<m.width;x++) {
                const px=m.win[0]+((x+0.5)/m.width)*ww, mapX=m.origin[0]+px*m.res[0];
                if(!inside(mapX,mapY,m.ring)) continue;
                const v=m.grid[y*m.width+x]; if(Number.isFinite(v)) vals.push(v);
              }
            }
            if(!vals.length) { self.postMessage({id:m.id,ok:true,result:{count:0,mean:NaN,median:NaN,sd:NaN,min:NaN,p25:NaN,p75:NaN,max:NaN}}); return; }
            let sum=0,sumSq=0,min=Infinity,max=-Infinity;
            for(const v of vals){sum+=v;sumSq+=v*v;min=Math.min(min,v);max=Math.max(max,v);}
            vals.sort((a,b)=>a-b);
            const quantile=q=>{const pos=(vals.length-1)*q,base=Math.floor(pos),frac=pos-base;return base+1<vals.length?vals[base]+frac*(vals[base+1]-vals[base]):vals[base];};
            const mean=sum/vals.length;
            self.postMessage({id:m.id,ok:true,result:{count:vals.length,mean,median:quantile(0.5),sd:Math.sqrt(Math.max(0,sumSq/vals.length-mean*mean)),min,p25:quantile(0.25),p75:quantile(0.75),max}});
          }
        } catch(err) { self.postMessage({id:m.id,ok:false,error:err&&err.message?err.message:String(err)}); }
      };
    `;
    try {
      const blob = new Blob([source], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      cpuWorker = new Worker(url);
      URL.revokeObjectURL(url);
      cpuWorker.onmessage = (event) => {
        const msg = event.data || {};
        const pending = cpuWorkerPending.get(msg.id);
        if (!pending) return;
        cpuWorkerPending.delete(msg.id);
        if (msg.ok) pending.resolve(msg.result);
        else pending.reject(new Error(msg.error || 'CPU worker task failed.'));
      };
      cpuWorker.onerror = (event) => {
        for (const pending of cpuWorkerPending.values()) pending.reject(new Error(event.message || 'CPU worker failed.'));
        cpuWorkerPending.clear();
        try { cpuWorker.terminate(); } catch (_) {}
        cpuWorker = null;
      };
    } catch (err) {
      console.warn('CPU worker unavailable; using main-thread calculations.', err);
      cpuWorker = null;
    }
    return cpuWorker;
  }

  function runCpuWorkerTask(type, payload) {
    const worker = getCpuWorker();
    if (!worker) return Promise.reject(new Error('CPU worker unavailable.'));
    const id = ++cpuWorkerTaskId;
    return new Promise((resolve, reject) => {
      cpuWorkerPending.set(id, { resolve, reject });
      try {
        const transferList = [];
        const payloadCopy = { ...payload, type, id };

        // We avoid detaching original cached data by making a copy before transferring
        // to the worker. Since we're sending copies instead of detaching caches, we
        // allocate here, but then use zero-copy transfer to the worker.
        if (type === 'index-grid' && payload.bandArrays) {
          payloadCopy.bandArrays = payload.bandArrays.map(arr => {
            const copy = new Float32Array(arr);
            transferList.push(copy.buffer);
            return copy;
          });
          if (payload.mask) {
            payloadCopy.mask = new Uint8Array(payload.mask);
            transferList.push(payloadCopy.mask.buffer);
          }
          if (payload.green) {
            payloadCopy.green = new Float32Array(payload.green);
            transferList.push(payloadCopy.green.buffer);
          }
          if (payload.swir) {
            payloadCopy.swir = new Float32Array(payload.swir);
            transferList.push(payloadCopy.swir.buffer);
          }
        } else if (type === 'composite-index' && payload.grids) {
          payloadCopy.grids = payload.grids.map(grid => {
            const copy = new Float32Array(grid);
            transferList.push(copy.buffer);
            return copy;
          });
        } else if (type === 'composite-rgb' && payload.channels) {
          payloadCopy.channels = payload.channels.map(ch => {
            const chCopy = ch.map(c => {
               const cCopy = new Uint8ClampedArray(c);
               transferList.push(cCopy.buffer);
               return cCopy;
            });
            return chCopy;
          });
        } else if (type === 'seasonal-anomaly' && payload.baselines) {
          payloadCopy.baselines = payload.baselines.map(b => {
             const copy = new Float32Array(b);
             transferList.push(copy.buffer);
             return copy;
          });
          if (payload.target) {
             payloadCopy.target = new Float32Array(payload.target);
             transferList.push(payloadCopy.target.buffer);
          }
        }

        worker.postMessage(payloadCopy, transferList);
      } catch (err) {
        cpuWorkerPending.delete(id); reject(err);
      }
    });
  }

  // Run async jobs in small batches to balance network latency against memory use.
  async function mapConcurrent(items, concurrency, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    async function runner() {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }
    const runners = Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, () => runner());
    await Promise.all(runners);
    return results;
  }

  proj4.defs('EPSG:3857', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs');

  let drawnBbox = null;
  let pipelineGeneration = 0;
  let probePoints = []; // [{ id, label, lon, lat, layer }]
  let nextProbePointId = 1;
  let pointSelectionMode = false;
  let probeLine = null;
  let probeLineLayer = null;
  let probePolygon = null;
  let probePolygonLayer = null;
  let resultOverlay = null;
  const pointStatus = document.getElementById('pointStatus');
  const clearPointsBtn = document.getElementById('clearPointsBtn');
  const pointModeBtn = document.getElementById('pointModeBtn');
  const POINT_LINE_COLORS = ['#7ce38b', '#ffcc66', '#f28bff', '#6de0e8', '#ff7d7d', '#b5a0ff', '#a6d96a', '#f4a261', '#80b1d3', '#e78ac3', '#c9a227', '#8dd3c7'];
  let validScenes = [];
  let displaySteps = [];
  let activeRenderedState = null;

class LRUCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }
  get(key) {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  has(key) {
    return this.cache.has(key);
  }
  clear() {
    this.cache.clear();
  }
}

  const sceneRawCache = new LRUCache(12);
  const compositeCache = new LRUCache(6);
  let optramCalibration = null;
  let optramCalibrationPromise = null;
  let optramPersistenceRunning = false;
  const basemapCanvasCache = new Map();
  let chartInstance = null;

  const basemapDefs = {
    'Esri World Imagery': {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      options: { attribution: 'Tiles &copy; Esri', maxZoom: 19, crossOrigin: 'anonymous' }
    },
    'Esri Light Gray Canvas': {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      options: { attribution: 'Tiles &copy; Esri', maxZoom: 16, crossOrigin: 'anonymous' }
    },
    'CartoDB Dark Matter': {
      url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      options: { attribution: '&copy; CARTO', maxZoom: 19, crossOrigin: 'anonymous' }
    },
    'OpenStreetMap': {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: { attribution: '&copy; OpenStreetMap', maxZoom: 19, crossOrigin: 'anonymous' }
    },
    'OpenTopoMap': {
      url: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
      options: { attribution: '&copy; OpenTopoMap', maxZoom: 17, crossOrigin: 'anonymous' }
    }
  };

  let activeBasemapName = 'Esri World Imagery';
  const basemaps = {};
  for (const [name, def] of Object.entries(basemapDefs)) {
    basemaps[name] = L.tileLayer(def.url, def.options);
  }

  const map = L.map('map', { layers: [basemaps[activeBasemapName]] }).setView([-40.35, 175.61], 12);
  L.control.layers(basemaps, null, { position: 'topright' }).addTo(map);

  map.on('baselayerchange', function (e) {
    activeBasemapName = e.name;
    basemapCanvasCache.clear();
    if (includeBasemapChk.checked && displaySteps.length > 0) {
      displayStepByIndex(Number(sceneSlider.value));
    }
  });

  map.createPane('resultPane');
  map.getPane('resultPane').style.zIndex = '350';
  map.createPane('radarPane');
  map.getPane('radarPane').style.zIndex = '360';
  map.createPane('anomalyPane');
  map.getPane('anomalyPane').style.zIndex = '370';
  map.createPane('radarComparePane');
  map.getPane('radarComparePane').style.zIndex = '380';

  let radarScenes = [];
  const radarLocalItems = [];
  let radarOverlay = null;
  let radarCompareOverlay = null;
  let seasonalAnomalyOverlay = null;
  let seasonalAnomalyResult = null;
  const radarRawCache = new Map();
  let optramCalibrationChart = null;
  const dataSupportCache = new Map();

  const aoiGroup = new L.FeatureGroup().addTo(map);
  const probeGroup = new L.FeatureGroup().addTo(map);

  map.addControl(new L.Control.Draw({
    draw: {
      // Leaflet.Draw 1.0.4 can throw inside GeometryUtil.readableArea while
      // updating rectangle/polygon tooltips in some browsers. Because that call
      // happens before the shape is rendered, the drag appears stuck and the
      // shape may never complete. Disable the built-in area tooltip; the app's
      // own AOI/zonal-statistics UI provides analysis information after drawing.
      polygon: { shapeOptions: { color: '#b77cff', weight: 2.5, fillOpacity: 0.16 }, showArea: false },
      circle: false, circlemarker: false,
      rectangle: { shapeOptions: { color: '#4daafc', weight: 2.5, fillOpacity: 0.04 }, showArea: false },
      polyline: { shapeOptions: { color: '#ffcc00', weight: 3 } },
      marker: true
    },
    edit: { featureGroup: probeGroup, remove: true }
  }));

  function updatePointStatus() {
    pointStatus.textContent = `Selected comparison points: ${probePoints.length}` +
      (probePoints.length ? ` (${probePoints.map(p => p.label).join(', ')})` : '');
    clearPointsBtn.disabled = probePoints.length === 0;
  }

  function clearProbeSelection() {
    probeGroup.clearLayers();
    probePoints = [];
    probeLine = null;
    probeLineLayer = null;
    probePolygon = null;
    probePolygonLayer = null;
    updatePointStatus();
  }

  function setPointSelectionMode(enabled) {
    pointSelectionMode = Boolean(enabled);
    pointModeBtn.setAttribute('aria-pressed', String(pointSelectionMode));
    pointModeBtn.textContent = pointSelectionMode ? 'Click-to-Add Points: ON' : 'Enable Click-to-Add Points';
    pointModeBtn.style.background = pointSelectionMode ? '#247a46' : '';
    map.getContainer().style.cursor = pointSelectionMode ? 'crosshair' : '';
  }

  function addComparisonPoint(layer) {
    // Point mode is exclusive with a transect or summary polygon. Existing points are retained.
    if (probeLine || probePolygon) clearProbeSelection();
    const ll = layer.getLatLng();
    const id = nextProbePointId++;
    const point = { id: `P${id}`, label: `Point ${id}`, lon: ll.lng, lat: ll.lat, layer };
    point.layer.bindTooltip(point.label, { permanent: true, direction: 'top', offset: [0, -8] });
    probePoints.push(point);
    probeGroup.addLayer(layer);
    updatePointStatus();
    updateCsvButtonState();
    updatePolygonStatsPanel(activeRenderedState?.raw || null, activeRenderedState?.inspectGrid || null);
    log(`${point.label} added at [${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}]. ${probePoints.length} point(s) selected.`);
    updateChart();
  }

  pointModeBtn.addEventListener('click', () => setPointSelectionMode(!pointSelectionMode));
  map.on('click', function (event) {
    if (!pointSelectionMode) return;
    addComparisonPoint(L.marker(event.latlng));
  });
  // Avoid interpreting vertices from a rectangle, line or polygon drawing as comparison points.
  let currentDrawHandler = null;
  // Instead of relying on e.handler (which is missing in some Leaflet.Draw versions on drawstart),
  // Leaflet.Draw attaches the handler to map under map._toolbars... or map.on.
  // Actually, we can just trigger the disable on the map instance safely by clearing drawing state.
  map.on('draw:drawstart', function (e) {
    setPointSelectionMode(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.keyCode === 27) {
      // Leaflet.Draw natively supports firing a toolbar cancel if we access it,
      // but an easier robust fallback is to dispatch a custom disable if it's active.
      if (window.L && L.Draw && L.Draw.Event) {
          // If a drawing is in progress, any Leaflet vector draw handler listens to cancel.
          const toolbars = Object.values(map._toolbars || {});
          for (const tb of toolbars) {
             if (tb && typeof tb.disable === 'function') tb.disable();
          }
      }
      setPointSelectionMode(false);
    }
  });

  map.on(L.Draw.Event.CREATED, function (event) {
    const type = event.layerType;
    const layer = event.layer;

    if (type === 'rectangle') {
      aoiGroup.clearLayers();
      clearProbeSelection();
      resetResults();
      updatePolygonStatsPanel(null, null);
      clearRadarOverlay();
      radarScenes = []; radarRawCache.clear();
      radarSceneSelect.innerHTML = '<option value="">Search for RTC scenes first</option>';
      radarBaselineSelect.innerHTML = '<option value="">Search for at least two scenes</option>';
      radarSceneSelect.disabled = true; radarBaselineSelect.disabled = true; radarRenderBtn.disabled = true; radarCompareBtn.disabled = true; radarStatus.textContent = 'AOI changed; search Sentinel-1 RTC again.';
      clearRadarCompareOverlay();
      aoiGroup.addLayer(layer);
      const b = layer.getBounds();
      drawnBbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      log('AOI Rectangle set: ' + drawnBbox.map(v => v.toFixed(5)).join(', '));
      runBtn.disabled = false;
      runBtn.textContent = 'Search & Render Scenes';
      map.fitBounds(b, { padding: [18, 18], maxZoom: 15 });
    } else if (type === 'polygon' && (!probePolygon || probePolygon.length === 0 || !drawnBbox)) {
      // Treat the first polygon or a polygon drawn when no AOI exists as the main Analysis AOI
      aoiGroup.clearLayers();
      clearProbeSelection();
      resetResults();
      updatePolygonStatsPanel(null, null);
      clearRadarOverlay();
      radarScenes = []; radarRawCache.clear();
      radarSceneSelect.innerHTML = '<option value="">Search for RTC scenes first</option>';
      radarBaselineSelect.innerHTML = '<option value="">Search for at least two scenes</option>';
      radarSceneSelect.disabled = true; radarBaselineSelect.disabled = true; radarRenderBtn.disabled = true; radarCompareBtn.disabled = true; radarStatus.textContent = 'AOI changed; search Sentinel-1 RTC again.';
      clearRadarCompareOverlay();

      aoiGroup.addLayer(layer);

      const rings = layer.getLatLngs();
      const outerRing = Array.isArray(rings[0]) ? rings[0] : rings;
      probePolygonLayer = layer;
      probePolygon = outerRing.map(ll => [ll.lng, ll.lat]);

      const b = layer.getBounds();
      drawnBbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];

      log(`Analysis Polygon AOI set (${probePolygon.length} edges). BBox: ` + drawnBbox.map(v => v.toFixed(5)).join(', '));
      runBtn.disabled = false;
      runBtn.textContent = 'Search & Render Scenes';
      map.fitBounds(b, { padding: [18, 18], maxZoom: 15 });
    } else if (type === 'marker') {
      addComparisonPoint(layer);
    } else if (type === 'polyline') {
      clearProbeSelection();
      probeGroup.addLayer(layer);
      probeLineLayer = layer;
      probeLine = layer.getLatLngs().map(ll => [ll.lng, ll.lat]);
      updateCsvButtonState();
      updatePolygonStatsPanel(activeRenderedState?.raw || null, activeRenderedState?.inspectGrid || null);
      log(`Transect line drawn (${probeLine.length} vertices).`);
      updateChart();
    } else if (type === 'polygon') {
      clearProbeSelection();
      probeGroup.addLayer(layer);
      probePolygonLayer = layer;
      const rings = layer.getLatLngs();
      const outerRing = Array.isArray(rings[0]) ? rings[0] : rings;
      probePolygon = outerRing.map(ll => [ll.lng, ll.lat]);
      updateCsvButtonState();
      log(`Summary polygon drawn (${Math.max(0, probePolygon.length)} edges).`);
      updatePolygonStatsPanel(activeRenderedState?.raw || null, activeRenderedState?.inspectGrid || null);
      updateChart();
    }
  });

  map.on(L.Draw.Event.DELETED, function (event) {
    event.layers.eachLayer(layer => {
      probePoints = probePoints.filter(point => point.layer !== layer);
      if (layer === probeLineLayer) { probeLine = null; probeLineLayer = null; }
      if (layer === probePolygonLayer) { probePolygon = null; probePolygonLayer = null; }
    });
    updatePointStatus();
    updateCsvButtonState();
    updatePolygonStatsPanel(activeRenderedState?.raw || null, activeRenderedState?.inspectGrid || null);
    updateChart();
  });

  map.on(L.Draw.Event.EDITED, function (event) {
    event.layers.eachLayer(layer => {
      if (layer instanceof L.Marker) {
        const ll = layer.getLatLng();
        const point = probePoints.find(p => p.layer === layer);
        if (point) { point.lon = ll.lng; point.lat = ll.lat; }
      } else if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
        probeLineLayer = layer;
        probeLine = layer.getLatLngs().map(ll => [ll.lng, ll.lat]);
      } else if (layer instanceof L.Polygon) {
        probePolygonLayer = layer;
        const rings = layer.getLatLngs();
        const outerRing = Array.isArray(rings[0]) ? rings[0] : rings;
        probePolygon = outerRing.map(ll => [ll.lng, ll.lat]);
      }
    });
    updatePointStatus();
    updateCsvButtonState();
    updatePolygonStatsPanel(activeRenderedState?.raw || null, activeRenderedState?.inspectGrid || null);
    updateChart();
  });

  clearPointsBtn.addEventListener('click', () => {
    // Clear only markers; leave an active transect/polygon untouched (normally these are exclusive).
    for (const point of probePoints) probeGroup.removeLayer(point.layer);
    probePoints = [];
    updatePointStatus();
    updateCsvButtonState();
    updateChart();
    log('Comparison points cleared.');
  });
  updatePointStatus();

  opacitySlider.addEventListener('input', () => {
    if (resultOverlay) resultOverlay.setOpacity(Number(opacitySlider.value));
    if (includeBasemapChk.checked && displaySteps.length > 0) {
      displayStepByIndex(Number(sceneSlider.value));
    }
  });
