(() => {
  function digits(v){ return String(v || '').replace(/\D/g, ''); }

  function readStoredRecords(){
    try { return JSON.parse(localStorage.getItem('meter_records_v1') || '[]'); }
    catch (_) { return []; }
  }

  // Leto ostane prikazano in se lahko shrani, vendar nikoli ne blokira shranjevanja.
  function validateOptionalYear(){
    const mknEl = document.getElementById('mkn');
    const tipEl = document.getElementById('tip');
    const yearEl = document.getElementById('year');
    const statusEl = document.getElementById('validationStatus');
    if (!mknEl || !tipEl || !statusEl) return {ok:false, duplicate:false};

    const mkn = digits(mknEl.value).slice(0, 8);
    const tip = digits(tipEl.value).slice(0, 4);
    mknEl.value = mkn;
    tipEl.value = tip;

    // Leto samo očistimo na največ 4 številke. Ni obvezen podatek.
    if (yearEl) {
      yearEl.value = digits(yearEl.value).slice(0, 4);
      yearEl.disabled = false;
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

  function setup(){
    const year = document.getElementById('year');
    if (year) {
      year.disabled = false;
      const box = year.closest('div');
      if (box) box.style.display = '';
      const help = box?.querySelector('.help');
      if (help) help.textContent = 'Neobvezno – če ga ne prebere, lahko vrstico vseeno shraniš.';
    }

    const subtitle = document.querySelector('header small');
    if (subtitle) subtitle.textContent = 'MKN · TIP MKN · leto · proizvajalec';

    // Če je prejšnja različica skrila stolpec Leto, ga ponovno pokaži.
    const style = document.createElement('style');
    style.textContent = `
      #tbl th:nth-child(4), #tbl td:nth-child(4){display:table-cell !important;}
    `;
    document.head.appendChild(style);

    try {
      window.validateFields = validateOptionalYear;
      validateFields = validateOptionalYear;
    } catch (_) {}

    ['mkn','tip','year','maker'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => setTimeout(validateOptionalYear, 0));
    });

    setTimeout(validateOptionalYear, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, {once:true});
  else setup();
})();
