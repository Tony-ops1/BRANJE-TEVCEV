(() => {
  function applyBarcodeResult(result) {
    if (!result) return;
    const mkn = document.getElementById('mkn');
    const tip = document.getElementById('tip');
    const year = document.getElementById('year');
    const maker = document.getElementById('maker');
    if (result.mkn && mkn) mkn.value = result.mkn;
    if (result.tip && tip) tip.value = result.tip;
    if (result.year && year) year.value = result.year;
    if (result.maker && maker) maker.value = result.maker;
    if (typeof validateFields === 'function') validateFields();
  }

  async function waitForOcr(readBtn, seed) {
    // OCR klik je asinhron; počakamo do konca in nato ponovno uveljavimo zanesljiv rezultat črtne kode.
    for (let i=0; i<180; i++) {
      await new Promise(r => setTimeout(r, 150));
      if (!readBtn.disabled) break;
    }
    if (seed?.tip && seed?.mkn) applyBarcodeResult(seed);
  }

  function setupAutoRead() {
    const photo = document.getElementById('photo');
    const readBtn = document.getElementById('readBtn');
    const status = document.getElementById('ocrStatus');
    if (!photo || !readBtn || photo.dataset.autoRead === '1') return;

    photo.dataset.autoRead = '1';
    readBtn.textContent = '🔄 Ponovi branje';
    if (status) status.textContent = 'Po slikanju se podatki preberejo samodejno.';

    photo.addEventListener('change', async () => {
      const file = photo.files && photo.files[0];
      if (!file) return;

      ['mkn','tip','year','maker'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const box = document.getElementById('ocrBox');
      if (box) box.textContent = '—';
      window.__meterBarcodeResult = null;

      let seed = null;
      if (typeof window.scanMeterBarcode === 'function') {
        if (status) status.textContent = '📊 Najprej berem črtno/QR kodo…';
        try { seed = await window.scanMeterBarcode(file); } catch (_) {}
      }

      if (seed?.tip && seed?.mkn) {
        applyBarcodeResult(seed);
        if (box) box.textContent = `KODA: ${seed.raw || (seed.tip + seed.mkn)}`;

        // Če QR že vsebuje tudi leto in proizvajalca, OCR sploh ni potreben.
        if (seed.year && seed.maker) {
          if (status) status.textContent = '✅ QR koda je prebrala TIP, MKN, leto in proizvajalca.';
          return;
        }
        if (status) status.textContent = `✅ Koda: ${seed.tip} ${seed.mkn}. Dopolnjujem leto in proizvajalca…`;
      } else {
        if (status) status.textContent = 'Črtna koda ni bila zanesljivo prebrana. Samodejno poskušam OCR…';
      }

      let attempts = 0;
      const trigger = () => {
        attempts += 1;
        if (!readBtn.disabled) {
          readBtn.click();
          waitForOcr(readBtn, seed);
          return;
        }
        if (attempts < 30) setTimeout(trigger, 200);
      };
      setTimeout(trigger, 80);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAutoRead, {once:true});
  } else {
    setupAutoRead();
  }
})();
