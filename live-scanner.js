(() => {
  const $ = id => document.getElementById(id);
  const CURRENT_YEAR = new Date().getFullYear();
  let reader = null;
  let controls = null;
  let starting = false;
  let lastRaw = '';
  let lastAt = 0;

  function parseCode(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;

    let tip = '', mkn = '', year = '', maker = '';

    const parts = text.split(/[;|,]/).map(x => x.trim()).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      if (!tip && /^1[4-7]\d{2}$/.test(parts[i])) tip = parts[i];
      if (!mkn && /^\d{8}$/.test(parts[i]) && !/^0{8}$/.test(parts[i])) mkn = parts[i];
      if (!year && /^(?:19\d{2}|20\d{2})$/.test(parts[i])) {
        const y = Number(parts[i]);
        if (y >= 1990 && y <= CURRENT_YEAR) year = parts[i];
      }
    }

    const digits = text.replace(/\D/g, '');
    if (!tip || !mkn) {
      for (let i = 0; i <= digits.length - 12; i++) {
        const t = digits.slice(i, i + 4);
        const m = digits.slice(i + 4, i + 12);
        const n = Number(t);
        if (n >= 1400 && n <= 1799 && /^\d{8}$/.test(m) && !/^0{8}$/.test(m)) {
          tip = tip || t;
          mkn = mkn || m;
          break;
        }
      }
    }

    if (!mkn && digits.length === 8 && !/^0{8}$/.test(digits)) mkn = digits;

    if (!year) {
      const ys = text.match(/(?:19\d{2}|20\d{2})/g) || [];
      year = ys.find(y => Number(y) >= 1990 && Number(y) <= CURRENT_YEAR) || '';
    }

    if (/ISKRA|AM550|ISKRAEMECO/i.test(text)) maker = 'ISKRA';
    else if (/LANDIS|GYR/i.test(text)) maker = 'Landis+Gyr';

    if (!tip && !mkn) return null;
    return { tip, mkn, year, maker, raw: text };
  }

  function applyResult(result) {
    if (!result) return;
    if (result.mkn && $('mkn')) $('mkn').value = result.mkn;
    if (result.tip && $('tip')) $('tip').value = result.tip;
    if (result.year && $('year')) $('year').value = result.year;
    if (result.maker && $('maker')) $('maker').value = result.maker;
    if (typeof validateFields === 'function') validateFields();

    const box = $('ocrBox');
    if (box) box.textContent = `KODA: ${result.raw}`;

    const status = $('ocrStatus');
    if (status) {
      if (result.tip && result.mkn) {
        status.textContent = `✅ KODA PREBRANA: ${result.tip} / ${result.mkn}` +
          (result.year ? ` / ${result.year}` : '') +
          (!result.year ? ' · leto po potrebi vpiši ročno' : '');
      } else if (result.mkn) {
        status.textContent = `✅ KODA PREBRANA: MKN ${result.mkn} · TIP MKN po potrebi vpiši ročno`;
      }
    }

    const frame = document.getElementById('scanFrame');
    if (frame) {
      frame.classList.add('found');
      setTimeout(() => frame.classList.remove('found'), 1200);
    }
    try { if (navigator.vibrate) navigator.vibrate(90); } catch (_) {}
  }

  function stopScanner(message) {
    try { if (controls) controls.stop(); } catch (_) {}
    controls = null;
    starting = false;
    const video = document.getElementById('liveVideo');
    try {
      const stream = video?.srcObject;
      if (stream && stream.getTracks) stream.getTracks().forEach(t => t.stop());
      if (video) video.srcObject = null;
    } catch (_) {}
    const startBtn = document.getElementById('startCameraBtn');
    const stopBtn = document.getElementById('stopCameraBtn');
    if (startBtn) startBtn.style.display = '';
    if (stopBtn) stopBtn.style.display = 'none';
    if (message && $('ocrStatus')) $('ocrStatus').textContent = message;
  }

  async function startScanner() {
    if (starting || controls) return;
    const video = document.getElementById('liveVideo');
    const status = $('ocrStatus');
    const startBtn = document.getElementById('startCameraBtn');
    const stopBtn = document.getElementById('stopCameraBtn');
    if (!video) return;

    if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
      if (status) status.textContent = '⚠️ Čitalnik kode se še ni naložil. Osveži stran.';
      return;
    }

    starting = true;
    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = '';
    if (status) status.textContent = '📷 Kamera je vključena · pokaži črtno ali QR kodo v okvir.';

    try {
      reader ||= new ZXingBrowser.BrowserMultiFormatReader();
      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      };

      controls = await reader.decodeFromConstraints(constraints, video, (result) => {
        if (!result) return;
        const raw = typeof result.getText === 'function' ? result.getText() : (result.text || String(result));
        const now = Date.now();
        if (raw === lastRaw && now - lastAt < 2500) return;
        const parsed = parseCode(raw);
        if (!parsed) return;

        lastRaw = raw;
        lastAt = now;
        applyResult(parsed);

        // Ko je koda uspešno prebrana, kamero ustavimo, da naslednja koda ne prepiše podatkov.
        setTimeout(() => stopScanner('✅ Koda prebrana. Preveri podatke in shrani.'), 250);
      });
      starting = false;
    } catch (e) {
      console.warn('Live scanner:', e);
      stopScanner('⚠️ Kamera se ni odprla. Pritisni »Vklopi kamero« in dovoli dostop do kamere.');
    }
  }

  function buildUi() {
    const photo = $('photo');
    const card = photo?.closest('section.card');
    if (!card || document.getElementById('liveScannerWrap')) return;

    // Stari način fotografiranja/OCR skrijemo. V živo beremo samo črtno/QR kodo.
    ['photo','preview','readBtn','clearPhotoBtn'].forEach(id => {
      const e = $(id); if (e) e.style.display = 'none';
    });
    const detailsCard = $('ocrBox')?.closest('section.card');
    if (detailsCard) detailsCard.style.display = 'none';

    const counter = card.querySelector('.counter');
    if (counter) counter.textContent = '1. Skeniraj črtno kodo / QR';

    const style = document.createElement('style');
    style.textContent = `
      #liveScannerWrap{margin-top:10px}
      #videoBox{position:relative;width:100%;aspect-ratio:3/4;max-height:68vh;background:#111;border-radius:14px;overflow:hidden;border:2px solid #0b5e3b}
      #liveVideo{width:100%;height:100%;object-fit:cover;display:block;background:#111}
      #scanFrame{position:absolute;left:8%;right:8%;top:32%;height:34%;border:3px solid #f3c94f;border-radius:14px;box-shadow:0 0 0 9999px #0004;pointer-events:none;transition:.15s}
      #scanFrame::after{content:'PORAVNAJ ČRTNO / QR KODO V OKVIR';position:absolute;left:0;right:0;bottom:-34px;text-align:center;color:#fff;font-weight:800;font-size:12px;text-shadow:0 1px 3px #000}
      #scanFrame.found{border-color:#39d353;box-shadow:0 0 0 9999px #0002,0 0 22px #39d353}
      #cameraButtons{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      #cameraButtons button{flex:1;min-width:150px}
    `;
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.id = 'liveScannerWrap';
    wrap.innerHTML = `
      <div id="videoBox">
        <video id="liveVideo" playsinline muted autoplay></video>
        <div id="scanFrame"></div>
      </div>
      <div id="cameraButtons">
        <button class="primary" id="startCameraBtn">📷 Vklopi kamero</button>
        <button class="secondary" id="stopCameraBtn" style="display:none">⏹ Ustavi kamero</button>
      </div>`;
    counter?.insertAdjacentElement('afterend', wrap);

    document.getElementById('startCameraBtn')?.addEventListener('click', startScanner);
    document.getElementById('stopCameraBtn')?.addEventListener('click', () => stopScanner('Kamera je ustavljena.'));

    // Naslednji števec: po čiščenju polj se kamera spet sama vključi.
    $('newBtn')?.addEventListener('click', () => {
      lastRaw = '';
      lastAt = 0;
      setTimeout(startScanner, 350);
    });

    if ($('ocrStatus')) $('ocrStatus').textContent = 'Kamera bere črtno ali QR kodo samodejno. Ni treba fotografirati.';

    // Poskus samodejnega zagona. Če iPhone zahteva dotik, ostane gumb Vklopi kamero.
    setTimeout(startScanner, 450);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUi, {once:true});
  else buildUi();

  window.addEventListener('pagehide', () => stopScanner());
})();
