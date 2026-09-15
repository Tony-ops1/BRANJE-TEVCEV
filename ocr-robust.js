(() => {
  const btn = document.getElementById('readBtn');
  if (!btn) return;

  const CURRENT_YEAR = new Date().getFullYear();
  const $ = id => document.getElementById(id);
  let worker = null;
  let progressLabel = 'OCR';

  function validTip(x) {
    return /^\d{4}$/.test(x) && Number(x) >= 1400 && Number(x) <= 1799;
  }
  function validMkn(x) {
    return /^\d{8}$/.test(x) && !/^0{8}$/.test(x);
  }

  // Pomembno: črk NE pretvarjamo v številke po celem besedilu.
  // Pretvorba je dovoljena samo znotraj žetona, ki je že videti kot številka.
  function numericLike(raw) {
    let s = String(raw || '').toUpperCase().replace(/[.,:;()\[\]{}]/g, '');
    if (!s) return '';
    const digits = (s.match(/[0-9]/g) || []).length;
    const conf = (s.match(/[OQDIL|ZSBG]/g) || []).length;
    const otherLetters = (s.match(/[ACEFHKMNP-RTUVWXY]/g) || []).length;
    if (digits + conf < 2 || otherLetters > 0) return '';
    if (digits === 0 && conf < 4) return '';
    return s
      .replace(/[OQD]/g, '0')
      .replace(/[IL|]/g, '1')
      .replace(/Z/g, '2')
      .replace(/S/g, '5')
      .replace(/B/g, '8')
      .replace(/G/g, '6')
      .replace(/[^0-9]/g, '');
  }

  function numericTokens(line) {
    const parts = String(line || '').match(/[A-Za-z0-9|]+/g) || [];
    return parts.map((raw, index) => ({raw, value: numericLike(raw), index})).filter(t => t.value);
  }

  function meterContextScore(text) {
    const u = String(text || '').toUpperCase();
    let s = 0;
    if (/TRIFAZ|ENOFAZ|ŠTEVEC|STEVEC|METER/.test(u)) s += 45;
    if (/LANDIS|GYR|ISKRA|ISKRAEMECO|SAGEM|ITRON|ELSTER|KAMSTRUP|SIEMENS|EMH|ZIV/.test(u)) s += 30;
    if (/KWH|ENERGIJA|TARIFA|IMP\/KWH|230\s*V|400\s*V/.test(u)) s += 18;
    if (/BARCODE|ČRTN|CRTNA/.test(u)) s += 15;
    if (/FLEX\s*II|PLC\s*MODULE|PLC\s*MODUL|COMMUNICATION|KOMUNIKACIJSKI|AD[- ]?[A-Z]{2}/.test(u)) s -= 260;
    return s;
  }

  function manufacturerFromText(text) {
    const u = String(text || '').toUpperCase();
    if (/LANDIS\s*\+?\s*GYR|LANDISGYR|\bLANDIS\b/.test(u)) return 'Landis+Gyr';
    if (/ISKRAEMECO/.test(u)) return 'ISKRAEMECO';
    if (/\bISKRA\b/.test(u)) return 'ISKRA';
    if (/SAGEMCOM|\bSAGEM\b/.test(u)) return 'Sagemcom';
    if (/\bITRON\b/.test(u)) return 'Itron';
    if (/\bELSTER\b/.test(u)) return 'Elster';
    if (/\bKAMSTRUP\b/.test(u)) return 'Kamstrup';
    if (/\bSIEMENS\b/.test(u)) return 'Siemens';
    if (/\bEMH\b/.test(u)) return 'EMH';
    if (/\bZIV\b/.test(u)) return 'ZIV';
    return '';
  }

  function yearCandidate(text, sourceBonus = 0) {
    const lines = String(text || '').split(/\r?\n/);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const t of numericTokens(line)) {
        if (t.value.length !== 4) continue;
        const n = Number(t.value);
        if (n < 1990 || n > CURRENT_YEAR) continue;
        const ctx = [lines[i-1], line, lines[i+1]].filter(Boolean).join(' ');
        let score = 100 + sourceBonus;
        if (/MADE|LANDIS|ISKRA|GYR|ŠT\.?|ST\.?/i.test(ctx)) score += 25;
        if (/M\s*\d{2}|CE\s*M/i.test(ctx)) score -= 15;
        out.push({year:t.value, score});
      }
    }
    out.sort((a,b) => b.score-a.score);
    return out[0] || null;
  }

  function pairCandidates(text, sourceBonus = 0) {
    const raw = String(text || '');
    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const out = [];

    function add(tip, mkn, base, context, kind) {
      if (!validTip(tip) || !validMkn(mkn)) return;
      let score = base + sourceBonus + meterContextScore(context);
      out.push({tip, mkn, score, context, kind});
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const toks = numericTokens(line);
      const context = [lines[i-2], lines[i-1], line, lines[i+1], lines[i+2]].filter(Boolean).join(' ');

      // Najzanesljivejše: en sam 12-mestni zapis TIP+MKN.
      for (const t of toks) {
        if (t.value.length === 12) {
          add(t.value.slice(0,4), t.value.slice(4), 310, context, '12-mestni zapis');
        }
      }

      // Zapis 1591 15286006 oziroma TIP in MKN v isti vrstici.
      for (let a = 0; a < toks.length; a++) {
        if (toks[a].value.length !== 4 || !validTip(toks[a].value)) continue;
        let acc = '';
        for (let b = a + 1; b < Math.min(toks.length, a + 5); b++) {
          const v = toks[b].value;
          if (v.length > 8) break;
          acc += v;
          if (acc.length === 8) {
            add(toks[a].value, acc, b === a+1 ? 285 : 245, context, 'ista vrstica');
            break;
          }
          if (acc.length > 8) break;
        }
      }
    }

    // Dve sosednji vrstici: samo kot rezerva, ker je možnost napačnega združevanja večja.
    for (let i = 0; i < lines.length - 1; i++) {
      const a = numericTokens(lines[i]);
      const b = numericTokens(lines[i+1]);
      const ctx = [lines[i-1], lines[i], lines[i+1], lines[i+2]].filter(Boolean).join(' ');
      for (const ta of a) {
        if (ta.value.length !== 4 || !validTip(ta.value)) continue;
        const eight = b.find(tb => tb.value.length === 8 && validMkn(tb.value));
        if (eight) add(ta.value, eight.value, 165, ctx, 'sosednji vrstici');
      }
    }

    const unique = new Map();
    for (const c of out) {
      const key = `${c.tip}-${c.mkn}`;
      if (!unique.has(key) || unique.get(key).score < c.score) unique.set(key, c);
    }
    return [...unique.values()].sort((a,b) => b.score-a.score);
  }

  function fallbackMkn(text, sourceBonus = 0) {
    const lines = String(text || '').split(/\r?\n/);
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ctx = [lines[i-1], line, lines[i+1]].filter(Boolean).join(' ');
      for (const t of numericTokens(line)) {
        if (!validMkn(t.value)) continue;
        let score = 60 + sourceBonus;
        if (/ŠT\.?|ST\.?|SERIAL|NO\.?/i.test(ctx)) score += 75;
        if (/LANDIS|ISKRA|GYR|KWH/i.test(ctx)) score += 20;
        if (/FLEX|PLC\s*MODULE|PLC\s*MODUL/i.test(ctx)) score -= 220;
        candidates.push({mkn:t.value, score});
      }
    }
    candidates.sort((a,b)=>b.score-a.score);
    return candidates[0] && candidates[0].score >= 120 ? candidates[0] : null;
  }

  function extract(text, sourceBonus = 0) {
    const pairs = pairCandidates(text, sourceBonus);
    const strongPair = pairs.find(p => p.score >= 175) || null;
    const yc = yearCandidate(text, sourceBonus);
    const fm = fallbackMkn(text, sourceBonus);
    return {
      tip: strongPair?.tip || '',
      mkn: strongPair?.mkn || fm?.mkn || '',
      pairScore: strongPair?.score || 0,
      pairFound: !!strongPair,
      year: yc?.year || '',
      yearScore: yc?.score || 0,
      maker: manufacturerFromText(text),
      candidates: pairs
    };
  }

  function merge(a, b) {
    const out = {...a};
    if (b.pairFound && (!out.pairFound || b.pairScore > (out.pairScore || 0))) {
      out.tip = b.tip; out.mkn = b.mkn; out.pairFound = true; out.pairScore = b.pairScore; out.candidates = b.candidates;
    } else if (!out.mkn && b.mkn) {
      out.mkn = b.mkn;
    }
    if (b.year && (!out.year || b.yearScore > (out.yearScore || 0))) {
      out.year = b.year; out.yearScore = b.yearScore;
    }
    if (!out.maker && b.maker) out.maker = b.maker;
    return out;
  }

  async function getWorker() {
    if (worker) return worker;
    progressLabel = 'Prvi zagon OCR';
    worker = await Tesseract.createWorker('eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text' && $('ocrStatus')) {
          $('ocrStatus').textContent = `${progressLabel} · ${Math.round((m.progress || 0) * 100)}%`;
        }
      }
    });
    return worker;
  }

  async function loadImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, {imageOrientation:'from-image'}); }
      catch (_) { try { return await createImageBitmap(file); } catch (_) {} }
    }
    return new Promise((resolve,reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  function canvasCrop(img, x, y, w, h, maxSide=1600, contrast=false, angle=0) {
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const sx = Math.max(0, Math.round(iw*x)), sy = Math.max(0, Math.round(ih*y));
    const sw = Math.max(1, Math.min(iw-sx, Math.round(iw*w))), sh = Math.max(1, Math.min(ih-sy, Math.round(ih*h)));
    const scale = Math.min(3.2, maxSide / Math.max(sw,sh));
    const bw = Math.round(sw*scale), bh = Math.round(sh*scale);
    const rad = angle*Math.PI/180;
    const cw = Math.ceil(Math.abs(bw*Math.cos(rad))+Math.abs(bh*Math.sin(rad)));
    const ch = Math.ceil(Math.abs(bw*Math.sin(rad))+Math.abs(bh*Math.cos(rad)));
    const c = document.createElement('canvas'); c.width=cw; c.height=ch;
    const ctx = c.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,cw,ch);
    ctx.translate(cw/2,ch/2); ctx.rotate(rad);
    if (contrast && 'filter' in ctx) ctx.filter='grayscale(1) contrast(1.75) brightness(1.08)';
    ctx.drawImage(img,sx,sy,sw,sh,-bw/2,-bh/2,bw,bh);
    return c;
  }

  async function ocr(w, canvas, label, sourceBonus=0, numericOnly=false, psm='11') {
    progressLabel = label;
    try {
      await w.setParameters({
        tessedit_pageseg_mode: psm,
        tessedit_char_whitelist: numericOnly ? '0123456789 OQDIL|ZSBG-./' : ''
      });
    } catch (_) {}
    const r = await w.recognize(canvas, {rotateAuto:true});
    const text = r.data?.text || '';
    return {text, data: extract(text, sourceBonus)};
  }

  function parseBarcode(raw) {
    const v = numericLike(raw);
    if (v.length === 12 && validTip(v.slice(0,4)) && validMkn(v.slice(4))) return {tip:v.slice(0,4),mkn:v.slice(4)};
    return null;
  }

  async function barcode(canvas) {
    if (!('BarcodeDetector' in window)) return null;
    try {
      let formats=['code_128','code_39','ean_13','ean_8','qr_code','data_matrix'];
      if (BarcodeDetector.getSupportedFormats) {
        const supported=await BarcodeDetector.getSupportedFormats();
        formats=formats.filter(f=>supported.includes(f));
      }
      if (!formats.length) return null;
      const det=new BarcodeDetector({formats});
      const found=await det.detect(canvas);
      for (const b of found) { const p=parseBarcode(b.rawValue||''); if(p) return p; }
    } catch (_) {}
    return null;
  }

  btn.onclick = async () => {
    const file = $('photo')?.files?.[0];
    if (!file) { alert('Najprej slikaj ali izberi fotografijo števca.'); return; }
    if (typeof Tesseract === 'undefined') { alert('OCR knjižnica se ni naložila.'); return; }

    btn.disabled = true;
    if ($('ocrStatus')) $('ocrStatus').textContent='⚡ Berem napisno ploščico…';
    let img;
    try {
      img = await loadImage(file);
      const w = await getWorker();
      const logs=[];
      let best={tip:'',mkn:'',pairFound:false,pairScore:0,year:'',yearScore:0,maker:'',candidates:[]};

      // Najprej beremo osrednji zgornji del, ne cele slike. Tako števci v ozadju ne prevladajo.
      const plate = canvasCrop(img,0.03,0.00,0.94,0.76,1600,false,0);
      const bc = await barcode(plate);
      if (bc) {
        best={...best,tip:bc.tip,mkn:bc.mkn,pairFound:true,pairScore:500,candidates:[{...bc,score:500,kind:'barcode'}]};
        logs.push(`KODA: ${bc.tip} ${bc.mkn}`);
      }

      const first = await ocr(w,plate,'Hitro branje',45,false,'11');
      best=merge(best,first.data); logs.push(first.text);

      if (!best.pairFound) {
        const numPlate=canvasCrop(img,0.03,0.12,0.94,0.58,1850,true,0);
        const n=await ocr(w,numPlate,'Preverjam TIP in MKN',55,true,'11');
        best=merge(best,n.data); logs.push(n.text);
      }

      // Leto je pogosto majhno in v kotu, zato se preveri ločeno samo, kadar manjka.
      if (!best.year) {
        const regions=[
          [0.00,0.00,0.55,0.45,'Leto zgoraj levo'],
          [0.45,0.00,0.55,0.45,'Leto zgoraj desno'],
          [0.00,0.20,0.55,0.42,'Leto sredina levo'],
          [0.45,0.20,0.55,0.42,'Leto sredina desno']
        ];
        for (const r of regions) {
          const c=canvasCrop(img,r[0],r[1],r[2],r[3],1500,true,0);
          const z=await ocr(w,c,r[4],70,false,'11');
          best=merge(best,z.data); logs.push(z.text);
          if (best.year) break;
        }
      }

      // Navpični ali obrnjeni napisi samo kot rezerva.
      if (!best.pairFound) {
        for (const angle of [90,-90,180]) {
          const c=canvasCrop(img,0.02,0.00,0.96,0.76,1450,true,angle);
          const z=await ocr(w,c,`Zasuk ${angle}°`,25,true,'11');
          best=merge(best,z.data); logs.push(z.text);
          if (best.pairFound) break;
        }
      }

      // Proizvajalec: če še manjka, en hiter tekstovni prehod zgornjega dela.
      if (!best.maker) {
        const c=canvasCrop(img,0.00,0.00,1.00,0.45,1200,false,0);
        const z=await ocr(w,c,'Proizvajalec',25,false,'11');
        best=merge(best,z.data); logs.push(z.text);
      }

      if ($('ocrBox')) $('ocrBox').textContent=logs.filter(Boolean).join('\n\n---\n\n') || '(ni prepoznanega besedila)';
      if ($('mkn')) $('mkn').value=best.mkn || '';
      if ($('tip')) $('tip').value=best.tip || '';
      if ($('year')) $('year').value=best.year || '';
      if ($('maker')) $('maker').value=best.maker || '';
      if (typeof validateFields === 'function') validateFields();

      if ($('ocrStatus')) {
        if (best.pairFound && best.year && best.maker) $('ocrStatus').textContent='✅ Prebrano. Preveri podatke in shrani.';
        else if (!best.pairFound) $('ocrStatus').textContent='⚠️ TIP/MKN nista dovolj zanesljivo prebrana. Podatka sem raje pustil prazna kot napačna.';
        else if (!best.year) $('ocrStatus').textContent='⚠️ TIP in MKN sta prebrana, leto ni dovolj jasno.';
        else $('ocrStatus').textContent='⚠️ Prebrano delno. Preveri manjkajoči podatek.';
      }
    } catch (e) {
      console.error(e);
      if ($('ocrStatus')) $('ocrStatus').textContent='Napaka pri OCR: '+(e?.message||'neznana napaka');
    } finally {
      try { if (img && typeof img.close==='function') img.close(); } catch (_) {}
      btn.disabled=false;
    }
  };

  if ($('ocrStatus')) $('ocrStatus').textContent='Po slikanju se podatki preberejo samodejno.';
  window.addEventListener('pagehide',()=>{
    if(worker){const w=worker;worker=null;try{w.terminate();}catch(_){}}
  });
})();