// 画面共通の部品。app.js・setlist.js・pages.js から window.shiori として使う（このファイルを先に読み込む）
window.shiori=(()=>{
const API=(document.querySelector('meta[name="api-base"]')?.content||'').replace(/\/$/,'');
const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jst=(iso,withTime)=>new Date(iso).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',...(withTime?{hour:'2-digit',minute:'2-digit'}:{})});
const jpDate=d=>new Date(d+'T12:00:00+09:00').toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',weekday:'short'});
const host=u=>{try{return new URL(u).hostname.replace(/^www\./,'')}catch{return u}};
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
// API呼び出し：失敗時は利用者向けの文言と status 付きの Error を投げる
const apiCall=async(path,options={})=>{let r;try{r=await fetch(API+path,{cache:'no-store',...options})}catch{throw Error('通信に失敗しました。電波の良い場所で再度お試しください。')}let body=null;try{body=await r.json()}catch{}if(!r.ok||!body)throw Object.assign(Error(body?.error||(r.status===429?'短時間に作成できる上限に達しました。時間をおいて再度お試しください。':r.status>=500?'サーバーで問題が発生しました。時間をおいて再度お試しください。':'通信に失敗しました（'+r.status+'）。時間をおいて再度お試しください。')),{status:r.status});return body;};
const noindex=()=>{const m=document.createElement('meta');m.name='robots';m.content='noindex';document.head.append(m)};
const store=(k,v)=>{try{if(v)localStorage.setItem(k,v);else localStorage.removeItem(k)}catch{}},load=k=>{try{return localStorage.getItem(k)||''}catch{return ''}};
// 押したボタンから離れた案内欄だと気づきにくいため、コピー・共有の結果は画面下の通知（トースト）で出す。保存ボタンの下の保存状態の案内は上書きしない
const toast=msg=>{let t=document.getElementById('toast');if(!t){t=document.createElement('div');t.id='toast';t.setAttribute('aria-live','polite');document.body.append(t)}t.textContent=msg;t.classList.add('show');clearTimeout(t.timer);t.timer=setTimeout(()=>t.classList.remove('show'),4000)};
const copyText=async(input,done,fail='リンクを選択しました。コピーしてください。')=>{try{await navigator.clipboard.writeText(input.value);toast(done)}catch{input.select();toast(fail)}};
// LINEで送る：LINE公式の共有URL（アプリが開き、送る相手を選べる）。端末の共有メニューは、使える端末でだけ「ほかのアプリで送る」として出す
// PCでは共有URLがLINEアプリを開けずLINEのトップページに飛ぶため、送る内容をコピーして貼り付けてもらう（iPadはMacとして名乗るのでタッチ対応で判定）
const isMobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||navigator.maxTouchPoints>1&&/Macintosh/.test(navigator.userAgent);
const lineShare=async text=>{if(isMobile){window.open('https://line.me/R/share?text='+encodeURIComponent(text),'_blank','noopener');return}try{await navigator.clipboard.writeText(text);toast('送る内容をコピーしました。PCのLINEでトークを開き、貼り付けて送ってください。')}catch{toast('コピーできませんでした。「リンクをコピー」から送ってください。')}};
const otherShare=async text=>{try{await navigator.share({text})}catch(e){if(e.name!=='AbortError')toast('共有できませんでした。「リンクをコピー」から送ってください。')}};
// 印刷：ポスター（タイムテーブル・セトリ）だけを印刷する。プレビューと同じ配色か、白地・黒文字（インク節約）を選べる（見た目は style.css の @media print）
document.addEventListener('click',e=>{const b=e.target.closest('.print-btn');if(!b)return;document.documentElement.classList.toggle('print-light',b.dataset.print==='light');window.print()});
window.addEventListener('afterprint',()=>document.documentElement.classList.remove('print-light'));
return {API,isObj,esc,jst,jpDate,host,sha,apiCall,noindex,store,load,toast,copyText,isMobile,lineShare,otherShare};
})();
