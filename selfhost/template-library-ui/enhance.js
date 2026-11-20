(() => {
  const BASE='/__host/template-archive';
  const states=new WeakMap();
  const customer = document.currentScript?.dataset.role === 'customer';
  let application;
  let openRequested=new URL(location.href).searchParams.get('templateCategory')==='driving-visa';
  const loadApplication=()=>{
    if(window.LumenTemplateGallery)return Promise.resolve();
    if(!application)application=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=BASE+'/app.js';script.onload=resolve;script.onerror=()=>reject(new Error('模版库加载失败，请刷新页面重试。'));document.head.append(script);});
    return application;
  };
  const stylesheet=document.createElement('style');
  stylesheet.textContent='[data-lumen-library-tabs]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:2px 0 24px}[data-lumen-library-tabs] button{display:flex;align-items:center;text-align:left;gap:13px;border:1px solid #dfe6f0;border-radius:14px;background:#fff;padding:17px 20px;cursor:pointer;color:#637c9d;transition:background .15s,border-color .15s;min-width:0}[data-lumen-library-tabs] button[aria-selected="true"]{border-color:#7294c4;background:#edf3fc;box-shadow:0 0 0 1px #7294c420}[data-lumen-library-tabs] .lumen-tab-icon{display:grid;place-items:center;width:40px;height:40px;flex-shrink:0;background:#f0f4fa;color:#708daf;border-radius:11px}[data-lumen-library-tabs] button[aria-selected="true"] .lumen-tab-icon{background:#dce8f8;color:#315d9e}[data-lumen-library-tabs] svg{width:22px;height:22px}[data-lumen-library-tabs] strong{display:block;font-size:14px;font-weight:650;color:#29466c}[data-lumen-library-tabs] small{display:block;font-size:11px;color:#8192a9;margin-top:5px;line-height:1.5}[data-lumen-library-tabs] button:focus-visible{outline:2px solid #5983bd;outline-offset:3px}[data-lumen-driver-panel]{min-width:0}@media(max-width:520px){[data-lumen-library-tabs]{gap:9px}[data-lumen-library-tabs] button{padding:13px 11px;gap:9px}[data-lumen-library-tabs] .lumen-tab-icon{width:30px;height:33px}[data-lumen-library-tabs] strong{font-size:12px}[data-lumen-library-tabs] small{font-size:10px}}';
  stylesheet.textContent += '[data-lumen-archive-locked]{border:1px solid #e2e7ef;border-radius:16px;background:#fff;color:#172033;padding:22px}[data-lumen-archive-locked] h2{font-weight:650;font-size:16px}[data-lumen-archive-locked] p{font-size:14px;color:#596d88;margin-top:7px}';
  document.head.append(stylesheet);
  function attach(){
    if(openRequested){if([...document.querySelectorAll('h1')].some(element=>element.textContent.trim()==='全球模版库'))openRequested=false;else{const button=[...document.querySelectorAll('button')].find(element=>element.textContent.trim()==='全球模版库');if(button)button.click();}}
    for(const heading of document.querySelectorAll('h1')){
      if(heading.textContent.trim()!=='全球模版库')continue;
      const existing=states.get(heading);if(existing){existing.apply();continue;}
      const header=heading.parentElement.parentElement;const library=header.parentElement;
      if(!library||library.querySelector('[data-lumen-library-tabs]'))continue;
      const tabs=document.createElement('div');tabs.dataset.lumenLibraryTabs='true';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','全球模版库分类');
      const panel=document.createElement('div');panel.dataset.lumenDriverPanel='true';panel.setAttribute('role','tabpanel');panel.id='lumen-driver-visa-panel';
      const definitions=[['address','地址证明','账单与地址证明模版','<path d="M7 3h7l4 4v14H7zM14 3v5h5M10 12h5m-5 4h5"/>'],['driving-visa','驾驶证+签证','驾驶证、签证与证件卡','<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M5 16c0-3 6-3 6 0m3-7h4m-4 4h4"/>']];
      const buttons=definitions.map(([key,label,description,paths])=>{const button=document.createElement('button');button.type='button';button.setAttribute('role','tab');button.dataset.category=key;button.innerHTML='<span class="lumen-tab-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths+'</svg></span><span><strong>'+label+'</strong><small>'+description+'</small></span>';tabs.append(button);return button;});
      library.insertBefore(tabs,header.nextSibling);library.insertBefore(panel,tabs.nextSibling);
      const previousStyles=new WeakMap();let active=new URL(location.href).searchParams.get('templateCategory')==='driving-visa'?'driving-visa':'address';let mounted=false;
      const setHidden=(element,hidden)=>{if(hidden){if(!previousStyles.has(element))previousStyles.set(element,[element.style.getPropertyValue('display'),element.style.getPropertyPriority('display')]);if(element.style.getPropertyValue('display')!=='none'||element.style.getPropertyPriority('display')!=='important')element.style.setProperty('display','none','important');}else if(previousStyles.has(element)){const [value,priority]=previousStyles.get(element);if(value)element.style.setProperty('display',value,priority);else element.style.removeProperty('display');previousStyles.delete(element);}};
      const description=document.createElement('p');description.dataset.lumenLibraryDescription='true';description.style.cssText='margin-top:8px;font-size:13px;line-height:1.8;color:#7c8da4';description.textContent='按国家和模版类型浏览，查看介绍、对应图片及文件资料。';heading.parentElement.append(description);
      const apply=()=>{
        if(!heading.isConnected)return;
        for(const child of library.children){if(child!==header&&child!==tabs&&child!==panel)setHidden(child,active==='driving-visa');}
        for(const child of heading.parentElement.children){if(child.tagName==='P'&&child!==description)setHidden(child,true);}
        setHidden(panel,active!=='driving-visa');for(const button of buttons){const selected=button.dataset.category===active;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
        if(active==='driving-visa'&&!mounted){
          mounted=true;
          if(customer){
            const locked=document.createElement('section');
            locked.dataset.lumenArchiveLocked='';
            locked.innerHTML='<h2>员工账号专用</h2><p>查看驾驶证和签证模版需要员工权限。</p>';
            panel.append(locked);
          }else{
            loadApplication().then(()=>{if(panel.isConnected)window.LumenTemplateGallery.mount(panel,{embedded:true});}).catch(error=>{panel.textContent=error.message;});
          }
        }
      };
      for(const button of buttons){button.addEventListener('click',()=>{active=button.dataset.category;const url=new URL(location.href);if(active==='driving-visa')url.searchParams.set('templateCategory',active);else url.searchParams.delete('templateCategory');history.replaceState(history.state,'',url);apply();});button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const target=buttons.find(element=>element!==button);target.click();target.focus();});}
      states.set(heading,{apply});apply();
    }
  }
  let queued=false;const schedule=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;attach();});};
  attach();new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
})();
