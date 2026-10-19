import assert from 'node:assert/strict';
import {api,cleanup,computeExpiry,memberToken,toPublic,connectToken,CREATE_LIMIT_PER_HOUR} from '../worker/api.mjs';
import {createHash} from 'node:crypto';
const records=new Map();let etag=0;
const env={BUCKET:{
 async get(k){let r=records.get(k);return r?{etag:r.etag,async json(){return JSON.parse(r.value)},async text(){return r.value}}:null},
 async put(k,value,opt){if(opt?.onlyIf&&records.get(k)?.etag!==opt.onlyIf.etagMatches)return null;records.set(k,{value,etag:String(++etag),customMetadata:opt?.customMetadata});return {etag:String(etag)}},
 async delete(k){for(const key of [].concat(k))records.delete(key)},
 async list({prefix}){return {objects:[...records].filter(([k])=>k.startsWith(prefix)).map(([key,r])=>({key,customMetadata:r.customMetadata})),truncated:false}}
}};
const data={title:'日本語ライブ',date:'2026-10-24',open:'13:30',start:'14:00',end:'16:00',venue:'HAND-CLAP',note:'こんにちは',acts:[{name:'だぁめんず',play:25,change:10}]};
const noIds=d=>({...d,acts:d.acts.map(({id,...a})=>a)});
const call=(path,method='GET',body,token,ip)=>api(new Request('https://example.com/api/events'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(ip?{'CF-Connecting-IP':ip}:{})},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),env);

// 既存の動作
let r=await call('','POST',{data});assert.equal(r.status,201);let created=await r.json();let path='/'+created.id;const r0=await call('','POST',{data});const path0='/'+(await r0.json()).id;assert.ok(created.expiresAt);r=await call(path);let read=await r.json();assert.deepEqual(noIds(read.data),data);assert.ok(read.data.acts.every(a=>/^[a-f0-9]{12}$/.test(a.id)),'出演枠IDを採番');assert.equal(read.editToken,undefined);assert.equal(read.editHash,undefined);
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
const result=await cleanup(env);assert.deepEqual(result,{events:1,setlists:0,ratelimit:1});
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
{const r1=await call('','POST',{data:{...data,acts:[...data.acts,{name:'休憩',play:15,change:5,kind:'break'}]}},undefined,'203.0.113.81');assert.equal(r1.status,201);const a=(await (await call('/'+(await r1.json()).id)).json()).data.acts;assert.equal(a[0].kind,undefined);assert.deepEqual(noIds({acts:a}).acts[1],{name:'休憩',play:15,change:0,kind:'break'});assert.equal((await call('','POST',{data:{...data,acts:[{name:'x',play:10,change:0,kind:'session'}]}},undefined,'203.0.113.82')).status,400);}
// 演奏0分・転換0分は保存できる
assert.equal((await call('','POST',{data:{...data,acts:[{name:'x',play:0,change:0}]}},undefined,'203.0.113.83')).status,201);
// 参考URL：http(s) のみ保存、javascript: などは400
{const r1=await call('','POST',{data:{...data,acts:[{name:'x',play:10,change:0,url:'https://example.com/a'}]}},undefined,'203.0.113.84');assert.equal(r1.status,201);assert.equal((await (await call('/'+(await r1.json()).id)).json()).data.acts[0].url,'https://example.com/a');assert.equal((await call('','POST',{data:{...data,acts:[{name:'x',play:10,change:0,url:'javascript:alert(1)'}]}},undefined,'203.0.113.85')).status,400);}
// チャージ：整数のみ保存（ドリンク0も保存）、不正値は400
{const r1=await call('','POST',{data:{...data,charge:2500,drinks:1}},undefined,'203.0.113.86');assert.equal(r1.status,201);const d1=(await (await call('/'+(await r1.json()).id)).json()).data;assert.equal(d1.charge,2500);assert.equal(d1.drinks,1);{const r0=await call('','POST',{data:{...data,charge:2500,drinks:0}},undefined,'203.0.113.89');assert.equal((await (await call('/'+(await r0.json()).id)).json()).data.drinks,0);}assert.equal((await call('','POST',{data:{...data,charge:'2500'}},undefined,'203.0.113.87')).status,400);assert.equal((await call('','POST',{data:{...data,drinks:10}},undefined,'203.0.113.88')).status,400);}

