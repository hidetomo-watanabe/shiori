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
export function valid(d){return isObj(d)&&typeof d.title==='string'&&d.title.length<=100&&typeof d.date==='string'&&/^(|\d{4}-\d{2}-\d{2})$/.test(d.date)&&typeof d.start==='string'&&/^([01]\d|2\d):[0-5]\d$/.test(d.start)&&(d.open===undefined||typeof d.open==='string'&&/^(|([01]\d|2\d):[0-5]\d)$/.test(d.open))&&(d.charge===undefined||Number.isInteger(d.charge)&&d.charge>=0&&d.charge<=1000000)&&(d.drinks===undefined||Number.isInteger(d.drinks)&&d.drinks>=0&&d.drinks<=9)&&(d.end===undefined||typeof d.end==='string'&&/^(|([01]\d|2\d):[0-5]\d)$/.test(d.end))&&typeof d.venue==='string'&&d.venue.length<=100&&(d.venueUrl===undefined||typeof d.venueUrl==='string'&&d.venueUrl.length<=500&&/^(|https?:\/\/\S+)$/.test(d.venueUrl))&&typeof d.note==='string'&&d.note.length<=1500&&Array.isArray(d.acts)&&d.acts.length>0&&d.acts.length<=40&&d.acts.every(a=>isObj(a)&&typeof a.name==='string'&&a.name.length<=100&&Number.isInteger(a.play)&&a.play>=0&&a.play<=240&&Number.isInteger(a.change)&&a.change>=0&&a.change<=120&&(a.id===undefined||typeof a.id==='string'&&/^[a-f0-9]{12}$/.test(a.id))&&(a.kind===undefined||a.kind==='break')&&(a.url===undefined||typeof a.url==='string'&&a.url.length<=500&&/^(|https?:\/\/\S+)$/.test(a.url)))}
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
// 共通の応答
const fail=(message,status,extra)=>json({error:message},status,extra);
const NOT_FOUND=()=>fail('ページが見つかりません',404),INVALID=()=>fail('入力内容を確認してください',400),CONFLICT=()=>fail('同時に更新されました。ページを再読み込みしてください。',409);
const STALE=()=>fail('別の画面で更新されています。この下書きを控えてからページを再読み込みしてください。',409);
const RATE_LIMITED=()=>fail('短時間に作成できる上限に達しました。1時間ほどおいて再度お試しください。',429,{'Retry-After':'3600'});
// Authorization: Bearer の秘密キー（48桁の16進数）。形式が違えば null
const bearer=req=>{const t=req.headers.get('Authorization')?.replace(/^Bearer /,'');return t&&/^[a-f0-9]{48}$/.test(t)?t:null};
// 受け取ったJSON。上限はバイト数（Content-Length）と文字数の両方で確認する
async function readJson(req,{maxBytes,maxChars}){
 if(!req.headers.get('Content-Type')?.includes('application/json'))return {error:fail('JSON形式で送信してください',415)};
 if(Number(req.headers.get('Content-Length'))>maxBytes)return {error:fail('入力内容が長すぎます',413)};
 try{const raw=await req.text();if(raw.length>maxChars)return {error:fail('入力内容が長すぎます',413)};return {body:JSON.parse(raw)}}catch{return {error:fail('入力内容を読み込めません',400)}}
}
// R2の読み書き。保存期限はオブジェクトの情報にも入れ、定期削除で一覧から判定できるようにする
const expiryMeta=r=>({customMetadata:{expiresAt:r.expiresAt||''}});
async function getRecord(env,key){const obj=await env.BUCKET.get(key);if(!obj)return null;return {obj,record:await obj.json()}}
const putNew=(env,key,record)=>env.BUCKET.put(key,JSON.stringify(record),expiryMeta(record));
// etagが読み出し時と同じときだけ書き込む（同時更新の検出）。書き込めたら true
const putIf=async(env,key,record,etag)=>!!await env.BUCKET.put(key,JSON.stringify(record),{...expiryMeta(record),onlyIf:{etagMatches:etag}});
const GONE='イベントが見つかりません。削除されたか、保存期間が終了した可能性があります。';
async function authorize(req,env,id){
 const token=bearer(req);if(!token)return {error:fail('編集リンクが必要です',403)};
 const found=await getRecord(env,'events/'+id);if(!found||expired(found.record))return {error:fail(GONE,404)};
 if(found.record.editHash!==await digest(token))return {error:fail('編集リンクが正しくありません',403)};
 return {...found,token};
}
// 別ドメイン（GitHub Pages）からの利用を許可するオリジン。環境変数 ALLOWED_ORIGINS（カンマ区切り）で上書き可能
export const DEFAULT_ALLOWED_ORIGINS='https://shiori.whathides.co.jp';
const allowedOrigins=env=>(env.ALLOWED_ORIGINS??DEFAULT_ALLOWED_ORIGINS).split(',').map(s=>s.trim()).filter(Boolean);
const originAllowed=(req,env)=>{const o=req.headers.get('Origin');return !o||o===new URL(req.url).origin||allowedOrigins(env).includes(o)};
// 利用計測を応答後に書き込むため、リクエストごとの実行コンテキスト（waitUntil）を保持する
const ctxs=new WeakMap();
export async function api(req,env,ctx){
 if(ctx)ctxs.set(req,ctx);
 const origin=req.headers.get('Origin'),cors=origin&&allowedOrigins(env).includes(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
 if(req.method==='OPTIONS'){
  if(!cors['Access-Control-Allow-Origin'])return fail('許可されていない操作です',403);
  return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST, PUT, DELETE','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'86400'}});
 }
 let res;try{res=await route(req,env)}catch{res=fail('保存処理に失敗しました。時間をおいて再度お試しください。',500);await track(req,env,'error')}
 for(const [k,v] of Object.entries(cors))res.headers.set(k,v);
 return res;
}
async function route(req,env){
 const url=new URL(req.url);if(url.pathname==='/api/admin/list')return adminList(req,env,url);if(url.pathname==='/api/admin/stats')return adminStats(req,env,url);
 const isSetlist=/^\/api\/setlists(\/|$)/.test(url.pathname),match=url.pathname.match(/^\/api\/events(?:\/([a-f0-9]{24})(?:\/slots\/([a-f0-9]{12})\/(connect-key|connect|link))?)?$/);if(!match&&!isSetlist)return NOT_FOUND();
 if(!env.BUCKET)return fail('保存先の準備ができていません。時間をおいて再度お試しください。',503);
 if(!['GET','POST','PUT','DELETE'].includes(req.method))return fail('対応していない操作です',405);
 if(req.method!=='GET'&&!originAllowed(req,env))return fail('許可されていない操作です',403);
 if(isSetlist)return setlistRoute(req,env,url);
 if(match[2])return slotRoute(req,env,match[1],match[2],match[3]);
 return eventRoute(req,env,match[1]);
}
// イベント。保存先は events/{id}
const EVENT_MAX={maxBytes:30000,maxChars:30000};
const cleanEvent=d=>({title:d.title,date:d.date,open:d.open||'',end:d.end||'',...(d.charge!==undefined?{charge:d.charge}:{}),...(d.drinks!==undefined?{drinks:d.drinks}:{}),start:d.start,venue:d.venue,...(d.venueUrl?{venueUrl:d.venueUrl}:{}),note:d.note,acts:d.acts.map(a=>({...(a.id?{id:a.id}:{}),name:a.name,play:a.play,change:a.kind==='break'?0:a.change,...(a.kind?{kind:a.kind}:{}),...(a.url&&a.kind!=='break'?{url:a.url}:{})}))});
async function eventRoute(req,env,id){
 // 閲覧：公開中で紐づけが一致するセトリへの導線を付ける。編集キーを持つ人には運営情報（manage）も返す
 if(req.method==='GET'&&id){
  const found=await getRecord(env,'events/'+id);if(!found)return fail(GONE,404);const {record}=found;
  if(expired(record)){await env.BUCKET.delete('events/'+id);return fail(GONE,404)}
  const linked=await slotSetlists(env,id,record),token=bearer(req),isEditor=!!token&&record.editHash===await digest(token);if(!isEditor)await track(req,env,'event_view');
  return json({data:record.data,revision:record.revision,updatedAt:record.updatedAt,expiresAt:record.expiresAt??null,plan:record.plan==='paid'?'paid':'free',setlists:publicSetlists(linked),...(isEditor?{manage:manageOf(record,linked)}:{})});
 }
 if(req.method==='DELETE'&&id){const {error}=await authorize(req,env,id);if(error)return error;await env.BUCKET.delete('events/'+id);await track(req,env,'event_delete');return json({deleted:true})}
 if(!(req.method==='POST'&&!id||req.method==='PUT'&&id))return NOT_FOUND();
 const {error:bodyError,body}=await readJson(req,EVENT_MAX);if(bodyError)return bodyError;
 if(!isObj(body)||!valid(body.data))return INVALID();
 const data=cleanEvent(body.data);assignSlotIds(data);const ids=data.acts.map(a=>a.id),now=Date.now();
 if(!id){
  if(await rateLimited(req,env))return RATE_LIMITED();
  const eventId=random().slice(0,24),editToken=random(),plan='free',record={data,plan,editHash:await digest(editToken),revision:1,updatedAt:new Date(now).toISOString(),expiresAt:computeExpiry(data,plan,now)};
  await putNew(env,'events/'+eventId,record);await track(req,env,'event_create');
  return json({id:eventId,editToken,revision:1,updatedAt:record.updatedAt,expiresAt:record.expiresAt,ids,manage:manageOf(record,{})},201);
 }
 const {error,obj,record}=await authorize(req,env,id);if(error)return error;
 if(body.revision!==record.revision)return STALE();
 const next={...record,...pruneSlots(record,data),data,revision:record.revision+1,updatedAt:new Date(now).toISOString(),expiresAt:computeExpiry(data,record.plan||'free',now)};
 if(!await putIf(env,'events/'+id,next,obj.etag))return CONFLICT();
 await track(req,env,'event_update');
 return json({id,revision:next.revision,updatedAt:next.updatedAt,expiresAt:next.expiresAt,ids,manage:manageOf(next,await slotSetlists(env,id,next))});
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
const SETLIST_MAX={maxBytes:450000,maxChars:150000};
// 対象が存在しない・期限切れ・キー不一致はすべて同じ404（未公開セトリの存在を推測させない）
async function setlistAuth(req,env,id,roles){
 const gone={error:fail(SETLIST_GONE,404)},found=await getRecord(env,'setlists/'+id);if(!found)return gone;const {obj,record}=found;
 if(expired(record)){await env.BUCKET.delete('setlists/'+id);return gone}
 const token=bearer(req);if(!token)return gone;
 const hash=await digest(token),role=hash===record.editHash?'edit':hash===record.memberHash?'member':null;if(!role)return gone;
 if(!roles.includes(role))return {error:fail('編集リンクが必要です',403)};
 return {obj,record,role,token};
}
// セトリ側から紐づけを外したとき、イベント側もこのセトリを指していれば外す（失敗しても読み出し時の一致判定で無効になる）
async function unlinkEvent(env,setlistId,link){try{const found=await getRecord(env,'events/'+link.eventId);if(!found||found.record.links?.[link.slotId]?.setlistId!==setlistId)return;const links={...found.record.links};delete links[link.slotId];await putIf(env,'events/'+link.eventId,{...found.record,links},found.obj.etag)}catch{}}
async function setlistRoute(req,env,url){
 const match=url.pathname.match(/^\/api\/setlists(?:\/([a-f0-9]{24})(\/public|\/keys|\/publish|\/link)?)?$/);if(!match)return NOT_FOUND();
 const [,id,sub]=match,now=Date.now();
 if(req.method==='GET'&&id&&sub==='/public'){const record=(await getRecord(env,'setlists/'+id))?.record;if(!record||expired(record)||!record.publication)return fail(SETLIST_GONE,404);const back=record.link?.backLink&&await eventOfLink(env,id,record.link);await track(req,env,'public_view');return json({data:record.publication.data,publishedAt:record.publication.publishedAt,...(back?{event:{id:record.link.eventId,title:back.ev.data.title}}:{})})}
 if(req.method==='POST'&&!id){
  const {error,body}=await readJson(req,SETLIST_MAX);if(error)return error;
  if(!isObj(body)||!validSetlist(body.data))return INVALID();
  if(await rateLimited(req,env))return RATE_LIMITED();
  const data=cleanSetlist(body.data),setlistId=random().slice(0,24),editToken=random(),plan='free',member=await memberToken(editToken,1);
  const record={data,plan,editHash:await digest(editToken),memberHash:await digest(member),memberGen:1,publication:null,revision:1,updatedAt:new Date(now).toISOString(),expiresAt:computeExpiry(data,plan,now)};
  await putNew(env,'setlists/'+setlistId,record);await track(req,env,'setlist_create');
  return json({id:setlistId,editToken,memberToken:member,memberGen:1,revision:1,updatedAt:record.updatedAt,expiresAt:record.expiresAt},201);
 }
 if(!id||(sub&&!((sub==='/keys'||sub==='/publish'||sub==='/link')&&req.method==='POST'||sub==='/link'&&req.method==='DELETE')))return NOT_FOUND();
 if(req.method==='GET'){const {error,record,role}=await setlistAuth(req,env,id,['edit','member']);if(error)return error;if(role==='member')await track(req,env,'member_view');return json({data:record.data,role,revision:record.revision,updatedAt:record.updatedAt,expiresAt:record.expiresAt??null,publication:publicationStatus(record),link:await linkInfo(env,id,record.link),...(role==='edit'?{memberGen:record.memberGen}:{})})}
 const {error,obj,record,token}=await setlistAuth(req,env,id,['edit']);if(error)return error;
 const put=async next=>await putIf(env,'setlists/'+id,next,obj.etag)?null:CONFLICT();
 if(req.method==='DELETE'&&sub==='/link'){if(record.link){const conflict=await put({...record,link:null});if(conflict)return conflict;await unlinkEvent(env,id,record.link);await track(req,env,'unlink')}return json({linked:false})}
 if(req.method==='DELETE'){await env.BUCKET.delete('setlists/'+id);if(record.link)await unlinkEvent(env,id,record.link);await track(req,env,'setlist_delete');return json({deleted:true})}
 const {error:bodyError,body}=await readJson(req,SETLIST_MAX);if(bodyError)return bodyError;if(!isObj(body))return INVALID();
 // キーの再発行：メンバー用は世代を進めて旧リンクを無効化。編集用は新しいキーに置き換え（導出元が変わるためメンバー用リンクも変わる）
 if(sub==='/keys'){
  if(body.kind!=='member'&&body.kind!=='edit')return INVALID();
  const editToken=body.kind==='edit'?random():token,memberGen=body.kind==='member'?record.memberGen+1:record.memberGen,member=await memberToken(editToken,memberGen);
  const conflict=await put({...record,editHash:await digest(editToken),memberHash:await digest(member),memberGen});if(conflict)return conflict;
  return json({memberGen,memberToken:member,...(body.kind==='edit'?{editToken}:{})});
 }
 // 公開・公開更新：保存済みの最新revisionを確認し、その内容から公開スナップショットを作る。公開停止：スナップショットを消す（内部データは残す）
 if(sub==='/publish'){
  if(body.action==='unpublish'){if(record.publication){const conflict=await put({...record,publication:null});if(conflict)return conflict;await track(req,env,'unpublish')}return json({published:false})}
  if(body.action!=='publish')return INVALID();
  if(body.revision!==record.revision)return fail('別の画面で更新されています。ページを再読み込みし、内容を確認してから公開してください。',409);
  if(!record.data.items.some(i=>i.kind==='song'))return fail('公開するには曲を1曲以上登録してください。',400);
  const at=new Date(now).toISOString(),version=(record.publishedVersion||0)+1,next={...record,publication:{data:toPublic(record.data),revision:record.revision,version,publishedAt:at},publishedVersion:version,firstPublishedAt:record.firstPublishedAt||at};
  const conflict=await put(next);if(conflict)return conflict;
  await track(req,env,record.publication?'publish_update':record.firstPublishedAt?'republish':'publish_first');
  return json(publicationStatus(next));
 }
 // 出演枠への紐づけ：紐づけ用キーとセトリ編集権限の両方が必要。セトリ側→イベント側の順に条件付きで書き込み、イベント側で失敗したらセトリ側を戻す
 if(sub==='/link'){
  if(body.connectToken===undefined){if(typeof body.backLink!=='boolean')return INVALID();if(!record.link||!await eventOfLink(env,id,record.link))return fail('紐づいているイベントがありません。',404);const conflict=await put({...record,link:{...record.link,backLink:body.backLink}});if(conflict)return conflict;return json({link:await linkInfo(env,id,{...record.link,backLink:body.backLink})})}
  const {eventId,slotId,connectToken:ct}=body;if(typeof eventId!=='string'||!/^[a-f0-9]{24}$/.test(eventId)||typeof slotId!=='string'||!/^[a-f0-9]{12}$/.test(slotId)||typeof ct!=='string'||!/^[a-f0-9]{48}$/.test(ct)||(body.backLink!==undefined&&typeof body.backLink!=='boolean'))return INVALID();
  const evFound=await getRecord(env,'events/'+eventId),eo=evFound?.obj,ev=evFound?.record;
  if(!ev||expired(ev)||!playable(ev,slotId)||ev.connect?.[slotId]?.hash!==await digest(ct))return fail(CONNECT_GONE,404);
  if(record.link&&await eventOfLink(env,id,record.link)){if(record.link.eventId===eventId&&record.link.slotId===slotId)return json({link:await linkInfo(env,id,record.link)});return fail('このセトリはすでに別の出演枠に紐づいています。先に紐づけを解除してください。',409)}
  const current=ev.links?.[slotId];if(current&&current.setlistId!==id&&await linkedSetlist(env,eventId,slotId,current.setlistId))return fail('この出演枠にはすでに別のセトリが紐づいています。主催者に解除を依頼してください。',409);
  const at=new Date(now).toISOString(),link={eventId,slotId,backLink:body.backLink===true,linkedAt:at};
  const conflict=await put({...record,link});if(conflict)return conflict;
  if(!await putIf(env,'events/'+eventId,{...ev,links:{...ev.links,[slotId]:{setlistId:id,linkedAt:at}}},eo.etag)){
   try{const cur=await getRecord(env,'setlists/'+id);if(cur?.record.link?.linkedAt===at)await putIf(env,'setlists/'+id,{...cur.record,link:record.link||null},cur.obj.etag)}catch{}
   return fail('イベント側が同時に更新されました。もう一度お試しください。',409);
  }
  await track(req,env,'link');
  return json({link:await linkInfo(env,id,link)});
 }
 if(req.method!=='PUT')return NOT_FOUND();
 if(!validSetlist(body.data))return INVALID();
 if(body.revision!==record.revision)return STALE();
 const data=cleanSetlist(body.data),next={...record,data,revision:record.revision+1,updatedAt:new Date(now).toISOString(),expiresAt:computeExpiry(data,record.plan||'free',now)};
 const conflict=await put(next);if(conflict)return conflict;
 await track(req,env,'setlist_update');
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
async function linkedSetlist(env,eventId,slotId,setlistId){const r=(await getRecord(env,'setlists/'+setlistId))?.record;if(!r)return null;return !expired(r)&&r.link?.eventId===eventId&&r.link?.slotId===slotId?r:null}
async function slotSetlists(env,eventId,record){const found={};await Promise.all(Object.entries(record.links||{}).map(async([slotId,l])=>{if(!playable(record,slotId))return;const r=await linkedSetlist(env,eventId,slotId,l.setlistId);if(r)found[slotId]={id:l.setlistId,record:r}}));return found}
// 閲覧者向け：公開中のセトリだけ（公開前のID・タイトル等は含めない）
const publicSetlists=found=>Object.fromEntries(Object.entries(found).filter(([,f])=>f.record.publication).map(([slotId,f])=>[slotId,{id:f.id,title:f.record.publication.data.title}]));
// 主催者向け：紐づけの有無・公開状態・紐づけ用キーの世代のみ（公開前の内容は返さない）
const manageOf=(record,found)=>Object.fromEntries(record.data.acts.filter(a=>a.kind!=='break').map(a=>[a.id,{connectGen:record.connect?.[a.id]?.gen||0,linked:!!found[a.id],published:!!found[a.id]?.record.publication}]));
async function eventOfLink(env,setlistId,link){if(!link)return null;const ev=(await getRecord(env,'events/'+link.eventId))?.record;if(!ev)return null;const slot=!expired(ev)&&playable(ev,link.slotId);return slot&&ev.links?.[link.slotId]?.setlistId===setlistId?{ev,slot}:null}
async function linkInfo(env,setlistId,link){if(!link)return null;const found=await eventOfLink(env,setlistId,link);if(!found)return {valid:false};return {valid:true,eventId:link.eventId,slotId:link.slotId,backLink:!!link.backLink,event:{title:found.ev.data.title,date:found.ev.data.date,venue:found.ev.data.venue},slot:{name:found.slot.name,play:found.slot.play}}}
async function slotRoute(req,env,id,slotId,action){
 // 紐づけ用リンクを開いた出演者向け：紐づけ用キーで出演枠の情報を返す
 if(action==='connect'&&req.method==='GET'){
  const token=bearer(req),record=(await getRecord(env,'events/'+id))?.record,slot=record&&!expired(record)&&playable(record,slotId);
  if(!slot||!token||record.connect?.[slotId]?.hash!==await digest(token))return fail(CONNECT_GONE,404);
  const current=record.links?.[slotId],taken=!!current&&!!await linkedSetlist(env,id,slotId,current.setlistId);
  return json({event:{title:record.data.title,date:record.data.date,venue:record.data.venue,start:record.data.start},slot:{name:slot.name,play:slot.play},taken,setlistId:taken?current.setlistId:null});
 }
 const {error,obj,record,token}=await authorize(req,env,id);if(error)return error;
 if(!playable(record,slotId))return fail('出演枠が見つかりません。保存してから再度お試しください。',404);
 const save=async next=>await putIf(env,'events/'+id,next,obj.etag)?null:CONFLICT();
 // 紐づけ用キーの発行・再発行（世代を進めて旧リンクを無効化）
 if(action==='connect-key'&&req.method==='POST'){
  const gen=(record.connect?.[slotId]?.gen||0)+1,ct=await connectToken(token,slotId,gen);
  const conflict=await save({...record,connect:{...record.connect,[slotId]:{gen,hash:await digest(ct)}}});if(conflict)return conflict;
  return json({connectGen:gen,connectToken:ct});
 }
 // 主催者による解除：イベント側だけを外す（セトリ本体・権限は変更しない）
 if(action==='link'&&req.method==='DELETE'){
  if(record.links?.[slotId]){const links={...record.links};delete links[slotId];const conflict=await save({...record,links});if(conflict)return conflict;await track(req,env,'unlink')}
  return json({linked:false});
 }
 return NOT_FOUND();
}
// 利用計測：操作の種類ごとの延べ回数を、日本時間の日別に stats/YYYY-MM（月ごとに1オブジェクト）へ記録する
// 誰が・どこから・何を、は記録しない。同時更新はetag条件付きで数回やり直すが、取りこぼし得るため概数として扱う。計測の失敗で本来の処理を止めない
export const METRICS=['event_view','public_view','member_view','event_create','event_update','event_delete','setlist_create','setlist_update','setlist_delete','publish_first','republish','publish_update','unpublish','link','unlink','error'];
const jstDay=(t=Date.now())=>new Date(t+9*36e5).toISOString().slice(0,10);
async function bump(env,metric){
 if(!env.BUCKET)return;const day=jstDay(),key='stats/'+day.slice(0,7);
 for(let i=0;i<4;i++){const obj=await env.BUCKET.get(key),data=obj?await obj.json():{},d=data[day]||(data[day]={});d[metric]=(d[metric]||0)+1;
  if(await env.BUCKET.put(key,JSON.stringify(data),obj?{onlyIf:{etagMatches:obj.etag}}:undefined))return}
}
async function track(req,env,metric){const p=bump(env,metric).catch(()=>{}),ctx=ctxs.get(req);if(ctx?.waitUntil)ctx.waitUntil(p);else await p}
async function adminAuth(req,env){
 if(req.method!=='GET')return fail('対応していない操作です',405);
 if(!env.BUCKET)return fail('保存先の準備ができていません。',503);
 const token=req.headers.get('Authorization')?.replace(/^Bearer /,''); // 管理キーは利用者が決める値なので形式を限定しない
 if(!env.ADMIN_TOKEN)return fail('管理画面は設定されていません。',403);
 if(!token||await digest(token)!==await digest(env.ADMIN_TOKEN))return fail('管理キーが正しくありません。',403);
 return null;
}
// 直近90日（日本時間）の日別の回数。月ごとのオブジェクト最大4つを読む
async function adminStats(req,env){
 const denied=await adminAuth(req,env);if(denied)return denied;
 const now=Date.now(),days=Array.from({length:90},(_,i)=>jstDay(now-i*864e5)),months=[...new Set(days.map(d=>d.slice(0,7)))],data={};
 for(const m of months){const obj=await env.BUCKET.get('stats/'+m);if(obj)Object.assign(data,await obj.json())}
 return json({metrics:METRICS,days:days.map(date=>({date,...Object.fromEntries(METRICS.map(k=>[k,data[date]?.[k]||0]))}))});
}
// 運営管理：管理キー（環境変数 ADMIN_TOKEN）を持つ人だけが、イベント・セトリの状態の一覧を取得できる
// 入力内容（タイトル・日付・会場・曲名・メモ等）、秘密キー、完全なID（閲覧ページを開けてしまう）は返さない
const ADMIN_PAGE=40; // 一覧1回＋読み出し40回。Workers無料プランのサブリクエスト上限（50）に収める
async function adminList(req,env,url){
 const denied=await adminAuth(req,env);if(denied)return denied;
 const type=url.searchParams.get('type');if(type!=='events'&&type!=='setlists')return INVALID();
 const cursor=url.searchParams.get('cursor')||undefined,page=await env.BUCKET.list({prefix:type+'/',cursor,limit:ADMIN_PAGE});
 const items=(await Promise.all(page.objects.map(async o=>{const obj=await env.BUCKET.get(o.key);if(!obj)return null;const r=await obj.json(),base={id:o.key.split('/')[1].slice(0,6),updatedAt:r.updatedAt||null,revision:r.revision||0,expiresAt:r.expiresAt||null,expired:expired(r),plan:r.plan==='paid'?'paid':'free'};
  if(type==='events'){const acts=r.data?.acts||[],slots=acts.filter(a=>a.kind!=='break');return {...base,slots:slots.length,breaks:acts.length-slots.length,connectKeys:Object.keys(r.connect||{}).length,links:Object.keys(r.links||{}).length}}
  const its=r.data?.items||[];return {...base,songs:its.filter(i=>i.kind==='song').length,items:its.length,videos:(r.data?.videos||[]).length,published:!!r.publication,publishedAt:r.publication?.publishedAt||null,firstPublishedAt:r.firstPublishedAt||null,publishedVersion:r.publishedVersion||0,linked:!!r.link,memberGen:r.memberGen||1};
 }))).filter(Boolean);
 return json({items,cursor:page.truncated?page.cursor:null});
}
// 定期実行（Cron Trigger）用：期限切れのイベント・セトリ、古いレート制限カウンタ、保管期間（約90日）を過ぎた利用計測を削除
export async function cleanup(env){
 const counts={events:0,setlists:0,ratelimit:0,stats:0};if(!env.BUCKET)return counts;
 const now=Date.now(),hour=Math.floor(now/36e5),isExpired=o=>o.customMetadata?.expiresAt&&Date.parse(o.customMetadata.expiresAt)<now;
 for(const [prefix,isDead] of [['events/',isExpired],['setlists/',isExpired],['ratelimit/',o=>Number(o.key.split('/')[1])<hour-1],['stats/',o=>o.key.slice(6)<jstDay(now-95*864e5).slice(0,7)]]){
  let cursor;do{const page=await env.BUCKET.list({prefix,cursor,include:['customMetadata']});const dead=page.objects.filter(isDead).map(o=>o.key);if(dead.length){await env.BUCKET.delete(dead);counts[prefix.slice(0,-1)]+=dead.length}cursor=page.truncated?page.cursor:undefined}while(cursor);
 }
 return counts;
}
