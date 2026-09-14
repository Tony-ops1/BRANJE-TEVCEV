(() => {
  const btn = document.getElementById('readBtn');
  if (!btn) return;

  const CURRENT_YEAR = new Date().getFullYear();
  let worker = null;
  let progressLabel = 'OCR';
  const el = id => document.getElementById(id);

  // Univerzalno pravilo: TIP MKN je 4-mestna številka, praviloma v območju 1400–1799.
  // Ni več seznama posameznih tipov števcev.
  function validTip(x) {
    if (!/^\d{4}$/.test(x)) return false;
    const n = Number(x);
    return n >= 1400 && n <= 1799;
  }

  function validMkn(x) {
    return /^\d{8}$/.test(x) && !/^0{8}$/.test(x);
  }

  function normalize(s) {
    return String(s || '').toUpperCase()
      .replace(/[OQD]/g, '0')
      .replace(/[IL|]/g, '1')
      .replace(/Z/g, '2')
      .replace(/S/g, '5')
      .replace(/B/g, '8')
      .replace(/G/g, '6');
  }

  function digits(s) {
    return normalize(s).replace(/[^0-9]/g, '');
  }

  function meterContextScore(s) {
    const u = String(s || '').toUpperCase();
    let score = 0;
    if (/TRIFAZ|ENOFAZ|ŠTEVEC|STEVEC|METER/.test(u)) score += 70;
    if (/LANDIS|GYR|ISKRA|ISKRAEMECO|SAGEM|ITRON|ELSTER|KAMSTRUP|SIEMENS|EMH|ZIV/.test(u)) score += 30;
    if (/KWH|ENERGIJA|TARIFA|IMP\/KWH|230V|3X230|400V/.test(u)) score += 18;
    if (/FLEX\s*II|PLC\s*MODULE|PLC\s*MODUL|COMMUNICATION|KOMUNIKACIJSKI|AD[- ]?[A-Z]{2}/.test(u)) score -= 180;
    return score;
  }

  function manufacturerFromText(text) {
    const u = String(text || '').toUpperCase();
    if (/LANDIS\s*\+?\s*GYR|LANDISGYR|LANDIS/.test(u)) return 'Landis+Gyr';
    if (/ISKRAEMECO/.test(u)) return 'ISKRAEMECO';
    if (/\bISKRA\b/.test(u)) return 'ISKRA';
    if (/SAGEMCOM|SAGEM/.test(u)) return 'Sagemcom';
    if (/\bITRON\b/.test(u)) return 'Itron';
    if (/\bELSTER\b/.test(u)) return 'Elster';
    if (/\bKAMSTRUP\b/.test(u)) return 'Kamstrup';
    if (/\bSIEMENS\b/.test(u)) return 'Siemens';
    if (/\bEMH\b/.test(u)) return 'EMH';
    if (/\bZIV\b/.test(u)) return 'ZIV';
    return '';
  }

  function yearFromText(text) {
    const years = String(text || '').match(/\b(?:19\d{2}|20\d{2})\b/g) || [];
    for (const y of years) {
      const n = Number(y);
      if (n >= 1990 && n <= CURRENT_YEAR) return y;
    }
    return '';
  }

  // Poišče TIP+MKN brez znanja o modelu. Deluje tudi, če OCR med številke vrine presledke.
  function pairCandidates(text, sourceBonus = 0) {
    const raw = String(text || '');
    const lines = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const out = [];

    function addCandidate(tip, mkn, context, base = 100) {
      if (!validTip(tip) || !validMkn(mkn)) return;
      let score = base + sourceBonus + meterContextScore(context);
      // Certifikacijske oznake in leta naj ne prevladajo.
      if (/\bM\d{2}\b|\bCE\b/.test(String(context || '').toUpperCase())) score -= 6;
      out.push({tip, mkn, score, context});
    }

    // 1–3 zaporedne OCR vrstice: koristno, ko je TIP na eni, MKN pa na naslednji vrstici.
    for (let i = 0; i < lines.length; i++) {
      for (let count = 1; count <= 3; count++) {
        if (i + count > lines.length) break;
        const group = lines.slice(i, i + count).join(' ');
        const ds = digits(group);
        if (ds.length < 12) continue;

        // Preglej VSA 12-mestna okna, ne samo znanih tipov.
        for (let p = 0; p <= ds.length - 12; p++) {
          const tip = ds.slice(p, p + 4);
          const mkn = ds.slice(p + 4, p + 12);
          if (validTip(tip) && validMkn(mkn)) {
            const context = [lines[i-2], lines[i-1], group, lines[i+count], lines[i+count+1]]
              .filter(Boolean).join(' ');
            addCandidate(tip, mkn, context, 105 - p * 0.3);
          }
        }
      }
    }

    // Neposreden zapis 1631 52064735 ali 1631-52064735 ipd.
    const ntext = normalize(raw);
    const direct = /(^|\D)(1[4-7]\d{2})[^0-9]{0,30}(\d{8})(?!\d)/gm;
    let m;
    while ((m = direct.exec(ntext))) {
      const around = raw.slice(Math.max(0, m.index - 150), Math.min(raw.length, direct.lastIndex + 150));
      addCandidate(m[2], m[3], around, 118);
    }

    // Odstrani podvojene kandidate in obdrži najboljšo oceno.
    const uniq = new Map();
    for (const c of out) {
      const key = `${c.tip}-${c.mkn}`;
      const old = uniq.get(key);
      if (!old || c.score > old.score) uniq.set(key, c);
    }
    return [...uniq.values()].sort((a,b) => b.score - a.score);
  }

  function extract(text, sourceBonus = 0) {
    const raw = String(text || '');
    const ntext = normalize(raw);
    const candidates = pairCandidates(raw, sourceBonus);
    let tip = candidates[0]?.tip || '';
    let mkn = candidates[0]?.mkn || '';

    if (!tip) {
      const c4 = [...ntext.matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map(m => m[1]);
      tip = c4.find(validTip) || '';
    }
    if (!mkn) {
      const c8 = [...ntext.matchAll(/(?<!\d)(\d{8})(?!\d)/g)].map(m => m[1]);
      mkn = c8.find(validMkn) || '';
    }

    return {
      tip,
      mkn,
      year: yearFromText(raw),
      maker: manufacturerFromText(raw),
      pairFound: !!(tip && mkn && candidates.length),
      candidates
    };
  }

  function coreComplete(d) { return !!(d.tip && d.mkn && d.year); }
  function complete(d) { return !!(d.tip && d.mkn && d.year && d.maker); }

  async function getWorker() {
    if (worker) return worker;
    progressLabel = 'Prvi zagon OCR';
    worker = await Tesseract.createWorker('eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text' && el('ocrStatus')) {
          el('ocrStatus').textContent = `${progressLabel} · ${Math.round((m.progress || 0) * 100)}%`;
        }
      }
    });
    try {
      await worker.setParameters({tessedit_pageseg_mode: '11'});
    } catch (_) {}
    return worker;
  }

  async function loadImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, {imageOrientation: 'from-image'}); }
      catch (_) { try { return await createImageBitmap(file); } catch (_) {} }
    }
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  function drawCanvas(img, angle = 0, maxSide = 1100, contrast = false) {
    const iw = img.width || img.naturalWidth;
    const ih = img.height || img.naturalHeight;
    const scale = Math.min(1, maxSide / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));
    const a = angle * Math.PI / 180;
    const cw = Math.ceil(Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)));
    const ch = Math.ceil(Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a)));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d', {alpha:false});
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,cw,ch);
    ctx.translate(cw/2, ch/2); ctx.rotate(a);
    if (contrast && 'filter' in ctx) ctx.filter = 'grayscale(1) contrast(1.7) brightness(1.08)';
    ctx.drawImage(img, -w/2, -h/2, w, h);
    return c;
  }

  function cropCanvas(img, xPct, yPct, wPct, hPct, maxSide = 1650, contrast = true) {
    const iw = img.width || img.naturalWidth;
    const ih = img.height || img.naturalHeight;
    const sx = Math.max(0, Math.round(iw * xPct));
    const sy = Math.max(0, Math.round(ih * yPct));
    const sw = Math.max(1, Math.min(iw - sx, Math.round(iw * wPct)));
    const sh = Math.max(1, Math.min(ih - sy, Math.round(ih * hPct)));
    const scale = Math.min(3.2, maxSide / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * scale));
    c.height = Math.max(1, Math.round(sh * scale));
    const ctx = c.getContext('2d', {alpha:false});
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height);
    if (contrast && 'filter' in ctx) ctx.filter = 'grayscale(1) contrast(1.85) brightness(1.09)';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  function parseBarcodeValue(rawValue) {
    const ds = digits(rawValue);
    for (let i = 0; i <= ds.length - 12; i++) {
      const tip = ds.slice(i, i + 4);
      const mkn = ds.slice(i + 4, i + 12);
      if (validTip(tip) && validMkn(mkn)) return {tip, mkn};
    }
    return null;
  }

  async function detectBarcode(canvas) {
    if (!('BarcodeDetector' in window)) return null;
    try {
      let formats = ['code_128','code_39','ean_13','ean_8','qr_code','data_matrix'];
      if (BarcodeDetector.getSupportedFormats) {
        const supported = await BarcodeDetector.getSupportedFormats();
        formats = formats.filter(f => supported.includes(f));
      }
      if (!formats.length) return null;
      const detector = new BarcodeDetector({formats});
      const found = await detector.detect(canvas);
      for (const b of found) {
        const pair = parseBarcodeValue(b.rawValue || '');
        if (pair) return pair;
      }
    } catch (_) {}
    return null;
  }

  async function runGeneralOcr(w, canvas, label, sourceBonus = 0, psm = '11') {
    progressLabel = label;
    try { await w.setParameters({tessedit_pageseg_mode: psm, tessedit_char_whitelist: ''}); } catch (_) {}
    const result = await w.recognize(canvas, {rotateAuto:true});
    return {text: result.data?.text || '', data: extract(result.data?.text || '', sourceBonus)};
  }

  async function runNumericOcr(w, canvas, label, sourceBonus = 0) {
    progressLabel = label;
    try {
      await w.setParameters({
        tessedit_pageseg_mode: '11',
        tessedit_char_whitelist: '0123456789 -./'
      });
    } catch (_) {}
    const result = await w.recognize(canvas, {rotateAuto:true});
    try { await w.setParameters({tessedit_char_whitelist: '', tessedit_pageseg_mode: '11'}); } catch (_) {}
    return {text: result.data?.text || '', data: extract(result.data?.text || '', sourceBonus)};
  }

  function candidateScore(d) {
    const c = d?.candidates?.[0];
    return c?.score ?? (d?.tip && d?.mkn ? 90 : 0);
  }

  function merge(a, b) {
    const out = {...a};
    const aScore = candidateScore(a);
    const bScore = candidateScore(b);
    if (b.tip && b.mkn && (!out.tip || !out.mkn || bScore > aScore)) {
      out.tip = b.tip;
      out.mkn = b.mkn;
      out.pairFound = b.pairFound;
      out.candidates = b.candidates || [];
    }
    if (!out.year && b.year) out.year = b.year;
    if (!out.maker && b.maker) out.maker = b.maker;
    return out;
  }

  btn.onclick = async () => {
    const file = el('photo')?.files?.[0];
    if (!file) { alert('Najprej slikaj ali izberi fotografijo števca.'); return; }
    if (typeof Tesseract === 'undefined') { alert('OCR knjižnica se ni naložila. Preveri internetno povezavo.'); return; }

    btn.disabled = true;
    if (el('ocrStatus')) el('ocrStatus').textContent = '⚡ Berem števec…';
    let img;

    try {
      img = await loadImage(file);
      const w = await getWorker();
      const logs = [];
      let best = {tip:'', mkn:'', year:'', maker:'', pairFound:false, candidates:[]};

      // 1) Celotna slika – najhitrejši prehod.
      const full = drawCanvas(img, 0, 1150, false);
      const barcode = await detectBarcode(full);
      if (barcode) {
        best.tip = barcode.tip;
        best.mkn = barcode.mkn;
        best.pairFound = true;
        best.candidates = [{tip:barcode.tip, mkn:barcode.mkn, score:220, context:'barcode'}];
        logs.push(`Črtna/QR koda: ${barcode.tip} ${barcode.mkn}`);
      }

      const first = await runGeneralOcr(w, full, 'Hitro branje', 0, '11');
      best = merge(best, first.data);
      logs.push(first.text);

      // 2) Univerzalni zgornji del števca. Pri večini fotografij je spodaj le prazno ohišje.
      if (!best.tip || !best.mkn) {
        const top = cropCanvas(img, 0.00, 0.00, 1.00, 0.66, 1750, true);
        const focused = await runGeneralOcr(w, top, 'Povečujem napisno ploščico', 24, '6');
        best = merge(best, focused.data);
        logs.push(focused.text);
      }

      // 3) Če je napis zamegljen, naredi številčni OCR istega območja.
      if (!best.tip || !best.mkn) {
        const topNum = cropCanvas(img, 0.02, 0.05, 0.96, 0.58, 1850, true);
        const numeric = await runNumericOcr(w, topNum, 'Berem samo številke', 18);
        best = merge(best, numeric.data);
        logs.push(numeric.text);
      }

      // 4) Navpične oznake ali obrnjena fotografija: univerzalno, brez preverjanja modela.
      if (!best.tip || !best.mkn) {
        for (const angle of [90, -90, 180]) {
          const rotated = drawCanvas(img, angle, 1250, true);
          const r = await runNumericOcr(w, rotated, `Preverjam zasuk ${angle}°`, 8);
          best = merge(best, r.data);
          logs.push(r.text);
          if (best.tip && best.mkn) break;
        }
      }

      // 5) Če imamo TIP/MKN, manjka pa leto ali proizvajalec, še en lahek tekstovni prehod po zgornjem delu.
      if ((best.tip && best.mkn) && (!best.year || !best.maker)) {
        const topText = cropCanvas(img, 0.00, 0.00, 1.00, 0.58, 1450, false);
        const extra = await runGeneralOcr(w, topText, 'Dopolnjujem leto in proizvajalca', 0, '11');
        best = merge(best, extra.data);
        logs.push(extra.text);
      }

      if (el('ocrBox')) el('ocrBox').textContent = logs.filter(Boolean).join('\n\n---\n\n') || '(ni prepoznanega besedila)';
      if (el('mkn')) el('mkn').value = best.mkn || '';
      if (el('tip')) el('tip').value = best.tip || '';
      if (el('year')) el('year').value = best.year || '';
      if (el('maker')) el('maker').value = best.maker || '';
      if (typeof validateFields === 'function') validateFields();

      if (el('ocrStatus')) {
        if (coreComplete(best)) {
          el('ocrStatus').textContent = '✅ Prebrano. Univerzalni način ne uporablja seznama tipov števcev. Preveri in shrani.';
        } else if (best.tip && best.mkn) {
          el('ocrStatus').textContent = '⚠️ TIP in MKN sta prebrana, manjka leto. Preveri leto ročno.';
        } else {
          el('ocrStatus').textContent = '⚠️ Napis je preveč zamegljen ali zakrit. Približaj telefon napisni ploščici in poskusi ponovno.';
        }
      }
    } catch (err) {
      console.error(err);
      if (el('ocrStatus')) el('ocrStatus').textContent = 'Napaka pri OCR: ' + (err?.message || 'neznana napaka');
    } finally {
      try { if (img && typeof img.close === 'function') img.close(); } catch (_) {}
      btn.disabled = false;
    }
  };

  if (el('ocrStatus')) el('ocrStatus').textContent = 'Po slikanju se podatki preberejo samodejno.';

  window.addEventListener('pagehide', () => {
    if (worker) {
      const w = worker;
      worker = null;
      try { w.terminate(); } catch (_) {}
    }
  });
})();