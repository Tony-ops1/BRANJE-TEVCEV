(() => {
  const $ = id => document.getElementById(id);
  const CURRENT_YEAR = new Date().getFullYear();

  let liveReader = null;
  let stillReader = null;
  let controls = null;
  let starting = false;
  let pollTimer = null;
  let enhancedBusy = false;
  let ocrBusy = false;
  let ocrWorker = null;
  let scanStartedAt = 0;
  let lastOcrAt = 0;
  let lastRaw = '';
  let lastAt = 0;

  function validTip(x) {
    return /^\d{4}$/.test(x) && Number(x) >= 1400 && Number(x) <= 1799;
  }

  function validMkn(x) {
    return /^\d{8}$/.test(x) && !/^0{8}$/.test(x);
  }

  function parseCode(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;

    let tip = '', mkn = '', year = '', maker = '';
    const parts = text.split(/[;|,\s]+/).map(x => x.trim()).filter(Boolean);

    for (const p of parts) {
      if (!tip && validTip(p)) tip = p;
      if (!mkn && validMkn(p)) mkn = p;
      if (!year && /^(?:19\d{2}|20\d{2})$/.test(p)) {
        const y = Number(p);
        if (y >= 1990 && y <= CURRENT_YEAR) year = p;
      }
    }

    const ds = text.replace(/\D/g, '');
    if (!tip || !mkn) {
      for (let i = 0; i <= ds.length - 12; i++) {
        const t = ds.slice(i, i + 4);
        const m = ds.slice(i + 4, i + 12);
        if (validTip(t) && validMkn(m)) {
          tip = tip || t;
          mkn = mkn || m;
          break;
        }
      }
    }

    if (!mkn && ds.length === 8 && validMkn(ds)) mkn = ds;

    if (!year) {
      const years = text.match(/(?:19\d{2}|20\d{2})/g) || [];
      year = years.find(y => Number(y) >= 1990 && Number(y) <= CURRENT_YEAR) || '';
    }

    if (/ISKRA|AM550|ISKRAEMECO/i.test(text)) maker = 'ISKRA';
    else if (/LANDIS|GYR/i.test(text)) maker = 'Landis+Gyr';

    if (!tip && !mkn) return null;
    return {tip, mkn, year, maker, raw:text};
  }

  // Stroga rezerva: bere samo natisnjeni 4+8 številčni zapis neposredno pod črtno kodo.
  // Ne išče poljubnih številk po celotnem števcu, zato ne sme zamenjati prikaza porabe za MKN.
  function parsePrintedPair(raw) {
    let s = String(raw || '').toUpperCase()
      .replace(/[OQD]/g, '0')
      .replace(/[IL|]/g, '1')
      .replace(/Z/g, '2')
      .replace(/S/g, '5')
      .replace(/B/g, '8')
      .replace(/G/g, '6');

    const lines = s.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    for (const line of lines) {
      const direct = line.match(/(^|\D)(1[4-7]\d{2})\D{0,10}(\d{8})(?!\d)/);
      if (direct && validTip(direct[2]) && validMkn(direct[3])) {
        return {tip:direct[2], mkn:direct[3], year:'', maker:'', raw:`PRINT ${direct[2]} ${direct[3]}`};
      }
      const ds = line.replace(/\D/g, '');
      for (let i = 0; i <= ds.length - 12; i++) {
        const t = ds.slice(i, i + 4), m = ds.slice(i + 4, i + 12);
        if (validTip(t) && validMkn(m)) return {tip:t, mkn:m, year:'', maker:'', raw:`PRINT ${t} ${m}`};
      }
    }
    return null;
  }

  function applyResult(r) {
    if (!r) return;
    if (r.mkn && $('mkn')) $('mkn').value = r.mkn;
    if (r.tip && $('tip')) $('tip').value = r.tip;
    if (r.year && $('year')) $('year').value = r.year;
    if (r.maker && $('maker')) $('maker').value = r.maker;
    if (typeof validateFields === 'function') validateFields();

    const box = $('ocrBox');
    if (box) box.textContent = `KODA: ${r.raw}`;

    const status = $('ocrStatus');
    if (status) {
      if (r.tip && r.mkn) status.textContent = `✅ KODA PREBRANA: ${r.tip} / ${r.mkn}` + (r.year ? ` / ${r.year}` : '');
      else if (r.mkn) status.textContent = `✅ KODA PREBRANA: MKN ${r.mkn}`;
    }

    const frame = $('scanFrame');
    if (frame) {
      frame.classList.add('found');
      setTimeout(() => frame.classList.remove('found'), 1200);
    }
    try { navigator.vibrate?.([70,40,70]); } catch (_) {}
  }

  function clearPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    enhancedBusy = false;
  }

  function stopScanner(message) {
    clearPolling();
    try { controls?.stop(); } catch (_) {}
    controls = null;
    starting = false;

    const video = $('liveVideo');
    try {
      const stream = video?.srcObject;
      stream?.getTracks?.().forEach(t => t.stop());
      if (video) video.srcObject = null;
    } catch (_) {}

    if ($('startCameraBtn')) $('startCameraBtn').style.display = '';
    if ($('stopCameraBtn')) $('stopCameraBtn').style.display = 'none';
    if (message && $('ocrStatus')) $('ocrStatus').textContent = message;
  }

  function acceptRaw(raw) {
    const now = Date.now();
    if (!raw || (raw === lastRaw && now - lastAt < 2500)) return false;
    const parsed = parseCode(raw);
    if (!parsed) return false;

    lastRaw = raw;
    lastAt = now;
    applyResult(parsed);
    setTimeout(() => stopScanner('✅ Koda prebrana. Preveri podatke in shrani.'), 180);
    return true;
  }

  function acceptPair(pair) {
    if (!pair?.tip || !pair?.mkn) return false;
    const raw = `${pair.tip}${pair.mkn}`;
    const now = Date.now();
    if (raw === lastRaw && now - lastAt < 2500) return false;
    lastRaw = raw;
    lastAt = now;
    applyResult(pair);
    setTimeout(() => stopScanner('✅ Koda prebrana. Preveri podatke in shrani.'), 180);
    return true;
  }

  async function tuneCamera(video) {
    try {
      const track = video?.srcObject?.getVideoTracks?.()[0];
      if (!track) return;
      const caps = track.getCapabilities?.() || {};
      const advanced = [];
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) advanced.push({focusMode:'continuous'});
      // Pri bližnjih števcih digitalni zoom pogosto poslabša ostrino, zato ga ne vsiljujemo.
      if (advanced.length) await track.applyConstraints({advanced});
    } catch (_) {}
  }

  function makeCanvas(source, x=0, y=0, w=1, h=1, mode='raw', minWidth=0, minHeight=0) {
    const iw = source.videoWidth || source.width || source.naturalWidth || 0;
    const ih = source.videoHeight || source.height || source.naturalHeight || 0;
    if (!iw || !ih) return null;

    const sx = Math.max(0, Math.round(iw*x));
    const sy = Math.max(0, Math.round(ih*y));
    const sw = Math.max(1, Math.min(iw-sx, Math.round(iw*w)));
    const sh = Math.max(1, Math.min(ih-sy, Math.round(ih*h)));
    const scale = Math.max(1, Math.min(3, Math.max(minWidth/sw || 1, minHeight/sh || 1)));

    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw*scale));
    c.height = Math.max(1, Math.round(sh*scale));
    const ctx = c.getContext('2d', {alpha:false, willReadFrequently:true});
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height);
    if (mode === 'gray') ctx.filter = 'grayscale(1) contrast(1.55) brightness(1.05)';
    else if (mode === 'contrast') ctx.filter = 'grayscale(1) contrast(2.25) brightness(1.10)';
    else if (mode === 'hard') ctx.filter = 'grayscale(1) contrast(3.3) brightness(1.16)';
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  function thresholdCanvas(source, threshold=165) {
    if (!source) return null;
    const c = document.createElement('canvas');
    c.width = source.width; c.height = source.height;
    const ctx = c.getContext('2d', {alpha:false, willReadFrequently:true});
    ctx.drawImage(source,0,0);
    const im = ctx.getImageData(0,0,c.width,c.height);
    const d = im.data;
    for (let i=0;i<d.length;i+=4) {
      const y = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      const v = y < threshold ? 0 : 255;
      d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
    }
    ctx.putImageData(im,0,0);
    return c;
  }

  async function quaggaDecode(canvas) {
    if (!canvas || !window.Quagga?.decodeSingle) return null;
    return await new Promise(resolve => {
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      const timer = setTimeout(() => finish(null), 1200);
      try {
        Quagga.decodeSingle({
          src: canvas.toDataURL('image/jpeg', 0.95),
          numOfWorkers: 0,
          locate: true,
          inputStream: {size: 0},
          locator: {halfSample:false, patchSize:'medium'},
          decoder: {readers:['code_128_reader','code_39_reader','i2of5_reader','codabar_reader'], multiple:false}
        }, result => {
          clearTimeout(timer);
          const raw = result?.codeResult?.code || '';
          finish(parseCode(raw) ? raw : null);
        });
      } catch (_) {
        clearTimeout(timer);
        finish(null);
      }
    });
  }

  async function zxingDecode(canvas) {
    if (!canvas || !window.ZXingBrowser?.BrowserMultiFormatReader) return null;
    try {
      stillReader ||= new ZXingBrowser.BrowserMultiFormatReader(undefined, {delayBetweenScanAttempts:30});
      const result = await stillReader.decodeFromCanvas(canvas);
      const raw = typeof result?.getText === 'function' ? result.getText() : (result?.text || String(result || ''));
      return parseCode(raw) ? raw : null;
    } catch (_) { return null; }
  }

  async function nativeDecode(canvas) {
    if (!canvas || !('BarcodeDetector' in window)) return null;
    try {
      let formats = ['code_128','code_39','itf','codabar','qr_code','data_matrix','ean_13','ean_8','upc_a','upc_e'];
      if (BarcodeDetector.getSupportedFormats) {
        const supported = await BarcodeDetector.getSupportedFormats();
        formats = formats.filter(f => supported.includes(f));
      }
      if (!formats.length) return null;
      const detector = new BarcodeDetector({formats});
      const found = await detector.detect(canvas);
      for (const b of found) {
        const raw = b.rawValue || '';
        if (parseCode(raw)) return raw;
      }
    } catch (_) {}
    return null;
  }

  async function decodeCanvas(canvas, useQuagga=true) {
    if (!canvas) return null;
    return (await nativeDecode(canvas)) || (await zxingDecode(canvas)) || (useQuagga ? await quaggaDecode(canvas) : null);
  }

  async function ensureOcrWorker() {
    if (ocrWorker) return ocrWorker;
    if (!window.Tesseract?.createWorker) return null;
    try {
      ocrWorker = await Tesseract.createWorker('eng', 1);
      await ocrWorker.setParameters({
        tessedit_pageseg_mode: '11',
        tessedit_char_whitelist: '0123456789 -/'
      });
      return ocrWorker;
    } catch (_) {
      ocrWorker = null;
      return null;
    }
  }

  async function ocrPrintedPair(canvas) {
    if (!canvas || ocrBusy) return null;
    ocrBusy = true;
    try {
      const worker = await ensureOcrWorker();
      if (!worker) return null;
      const result = await worker.recognize(canvas);
      return parsePrintedPair(result?.data?.text || '');
    } catch (_) {
      return null;
    } finally {
      ocrBusy = false;
    }
  }

  async function enhancedFrameScan() {
    if (enhancedBusy || !controls) return;
    const video = $('liveVideo');
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    enhancedBusy = true;

    try {
      // Celoten srednji pas + več vodoravnih rezov. Pri odsevu je pogosto vsaj en del črt še čist.
      const variants = [
        makeCanvas(video,0.03,0.26,0.94,0.42,'raw',1500,0),
        makeCanvas(video,0.03,0.26,0.94,0.42,'contrast',1500,0),
        makeCanvas(video,0.04,0.31,0.92,0.18,'gray',1500,220),
        makeCanvas(video,0.04,0.39,0.92,0.18,'gray',1500,220),
        makeCanvas(video,0.04,0.47,0.92,0.18,'gray',1500,220)
      ].filter(Boolean);

      // Prva dva poskusa uporabljata vse razpoložljive dekoderje.
      for (let i=0;i<variants.length;i++) {
        const raw = await decodeCanvas(variants[i], i < 3);
        if (raw && acceptRaw(raw)) return;
        if (i === 1) {
          const bw = thresholdCanvas(variants[i], 165);
          const raw2 = await decodeCanvas(bw, true);
          if (raw2 && acceptRaw(raw2)) return;
        }
      }

      // Po ~1,5 s brez uspeha preberemo samo številčni napis neposredno pod kodo.
      // To reši ravno primere, kjer odsev prekine nekaj črt Code128.
      const now = Date.now();
      if (now - scanStartedAt > 1500 && now - lastOcrAt > 2200 && !ocrBusy) {
        lastOcrAt = now;
        const numberBand = makeCanvas(video,0.08,0.42,0.84,0.22,'hard',1700,360);
        const pair = await ocrPrintedPair(numberBand);
        if (pair && acceptPair(pair)) return;
      }
    } finally {
      enhancedBusy = false;
    }
  }

  async function startScanner() {
    if (starting || controls) return;
    const video = $('liveVideo');
    const status = $('ocrStatus');
    if (!video) return;

    if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
      if (status) status.textContent = '⚠️ Čitalnik kode se še ni naložil. Osveži stran.';
      return;
    }

    starting = true;
    if ($('startCameraBtn')) $('startCameraBtn').style.display = 'none';
    if ($('stopCameraBtn')) $('stopCameraBtn').style.display = '';
    if (status) status.textContent = '📷 Kamera je vključena · poravnaj kodo v rumeni okvir.';

    try {
      liveReader ||= new ZXingBrowser.BrowserMultiFormatReader(undefined, {delayBetweenScanAttempts:55});
      const constraints = {
        audio:false,
        video:{
          facingMode:{ideal:'environment'},
          width:{ideal:1920},
          height:{ideal:1080},
          frameRate:{ideal:30}
        }
      };

      controls = await liveReader.decodeFromConstraints(constraints, video, result => {
        if (!result) return;
        const raw = typeof result.getText === 'function' ? result.getText() : (result.text || String(result));
        acceptRaw(raw);
      });
      starting = false;
      scanStartedAt = Date.now();
      lastOcrAt = 0;
      await tuneCamera(video);

      clearPolling();
      pollTimer = setInterval(enhancedFrameScan, 420);
    } catch (e) {
      console.warn('Live scanner:', e);
      stopScanner('⚠️ Kamera se ni odprla. Pritisni »Vklopi kamero« in dovoli dostop do kamere.');
    }
  }

  async function loadBitmap(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, {imageOrientation:'from-image'}); }
      catch (_) { try { return await createImageBitmap(file); } catch (_) {} }
    }
    return await new Promise((resolve,reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  function rotateCanvas(source, angle=0) {
    if (!source || !angle) return source;
    const rad = angle*Math.PI/180;
    const w = source.width, h = source.height;
    const c = document.createElement('canvas');
    if (Math.abs(angle)%180===90) { c.width=h; c.height=w; } else { c.width=w; c.height=h; }
    const ctx = c.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height);
    ctx.translate(c.width/2,c.height/2); ctx.rotate(rad);
    ctx.drawImage(source,-w/2,-h/2);
    return c;
  }

  async function scanImageFile(file) {
    let img;
    try {
      img = await loadBitmap(file);
      const baseAttempts = [
        makeCanvas(img,0,0,1,1,'raw',1700,0),
        makeCanvas(img,0,0,1,1,'contrast',1700,0),
        makeCanvas(img,0.02,0.15,0.96,0.65,'raw',1800,0),
        makeCanvas(img,0.02,0.20,0.96,0.45,'contrast',1800,0),
        makeCanvas(img,0.03,0.28,0.94,0.22,'gray',1800,300),
        makeCanvas(img,0.03,0.38,0.94,0.22,'gray',1800,300),
        makeCanvas(img,0.03,0.48,0.94,0.22,'gray',1800,300)
      ].filter(Boolean);

      for (const c of baseAttempts) {
        let raw = await decodeCanvas(c, true);
        if (raw) return parseCode(raw);
        const bw = thresholdCanvas(c,165);
        raw = await decodeCanvas(bw, true);
        if (raw) return parseCode(raw);
      }

      const whole = makeCanvas(img,0,0,1,1,'contrast',1800,0);
      for (const angle of [90,270,180]) {
        const raw = await decodeCanvas(rotateCanvas(whole,angle), true);
        if (raw) return parseCode(raw);
      }

      // Zadnja rezerva za galerijo: natisnjeni TIP+MKN pod kodo.
      if (window.Tesseract?.createWorker) {
        const ocrRegions = [
          makeCanvas(img,0.02,0.20,0.96,0.55,'hard',1900,500),
          makeCanvas(img,0.02,0.35,0.96,0.35,'hard',1900,420),
          makeCanvas(img,0.02,0.50,0.96,0.30,'hard',1900,380)
        ].filter(Boolean);
        for (const c of ocrRegions) {
          const pair = await ocrPrintedPair(c);
          if (pair) return pair;
        }
      }
      return null;
    } finally {
      try { img?.close?.(); } catch (_) {}
    }
  }

  async function readBarcodeFromGallery(file) {
    if (!file) return null;
    stopScanner();
    ['mkn','tip','year','maker'].forEach(id => { const e=$(id); if(e) e.value=''; });
    if (typeof validateFields === 'function') validateFields();
    if ($('ocrStatus')) $('ocrStatus').textContent='🖼️ Berem kodo iz slike…';

    const r = await scanImageFile(file).catch(()=>null);
    if (r) {
      applyResult(r);
      if ($('ocrStatus')) $('ocrStatus').textContent = r.tip&&r.mkn ? `✅ KODA IZ SLIKE: ${r.tip} / ${r.mkn}` : `✅ KODA IZ SLIKE: MKN ${r.mkn}`;
      return r;
    }
    if ($('ocrStatus')) $('ocrStatus').textContent='⚠️ Kode na sliki nisem uspel prebrati. Poskusi približati samo kodo.';
    return null;
  }

  function buildUi() {
    const photo=$('photo');
    const card=photo?.closest('section.card');
    if(!card || $('liveScannerWrap')) return;

    ['photo','preview','readBtn','clearPhotoBtn'].forEach(id=>{const e=$(id);if(e)e.style.display='none';});
    const details=$('ocrBox')?.closest('section.card'); if(details) details.style.display='none';
    const counter=card.querySelector('.counter'); if(counter) counter.textContent='1. Skeniraj črtno kodo / QR';

    const style=document.createElement('style');
    style.textContent=`
      #liveScannerWrap{margin-top:10px}
      #videoBox{position:relative;width:100%;aspect-ratio:3/4;max-height:68vh;background:#111;border-radius:14px;overflow:hidden;border:2px solid #0b5e3b}
      #liveVideo{width:100%;height:100%;object-fit:cover;display:block;background:#111}
      #scanFrame{position:absolute;left:4%;right:4%;top:31%;height:34%;border:3px solid #f3c94f;border-radius:14px;box-shadow:0 0 0 9999px #0004;pointer-events:none;transition:.15s}
      #scanFrame::after{content:'DRŽI CELO KODO V OKVIRJU';position:absolute;left:0;right:0;bottom:-34px;text-align:center;color:#fff;font-weight:800;font-size:12px;text-shadow:0 1px 3px #000}
      #scanFrame.found{border-color:#39d353;box-shadow:0 0 0 9999px #0002,0 0 22px #39d353}
      #cameraButtons{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      #cameraButtons button{flex:1;min-width:150px}
    `;
    document.head.appendChild(style);

    const wrap=document.createElement('div');
    wrap.id='liveScannerWrap';
    wrap.innerHTML=`
      <div id="videoBox"><video id="liveVideo" playsinline muted autoplay></video><div id="scanFrame"></div></div>
      <div id="cameraButtons"><button class="primary" id="startCameraBtn">📷 Vklopi kamero</button><button class="secondary" id="stopCameraBtn" style="display:none">⏹ Ustavi kamero</button></div>`;
    counter?.insertAdjacentElement('afterend',wrap);

    $('startCameraBtn')?.addEventListener('click',startScanner);
    $('stopCameraBtn')?.addEventListener('click',()=>stopScanner('Kamera je ustavljena.'));
    $('newBtn')?.addEventListener('click',()=>{lastRaw='';lastAt=0;setTimeout(startScanner,350);});

    if($('ocrStatus')) $('ocrStatus').textContent='Kamera samodejno bere črtno ali QR kodo. Lahko tudi izbereš sliko iz galerije.';
    setTimeout(startScanner,450);
  }

  window.readBarcodeFromGallery=readBarcodeFromGallery;
  window.scanMeterBarcode=scanImageFile;

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',buildUi,{once:true});
  else buildUi();

  window.addEventListener('pagehide',()=>{
    stopScanner();
    if (ocrWorker) {
      const w=ocrWorker; ocrWorker=null;
      try { w.terminate(); } catch (_) {}
    }
  });
})();