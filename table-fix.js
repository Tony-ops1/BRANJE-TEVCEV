(() => {
  function setup(){
    // Na telefonu je bil naslov tabele zaradi sticky top:72px zamaknjen navzdol
    // in je prekrival prvo shranjeno vrstico. Glava mora biti pripeta na vrh
    // notranjega drsnega polja, ne 72 px nižje.
    const style = document.createElement('style');
    style.textContent = `
      #tbl th{position:sticky !important;top:0 !important;z-index:3 !important;}
      #tbl tbody tr{background:#fffef8;}
      #tbl tbody tr:nth-child(even){background:#f5f9f0;}
      #tbl tbody tr:last-child.flash-row{outline:2px solid #d2a22a;outline-offset:-2px;}
      .scroll{min-height:0 !important;}
      #recordCount{margin:8px 0 0;font-size:13px;font-weight:750;color:#35543d;}
    `;
    document.head.appendChild(style);

    const table = document.getElementById('tbl');
    const scroll = table?.closest('.scroll');
    const saveBtn = document.getElementById('saveBtn');
    if(!table || !scroll || !saveBtn) return;

    let counter = document.getElementById('recordCount');
    if(!counter){
      counter = document.createElement('div');
      counter.id = 'recordCount';
      scroll.insertAdjacentElement('afterend', counter);
    }

    function updateCount(){
      const n = table.querySelectorAll('tbody tr').length;
      counter.textContent = n === 0 ? 'Ni shranjenih zapisov.' : (n === 1 ? '1 shranjen zapis.' : `${n} shranjeni zapisi.`);
    }

    updateCount();

    // Po shranjevanju naj se nova vrstica takoj pokaže v tabeli.
    saveBtn.addEventListener('click', () => {
      setTimeout(() => {
        updateCount();
        const rows = table.querySelectorAll('tbody tr');
        const last = rows[rows.length - 1];
        if(!last) return;
        last.classList.add('flash-row');
        // znotraj tabele se premakni na novo vrstico, brez skoka cele strani
        scroll.scrollTop = scroll.scrollHeight;
        setTimeout(() => last.classList.remove('flash-row'), 1800);
      }, 80);
    });

    // Osveži števec tudi pri brisanju.
    scroll.addEventListener('click', e => {
      if(e.target.closest('button.danger')) setTimeout(updateCount, 80);
    });
    document.getElementById('wipeBtn')?.addEventListener('click', () => setTimeout(updateCount, 80));
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, {once:true});
  else setup();
})();
