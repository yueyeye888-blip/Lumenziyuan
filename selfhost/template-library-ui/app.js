(() => {
  const BASE='/__host/template-archive';
  const ICONS={search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',eye:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>'};
  const icon=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+ICONS[name]+'</svg>';
  const node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;};
  const bytesLabel=bytes=>bytes>=1e9?(bytes/1e9).toFixed(2)+' GB':bytes>=1e6?(bytes/1e6).toFixed(1)+' MB':Math.max(1,Math.round(bytes/1000))+' KB';
  const flag=code=>/^[a-z]{2}$/i.test(code||'')?String.fromCodePoint(...code.toUpperCase().split('').map(character=>127397+character.charCodeAt(0))):'';
  const safeImage=value=>{try{const url=new URL(value,location.origin);return url.origin===location.origin||url.protocol==='https:'&&url.hostname==='cnd.windx.co.uk'?url.href:'';}catch{return '';}};

  function mount(host,{embedded=false}={}){
    if(host.shadowRoot)return;
    const root=host.attachShadow({mode:'open'});
    root.innerHTML='<link rel="stylesheet" href="'+BASE+'/style.css"><main class="'+(embedded?'embedded':'standalone')+'"><header'+(embedded?' hidden':'')+'><div><p class="eyebrow">LUMEN · 全球模版库</p><h1>驾驶证+签证</h1><p class="muted">按国家和文件类型浏览，查看介绍与对应预览。</p></div><a class="button secondary" href="/?templateCategory=driving-visa">返回全球模版库</a></header><section class="summary" aria-label="模版统计"><div class="totals"><div class="metric"><strong id="total">—</strong><span>个模版</span></div><div class="metric"><strong id="countries">—</strong><span>个国家 / 地区</span></div></div><span class="summary-note">预览免费<span id="archive-price"></span></span></section><div class="filters"><label class="search">'+icon('search')+'<input id="search" aria-label="搜索驾驶证或签证模版" placeholder="搜索模版名称、国家、编号或介绍"></label><select id="country" aria-label="按国家筛选模版"><option value="">全部国家 / 地区</option></select><select id="category" aria-label="按文件类型筛选模版"><option value="">全部类型</option></select></div><div class="result-line"><span id="status" role="status">正在加载模版…</span><button id="reset" class="text-button">重置筛选</button></div><div id="error" role="alert" hidden></div><div id="empty" class="empty" hidden>没有匹配的模版，请调整搜索条件。</div><section id="grid" class="grid" aria-label="驾驶证与签证模版列表"></section><dialog id="preview" aria-labelledby="preview-title"><header class="dialog-header"><div><h2 id="preview-title"></h2><p id="preview-subtitle"></p></div><button id="close" class="close" aria-label="关闭模版预览">'+icon('close')+'</button></header><div class="dialog-body"><div id="preview-picture" class="preview-picture"></div><aside class="introduction"><h3>模版介绍</h3><p id="introduction"></p><dl id="specs" class="specs"></dl><h3 id="field-heading" hidden>介绍中列出的字段</h3><div id="fields" class="field-tags"></div></aside></div><footer class="dialog-footer"><div class="pager"><button id="previous" class="button secondary">上一份</button><span id="position"></span><button id="next" class="button secondary">下一份</button></div><button type="button" id="modal-download" class="button dialog-download">'+icon('download')+'下载原文件</button></footer></dialog></main>';
    const $=id=>root.getElementById(id);
    let rows=[],visible=[],selected=null,downloadPriceRaw;
    const price = () => (downloadPriceRaw / 10000).toLocaleString('zh-CN', {maximumFractionDigits: 4});
    const payment = node('dialog',undefined,'archive-payment');
    payment.setAttribute('aria-labelledby','download-payment-title');
    payment.innerHTML = `
      <form>
        <header class="payment-header"><div><h2 id="download-payment-title">确认购买原文件</h2><p class="download-name"></p></div><button type="button" class="close" aria-label="关闭确认窗口">${icon('close')}</button></header>
        <div class="payment-body">
          <div class="download-price"><span>应付金额</span><strong><span class="download-amount"></span> <small>U</small></strong></div>
          <p>从账户余额扣款。下载中断后可在 30 分钟内继续。</p>
          <label>六位支付密码<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="off"></label>
          <a href="/__host/security">设置支付密码</a>
          <p role="alert" class="download-error"></p>
        </div>
        <footer class="payment-actions"><button type="button" class="button secondary">取消</button><button type="submit" class="button">支付并下载</button></footer>
      </form>`;
    root.querySelector('main').append(payment);
    const payForm=payment.querySelector('form');
    let payingFor, requestId, busy=false;
    function confirmDownload(row){
      if (busy || !Number.isSafeInteger(downloadPriceRaw)) return;
      payingFor=row;requestId=crypto.randomUUID();
      payForm.reset();payment.querySelector('.download-name').textContent=row.displayTitle||row.name;
      payment.querySelector('.download-error').textContent='';
      payment.querySelector('.download-amount').textContent=price();
      payment.querySelector('button[type="submit"]').textContent='支付 '+price()+' U 并下载';
      payment.showModal();payForm.elements.pin.focus();
    }
    for (const button of payment.querySelectorAll('button[type="button"]')) button.onclick=()=>payment.close();
    payment.addEventListener('cancel',event=>{if(busy)event.preventDefault()});
    payForm.onsubmit=async event=>{
      event.preventDefault();if(busy)return;busy=true;
      const actions=payment.querySelectorAll('button');for(const b of actions)b.disabled=true;
      try{
        const reply=await fetch(BASE+'/files/'+encodeURIComponent(payingFor.id)+'/authorize',{method:'POST',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({requestId,pin:payForm.elements.pin.value,quotedPriceRaw:downloadPriceRaw})});
        const result=await reply.json();if(!reply.ok)throw Error(result.error||'暂时无法下载。');
        const link=node('a');link.href=result.downloadPath;link.download=payingFor.originalName||'';root.append(link);link.click();link.remove();payment.close();payForm.reset();
      }catch(error){payment.querySelector('.download-error').textContent=error.message||'下载未开始，请重试。';}
      finally{busy=false;for(const b of actions)b.disabled=false;}
    };
    function picture(row,container,{large=false}={}){
      const image=node('img');image.alt=(row.displayTitle||row.name)+'对应预览图';image.src=safeImage(row.imageUrl||row.previewUrl);image.loading=large?'eager':'lazy';image.referrerPolicy='no-referrer';let usedFallback=false;
      image.addEventListener('error',()=>{const fallback=safeImage(row.previewUrl);if(!usedFallback&&fallback&&image.src!==fallback){usedFallback=true;image.src=fallback;return;}image.remove();if(!container.querySelector('.image-error'))container.append(node('span','对应预览图暂时无法加载','image-error'));});container.append(image);
    }
    function openPreview(row){
      selected=row;const index=visible.findIndex(item=>item.id===row.id);
      $('preview-title').textContent=row.displayTitle||row.name;$('preview-subtitle').textContent=[row.country,row.displayCategory||row.category,row.fileType,'#'+row.sourceId].filter(Boolean).join(' · ');
      $('preview-picture').replaceChildren();picture(row,$('preview-picture'),{large:true});$('introduction').textContent=row.description||'此模版的介绍暂未补充。';$('specs').replaceChildren();
      for(const [label,value] of [['国家 / 地区',row.country],['文件类型',row.displayCategory||row.category],['文件格式',row.fileType],['文件大小',row.bytes?bytesLabel(row.bytes):''],['模版编号','#'+row.sourceId]]){if(!value)continue;const entry=node('div',undefined,'spec');entry.append(node('dt',label),node('dd',value));$('specs').append(entry);}
      $('fields').replaceChildren();for(const value of row.fields||[])$('fields').append(node('span',value));$('field-heading').hidden=!(row.fields||[]).length;
      $('modal-download').innerHTML=icon('download')+'下载原文件 · '+price()+' U';$('modal-download').onclick=()=>confirmDownload(row);$('modal-download').hidden=row.fileStatus!=='archived';$('previous').disabled=index<=0;$('next').disabled=index<0||index>=visible.length-1;$('position').textContent=(index+1)+' / '+visible.length;
      if(!$('preview').open)$('preview').showModal();
    }
    function render(){
      const query=$('search').value.trim().toLowerCase();
      visible=rows.filter(row=>(!$('country').value||row.country===$('country').value)&&(!$('category').value||(row.displayCategory||row.category)===$('category').value)&&(!query||[row.displayTitle,row.name,row.country,row.sourceId,row.displayCategory,row.description,...row.fields||[]].join(' ').toLowerCase().includes(query)));
      $('status').textContent='共 '+visible.length+' 个匹配模版';$('empty').hidden=visible.length>0;$('grid').replaceChildren();
      for(const row of visible){
        const title=row.displayTitle||row.name;const card=node('article',undefined,'card');const cover=node('button',undefined,'cover');cover.type='button';cover.setAttribute('aria-label','预览 '+title+' #'+row.sourceId);picture(row,cover);cover.append(node('span',row.fileType,'format'));const zoom=node('span',undefined,'zoom');zoom.innerHTML=icon('eye');zoom.append(document.createTextNode('查看预览'));cover.append(zoom);cover.addEventListener('click',()=>openPreview(row));card.append(cover);
        const body=node('div',undefined,'card-body');const meta=node('div',undefined,'meta');const country=node('span',undefined,'country');country.append(node('span',flag(row.countryCode),'flag'),document.createTextNode(row.country));meta.append(country,node('span','#'+row.sourceId));body.append(meta,node('h2',title),node('p',row.description||'查看对应图片与模版资料。','description'));
        const bottom=node('div',undefined,'card-bottom');const fileMeta=node('div',undefined,'file-meta');fileMeta.append(node('span',row.displayCategory||row.category),node('span',row.bytes?bytesLabel(row.bytes):row.fileType));bottom.append(fileMeta);const actions=node('div',undefined,'actions');const detail=node('button','预览与介绍','button secondary');detail.type='button';detail.addEventListener('click',()=>openPreview(row));actions.append(detail);
        if(row.fileStatus==='archived'){const download=node('button','下载 · '+price()+' U','button');download.type='button';download.onclick=()=>confirmDownload(row);actions.append(download);}else{const pending=node('button','暂不可下载','button');pending.disabled=true;actions.append(pending);}bottom.append(actions);body.append(bottom);card.append(body);$('grid').append(card);
      }
    }
    async function load(){
      try{const response=await fetch(BASE+'/catalog',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(response.redirected&&new URL(response.url).pathname==='/__host/login'){location.assign('/__host/login?returnTo='+encodeURIComponent('/?templateCategory=driving-visa'));return;}const data=await response.json();if(!response.ok)throw new Error(data.error||'模版目录读取失败');if(!Number.isSafeInteger(data.priceRaw)||data.priceRaw<1)throw new Error('无法确认文件售价，请刷新重试。');downloadPriceRaw=data.priceRaw;$('archive-price').textContent=' · 原文件 '+price()+' U / 次';rows=data.items;$('total').textContent=rows.length;$('countries').textContent=new Set(rows.map(row=>row.country)).size;
        for(const [control,values] of [['country',rows.map(row=>row.country)],['category',rows.map(row=>row.displayCategory||row.category)]]){for(const value of [...new Set(values)].sort((a,b)=>a.localeCompare(b,'zh'))){const option=node('option',value);option.value=value;$(control).append(option);}}render();
      }catch(error){$('error').hidden=false;$('error').textContent=error.name==='TimeoutError'?'模版加载超时，请刷新页面重试。':error.message||'模版暂时无法加载，请重试';$('status').textContent='读取失败';}
    }
    $('search').addEventListener('input',render);$('country').addEventListener('change',render);$('category').addEventListener('change',render);$('reset').addEventListener('click',()=>{$('search').value='';$('country').value='';$('category').value='';render();});$('close').addEventListener('click',()=>$('preview').close());$('preview').addEventListener('click',event=>{if(event.target===$('preview'))$('preview').close();});
    const adjacent=direction=>{const index=visible.findIndex(item=>item.id===selected?.id);if(index+direction>=0&&index+direction<visible.length)openPreview(visible[index+direction]);};$('previous').addEventListener('click',()=>adjacent(-1));$('next').addEventListener('click',()=>adjacent(1));$('preview').addEventListener('keydown',event=>{if(event.key==='ArrowLeft'){event.preventDefault();adjacent(-1);}if(event.key==='ArrowRight'){event.preventDefault();adjacent(1);}});load();
  }
  window.LumenTemplateGallery={mount};
  const standalone=document.getElementById('template-gallery-root');if(standalone)mount(standalone);
})();
