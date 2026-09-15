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
    const raw = normalize(String(text || ''));
    // Najprej normalno zapisano leto, nato zapis z razmiki: 20 14, 2 0 1 4 ...
    const patterns = [
      /(^|\D)((?:19|20)\d{2})(?!\d)/g,
      /(^|\D)((?:1\s*9|2\s*0)\s*\d\s*\d)(?!\d)/g
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(raw))) {
        const y = String(m[2]).replace(/\D/g,'');
        const n = Number(y);
        if (y.length === 4 && n >= 1990 && n <= CURRENT_YEAR) return y;
      }
    }
    return '';
  }

  function pairScoreContext(s){
    const u=String(s||'').toUpperCase();
    let score=0;
    if(/TRIFAZ|ENOFAZ|STEVEC|ŠTEVEC|KWH|LANDIS|ISKRA|E350|E450|AM550/.test(u)) score+=60;
    if(/FLEX\s*II|PLC\s*MODULE|PLC\s*MODUL|AD[- ]?[A-Z]{2}/.test(u)) score-=220;
    return score;
  }

  function strongPair(text){
    const raw = String(text || '');
    const lines = raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const candidates=[];

    const nt = normalize(raw);
    const re = /(^|\D)(1[4-7]\d{2})[^0-9]{0,35}(\d{8})(?!\d)/gm;
    let m;
    while ((m=re.exec(nt))) {
      const around=raw.slice(Math.max(0,m.index-120),Math.min(raw.length,re.lastIndex+120));
      candidates.push({tip:m[2],mkn:m[3],score:300+pairScoreContext(around)});
    }

    for (let i=0;i<lines.length;i++) {
      const ctx=[lines[i-1],lines[i],lines[i+1]].filter(Boolean).join(' ');
      const tokens=(normalize(ctx).match(/[0-9]+/g)||[]);
      for (let t=0;t<tokens.length;t++) {
        const tip=tokens[t]; if(!validTip(tip)) continue;
        let acc='';
        for(let j=t+1;j<Math.min(tokens.length,t+6);j++){
          acc+=tokens[j];
          if(acc.length>8) break;
          if(acc.length===8 && validMkn(acc)) {
            candidates.push({tip,mkn:acc,score:230-(j-t-1)*8+pairScoreContext(ctx)});
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

  function crop(img,x,y,w,h,maxSide=1200,contrast=1.9){
    const iw=img.width||img.naturalWidth, ih=img.height||img.naturalHeight;
    const sx=Math.max(0,Math.round(iw*x)), sy=Math.max(0,Math.round(ih*y));
    const sw=Math.max(1,Math.min(iw-sx,Math.round(iw*w)));
    const sh=Math.max(1,Math.min(ih-sy,Math.round(ih*h)));
    const scale=Math.min(4,maxSide/Math.max(sw,sh));
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(sw*scale)); c.height=Math.max(1,Math.round(sh*scale));
    const ctx=c.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    if('filter' in ctx) ctx.filter=`grayscale(1) contrast(${contrast}) brightness(1.08)`;
    ctx.drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
    return c;
  }

  // En OCR prehod dobi več povečanih delov slike hkrati. Tako je hitreje kot 4 ločeni OCR prehodi.
  function makeYearAtlas(img){
    const parts=[
      [0.00,0.00,0.56,0.34], // zgoraj levo
      [0.44,0.00,0.56,0.34], // zgoraj desno
      [0.00,0.18,0.56,0.34], // sredina levo
      [0.44,0.18,0.56,0.34]  // sredina desno
    ];
    const tiles=parts.map(p=>crop(img,p[0],p[1],p[2],p[3],950,2.05));
    const gap=36;
    const tileW=Math.max(...tiles.map(t=>t.width));
    const tileH=Math.max(...tiles.map(t=>t.height));
    const c=document.createElement('canvas');
    c.width=tileW*2+gap*3; c.height=tileH*2+gap*3;
    const ctx=c.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    tiles.forEach((t,i)=>{
      const col=i%2, row=Math.floor(i/2);
      const x=gap+col*(tileW+gap), y=gap+row*(tileH+gap);
      ctx.drawImage(t,x,y);
    });
    return c;
  }

  async function worker(){
    if(fallbackWorker) return fallbackWorker;
    fallbackWorker=await Tesseract.createWorker('eng',1);
    return fallbackWorker;
  }

  async function recognize(w,canvas,label,psm='11',numbersOnly=true){
    const status=$('ocrStatus'); if(status) status.textContent=label;
    try{
      await w.setParameters({
        tessedit_pageseg_mode:psm,
        tessedit_char_whitelist:numbersOnly?'0123456789 -./':''
      });
    }catch(_){}
    const r=await w.recognize(canvas,{rotateAuto:true});
    return r.data?.text||'';
  }

  async function recheckIfNeeded(){
    const file=$('photo')?.files?.[0];
    if(!file || typeof Tesseract==='undefined') return;

    const currentYear=$('year')?.value?.trim()||'';
    const currentMkn=$('mkn')?.value?.trim()||'';
    const currentTip=$('tip')?.value?.trim()||'';
    const needYear=!/^\d{4}$/.test(currentYear);
    const needPair=!validMkn(currentMkn)||!validTip(currentTip);
    if(!needYear && !needPair) return;

    let img;
    try{
      img=await loadImage(file);
      const w=await worker();
      const all=[];
      let foundYear='';
      let foundPair=null;

      // Če manjka leto, najprej en sam hiter OCR po 4 povečanih območjih.
      if(needYear){
        const atlas=makeYearAtlas(img);
        let text=await recognize(w,atlas,'🔍 Iščem leto po celotni zgornji polovici…','11',true);
        all.push(text);
        foundYear=yearFromText(text);

        // Če je leto še vedno skrito v majhnem tisku, ponovno isti atlas z drugim načinom segmentacije.
        if(!foundYear){
          text=await recognize(w,atlas,'🔍 Povečujem majhen zapis leta…','6',true);
          all.push(text);
          foundYear=yearFromText(text);
        }
      }

      // Par TIP+MKN preverjamo samo, če je res manjkajoč ali neveljaven.
      if(needPair){
        const top=crop(img,0.00,0.00,1.00,0.68,1650,1.9);
        const text=await recognize(w,top,'🔍 Preverjam TIP in MKN…','11',false);
        all.push(text);
        foundPair=strongPair(text);
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
        const y=$('year')?.value||'', m=$('mkn')?.value||'', t=$('tip')?.value||'';
        if(/^\d{4}$/.test(y)&&validMkn(m)&&validTip(t))
          status.textContent='✅ Prebrano tudi leto. Preveri podatke in shrani.';
        else if(validMkn(m)&&validTip(t)&&!/^\d{4}$/.test(y))
          status.textContent='⚠️ TIP in MKN sta prebrana, leto pa je na sliki še vedno premalo jasno.';
        else
          status.textContent='⚠️ Nekaj podatkov še ni dovolj zanesljivo. Poskusi ponovno ali približaj napisno ploščico.';
      }
    }catch(e){
      console.warn('Dodatna OCR kontrola:',e);
    }finally{
      try{if(img&&typeof img.close==='function')img.close();}catch(_){}
    }
  }

  function setup(){
    const btn=$('readBtn');
    if(!btn || btn.dataset.recheckWrapped==='2') return;
    const original=btn.onclick;
    if(typeof original!=='function'){setTimeout(setup,100);return;}
    btn.dataset.recheckWrapped='2';
    btn.onclick=async function(ev){
      await original.call(this,ev);
      await recheckIfNeeded();
    };
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(setup,80),{once:true});
  else setTimeout(setup,80);

  window.addEventListener('pagehide',()=>{
    if(fallbackWorker){const w=fallbackWorker;fallbackWorker=null;try{w.terminate();}catch(_){}}
  });
})();
