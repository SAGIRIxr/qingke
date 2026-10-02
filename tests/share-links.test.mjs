import test from 'node:test';
import assert from 'node:assert/strict';
import {shareLink,shareMessage,parseShareLink,parseShareInput} from '../www/share-links.js';
const entry={code:'0123456789ABCDEFGHJK',server:'https://share.example:8443'};
test('分享消息包含口令、完整来源、下载入口，链接口令仅在fragment中',()=>{
 const link=shareLink(entry),url=new URL(link),message=shareMessage({...entry,name:'示例学期'});
 assert.equal(url.pathname,'/s');assert.equal(url.search,'');assert.ok(url.hash.includes(entry.code));
 assert.deepEqual(parseShareLink(link),entry);assert.deepEqual(parseShareInput(message),entry);
 assert.match(message,/App 下载：https:\/\/qk\.sagiri\.org\//);assert.equal(message.includes('deleteToken'),false);
});
test('显式粘贴支持分组口令，自定义服务器不被默认服务取代',()=>{
 assert.deepEqual(parseShareInput('01234-56789-ABCDE-FGHJK','https://share.example:8443'),entry);
 assert.deepEqual(parseShareLink('qingke://share?'+new URLSearchParams(entry)),entry);
});
test('拒绝假域名、凭据、路径越界、重复参数、未知参数和危险服务地址',()=>{
 const url=shareLink(entry);
 for(const invalid of [url.replace('qk.sagiri.org','evil.example'),url.replace('/s#','/s/other#'),url.replace('/s#','/s?code=x#'),url+'&code='+entry.code,url+'&next=https://evil.example',url.replace('server=https%3A%2F%2Fshare.example%3A8443','server=http%3A%2F%2Fshare.example'),url.replace('https://qk','https://user@qk'),url.replace('server=https%3A%2F%2Fshare.example%3A8443','server=https%3A%2F%2Fshare.example%2Fapi'),url+'&server=https://other.example'])assert.throws(()=>parseShareLink(invalid));
});
test('不同口令混在同条消息拒绝，普通剪贴板文字无法作为导入内容',()=>{
 assert.throws(()=>parseShareInput(shareLink(entry)+'\n'+shareLink({...entry,code:'1123456789ABCDEFGHJK'})));
 for(const text of ['普通私人文字','https://evil.example/s#code='+entry.code,'x'.repeat(16385)])assert.throws(()=>parseShareInput(text));
});
