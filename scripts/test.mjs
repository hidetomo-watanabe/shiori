import assert from 'node:assert/strict';
import {api,cleanup,computeExpiry,CREATE_LIMIT_PER_HOUR} from '../worker/api.mjs';
import {createHash} from 'node:crypto';
const records=new Map();let etag=0;
const env={BUCKET:{
 async get(k){let r=records.get(k);return r?{etag:r.etag,async json(){return JSON.parse(r.value)},async text(){return r.value}}:null},
 async put(k,value,opt){if(opt?.onlyIf&&records.get(k)?.etag!==opt.onlyIf.etagMatches)return null;records.set(k,{value,etag:String(++etag),customMetadata:opt?.customMetadata});return {etag:String(etag)}},
 async delete(k){for(const key of [].concat(k))records.delete(key)},
 async list({prefix}){return {objects:[...records].filter(([k])=>k.startsWith(prefix)).map(([key,r])=>({key,customMetadata:r.customMetadata})),truncated:false}}
}};
const data={title:'日本語ライブ',date:'2026-10-24',open:'13:30',start:'14:00',end:'16:00',venue:'HAND-CLAP',note:'こんにちは',acts:[{name:'だぁめんず',play:25,change:10}]};
const call=(path,method='GET',body,token,ip)=>api(new Request('https://example.com/api/events'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(ip?{'CF-Connecting-IP':ip}:{})},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),env);

// 既存の動作
let r=await call('','POST',{data});assert.equal(r.status,201);let created=await r.json();let path='/'+created.id;const r0=await call('','POST',{data});const path0='/'+(await r0.json()).id;assert.ok(created.expiresAt);r=await call(path);let read=await r.json();assert.deepEqual(read.data,data);assert.equal(read.editToken,undefined);assert.equal(read.editHash,undefined);
assert.equal((await call(path,'PUT',{data,revision:1})).status,403);
assert.equal((await call(path,'PUT',{data,revision:1},'a'.repeat(48))).status,403);
const changed={...data,title:'更新済み'};r=await call(path,'PUT',{data:changed,revision:1},created.editToken);assert.equal(r.status,200);assert.equal((await(await call(path)).json()).data.title,'更新済み');
assert.equal((await call(path,'PUT',{data,revision:1},created.editToken)).status,409);
assert.equal((await call('','POST',{data:{...data,acts:[]}})).status,400);
assert.equal((await call('/'+'0'.repeat(24))).status,404);
const concurrent=await Promise.all([call(path,'PUT',{data,revision:2},created.editToken),call(path,'PUT',{data:changed,revision:2},created.editToken)]);assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,409]);

// 1. 不正な入力は500ではなく400
for(const bad of ['null','[]','"x"','123',{data:null},{data:[]},{data:{...data,acts:[null]}},{data:{...data,acts:[[]]}},{data:{...data,acts:['x']}}])assert.equal((await call('','POST',bad)).status,400,JSON.stringify(bad));
assert.equal((await call(path,'PUT','null',created.editToken)).status,400);

// 2-a. 作成回数制限（IP単位）
for(let i=0;i<CREATE_LIMIT_PER_HOUR;i++)assert.equal((await call('','POST',{data},null,'198.51.100.1')).status,201);
r=await call('','POST',{data},null,'198.51.100.1');assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'3600');
assert.equal((await call('','POST',{data},null,'198.51.100.2')).status,201,'別IPは影響を受けない');
assert.ok([...records.keys()].every(k=>!k.includes('198.51.100')),'IPを平文で保存しない');

// 2-b. 期限切れイベント
const rec=records.get('events'+path),old=JSON.parse(rec.value);old.expiresAt=new Date(Date.now()-1000).toISOString();records.set('events'+path,{...rec,value:JSON.stringify(old),customMetadata:{expiresAt:old.expiresAt}});
assert.equal((await call(path,'PUT',{data,revision:old.revision},created.editToken)).status,404);
assert.equal((await call(path)).status,404);assert.equal(records.has('events'+path),false,'閲覧時に削除される');

// 2-c. 定期削除
r=await call('','POST',{data});const victim=(await r.json()).id,vk='events/'+victim,v=records.get(vk);records.set(vk,{...v,customMetadata:{expiresAt:new Date(Date.now()-1).toISOString()}});
records.set('ratelimit/1/old',{value:'5',etag:'x'});
const before=[...records.keys()].filter(k=>k.startsWith('events/')).length;
const result=await cleanup(env);assert.deepEqual(result,{events:1,ratelimit:1});
assert.equal(records.has(vk),false);assert.equal([...records.keys()].filter(k=>k.startsWith('events/')).length,before-1);assert.ok([...records.keys()].some(k=>k.startsWith('ratelimit/')),'現在のカウンタは残す');

