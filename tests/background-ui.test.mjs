import test from 'node:test';
import assert from 'node:assert/strict';
import {backgroundStatus,backgroundStatusMarkup,createBackgroundUI} from '../www/background-ui.js';

test('后台限制与电池优化使用独立状态，自启动始终要求手动核对',()=>{
  const status={supported:true,manufacturer:'Xiaomi',batteryOptimizationIgnored:true,powerSave:false,backgroundRestricted:true,autoStartStatus:'allowed'};
  const parsed=backgroundStatus(status),html=backgroundStatusMarkup(parsed);
  assert.equal(parsed.autoStartStatus,'manual');
  assert.match(html,/后台活动受到限制/);
  assert.match(html,/Android 电池优化：已豁免/);
  assert.match(html,/自启动：请在系统设置中手动核对/);
});

test('未知、错误类型和旧版桥接缺失不能显示权限已允许',()=>{
  for(const raw of [null,[],{supported:true},{supported:true,backgroundRestricted:'false',batteryOptimizationIgnored:1,powerSave:'true'}]){
    const status=backgroundStatus(raw);
    assert.equal(status.backgroundRestricted,null);assert.equal(status.batteryOptimizationIgnored,null);
    const html=backgroundStatusMarkup(status);assert.doesNotMatch(html,/已豁免|系统未标记后台活动受限/);
  }
});

function fixture(t){
  const previous=new Map(['window','document'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const opened=[],messages=[],statusNode={innerHTML:''},form={draft:'尚未保存的提醒设置'};
  let status={supported:true,manufacturer:'Xiaomi',backgroundRestricted:true,batteryOptimizationIgnored:false,powerSave:false},visible=true;
  const bridge={getBackgroundStatus:()=>JSON.stringify(status),openBackgroundSettings:action=>opened.push(action)};
  globalThis.window={Android:bridge};
  globalThis.document={querySelector:selector=>selector==='#background-status'&&visible?statusNode:selector==='#notification-form'?form:null};
  t.after(()=>{for(const[k,v]of previous)v?Object.defineProperty(globalThis,k,v):delete globalThis[k];});
  const ui=createBackgroundUI({onMessage:message=>messages.push(message)});
  return {ui,opened,messages,statusNode,form,setStatus(next){status=next;},hide(){visible=false;}};
}

test('只有明确设置按钮会跳转，诊断及恢复前台不触发授权或弹窗',t=>{
  const env=fixture(t);env.ui.refresh();
  window.onBackgroundStatus({supported:true,backgroundRestricted:false,batteryOptimizationIgnored:true,powerSave:false});
  assert.deepEqual(env.opened,[]);
  assert.match(env.statusNode.innerHTML,/系统未标记后台活动受限/);
  assert.equal(env.form.draft,'尚未保存的提醒设置');
  for(const[action,target]of [['background-battery','battery'],['background-autostart','autostart'],['background-optimization','optimization'],['background-app','app']]){
    assert.equal(env.ui.click(action),true);assert.equal(env.opened.at(-1),target);
  }
  assert.equal(env.ui.click('__proto__'),false);assert.equal(env.ui.click('constructor'),false);
  assert.equal(env.ui.click('com.example/ArbitraryActivity'),false);assert.equal(env.opened.length,4);
});

test('返回系统设置会读取新状态，回调只更新诊断区并保留其他表单',t=>{
  const env=fixture(t);env.ui.refresh();assert.match(env.statusNode.innerHTML,/后台活动受到限制/);
  env.setStatus({supported:true,backgroundRestricted:false,batteryOptimizationIgnored:false,powerSave:true});
  env.ui.refresh();assert.match(env.statusNode.innerHTML,/系统未标记后台活动受限/);assert.match(env.statusNode.innerHTML,/已开启，可能进一步限制后台/);
  env.hide();window.onBackgroundStatus('{"supported":true,"backgroundRestricted":false}');
  assert.equal(env.form.draft,'尚未保存的提醒设置');assert.deepEqual(env.opened,[]);
});

test('读取系统状态失败后不沿用旧授权结果，缺少原生能力时只说明',t=>{
  const env=fixture(t);env.setStatus({supported:true,batteryOptimizationIgnored:true,backgroundRestricted:false});env.ui.refresh();
  window.Android.getBackgroundStatus=()=>{throw Error('unavailable');};env.ui.refresh();
  assert.doesNotMatch(env.statusNode.innerHTML,/已豁免|系统未标记后台活动受限/);
  window.Android=undefined;assert.equal(env.ui.click('background-autostart'),true);
  assert.deepEqual(env.opened,[]);assert.deepEqual(env.messages,['请在 Android 安装版中打开系统设置']);
});
