// セトリの公開：公開・公開内容の更新・公開停止・再公開・動画リンク
import assert from 'node:assert/strict';
import {api,cleanup,computeExpiry,memberToken,toPublic,connectToken,METRICS,CREATE_LIMIT_PER_HOUR} from '../../worker/api.mjs';
import {records,env,data,noIds,call,sl,sd,setlistGone} from './helpers.mjs';
let r;const missing=await setlistGone();
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
