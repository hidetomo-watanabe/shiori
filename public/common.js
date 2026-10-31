// 画面共通の部品。app.js・setlist.js・pages.js から window.shiori として使う（このファイルを先に読み込む）
window.shiori=(()=>{
const API=(document.querySelector('meta[name="api-base"]')?.content||'').replace(/\/$/,'');
const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jst=(iso,withTime)=>new Date(iso).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',...(withTime?{hour:'2-digit',minute:'2-digit'}:{})});
const jpDate=d=>new Date(d+'T12:00:00+09:00').toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',weekday:'short'});
const host=u=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return u}};
// URL入力：前後の空白を除き、スキームがなければ https:// を補う。http(s) 以外・500字超は null
const normUrl=v=>{v=v.trim();const other=/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(v)&&!/^https?:/i.test(v);if(v&&!/^https?:\/\//i.test(v))v='https://'+v;return v===''||!other&&/^https?:\/\/\S+$/.test(v)&&v.length<=500?v:null};const MONEY={charge:1000000,drinks:9};function fillForm(){for(const k of FIELDS)$(k).value=state[k]??'';for(const k in MONEY)$(k).value=state[k]??'';acts();}
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
// API呼び出し：失敗時は利用者向けの文言と status 付きの Error を投げる
const apiCall=async(path,options={})=>{let r;try{r=await fetch(API+path,{cache:'no-store',...options})}catch{throw Error('通信に失敗しました。電波の良い場所で再度お試しください。')}let body=null;try{body=await r.json()}catch{}if(!r.ok||!body)throw Object.assign(Error(body?.error||(r.status===429?'短時間に作成できる上限に達しました。時間をおいて再度お試しください。':r.status>=500?'サーバーで問題が発生しました。時間をおいて再度お試しください。':'通信に失敗しました（'+r.status+'）。時間をおいて再度お試しください。')),{status:r.status});return body;};
const noindex=()=>{const m=document.createElement('meta');m.name='robots';m.content='noindex';document.head.append(m);document.querySelector('link[rel=canonical]')?.remove()};
// リンクのキーが変わったら、マイキーを設定している場合は同期する（同じ値の書き直しでは同期しない）
const store=(k,v)=>{const changed=(v||'')!==load(k);try{if(v)localStorage.setItem(k,v);else localStorage.removeItem(k)}catch{}if(changed&&LINK_KEY.test(k)&&load(MYKEY))syncKeys().catch(()=>{})},load=k=>{try{return localStorage.getItem(k)||''}catch{return ''}};
// マイキー（?page=mine で設定。有料化の対象）：このブラウザにあるリンクのキーの一覧を、マイキーから作った鍵で暗号化してサーバーに置き、同じマイキーの端末どうしで揃える
// 前回同期した一覧（MYBASE）と比べ、このブラウザで変わった分（追加・削除・作り直し）はこちらを、変わっていない分はサーバー側を採る
const MYKEY='live-shiori-v1-mykey',MYBASE='live-shiori-v1-mykey-base',LINK_KEY=/^live-shiori-v1-(edit|setlist-edit|setlist-member)-[a-f0-9]{24}$/;
// サーバーには、マイキーそのものではなく照合用の値（マイキーから導出）だけを送る
const accountAuth=async my=>({Authorization:'Bearer '+(await sha(my+':account')).slice(0,48)});
// このブラウザにあるリンクのキー：{保存名: キー}。保存名から種類（edit=イベント編集／setlist-edit／setlist-member）とIDを読み取れる
const linkKeys=()=>{const o={};try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(LINK_KEY.test(k))o[k]=localStorage.getItem(k)}}catch{}return o};
const sameKeys=(a,b)=>Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>a[k]===b[k]);
const aesKey=async my=>crypto.subtle.importKey('raw',Uint8Array.from((await sha(my+':enc')).match(/../g),h=>parseInt(h,16)),'AES-GCM',false,['encrypt','decrypt']);
const seal=async(key,o)=>{const iv=crypto.getRandomValues(new Uint8Array(12)),ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(o))));return btoa(String.fromCharCode(...iv,...ct))};
const unseal=async(key,s)=>{try{const b=Uint8Array.from(atob(s),c=>c.charCodeAt(0)),o=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:b.slice(0,12)},key,b.slice(12))));return Object.fromEntries(Object.entries(isObj(o)?o:{}).filter(([k,v])=>LINK_KEY.test(k)&&/^[a-f0-9]{48}$/.test(v)))}catch{throw Error('マイキーの一覧を読み込めませんでした。')}};
async function syncOnce(){
 const my=load(MYKEY);if(!/^[a-f0-9]{48}$/.test(my))return null;
 const headers=await accountAuth(my),key=await aesKey(my);
 for(let n=0;n<3;n++){
  let remote={},revision=0;try{const r=await apiCall('/api/account',{headers});remote=await unseal(key,r.data);revision=r.revision}catch(e){if(e.status!==404)throw e}
  let base={};try{base=JSON.parse(load(MYBASE))||{}}catch{}
  const local=linkKeys(),next={};for(const k of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){const v=local[k]!==base[k]?local[k]:remote[k];if(v)next[k]=v}
  if(!revision||!sameKeys(next,remote))try{await apiCall('/api/account',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({data:await seal(key,next),revision})})}catch(e){if(e.status===409)continue;throw e}
  try{for(const k in local)if(!next[k])localStorage.removeItem(k);for(const k in next)localStorage.setItem(k,next[k]);localStorage.setItem(MYBASE,JSON.stringify(next))}catch{}
  return Object.keys(next).length;
 }
 throw Error('同期が混み合っています。時間をおいて再度お試しください。');
}
// 同期は1つずつ順に行う。まだ始まっていない同期があればそれにまとめる（削除で複数のキーを続けて消すときなど）。戻り値は同期後のキーの数（マイキー未設定なら null）
let syncing=Promise.resolve(),queued=null;const syncKeys=()=>queued||(queued=syncing=syncing.catch(()=>{}).then(()=>{queued=null;return syncOnce()}));
// 押したボタンから離れた案内欄だと気づきにくいため、コピー・共有の結果は画面下の通知（トースト）で出す。保存ボタンの下の保存状態の案内は上書きしない
const toast=msg=>{let t=document.getElementById('toast');if(!t){t=document.createElement('div');t.id='toast';t.setAttribute('aria-live','polite');document.body.append(t)}t.textContent=msg;t.classList.add('show');clearTimeout(t.timer);t.timer=setTimeout(()=>t.classList.remove('show'),4000)};
// text を渡すと、リンクの代わりにその文面（名前・日時・リンク）をコピーする。コピーできない端末ではリンクの欄を選択する
const copyText=async(input,done,fail='リンクを選択しました。コピーしてください。',text=input.value)=>{try{await navigator.clipboard.writeText(text);toast(done)}catch{input.select();toast(fail)}};
// LINEで送る：LINE公式の共有URL（アプリが開き、送る相手を選べる）
// PCでは共有URLがLINEアプリを開けずLINEのトップページに飛び、コピーと同じことしかできないため「LINEで送る」を隠す（.pc。style.css）。iPadはMacとして名乗るのでタッチ対応で判定
const isMobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||navigator.maxTouchPoints>1&&/Macintosh/.test(navigator.userAgent);
if(!isMobile)document.documentElement.classList.add('pc');
const lineShare=async text=>{if(isMobile){window.open('https://line.me/R/share?text='+encodeURIComponent(text),'_blank','noopener');return}try{await navigator.clipboard.writeText(text);toast('送る内容をコピーしました。PCのLINEでトークを開き、貼り付けて送ってください。')}catch{toast('コピーできませんでした。「名前とリンクをコピー」から送ってください。')}};
// 閲覧ページの共有ボタン：編集ページと同じ「名前とリンクをコピー」「LINEで送る」（PCでは隠す）。見た人が転送するときも名前が分かるよう、名前入りの文面を送る
const viewShare=text=>{const $=id=>document.getElementById(id);$('view-share').hidden=false;$('view-copy').onclick=async()=>{try{await navigator.clipboard.writeText(text);toast('名前とリンクをコピーしました。LINE などに貼り付けて送ってください。')}catch{toast('コピーできませんでした。')}};$('view-send').onclick=()=>lineShare(text)};
// 印刷：ポスター（タイムテーブル・セトリ）だけを印刷する。プレビューと同じ配色か、白地・黒文字（インク節約）を選べる（見た目は style.css の @media print）
document.addEventListener('click',e=>{const b=e.target.closest('.print-btn');if(!b)return;document.documentElement.classList.toggle('print-light',b.dataset.print==='light');window.print()});
// A4縦1枚（印刷範囲 180×273mm ≒ 680×1032px。端数で2枚目にはみ出さないよう少し余らせる）に収まるよう縮小率を求める（半分より小さくはせず、超える分は次のページへ）。濃い配色は用紙の下まで伸ばす。ブラウザのメニューから印刷した場合も同じ
window.addEventListener('beforeprint',()=>{const p=document.getElementById('poster'),root=document.documentElement;if(!p)return;p.style.width='680px';const z=Math.max(.5,Math.min(1,1016/p.offsetHeight));p.style.width='';root.style.setProperty('--print-zoom',z);root.style.setProperty('--print-h',Math.floor(1016/z)+'px')});
window.addEventListener('afterprint',()=>document.documentElement.classList.remove('print-light'));
// 開いたときにも同期しておく（別の端末で作ったものを取り込む）。?page=mine は一覧を出す前に自分で同期する
if(load(MYKEY)&&new URLSearchParams(location.search).get('page')!=='mine')syncKeys().catch(()=>{});
return {API,isObj,esc,jst,jpDate,host,normUrl,sha,apiCall,noindex,store,load,toast,copyText,isMobile,lineShare,viewShare,MYKEY,MYBASE,accountAuth,linkKeys,syncKeys};
})();