// 保存期間（a）＋プラン別
const DAY=864e5,now=Date.parse('2026-10-16T05:00:00Z');
assert.equal(computeExpiry({date:'2026-12-01'},'free',now),new Date(Date.parse('2026-12-01T23:59:59+09:00')+90*DAY).toISOString(),'開催日+90日');
assert.equal(computeExpiry({date:''},'free',now),new Date(now+180*DAY).toISOString(),'開催日なし→最終更新+180日');
assert.equal(computeExpiry({date:'2020-01-01'},'free',now),new Date(now+30*DAY).toISOString(),'過去の開催日でも最低30日');
assert.equal(computeExpiry({date:'2026-12-01'},'paid',now),computeExpiry({date:'2026-12-01'},'free',now),'有料も無料と同じ保存期間');
assert.equal(computeExpiry({date:''},'unknown',now),new Date(now+180*DAY).toISOString(),'不明プランは無料扱い');
r=await call('','POST',{data:{...data,plan:'paid'},plan:'paid'});const e1=await r.json();const k1='events/'+e1.id;
assert.equal(JSON.parse(records.get(k1).value).plan,'free','クライアントからプランを指定できない');
const exp1=e1.expiresAt;r=await call('/'+e1.id,'PUT',{data:{...data,date:'2027-03-01'},revision:1},e1.editToken);const u1=await r.json();
assert.notEqual(u1.expiresAt,exp1);assert.equal(u1.expiresAt,new Date(Date.parse('2027-03-01T23:59:59+09:00')+90*DAY).toISOString(),'開催日変更で期限更新');
const pr=JSON.parse(records.get(k1).value);pr.plan='paid';records.set(k1,{...records.get(k1),value:JSON.stringify(pr)});
r=await call('/'+e1.id,'PUT',{data:{...data,date:'2027-03-01'},revision:2},e1.editToken);assert.equal((await r.json()).expiresAt,u1.expiresAt,'有料も開催日の90日後');assert.equal(JSON.parse(records.get(k1).value).plan,'paid','更新でプランは変わらない');
assert.equal((await(await call('/'+e1.id)).json()).plan,'paid');assert.equal((await(await call(path0)).json()).plan,'free','既定は無料');

// F-17 削除
const dpath='/'+e1.id;
assert.equal((await call(dpath,'DELETE')).status,403);
assert.equal((await call(dpath,'DELETE',undefined,'b'.repeat(48))).status,403);
assert.equal((await call(dpath,'DELETE',undefined,created.editToken)).status,403,'他イベントの編集キーでは削除不可');
r=await call(dpath,'DELETE',undefined,e1.editToken);assert.equal(r.status,200);assert.equal(records.has(k1),false);
assert.equal((await call(dpath)).status,404);assert.equal((await call(dpath,'PUT',{data,revision:3},e1.editToken)).status,404);assert.equal((await call(dpath,'DELETE',undefined,e1.editToken)).status,404);

// IPハッシュに秘密値
const saltV=records.get('config/salt')?.value;assert.ok(saltV&&saltV.length===48,'秘密値を生成・保管');
const plain=createHash('sha256').update('live-shiori:198.51.100.1').digest('hex').slice(0,32),bare=createHash('sha256').update('198.51.100.1').digest('hex').slice(0,32);
assert.ok([...records.keys()].every(k=>!k.includes(plain)&&!k.includes(bare)),'秘密値なしのハッシュでは保存しない');

