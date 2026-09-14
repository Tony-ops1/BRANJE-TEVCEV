(() => {
  const btn = document.getElementById("readBtn");
  if (!btn) return;

  const CURRENT = new Date().getFullYear();
  const KNOWN_TIPS = ["1483","1504","1505","1508","1531","1532","1563","1580","1581","1631","1632","1633","1638","1639","1661","1676","1680","1681","1682","1687"];
  let worker = null;
  let progressLabel = "OCR";

  const el = id => document.getElementById(id);

  function digits(s) {
    return String(s || "").toUpperCase()
      .replace(/[OQD]/g, "0")
      .replace(/[IL|]/g, "1")
      .replace(/Z/g, "2")
      .replace(/S/g, "5")
      .replace(/B/g, "8")
      .replace(/G/g, "6")
      .replace(/[^0-9]/g, "");
  }

  function validTip(x) {
    if (!/^\d{4}$/.test(x)) return false;
    const n = Number(x);
    return KNOWN_TIPS.includes(x) || (n >= 1400 && n <= 1799);
  }

  function validMkn(x) { return /^\d{8}$/.test(x); }

  function flattenWords(data) {
    if (Array.isArray(data?.words)) return data.words;
    const out = [];
    for (const b of (data?.blocks || [])) {
      for (const p of (b.paragraphs || [])) {
        for (const l of (p.lines || [])) {
          for (const w of (l.words || [])) out.push(w);
        }
      }
    }
    return out;
  }

  function pairFromWords(words) {
    const items = [];
    for (const w of (words || [])) {
      const d = digits(w.text);
      const b = w.bbox || {};
      const x0 = Number(b.x0 || 0), x1 = Number(b.x1 || 0);
      const y0 = Number(b.y0 || 0), y1 = Number(b.y1 || 0);
      const h = Math.max(1, y1 - y0), cy = (y0 + y1) / 2;
      const conf = Number(w.confidence || 0);

      if (d.length === 12 && validTip(d.slice(0,4)) && validMkn(d.slice(4))) {
        items.push({kind:"pair", tip:d.slice(0,4), mkn:d.slice(4), h, conf});
      } else if (d.length === 4 && validTip(d)) {
        items.push({kind:"tip", value:d, x0,x1,y0,y1,h,cy,conf});
      } else if (d.length === 8 && validMkn(d)) {
        items.push({kind:"mkn", value:d, x0,x1,y0,y1,h,cy,conf});
      }
    }

    const direct = items.filter(x => x.kind === "pair")
      .sort((a,b) => (b.h*3+b.conf) - (a.h*3+a.conf))[0];
    if (direct) return {tip:direct.tip, mkn:direct.mkn, spatial:true};

    const tips = items.filter(x => x.kind === "tip");
    const mkns = items.filter(x => x.kind === "mkn");
    let best = null;
    for (const t of tips) {
      for (const m of mkns) {
        const dy = Math.abs(t.cy - m.cy);
        const maxh = Math.max(t.h, m.h);
        if (dy > maxh * 2.3) continue;
        const dx = m.x0 >= t.x1 ? m.x0 - t.x1 : (t.x0 >= m.x1 ? t.x0 - m.x1 : 0);
        const score = (t.h + m.h) * 4 + (t.conf + m.conf) * 0.15 - dy * 1.4 - dx * 0.04;
        if (!best || score > best.score) best = {tip:t.value, mkn:m.value, score};
      }
    }
    return best ? {tip:best.tip, mkn:best.mkn, spatial:true} : null;
  }

  function yearFromWords(words) {
    const candidates = [];
    for (const w of (words || [])) {
      const d = digits(w.text);
      if (/^\d{4}$/.test(d)) {
        const n = Number(d);
        if (n >= 1990 && n <= CURRENT) {
          const b = w.bbox || {};
          const h = Math.max(1, Number(b.y1 || 0) - Number(b.y0 || 0));
          candidates.push({v:d, score:h*2 + Number(w.confidence || 0)});
        }
      }
    }
    candidates.sort((a,b) => b.score - a.score);
    return candidates[0]?.v || "";
  }

  function extract(data) {
    const text = data?.text || "";
    const words = flattenWords(data);
    const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);

    let maker = "";
    if (/landis\s*\+?\s*gyr|landisgyr|\blandis\b|\bgyr\b/i.test(text)) maker = "Landis+Gyr";
    else if (/iskra/i.test(text)) maker = "ISKRA";

    let year = yearFromWords(words);
    if (!year) {
      const ys = [...text.matchAll(/\b(19\d{2}|20\d{2})\b/g)]
        .map(m => Number(m[1])).filter(y => y >= 1990 && y <= CURRENT);
      year = ys.length ? String(ys[0]) : "";
    }

    let mkn = "", tip = "", pairFound = false;
    const spatial = pairFromWords(words);
    if (spatial) {
      tip = spatial.tip; mkn = spatial.mkn; pairFound = true;
    }

    const digitish = text.toUpperCase()
      .replace(/[OQD]/g,"0").replace(/[IL|]/g,"1")
      .replace(/Z/g,"2").replace(/S/g,"5")
      .replace(/B/g,"8").replace(/G/g,"6");

    if (!mkn || !tip) {
      const pairRe = /(^|\D)(1[4-7]\d{2})[^0-9A-Z]{0,14}(\d{8})(?!\d)/gm;
      let pm;
      while ((pm = pairRe.exec(digitish))) {
        if (validTip(pm[2]) && validMkn(pm[3])) {
          tip = tip || pm[2]; mkn = mkn || pm[3]; pairFound = true; break;
        }
      }
    }

    if (!tip) {
      for (const k of KNOWN_TIPS) {
        if (new RegExp("(^|\\D)" + k + "(\\D|$)").test(digitish)) { tip = k; break; }
      }
    }
    if (!tip) {
      const c4 = [...digitish.matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map(m => m[1]);
      tip = c4.find(validTip) || "";
    }

    if (!mkn) {
      const labeled = lines.find(l => /(^|\s)(mkn|št\.?|st\.?|stevil)/i.test(l));
      if (labeled) {
        const ds = digits(labeled);
        const mm = ds.match(/(\d{8})/);
        if (mm) mkn = mm[1];
      }
    }
    if (!mkn) {
      const c8 = [...digitish.matchAll(/(?<!\d)(\d{8})(?!\d)/g)].map(m => m[1]);
      mkn = c8.find(x => !/^20\d{6}$/.test(x)) || "";
    }

    return {mkn, tip, year, maker, pairFound};
  }

  function score(d) {
    let s = 0;
    if (d.mkn) s += 8;
    if (d.tip) s += 7;
    if (d.year) s += 4;
    if (d.maker) s += 2;
    if (d.pairFound) s += 6;
    return s;
  }

  async function getWorker() {
    if (worker) return worker;
    progressLabel = "Nalagam OCR";
    worker = await Tesseract.createWorker("eng", 1, {
      logger: m => {
        if (m.status === "recognizing text" && el("ocrStatus")) {
          el("ocrStatus").textContent = progressLabel + " · " + Math.round((m.progress || 0) * 100) + "%";
        }
      }
    });
    return worker;
  }

  async function loadImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, {imageOrientation:"from-image"}); }
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

  function makeCanvas(img, angle, contrast=false) {
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const maxSide = 2000;
    const scale = Math.min(1, maxSide / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));
    const a = angle * Math.PI / 180;
    const cw = Math.ceil(Math.abs(w*Math.cos(a)) + Math.abs(h*Math.sin(a)));
    const ch = Math.ceil(Math.abs(w*Math.sin(a)) + Math.abs(h*Math.cos(a)));
    const c = document.createElement("canvas"); c.width = cw; c.height = ch;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0,0,cw,ch);
    ctx.translate(cw/2, ch/2); ctx.rotate(a);
    if (contrast && "filter" in ctx) ctx.filter = "grayscale(1) contrast(1.6) brightness(1.06)";
    ctx.drawImage(img, -w/2, -h/2, w, h);
    return c;
  }

  async function runOne(w, canvas, label) {
    progressLabel = label;
    const ret = await w.recognize(canvas, {rotateAuto:true}, {text:true, blocks:true});
    const d = extract(ret.data);
    return {data:ret.data, d, score:score(d)};
  }

  btn.onclick = async () => {
    const file = el("photo")?.files?.[0];
    if (!file) { alert("Najprej slikaj ali izberi fotografijo števca."); return; }
    if (typeof Tesseract === "undefined") {
      alert("OCR knjižnica se ni naložila. Preveri internetno povezavo."); return;
    }

    btn.disabled = true;
    if (el("ocrStatus")) el("ocrStatus").textContent = "Pripravljam sliko in samodejno popravljam orientacijo…";

    let img;
    try {
      const w = await getWorker();
      img = await loadImage(file);
      const angles = [0, 90, -90, 180];
      let best = {score:-1, d:{mkn:"",tip:"",year:"",maker:"",pairFound:false}, data:{text:""}};
      const logs = [];

      for (let i=0; i<angles.length; i++) {
        const a = angles[i];
        const r = await runOne(w, makeCanvas(img, a, false), `Smer ${i+1}/4 (${a}°)`);
        logs.push(`--- ${a}° / ocena ${r.score} ---\n${r.data.text || ""}`);
        if (r.score > best.score) best = r;
        if (r.d.mkn && r.d.tip && r.d.year && r.d.maker && r.d.pairFound) break;
      }

      if (!(best.d.mkn && best.d.tip && best.d.year) || best.score < 19) {
        for (let i=0; i<angles.length; i++) {
          const a = angles[i];
          const r = await runOne(w, makeCanvas(img, a, true), `Kontrast ${i+1}/4 (${a}°)`);
          logs.push(`--- kontrast ${a}° / ocena ${r.score} ---\n${r.data.text || ""}`);
          if (r.score > best.score) best = r;
          if (r.d.mkn && r.d.tip && r.d.year && r.d.maker && r.d.pairFound) break;
        }
      }

      if (el("ocrBox")) el("ocrBox").textContent = logs.join("\n\n") || "(ni prepoznanega besedila)";
      if (el("mkn")) el("mkn").value = best.d.mkn || "";
      if (el("tip")) el("tip").value = best.d.tip || "";
      if (el("year")) el("year").value = best.d.year || "";
      if (el("maker")) el("maker").value = best.d.maker || "";
      if (typeof validateFields === "function") validateFields();

      if (el("ocrStatus")) {
        if (best.d.mkn && best.d.tip && best.d.year) {
          el("ocrStatus").textContent = "✅ Prebrano. Aplikacija je samodejno poravnala/naredila več orientacij slike. Preveri in shrani.";
        } else {
          el("ocrStatus").textContent = "⚠️ Nekaj podatkov ni bilo zanesljivo prebranih. Če je nalepka zelo majhna, zamegljena ali zakrita, slikaj bližje.";
        }
      }
    } catch (err) {
      console.error(err);
      if (el("ocrStatus")) el("ocrStatus").textContent = "Napaka pri OCR: " + (err?.message || "neznana napaka");
      alert("OCR ni uspel. Preveri internetno povezavo in poskusi ponovno.");
    } finally {
      try { if (img && typeof img.close === "function") img.close(); } catch (_) {}
      btn.disabled = false;
    }
  };

  if (el("ocrStatus")) {
    el("ocrStatus").textContent = "Po slikanju pritisni »Preberi podatke«. Aplikacija sama preveri pokončno, ležeče in obrnjeno sliko ter popravi naklon.";
  }

  window.addEventListener("pagehide", () => {
    if (worker) {
      const w = worker; worker = null;
      try { w.terminate(); } catch (_) {}
    }
  });
})();