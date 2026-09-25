/* Reading PDF: client-only port of the approved PyMuPDF master layout. */
(function () {
  'use strict';
  const { PDFDocument, rgb } = PDFLib;
  const PW = 595.2756, PH = 841.8898, LEFT = 63, WIDTH = 470;
  const COLOR = { head: rgb(74/255,58/255,44/255), hi: rgb(120/255,59/255,46/255), body: rgb(74/255,58/255,44/255) };
  const DISCLAIMER = "This reading is an intuitive and spiritual reflection for personal guidance and entertainment. Intuitive impressions cannot verify physical locations or another person's actions, and outcomes are not guaranteed. If negative thoughts, fear, or distress become persistent or interfere with daily life, professional mental-health or healthcare support can also be an important part of your wellbeing.";
  const READER_NAMES = ['Daisy Hayes', 'Lily Moon'];
  const clean = s => (s || '').replace(/\r\n?/g, '\n').trim();
  const niceName = s => s.replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, '_').replace(/_+/g, '_').slice(0, 70) || 'Reading';
  function parse(input) {
    const lines = clean(input).split('\n');
    if (lines.length < 4) throw new Error('Paste the reading title, client details and PAGE sections.');
    let title = lines[0].trim(), subtitle = (lines[1] || '').trim();
    if (title.includes('|') && !subtitle) [title, subtitle] = title.split(/\s*\|\s*/, 2);
    const first = lines.findIndex(l => /^\s*PAGE\s+\d+\s*[:—–-]\s*\S/i.test(l));
    if (first < 0) throw new Error('No PAGE 1: heading found. Add PAGE 1: TITLE before the reading text.');
    const header = lines.slice(2, first).map(x => x.trim()).filter(Boolean);
    let premium = '';
    if (header[0] && !header[0].includes(':')) premium = header.shift();
    const meta = header.map(l => {
      const k = l.indexOf(':'); if (k < 0) return [l, ''];
      const key = l.slice(0,k).trim().replace(/^DOB$/i, 'Date of Birth');
      return [key,l.slice(k+1).trim()];
    });
    const clientRow = meta.find(([k]) => /^Client$/i.test(k));
    const customer = clientRow ? clientRow[1] : '';
    const reader = (meta.find(([k]) => /^Reader$/i.test(k)) || [,'Daisy Hayes'])[1];
    const sections = [];
    for (const l of lines.slice(first)) {
      const m = l.match(/^\s*PAGE\s+\d+\s*[:—–-]\s*(.+)\s*$/i);
      if (m) sections.push({name:m[1].trim(), text:[]});
      else if (sections.length) sections[sections.length-1].text.push(l);
    }
    if (!sections.length) throw new Error('No reading sections found.');
    sections.forEach(s => s.text = clean(s.text.join('\n')));
    const last = sections[sections.length-1];
    const final = last.text.match(/\n\s*\n(FINAL MESSAGE FROM [^\n]+)\s*\n\s*([\s\S]*)$/i);
    if (final) { last.text = clean(last.text.slice(0,final.index)); sections.push({name:final[1],text:clean(final[2])}); }
    if (!customer.trim()) throw new Error('Add Client: followed by the customer name for the PDF filename.');
    return {title, subtitle, premium, meta, customer, reader, sections};
  }
  function splitFinal(text, reader) {
    const names = [...new Set([reader, ...READER_NAMES].filter(Boolean))];
    const nameRe = new RegExp('(?:' + names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|') + ')');
    const paragraphs = clean(text).split(/\n\s*\n/).map(clean).filter(Boolean);
    let signAt = paragraphs.findIndex(p => /^With\s+[^\n]+,?\s*\n+\s*\S/i.test(p) && nameRe.test(p));
    if (signAt < 0) signAt = paragraphs.findIndex((p,i) => /^With\s+[^\n]+,?$/i.test(p) && nameRe.test(paragraphs[i+1] || ''));
    if (signAt < 0) return {body:text, sign:'', name:'', disclaimer:DISCLAIMER, appended:true};
    const signed = paragraphs[signAt].split('\n').map(clean).filter(Boolean);
    const sign = signed[0];
    const name = signed.slice(1).join(' ') || paragraphs[signAt+1];
    const after = paragraphs.slice(signAt + (signed.length > 1 ? 1 : 2));
    return {body:paragraphs.slice(0,signAt).join('\n\n'),sign,name,disclaimer:after.join('\n\n') || DISCLAIMER,appended:!after.length};
  }
  async function assets() {
    // Fixed Lora v37 files. PDF embeds the font bytes, so output stays stable.
    const urls = {
      bg:'vendor/reading-bg.jpeg', arrow:'vendor/arrow.ttf',
      regular:'https://fonts.gstatic.com/s/lora/v37/0QI6MX1D_JOuGQbT0gvTJPa787weuyJG.ttf',
      bold:'https://fonts.gstatic.com/s/lora/v37/0QI6MX1D_JOuGQbT0gvTJPa787z5vCJG.ttf',
      italic:'https://fonts.gstatic.com/s/lora/v37/0QI8MX1D_JOuMw_hLdO6T2wV9KnW-MoFkqg.ttf',
      boldItalic:'https://fonts.gstatic.com/s/lora/v37/0QI8MX1D_JOuMw_hLdO6T2wV9KnW-C0Ckqg.ttf'
    };
    const pairs=await Promise.all(Object.entries(urls).map(async ([key,url])=>{
      const r=await fetch(url);
      if(!r.ok) throw Error('Reading asset not available: '+key);
      return [key,await r.arrayBuffer()];
    }));
    return Object.fromEntries(pairs);
  }
  async function generate(source, progress) {
    const data = parse(source), files = await assets();
    const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
    const bg = await pdf.embedJpg(files.bg), arrow = await pdf.embedFont(files.arrow,{subset:true});
    const fonts = {
      tiro:await pdf.embedFont(files.regular,{subset:true}), tibo:await pdf.embedFont(files.bold,{subset:true}),
      tiit:await pdf.embedFont(files.italic,{subset:true}), tibi:await pdf.embedFont(files.boldItalic,{subset:true}), arrow
    };
    const measure = (str,kind,size) => str.split('→').reduce((w,part,i) => w + (i ? fonts.arrow.widthOfTextAtSize('→',size) : 0) + fonts[kind].widthOfTextAtSize(part,size),0);
    const wrap = (str,kind,size,width=WIDTH) => {
      const words = str.trim().split(/\s+/).filter(Boolean), result=[]; let cur='';
      for (const word of words) {
        const next=(cur+' '+word).trim();
        if (measure(next,kind,size)<=width || !cur) cur=next;
        else { result.push(cur); cur=word; }
      }
      if(cur) result.push(cur);
      return result;
    };
    function newPage() { const page=pdf.addPage([PW,PH]); page.drawImage(bg,{x:0,y:0,width:PW,height:PH}); return page; }
    function line(page,ln,x,y,kind,size,color) {
      let cx=x;
      ln.split('→').forEach((part,i)=> {
        if (i) {page.drawText('→',{x:cx,y:PH-y,size,font:fonts.arrow,color});cx+=measure('→','tiit',size);}
        if (part) {page.drawText(part,{x:cx,y:PH-y,size,font:fonts[kind],color});cx+=fonts[kind].widthOfTextAtSize(part,size);}
      });
    }
    function centered(page,ln,y,kind,size,color) {line(page,ln,Math.max(LEFT,(PW-measure(ln,kind,size))/2),y,kind,size,color);}
    function itemsOf(src) {
      const items=[];
      for (let par of src.split(/\n\s*\n/)) {
        par=clean(par);if (!par) continue;
        const tag=par.match(/^<text[^>]*>([\s\S]*?)<\/text>$/i);
        if(tag) {items.push({lines:wrap(clean(tag[1]).toUpperCase(),'tibo',12),font:'tibo',size:12,color:COLOR.head,center:true,lh:16,raw:[clean(tag[1]).toUpperCase()],wrapKind:'tibo'});continue;}
        par=par.replace(/<text[^>]*>([\s\S]*?)<\/text>/gi,'$1');
        const srcLines=par.split('\n').map(clean).filter(Boolean);
        const body=srcLines.join(' ').replace(/\s+/g,' ');
        // Red italics are editorial emphasis, not a default for short text.
        // A direct question or a distinct key
        // conclusion qualifies. Ordinary lines and instructions stay brown.
        const important=/^(?:the strongest (?:intuitive )?(?:impression|message)|my strongest (?:intuitive )?impression|the (?:intuitive )?message (?:is|i receive)|you do not need to (?:become|wait until|transform)|your life is not |this is (?:one of )?the (?:strongest|most important))/i.test(body);
        const emphasize=body.endsWith('?') || important;
        if (!emphasize) {
          items.push({lines:wrap(body,'tiro',11.6),font:'tiro',size:11.6,color:COLOR.body,center:false,lh:16.5,raw:[body],wrapKind:'tiro'});
        } else {
          items.push({lines:srcLines.flatMap(l=>wrap(l,'tiit',13.3)),font:'tiit',size:13.3,color:COLOR.hi,center:true,lh:18.5,raw:srcLines,wrapKind:'tiit'});
        }
      }
      return items;
    }
    const blockH=it=>it.size*.80+(it.lines.length-1)*it.lh;
    // Size each reading as a whole. The densest page determines ONE type
    // scale; shorter pages keep it even when there is room left below.
    function scaledItems(items,scale) {
      return items.map(it=>{
        const size=it.size*scale, lh=it.lh*scale;
        const lines=it.raw ? it.raw.flatMap(raw=>wrap(raw,it.wrapKind||it.font,size)) :
          it.lines.flatMap(raw=>wrap(raw,it.font,size));
        return {...it,size,lh,lines};
      });
    }
    function layout(name,items,top,size,bodyStart,scale) {
      const heads=wrap(name.toUpperCase(),'tibo',size), hy=top+size*.8;
      const start=heads.length===1?bodyStart:hy+(heads.length-1)*(size+4)+size+16;
      const gap=16*scale;
      const bottom=start+items.reduce((n,it)=>n+blockH(it),0)+Math.max(0,items.length-1)*gap;
      return {heads,hy,start,gap,bottom};
    }
    function section(page,name,items,top,size,bodyStart,scale) {
      const m=layout(name,items,top,size,bodyStart,scale);
      if(m.bottom>750.5)throw Error('Section "'+name+'" exceeds the page. Split it into two PAGE sections.');
      m.heads.forEach((ln,i)=>centered(page,ln,m.hy+i*(size+4),'tibo',size,COLOR.head));
      let y=m.start;
      items.forEach((it,i)=>{y+=it.size*.8;it.lines.forEach((ln,j)=>{if(it.center)centered(page,ln,y,it.font,it.size,it.color);else line(page,ln,LEFT,y,it.font,it.size,it.color);if(j<it.lines.length-1)y+=it.lh;});if(i<items.length-1)y+=m.gap;});
    }
    const plans=data.sections.map((current,i)=>{
      const last=i===data.sections.length-1;
      let items=itemsOf(current.text);
      if(last) {
        const closing=splitFinal(current.text,data.reader);
        if(closing.sign){
          items=itemsOf(closing.body);
          items.push({lines:[closing.sign],raw:[closing.sign],font:'tiro',size:11.6,color:COLOR.body,center:true,lh:16.5});
          items.push({lines:[closing.name],raw:[closing.name],font:'tibo',size:13.3,color:COLOR.body,center:true,lh:18.5});
        }
        const disclaimer=closing.disclaimer.replace(/\s+/g,' ');
        items.push({lines:wrap(disclaimer,'tiro',11.3),raw:[disclaimer],font:'tiro',size:11.3,color:COLOR.body,center:true,lh:16});
      }
      return {name:current.name,items};
    });
    if(data.sections.length===1) plans.push({name:'FINAL MESSAGE',items:itemsOf(DISCLAIMER)});
    const coverY=165+data.meta.reduce((n,[key,value])=>{
      const text=value?key+': '+value:key;
      return n+21*(measure(text,'tiro',10.3)>WIDTH?wrap(text,'tiro',10.3).length:1);
    },0);
    const fits=scale=>plans.every((plan,i)=>{
      const cover=i===0;
      return layout(plan.name,scaledItems(plan.items,scale),cover?coverY+26:67,cover?13.5:16.5,cover?coverY+66:116,scale).bottom<=750;
    });
    let lo=.55,hi=1.0;
    if(!fits(lo))throw Error('A section is too long even at the minimum reading font size. Split it into two PAGE sections.');
    for(let n=0;n<16;n++){
      const mid=(lo+hi)/2;
      if(fits(mid))lo=mid;else hi=mid;
    }
    // Slight safety margin for PDF font/subsetting and floating point rounding.
    const readingScale=Math.max(.55,lo-.002);
    let p=newPage();centered(p,data.title.toUpperCase(),104,'tibo',21,COLOR.head);
    let y=133;wrap(data.subtitle,'tiro',12.3).forEach(ln=>{centered(p,ln,y,'tiro',12.3,COLOR.body);y+=17;});
    if(data.premium){centered(p,data.premium,y+2,'tiro',11,COLOR.body);y+=20;}
    y=165;
    for(const [key,value] of data.meta) {
      const ln=value?key+': '+value:key;
      for(const part of wrap(ln,'tiro',10.3)) {centered(p,part,y,'tiro',10.3,COLOR.body);y+=21;}
    }
    plans.forEach((plan,i)=>{
      if(i && progress)progress(i+1,plans.length);
      if(i)p=newPage();
      const cover=i===0;
      section(p,plan.name,scaledItems(plan.items,readingScale),cover?y+26:67,cover?13.5:16.5,cover?y+66:116,readingScale);
    });
    const type=(data.meta.find(([k])=>/^Reading Type$/i.test(k))||[])[1];
    const filename=niceName(data.title.toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase()))+'_'+niceName(data.customer)+(type?'_'+niceName(type):'')+'.pdf';
    const bytes=await pdf.save({useObjectStreams:false});
    return {bytes,filename,pages:pdf.getPageCount()};
  }
  function download(result){const url=URL.createObjectURL(new Blob([result.bytes],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=result.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  window.ReadingPDF={parse,generate,download};
})();
