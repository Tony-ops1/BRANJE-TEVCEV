(() => {
  function pad(n){ return String(n).padStart(2,'0'); }

  function getRows(){
    try {
      if (typeof exportRows === 'function') return exportRows();
    } catch (_) {}
    return [];
  }

  function makeXlsxFile(rows){
    if (typeof XLSX === 'undefined') throw new Error('Excel knjižnica ni naložena.');
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:9},{wch:13},{wch:12},{wch:20},{wch:13},{wch:10}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Števci');
    const bytes = XLSX.write(wb, {bookType:'xlsx', type:'array'});
    const d = new Date();
    const name = `stevci_${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()}.xlsx`;
    return new File([bytes], name, {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }

  function rowsToMailText(rows){
    const lines = rows.slice(0,50).map(r => `${r['Zap. št.']}. MKN ${r['MKN']} | TIP ${r['TIP MKN']} | ${r['Proizvajalec']} | ${r['Datum']}`);
    let text = `Podatki iz aplikacije Branje števcev\n\n${lines.join('\n')}`;
    if (rows.length > 50) text += `\n\n... in še ${rows.length - 50} vrstic v Excel datoteki.`;
    return text;
  }

  async function sendEmail(){
    const rows = getRows();
    if (!rows.length){ alert('Tabela je prazna. Najprej shrani vsaj en števec.'); return; }

    let file;
    try { file = makeXlsxFile(rows); }
    catch (e) { alert(e.message || 'Excel datoteke ni bilo mogoče pripraviti.'); return; }

    const shareData = {
      title: 'Branje števcev',
      text: `Pošiljam Excel tabelo z ${rows.length} zapis${rows.length === 1 ? 'om' : 'i'} števcev.`,
      files: [file]
    };

    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))) {
        await navigator.share(shareData);
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }

    try {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (_) {}

    const subject = encodeURIComponent('Branje števcev - Excel tabela');
    const body = encodeURIComponent(rowsToMailText(rows) + '\n\nExcel datoteka je bila shranjena med prenose. Če ni samodejno pripeta, jo pripni ročno.');
    location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  function setup(){
    if (document.getElementById('emailBtn')) return;
    const xlsxBtn = document.getElementById('xlsxBtn');
    if (!xlsxBtn) return;
    const btn = document.createElement('button');
    btn.id = 'emailBtn';
    btn.className = 'primary';
    btn.textContent = '📧 Pošlji po e-pošti';
    btn.addEventListener('click', sendEmail);
    xlsxBtn.insertAdjacentElement('afterend', btn);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, {once:true});
  else setup();
})();
