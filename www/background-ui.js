import {button,sheet,toast} from './ui.js';

const unknown={supported:false,manufacturer:'',batteryOptimizationIgnored:null,powerSave:null,backgroundRestricted:null,autoStartStatus:'manual'};
const tri=value=>typeof value==='boolean'?value:null;
const destinations=new Map([['background-battery','battery'],['background-autostart','autostart'],['background-optimization','optimization'],['background-app','app']]);
export function backgroundStatus(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {...unknown};
  return {supported:value.supported===true,manufacturer:typeof value.manufacturer==='string'?value.manufacturer:'',
    batteryOptimizationIgnored:tri(value.batteryOptimizationIgnored),powerSave:tri(value.powerSave),
    backgroundRestricted:tri(value.backgroundRestricted),autoStartStatus:'manual'};
}

export function backgroundStatusMarkup(value){
  const s=backgroundStatus(value);
  if(!s.supported)return '<p class="helper-box">请在 Android 安装版中检查后台运行设置。</p>';
  const restricted=s.backgroundRestricted===true;
  return `<div class="helper-box ${restricted||s.powerSave===true?'warning-box':''}"><strong>${restricted?'后台活动受到限制，可能影响提醒':s.backgroundRestricted===false?'系统未标记后台活动受限':'暂时无法读取后台限制状态'}</strong><p>${restricted?'建议先打开「后台省电策略」，允许清课在后台运行。':s.backgroundRestricted===false?'部分厂商还有单独的省电策略，请按下方入口核对。':'请在系统应用信息中核对后台运行设置。'}</p><p>Android 电池优化：${s.batteryOptimizationIgnored===true?'已豁免':s.batteryOptimizationIgnored===false?'正在优化（通常可正常提醒）':'暂时无法读取'}<br>系统省电模式：${s.powerSave===true?'已开启，可能进一步限制后台':s.powerSave===false?'未开启':'暂时无法读取'}<br>自启动：请在系统设置中手动核对</p></div>`;
}

export function createBackgroundUI({onMessage}={}){
  let status={...unknown};
  const bridge=()=>window.Android;
  const notify=message=>(onMessage||toast)(message);
  function updateVisible(){const node=document.querySelector('#background-status');if(node)node.innerHTML=backgroundStatusMarkup(status);}
  function refresh(){
    try{status=backgroundStatus(bridge()?.getBackgroundStatus?JSON.parse(bridge().getBackgroundStatus()):null);}catch{status={...unknown,supported:Boolean(bridge()?.getBackgroundStatus)};}
    updateVisible();return status;
  }
  function open(){
    refresh();
    const xiaomi=/^(xiaomi|redmi|poco)$/i.test(status.manufacturer);
    sheet('后台运行与提醒',`<p class="sheet-subtitle">提醒不及时，可按下面的顺序检查。所有改动均由你在系统设置中确认。</p><div id="background-status" aria-live="polite">${backgroundStatusMarkup(status)}</div><div class="divider">1 · 后台省电策略</div><p>${xiaomi?'在清课的省电策略中选择「无限制」。不同系统版本也可能显示为「不限制」。':'在清课的应用信息中查找「电池」或「后台活动」，允许后台运行。'}</p>${button('background-battery','打开后台省电策略','primary full-width')}<div class="divider">2 · 自启动</div><p>${xiaomi?'在自启动管理中找到「清课」，允许后台自启动，以便系统恢复课表提醒。':'在系统设置中查找「自启动」「应用启动管理」或「后台运行」，允许清课自动启动。部分系统没有单独的开关。'}</p>${button('background-autostart','打开自启动设置','secondary full-width')}<p class="source-note">系统没有统一的自启动查询接口，清课不会将打开过设置视为已授权。请手动核对开关。</p><div class="divider">3 · Android 电池优化（可选）</div><p>如果前两项设置后提醒仍有延迟，可在电池优化列表中选择「所有应用」，找到清课并设为「不优化」。此项可能增加耗电，也不能替代厂商的后台运行设置。</p>${button('background-optimization','打开电池优化设置','secondary full-width')}<div class="sheet-actions">${button('background-refresh','重新检查','text-button')}${button('background-app','应用信息','text-button')}</div><p class="source-note">从系统设置返回后会自动重新读取状态。提醒仍需要允许通知和准时提醒；强行停止清课后，要再次打开才能恢复计划。</p><div class="divider">省电方式</div><p class="source-note">清课按课程时间安排系统提醒；通知倒计时由系统显示，不需要为了计时让应用持续运行。后台权限只用于改善提醒可靠性，不会让课表持续联网或常亮屏幕。</p>`);
  }
  window.onBackgroundStatus=value=>{
    try{status=backgroundStatus(typeof value==='string'?JSON.parse(value):value);}catch{status={...unknown,supported:Boolean(bridge()?.getBackgroundStatus)};}
    updateVisible();
  };
  function click(action){
    if(action==='background-settings'){open();return true;}
    if(action==='background-refresh'){refresh();return true;}
    const target=destinations.get(action);
    if(!target)return false;
    if(typeof bridge()?.openBackgroundSettings!=='function'){notify('请在 Android 安装版中打开系统设置');return true;}
    bridge().openBackgroundSettings(target);return true;
  }
  return {open,click,refresh};
}
