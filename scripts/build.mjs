// ビルド出力
//   dist/pages/   … GitHub Pages に置く画面（index.html・app.js・style.css・CNAME）
//   dist/worker/  … Cloudflare Workers に置くAPI専用 Worker
//   dist/server/  … 画面とAPIを1本で配信する Worker（ローカル確認・Cloudflareのみで公開する場合用）
// 環境変数
//   API_BASE      … 画面から呼ぶAPIのURL（例：https://live-shiori-api.xxxx.workers.dev）。未指定なら同一オリジン
//   PAGES_DOMAIN  … GitHub Pages の独自ドメイン（既定：shiori.whathides.co.jp）
import fs from 'node:fs';
import crypto from 'node:crypto';
const API_BASE=(process.env.API_BASE||'').replace(/\/$/,''),PAGES_DOMAIN=process.env.PAGES_DOMAIN??'shiori.whathides.co.jp';
if(API_BASE&&!/^(https:\/\/[^/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/.test(API_BASE))throw Error('API_BASE は https://ホスト名 の形式で指定してください: '+API_BASE);
const api=fs.readFileSync('worker/api.mjs','utf8').replace(/^export (const|function|async function) /gm,'$1 ');
const read=name=>fs.readFileSync('public/'+name,'utf8');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,10);
const html=base=>{let h=read('index.html').replace('<meta name="api-base" content="">','<meta name="api-base" content="'+base.replace(/"/g,'&quot;')+'">');
 for(const f of ['app.js','style.css'])h=h.replace(new RegExp('(src|href)="'+f.replace('.','\\.')+'"'),'$1="'+f+'?v='+hash(read(f))+'"');return h};
const scheduled='async scheduled(event,env,ctx){ctx.waitUntil(cleanup(env))}';
const err='catch{return new Response(JSON.stringify({error:"保存処理に失敗しました。時間をおいて再度お試しください。"}),{status:500,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}})}';

fs.rmSync('dist',{recursive:true,force:true});
// 1. GitHub Pages
fs.mkdirSync('dist/pages',{recursive:true});
fs.writeFileSync('dist/pages/index.html',html(API_BASE));
for(const f of ['app.js','style.css'])fs.copyFileSync('public/'+f,'dist/pages/'+f);
fs.writeFileSync('dist/pages/.nojekyll','');
if(PAGES_DOMAIN)fs.writeFileSync('dist/pages/CNAME',PAGES_DOMAIN+'\n');
// 2. API専用 Worker
const apiWorker=api+'\nexport default {async fetch(req,env){try{if(new URL(req.url).pathname.startsWith("/api/"))return await api(req,env);return new Response("Not found",{status:404,headers:{"X-Robots-Tag":"noindex"}})}'+err+'},'+scheduled+'};';
fs.mkdirSync('dist/worker',{recursive:true});fs.writeFileSync('dist/worker/index.js',apiWorker);
// 3. 画面＋API の一体型 Worker
const files={'/index.html':html(''),'/app.js':read('app.js'),'/style.css':read('style.css')};
const server=api+'\nconst files='+JSON.stringify(files)+';\nexport default {async fetch(req,env){try{const p=new URL(req.url).pathname;if(p.startsWith("/api/"))return await api(req,env);const path=p==="/"?"/index.html":p;if(!files[path])return new Response("Not found",{status:404});return new Response(files[path],{headers:{"Content-Type":path.endsWith(".js")?"text/javascript; charset=utf-8":path.endsWith(".css")?"text/css; charset=utf-8":"text/html; charset=utf-8","Cache-Control":"no-cache","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex"}})}'+err+'},'+scheduled+'};';
fs.mkdirSync('dist/server',{recursive:true});fs.writeFileSync('dist/server/index.js',server);
// OpenAI のホスティングで公開する場合用の設定（.gitignore 済み。存在する場合のみコピー）
if(fs.existsSync('.openai/hosting.json')){fs.mkdirSync('dist/.openai',{recursive:true});fs.copyFileSync('.openai/hosting.json','dist/.openai/hosting.json')}
for(const code of [apiWorker,server])await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
console.log('Built: dist/pages (API_BASE='+(API_BASE||'同一オリジン')+', CNAME='+(PAGES_DOMAIN||'なし')+'), dist/worker, dist/server — ESM validated');
