import test from 'node:test';
import assert from 'node:assert/strict';
import {sheet,backSheet,closeSheet} from '../www/ui.js';

function environment(t){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');let focused=0;
  const origin={isConnected:true,focus(){focused++;}};
  const root={firstChild:null,_html:'',get innerHTML(){return this._html;},set innerHTML(html){this._html=html;this.firstChild=html?{html,scrollTop:0,draft:'',focus(){}}:null;},querySelector(selector){if(selector==='.sheet-body')return this.firstChild;const node=this.firstChild;return {get isConnected(){return root.firstChild===node;},focus(){document.activeElement=this;}};},replaceChildren(node){this.firstChild=node;this._html=node.html;}};
  globalThis.document={querySelector:()=>root,activeElement:origin,body:{style:{}}};
  t.after(()=>previous?Object.defineProperty(globalThis,'document',previous):delete globalThis.document);
  return {root,get focused(){return focused;}};
}
test('系统返回逐层恢复原表单节点、未提交内容和滚动位置',t=>{
  const env=environment(t);sheet('日历','日期列表');const calendar=env.root.firstChild;calendar.draft='10/1,10/2';calendar.scrollTop=92;
  sheet('单次调课','课程编辑');const editor=env.root.firstChild;editor.draft='尚未保存的教室';editor.scrollTop=145;
  sheet('核对变更','确认');assert.ok(backSheet());assert.equal(env.root.firstChild,editor);assert.equal(editor.draft,'尚未保存的教室');assert.equal(editor.scrollTop,145);
  assert.ok(backSheet());assert.equal(env.root.firstChild,calendar);assert.equal(calendar.draft,'10/1,10/2');assert.equal(calendar.scrollTop,92);
  assert.ok(backSheet());assert.equal(env.root.firstChild,null);assert.equal(env.focused,1);assert.equal(backSheet(),false);
});
test('同页重绘和显式replace不会让返回键经过每次点选',t=>{
  const {root}=environment(t);sheet('日历','第一页');for(let i=0;i<6;i++)sheet('日历',`选择${i}`);
  sheet('读取中','进度',{replace:true});backSheet();assert.equal(root.firstChild,null);
});
test('操作完成关闭全部页面后不会回到旧表单',t=>{
  const {root}=environment(t);sheet('学期列表','列表');sheet('编辑学期','编辑');closeSheet();sheet('提醒','设置');backSheet();assert.equal(root.firstChild,null);
});
test('显式返回先前同名页面会收束历史，防止重复导航循环',t=>{
  const {root}=environment(t);sheet('分享管理','列表');sheet('确认撤销','确认');sheet('分享管理','更新后的列表');backSheet();assert.equal(root.firstChild,null);
});
