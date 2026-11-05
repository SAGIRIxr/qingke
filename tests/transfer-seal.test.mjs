import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {sha256,hmac,newTransferCode,normalizeTransferCode,sealTransfer,openTransfer,transferId,TRANSFER_ALPHABET} from '../www/transfer-seal.js';

const bytes=text=>new TextEncoder().encode(text),hex=value=>Buffer.from(value).toString('hex');

test('纯 JS 的 SHA-256 与 HMAC 和系统实现逐字节一致（含分块边界与长密钥）',()=>{
  for(const text of ['','abc','a'.repeat(55),'a'.repeat(56),'a'.repeat(64),'课表'.repeat(500)])
    assert.equal(hex(sha256(bytes(text))),createHash('sha256').update(text).digest('hex'),text.length);
  for(const key of [Buffer.from('key'),Buffer.alloc(64,1),Buffer.alloc(100,7)])
    assert.equal(hex(hmac(new Uint8Array(key),bytes('message'))),createHmac('sha256',key).update('message').digest('hex'));
});

test('换机码可往返解密，服务器只拿到与码无关的查找 id 和密文',()=>{
  const code=newTransferCode(),value={format:'qingke-transfer',version:1,shares:[{deleteToken:'secret-token',name:'学期'}]};
  assert.equal(code.length,20);assert.ok([...code].every(c=>TRANSFER_ALPHABET.includes(c)));
  const sealed=sealTransfer(code,value);
  assert.match(sealed.id,/^[0-9a-f]{32}$/);assert.equal(sealed.id,transferId(code));
  assert.equal(sealed.data.includes('secret'),false);assert.equal(sealed.id.includes(code),false);
  const pretty=code.toLowerCase().match(/.{5}/g).join('-');
  assert.deepEqual(openTransfer(pretty,sealed.data),value);
  assert.notEqual(sealTransfer(code,value).data,sealed.data,'每次加密用新的随机 nonce');
});

test('错码、篡改和截断都会被拒绝，不会解出错误内容',()=>{
  const code=newTransferCode(),sealed=sealTransfer(code,{a:1});
  assert.throws(()=>openTransfer(newTransferCode(),sealed.data),/不正确|篡改/);
  const raw=Buffer.from(sealed.data,'base64');raw[20]^=1;
  assert.throws(()=>openTransfer(code,raw.toString('base64')),/不正确|篡改/);
  assert.throws(()=>openTransfer(code,sealed.data.slice(0,20)),/版本|损坏/);
  assert.throws(()=>normalizeTransferCode('ABC'),/20 位/);
  assert.equal(normalizeTransferCode('o1234-56789-abcde-fghjI'),'0123456789ABCDEFGHJ1','易混字母 O/I 按数字读');
});
