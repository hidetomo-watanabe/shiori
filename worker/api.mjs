const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{...headers,...extra}});
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
async function digest(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('')}
const DAY=864e5;
// 保存期間（無料・有料共通）：開催日の90日後（開催日未設定なら最終更新から180日後）。いずれの場合も保存から最低30日は保持
// プランはサーバー側でのみ設定する（クライアントからは変更不可）。プラン別に変える場合は値を差し替える（null は自動削除なし）
const STANDARD_RETENTION={afterEventDays:90,noDateDays:180,minDays:30};
export const RETENTION={free:STANDARD_RETENTION,paid:STANDARD_RETENTION};
export const CREATE_LIMIT_PER_HOUR=20;
export function computeExpiry(data,plan,now){
 const r=Object.hasOwn(RETENTION,plan)?RETENTION[plan]:RETENTION.free;if(!r)return null;
 const t=data.date?Date.parse(data.date+'T23:59:59+09:00')+r.afterEventDays*DAY:now+r.noDateDays*DAY;
 return new Date(Math.max(t,now+r.minDays*DAY)).toISOString();
}
const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function valid(d){return isObj(d)&&typeof d.title==='string'&&d.title.length<=100&&typeof d.date==='string'&&/^(|\d{4}-\d{2}-\d{2})$/.test(d.date)&&typeof d.start==='string'&&/^([01]\d|2\d):[0-5]\d$/.test(d.start)&&(d.open===undefined||typeof d.open==='string'&&/^(|([01]\d|2\d):[0-5]\d)$/.test(d.open))&&(d.charge===undefined||Number.isInteger(d.charge)&&d.charge>=0&&d.charge<=1000000)&&(d.drinks===undefined||Number.isInteger(d.drinks)&&d.drinks>=0&&d.drinks<=9)&&(d.end===undefined||typeof d.end==='string'&&/^(|([01]\d|2\d):[0-5]\d)$/.test(d.end))&&typeof d.venue==='string'&&d.venue.length<=100&&typeof d.note==='string'&&d.note.length<=1500&&Array.isArray(d.acts)&&d.acts.length>0&&d.acts.length<=40&&d.acts.every(a=>isObj(a)&&typeof a.name==='string'&&a.name.length<=100&&Number.isInteger(a.play)&&a.play>=0&&a.play<=240&&Number.isInteger(a.change)&&a.change>=0&&a.change<=120&&(a.id===undefined||typeof a.id==='string'&&/^[a-f0-9]{12}$/.test(a.id))&&(a.kind===undefined||a.kind==='break')&&(a.url===undefined||typeof a.url==='string'&&a.url.length<=500&&/^(|https?:\/\/\S+)$/.test(a.url)))}
const expired=record=>!!record.expiresAt&&Date.parse(record.expiresAt)<Date.now();
// IPハッシュ用の秘密値：環境変数 RATE_LIMIT_SALT、未設定なら初回に生成してR2に保管（公開されない）
let saltCache;
async function salt(env){
 if(env.RATE_LIMIT_SALT)return env.RATE_LIMIT_SALT;if(saltCache)return saltCache;
 let o=await env.BUCKET.get('config/salt');if(!o){await env.BUCKET.put('config/salt',random());o=await env.BUCKET.get('config/salt')}
 return saltCache=await o.text();
}
// R2のみで動く簡易レート制限（IPは秘密値付きでハッシュ化、1時間単位のバケット）
async function rateLimited(req,env){
 const ip=req.headers.get('CF-Connecting-IP')||req.headers.get('X-Forwarded-For')?.split(',')[0].trim()||'unknown';
 const hour=Math.floor(Date.now()/36e5),key='ratelimit/'+hour+'/'+(await digest((await salt(env))+':'+ip)).slice(0,32);
 const obj=await env.BUCKET.get(key),count=obj?Number(await obj.text())||0:0;
 if(count>=CREATE_LIMIT_PER_HOUR)return true;
 await env.BUCKET.put(key,String(count+1));return false;
}
const GONE='イベントが見つかりません。削除されたか、保存期間が終了した可能性があります。';
async function authorize(req,env,id){
 const token=req.headers.get('Authorization')?.replace(/^Bearer /,'');if(!token||!/^[a-f0-9]{48}$/.test(token))return {error:json({error:'編集リンクが必要です'},403)};
 const obj=await env.BUCKET.get('events/'+id);if(!obj)return {error:json({error:GONE},404)};const record=await obj.json();
 if(expired(record))return {error:json({error:GONE},404)};
 if(record.editHash!==await digest(token))return {error:json({error:'編集リンクが正しくありません'},403)};
 return {obj,record};
}
// 別ドメイン（GitHub Pages）からの利用を許可するオリジン。環境変数 ALLOWED_ORIGINS（カンマ区切り）で上書き可能
export const DEFAULT_ALLOWED_ORIGINS='https://shiori.whathides.co.jp';
const allowedOrigins=env=>(env.ALLOWED_ORIGINS??DEFAULT_ALLOWED_ORIGINS).split(',').map(s=>s.trim()).filter(Boolean);
const originAllowed=(req,env)=>{const o=req.headers.get('Origin');return !o||o===new URL(req.url).origin||allowedOrigins(env).includes(o)};
export async function api(req,env){
 const origin=req.headers.get('Origin'),cors=origin&&allowedOrigins(env).includes(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
 if(req.method==='OPTIONS'){
  if(!cors['Access-Control-Allow-Origin'])return json({error:'許可されていない操作です'},403);
  return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST, PUT, DELETE','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'86400'}});
 }
 let res;try{res=await route(req,env)}catch{res=json({error:'保存処理に失敗しました。時間をおいて再度お試しください。'},500)}
 for(const [k,v] of Object.entries(cors))res.headers.set(k,v);
 return res;
}
async function route(req,env){
 const url=new URL(req.url);if(url.pathname==='/api/admin/list')return adminList(req,env,url);
 const isSetlist=/^\/api\/setlists(\/|$)/.test(url.pathname),match=url.pathname.match(/^\/api\/events(?:\/([a-f0-9]{24})(?:\/slots\/([a-f0-9]{12})\/(connect-key|connect|link))?)?$/);if(!match&&!isSetlist)return json({error:'ページが見つかりません'},404);
 if(!env.BUCKET)return json({error:'保存先の準備ができていません。時間をおいて再度お試しください。'},503);
 if(!['GET','POST','PUT','DELETE'].includes(req.method))return json({error:'対応していない操作です'},405);
 if(req.method!=='GET'&&!originAllowed(req,env))return json({error:'許可されていない操作です'},403);
 if(isSetlist)return setlistRoute(req,env,url);
 if(match[2])return slotRoute(req,env,match[1],match[2],match[3]);
 const id=match[1];
 if(req.method==='GET'&&id){const obj=await env.BUCKET.get('events/'+id);if(!obj)return json({error:GONE},404);const record=await obj.json();if(expired(record)){await env.BUCKET.delete('events/'+id);return json({error:GONE},404)}const linked=await slotSetlists(env,id,record),token=req.headers.get('Authorization')?.replace(/^Bearer /,''),isEditor=!!token&&/^[a-f0-9]{48}$/.test(token)&&record.editHash===await digest(token);return json({data:record.data,revision:record.revision,updatedAt:record.updatedAt,expiresAt:record.expiresAt??null,plan:record.plan==='paid'?'paid':'free',setlists:publicSetlists(linked),...(isEditor?{manage:manageOf(record,linked)}:{})});}
 if(req.method==='DELETE'&&id){const {error}=await authorize(req,env,id);if(error)return error;await env.BUCKET.delete('events/'+id);return json({deleted:true});}
 if((req.method==='POST'&&!id)||(req.method==='PUT'&&id)){
  if(!req.headers.get('Content-Type')?.includes('application/json'))return json({error:'JSON形式で送信してください'},415);
  if(Number(req.headers.get('Content-Length'))>30000)return json({error:'入力内容が長すぎます'},413);
  let body;try{let raw=await req.text();if(raw.length>30000)return json({error:'入力内容が長すぎます'},413);body=JSON.parse(raw)}catch{return json({error:'入力内容を読み込めません'},400)}
  if(!isObj(body)||!valid(body.data))return json({error:'入力内容を確認してください'},400);
  const data={title:body.data.title,date:body.data.date,open:body.data.open||'',end:body.data.end||'',...(body.data.charge!==undefined?{charge:body.data.charge}:{}),...(body.data.drinks!==undefined?{drinks:body.data.drinks}:{}),start:body.data.start,venue:body.data.venue,note:body.data.note,acts:body.data.acts.map(a=>({...(a.id?{id:a.id}:{}),name:a.name,play:a.play,change:a.kind==='break'?0:a.change,...(a.kind?{kind:a.kind}:{}),...(a.url&&a.kind!=='break'?{url:a.url}:{})}))};
  assignSlotIds(data);const ids=data.acts.map(a=>a.id);
  const now=Date.now(),meta=r=>({customMetadata:{expiresAt:r.expiresAt||''}});
  if(!id){
   if(await rateLimited(req,env))return json({error:'短時間に作成できる上限に達しました。1時間ほどおいて再度お試しください。'},429,{'Retry-After':'3600'});
   const eventId=random().slice(0,24),editToken=random(),plan='free';const record={data,plan,editHash:await digest(editToken),revision:1,updatedAt:new Date(now).toISOString(),expiresAt:computeExpiry(data,plan,now)};await env.BUCKET.put('events/'+eventId,JSON.stringify(record),meta(record));return json({id:eventId,editToken,revision:1,updatedAt:record.updatedAt,expiresAt:record.expiresAt,ids,manage:manageOf(record,{})},201)}
  const {error,obj,record}=await authorize(req,env,id);if(error)return error;
  if(body.revision!==record.revision)return json({error:'別の画面で更新されています。この下書きを控えてからページを再読み込みしてください。'},409);
  const next={...record,...pruneSlots(record,data),data,revision:record.revision+1,updatedAt:new Date(now).toISOString(),expiresAt:computeExpiry(data,record.plan||'free',now)};const result=await env.BUCKET.put('events/'+id,JSON.stringify(next),{...meta(next),onlyIf:{etagMatches:obj.etag}});if(!result)return json({error:'同時に更新されました。ページを再読み込みしてください。'},409);return json({id,revision:next.revision,updatedAt:next.updatedAt,expiresAt:next.expiresAt,ids,manage:manageOf(next,await slotSetlists(env,id,next))});
 }
 return json({error:'ページが見つかりません'},404);
}
// セトリ。保存先は setlists/{id}。内部データ（data）と公開スナップショット（publication）を同じオブジェクトに持ち、etag条件付き書き込みで原子的に更新する
// メンバー閲覧キーは編集キーから導出する（編集リンクを持つ人はどの端末でもメンバー用リンクを表示できる。サーバーにはハッシュのみ保持）
const SETLIST_GONE='セトリが見つかりません。リンクが正しくないか、削除・保存期間の終了により見られなくなっています。',SETLIST_KINDS=['song','mc','break'];
const str=(v,max)=>typeof v==='string'&&v.length<=max;
export function validSetlist(d){return isObj(d)&&str(d.title,100)&&str(d.artist,100)&&typeof d.date==='string'&&/^(|\d{4}-\d{2}-\d{2})$/.test(d.date)&&str(d.venue,100)&&str(d.comment,1500)&&str(d.memo,1500)&&Array.isArray(d.items)&&d.items.length>0&&d.items.length<=100&&d.items.every(i=>isObj(i)&&SETLIST_KINDS.includes(i.kind)&&str(i.title,200)&&(i.kind!=='song'||i.title.trim()!=='')&&(i.artist===undefined||i.kind==='song'&&str(i.artist,200))&&(i.sec===null||Number.isInteger(i.sec)&&i.sec>=1&&i.sec<=14400)&&str(i.memo,500))&&(d.videos===undefined||Array.isArray(d.videos)&&d.videos.length<=5&&d.videos.every(u=>str(u,2048)&&/^https:\/\/[^\s/?#]+\S*$/.test(u)))}
const cleanSetlist=d=>({title:d.title,artist:d.artist,date:d.date,venue:d.venue,comment:d.comment,memo:d.memo,videos:d.videos||[],items:d.items.map(i=>({kind:i.kind,title:i.title,...(i.kind==='song'?{artist:i.artist||''}:{}),sec:i.sec,memo:i.memo}))});
// 公開用データは許可リストで作る（内部メモ・MC・休憩・演奏時間は含めない）
export const toPublic=d=>({title:d.title,artist:d.artist,date:d.date,venue:d.venue,comment:d.comment,videos:d.videos||[],songs:d.items.filter(i=>i.kind==='song').map(i=>({title:i.title,artist:i.artist||''}))});
const publicationStatus=r=>r.publication?{published:true,publishedAt:r.publication.publishedAt,publishedRevision:r.publication.revision,firstPublishedAt:r.firstPublishedAt}:{published:false};
export const memberToken=async(editToken,gen)=>(await digest(editToken+':member:'+gen)).slice(0,48);
const SETLIST_MAX=150000;
async function readJson(req,max){
 if(!req.headers.get('Content-Type')?.includes('application/json'))return {error:json({error:'JSON形式で送信してください'},415)};
 if(Number(req.headers.get('Content-Length'))>max*3)return {error:json({error:'入力内容が長すぎます'},413)};
 try{const raw=await req.text();if(raw.length>max)return {error:json({error:'入力内容が長すぎます'},413)};return {body:JSON.parse(raw)}}catch{return {error:json({error:'入力内容を読み込めません'},400)}}
}
// 対象が存在しない・期限切れ・キー不一致はすべて同じ404（未公開セトリの存在を推測させない）
async function setlistAuth(req,env,id,roles){
 const gone={error:json({error:SETLIST_GONE},404)},token=req.headers.get('Authorization')?.replace(/^Bearer /,'');
 const obj=await env.BUCKET.get('setlists/'+id);if(!obj)return gone;const record=await obj.json();
 if(expired(record)){await env.BUCKET.delete('setlists/'+id);return gone}
 if(!token||!/^[a-f0-9]{48}$/.test(token))return gone;
 const hash=await digest(token),role=hash===record.editHash?'edit':hash===record.memberHash?'member':null;if(!role)return gone;
 if(!roles.includes(role))return {error:json({error:'編集リンクが必要です'},403)};
 return {obj,record,role,token};
}
const setlistMeta=r=>({customMetadata:{expiresAt:r.expiresAt||''}});
async function setlistRoute(req,env,url){
 const match=url.pathname.match(/^\/api\/setlists(?:\/([a-f0-9]{24})(\/public|\/keys|\/publish|\/link)?)?$/);if(!match)return json({error:'ページが見つかりません'},404);
 const [,id,sub]=match,now=Date.now();
 if(req.method==='GET'&&id&&sub==='/public'){const obj=await env.BUCKET.get('setlists/'+id),record=obj&&await obj.json();if(!record||expired(record)||!record.publication)return json({error:SETLIST_GONE},404);const back=record.link?.backLink&&await eventOfLink(env,id,record.link);return json({data:record.publication.data,publishedAt:record.publication.publishedAt,...(back?{event:{id:record.link.eventId,title:back.ev.data.title}}:{})})}
 if(req.method==='POST'&&!id){
  const {error,body}=await readJson(req,SETLIST_MAX);if(error)return error;
  if(!isObj(body)||!validSetlist(body.data))return json({error:'入力内容を確認してください'},400);
  if(await rateLimited(req,env))return json({error:'短時間に作成できる上限に達しました。1時間ほどおいて再度お試しください。'},429,{'Retry-After':'3600'});
  const data=cleanSetlist(body.data),setlistId=random().slice(0,24),editToken=random(),plan='free',member=await memberToken(editToken,1);
  const record={data,plan,editHash:await digest(editToken),memberHash:await digest(member),memberGen:1,publication:null,revision:1,updatedAt:new Date(now).toISOString(),expiresAt:computeExpiry(data,plan,now)};
  await env.BUCKET.put('setlists/'+setlistId,JSON.stringify(record),setlistMeta(record));
  return json({id:setlistId,editToken,memberToken:member,memberGen:1,revision:1,updatedAt:record.updatedAt,expiresAt:record.expiresAt},201);
 }
 if(!id||(sub&&!((sub==='/keys'||sub==='/publish'||sub==='/link')&&req.method==='POST'||sub==='/link'&&req.method==='DELETE')))return json({error:'ページが見つかりません'},404);
 if(req.method==='GET'){const {error,record,role}=await setlistAuth(req,env,id,['edit','member']);if(error)return error;return json({data:record.data,role,revision:record.revision,updatedAt:record.updatedAt,expiresAt:record.expiresAt??null,publication:publicationStatus(record),link:await linkInfo(env,id,record.link),...(role==='edit'?{memberGen:record.memberGen}:{})})}
 const {error,obj,record,token}=await setlistAuth(req,env,id,['edit']);if(error)return error;
 // セトリ側から紐づけを外す（イベント側も、このセトリを指していれば外す。失敗しても読み出し時の一致判定で無効になる）
 const unlinkEvent=async link=>{try{const eo=await env.BUCKET.get('events/'+link.eventId);if(!eo)return;const ev=await eo.json();if(ev.links?.[link.slotId]?.setlistId!==id)return;const links={...ev.links};delete links[link.slotId];await env.BUCKET.put('events/'+link.eventId,JSON.stringify({...ev,links}),{...eventMeta(ev),onlyIf:{etagMatches:eo.etag}})}catch{}};
 if(req.method==='DELETE'&&sub==='/link'){if(record.link){const r=await env.BUCKET.put('setlists/'+id,JSON.stringify({...record,link:null}),{...setlistMeta(record),onlyIf:{etagMatches:obj.etag}});if(!r)return json({error:'同時に更新されました。ページを再読み込みしてください。'},409);await unlinkEvent(record.link)}return json({linked:false})}
 if(req.method==='DELETE'){await env.BUCKET.delete('setlists/'+id);if(record.link)await unlinkEvent(record.link);return json({deleted:true})}
 const {error:bodyError,body}=await readJson(req,SETLIST_MAX);if(bodyError)return bodyError;if(!isObj(body))return json({error:'入力内容を確認してください'},400);
 const put=async next=>await env.BUCKET.put('setlists/'+id,JSON.stringify(next),{...setlistMeta(next),onlyIf:{etagMatches:obj.etag}})?null:json({error:'同時に更新されました。ページを再読み込みしてください。'},409);
 // キーの再発行：メンバー用は世代を進めて旧リンクを無効化。編集用は新しいキーに置き換え（導出元が変わるためメンバー用リンクも変わる）
 if(sub==='/keys'){
  if(body.kind!=='member'&&body.kind!=='edit')return json({error:'入力内容を確認してください'},400);
  const editToken=body.kind==='edit'?random():token,memberGen=body.kind==='member'?record.memberGen+1:record.memberGen,member=await memberToken(editToken,memberGen);
  const conflict=await put({...record,editHash:await digest(editToken),memberHash:await digest(member),memberGen});if(conflict)return conflict;
  return json({memberGen,memberToken:member,...(body.kind==='edit'?{editToken}:{})});
 }
 // 公開・公開更新：保存済みの最新revisionを確認し、その内容から公開スナップショットを作る。公開停止：スナップショットを消す（内部データは残す）
 if(sub==='/publish'){
  if(body.action==='unpublish'){if(record.publication){const conflict=await put({...record,publication:null});if(conflict)return conflict}return json({published:false})}
  if(body.action!=='publish')return json({error:'入力内容を確認してください'},400);
  if(body.revision!==record.revision)return json({error:'別の画面で更新されています。ページを再読み込みし、内容を確認してから公開してください。'},409);
  if(!record.data.items.some(i=>i.kind==='song'))return json({error:'公開するには曲を1曲以上登録してください。'},400);
  const at=new Date(now).toISOString(),version=(record.publishedVersion||0)+1,next={...record,publication:{data:toPublic(record.data),revision:record.revision,version,publishedAt:at},publishedVersion:version,firstPublishedAt:record.firstPublishedAt||at};
  const conflict=await put(next);if(conflict)return conflict;
  return json(publicationStatus(next));
 }
 // 出演枠への紐づけ：紐づけ用キーとセトリ編集権限の両方が必要。セトリ側→イベント側の順に条件付きで書き込み、イベント側で失敗したらセトリ側を戻す
 if(sub==='/link'){
  if(body.connectToken===undefined){if(typeof body.backLink!=='boolean')return json({error:'入力内容を確認してください'},400);if(!record.link||!await eventOfLink(env,id,record.link))return json({error:'紐づいているイベントがありません。'},404);const conflict=await put({...record,link:{...record.link,backLink:body.backLink}});if(conflict)return conflict;return json({link:await linkInfo(env,id,{...record.link,backLink:body.backLink})})}
  const {eventId,slotId,connectToken:ct}=body;if(typeof eventId!=='string'||!/^[a-f0-9]{24}$/.test(eventId)||typeof slotId!=='string'||!/^[a-f0-9]{12}$/.test(slotId)||typeof ct!=='string'||!/^[a-f0-9]{48}$/.test(ct)||(body.backLink!==undefined&&typeof body.backLink!=='boolean'))return json({error:'入力内容を確認してください'},400);
  const eo=await env.BUCKET.get('events/'+eventId),ev=eo&&await eo.json();
  if(!ev||expired(ev)||!playable(ev,slotId)||ev.connect?.[slotId]?.hash!==await digest(ct))return json({error:CONNECT_GONE},404);
  if(record.link&&await eventOfLink(env,id,record.link)){if(record.link.eventId===eventId&&record.link.slotId===slotId)return json({link:await linkInfo(env,id,record.link)});return json({error:'このセトリはすでに別の出演枠に紐づいています。先に紐づけを解除してください。'},409)}
  const current=ev.links?.[slotId];if(current&&current.setlistId!==id&&await linkedSetlist(env,eventId,slotId,current.setlistId))return json({error:'この出演枠にはすでに別のセトリが紐づいています。主催者に解除を依頼してください。'},409);
  const at=new Date(now).toISOString(),link={eventId,slotId,backLink:body.backLink===true,linkedAt:at};
  const conflict=await put({...record,link});if(conflict)return conflict;
  if(!await env.BUCKET.put('events/'+eventId,JSON.stringify({...ev,links:{...ev.links,[slotId]:{setlistId:id,linkedAt:at}}}),{...eventMeta(ev),onlyIf:{etagMatches:eo.etag}})){
   try{const so=await env.BUCKET.get('setlists/'+id),r=so&&await so.json();if(r?.link?.linkedAt===at)await env.BUCKET.put('setlists/'+id,JSON.stringify({...r,link:record.link||null}),{...setlistMeta(r),onlyIf:{etagMatches:so.etag}})}catch{}
   return json({error:'イベント側が同時に更新されました。もう一度お試しください。'},409);
  }
  return json({link:await linkInfo(env,id,link)});
 }
 if(req.method!=='PUT')return json({error:'ページが見つかりません'},404);
 if(!validSetlist(body.data))return json({error:'入力内容を確認してください'},400);
 if(body.revision!==record.revision)return json({error:'別の画面で更新されています。この下書きを控えてからページを再読み込みしてください。'},409);
 const data=cleanSetlist(body.data),next={...record,data,revision:record.revision+1,updatedAt:new Date(now).toISOString(),expiresAt:computeExpiry(data,record.plan||'free',now)};
 const conflict=await put(next);if(conflict)return conflict;
 return json({id,revision:next.revision,updatedAt:next.updatedAt,expiresAt:next.expiresAt});
}
// イベントとセトリの紐づけ。イベント側 links[slotId]={setlistId} とセトリ側 link={eventId,slotId} が一致するときだけ有効とみなす
// （R2はオブジェクトをまたぐトランザクションがないため。片側だけ残った情報は読み出し時に無視する）
const CONNECT_GONE='紐づけ用リンクが正しくないか、作り直し・削除されています。主催者に新しいリンクを確認してください。';
const playable=(record,slotId)=>record.data.acts.find(a=>a.id===slotId&&a.kind!=='break');
function assignSlotIds(data){const seen=new Set();for(const a of data.acts){if(!a.id||seen.has(a.id))a.id=random().slice(0,12);seen.add(a.id)}}
// 保存後に存在しない出演枠（削除・休憩）の紐づけと紐づけ用キーを外す
function pruneSlots(record,data){const keep=new Set(data.acts.filter(a=>a.kind!=='break').map(a=>a.id)),pick=o=>Object.fromEntries(Object.entries(o||{}).filter(([k])=>keep.has(k)));return {links:pick(record.links),connect:pick(record.connect)}}
export const connectToken=async(editToken,slotId,gen)=>(await digest(editToken+':connect:'+slotId+':'+gen)).slice(0,48);
async function linkedSetlist(env,eventId,slotId,setlistId){const obj=await env.BUCKET.get('setlists/'+setlistId);if(!obj)return null;const r=await obj.json();return !expired(r)&&r.link?.eventId===eventId&&r.link?.slotId===slotId?r:null}
async function slotSetlists(env,eventId,record){const found={};await Promise.all(Object.entries(record.links||{}).map(async([slotId,l])=>{if(!playable(record,slotId))return;const r=await linkedSetlist(env,eventId,slotId,l.setlistId);if(r)found[slotId]={id:l.setlistId,record:r}}));return found}
// 閲覧者向け：公開中のセトリだけ（公開前のID・タイトル等は含めない）
const publicSetlists=found=>Object.fromEntries(Object.entries(found).filter(([,f])=>f.record.publication).map(([slotId,f])=>[slotId,{id:f.id,title:f.record.publication.data.title}]));
// 主催者向け：紐づけの有無・公開状態・紐づけ用キーの世代のみ（公開前の内容は返さない）
const manageOf=(record,found)=>Object.fromEntries(record.data.acts.filter(a=>a.kind!=='break').map(a=>[a.id,{connectGen:record.connect?.[a.id]?.gen||0,linked:!!found[a.id],published:!!found[a.id]?.record.publication}]));
async function eventOfLink(env,setlistId,link){if(!link)return null;const obj=await env.BUCKET.get('events/'+link.eventId);if(!obj)return null;const ev=await obj.json(),slot=!expired(ev)&&playable(ev,link.slotId);return slot&&ev.links?.[link.slotId]?.setlistId===setlistId?{ev,slot}:null}
async function linkInfo(env,setlistId,link){if(!link)return null;const found=await eventOfLink(env,setlistId,link);if(!found)return {valid:false};return {valid:true,eventId:link.eventId,slotId:link.slotId,backLink:!!link.backLink,event:{title:found.ev.data.title,date:found.ev.data.date,venue:found.ev.data.venue},slot:{name:found.slot.name,play:found.slot.play}}}
const eventMeta=r=>({customMetadata:{expiresAt:r.expiresAt||''}});
async function slotRoute(req,env,id,slotId,action){
 // 紐づけ用リンクを開いた出演者向け：紐づけ用キーで出演枠の情報を返す
 if(action==='connect'&&req.method==='GET'){
  const token=req.headers.get('Authorization')?.replace(/^Bearer /,''),obj=await env.BUCKET.get('events/'+id),record=obj&&await obj.json(),slot=record&&!expired(record)&&playable(record,slotId);
  if(!slot||!token||!/^[a-f0-9]{48}$/.test(token)||record.connect?.[slotId]?.hash!==await digest(token))return json({error:CONNECT_GONE},404);
  const current=record.links?.[slotId],taken=!!current&&!!await linkedSetlist(env,id,slotId,current.setlistId);
  return json({event:{title:record.data.title,date:record.data.date,venue:record.data.venue,start:record.data.start},slot:{name:slot.name,play:slot.play},taken,setlistId:taken?current.setlistId:null});
 }
 const {error,obj,record}=await authorize(req,env,id);if(error)return error;
 if(!playable(record,slotId))return json({error:'出演枠が見つかりません。保存してから再度お試しください。'},404);
 const save=async next=>await env.BUCKET.put('events/'+id,JSON.stringify(next),{...eventMeta(next),onlyIf:{etagMatches:obj.etag}})?null:json({error:'同時に更新されました。ページを再読み込みしてください。'},409);
 // 紐づけ用キーの発行・再発行（世代を進めて旧リンクを無効化）
 if(action==='connect-key'&&req.method==='POST'){
  const gen=(record.connect?.[slotId]?.gen||0)+1,token=await connectToken(req.headers.get('Authorization').replace(/^Bearer /,''),slotId,gen);
  const conflict=await save({...record,connect:{...record.connect,[slotId]:{gen,hash:await digest(token)}}});if(conflict)return conflict;
  return json({connectGen:gen,connectToken:token});
 }
 // 主催者による解除：イベント側だけを外す（セトリ本体・権限は変更しない）
 if(action==='link'&&req.method==='DELETE'){
  if(record.links?.[slotId]){const links={...record.links};delete links[slotId];const conflict=await save({...record,links});if(conflict)return conflict}
  return json({linked:false});
 }
 return json({error:'ページが見つかりません'},404);
}
// 運営管理：管理キー（環境変数 ADMIN_TOKEN）を持つ人だけが、イベント・セトリの状態の一覧を取得できる
// 入力内容（タイトル・日付・会場・曲名・メモ等）、秘密キー、完全なID（閲覧ページを開けてしまう）は返さない
const ADMIN_PAGE=40; // 一覧1回＋読み出し40回。Workers無料プランのサブリクエスト上限（50）に収める
async function adminList(req,env,url){
 if(req.method!=='GET')return json({error:'対応していない操作です'},405);
 if(!env.BUCKET)return json({error:'保存先の準備ができていません。'},503);
 const token=req.headers.get('Authorization')?.replace(/^Bearer /,'');
 if(!env.ADMIN_TOKEN)return json({error:'管理画面は設定されていません。'},403);
 if(!token||await digest(token)!==await digest(env.ADMIN_TOKEN))return json({error:'管理キーが正しくありません。'},403);
 const type=url.searchParams.get('type');if(type!=='events'&&type!=='setlists')return json({error:'入力内容を確認してください'},400);
 const cursor=url.searchParams.get('cursor')||undefined,page=await env.BUCKET.list({prefix:type+'/',cursor,limit:ADMIN_PAGE});
 const items=(await Promise.all(page.objects.map(async o=>{const obj=await env.BUCKET.get(o.key);if(!obj)return null;const r=await obj.json(),base={id:o.key.split('/')[1].slice(0,6),updatedAt:r.updatedAt||null,revision:r.revision||0,expiresAt:r.expiresAt||null,expired:expired(r),plan:r.plan==='paid'?'paid':'free'};
  if(type==='events'){const acts=r.data?.acts||[],slots=acts.filter(a=>a.kind!=='break');return {...base,slots:slots.length,breaks:acts.length-slots.length,connectKeys:Object.keys(r.connect||{}).length,links:Object.keys(r.links||{}).length}}
  const its=r.data?.items||[];return {...base,songs:its.filter(i=>i.kind==='song').length,items:its.length,videos:(r.data?.videos||[]).length,published:!!r.publication,publishedAt:r.publication?.publishedAt||null,firstPublishedAt:r.firstPublishedAt||null,publishedVersion:r.publishedVersion||0,linked:!!r.link,memberGen:r.memberGen||1};
 }))).filter(Boolean);
 return json({items,cursor:page.truncated?page.cursor:null});
}
// 定期実行（Cron Trigger）用：期限切れのイベント・セトリと古いレート制限カウンタを削除
export async function cleanup(env){
 const counts={events:0,setlists:0,ratelimit:0};if(!env.BUCKET)return counts;
 const now=Date.now(),hour=Math.floor(now/36e5),isExpired=o=>o.customMetadata?.expiresAt&&Date.parse(o.customMetadata.expiresAt)<now;
 for(const [prefix,isDead] of [['events/',isExpired],['setlists/',isExpired],['ratelimit/',o=>Number(o.key.split('/')[1])<hour-1]]){
  let cursor;do{const page=await env.BUCKET.list({prefix,cursor,include:['customMetadata']});const dead=page.objects.filter(isDead).map(o=>o.key);if(dead.length){await env.BUCKET.delete(dead);counts[prefix.slice(0,-1)]+=dead.length}cursor=page.truncated?page.cursor:undefined}while(cursor);
 }
 return counts;
}
