(() => {
  const $ = id => document.getElementById(id);
  const CURRENT_YEAR = new Date().getFullYear();

  let liveReader = null;
  let stillReader = null;
  let controls = null;
  let starting = false;
  let pollTimer = null;
  let enhancedBusy = false;
  let lastRaw = '';
  let lastAt = 0;

  function parseCode(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;

    let tip = '', mkn = '', year = '', maker = '';
    const parts = text.split(/[;|,\s]+/).map(x => x.trim()).filter(Boolean);

    for (const p of parts) {
      if (!tip && /^1[4-7]\d{2}$/.test(p)) tip = p;
      if (!mkn && /^\d{8}$/.test(p) && !/^0{8}$/.test(p)) mkn = p;
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
        const n = Number(t);
        if (n >= 1400 && n <= 1799 && /^\d{8}$/.test(m) && !/^0{8}$/.test(m)) {
          tip = tip || t;
          mkn = mkn || m;
          break;
        }
      }
    }

    if (!mkn && ds.length === 8 && !/^0{8}$/.test(ds)) mkn = ds;

    if (!year) {
      const years = text.match(/(?:19\d{2}|20\d{2})/g) || [];
      year = years.find(y => Number(y) >= 1990 && Number(y) <= CURRENT_YEAR) || '';
    }

    if (/ISKRA|AM550|ISKRAEMECO/i.test(text)) maker = 'ISKRA';
    else if (/LANDIS|GYR/i.test(text)) maker = 'Landis+Gyr';

    if (!tip && !mkn) return null;
    return {tip, mkn, year, maker, raw:text};
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
    try { navigator.vibrate?.(90); } catch (_) {}
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

  async function tuneCamera(video) {
    try {
      const track = video?.srcObject?.getVideoTracks?.()[0];
      if (!track) return;
      const caps = track.getCapabilities?.() || {};
      const adv = [];
      if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) adv.push({focusMode:'continuous'});
      if (caps.zoom && Number.isFinite(caps.zoom.min) && Number.isFinite(caps.zoom.max)) {
        const z = Math.min(caps.zoom.max, Math.max(caps.zoom.min, 1.25));
        adv.push({zoom:z});
      }
      if (adv.length) await track.applyConstraints({advanced:adv});
    } catch (_) {}
  }

  function frameCanvas(video, x=0.02, y=0.24, w=0.96, h=0.50, mode='raw') {
    const vw = video.videoWidth || 0, vh = video.videoHeight || 0;
    if (!vw || !vh) return null;
    const sx = Math.round(vw*x), sy = Math.round(vh*y);
    const sw = Math.max(1, Math.round(vw*w)), sh = Math.max(1, Math.round(vh*h));
    const targetW = Math.max(sw, 1800);
    const scale = Math.min(2.2, targetW / sw);
    const c = document.createElement('canvas');
    c.width = Math.round(sw*scale);
    c.height = Math.round(sh*scale);
    const ctx = c.getContext('2d', {alpha:false, willReadFrequently:true});
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height);
    if (mode === 'contrast') ctx.filter = 'grayscale(1) contrast(2.1) brightness(1.12)';
    else if (mode === 'hard') ctx.filter = 'grayscale(1) contrast(3) brightness(1.18)';
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  async function decodeCanvas(canvas) {
    if (!canvas) return null;

    if ('BarcodeDetector' in window) {
      try {
        let formats = ['code_128','code_39','itf','codabar','qr_code','data_matrix','ean_13','ean_8','upc_a','upc_e'];
        if (BarcodeDetector.getSupportedFormats) {
          const supported = await BarcodeDetector.getSupportedFormats();
          formats = formats.filter(f => supported.includes(f));
        }
        if (formats.length) {
          const detector = new BarcodeDetector({formats});
          const found = await detector.detect(canvas);
          for (const b of found) {
            const raw = b.rawValue || '';
            if (parseCode(raw)) return raw;
          }
        }
      } catch (_) {}
    }

    if (!window.ZXingBrowser?.BrowserMultiFormatReader) return null;
    try {
      stillReader ||= new ZXingBrowser.BrowserMultiFormatReader(undefined, {delayBetweenScanAttempts:40});
      const result = await stillReader.decodeFromCanvas(canvas);
      const raw = typeof result?.getText === 'function' ? result.getText() : (result?.text || String(result || ''));
      return parseCode(raw) ? raw : null;
    } catch (_) {
      return null;
    }
  }

  async function enhancedFrameScan() {
    if (enhancedBusy || !controls) return;
    const video = $('liveVideo');
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    enhancedBusy = true;
    try {
      const variants = [
        frameCanvas(video,0.01,0.20,0.98,0.56,'raw'),
        frameCanvas(video,0.01,0.20,0.98,0.56,'contrast'),
        frameCanvas(video,0.06,0.28,0.88,0.38,'hard')
      ];
      for (const c of variants) {
        const raw = await decodeCanvas(c);
        if (raw && acceptRaw(raw)) return;
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
    if (status) status.textContent = '📷 Kamera je vključena · drži črtno/QR kodo v rumenem okvirju.';

    try {
      liveReader ||= new ZXingBrowser.BrowserMultiFormatReader(undefined, {delayBetweenScanAttempts:70});
      const constraints = {
        audio:false,
        video:{
          facingMode:{ideal:'environment'},
          width:{ideal:1920},
          height:{ideal:1080}
        }
      };

      controls = await liveReader.decodeFromConstraints(constraints, video, result => {
        if (!result) return;
        const raw = typeof result.getText === 'function' ? result.getText() : (result.text || String(result));
        acceptRaw(raw);
      });
      starting = false;
      await tuneCamera(video);

      clearPolling();
      pollTimer = setInterval(enhancedFrameScan, 360);
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

  function cropCanvas(img,x,y,w,h,angle=0,maxSide=2300,mode='raw') {
    const iw=img.width||img.naturalWidth, ih=img.height||img.naturalHeight;
    const sx=Math.max(0,Math.round(iw*x)), sy=Math.max(0,Math.round(ih*y));
    const sw=Math.max(1,Math.min(iw-sx,Math.round(iw*w))), sh=Math.max(1,Math.min(ih-sy,Math.round(ih*h)));
    const scale=Math.min(2.8,maxSide/Math.max(sw,sh));
    const bw=Math.max(1,Math.round(sw*scale)), bh=Math.max(1,Math.round(sh*scale));
    const rad=angle*Math.PI/180;
    const cw=Math.ceil(Math.abs(bw*Math.cos(rad))+Math.abs(bh*Math.sin(rad)));
    const ch=Math.ceil(Math.abs(bw*Math.sin(rad))+Math.abs(bh*Math.cos(rad)));
    const c=document.createElement('canvas'); c.width=cw; c.height=ch;
    const ctx=c.getContext('2d',{alpha:false,willReadFrequently:true});
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,cw,ch);
    ctx.translate(cw/2,ch/2); ctx.rotate(rad);
    if(mode==='contrast') ctx.filter='grayscale(1) contrast(2.15) brightness(1.12)';
    if(mode==='hard') ctx.filter='grayscale(1) contrast(3) brightness(1.18)';
    ctx.drawImage(img,sx,sy,sw,sh,-bw/2,-bh/2,bw,bh);
    return c;
  }

  async function scanImageFile(file) {
    let img;
    try {
      img=await loadBitmap(file);
      const attempts=[
        [0,0,1,1,0,2300,'raw'],
        [0,0,1,1,0,2300,'contrast'],
        [0,0.08,1,0.72,0,2300,'hard'],
        [0,0,1,1,90,2300,'contrast'],
        [0,0,1,1,270,2300,'contrast'],
        [0,0,1,1,180,2300,'contrast']
      ];
      for(const a of attempts){
        const raw=await decodeCanvas(cropCanvas(img,...a));
        if(raw) return parseCode(raw);
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
    if ($('ocrStatus')) $('ocrStatus').textContent='🖼️ Berem črtno/QR kodo iz slike…';

    const r=await scanImageFile(file).catch(()=>null);
    if(r){
      applyResult(r);
      if($('ocrStatus')) $('ocrStatus').textContent = r.tip&&r.mkn ? `✅ KODA IZ SLIKE: ${r.tip} / ${r.mkn}` : `✅ KODA IZ SLIKE: MKN ${r.mkn}`;
      return r;
    }
    if($('ocrStatus')) $('ocrStatus').textContent='⚠️ Kode na sliki nisem uspel prebrati. Poskusi z ostrejšo/bližjo sliko brez odseva.';
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
      #scanFrame{position:absolute;left:5%;right:5%;top:34%;height:28%;border:3px solid #f3c94f;border-radius:14px;box-shadow:0 0 0 9999px #0004;pointer-events:none;transition:.15s}
      #scanFrame::after{content:'PORAVNAJ KODO V OKVIR · BREZ ODSEVA';position:absolute;left:0;right:0;bottom:-34px;text-align:center;color:#fff;font-weight:800;font-size:12px;text-shadow:0 1px 3px #000}
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
  window.addEventListener('pagehide',()=>stopScanner());
})();