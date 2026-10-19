// イベント・セトリ以外のページ：?page=mine（このブラウザで作ったもの）／admin（運営管理）／privacy（プライバシー）
(async()=>{
const page=new URLSearchParams(location.search).get('page');if(!['mine','admin','privacy'].includes(page))return;
const $=id=>document.getElementById(id),{API,esc,noindex}=shiori;
// このブラウザで作ったもの（?page=mine）：端末に保存された編集キー・メンバー用キーで一覧を出す。画面からはリンクしない（URLを知っている人向け）
if(page==='mine'){document.title='このブラウザで作ったもの｜ライブのしおり';noindex();
 const P='live-shiori-v1-';
 const day=d=>d?new Date(d+'T12:00:00+09:00').toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',weekday:'short'}):'日付未定';
 const at=iso=>iso?new Date(iso).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
 document.querySelector('.intro').outerHTML='<section class="intro"><h1><span>このブラウザで</span><span>作ったもの</span></h1><p>このブラウザで作成した、または編集リンク・メンバー用リンクを開いたイベントとセトリです。<br>別の端末やブラウザで作ったものは表示されません。</p></section>';
 document.querySelector('.workspace').outerHTML='<div class="mine"><p id="mine-status" role="status">読み込み中…</p><div id="mine-body"></div></div>';
 document.documentElement.classList.remove('loading');
 const keys=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i),m=k&&k.match(/^live-shiori-v1-(edit|setlist-edit|setlist-member)-([a-f0-9]{24})$/);if(m)keys.push({kind:m[1],id:m[2],key:k,token:localStorage.getItem(k)})}}catch{}
 const editSet=new Set(keys.filter(k=>k.kind==='setlist-edit').map(k=>k.id)),targets=keys.filter(k=>!(k.kind==='setlist-member'&&editSet.has(k.id))).slice(0,90);
 const load=async t=>{const path=t.kind==='edit'?'/api/events/':'/api/setlists/';try{const r=await fetch(API+path+t.id,{cache:'no-store',headers:{Authorization:'Bearer '+t.token}});if(r.status===404)return {...t,gone:true};const b=await r.json();if(!r.ok||!b?.data)return {...t,error:true};return {...t,b}}catch{return {...t,error:true}}};
 const all=await Promise.all(targets.map(load)),pick=kind=>all.filter(x=>x.kind===kind).sort((a,b)=>String(b.b?.updatedAt||'').localeCompare(String(a.b?.updatedAt||'')));
 const row=(x,href,title,meta)=>x.gone?`<div class="mine-row gone"><div><b>見つかりません</b><span>削除されたか、保存期間が終わったか、リンクが作り直されました</span></div><button class="text-btn" data-forget="${esc(x.key)}">一覧から外す</button></div>`:x.error?`<div class="mine-row gone"><div><b>読み込めませんでした</b><span>時間をおいて再度お試しください</span></div></div>`:`<a class="mine-row" href="${esc(href)}"><div><b>${esc(title)}</b><span>${meta}</span></div><span class="mine-go">開く →</span></a>`;
 const section=(h,list,empty)=>`<h2>${h}</h2>${list.length?list.join(''):`<p class="tip">${empty}</p>`}`;
 const events=pick('edit').map(x=>row(x,'?event='+x.id,x.b?.data.title||'タイトル未入力',x.b?[day(x.b.data.date),x.b.data.venue&&'@'+esc(x.b.data.venue),'更新 '+at(x.b.updatedAt),!x.b.manage&&'編集リンクが無効の可能性があります'].filter(Boolean).join(' · '):''));
 const sl=x=>x.b?[x.b.data.date?day(x.b.data.date):'',x.b.publication?.published?'公開中':'未公開',x.b.link?.valid?'イベントに紐づけ済み':'','更新 '+at(x.b.updatedAt)].filter(Boolean).join(' · '):'';
 const setlists=pick('setlist-edit').map(x=>row(x,'?setlist='+x.id,x.b?.data.title||'タイトル未入力',sl(x)));
 const member=pick('setlist-member').map(x=>row(x,'?setlist='+x.id+'&view=member',x.b?.data.title||'タイトル未入力',sl(x)));
 $('mine-body').innerHTML=section('イベント',events,'このブラウザで作ったイベントはありません。')+section('セトリ',setlists,'このブラウザで作ったセトリはありません。')+(member.length?section('メンバーとして見ているセトリ',member,''):'');
 $('mine-status').textContent=targets.length?'':'このブラウザで作ったイベント・セトリはありません。';
 $('mine-body').addEventListener('click',e=>{const k=e.target.dataset.forget;if(!k)return;try{localStorage.removeItem(k)}catch{}e.target.closest('.mine-row').remove()});
 return;}
