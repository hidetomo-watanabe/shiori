// イベントの出演枠とセトリの紐づけ：両方の権限・二重紐づけの拒否・並べ替え・解除・削除・公開時のみの導線・戻りリンク
import assert from 'node:assert/strict';
import {api,cleanup,computeExpiry,memberToken,toPublic,connectToken,METRICS,CREATE_LIMIT_PER_HOUR} from '../../worker/api.mjs';
import {records,env,data,noIds,call,sl,sd,setlistGone} from './helpers.mjs';
let r;
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
