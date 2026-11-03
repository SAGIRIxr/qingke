// Which native shell hosts the timetable. The iOS shell injects window.Android with platform 'ios';
// a browser preview can force the iOS look with ?platform=ios.
function detect(){
  try{
    const native=globalThis.window?.Android?.platform;
    if(native)return native;
    if(/[?&]platform=ios(?:&|$)/.test(globalThis.location?.search||''))return 'ios';
    return globalThis.window?.Android?'android':'web';
  }catch{return 'web';}
}
export const platform=detect();
export const isIOS=platform==='ios';
// The iOS shell draws a system tab bar; the page then hides its own and reports tab and sheet changes.
export const nativeTabs=isIOS&&globalThis.window?.Android?.nativeTabs===true;
if(isIOS&&globalThis.document?.body){
  const root=document.documentElement;
  root.classList.add('platform-ios');
  if(nativeTabs)root.classList.add('native-tabs');
  installTopBar();
  if(nativeTabs)installNativeTabs();
}

/** Soft scroll-edge blur under the status bar; on pages with a large title, the title reappears
 * small and centered once the large one scrolls underneath, like a native navigation bar. */
function installTopBar(){
  const bar=document.createElement('div'),title=document.createElement('span');
  bar.id='ios-bar';bar.setAttribute('aria-hidden','true');bar.append(title);document.body.append(bar);
  let frame=0;
  const update=()=>{
    frame=0;
    const heading=document.querySelector('#app .section-heading h1');
    bar.classList.toggle('has-title',!!heading);
    bar.classList.toggle('scrolled',window.scrollY>2);
    if(heading&&title.textContent!==heading.textContent)title.textContent=heading.textContent;
    bar.classList.toggle('titled',!!heading&&heading.getBoundingClientRect().bottom<bar.getBoundingClientRect().bottom-6);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
  window.addEventListener('scroll',schedule,{passive:true});
  const app=document.querySelector('#app');
  if(app)new MutationObserver(schedule).observe(app,{childList:true});
  schedule();
}

function installNativeTabs(){
  const app=document.querySelector('#app'),modal=document.querySelector('#modal-root');
  if(!app||!modal)return;
  let last='';
  const report=()=>{
    const tab=app.querySelector('.bottom-nav .nav-item.active')?.dataset.tab,open=!!modal.firstChild,key=`${tab}|${open}`;
    if(!tab||key===last)return;
    last=key;window.Android.setChrome(tab,open);
  };
  new MutationObserver(report).observe(app,{childList:true});
  new MutationObserver(report).observe(modal,{childList:true});
  // The hidden page navigation stays the single source of truth; native taps just press it.
  window.onNativeTab=key=>{
    const item=[...app.querySelectorAll('.bottom-nav [data-tab]')].find(node=>node.dataset.tab===key);
    if(!item)return;
    if(item.classList.contains('active'))window.scrollTo({top:0,behavior:'smooth'});else item.click();
  };
}
