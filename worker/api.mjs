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
export function valid(d){return isObj(d)&&typeof d.title==='string'&&d.title.length<=100&&typeof d.date==='string'&&/^(|\d{4}-\d{2}-\d{2})$/.test(d.date)&&typeof d.start==='string'&&/^([01]\d|2\d):[0-5]\d$/.test(d.start)&&(d.open===undefined||typeof d.open==='string'&&/^(|([01]\d|2\d):[0-5]\d)$/.test(d.open))&&(d.charge===undefined||Number.isInteger(d.charge)&&d.charge>=0&&d.charge<=1000000)&&(d.drinks===undefined||Number.isInteger(d.drinks)&&d.drinks>=0&&d.drinks<=9)&&(d.end===undefined||typeof d.end==='string'&&/^(|([01]\d|2\d):[0-5]\d)$/.test(d.end))&&typeof d.venue==='string'&&d.venue.length<=100&&typeof d.note==='string'&&d.note.length<=1500&&Array.isArray(d.acts)&&d.acts.length>0&&d.acts.length<=40&&d.acts.every(a=>isObj(a)&&typeof a.name==='string'&&a.name.length<=100&&Number.isInteger(a.play)&&a.play>=0&&a.play<=240&&Number.isInteger(a.change)&&a.change>=0&&a.change<=120&&(a.kind===undefined||a.kind==='break')&&(a.url===undefined||typeof a.url==='string'&&a.url.length<=500&&/^(|https?:\/\/\S+)$/.test(a.url)))}
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
 const url=new URL(req.url),isSetlist=/^\/api\/setlists(\/|$)/.test(url.pathname),match=url.pathname.match(/^\/api\/events(?:\/([a-f0-9]{24}))?$/);if(!match&&!isSetlist)return json({error:'ページが見つかりません'},404);
 if(!env.BUCKET)return json({error:'保存先の準備ができていません。時間をおいて再度お試しください。'},503);
 if(!['GET','POST','PUT','DELETE'].includes(req.method))return json({error:'対応していない操作です'},405);
 if(req.method!=='GET'&&!originAllowed(req,env))return json({error:'許可されていない操作です'},403);
 if(isSetlist)return setlistRoute(req,env,url);
 const id=match[1];
 if(req.method==='GET'&&id){const obj=await env.BUCKET.get('events/'+id);if(!obj)return json({error:GONE},404);const record=await obj.json();if(expired(record)){await env.BUCKET.delete('events/'+id);return json({error:GONE},404)}return json({data:record.data,revision:record.revision,updatedAt:record.updatedAt,expiresAt:record.expiresAt??null,plan:record.plan==='paid'?'paid':'free'});}
 if(req.method==='DELETE'&&id){const {error}=await authorize(req,env,id);if(error)return error;await env.BUCKET.delete('events/'+id);return json({deleted:true});}
 if((req.method==='POST'&&!id)||(req.method==='PUT'&&id)){
  if(!req.headers.get('Content-Type')?.includes('application/json'))return json({error:'JSON形式で送信してください'},415);
  if(Number(req.headers.get('Content-Length'))>30000)return json({error:'入力内容が長すぎます'},413);
  let body;try{let raw=await req.text();if(raw.length>30000)return json({error:'入力内容が長すぎます'},413);body=JSON.parse(raw)}catch{return json({error:'入力内容を読み込めません'},400)}
  if(!isObj(body)||!valid(body.data))return json({error:'入力内容を確認してください'},400);
  const data={title:body.data.title,date:body.data.date,open:body.data.open||'',end:body.data.end||'',...(body.data.charge!==undefined?{charge:body.data.charge}:{}),...(body.data.drinks!==undefined?{drinks:body.data.drinks}:{}),start:body.data.start,venue:body.data.venue,note:body.data.note,acts:body.data.acts.map(a=>({name:a.name,play:a.play,change:a.kind==='break'?0:a.change,...(a.kind?{kind:a.kind}:{}),...(a.url&&a.kind!=='break'?{url:a.url}:{})}))};
  const now=Date.now(),meta=r=>({customMetadata:{expiresAt:r.expiresAt||''}});
  if(!id){
   if(await rateLimited(req,env))return json({error:'短時間に作成できる上限に達しました。1時間ほどおいて再度お試しください。'},429,{'Retry-After':'3600'});
   const eventId=random().slice(0,24),editToken=random(),plan='free';const record={data,plan,editHash:await digest(editToken),revision:1,updatedAt:new Date(now).toISOString(),expiresAt:computeExpiry(data,plan,now)};await env.BUCKET.put('events/'+eventId,JSON.stringify(record),meta(record));return json({id:eventId,editToken,revision:1,updatedAt:record.updatedAt,expiresAt:record.expiresAt},201)}
  const {error,obj,record}=await authorize(req,env,id);if(error)return error;
  if(body.revision!==record.revision)return json({error:'別の画面で更新されています。この下書きを控えてからページを再読み込みしてください。'},409);
  const next={...record,data,revision:record.revision+1,updatedAt:new Date(now).toISOString(),expiresAt:computeExpiry(data,record.plan||'free',now)};const result=await env.BUCKET.put('events/'+id,JSON.stringify(next),{...meta(next),onlyIf:{etagMatches:obj.etag}});if(!result)return json({error:'同時に更新されました。ページを再読み込みしてください。'},409);return json({id,revision:next.revision,updatedAt:next.updatedAt,expiresAt:next.expiresAt});
 }
 return json({error:'ページが見つかりません'},404);
}
// セトリ（段階1：作成・編集・メンバー閲覧）。保存先は setlists/{id}。公開スナップショット（publication）は段階2で追加するため、公開APIは常に未公開扱い
// メンバー閲覧キーは編集キーから導出する（編集リンクを持つ人はどの端末でもメンバー用リンクを表示できる。サーバーにはハッシュのみ保持）
const SETLIST_GONE='セトリが見つかりません。リンクが正しくないか、削除・保存期間の終了により見られなくなっています。',SETLIST_KINDS=['song','mc','break'];
const str=(v,max)=>typeof v==='string'&&v.length<=max;
export function validSetlist(d){return isObj(d)&&str(d.title,100)&&str(d.artist,100)&&typeof d.date==='string'&&/^(|\d{4}-\d{2}-\d{2})$/.test(d.date)&&str(d.venue,100)&&str(d.comment,1500)&&str(d.memo,1500)&&Array.isArray(d.items)&&d.items.length>0&&d.items.length<=100&&d.items.every(i=>isObj(i)&&SETLIST_KINDS.includes(i.kind)&&str(i.title,200)&&(i.kind!=='song'||i.title.trim()!=='')&&(i.artist===undefined||i.kind==='song'&&str(i.artist,200))&&(i.sec===null||Number.isInteger(i.sec)&&i.sec>=1&&i.sec<=14400)&&str(i.memo,500))}
const cleanSetlist=d=>({title:d.title,artist:d.artist,date:d.date,venue:d.venue,comment:d.comment,memo:d.memo,items:d.items.map(i=>({kind:i.kind,title:i.title,...(i.kind==='song'?{artist:i.artist||''}:{}),sec:i.sec,memo:i.memo}))});
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
 const match=url.pathname.match(/^\/api\/setlists(?:\/([a-f0-9]{24})(\/public|\/keys)?)?$/);if(!match)return json({error:'ページが見つかりません'},404);
 const [,id,sub]=match,now=Date.now();
 if(req.method==='GET'&&id&&sub==='/public'){const obj=await env.BUCKET.get('setlists/'+id),record=obj&&await obj.json();if(!record||expired(record)||!record.publication)return json({error:SETLIST_GONE},404);return json({data:record.publication.data,publishedAt:record.publication.publishedAt})}
 if(req.method==='POST'&&!id){
  const {error,body}=await readJson(req,SETLIST_MAX);if(error)return error;
  if(!isObj(body)||!validSetlist(body.data))return json({error:'入力内容を確認してください'},400);
  if(await rateLimited(req,env))return json({error:'短時間に作成できる上限に達しました。1時間ほどおいて再度お試しください。'},429,{'Retry-After':'3600'});
  const data=cleanSetlist(body.data),setlistId=random().slice(0,24),editToken=random(),plan='free',member=await memberToken(editToken,1);
  const record={data,plan,editHash:await digest(editToken),memberHash:await digest(member),memberGen:1,publication:null,revision:1,updatedAt:new Date(now).toISOString(),expiresAt:computeExpiry(data,plan,now)};
  await env.BUCKET.put('setlists/'+setlistId,JSON.stringify(record),setlistMeta(record));
  return json({id:setlistId,editToken,memberToken:member,memberGen:1,revision:1,updatedAt:record.updatedAt,expiresAt:record.expiresAt},201);
 }
 if(!id||(sub&&!(sub==='/keys'&&req.method==='POST')))return json({error:'ページが見つかりません'},404);
 if(req.method==='GET'){const {error,record,role}=await setlistAuth(req,env,id,['edit','member']);if(error)return error;return json({data:record.data,role,revision:record.revision,updatedAt:record.updatedAt,expiresAt:record.expiresAt??null,...(role==='edit'?{memberGen:record.memberGen}:{})})}
 const {error,obj,record,token}=await setlistAuth(req,env,id,['edit']);if(error)return error;
 if(req.method==='DELETE'){await env.BUCKET.delete('setlists/'+id);return json({deleted:true})}
 const {error:bodyError,body}=await readJson(req,SETLIST_MAX);if(bodyError)return bodyError;if(!isObj(body))return json({error:'入力内容を確認してください'},400);
 const put=async next=>await env.BUCKET.put('setlists/'+id,JSON.stringify(next),{...setlistMeta(next),onlyIf:{etagMatches:obj.etag}})?null:json({error:'同時に更新されました。ページを再読み込みしてください。'},409);
 // キーの再発行：メンバー用は世代を進めて旧リンクを無効化。編集用は新しいキーに置き換え（導出元が変わるためメンバー用リンクも変わる）
 if(sub==='/keys'){
  if(body.kind!=='member'&&body.kind!=='edit')return json({error:'入力内容を確認してください'},400);
  const editToken=body.kind==='edit'?random():token,memberGen=body.kind==='member'?record.memberGen+1:record.memberGen,member=await memberToken(editToken,memberGen);
  const conflict=await put({...record,editHash:await digest(editToken),memberHash:await digest(member),memberGen});if(conflict)return conflict;
  return json({memberGen,memberToken:member,...(body.kind==='edit'?{editToken}:{})});
 }
 if(req.method!=='PUT')return json({error:'ページが見つかりません'},404);
 if(!validSetlist(body.data))return json({error:'入力内容を確認してください'},400);
 if(body.revision!==record.revision)return json({error:'別の画面で更新されています。この下書きを控えてからページを再読み込みしてください。'},409);
 const data=cleanSetlist(body.data),next={...record,data,revision:record.revision+1,updatedAt:new Date(now).toISOString(),expiresAt:computeExpiry(data,record.plan||'free',now)};
 const conflict=await put(next);if(conflict)return conflict;
 return json({id,revision:next.revision,updatedAt:next.updatedAt,expiresAt:next.expiresAt});
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
