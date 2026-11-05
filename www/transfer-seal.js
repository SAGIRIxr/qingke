// Device-transfer sealing. Everything is derived from the 20-character transfer code: the server
// receives a one-way lookup id and ciphertext, never the code, so it cannot read share credentials.
// Pure JS on purpose: WebCrypto's subtle API is missing in some app WebViews (custom schemes).
// Construction: HMAC-SHA256 as a PRF in counter mode for the keystream, encrypt-then-MAC with a
// separate HMAC key, independent keys derived from the code by domain-separated HMACs.

export const TRANSFER_ALPHABET='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const VERSION=1,NONCE=16,TAG=32;

const K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);

export function sha256(bytes){
  const length=bytes.length,padded=new Uint8Array(((length+9+63)>>6)<<6);
  padded.set(bytes);padded[length]=0x80;
  const view=new DataView(padded.buffer);
  view.setUint32(padded.length-8,Math.floor(length/0x20000000));view.setUint32(padded.length-4,(length<<3)>>>0);
  const h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]),w=new Uint32Array(64);
  const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
  for(let offset=0;offset<padded.length;offset+=64){
    for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
    for(let i=16;i<64;i++){
      const s0=rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>>3),s1=rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>>10);
      w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;
    }
    let [a,b,c,d,e,f,g,hh]=h;
    for(let i=0;i<64;i++){
      const t1=(hh+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0;
      const t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
      hh=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
    }
    h[0]+=a;h[1]+=b;h[2]+=c;h[3]+=d;h[4]+=e;h[5]+=f;h[6]+=g;h[7]+=hh;
  }
  const out=new Uint8Array(32),outView=new DataView(out.buffer);
  h.forEach((value,i)=>outView.setUint32(i*4,value));
  return out;
}

const utf8=text=>new TextEncoder().encode(text);
const concat=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
export function hmac(key,message){
  if(key.length>64)key=sha256(key);
  const block=new Uint8Array(64);block.set(key);
  const inner=block.map(b=>b^0x36),outer=block.map(b=>b^0x5c);
  return sha256(concat(outer,sha256(concat(inner,message))));
}
const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}
function base64(bytes){let text='';for(let i=0;i<bytes.length;i+=0x8000)text+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(text);}
function unbase64(text){const raw=atob(text),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}
function random(length){const out=new Uint8Array(length);globalThis.crypto.getRandomValues(out);return out;}

export function normalizeTransferCode(value){
  const code=String(value||'').toUpperCase().replace(/[\s-]/g,'').replace(/O/g,'0').replace(/[IL]/g,'1');
  if(code.length!==20||[...code].some(c=>!TRANSFER_ALPHABET.includes(c)))throw Error('请输入完整的 20 位换机码');
  return code;
}
/** 20 characters of a 32-letter alphabet: 100 random bits. */
export function newTransferCode(){return [...random(20)].map(b=>TRANSFER_ALPHABET[b&31]).join('');}

function keys(code){
  const secret=utf8(normalizeTransferCode(code));
  return {id:hex(hmac(secret,utf8('qingke-transfer/id'))).slice(0,32),enc:hmac(secret,utf8('qingke-transfer/enc')),mac:hmac(secret,utf8('qingke-transfer/mac'))};
}
function keystream(key,nonce,length){
  const out=new Uint8Array(length),counter=new Uint8Array(4),view=new DataView(counter.buffer);
  for(let block=0,at=0;at<length;block++,at+=32){view.setUint32(0,block);out.set(hmac(key,concat(nonce,counter)).subarray(0,Math.min(32,length-at)),at);}
  return out;
}

export const transferId=code=>keys(code).id;
export function sealTransfer(code,value,nonce=random(NONCE)){
  const {id,enc,mac}=keys(code),plain=utf8(JSON.stringify(value)),stream=keystream(enc,nonce,plain.length);
  const cipher=plain.map((b,i)=>b^stream[i]),head=concat(Uint8Array.of(VERSION),nonce,cipher);
  return {id,data:base64(concat(head,hmac(mac,head)))};
}
export function openTransfer(code,data){
  const {enc,mac}=keys(code);let bytes;
  try{bytes=unbase64(data);}catch{throw Error('换机数据已损坏');}
  if(bytes.length<1+NONCE+TAG||bytes[0]!==VERSION)throw Error('换机数据版本不受支持');
  const head=bytes.subarray(0,bytes.length-TAG);
  if(!equal(hmac(mac,head),bytes.subarray(bytes.length-TAG)))throw Error('换机码不正确，或数据已被篡改');
  const nonce=head.subarray(1,1+NONCE),cipher=head.subarray(1+NONCE),stream=keystream(enc,nonce,cipher.length);
  return JSON.parse(new TextDecoder().decode(cipher.map((b,i)=>b^stream[i])));
}
