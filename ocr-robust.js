(() => {
  const btn = document.getElementById('readBtn');
  if (!btn) return;

  const CURRENT = new Date().getFullYear();
  const METER_TIPS = [
    '1483','1504','1505','1508','1509','1531','1532','1563','1580','1581',
    '1591','1631','1632','1633','1638','1639','1661','1676','1679','1680','1681','1682','1687'
  ];
  const MODULE_TIPS = new Set(['1584']); // Flex II / PLC modul - ni glavni števec
  let worker = null;
  let progressLabel = 'OCR';
  const el = id => document.getElementById(id);

  function normalize(s) {
    return String(s || '').toUpperCase()
      .replace(/[OQD]/g,'0').replace(/[IL|]/g,'1')
      .replace(/Z/g,'2').replace(/S/g,'5')
      .replace(/B/g,'8').replace(/G/g,'6');
  }
  function digits(s) { return normalize(s).replace(/[^0-9]/g,''); }
  function validTip(x) {
    if (!/^\d{4}$/.test(x) || MODULE_TIPS.has(x)) return false;
    const n = Number(x);
    return METER_TIPS.includes(x) || (n >= 1400 && n <= 1799);
  }

  function contextScore(s) {
    const u = String(s || '').toUpperCase();
    let score = 0;
    if (/TRIFAZ|ENOFAZ|STEVEC|ŠTEVEC/.test(u)) score += 55;
    if (/LANDIS|ISKRA|E450|E350|AM550|ZMF|ZMX|ZCF/.test(u)) score += 28;
    if (/FLEX\s*II|PLC\s*MODULE|PLC\s*MODUL|AD[- ]?CP|AD[- ]?FP/.test(u)) score -= 180;
    return score;
  }

  function pairCandidates(text) {
    const raw = String(text || '');
    const lines = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const out = [];

    for (let i = 0; i < lines.length; i++) {
      const groups = [lines[i]];
      if (i + 1 < lines.length) groups.push(lines[i] + ' ' + lines[i + 1]);
      if (i + 2 < lines.length) groups.push(lines[i] + ' ' + lines[i + 1] + ' ' + lines[i + 2]);

      for (const group of groups) {
        const ds = digits(group);
        if (ds.length < 12) continue;
        for (const tip of METER_TIPS) {
          let p = ds.indexOf(tip);
          while (p >= 0) {
            const mkn = ds.slice(p + 4, p + 12);
            if (/^\d{8}$/.test(mkn)) {
              const near = [lines[i-2],lines[i-1],group,lines[i+1],lines[i+2]].filter(Boolean).join(' ');
              let sc = 100 + contextScore(near);
              sc += Math.max(0, 20 - i); // rahla prednost glavnemu števcu, ki je običajno višje
              if (tip === '1591') sc += 8; // E350 števec; 1584 spodaj je Flex II modul
              out.push({tip,mkn,score:sc});
            }
            p = ds.indexOf(tip, p + 1);
          }
        }
      }
    }

    // neposreden vzorec TIP + MKN z razmiki/ločili
    const ntext = normalize(raw);
    const re = /(^|\D)(1[4-7]\d{2})[^0-9]{0,24}(\d{8})(?!\d)/gm;
    let m;
    while ((m = re.exec(ntext))) {
      if (validTip(m[2])) {
        const around = raw.slice(Math.max(0,m.index-120), Math.min(raw.length,re.lastIndex+120));
        out.push({tip:m[2],mkn:m[3],score:95+contextScore(around)});
      }
    }

    out.sort((a,b) => b.score - a.score);
    return out;
  }

  function extract(text) {
    text = text || '';
    const ntext = normalize(text);
    let maker = '';
    if (/LANDIS\s*\+?\s*GYR|LANDISGYR|\bLANDIS\b|\bGYR\b/i.test(text)) maker = 'Landis+Gyr';
    else if (/\bISKRA\b/i.test(text)) maker = 'ISKRA';

    let year = '';
    const ym = text.match(/\b(19\d{2}|20\d{2})\b/g) || [];
    for (const y of ym) {
      const yy = Number(y);
      if (yy >= 1990 && yy <= CURRENT) { year = y; break; }
    }

    let tip = '', mkn = '', pairFound = false;
    const candidates = pairCandidates(text);
    if (candidates.length) {
      tip = candidates[0].tip;
      mkn = candidates[0].mkn;
      pairFound = true;
    }

    if (!tip) {
      for (const k of METER_TIPS) {
        if (new RegExp('(^|\\D)' + k + '(\\D|$)').test(ntext)) { tip = k; break; }
      }
    }
    if (!tip) {
      const c4 = [...ntext.matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map(m => m[1]);
      tip = c4.find(validTip) || '';
    }

    if (!mkn) {
      const c8 = [...ntext.matchAll(/(?<!\d)(\d{8})(?!\d)/g)].map(m => m[1]);
      mkn = c8.find(x => !/^20\d{6}$/.test(x)) || '';
    }

    return {mkn, tip, year, maker, pairFound, candidates};
  }

  function score(d) {
    return (d.mkn?8:0) + (d.tip?7:0) + (d.year?4:0) + (d.maker?2:0) + (d.pairFound?7:0);
  }
  function complete(d) { return !!(d.mkn && d.tip && d.year && d.maker); }
  function coreComplete(d) { return !!(d.mkn && d.tip && d.year); }

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
    try { await worker.setParameters({ tessedit_pageseg_mode: '11' }); } catch (_) {}
    return worker;
  }

  async function loadImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, {imageOrientation:'from-image'}); }
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

  function makeCanvas(img, angle=0, maxSide=1100, contrast=false) {
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const scale = Math.min(1, maxSide / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));
    const a = angle * Math.PI / 180;
    const cw = Math.ceil(Math.abs(w*Math.cos(a)) + Math.abs(h*Math.sin(a)));
    const ch = Math.ceil(Math.abs(w*Math.sin(a)) + Math.abs(h*Math.cos(a)));
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const ctx = c.getContext('2d', {alpha:false});
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,cw,ch);
    ctx.translate(cw/2,ch/2); ctx.rotate(a);
    if (contrast && 'filter' in ctx) ctx.filter = 'grayscale(1) contrast(1.55) brightness(1.06)';
    ctx.drawImage(img,-w/2,-h/2,w,h);
    return c;
  }

  function cropCanvas(img, xPct, yPct, wPct, hPct, maxSide=1450, contrast=true) {
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const sx = Math.max(0, Math.round(iw*xPct));
    const sy = Math.max(0, Math.round(ih*yPct));
    const sw = Math.max(1, Math.min(iw-sx, Math.round(iw*wPct)));
    const sh = Math.max(1, Math.min(ih-sy, Math.round(ih*hPct)));
    const scale = Math.min(3, maxSide/Math.max(sw,sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1,Math.round(sw*scale));
    c.height = Math.max(1,Math.round(sh*scale));
    const ctx = c.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,c.width,c.height);
    if (contrast && 'filter' in ctx) ctx.filter='grayscale(1) contrast(1.7) brightness(1.08)';
    ctx.drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
    return c;
  }

  function rotateExisting(src, angle) {
    const a = angle*Math.PI/180;
    const cw = Math.ceil(Math.abs(src.width*Math.cos(a))+Math.abs(src.height*Math.sin(a)));
    const ch = Math.ceil(Math.abs(src.width*Math.sin(a))+Math.abs(src.height*Math.cos(a)));
    const c = document.createElement('canvas'); c.width=cw; c.height=ch;
    const ctx = c.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,cw,ch);
    ctx.translate(cw/2,ch/2); ctx.rotate(a); ctx.drawImage(src,-src.width/2,-src.height/2);
    return c;
  }

  async function detectBarcode(canvas) {
    if (!('BarcodeDetector' in window)) return null;
    try {
      let formats = ['code_128','code_39','ean_13','ean_8'];
      if (BarcodeDetector.getSupportedFormats) {
        const supported = await BarcodeDetector.getSupportedFormats();
        formats = formats.filter(f => supported.includes(f));
      }
      if (!formats.length) return null;
      const det = new BarcodeDetector({formats});
      const found = await det.detect(canvas);
      for (const b of found) {
        const d = digits(b.rawValue);
        if (d.length === 12 && validTip(d.slice(0,4))) return {tip:d.slice(0,4),mkn:d.slice(4)};
      }
    } catch (_) {}
    return null;
  }

  async function runOcr(w, canvas, label) {
    progressLabel = label;
    const ret = await w.recognize(canvas, {rotateAuto:true});
    const d = extract(ret.data?.text || '');
    return {d,text:ret.data?.text || '',score:score(d)};
  }

  function merge(a,b,preferPair=false) {
    const out = {...a};
    if (preferPair && b.pairFound && b.mkn && b.tip) {
      // par s kontekstom števca sme zamenjati slabši/generični par
      const bc = b.candidates?.[0];
      const ac = a.candidates?.[0];
      if (!out.pairFound || !ac || !bc || bc.score >= ac.score) {
        out.mkn=b.mkn; out.tip=b.tip; out.pairFound=true; out.candidates=b.candidates;
      }
    }
    for (const k of ['mkn','tip','year','maker']) if (!out[k] && b[k]) out[k]=b[k];
    out.pairFound=!!(out.pairFound||b.pairFound);
    return out;
  }

  btn.onclick = async () => {
    const file = el('photo')?.files?.[0];
    if (!file) { alert('Najprej slikaj ali izberi fotografijo števca.'); return; }
    if (typeof Tesseract === 'undefined') { alert('OCR knjižnica se ni naložila. Preveri internetno povezavo.'); return; }

    btn.disabled=true;
    if (el('ocrStatus')) el('ocrStatus').textContent='⚡ Hitro berem števec…';
    let img;
    try {
      img=await loadImage(file);
      const fast=makeCanvas(img,0,1100,false);
      const barcode=await detectBarcode(fast);
      let best={mkn:barcode?.mkn||'',tip:barcode?.tip||'',year:'',maker:'',pairFound:!!barcode,candidates:[]};
      const logs=barcode?[`Črtna koda: ${barcode.tip} ${barcode.mkn}`]:[];
      const w=await getWorker();

      const first=await runOcr(w,fast,'Hitro branje');
      best=merge(best,first.d,true); logs.push(first.text);

      // 1) Horizontalna območja nalepk: Landis E450/E350, stari Landis in ISKRA 1631.
      if (!coreComplete(best) || !best.pairFound) {
        const mid=cropCanvas(img,0.04,0.18,0.92,0.50,1500,true);
        const r=await runOcr(w,mid,'Povečujem nalepko');
        best=merge(best,r.d,true); logs.push(r.text);
      }

      // 2) ISKRA AM550 ima TIP+MKN pogosto natisnjen navpično ob levem robu.
      if ((!best.mkn || !best.tip) && (best.maker==='ISKRA' || /AM550|ISKRA/i.test(logs.join(' ')))) {
        const side=cropCanvas(img,0.00,0.22,0.38,0.58,1300,true);
        let r=await runOcr(w,rotateExisting(side,90),'Berem navpično oznako');
        best=merge(best,r.d,true); logs.push(r.text);
        if (!best.mkn || !best.tip) {
          r=await runOcr(w,rotateExisting(side,-90),'Navpična oznaka - druga smer');
          best=merge(best,r.d,true); logs.push(r.text);
        }
      }

      // 3) Če je fotografija obrnjena ali zelo poševna, samo en rezervni celotni obrat.
      if (!coreComplete(best)) {
        const r=await runOcr(w,makeCanvas(img,90,1200,true),'Rezervno branje 90°');
        best=merge(best,r.d,true); logs.push(r.text);
      }

      // 4) Zadnja kontrola samo, če manjka leto/proizvajalec.
      if (!complete(best)) {
        const r=await runOcr(w,makeCanvas(img,0,1350,true),'Dodatna kontrola');
        best=merge(best,r.d,true); logs.push(r.text);
      }

      if (el('ocrBox')) el('ocrBox').textContent=logs.filter(Boolean).join('\n\n---\n\n')||'(ni prepoznanega besedila)';
      if (el('mkn')) el('mkn').value=best.mkn||'';
      if (el('tip')) el('tip').value=best.tip||'';
      if (el('year')) el('year').value=best.year||'';
      if (el('maker')) el('maker').value=best.maker||'';
      if (typeof validateFields==='function') validateFields();

      if (el('ocrStatus')) {
        el('ocrStatus').textContent=coreComplete(best)
          ? '✅ Prebrano. Preveri podatke in shrani.'
          : '⚠️ Nekaj ni bilo zanesljivo prebrano. Poskusi slikati malo bližje.';
      }
    } catch(err) {
      console.error(err);
      if (el('ocrStatus')) el('ocrStatus').textContent='Napaka pri OCR: '+(err?.message||'neznana napaka');
    } finally {
      try { if (img && typeof img.close==='function') img.close(); } catch(_) {}
      btn.disabled=false;
    }
  };

  if (el('ocrStatus')) el('ocrStatus').textContent='Po slikanju se podatki preberejo samodejno.';
  window.addEventListener('pagehide',()=>{
    if (worker) { const w=worker; worker=null; try { w.terminate(); } catch(_){} }
  });
})();