// 運営管理（?page=admin）：管理キーでイベント・セトリの状態の一覧を表示する。入力内容・完全なIDはAPIが返さない
if(page==='admin'){document.title='運営管理｜ライブのしおり';noindex();
 const KEYNAME='live-shiori-admin';
 const at=iso=>iso?new Date(iso).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
 document.querySelector('.intro').outerHTML='<section class="intro"><h1><span>運営管理</span></h1><p>利用状況と、イベント・セトリの状態の一覧です。入力内容（タイトル・曲名・メモなど）は表示しません。</p></section>';
 document.querySelector('.workspace').outerHTML=`<div class="admin"><form class="card admin-login" id="admin-form"><label>管理キー<input id="admin-key" type="password" autocomplete="off"></label><button class="primary">一覧を表示</button><p class="tip">管理キーはこのタブを閉じると消えます。</p></form><p id="admin-status" role="status"></p><div id="admin-body"></div></div>`;
 document.documentElement.classList.remove('loading');
 const fetchAll=async(type,key)=>{let items=[],cursor='';for(let n=0;n<25;n++){const r=await fetch(API+'/api/admin/list?type='+type+(cursor?'&cursor='+encodeURIComponent(cursor):''),{cache:'no-store',headers:{Authorization:'Bearer '+key}});const body=await r.json().catch(()=>null);if(!r.ok||!body)throw Error(body?.error||'読み込めませんでした（'+r.status+'）');items=items.concat(body.items);if(!body.cursor)break;cursor=body.cursor}return items.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))};
 const table=(head,rows)=>`<div class="admin-table"><table><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${head.length}">ありません</td></tr>`}</tbody></table></div>`;
 const stats=async key=>{const r=await fetch(API+'/api/admin/stats',{cache:'no-store',headers:{Authorization:'Bearer '+key}});const b=await r.json().catch(()=>null);if(!r.ok||!b)throw Error(b?.error||'読み込めませんでした（'+r.status+'）');return b};
 const LABEL={event_view:'イベント閲覧',public_view:'公開セトリ閲覧',member_view:'メンバー用セトリ閲覧',event_create:'イベント作成',event_update:'イベント保存',event_delete:'イベント削除',setlist_create:'セトリ作成',setlist_update:'セトリ保存',setlist_delete:'セトリ削除',publish_first:'初回公開',republish:'再公開',publish_update:'公開内容の更新',unpublish:'公開停止',link:'紐づけ',unlink:'紐づけ解除',error:'サーバーエラー'};
 const usage=st=>{const sum=(k,n)=>st.days.slice(0,n).reduce((a,d)=>a+d[k],0),DAILY=[['イベント閲覧',d=>d.event_view],['公開セトリ閲覧',d=>d.public_view],['メンバー用閲覧',d=>d.member_view],['作成',d=>d.event_create+d.setlist_create],['保存',d=>d.event_update+d.setlist_update],['公開',d=>d.publish_first+d.republish]];
  return `<h2>利用状況</h2><p class="tip">操作が成功した延べ回数です（人数ではありません）。同時アクセス時に数え漏れることがある概数です。日付は日本時間。計測を始める前の日は0になります。</p>${table(['操作','直近7日','直近30日','直近90日'],st.metrics.map(k=>`<tr><td>${LABEL[k]||esc(k)}</td><td>${sum(k,7)}</td><td>${sum(k,30)}</td><td>${sum(k,90)}</td></tr>`))}<h2>日別（直近30日）</h2>${table(['日付',...DAILY.map(x=>x[0])],st.days.slice(0,30).map(d=>`<tr><td>${esc(d.date)}</td>${DAILY.map(x=>`<td>${x[1](d)}</td>`).join('')}</tr>`))}`};
 const show=async key=>{$('admin-status').textContent='読み込み中…';try{const [events,setlists,st]=await Promise.all([fetchAll('events',key),fetchAll('setlists',key),stats(key)]);try{sessionStorage.setItem(KEYNAME,key)}catch{}
  const live=a=>a.filter(x=>!x.expired);
  $('admin-body').innerHTML=`<div class="admin-summary"><div><b>${live(events).length}</b>イベント</div><div><b>${live(setlists).length}</b>セトリ</div><div><b>${live(setlists).filter(x=>x.published).length}</b>公開中のセトリ</div><div><b>${live(setlists).filter(x=>x.linked).length}</b>紐づけありのセトリ</div></div>
