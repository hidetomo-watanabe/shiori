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
const noindex=()=>{const m=document.createElement('meta');m.name='robots';m.content='noindex';document.head.append(m);document.querySelector('link[rel=canonical]')?.remove()};
const store=(k,v)=>{try{if(v)localStorage.setItem(k,v);else localStorage.removeItem(k)}catch{}},load=k=>{try{return localStorage.getItem(k)||''}catch{return ''}};
// 押したボタンから離れた案内欄だと気づきにくいため、コピー・共有の結果は画面下の通知（トースト）で出す。保存ボタンの下の保存状態の案内は上書きしない
const toast=msg=>{let t=document.getElementById('toast');if(!t){t=document.createElement('div');t.id='toast';t.setAttribute('aria-live','polite');document.body.append(t)}t.textContent=msg;t.classList.add('show');clearTimeout(t.timer);t.timer=setTimeout(()=>t.classList.remove('show'),4000)};
// text を渡すと、リンクの代わりにその文面（名前・日時・リンク）をコピーする。コピーできない端末ではリンクの欄を選択する
const copyText=async(input,done,fail='リンクを選択しました。コピーしてください。',text=input.value)=>{try{await navigator.clipboard.writeText(text);toast(done)}catch{input.select();toast(fail)}};
// LINEで送る：LINE公式の共有URL（アプリが開き、送る相手を選べる）。端末の共有メニューは、使える端末でだけ「ほかのアプリで送る」として出す
// PCでは共有URLがLINEアプリを開けずLINEのトップページに飛び、コピーと同じことしかできないため「LINEで送る」を隠す（.pc。style.css）。iPadはMacとして名乗るのでタッチ対応で判定
const isMobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||navigator.maxTouchPoints>1&&/Macintosh/.test(navigator.userAgent);
if(!isMobile)document.documentElement.classList.add('pc');
const lineShare=async text=>{if(isMobile){window.open('https://line.me/R/share?text='+encodeURIComponent(text),'_blank','noopener');return}try{await navigator.clipboard.writeText(text);toast('送る内容をコピーしました。PCのLINEでトークを開き、貼り付けて送ってください。')}catch{toast('コピーできませんでした。「名前とリンクをコピー」から送ってください。')}};
const otherShare=async(text,title)=>{try{await navigator.share(title?{title,text}:{text})}catch(e){if(e.name!=='AbortError')toast('共有できませんでした。「名前とリンクをコピー」から送ってください。')}};
// 閲覧ページの「共有（LINE など）」：見た人が転送するときも名前が分かるよう、名前入りの文面を送る。共有メニュー→（スマホ）LINEの共有→（PC）コピーの順
const viewShare=async(text,title)=>{if(navigator.share)return otherShare(text,title);if(isMobile)return lineShare(text);try{await navigator.clipboard.writeText(text);toast('名前とリンクをコピーしました。LINE などに貼り付けて送ってください。')}catch{toast('コピーできませんでした。')}};
// 印刷：ポスター（タイムテーブル・セトリ）だけを印刷する。プレビューと同じ配色か、白地・黒文字（インク節約）を選べる（見た目は style.css の @media print）
document.addEventListener('click',e=>{const b=e.target.closest('.print-btn');if(!b)return;document.documentElement.classList.toggle('print-light',b.dataset.print==='light');window.print()});
// A4縦1枚（印刷範囲 180×273mm ≒ 680×1032px。端数で2枚目にはみ出さないよう少し余らせる）に収まるよう縮小率を求める（半分より小さくはせず、超える分は次のページへ）。濃い配色は用紙の下まで伸ばす。ブラウザのメニューから印刷した場合も同じ
window.addEventListener('beforeprint',()=>{const p=document.getElementById('poster'),root=document.documentElement;if(!p)return;p.style.width='680px';const z=Math.max(.5,Math.min(1,1016/p.offsetHeight));p.style.width='';root.style.setProperty('--print-zoom',z);root.style.setProperty('--print-h',Math.floor(1016/z)+'px')});
window.addEventListener('afterprint',()=>document.documentElement.classList.remove('print-light'));
return {API,isObj,esc,jst,jpDate,host,sha,apiCall,noindex,store,load,toast,copyText,isMobile,lineShare,otherShare,viewShare};
})();
