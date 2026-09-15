(() => {
  let fallbackWorker = null;
  const CURRENT_YEAR = new Date().getFullYear();
  const $ = id => document.getElementById(id);

  function normalize(s) {
    return String(s || '').toUpperCase()
      .replace(/[OQD]/g,'0').replace(/[IL|]/g,'1')
      .replace(/Z/g,'2').replace(/S/g,'5')
      .replace(/B/g,'8').replace(/G/g,'6');
  }
  function digits(s){ return normalize(s).replace(/[^0-9]/g,''); }
  function validTip(x){ return /^\d{4}$/.test(x) && Number(x) >= 1400 && Number(x) <= 1799; }
  function validMkn(x){ return /^\d{8}$/.test(x) && !/^0{8}$/.test(x); }

  function yearFromText(text){
    const raw = String(text || '');
    const direct = raw.match(/\b(?:19\d{2}|20\d{2})\b/g) || [];
    for (const y of direct) {
      const n = Number(y); if (n >= 1990 && n <= CURRENT_YEAR) return y;
    }
    const c = raw.replace(/[^0-9]/g,'');
    for (let i=0;i<=c.length-4;i++) {
      const y=c.slice(i,i+4), n=Number(y);
      if (n>=1990 && n<=CURRENT_YEAR) return y;
    }
    return '';
  }

  function strongPair(text){
    const raw = String(text || '');
    const lines = raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const candidates=[];

    const nt = normalize(raw);
    const re = /(^|\D)(1[4-7]\d{2})[^0-9]{0,35}(\d{8})(?!\d)/gm;
    let m;
    while ((m=re.exec(nt))) candidates.push({tip:m[2],mkn:m[3],score:300});

    for (let i=0;i<lines.length;i++) {
      const ctx=[lines[i-1],lines[i],lines[i+1]].filter(Boolean).join(' ');
      const tokens=(normalize(ctx).match(/[0-9]+/g)||[]);
      for (let t=0;t<tokens.length;t++) {
        const tip=tokens[t]; if(!validTip(tip)) continue;
        let acc='';
        for(let j=t+1;j<Math.min(tokens.length,t+5);j++){
          acc+=tokens[j];
          if(acc.length>8) break;
          if(acc.length===8 && validMkn(acc)) {
            let score=230-(j-t-1)*8;
            if(/KWH|STEVEC|ŠTEVEC|LANDIS|ISKRA/i.test(ctx)) score+=40;
            candidates.push({tip,mkn:acc,score});
            break;
          }
        }
      }
    }
    candidates.sort((a,b)=>b.score-a.score);
    return candidates[0] || null;
  }

  async function loadImage(file){
    if(window.createImageBitmap){
      try{return await createImageBitmap(file,{imageOrientation:'from-image'});}catch(_){try{return await createImageBitmap(file);}catch(_){}}
    }
    return await new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file), img=new Image();
      img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
      img.onerror=e=>{URL.revokeObjectURL(url);reject(e);};
      img.src=url;
    });
  }

  function crop(img,x,y,w,h,maxSide=1900){
    const iw=img.width||img.naturalWidth, ih=img.height||img.naturalHeight;
    const sx=Math.round(iw*x), sy=Math.round(ih*y);
    const sw=Math.max(1,Math.min(iw-sx,Math.round(iw*w)));
    const sh=Math.max(1,Math.min(ih-sy,Math.round(ih*h)));
    const scale=Math.min(3.6,maxSide/Math.max(sw,sh));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(sw*scale)); c.height=Math.max(1,Math.round(sh*scale));
    const ctx=c.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    if('filter' in ctx) ctx.filter='grayscale(1) contrast(1.9) brightness(1.1)';
    ctx.drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
    return c;
  }

  async function worker(){
    if(fallbackWorker) return fallbackWorker;
    fallbackWorker=await Tesseract.createWorker('eng',1);
    return fallbackWorker;
  }

  async function recognize(w,canvas,label){
    const status=$('ocrStatus'); if(status) status.textContent=label;
    try{await w.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:'0123456789 -./'});}catch(_){}
    const r=await w.recognize(canvas,{rotateAuto:true});
    return r.data?.text||'';
  }

  async function recheckIfNeeded(){
    const file=$('photo')?.files?.[0];
    if(!file || typeof Tesseract==='undefined') return;

    const year=$('year')?.value?.trim()||'';
    const mkn=$('mkn')?.value?.trim()||'';
    const tip=$('tip')?.value?.trim()||'';
    if(year && /^\d{8}$/.test(mkn) && /^\d{4}$/.test(tip)) return;

    let img;
    try{
      img=await loadImage(file);
      const w=await worker();
      let foundPair=null, foundYear='';
      const regions=[
        [0.00,0.00,1.00,0.72,'🔍 Dodatno preverjam napisno ploščico…'],
        [0.00,0.00,0.62,0.64,'🔍 Iščem leto levo zgoraj…'],
        [0.38,0.00,0.62,0.64,'🔍 Iščem leto desno zgoraj…']
      ];
      const all=[];
      for(const r of regions){
        const text=await recognize(w,crop(img,r[0],r[1],r[2],r[3]),r[4]);
        all.push(text);
        const p=strongPair(text); if(p && (!foundPair || p.score>foundPair.score)) foundPair=p;
        if(!foundYear) foundYear=yearFromText(text);
        if(foundPair && foundYear) break;
      }

      if(foundPair){
        if($('tip')) $('tip').value=foundPair.tip;
        if($('mkn')) $('mkn').value=foundPair.mkn;
      }
      if(foundYear && $('year')) $('year').value=foundYear;
      if(typeof validateFields==='function') validateFields();

      const box=$('ocrBox');
      if(box && all.length) box.textContent += '\n\n--- DODATNA KONTROLA ---\n'+all.join('\n---\n');
      const status=$('ocrStatus');
      if(status){
        if(($('year')?.value||'') && ($('mkn')?.value||'').length===8 && ($('tip')?.value||'').length===4)
          status.textContent='✅ Dodatna kontrola končana. Preveri podatke in shrani.';
        else
          status.textContent='⚠️ Nekaj podatkov še ni dovolj zanesljivo. Poskusi ponovno ali slikaj bližje napisni ploščici.';
      }
    }catch(e){console.warn('Dodatna OCR kontrola:',e);}finally{
      try{if(img&&typeof img.close==='function')img.close();}catch(_){}
    }
  }

  function setup(){
    const btn=$('readBtn');
    if(!btn || btn.dataset.recheckWrapped==='1') return;
    const original=btn.onclick;
    if(typeof original!=='function'){setTimeout(setup,100);return;}
    btn.dataset.recheckWrapped='1';
    btn.onclick=async function(ev){
      await original.call(this,ev);
      await recheckIfNeeded();
    };
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(setup,50),{once:true});
  else setTimeout(setup,50);

  window.addEventListener('pagehide',()=>{
    if(fallbackWorker){const w=fallbackWorker;fallbackWorker=null;try{w.terminate();}catch(_){}}
  });
})();
