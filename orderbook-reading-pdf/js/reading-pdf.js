/* Reading PDF: client-only port of the approved PyMuPDF master layout. */
(function () {
  'use strict';
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const PW = 595.2756, PH = 841.8898, LEFT = 63, WIDTH = 470;
  const COLOR = { head: rgb(110/255,81/255,34/255), hi: rgb(120/255,59/255,46/255), body: rgb(74/255,58/255,44/255) };
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
    const [bg, arrow] = await Promise.all([
      fetch('vendor/reading-bg.jpeg').then(r => { if (!r.ok) throw Error('Reading background not available.'); return r.arrayBuffer(); }),
      fetch('vendor/arrow.ttf').then(r => { if (!r.ok) throw Error('Reading font not available.'); return r.arrayBuffer(); })
    ]);
    return { bg, arrow };
  }
  async function generate(source, progress) {
    const data = parse(source), files = await assets();
    const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
    const bg = await pdf.embedJpg(files.bg), arrow = await pdf.embedFont(files.arrow,{subset:true});
    const fonts = {
      tiro: await pdf.embedFont(StandardFonts.TimesRoman), tibo: await pdf.embedFont(StandardFonts.TimesRomanBold),
      tiit: await pdf.embedFont(StandardFonts.TimesRomanItalic), tibi: await pdf.embedFont(StandardFonts.TimesRomanBoldItalic), arrow
    };
    // pdf-lib's StandardFonts are Times/Nimbus Roman; the master uses the same Times-family metrics.
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
        if(tag) {items.push({lines:wrap(clean(tag[1]).toUpperCase(),'tibo',11.5),font:'tibo',size:11.5,color:COLOR.head,center:true,lh:15});continue;}
        par=par.replace(/<text[^>]*>([\s\S]*?)<\/text>/gi,'$1');
        const srcLines=par.split('\n').map(clean).filter(Boolean);
        const body=srcLines.join(' ').replace(/\s+/g,' ');
        if (!/^[“"]/.test(par) && body.length>115) {
          items.push({lines:wrap(body,'tiro',10.2),font:'tiro',size:10.2,color:COLOR.body,center:false,lh:14});
        } else {
          items.push({lines:srcLines.flatMap(l=>wrap(l,'tiit',12)),font:'tiit',size:12,color:COLOR.hi,center:true,lh:16});
        }
      }
      return items;
    }
    const blockH=it=>it.size*.80+(it.lines.length-1)*it.lh+4;
    function section(page,name,items,top,size,bodyStart,target=705) {
      const heads=wrap(name.toUpperCase(),'tibo',size), hy=top+size*.8;
      let start=heads.length===1?bodyStart:hy+(heads.length-1)*(size+4)+size+16;
      const gaps=Array(Math.max(0,items.length-1)).fill(20);
      const total=()=>start+items.reduce((n,it)=>n+blockH(it),0)+gaps.reduce((a,b)=>a+b,0);
      let extra=target-total();
      if(extra>0){
        if(gaps.length){const add=Math.min(extra/gaps.length,22);gaps.forEach((_,i)=>gaps[i]+=add);extra-=add*gaps.length;}
        for(const it of items.filter(it=>it.lines.length>1)) {
          if(extra<=0)break;
          const take=Math.min(it.lh*.5*(it.lines.length-1),extra);
          it.lh+=take/(it.lines.length-1);extra-=take;
        }
        if(total()<target)start+=(target-total())/2;
      }
      if(total()>765){let over=total()-765;if(gaps.length){const shrink=Math.min(over/gaps.length,10);gaps.forEach((_,i)=>gaps[i]-=shrink);}
        if(total()>765){const scale=Math.max(.90,(765-start-gaps.reduce((a,b)=>a+b,0))/Math.max(items.reduce((n,it)=>n+blockH(it),0),1));items.forEach(it=>it.lh*=scale);}
      }
      if(total()>765)throw Error('Section "'+name+'" overflows the page. Shorten it or split it into two PAGE sections.');
      heads.forEach((ln,i)=>centered(page,ln,hy+i*(size+4),'tibo',size,COLOR.head));
      let y=start;
      items.forEach((it,i)=>{y+=it.size*.8;it.lines.forEach((ln,j)=>{if(it.center)centered(page,ln,y,it.font,it.size,it.color);else line(page,ln,LEFT,y,it.font,it.size,it.color);if(j<it.lines.length-1)y+=it.lh;});if(i<items.length-1)y+=gaps[i]+4;});
    }
    // Cover and first reading section share a page.
    let p=newPage();centered(p,data.title.toUpperCase(),104,'tibo',21,COLOR.head);
    let y=133;wrap(data.subtitle,'tiit',12.3).forEach(ln=>{centered(p,ln,y,'tiit',12.3,COLOR.hi);y+=17;});
    if(data.premium){centered(p,data.premium,y+2,'tiit',11,COLOR.hi);y+=20;}
    y=165;
    for(const [key,value] of data.meta) {
      const ln=value?key+': '+value:key;
      if (measure(ln,'tiro',10.3)>WIDTH) {
        for(const part of wrap(ln,'tiro',10.3)) {centered(p,part,y,'tiro',10.3,COLOR.body);y+=21;}
      } else {centered(p,ln,y,'tiro',10.3,COLOR.body);y+=21;}
    }
    let section1=data.sections[0];section(p,section1.name,itemsOf(section1.text),y+26,13.5,y+66,708);
    for(let i=1;i<data.sections.length;i++){
      if(progress)progress(i+1,data.sections.length);
      const current=data.sections[i], last=i===data.sections.length-1;
      let items=itemsOf(current.text);
      if(last) {
        const closing=splitFinal(current.text,data.reader);
        if(closing.sign){items=itemsOf(closing.body);items.push({lines:[closing.sign],font:'tiro',size:10.2,color:COLOR.body,center:true,lh:14});items.push({lines:[closing.name],font:'tibi',size:12,color:COLOR.hi,center:true,lh:16});}
        items.push({lines:wrap(closing.disclaimer.replace(/\s+/g,' '),'tiro',10.3),font:'tiro',size:10.3,color:COLOR.body,center:true,lh:14});
      }
      p=newPage();section(p,current.name,items,67,16.5,116,last?730:705);
    }
    if(data.sections.length===1) { // Include closing disclaimer even for a one-page reading.
      p=newPage();section(p,'FINAL MESSAGE',itemsOf(DISCLAIMER),67,16.5,116,730);
    }
    const type=(data.meta.find(([k])=>/^Reading Type$/i.test(k))||[])[1];
    const filename=niceName(data.title.toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase()))+'_'+niceName(data.customer)+(type?'_'+niceName(type):'')+'.pdf';
    const bytes=await pdf.save({useObjectStreams:false});
    return {bytes,filename,pages:pdf.getPageCount()};
  }
  function download(result){const url=URL.createObjectURL(new Blob([result.bytes],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=result.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  window.ReadingPDF={parse,generate,download};
})();