// セトリ（段階1）
{const sl=(path,method='GET',body,token,ip)=>api(new Request('https://example.com/api/setlists'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(ip?{'CF-Connecting-IP':ip}:{})},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),env);
const sd={title:'10/24 HAND-CLAP',artist:'だぁめんず',date:'2026-10-24',venue:'HAND-CLAP',comment:'ありがとうございました',memo:'集合 12:00',videos:[],items:[{kind:'song',title:'夜明け',artist:'原曲さん',sec:210,memo:'カポ2'},{kind:'mc',title:'MC',sec:null,memo:'メンバー紹介'},{kind:'break',title:'休憩',sec:300,memo:''},{kind:'song',title:'二曲目',artist:'',sec:null,memo:''}]};
// 作成：キーを返し、ハッシュのみ保存
let r=await sl('','POST',{data:sd},undefined,'203.0.113.120');assert.equal(r.status,201);const c=await r.json();assert.match(c.id,/^[a-f0-9]{24}$/);assert.match(c.editToken,/^[a-f0-9]{48}$/);assert.equal(c.memberToken,await memberToken(c.editToken,1),'メンバーキーは編集キーから導出');
const key='setlists/'+c.id,stored=records.get(key).value;assert.ok(!stored.includes(c.editToken)&&!stored.includes(c.memberToken),'キーを平文で保存しない');assert.ok(records.get(key).customMetadata.expiresAt,'定期削除用の期限');
// 未認証では内部データを取得できず、存在しないIDと区別できない
const missing=await(await sl('/'+'0'.repeat(24))).json();
for(const res of [await sl('/'+c.id),await sl('/'+c.id,'GET',undefined,'f'.repeat(48)),await sl('/'+c.id+'/public')]){assert.equal(res.status,404);assert.deepEqual(await res.json(),missing)}
assert.equal((await sl('/'+'0'.repeat(24)+'/public')).status,404);
// メンバー閲覧：内部の最新内容を読めるが、編集用の情報は返さない
r=await sl('/'+c.id,'GET',undefined,c.memberToken);assert.equal(r.status,200);let m=await r.json();assert.deepEqual(m.data,sd);assert.equal(m.role,'member');assert.equal(m.memberGen,undefined);assert.equal(m.editToken,undefined);assert.equal(m.editHash,undefined);
r=await sl('/'+c.id,'GET',undefined,c.editToken);m=await r.json();assert.equal(m.role,'edit');assert.equal(m.memberGen,1);assert.equal(m.editHash,undefined);
// メンバー権限では変更・削除・再発行できない
assert.equal((await sl('/'+c.id,'PUT',{data:sd,revision:1},c.memberToken)).status,403);
assert.equal((await sl('/'+c.id,'DELETE',undefined,c.memberToken)).status,403);
assert.equal((await sl('/'+c.id+'/keys','POST',{kind:'member'},c.memberToken)).status,403);
assert.equal((await sl('/'+c.id,'PUT',{data:sd,revision:1})).status,404);
// 編集・競合
const sd2={...sd,title:'更新後'};r=await sl('/'+c.id,'PUT',{data:sd2,revision:1},c.editToken);assert.equal(r.status,200);assert.equal((await r.json()).revision,2);
assert.equal((await(await sl('/'+c.id,'GET',undefined,c.memberToken)).json()).data.title,'更新後','メンバーは最新の保存内容を見る');
assert.equal((await sl('/'+c.id,'PUT',{data:sd,revision:1},c.editToken)).status,409);
const both=await Promise.all([sl('/'+c.id,'PUT',{data:sd,revision:2},c.editToken),sl('/'+c.id,'PUT',{data:sd2,revision:2},c.editToken)]);assert.deepEqual(both.map(x=>x.status).sort(),[200,409]);
// 入力チェック
const bads=[{...sd,items:[]},{...sd,items:Array(101).fill(sd.items[0])},{...sd,items:[{...sd.items[0],title:'  '}]},{...sd,items:[{...sd.items[0],sec:0}]},{...sd,items:[{...sd.items[0],sec:14401}]},{...sd,items:[{...sd.items[0],sec:1.5}]},{...sd,items:[{...sd.items[0],kind:'encore'}]},{...sd,items:[{...sd.items[1],artist:'x'}]},{...sd,title:'x'.repeat(101)},{...sd,memo:'x'.repeat(1501)},{...sd,items:[{...sd.items[0],memo:'x'.repeat(501)}]},{...sd,date:'10/24'},{...sd,videos:['http://example.com/v']},{...sd,videos:['javascript:alert(1)']},{...sd,videos:Array(6).fill('https://example.com/v')},{...sd,videos:['https://example.com/'+'x'.repeat(2048)]},{...sd,videos:'https://example.com/v'}];
for(const bad of bads)assert.equal((await sl('','POST',{data:bad},undefined,'203.0.113.121')).status,400,JSON.stringify(bad).slice(0,80));
for(const bad of ['null','[]',{data:null}])assert.equal((await sl('','POST',bad,undefined,'203.0.113.121')).status,400);
r=await sl('','POST',{data:{...sd,items:[{kind:'mc',title:'',sec:null,memo:''}]}},undefined,'203.0.113.122');assert.equal(r.status,201,'作成途中（MCのみ）も保存できる');
r=await sl('','POST',{data:{...sd,items:Array(100).fill(sd.items[0]),extra:'x'}},undefined,'203.0.113.123');assert.equal(r.status,201,'100件まで');const big=await r.json();assert.equal(JSON.parse(records.get('setlists/'+big.id).value).data.extra,undefined,'未知の項目は保存しない');
// メンバー用リンクの再発行：旧キーは使えない
r=await sl('/'+c.id+'/keys','POST',{kind:'member'},c.editToken);assert.equal(r.status,200);const k2=await r.json();assert.equal(k2.memberGen,2);assert.equal(k2.memberToken,await memberToken(c.editToken,2));
assert.equal((await sl('/'+c.id,'GET',undefined,c.memberToken)).status,404);assert.equal((await sl('/'+c.id,'GET',undefined,k2.memberToken)).status,200);
// 編集リンクの再発行：旧編集キー・旧メンバーキーとも使えない
r=await sl('/'+c.id+'/keys','POST',{kind:'edit'},c.editToken);assert.equal(r.status,200);const k3=await r.json();assert.match(k3.editToken,/^[a-f0-9]{48}$/);assert.equal(k3.memberToken,await memberToken(k3.editToken,2));
assert.equal((await sl('/'+c.id,'GET',undefined,c.editToken)).status,404);assert.equal((await sl('/'+c.id,'GET',undefined,k2.memberToken)).status,404);assert.equal((await sl('/'+c.id,'GET',undefined,k3.memberToken)).status,200);
assert.equal((await sl('/'+c.id+'/keys','POST',{kind:'admin'},k3.editToken)).status,400);
// 動画リンク未指定の旧データは空配列で保存
{const {videos,...legacy}=sd;r=await sl('','POST',{data:legacy},undefined,'203.0.113.125');const l=await r.json();assert.deepEqual((await(await sl('/'+l.id,'GET',undefined,l.editToken)).json()).data.videos,[]);}
// 公開（段階2）
{r=await sl('','POST',{data:{...sd,videos:['https://youtu.be/abc']}},undefined,'203.0.113.126');const p=await r.json(),P='/'+p.id,pub=(body,t=p.editToken)=>sl(P+'/publish','POST',body,t);
const status=async()=>(await(await sl(P,'GET',undefined,p.editToken)).json()).publication;
assert.deepEqual(await status(),{published:false});assert.equal((await sl(P+'/public')).status,404,'公開前は公開APIで取得できない');
assert.equal((await pub({action:'publish',revision:1},p.memberToken)).status,403,'メンバーは公開できない');
assert.equal((await sl(P+'/publish','POST',{action:'publish',revision:1})).status,404,'キーなしでは公開できない');
assert.equal((await pub({action:'publish',revision:0},p.editToken)).status,409,'古いrevisionでは公開しない');
assert.equal((await pub({action:'open'})).status,400);
r=await pub({action:'publish',revision:1});assert.equal(r.status,200);const s1=await r.json();assert.equal(s1.published,true);assert.equal(s1.publishedRevision,1);assert.ok(s1.firstPublishedAt);
r=await sl(P+'/public');assert.equal(r.status,200);const pd=await r.json(),txt=JSON.stringify(pd);
assert.deepEqual(pd.data,{title:sd.title,artist:sd.artist,date:sd.date,venue:sd.venue,comment:sd.comment,videos:['https://youtu.be/abc'],songs:[{title:'夜明け',artist:'原曲さん'},{title:'二曲目',artist:''}]});
for(const secret of ['集合 12:00','カポ2','メンバー紹介','休憩',p.editToken,p.memberToken,'editHash','memberHash','"sec"'])assert.ok(!txt.includes(secret),'公開APIに含めない: '+secret);
const storedPub=JSON.stringify(JSON.parse(records.get('setlists/'+p.id).value).publication);for(const secret of ['集合 12:00','カポ2','メンバー紹介'])assert.ok(!storedPub.includes(secret),'公開用保存データに含めない: '+secret);
// 公開後の内部編集は公開内容に反映しない
r=await sl(P,'PUT',{data:{...sd,videos:['https://youtu.be/abc'],title:'直した',items:[{...sd.items[0],title:'差し替え曲'}]},revision:1},p.editToken);assert.equal(r.status,200);
assert.equal((await(await sl(P+'/public')).json()).data.title,sd.title,'公開更新までは公開内容を維持');const s2=await status();assert.equal(s2.published,true);assert.equal(s2.publishedRevision,1,'未反映の変更を判定できる');
r=await sl(P,'PUT',{data:sd,revision:2,publication:null},p.editToken);assert.equal(r.status,200);assert.equal((await status()).published,true,'内部保存で公開状態は変わらない');
// 公開内容を更新
r=await pub({action:'publish',revision:3});assert.equal(r.status,200);const s3=await r.json();assert.equal(s3.publishedRevision,3);assert.equal(s3.firstPublishedAt,s1.firstPublishedAt);
assert.equal((await(await sl(P+'/public')).json()).data.videos.length,0);assert.equal(JSON.parse(records.get('setlists/'+p.id).value).publication.version,2);
// 公開停止：公開APIは未存在と同じ応答、内部データは残る。再公開は同じURL
r=await pub({action:'unpublish'});assert.equal(r.status,200);r=await sl(P+'/public');assert.equal(r.status,404);assert.deepEqual(await r.json(),missing);
assert.equal((await status()).published,false);assert.equal((await sl(P,'GET',undefined,p.memberToken)).status,200,'内部セトリは保持');
assert.equal((await pub({action:'unpublish'})).status,200,'停止中の停止も成功扱い');
r=await pub({action:'publish',revision:3});assert.equal(r.status,200);assert.equal((await sl(P+'/public')).status,200,'同じ公開URLで再公開');assert.equal(JSON.parse(records.get('setlists/'+p.id).value).publication.version,3);
// 曲のないセトリは公開できない
r=await sl('','POST',{data:{...sd,items:[{kind:'mc',title:'MC',sec:null,memo:''}]}},undefined,'203.0.113.127');const nm=await r.json();assert.equal((await sl('/'+nm.id+'/publish','POST',{action:'publish',revision:1},nm.editToken)).status,400);
// 同時の公開更新と内部保存：片方だけ成功し、古い内容を公開しない
const race=await Promise.all([pub({action:'publish',revision:3}),sl(P,'PUT',{data:{...sd,title:'競合'},revision:3},p.editToken)]);assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
// 削除後は公開APIも404
assert.equal((await sl(P,'DELETE',undefined,p.editToken)).status,200);assert.equal((await sl(P+'/public')).status,404);
assert.deepEqual(toPublic({...sd,items:[{kind:'mc',title:'x',sec:1,memo:'m'}]}).songs,[]);}
// 紐づけ（段階3）
{const ev=(path,method='GET',body,token)=>call(path,method,body,token,'203.0.113.130');
r=await ev('','POST',{data:{...data,acts:[{name:'A',play:25,change:10},{name:'休憩',play:10,change:0,kind:'break'},{name:'B',play:20,change:0}]}});const E=await r.json(),EP='/'+E.id,[sA,sBreak,sB]=E.ids;
assert.equal(E.ids.length,3);assert.deepEqual(Object.keys(E.manage).sort(),[sA,sB].sort(),'休憩は紐づけ対象外');
const slot=(sid,action,method,token,body)=>call(EP+'/slots/'+sid+'/'+action,method,body,token);
// 紐づけ用キー：主催者のみ発行。編集キーから導出
assert.equal((await slot(sA,'connect-key','POST')).status,403);assert.equal((await slot(sBreak,'connect-key','POST',E.editToken)).status,404,'休憩には発行しない');
r=await slot(sA,'connect-key','POST',E.editToken);const ck=await r.json();assert.equal(ck.connectGen,1);assert.equal(ck.connectToken,await connectToken(E.editToken,sA,1));
assert.ok(!records.get('events'+EP).value.includes(ck.connectToken),'紐づけ用キーを平文で保存しない');
r=await slot(sA,'connect','GET',ck.connectToken);assert.equal(r.status,200);const info=await r.json();assert.equal(info.slot.name,'A');assert.equal(info.taken,false);
assert.equal((await slot(sA,'connect','GET',E.editToken)).status,404);assert.equal((await slot(sB,'connect','GET',ck.connectToken)).status,404,'別の出演枠のキーは使えない');
// セトリ2つ
const mk=async title=>{const r=await sl('','POST',{data:{...sd,title,items:[{kind:'song',title:'S',artist:'',sec:1800,memo:'内部メモ'}]}},undefined,'203.0.113.131');return r.json()};
const L1=await mk('セトリ1'),L2=await mk('セトリ2'),link=(L,body,t=L.editToken)=>sl('/'+L.id+'/link','POST',body,t);
const body={eventId:E.id,slotId:sA,connectToken:ck.connectToken};
// 両方の権限が必要
assert.equal((await link(L1,body,L1.memberToken)).status,403,'メンバー権限では紐づけ不可');
assert.equal((await link(L1,{...body,connectToken:'c'.repeat(48)})).status,404,'紐づけ用キーなしでは不可');
assert.equal((await link(L1,{...body,connectToken:E.editToken})).status,404,'イベント編集キーでは紐づけ不可');
assert.equal((await link(L1,{...body,slotId:sBreak})).status,404);
// 紐づけ成功
r=await link(L1,{...body,backLink:false});assert.equal(r.status,200);let li=(await r.json()).link;assert.equal(li.valid,true);assert.equal(li.slot.play,25);assert.equal(li.event.title,data.title);
assert.equal((await link(L1,body)).status,200,'同じ出演枠への再実行は成功扱い');
// 二重紐づけを拒否（出演枠側・セトリ側）
assert.equal((await link(L2,body)).status,409,'出演枠に別セトリは不可');
const ckB=await(await slot(sB,'connect-key','POST',E.editToken)).json();assert.equal((await link(L1,{eventId:E.id,slotId:sB,connectToken:ckB.connectToken})).status,409,'1セトリ1出演枠');
assert.equal((await(await slot(sA,'connect','GET',ck.connectToken)).json()).taken,true);
// 公開前：イベントの閲覧APIにも編集APIにも内容を出さない
let evr=await(await call(EP)).json();assert.deepEqual(evr.setlists,{});assert.equal(evr.manage,undefined);assert.ok(!JSON.stringify(evr).includes(L1.id)&&!JSON.stringify(evr).includes('セトリ1'));
evr=await(await call(EP,'GET',undefined,E.editToken)).json();assert.deepEqual(evr.manage[sA],{connectGen:1,linked:true,published:false});const etxt=JSON.stringify(evr);for(const x of ['セトリ1','内部メモ',L1.id])assert.ok(!etxt.includes(x),'イベント編集APIに公開前の内容を含めない: '+x);
// メンバー画面：持ち時間を比較できる
assert.equal((await(await sl('/'+L1.id,'GET',undefined,L1.memberToken)).json()).link.slot.play,25);
// 公開後だけイベント側に導線
assert.equal((await sl('/'+L1.id+'/publish','POST',{action:'publish',revision:1},L1.editToken)).status,200);
evr=await(await call(EP)).json();assert.deepEqual(evr.setlists,{[sA]:{id:L1.id,title:'セトリ1'}});
let pubr=await(await sl('/'+L1.id+'/public')).json();assert.equal(pubr.event,undefined,'戻りリンクは既定OFF');
r=await link(L1,{backLink:true});assert.equal(r.status,200);pubr=await(await sl('/'+L1.id+'/public')).json();assert.deepEqual(pubr.event,{id:E.id,title:data.title});
assert.equal((await link(L1,{backLink:'yes'})).status,400);
// 公開停止で導線が消える
await sl('/'+L1.id+'/publish','POST',{action:'unpublish'},L1.editToken);assert.deepEqual((await(await call(EP)).json()).setlists,{});
await sl('/'+L1.id+'/publish','POST',{action:'publish',revision:1},L1.editToken);
// 出演枠の並べ替え・追加後も紐づけは同じ枠に残る
const cur=(await(await call(EP)).json()).data;r=await call(EP,'PUT',{data:{...cur,acts:[cur.acts[2],{name:'C',play:10,change:0},cur.acts[1],cur.acts[0]]},revision:1},E.editToken);assert.equal(r.status,200);const saved=await r.json();
assert.equal(saved.ids[3],sA);assert.equal(saved.ids[0],sB);assert.match(saved.ids[1],/^[a-f0-9]{12}$/);
assert.deepEqual((await(await call(EP)).json()).setlists,{[sA]:{id:L1.id,title:'セトリ1'}},'並べ替えても同じ出演枠');
// 主催者による解除：イベント側の導線が消え、セトリ側は解除を検知。セトリ本体は残る
r=await slot(sA,'link','DELETE',L1.editToken);assert.equal(r.status,403,'セトリ編集キーではイベント側を操作できない');
r=await slot(sA,'link','DELETE',E.editToken);assert.equal(r.status,200);assert.deepEqual((await(await call(EP)).json()).setlists,{});
assert.deepEqual((await(await sl('/'+L1.id,'GET',undefined,L1.editToken)).json()).link,{valid:false});assert.equal((await(await sl('/'+L1.id+'/public')).json()).event,undefined,'解除後は戻りリンクも消える');
// 解除後は別のセトリを紐づけられる。片側だけ残った情報で拒否しない
assert.equal((await link(L2,body)).status,200);assert.equal((await link(L1,body)).status,409);
// セトリ側からの解除：イベント側も外れる
r=await sl('/'+L2.id+'/link','DELETE',undefined,L2.editToken);assert.equal(r.status,200);assert.equal(JSON.parse(records.get('events'+EP).value).links[sA],undefined);assert.equal((await(await sl('/'+L2.id,'GET',undefined,L2.editToken)).json()).link,null);
assert.equal((await sl('/'+L2.id+'/link','DELETE',undefined,L2.memberToken)).status,403);
// 紐づけ用キーの再発行で旧キーは無効
const ck2=await(await slot(sA,'connect-key','POST',E.editToken)).json();assert.equal(ck2.connectGen,2);assert.equal((await slot(sA,'connect','GET',ck.connectToken)).status,404);assert.equal((await link(L1,body)).status,404);
assert.equal((await link(L1,{...body,connectToken:ck2.connectToken})).status,200);
// 出演枠の削除：紐づけ・キーを外し、セトリは残る
const cur2=(await(await call(EP)).json()).data;r=await call(EP,'PUT',{data:{...cur2,acts:cur2.acts.filter(a=>a.id!==sA)},revision:2},E.editToken);assert.equal(r.status,200);
const er=JSON.parse(records.get('events'+EP).value);assert.equal(er.links[sA],undefined);assert.equal(er.connect[sA],undefined);
assert.deepEqual((await(await sl('/'+L1.id,'GET',undefined,L1.editToken)).json()).link,{valid:false});assert.equal((await sl('/'+L1.id,'GET',undefined,L1.memberToken)).status,200,'セトリ本体は残る');
// 出演枠IDを戻しても（別端末の古い下書き等）、外れた紐づけは復活しない
r=await call(EP,'PUT',{data:cur2,revision:3},E.editToken);assert.equal(r.status,200);assert.deepEqual((await(await call(EP)).json()).setlists,{});
// イベント削除：セトリは残り、解除を検知
await sl('/'+L1.id+'/link','DELETE',undefined,L1.editToken);const ck3=await(await slot(sB,'connect-key','POST',E.editToken)).json();assert.equal((await link(L1,{eventId:E.id,slotId:sB,connectToken:ck3.connectToken})).status,200);
assert.equal((await call(EP,'DELETE',undefined,E.editToken)).status,200);
assert.deepEqual((await(await sl('/'+L1.id,'GET',undefined,L1.editToken)).json()).link,{valid:false});assert.equal((await sl('/'+L1.id+'/public')).status,200,'公開セトリは残る');
// セトリ削除：イベント側の導線も外れる
r=await ev('','POST',{data});const E2=await r.json(),s2=E2.ids[0],ck4=await(await call('/'+E2.id+'/slots/'+s2+'/connect-key','POST',undefined,E2.editToken)).json();
assert.equal((await link(L2,{eventId:E2.id,slotId:s2,connectToken:ck4.connectToken})).status,200);await sl('/'+L2.id+'/publish','POST',{action:'publish',revision:1},L2.editToken);
assert.equal(Object.keys((await(await call('/'+E2.id)).json()).setlists).length,1);
assert.equal((await sl('/'+L2.id,'DELETE',undefined,L2.editToken)).status,200);assert.deepEqual((await(await call('/'+E2.id)).json()).setlists,{});
// 複製は紐づけを引き継がない（POSTは link を受け付けない）
r=await sl('','POST',{data:{...sd},link:{eventId:E2.id,slotId:s2}},undefined,'203.0.113.132');const cp=await r.json();assert.equal((await(await sl('/'+cp.id,'GET',undefined,cp.editToken)).json()).link,null);}
// 期限切れ・定期削除
const exp=JSON.parse(records.get('setlists/'+big.id).value);exp.expiresAt=new Date(Date.now()-1000).toISOString();records.set('setlists/'+big.id,{...records.get('setlists/'+big.id),value:JSON.stringify(exp),customMetadata:{expiresAt:exp.expiresAt}});
assert.equal((await cleanup(env)).setlists,1);assert.equal(records.has('setlists/'+big.id),false);
// 削除：全リンクが無効
assert.equal((await sl('/'+c.id,'DELETE',undefined,c.editToken)).status,404);
r=await sl('/'+c.id,'DELETE',undefined,k3.editToken);assert.equal(r.status,200);assert.equal(records.has(key),false);
for(const t of [k3.editToken,k3.memberToken])assert.equal((await sl('/'+c.id,'GET',undefined,t)).status,404);
// 作成回数はイベントと共通の上限
for(let i=0;i<CREATE_LIMIT_PER_HOUR;i++)await sl('','POST',{data:sd},undefined,'203.0.113.124');assert.equal((await sl('','POST',{data:sd},undefined,'203.0.113.124')).status,429);
// CORS：許可外オリジンからの作成は拒否
assert.equal((await api(new Request('https://x.dev/api/setlists',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({data:sd})}),env)).status,403);
}
console.log('PASS: 既存9項目 + OPEN/END時間, 休憩, 参考URL, チャージ, 不正入力400, 作成回数制限429, IP非保存, 期限切れ404/削除, 定期削除, 保存期間(a)・プラン別, 削除, IPハッシュ秘密値, CORS, セトリ（作成・メンバー閲覧・権限・競合・入力チェック・キー再発行・期限切れ・削除・公開・公開更新・公開停止・動画リンク）, 紐づけ（両権限・二重紐づけ拒否・並べ替え・解除・削除・公開時のみ導線・戻りリンク）');
