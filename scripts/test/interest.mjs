// 有料候補への関心（要件書12章 F-04）：画面からの呼び出しのみ、決まった機能名だけ、機能別の日別回数、IPごとの1時間の上限、どこから押したかを記録しない
import assert from 'node:assert/strict';
import {api,INTEREST,INTEREST_LIMIT_PER_HOUR} from '../../worker/api.mjs';
import {records,env} from './helpers.mjs';
const aenv={...env,ADMIN_TOKEN:'b'.repeat(64)},today=async()=>(await(await api(new Request('https://example.com/api/admin/stats',{headers:{Authorization:'Bearer '+'b'.repeat(64)}}),aenv)).json()).days[0];
const vote=(body,ip='203.0.113.210',origin='https://example.com',method='POST')=>api(new Request('https://example.com/api/interest',{method,headers:{'Content-Type':'application/json','CF-Connecting-IP':ip,...(origin?{Origin:origin}:{})},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),env);
const t0=await today();
assert.equal((await vote({feature:'retention'},undefined,'https://evil.example')).status,403,'他のサイトからは拒否');
assert.equal((await vote({feature:'retention'},undefined,null)).status,403,'画面以外（Origin なし）からは拒否');
assert.equal((await vote(undefined,undefined,undefined,'GET')).status,405);
for(const b of [{feature:'paid'},{feature:''},{},'x',{feature:'interest_open'}])assert.equal((await vote(b)).status,400,'決まった機能名以外は拒否: '+JSON.stringify(b));
assert.equal((await vote({feature:'retention'})).status,200);await vote({feature:'retention'},'203.0.113.211');await vote({feature:'open'});await vote({feature:'library',eventId:'a'.repeat(24)});
let t1=await today();
assert.deepEqual(Object.fromEntries(INTEREST.map(f=>['interest_'+f,t1['interest_'+f]-t0['interest_'+f]])),{interest_open:1,interest_retention:2,interest_design:0,interest_history:0,interest_separate:0,interest_library:1},'機能別に延べ回数を数える');
const stxt=[...records.keys()].filter(k=>k.startsWith('stats/')).map(k=>records.get(k).value).join();
for(const x of ['a'.repeat(24),'203.0.113.210'])assert.ok(!stxt.includes(x),'計測に含めない: '+x);
// IPごとに1時間の上限。超えた分は成功を返すが数えない
for(let i=0;i<INTEREST_LIMIT_PER_HOUR+5;i++)assert.equal((await vote({feature:'design'},'203.0.113.212')).status,200);
t1=await today();assert.equal(t1.interest_design-t0.interest_design,INTEREST_LIMIT_PER_HOUR,'上限を超えた分は数えない');
