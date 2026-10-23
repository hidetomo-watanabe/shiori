// セトリ：作成・メンバー閲覧・権限・競合・入力チェック・キーの作り直し・期限切れ・削除
import assert from 'node:assert/strict';
import {api,cleanup,computeExpiry,memberToken,toPublic,connectToken,METRICS,CREATE_LIMIT_PER_HOUR} from '../../worker/api.mjs';
import {records,env,data,noIds,call,sl,sd,setlistGone} from './helpers.mjs';
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
const bads=[{...sd,items:[]},{...sd,items:Array(101).fill(sd.items[0])},{...sd,items:[{...sd.items[0],title:'  '}]},{...sd,items:[{...sd.items[0],sec:0}]},{...sd,items:[{...sd.items[0],sec:14401}]},{...sd,items:[{...sd.items[0],sec:1.5}]},{...sd,items:[{...sd.items[0],kind:'encore'}]},{...sd,items:[{...sd.items[1],artist:'x'}]},{...sd,title:'x'.repeat(101)},{...sd,memo:'x'.repeat(1501)},{...sd,items:[{...sd.items[0],memo:'x'.repeat(501)}]},{...sd,date:'10/24'},{...sd,videos:['http://example.com/v']},{...sd,videos:['javascript:alert(1)']},{...sd,videos:Array(6).fill('https://example.com/v')},{...sd,videos:['https://example.com/'+'x'.repeat(2048)]},{...sd,videos:'https://example.com/v'},{...sd,items:[{...sd.items[0],url:'javascript:alert(1)'}]},{...sd,items:[{...sd.items[1],url:'https://example.com/mc'}]},{...sd,items:[{...sd.items[0],url:'https://example.com/'+'x'.repeat(500)}]}];
for(const bad of bads)assert.equal((await sl('','POST',{data:bad},undefined,'203.0.113.121')).status,400,JSON.stringify(bad).slice(0,80));
for(const bad of ['null','[]',{data:null}])assert.equal((await sl('','POST',bad,undefined,'203.0.113.121')).status,400);
// 曲の参考URL：曲だけ保存、空欄は保存しない、公開用データにも載る
{const items=[{...sd.items[0],url:'https://youtu.be/song'},{...sd.items[3],url:''}];r=await sl('','POST',{data:{...sd,items}},undefined,'203.0.113.152');assert.equal(r.status,201);const saved=JSON.parse(records.get('setlists/'+(await r.json()).id).value).data.items;assert.equal(saved[0].url,'https://youtu.be/song');assert.equal(Object.hasOwn(saved[1],'url'),false);assert.deepEqual(toPublic({...sd,items:saved}).songs,[{title:'夜明け',artist:'原曲さん',url:'https://youtu.be/song'},{title:'二曲目',artist:''}]);}
r=await sl('','POST',{data:{...sd,items:[{kind:'mc',title:'',sec:null,memo:''}]}},undefined,'203.0.113.122');assert.equal(r.status,201,'作成途中（MCのみ）も保存できる');
r=await sl('','POST',{data:{...sd,items:Array(100).fill(sd.items[0]),extra:'x'}},undefined,'203.0.113.123');assert.equal(r.status,201,'100件まで');const big=await r.json();assert.equal(JSON.parse(records.get('setlists/'+big.id).value).data.extra,undefined,'未知の項目は保存しない');
// メンバー用リンクの再発行：旧キーは使えない
r=await sl('/'+c.id+'/keys','POST',{kind:'member'},c.editToken);assert.equal(r.status,200);const k2=await r.json();assert.equal(k2.memberGen,2);assert.equal(k2.memberToken,await memberToken(c.editToken,2));
assert.equal((await sl('/'+c.id,'GET',undefined,c.memberToken)).status,404);assert.equal((await sl('/'+c.id,'GET',undefined,k2.memberToken)).status,200);
// 編集リンクの再発行：旧編集キー・旧メンバーキーとも使えない
r=await sl('/'+c.id+'/keys','POST',{kind:'edit'},c.editToken);assert.equal(r.status,200);const k3=await r.json();assert.match(k3.editToken,/^[a-f0-9]{48}$/);assert.equal(k3.memberToken,await memberToken(k3.editToken,2));
assert.equal((await sl('/'+c.id,'GET',undefined,c.editToken)).status,404);assert.equal((await sl('/'+c.id,'GET',undefined,k2.memberToken)).status,404);assert.equal((await sl('/'+c.id,'GET',undefined,k3.memberToken)).status,200);
assert.equal((await sl('/'+c.id+'/keys','POST',{kind:'admin'},k3.editToken)).status,400);
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
