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
      bg:'vendor/reading-bg.jpeg', arrow:'vendor/arrow.ttf', emoji:'vendor/noto-emoji.ttf',
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
      tiit:await pdf.embedFont(files.italic,{subset:true}), tibi:await pdf.embedFont(files.boldItalic,{subset:true}), arrow,
      emoji:await pdf.embedFont(files.emoji,{subset:false})
    };
    // Lora has no emoji glyphs. Split text into Lora runs and emoji runs and
    // draw the emoji runs with Noto Emoji, so emoji render without changing
    // the look of the Lora text around them.
    const EMOJI_BASE=/[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{3030}\u{303D}\u{3297}\u{3299}\u{00A9}\u{00AE}\u{203C}\u{2049}\u{2122}\u{2139}]/u;
    function segment(str){
      const chars=[...str], runs=[];
      let cur='', isEmoji=false;
      const push=()=>{if(cur)runs.push({t:cur,emoji:isEmoji});cur='';};
      for(let i=0;i<chars.length;i++){
        const ch=chars[i], cp=ch.codePointAt(0);
        const joiner=cp===0xFE0F||cp===0x200D||cp===0x20E3||(cp>=0xE0020&&cp<=0xE007F);
        // Keycap sequences: digit / # / * + optional FE0F + combining enclosing keycap.
        const keycap=/^[0-9#*]$/.test(ch)&&(chars[i+1]==='\u20E3'||(chars[i+1]==='\uFE0F'&&chars[i+2]==='\u20E3'));
        if(EMOJI_BASE.test(ch)||keycap){
          if(cur&&!isEmoji)push();
          isEmoji=true;cur+=ch;continue;
        }
        if(joiner&&cur){isEmoji=true;cur+=ch;continue;}
        if(isEmoji&&cur)push();
        isEmoji=false;cur+=ch;
      }
      push();
      return runs;
    }
    const textWidth=(part,kind,size)=>segment(part).reduce((w,r)=>w+(r.emoji?fonts.emoji:fonts[kind]).widthOfTextAtSize(r.t,size),0);
    const measure = (str,kind,size) => str.split('→').reduce((w,part,i) => w + (i ? fonts.arrow.widthOfTextAtSize('→',size) : 0) + textWidth(part,kind,size),0);
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
        segment(part).forEach(r=>{
          if (!r.t) return;
          const font=r.emoji?fonts.emoji:fonts[kind];
          page.drawText(r.t,{x:cx,y:PH-y,size,font,color});
          cx+=font.widthOfTextAtSize(r.t,size);
        });
      });
    }
    function centered(page,ln,y,kind,size,color) {line(page,ln,Math.max(LEFT,(PW-measure(ln,kind,size))/2),y,kind,size,color);}
    function justified(page,ln,y,kind,size,color) {
      const words=ln.trim().split(/\s+/).filter(Boolean);
      if(words.length<2) {line(page,ln,LEFT,y,kind,size,color);return;}
      const widths=words.map(w=>measure(w,kind,size));
      const gap=(WIDTH-widths.reduce((a,b)=>a+b,0))/(words.length-1);
      let x=LEFT;
      words.forEach((word,i)=>{line(page,word,x,y,kind,size,color);x+=widths[i]+gap;});
    }

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
      // Each section is a page: choose a genuine takeaway when the input
      // has no explicitly emphasized line. Do not turn ordinary list labels,
      // boilerplate or the healthcare disclaimer into decoration.
      if(items.length && !items.some(it=>it.font==='tiit')) {
        function score(it) {
          if(it.font!=='tiro') return -Infinity;
          const text=(it.raw||[]).join(' ').trim();
          if(text.length<26 || text.length>170 || /^(?:dear |my dear |with |day \d|week \d|the ritual|what you need|for example|then say|check carefully|this reading is intended|this reading is an intuitive)/i.test(text)) return -Infinity;
          if(/(?:cannot guarantee|not guaranteed|qualified healthcare|professional|dietitian|sensitive skin|allergies|registered)/i.test(text)) return -Infinity;
          let n=0;
          if(/^['"“]/.test(text) && /(?:I |my |love|confidence|body)/i.test(text)) n+=12;
          if(/(?:important message|important point|important transformation|spiritual message|deeper message|strongest message|the message|the purpose|the goal|the spiritual intention|the symbolic theme|the intuitive message|gentle impression|strongest impression)/i.test(text)) n+=11;
          if(/^(?:you (?:are|deserve|do not|can)|your (?:life|love life|dream body|beauty|confidence|journey)|one clear step|but slow progress|the spiritual message|focus on consistency)/i.test(text)) n+=8;
          if(/(?:rather than|not a punishment|not destined|not less|can change|does not need|while|kindness|patience|confidence|self-respect|support)/i.test(text)) n+=3;
          if(text.length>=45 && text.length<=130)n+=2;
          if(text.length>140)n-=4;
          return n;
        }
        let best=-1, bestScore=-Infinity;
        items.forEach((it,i)=>{const value=score(it);if(value>bestScore || (value===bestScore && i>best)){bestScore=value;best=i;}});
        if(best>=0 && Number.isFinite(bestScore)) {
          const it=items[best];
          it.font='tiit';it.size=13.3;it.color=COLOR.hi;it.center=true;it.lh=18.5;it.wrapKind='tiit';
          it.lines=it.raw.flatMap(t=>wrap(t,'tiit',it.size));
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
      let hsize=size, heads=wrap(name.toUpperCase(),'tibo',hsize);
      while(hsize>9 && heads.some(ln=>measure(ln,'tibo',hsize)>WIDTH)){hsize-=0.5;heads=wrap(name.toUpperCase(),'tibo',hsize);}
      const hy=top+hsize*.8;
      const start=heads.length===1?bodyStart:hy+(heads.length-1)*(hsize+4)+hsize+16;
      const gap=16*scale;
      const bottom=start+items.reduce((n,it)=>n+blockH(it),0)+Math.max(0,items.length-1)*gap;
      return {heads,hy,start,gap,bottom,hsize};
    }
    function section(page,name,items,top,size,bodyStart,scale) {
      const m=layout(name,items,top,size,bodyStart,scale);
      if(m.bottom>730.5)throw Error('Section "'+name+'" exceeds the page. Split it into two PAGE sections.');
      m.heads.forEach((ln,i)=>centered(page,ln,m.hy+i*(m.hsize+4),'tibo',m.hsize,COLOR.head));
      let y=m.start;
      items.forEach((it,i)=>{
        y+=it.size*.8;
        it.lines.forEach((ln,j)=>{
          if(it.center) centered(page,ln,y,it.font,it.size,it.color);
          else if(j<it.lines.length-1) justified(page,ln,y,it.font,it.size,it.color);
          else line(page,ln,LEFT,y,it.font,it.size,it.color);
          if(j<it.lines.length-1)y+=it.lh;
        });
        if(i<items.length-1)y+=m.gap;
      });
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
    // Long titles must fit the page width: shrink the title font first, then
    // wrap onto extra centered lines, and move the rest of the cover down.
    let titleSize=21;
    const titleText=data.title.toUpperCase();
    while(titleSize>13 && measure(titleText,'tibo',titleSize)>WIDTH)titleSize-=0.5;
    let titleLines=wrap(titleText,'tibo',titleSize);
    while(titleSize>8 && titleLines.some(ln=>measure(ln,'tibo',titleSize)>WIDTH)){titleSize-=0.5;titleLines=wrap(titleText,'tibo',titleSize);}
    const titleStep=titleSize+6;
    const coverTitleDrop=(titleLines.length-1)*titleStep;
    const coverY=165+coverTitleDrop+data.meta.reduce((n,[key,value])=>{
      const text=value?key+': '+value:key;
      return n+21*(measure(text,'tiro',10.3)>WIDTH?wrap(text,'tiro',10.3).length:1);
    },0);
    const fits=scale=>plans.every((plan,i)=>{
      const cover=i===0;
      return layout(plan.name,scaledItems(plan.items,scale),cover?coverY+26:67,cover?13.5:16.5,cover?coverY+66:116,scale).bottom<=730;
    });
    let lo=.55,hi=1.0;
    if(!fits(lo))throw Error('A section is too long even at the minimum reading font size. Split it into two PAGE sections.');
    for(let n=0;n<16;n++){
      const mid=(lo+hi)/2;
      if(fits(mid))lo=mid;else hi=mid;
    }
    // Slight safety margin for PDF font/subsetting and floating point rounding.
    const readingScale=Math.max(.55,lo-.002);
    let p=newPage();
    titleLines.forEach((ln,i)=>centered(p,ln,104+i*titleStep,'tibo',titleSize,COLOR.head));
    let y=133+coverTitleDrop;wrap(data.subtitle,'tiit',12.3).forEach(ln=>{centered(p,ln,y,'tiit',12.3,COLOR.hi);y+=17;});
    if(data.premium){centered(p,data.premium,y+2,'tiro',11,COLOR.body);y+=20;}
    y=165+coverTitleDrop;
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
