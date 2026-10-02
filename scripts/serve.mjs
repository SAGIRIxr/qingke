import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('www');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.wasm':'application/wasm','.bcmap':'application/octet-stream','.pfb':'application/octet-stream','.ttf':'application/octet-stream'};
http.createServer(async (req,res) => {
  try {
    const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const content = await readFile(file);
    res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4173,'127.0.0.1',()=>console.log('清课预览：http://127.0.0.1:4173'));
