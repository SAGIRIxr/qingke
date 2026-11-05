import test from 'node:test';
import assert from 'node:assert/strict';

const store=new Map();
globalThis.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
const {shareBackup,shareBackupSummary,restoreShareBackup}=await import('../www/share-ui.js');

const code='ABCDE12345FGHJK67890',later=new Date(Date.now()+86400000).toISOString();
const owned={code,deleteToken:'secret-token',expiresAt:later,server:'https://qk.sagiri.org',name:'学期',createdAt:'2026-11-01T00:00:00Z',localSemesterId:'s1',revision:3};
const follow={localSemesterId:'s2',server:'https://qk.sagiri.org',code:'ZYXWV98765TSRQP43210',revision:1,map:{},baseline:{},enabled:true};

test('换机备份带上分享凭证和跟随记录，恢复到另一台设备后可继续管理',()=>{
  store.clear();
  store.set('qingke.shares.v1',JSON.stringify([owned]));store.set('qingke.follows.v1',JSON.stringify([follow]));
  const data=JSON.parse(JSON.stringify(shareBackup()));
  assert.deepEqual(shareBackupSummary(data),{shares:1,follows:1});
  store.clear();
  assert.deepEqual(restoreShareBackup(data,['s1','s2']),{shares:1,follows:1});
  assert.equal(JSON.parse(store.get('qingke.shares.v1'))[0].deleteToken,'secret-token');
  assert.equal(JSON.parse(store.get('qingke.follows.v1'))[0].localSemesterId,'s2');
});
test('恢复只接回有效记录：跟随的学期必须随备份恢复，过期或非 HTTPS 的分享丢弃，新版本不被旧备份覆盖',()=>{
  store.clear();
  store.set('qingke.shares.v1',JSON.stringify([{...owned,revision:5}]));
  const data={format:'qingke-sharing',version:1,shares:[owned,{...owned,code:'QQQQQ11111QQQQQ22222',expiresAt:'2020-01-01T00:00:00Z'},{...owned,code:'WWWWW11111WWWWW22222',server:'http://evil.example'}],follows:[follow]};
  assert.deepEqual(restoreShareBackup(data,['s1']),{shares:1,follows:0});
  const shares=JSON.parse(store.get('qingke.shares.v1'));
  assert.equal(shares.length,1);assert.equal(shares[0].revision,5);
  assert.equal(shareBackupSummary({format:'other'}),null);
  assert.equal(shareBackup().follows.length,0);
});
