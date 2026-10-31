// 運営管理の一覧：管理キー必須、入力内容・秘密キー・完全なIDを返さない
import assert from 'node:assert/strict';
import {api,cleanup,computeExpiry,memberToken,toPublic,connectToken,METRICS,CREATE_LIMIT_PER_HOUR} from '../../worker/api.mjs';
import {records,env,data,noIds,call,sl,sd,setlistGone} from './helpers.mjs';
// 運営管理の一覧：管理キー必須。入力内容・秘密キー・完全なIDを返さない
{const adm=(q,token,e=env)=>api(new Request('https://example.com/api/admin/list'+q,{headers:token?{Authorization:'Bearer '+token}:{}}),e);
assert.equal((await adm('?type=events','x')).status,403,'ADMIN_TOKEN 未設定なら拒否');
const aenv={...env,ADMIN_TOKEN:'a'.repeat(64)};
assert.equal((await adm('?type=events',undefined,aenv)).status,403);assert.equal((await adm('?type=events','b'.repeat(64),aenv)).status,403);
assert.equal((await adm('?type=config','a'.repeat(64),aenv)).status,400);
const r1=await sl('','POST',{data:{...sd,title:'秘密のタイトル',memo:'秘密のメモ'}},undefined,'203.0.113.140'),s1=await r1.json();
for(const type of ['events','setlists']){const r=await adm('?type='+type,'a'.repeat(64),aenv);assert.equal(r.status,200);const body=await r.json(),txt=JSON.stringify(body);assert.ok(body.items.length>0);
 for(const secret of ['秘密のタイトル','秘密のメモ','HAND-CLAP','だぁめんず','夜明け',s1.id,s1.editToken,s1.memberToken,'editHash','memberHash','2026-10-24'])assert.ok(!txt.includes(secret),type+'に含めない: '+secret);
 assert.ok(body.items.every(i=>/^[a-f0-9]{6}$/.test(i.id)),'IDは先頭6文字のみ');}
const st=(await(await adm('?type=setlists','a'.repeat(64),aenv)).json()).items.find(i=>i.id===s1.id.slice(0,6));assert.equal(st.songs,2);assert.equal(st.published,false);
assert.equal((await api(new Request('https://example.com/api/admin/list?type=events',{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(64)}}),aenv)).status,405);}
// 運営管理：プランの切り替え（管理キー必須・画面からのみ・先頭6文字で指定・保存期間を計算し直す・revision は変えない）
{const aenv={...env,ADMIN_TOKEN:'a'.repeat(64)},K='a'.repeat(64);
const plan=(body,{token=K,origin='https://example.com',method='POST',e=aenv}={})=>api(new Request('https://example.com/api/admin/plan',{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(origin?{Origin:origin}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})}),e);
const s=await(await sl('','POST',{data:sd},undefined,'203.0.113.141')).json(),id=s.id.slice(0,6),key='setlists/'+s.id,rec=()=>JSON.parse(records.get(key).value);
const before=rec();
assert.equal((await plan({type:'setlists',id,plan:'paid'},{token:'b'.repeat(64)})).status,403,'管理キーが違えば拒否');
assert.equal((await plan({type:'setlists',id,plan:'paid'},{e:env})).status,403,'ADMIN_TOKEN 未設定なら拒否');
assert.equal((await plan({type:'setlists',id,plan:'paid'},{origin:'https://evil.example'})).status,403,'他のサイトからは拒否');
assert.equal((await plan(undefined,{method:'GET'})).status,405);
for(const b of [{type:'accounts',id,plan:'paid'},{type:'setlists',id:s.id.slice(0,10),plan:'paid'},{type:'setlists',id,plan:'gold'},{type:'setlists',id:'ZZZZZZ',plan:'paid'}])assert.equal((await plan(b)).status,400,'不正な指定は拒否: '+JSON.stringify(b));
assert.equal((await plan({type:'events',id,plan:'paid'})).status,404,'種類が違えば見つからない');
let r=await plan({type:'setlists',id,plan:'paid'});assert.equal(r.status,200);let b=await r.json();
assert.equal(b.plan,'paid');assert.equal(rec().plan,'paid');assert.equal(rec().revision,before.revision,'revision は変えない');assert.equal(rec().updatedAt,before.updatedAt,'updatedAt は変えない');
assert.equal(b.expiresAt,null,'paid は自動削除なし');assert.equal(rec().expiresAt,null);assert.equal(records.get(key).customMetadata.expiresAt,'');
assert.equal((await cleanup(env)).setlists>=0,true);assert.ok(records.has(key),'paid は定期削除で消えない');
assert.equal((await(await sl('/'+s.id,'PUT',{data:sd,revision:before.revision},s.editToken)).json()).revision,before.revision+1,'切り替え後も編集中の人はそのまま保存できる');assert.equal(rec().plan,'paid','保存してもプランは変わらない');
r=await plan({type:'setlists',id,plan:'free'});b=await r.json();assert.equal(b.plan,'free');assert.equal(rec().plan,'free');assert.equal(b.expiresAt,before.expiresAt,'free に戻すと元の保存期限');
// 古いものを free に戻しても、すぐには消さない（今から最低30日）
{const old=JSON.parse(records.get(key).value);records.set(key,{...records.get(key),value:JSON.stringify({...old,plan:'paid',expiresAt:null,data:{...old.data,date:'2020-01-01'},updatedAt:'2020-01-01T00:00:00.000Z'})});
 const t=Date.now();b=await(await plan({type:'setlists',id,plan:'free'})).json();assert.ok(Date.parse(b.expiresAt)>=t+29*864e5,'今から最低30日は残す');
 records.set(key,{...records.get(key),value:JSON.stringify(old)});}
