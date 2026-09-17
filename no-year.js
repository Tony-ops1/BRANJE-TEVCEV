(() => {
  function digits(v){ return String(v || '').replace(/\D/g, ''); }

  function readStoredRecords(){
    try { return JSON.parse(localStorage.getItem('meter_records_v1') || '[]'); }
    catch (_) { return []; }
  }

  function validateNoYear(){
    const mknEl = document.getElementById('mkn');
    const tipEl = document.getElementById('tip');
    const yearEl = document.getElementById('year');
    const statusEl = document.getElementById('validationStatus');
    if (!mknEl || !tipEl || !statusEl) return {ok:false, duplicate:false};

    const mkn = digits(mknEl.value).slice(0, 8);
    const tip = digits(tipEl.value).slice(0, 4);
    mknEl.value = mkn;
    tipEl.value = tip;
    if (yearEl) {
      yearEl.value = '';
      yearEl.classList.remove('invalid','warn');
    }

    mknEl.classList.remove('invalid','warn');
    tipEl.classList.remove('invalid','warn');

    const issues = [];
    if (mkn.length !== 8) {
      mknEl.classList.add('invalid');
      issues.push('MKN mora imeti 8 številk');
    }
    if (tip.length !== 4) {
      tipEl.classList.add('invalid');
      issues.push('TIP MKN mora imeti 4 številke');
    }

    const duplicate = readStoredRecords().some(r => String(r?.mkn || '') === mkn && mkn.length === 8);
    if (duplicate) {
      mknEl.classList.add('warn');
      issues.push('MKN že obstaja v tabeli');
    }

    if (!issues.length) {
      statusEl.textContent = '✅ OK';
      statusEl.className = 'status oktxt';
      return {ok:true, duplicate:false};
    }

    statusEl.textContent = '⚠️ ' + issues.join(' · ');
    statusEl.className = 'status warntxt';
    return {ok:false, duplicate};
  }

  function removeYearFromExports(){
    try {
      if (typeof window.exportRows === 'function' && !window.exportRows.__noYearWrapped) {
        const original = window.exportRows;
        const wrapped = function(){
          const rows = original();
          return Array.isArray(rows) ? rows.map(row => {
            const out = {};
            Object.entries(row || {}).forEach(([k,v]) => {
              if (String(k).toLowerCase() !== 'leto') out[k] = v;
            });
            return out;
          }) : rows;
        };
        wrapped.__noYearWrapped = true;
        window.exportRows = wrapped;
        try { exportRows = wrapped; } catch (_) {}
      }
    } catch (_) {}
  }

  function setup(){
    const year = document.getElementById('year');
    if (year) {
      year.value = '';
      year.disabled = true;
      const box = year.closest('div');
      if (box) box.style.display = 'none';
    }

    const subtitle = document.querySelector('header small');
    if (subtitle) subtitle.textContent = 'MKN · TIP MKN · proizvajalec';

    const style = document.createElement('style');
    style.textContent = `
      #tbl th:nth-child(4), #tbl td:nth-child(4){display:none !important;}
    `;
    document.head.appendChild(style);

    try {
      window.validateFields = validateNoYear;
      validateFields = validateNoYear;
    } catch (_) {}

    ['mkn','tip','maker'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => setTimeout(validateNoYear, 0));
    });

    // Pred shranjevanjem vedno počisti leto, da se ne shrani niti, če ga QR vsebuje.
    document.getElementById('saveBtn')?.addEventListener('click', () => {
      if (year) year.value = '';
    }, true);

    removeYearFromExports();
    setTimeout(removeYearFromExports, 300);
    setTimeout(validateNoYear, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, {once:true});
  else setup();
})();