${usage(st)}
<h2>イベント</h2>${table(['ID','最終更新','保存回数','出演枠','休憩','紐づけ用リンク','紐づけ','保存期限'],events.map(e=>`<tr class="${e.expired?'expired':''}"><td><code>${esc(e.id)}</code></td><td>${at(e.updatedAt)}</td><td>${e.revision}</td><td>${e.slots}</td><td>${e.breaks}</td><td>${e.connectKeys}</td><td>${e.links}</td><td>${e.expired?'期限切れ':at(e.expiresAt)}</td></tr>`))}
<h2>セトリ</h2>${table(['ID','最終更新','保存回数','曲数','項目数','動画','公開','初回公開','紐づけ','保存期限'],setlists.map(x=>`<tr class="${x.expired?'expired':''}"><td><code>${esc(x.id)}</code></td><td>${at(x.updatedAt)}</td><td>${x.revision}</td><td>${x.songs}</td><td>${x.items}</td><td>${x.videos}</td><td>${x.published?'公開中':'—'}</td><td>${at(x.firstPublishedAt)}</td><td>${x.linked?'あり':'—'}</td><td>${x.expired?'期限切れ':at(x.expiresAt)}</td></tr>`))}
<p class="tip">IDは先頭6文字だけを表示しています。日時は日本時間。紐づけの数は片側だけ残った情報も含みます。</p>`;$('admin-status').textContent=`${at(new Date().toISOString())} 時点`;$('admin-form').hidden=true}
  catch(e){$('admin-status').textContent=e.message;try{sessionStorage.removeItem(KEYNAME)}catch{}}};
 $('admin-form').onsubmit=e=>{e.preventDefault();const key=$('admin-key').value.trim();if(key)show(key)};
 try{const saved=sessionStorage.getItem(KEYNAME);if(saved)show(saved)}catch{}
 return;}
// プライバシーについて（?page=privacy）：内容は実装（worker/api.mjs・各画面）と公開構成（DEPLOY.md）に合わせて更新すること
if(page==='privacy'){document.title='プライバシーについて｜ライブのしおり';document.querySelector('link[rel=canonical]').href='https://shiori.whathides.co.jp/?page=privacy';
 document.querySelector('.intro').outerHTML='<section class="intro"><h1><span>プライバシーについて</span></h1><p>ライブのしおりが扱う情報と、その保存・公開の範囲をまとめています。</p></section>';
 document.querySelector('.workspace').outerHTML=`<article class="card doc">
<h2>アカウントはありません</h2><p>登録やログインはなく、氏名・メールアドレス・電話番号などはお預かりしません。イベントやセトリは、作成時に発行される秘密のリンク（閲覧・編集・メンバー用・紐づけ用・公開セトリ）で見たり編集したりします。</p>
<h2>保存する情報</h2><ul><li>イベント・セトリに入力された内容（イベント名、出演者名、曲名、メモ、コメント、動画リンクなど）</li><li>作成・更新日時、保存期限、公開状態、イベントとセトリの紐づけ</li><li>リンクの照合用データ（秘密のリンクそのものではなく、元に戻せない形に変換した値）</li></ul><p>入力欄には個人情報を書かないでください。</p>
<h2>見られる人</h2><ul><li>イベントの閲覧リンクを知っている人は、誰でもイベントの内容を見られます。</li><li>公開前のセトリは、メンバー用リンクまたは編集リンクを知っている人だけが見られます。主催者を含め、イベント側には表示されません。</li><li>公開したセトリは、公開セトリのリンクを知っている人が誰でも見られます。メンバー向けメモ・MC・休憩・演奏時間は公開されません。</li><li>リンクは転送されると、転送先の人も同じように見られます。</li></ul><p>イベント・セトリのページは検索エンジンに載らないよう設定していますが、アクセスを制限するものではありません。公開停止や削除をしても、すでに保存・転載・撮影された内容は取り消せません。</p>
<h2>保存期間と削除</h2><p>イベント・セトリとも、開催日の90日後（開催日が未設定なら最終更新の180日後。いずれも保存から最低30日）に自動で削除します。編集リンクからいつでも削除でき、削除するとすべてのリンクが使えなくなります。</p>
<h2>アクセス情報</h2><p>短時間の大量作成を防ぐため、作成時に接続元のIPアドレスを秘密の値と組み合わせて元に戻せない形に変換し、1時間単位の回数だけを記録します（IPアドレスそのものは保存しません）。このカウンタは毎日の定期処理で削除します（最長で1日程度残ります）。また、運用状況を把握するため、閲覧・作成・公開などの操作が成功した回数を、操作の種類ごと・日ごとに数えています。誰がどのページを見たか、IPアドレス、入力内容は記録せず、この回数は約90日で削除します。個人を識別するアクセス解析や、Cookie・広告による追跡は行っていません。</p>
<h2>運営者による確認</h2><p>運営者は、運用状況を確認するため、上記の操作の回数と、イベント・セトリの件数、更新日時、保存期限、出演枠や曲の数、公開状態などの管理情報を見ることがあります。管理画面には、入力内容（タイトル・曲名・メモなど）やリンクは表示されません。</p>
<h2>利用している外部サービス</h2><ul><li>GitHub Pages（画面の配信）</li><li>Cloudflare Workers・R2（保存と読み出し）</li><li>Google Fonts（文字の表示）</li><li>iTunes Search API（セトリの「曲を検索」を押したときのみ）</li></ul><p>ページを開くと、これらのサービスに通常の通信情報（IPアドレス、ブラウザの種類など）が送られます。「曲を検索」を押すと、その曲の曲名と原曲アーティストが Apple に送られます。各サービスでの取り扱いは、それぞれの方針に従います。</p>
<h2>このブラウザに保存する情報</h2><p>入力途中の下書きと、開いたリンクのキーを、このブラウザ（localStorage）に保存します。共用の端末では、使い終わったらブラウザのサイトデータを削除してください。</p>
<p class="tip">2026年10月19日 制定</p></article>`;
 document.documentElement.classList.remove('loading');return;}
})();