// 同じ先頭6文字が複数あるときは切り替えない
const dup='setlists/'+id+'f'.repeat(18);records.set(dup,{value:JSON.stringify({...before}),etag:'d'});assert.equal((await plan({type:'setlists',id,plan:'paid'})).status,409);records.delete(dup);
// 期限切れは切り替えない
records.set(key,{...records.get(key),value:JSON.stringify({...rec(),expiresAt:'2020-01-01T00:00:00.000Z'})});assert.equal((await plan({type:'setlists',id,plan:'paid'})).status,404);}
// 管理用マイキー：管理キーで登録・解除。登録したマイキーの照合用キーで一覧・利用状況・プラン切り替えができる。登録・解除はマイキーではできない
{const K='a'.repeat(64),aenv={...env,ADMIN_TOKEN:K},acct='c'.repeat(48),other='d'.repeat(48);
const req=(path,{token,method='GET',body,e=aenv}={})=>api(new Request('https://example.com/api/admin/'+path,{method,headers:{'Content-Type':'application/json',Origin:'https://example.com',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})}),e);
const mk=(body,token=K)=>req('mykeys',{token,method:'POST',body});
assert.equal((await req('stats',{token:acct})).status,403,'未登録のマイキーは拒否');
assert.equal((await mk({action:'add',account:acct},acct)).status,403,'マイキーでは登録できない');
for(const b of [{action:'add'},{action:'add',account:'x'},{action:'grant',account:acct}])assert.equal((await mk(b)).status,400);
let b=await(await mk({action:'status',account:acct})).json();assert.deepEqual(b,{count:0,registered:false});
b=await(await mk({action:'add',account:acct})).json();assert.deepEqual(b,{count:1,registered:true});
b=await(await mk({action:'add',account:acct})).json();assert.equal(b.count,1,'同じマイキーは二重に登録しない');
assert.ok(!records.get('admin/accounts').value.includes(acct),'照合用キーそのものは保存しない');
let r=await req('stats',{token:acct});assert.equal(r.status,200);assert.equal((await r.json()).role,'mykey');
assert.equal((await(await req('stats',{token:K})).json()).role,'master');
assert.equal((await req('list?type=events',{token:acct})).status,200);
assert.equal((await req('stats',{token:other})).status,403,'別のマイキーは拒否');
assert.equal((await mk({action:'remove',account:acct},acct)).status,403,'マイキーでは解除できない');
assert.equal((await mk({action:'clear'},acct)).status,403);
assert.equal((await req('stats',{token:acct,e:{...env}})).status,200,'管理キー未設定でも登録済みマイキーは使える');
assert.equal((await mk({action:'add',account:other},acct)).status,403);
b=await(await mk({action:'add',account:other})).json();assert.equal(b.count,2);
b=await(await mk({action:'remove',account:acct})).json();assert.deepEqual(b,{count:1,registered:false});assert.equal((await req('stats',{token:acct})).status,403,'解除したら使えない');
b=await(await mk({action:'clear'})).json();assert.equal(b.count,0);assert.equal((await req('stats',{token:other})).status,403);
const cl=await cleanup(env);assert.ok(records.has('admin/accounts'),'定期削除で消さない');}
// 自分の判定（whoami）と、完全なIDでのプラン切り替え（「作ったもの」から）、セトリの編集者にはプランを返す
{const K='a'.repeat(64),aenv={...env,ADMIN_TOKEN:K},acct='e'.repeat(48);
const req=(path,{token,method='GET',body}={})=>api(new Request('https://example.com/api/admin/'+path,{method,headers:{'Content-Type':'application/json',Origin:'https://example.com',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})}),aenv);
assert.equal((await req('whoami',{token:acct})).status,403,'未登録のマイキーは管理者ではない');
await req('mykeys',{token:K,method:'POST',body:{action:'add',account:acct}});
assert.deepEqual(await(await req('whoami',{token:acct})).json(),{role:'mykey'});assert.deepEqual(await(await req('whoami',{token:K})).json(),{role:'master'});
const s=await(await sl('','POST',{data:sd},undefined,'203.0.113.142')).json();
assert.equal((await(await sl('/'+s.id,'GET',undefined,s.editToken)).json()).plan,'free','編集者にはプランを返す');assert.equal((await(await sl('/'+s.id,'GET',undefined,s.memberToken)).json()).plan,undefined,'メンバーには返さない');
let r=await req('plan',{token:acct,method:'POST',body:{type:'setlists',id:s.id,plan:'paid'}});assert.equal(r.status,200,'完全なIDでも切り替えられる');assert.equal((await r.json()).expiresAt,null);
assert.equal((await(await sl('/'+s.id,'GET',undefined,s.editToken)).json()).plan,'paid');
assert.equal((await req('plan',{token:acct,method:'POST',body:{type:'setlists',id:'0'.repeat(24),plan:'paid'}})).status,404);
assert.equal((await req('plan',{token:acct,method:'POST',body:{type:'setlists',id:s.id.slice(0,12),plan:'paid'}})).status,400,'6文字・24文字以外は拒否');
await req('mykeys',{token:K,method:'POST',body:{action:'clear'}});assert.equal((await req('whoami',{token:acct})).status,403);}
