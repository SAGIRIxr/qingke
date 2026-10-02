export const SHARE_HOME='https://qk.sagiri.org';
const CODE=/^[0-9A-HJKMNP-TV-Z]{20}$/;
export function shareCode(value){const code=String(value||'').toUpperCase().replace(/[\s-]/g,'');if(!CODE.test(code))throw Error('请输入完整的 20 位清课分享口令');return code;}
export const prettyCode=value=>shareCode(value).match(/.{1,5}/g).join('-');
export function shareServer(value){
  if(typeof value!=='string'||value.length>500||/[\s\\?#]/u.test(value))throw Error('分享服务地址必须是 HTTPS 根地址');
  let url;try{url=new URL(value);}catch{throw Error('分享服务地址无效');}
  if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.pathname!=='/'||url.port==='0')throw Error('分享服务地址必须是 HTTPS 根地址，不带账号密码或路径');
  return url.origin;
}
export function shareLink(entry){return `${SHARE_HOME}/s#${new URLSearchParams({code:shareCode(entry.code),server:shareServer(entry.server)})}`;}
export function shareMessage(entry){
  const name=String(entry.name||'').replace(/[\r\n\u0000-\u001f\u007f]/g,' ').trim().slice(0,80);
  return `我在清课分享了课程表${name?`「${name}」`:''}\n口令：${prettyCode(entry.code)}\n打开并导入：${shareLink(entry)}\nApp 下载：${SHARE_HOME}/`;
}
export function parseShareLink(value){
  if(typeof value!=='string'||value.length>4096||/[\s\\]/u.test(value))throw Error('清课分享链接无效');
  let url;try{url=new URL(value);}catch{throw Error('清课分享链接无效');}
  let query;
  if(url.protocol==='https:'&&url.origin===SHARE_HOME&&url.pathname==='/s'&&!url.search)query=url.hash.slice(1);
  else if(url.protocol==='qingke:'&&url.hostname==='share'&&!url.port&&!url.pathname&&!url.hash)query=url.search.slice(1);
  else throw Error('这不是受支持的清课分享链接');
  if(url.username||url.password||!query||/%(?![0-9a-f]{2})/i.test(query))throw Error('清课分享链接无效');
  const params=new URLSearchParams(query),keys=[...params.keys()];
  if(keys.length!==2||keys.filter(k=>k==='code').length!==1||keys.filter(k=>k==='server').length!==1)throw Error('分享链接参数缺失或重复');
  return {code:shareCode(params.get('code')),server:shareServer(params.get('server'))};
}
/** Explicit paste accepts our complete message or a bare code; no network requests. */
export function parseShareInput(value,defaultServer=SHARE_HOME){
  const text=String(value||'').trim();if(!text||text.length>16384)throw Error('请粘贴清课分享消息、链接或口令');
  const candidates=text.match(/(?:https:\/\/qk\.sagiri\.org\/s#|qingke:\/\/share\?)[^\s<>"'，。；、）】]+/g)||[];
  if(candidates.length){const entries=candidates.map(parseShareLink),first=entries[0];if(entries.some(e=>e.code!==first.code||e.server!==first.server))throw Error('消息包含多份分享，请只粘贴其中一份');return first;}
  if(/^[0-9A-HJKMNP-TV-Z\s-]+$/i.test(text))return {code:shareCode(text),server:shareServer(defaultServer)};
  throw Error('未找到完整的清课分享链接或口令');
}
