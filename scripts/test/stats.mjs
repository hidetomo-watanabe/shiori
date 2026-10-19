// 利用計測：操作の種類別・日別の回数、失敗しても本処理を止めない、約90日で削除
import assert from 'node:assert/strict';
import {api,cleanup,computeExpiry,memberToken,toPublic,connectToken,METRICS,CREATE_LIMIT_PER_HOUR} from '../../worker/api.mjs';
import {records,env,data,noIds,call,sl,sd,setlistGone} from './helpers.mjs';
// 利用計測：操作ごとの日別回数。管理キーで取得。IP・キー・入力内容を記録しない
{const aenv={...env,ADMIN_TOKEN:'a'.repeat(64)},stats=async()=>(await(await api(new Request('https://example.com/api/admin/stats',{headers:{Authorization:'Bearer '+'a'.repeat(64)}}),aenv)).json());
assert.equal((await api(new Request('https://example.com/api/admin/stats',{headers:{Authorization:'Bearer x'}}),aenv)).status,403);
assert.equal((await api(new Request('https://example.com/api/admin/stats'),env)).status,403,'ADMIN_TOKEN 未設定なら拒否');
const before=await stats();assert.deepEqual(before.metrics,METRICS);assert.equal(before.days.length,90);const t0=before.days[0];
const r=await sl('','POST',{data:sd},undefined,'203.0.113.150'),c=await r.json();
await sl('/'+c.id,'GET',undefined,c.memberToken);await sl('/'+c.id,'GET',undefined,c.editToken);await sl('/'+c.id+'/public');
await sl('/'+c.id+'/publish','POST',{action:'publish',revision:1},c.editToken);await sl('/'+c.id+'/public');await sl('/'+c.id+'/public');
await sl('/'+c.id+'/publish','POST',{action:'publish',revision:1},c.editToken);await sl('/'+c.id+'/publish','POST',{action:'unpublish'},c.editToken);await sl('/'+c.id+'/publish','POST',{action:'publish',revision:1},c.editToken);
const e=await(await call('','POST',{data},undefined,'203.0.113.151')).json();await call('/'+e.id);await call('/'+e.id,'GET',undefined,e.editToken);
const t1=(await stats()).days[0],d=k=>t1[k]-t0[k];
assert.deepEqual({setlist_create:d('setlist_create'),member_view:d('member_view'),public_view:d('public_view'),publish_first:d('publish_first'),publish_update:d('publish_update'),unpublish:d('unpublish'),republish:d('republish'),event_create:d('event_create'),event_view:d('event_view')},
 {setlist_create:1,member_view:1,public_view:2,publish_first:1,publish_update:1,unpublish:1,republish:1,event_create:1,event_view:1},'成功した操作だけを種類別に数える（未公開の公開取得・編集者の読み込みは数えない）');
const statKeys=[...records.keys()].filter(k=>k.startsWith('stats/'));assert.ok(statKeys.every(k=>/^stats\/\d{4}-\d{2}$/.test(k)));const stxt=statKeys.map(k=>records.get(k).value).join();
for(const x of [c.id,c.editToken,'夜明け','203.0.113.150'])assert.ok(!stxt.includes(x),'計測に含めない: '+x);
// 計測の保存に失敗しても本来の処理は成功する
const flaky={...env,BUCKET:{...env.BUCKET,async get(k){if(k.startsWith('stats/'))throw Error('down');return env.BUCKET.get(k)},async put(k,v,o){if(k.startsWith('stats/'))throw Error('down');return env.BUCKET.put(k,v,o)}}};
assert.equal((await api(new Request('https://example.com/api/setlists/'+c.id+'/public'),flaky)).status,200);
// 約90日を過ぎた月は定期削除
records.set('stats/2020-01',{value:'{}',etag:'x'});const cl=await cleanup(env);assert.equal(cl.stats,1);assert.ok(!records.has('stats/2020-01'));assert.ok(statKeys.every(k=>records.has(k)),'今月分は残す');}
