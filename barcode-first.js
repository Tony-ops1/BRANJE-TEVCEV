(() => {
  const $ = id => document.getElementById(id);

  function parseValue(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;

    // ISKRA AM550 QR primer: 1682;87699356;2022;...
    const parts = text.split(';').map(x => x.trim());
    if (parts.length >= 3 && /^\d{4}$/.test(parts[0]) && /^\d{8}$/.test(parts[1])) {
      const year = /^20\d{2}$/.test(parts[2]) ? parts[2] : '';
      const maker = /AM550|ISKRA/i.test(text) ? 'ISKRA' : '';
      return { tip: parts[0], mkn: parts[1], year, maker, raw: text, kind: 'QR' };
    }

    const d = text.replace(/\D/g, '');
    // Na naših števcih CODE128 praviloma vsebuje TIP(4) + MKN(8).
    if (d.length === 12) {
      const tip = d.slice(0,4), mkn = d.slice(4);
      const n = Number(tip);
      if (n >= 1400 && n <= 1799 && !/^0{8}$/.test(mkn)) {
        return { tip, mkn, year:'', maker:'', raw:text, kind:'BARCODE' };
      }
    }

    // Nekateri dodatni I25 vsebujejo samo MKN; uporabimo ga le kot pomoč, ne kot končni TIP+MKN.
    if (d.length === 8 && !/^0{8}$/.test(d)) {
      return { tip:'', mkn:d, year:'', maker:'', raw:text, kind:'MKN_ONLY' };
    }
    return null;
  }

  async function loadBitmap(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation:'from-image' }); }
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

  function cropCanvas(img, x, y, w, h, rotate = 0, maxSide = 1500) {
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    const sx = Math.max(0, Math.round(iw*x)), sy = Math.max(0, Math.round(ih*y));
    const sw = Math.max(1, Math.min(iw-sx, Math.round(iw*w)));
    const sh = Math.max(1, Math.min(ih-sy, Math.round(ih*h)));
    const scale = Math.min(1.8, maxSide / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw*scale)), dh = Math.max(1, Math.round(sh*scale));
    const rot = ((rotate % 360) + 360) % 360;
    const c = document.createElement('canvas');
    if (rot === 90 || rot === 270) { c.width = dh; c.height = dw; }
    else { c.width = dw; c.height = dh; }
    const ctx = c.getContext('2d', {alpha:false});
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height);
    ctx.save();
    if (rot === 90) { ctx.translate(c.width,0); ctx.rotate(Math.PI/2); }
    else if (rot === 180) { ctx.translate(c.width,c.height); ctx.rotate(Math.PI); }
    else if (rot === 270) { ctx.translate(0,c.height); ctx.rotate(-Math.PI/2); }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
    ctx.restore();
    return c;
  }

  async function nativeDecode(canvas) {
    if (!('BarcodeDetector' in window)) return null;
    try {
      let formats = ['code_128','code_39','itf','qr_code','data_matrix','ean_13','ean_8'];
      if (BarcodeDetector.getSupportedFormats) {
        const sup = await BarcodeDetector.getSupportedFormats();
        formats = formats.filter(f => sup.includes(f));
      }
      if (!formats.length) return null;
      const detector = new BarcodeDetector({formats});
      const found = await detector.detect(canvas);
      for (const b of found) {
        const p = parseValue(b.rawValue || '');
        if (p?.tip && p?.mkn) return p;
      }
    } catch (_) {}
    return null;
  }

  let zxingReader = null;
  async function zxingDecode(canvas) {
    if (!window.ZXingBrowser?.BrowserMultiFormatReader) return null;
    try {
      zxingReader ||= new ZXingBrowser.BrowserMultiFormatReader();
      const result = await zxingReader.decodeFromCanvas(canvas);
      const raw = typeof result?.getText === 'function' ? result.getText() : (result?.text || String(result || ''));
      return parseValue(raw);
    } catch (_) { return null; }
  }

  async function decodeCanvas(canvas) {
    return (await nativeDecode(canvas)) || (await zxingDecode(canvas));
  }

  async function scanMeterBarcode(file) {
    let img;
    try {
      img = await loadBitmap(file);

      // Vrstni red je namenoma prostorski: glavni števec ima prednost pred PLC/Flex modulom spodaj.
      const regions = [
        [0.00,0.00,1.00,0.52,0],   // zgornja polovica - glavni števec
        [0.00,0.18,0.52,0.62,0],   // levi del - navpične ISKRA kode / QR
        [0.48,0.18,0.52,0.62,0],   // desni del
        [0.00,0.00,1.00,0.72,90],  // navpične kode
        [0.00,0.00,1.00,0.72,270],
        [0.00,0.00,1.00,0.72,0]    // širši rezervni izrez
      ];

      let mknOnly = null;
      for (const r of regions) {
        const canvas = cropCanvas(img, ...r);
        const p = await decodeCanvas(canvas);
        if (!p) continue;
        if (p.tip && p.mkn) {
          window.__meterBarcodeResult = p;
          return p;
        }
        if (p.mkn && !mknOnly) mknOnly = p;
      }
      window.__meterBarcodeResult = mknOnly;
      return mknOnly;
    } catch (e) {
      console.warn('Barcode scan:', e);
      return null;
    } finally {
      try { if (img && typeof img.close === 'function') img.close(); } catch (_) {}
    }
  }

  window.scanMeterBarcode = scanMeterBarcode;
})();