// CORS（GitHub Pages からの利用）
const P='https://shiori.whathides.co.jp',raw=(path,init)=>api(new Request('https://api.example.workers.dev/api/events'+path,init),env);
r=await raw('',{method:'OPTIONS',headers:{Origin:P,'Access-Control-Request-Method':'POST'}});assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),P);assert.match(r.headers.get('Access-Control-Allow-Headers'),/Authorization/);assert.match(r.headers.get('Access-Control-Allow-Methods'),/DELETE/);
assert.equal((await raw('',{method:'OPTIONS',headers:{Origin:'https://evil.example'}})).status,403);
r=await raw('',{method:'POST',headers:{Origin:P,'Content-Type':'application/json'},body:JSON.stringify({data})});assert.equal(r.status,201);assert.equal(r.headers.get('Access-Control-Allow-Origin'),P);const cid=(await r.json()).id;
r=await raw('/'+cid,{headers:{Origin:P}});assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),P);
r=await raw('/'+'0'.repeat(24),{headers:{Origin:P}});assert.equal(r.status,404);assert.equal(r.headers.get('Access-Control-Allow-Origin'),P,'エラー時もCORSヘッダ');
r=await raw('',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({data})});assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
r=await raw('/'+cid,{headers:{Origin:'https://evil.example'}});assert.equal(r.headers.get('Access-Control-Allow-Origin'),null,'許可外オリジンには読ませない');
const env2={...env,ALLOWED_ORIGINS:'http://localhost:8080, https://shiori.whathides.co.jp'};r=await api(new Request('https://x.dev/api/events',{method:'OPTIONS',headers:{Origin:'http://localhost:8080'}}),env2);assert.equal(r.status,204,'ALLOWED_ORIGINSで上書き');
const broken={BUCKET:{async get(){throw Error('down')},async put(){throw Error('down')}}};r=await api(new Request('https://x.dev/api/events/'+cid,{headers:{Origin:P}}),broken);assert.equal(r.status,500);assert.equal(r.headers.get('Access-Control-Allow-Origin'),P,'500でもCORSヘッダ');

// OPEN時間：未指定の旧データは受け付けて空文字で保存、25時台は受け付け、不正な値は400
{const {open,end,...legacy}=data;const r1=await call('','POST',{data:legacy},undefined,'203.0.113.77');assert.equal(r1.status,201);const r2=await call('/'+(await r1.json()).id);const legacyData=(await r2.json()).data;assert.equal(legacyData.open,'');assert.equal(legacyData.end,'');assert.equal((await call('','POST',{data:{...data,open:'30:00'}},undefined,'203.0.113.78')).status,400);assert.equal((await call('','POST',{data:{...data,open:'25:00',start:'25:30',end:'28:00'}},undefined,'203.0.113.79')).status,201);assert.equal((await call('','POST',{data:{...data,end:'1600'}},undefined,'203.0.113.80')).status,400);}
// 休憩：kind を保存、休憩の転換は0に、不正な kind は400
{const r1=await call('','POST',{data:{...data,acts:[...data.acts,{name:'休憩',play:15,change:5,kind:'break'}]}},undefined,'203.0.113.81');assert.equal(r1.status,201);const a=(await (await call('/'+(await r1.json()).id)).json()).data.acts;assert.equal(a[0].kind,undefined);assert.deepEqual(a[1],{name:'休憩',play:15,change:0,kind:'break'});assert.equal((await call('','POST',{data:{...data,acts:[{name:'x',play:10,change:0,kind:'session'}]}},undefined,'203.0.113.82')).status,400);}
// 演奏0分・転換0分は保存できる
assert.equal((await call('','POST',{data:{...data,acts:[{name:'x',play:0,change:0}]}},undefined,'203.0.113.83')).status,201);
// 参考URL：http(s) のみ保存、javascript: などは400
{const r1=await call('','POST',{data:{...data,acts:[{name:'x',play:10,change:0,url:'https://example.com/a'}]}},undefined,'203.0.113.84');assert.equal(r1.status,201);assert.equal((await (await call('/'+(await r1.json()).id)).json()).data.acts[0].url,'https://example.com/a');assert.equal((await call('','POST',{data:{...data,acts:[{name:'x',play:10,change:0,url:'javascript:alert(1)'}]}},undefined,'203.0.113.85')).status,400);}
// チャージ：整数のみ保存（ドリンク0も保存）、不正値は400
{const r1=await call('','POST',{data:{...data,charge:2500,drinks:1}},undefined,'203.0.113.86');assert.equal(r1.status,201);const d1=(await (await call('/'+(await r1.json()).id)).json()).data;assert.equal(d1.charge,2500);assert.equal(d1.drinks,1);{const r0=await call('','POST',{data:{...data,charge:2500,drinks:0}},undefined,'203.0.113.89');assert.equal((await (await call('/'+(await r0.json()).id)).json()).data.drinks,0);}assert.equal((await call('','POST',{data:{...data,charge:'2500'}},undefined,'203.0.113.87')).status,400);assert.equal((await call('','POST',{data:{...data,drinks:10}},undefined,'203.0.113.88')).status,400);}
console.log('PASS: 既存9項目 + OPEN/END時間, 休憩, 参考URL, チャージ, 不正入力400, 作成回数制限429, IP非保存, 期限切れ404/削除, 定期削除, 保存期間(a)・プラン別, 削除, IPハッシュ秘密値, CORS');
