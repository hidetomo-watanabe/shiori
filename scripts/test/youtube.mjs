// YouTube 検索：キー未設定は503、結果の整形（HTMLエスケープ解除・不正IDの除外・動画の長さ）、7日間の使い回し、IPごとの回数制限、期限切れの定期削除
import assert from 'node:assert/strict';
import {api,cleanup,YOUTUBE_LIMIT_PER_HOUR} from '../../worker/api.mjs';
import {records,env} from './helpers.mjs';
const yt=(q,e=env,ip='203.0.113.200',origin)=>api(new Request('https://example.com/api/youtube?'+new URLSearchParams({q}),{headers:{'CF-Connecting-IP':ip,...(origin?{Origin:origin}:{})}}),e);
const realFetch=globalThis.fetch;let calls=[],reply={status:200,body:{items:[{id:{videoId:'abcdefghijk'},snippet:{title:'夜明け &amp; 朝 &#39;Live&#39;',channelTitle:'だぁめんず'}},{id:{videoId:'bad'},snippet:{title:'x'}},{id:{channelId:'c'}}]}};
let details={status:200,body:{items:[{id:'abcdefghijk',contentDetails:{duration:'PT4M5S'}}]}};
globalThis.fetch=async url=>{url=String(url);if(url.includes('/youtube/v3/videos?'))return new Response(JSON.stringify(details.body),{status:details.status});calls.push(url);return new Response(JSON.stringify(reply.body),{status:reply.status})};
try{
 const ke={...env,YOUTUBE_API_KEY:'test-key'};
 assert.equal((await yt('夜明け')).status,503,'キー未設定');assert.equal(calls.length,0);
 assert.equal((await yt('',ke)).status,400);assert.equal((await yt('x'.repeat(402),ke)).status,400);
 assert.equal((await yt('夜明け',ke,undefined,'https://evil.example')).status,403,'許可されていない画面から');
 let r=await yt('夜明け 原曲さん',ke);assert.equal(r.status,200);assert.deepEqual(await r.json(),{videos:[{id:'abcdefghijk',title:"夜明け & 朝 'Live'",channel:'だぁめんず',sec:245}]});
 assert.equal(calls.length,1);assert.equal(new URL(calls[0]).searchParams.get('q'),'夜明け 原曲さん');
 const cached=[...records.keys()].filter(k=>k.startsWith('youtube/'));assert.equal(cached.length,1);assert.ok(!records.get(cached[0]).value.includes('原曲さん'),'検索語は保存しない');
 r=await yt('夜明け 原曲さん',ke);assert.equal(r.status,200);assert.equal(calls.length,1,'同じ検索語は使い回す');
 reply={status:200,body:{items:[{id:{videoId:'lmnopqrstuv'},snippet:{title:'長さなし',channelTitle:'c'}}]}};details={status:500,body:{}};r=await yt('長さが取れない',ke);assert.equal(r.status,200);assert.deepEqual(await r.json(),{videos:[{id:'lmnopqrstuv',title:'長さなし',channel:'c'}]},'長さが取れなくても検索結果は返す');
 const before=calls.length;details={status:200,body:{items:[{id:'lmnopqrstuv',contentDetails:{duration:'PT1H2M3S'}}]}};r=await yt('長さが取れない',ke);assert.deepEqual((await r.json()).videos[0].sec,3723,'使い回すときに長さを取り直す');assert.equal(calls.length,before,'検索はやり直さない');
 details={status:500,body:{}};r=await yt('長さが取れない',ke);assert.equal((await r.json()).videos[0].sec,3723,'取り直した長さを保存する');
 reply={status:403,body:{}};assert.equal((await yt('上限',ke)).status,503);
 reply={status:200,body:{items:[]}};for(let i=0;i<YOUTUBE_LIMIT_PER_HOUR;i++)assert.equal((await yt('曲'+i,ke,'203.0.113.201')).status,200);
 assert.equal((await yt('もう一曲',ke,'203.0.113.201')).status,429,'IPごとの回数制限');assert.equal((await yt('夜明け 原曲さん',ke,'203.0.113.201')).status,200,'使い回しは制限しない');
 records.set(cached[0],{value:'{}',etag:'x',customMetadata:{expiresAt:'2020-01-01T00:00:00.000Z'}});assert.ok((await cleanup(env)).youtube>=1);assert.ok(!records.has(cached[0]));
}finally{globalThis.fetch=realFetch}
