// イベント・セトリ以外のページ：?page=mine（作ったもの・マイキー）／admin（運営管理）／privacy（プライバシー）
(async()=>{
const page=new URLSearchParams(location.search).get('page');if(!['mine','admin','privacy'].includes(page))return;
const $=id=>document.getElementById(id),{API,esc,noindex}=shiori;
// 作ったもの・マイキー（?page=mine）：端末に保存された編集キー・メンバー用キーで一覧を出す。マイキーで別の端末と揃えられる。フッターからリンク
if(page==='mine'){document.title='作ったもの・マイキー｜ライブのしおり';noindex();
 const P='live-shiori-v1-',{store,load,apiCall,copyText,toast,MYKEY,MYBASE,accountAuth,linkKeys,syncKeys,forgetMyKey}=shiori;
 const day=d=>d?new Date(d+'T12:00:00+09:00').toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',weekday:'short'}):'日付未定';
 const at=iso=>iso?new Date(iso).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
 // マイキーのリンク（#mykey=）で開いたら、この端末に保管してアドレスバーから消す。前回同期した一覧は別のマイキーのものなので捨てる
 const h=location.hash.match(/^#mykey=([a-f0-9]{48})$/);if(h&&h[1]!==load(MYKEY)){store(MYKEY,h[1]);store(MYBASE,'')}if(location.hash)history.replaceState(null,'',location.pathname+'?page=mine');
 addEventListener('hashchange',()=>{if(/^#mykey=/.test(location.hash))location.reload()}); // 開いたままのタブにマイキーのリンクを貼ったとき（# 以降だけが変わり、読み込み直されない）
 document.querySelector('.intro').outerHTML='<section class="intro"><h1><span>作ったもの</span></h1><p id="mine-lead"></p></section>';
 document.querySelector('.workspace').outerHTML='<div class="mine"><section class="card mykey" id="mykey"></section><p id="mine-status" role="status">読み込み中…</p><div id="mine-body"></div></div>';
 document.documentElement.classList.remove('loading');
 // マイキーの欄：未設定なら「作る」「ほかの端末のマイキーを使う」、設定済みなら別の端末で開くリンク
 const panel=(count,error)=>{const my=load(MYKEY);$('mine-lead').innerHTML=my?'このブラウザと、同じマイキーを使っている端末で作成した、または編集リンク・メンバー用リンクを開いたイベントとセトリです。':'このブラウザで作成した、または編集リンク・メンバー用リンクを開いたイベントとセトリです。<br>別の端末やブラウザで作ったものは表示されません。';
  $('mykey').innerHTML=my?`<h2>マイキー</h2><p class="tip">同じマイキーを使っている端末どうしで、この一覧と編集の権限が揃います${count==null?'':`（${count}件）`}。別の端末では、下のリンクを一度開いてください。</p>${error?`<p class="warn mykey-error">同期できませんでした：${esc(error)}</p>`:''}<input id="mykey-url" readonly value="${esc(location.origin+location.pathname+'?page=mine#mykey='+my)}" aria-label="マイキーのリンク"><button class="secondary" id="mykey-copy">マイキーのリンクをコピー</button><p class="tip">マイキーのリンクを持つ人は、ここにあるすべてのイベント・セトリを編集できます。自分以外には送らないでください。なくすと取り戻せません（各端末にはこれまでどおり残ります）。</p><p class="tip">マイキーは自分専用です。メンバーと一緒に使うときは、マイキーではなく、イベント・セトリごとの編集リンクやメンバー用リンクを送ってください。</p><button class="text-btn" id="mykey-off">この端末でマイキーを使うのをやめる</button><button class="text-btn danger-text" id="mykey-delete">マイキーを削除</button>`
  :`<h2>マイキー</h2><p class="tip">マイキーを作ると、別の端末やブラウザでも同じ一覧が表示され、そのまま編集できます。</p><p class="tip">マイキーは自分専用です。メンバーと一緒に使うときは、マイキーではなく、イベント・セトリごとの編集リンクやメンバー用リンクを送ってください。</p><button class="primary" id="mykey-new">マイキーを作る</button><label>ほかの端末で作ったマイキーを使う<input id="mykey-input" autocomplete="off" placeholder="マイキーのリンクを貼り付け"></label><button class="secondary" id="mykey-use">この端末で使う</button>`};
 const sync=async()=>{if(!load(MYKEY))return panel();$('mine-status').textContent='同期中…';try{panel(await syncKeys())}catch(e){panel(null,e.message)}};
 $('mykey').addEventListener('click',async e=>{const id=e.target.id;
  if(id==='mykey-copy')copyText($('mykey-url'),'マイキーのリンクをコピーしました。別の端末で開いてください。');
  if(id==='mykey-off'){if(!confirm('この端末でマイキーを使うのをやめます。\nこの端末の一覧はそのまま残りますが、ほかの端末とは揃わなくなります。やめますか？'))return;forgetMyKey();panel();await list()}
  // 削除：サーバーの一覧を消し、どの端末でもこのマイキーを使えなくする。各端末のリンクのキーはそのまま残す
  if(id==='mykey-delete'){if(!confirm('マイキーを削除します。\nサーバーに保存した一覧が消え、どの端末でもこのマイキーは使えなくなります。各端末で開けるイベント・セトリはそのまま残ります。削除しますか？'))return;e.target.disabled=true;try{await apiCall('/api/account',{method:'DELETE',headers:await accountAuth(load(MYKEY))})}catch(e2){if(e2.status!==404&&e2.status!==410){toast(e2.message);e.target.disabled=false;return}}forgetMyKey();panel();await list();toast('マイキーを削除しました。')}
  if(id==='mykey-new'){store(MYKEY,Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join(''));store(MYBASE,'');await sync();await list()}
  if(id==='mykey-use'){const m=$('mykey-input').value.trim().match(/^(?:.*#mykey=)?([a-f0-9]{48})$/);if(!m){toast('マイキーのリンクを確認してください。');return}
   // 打ち間違いで新しいマイキーができないよう、サーバーにあるものだけ受け付ける
   e.target.disabled=true;try{await apiCall('/api/account',{headers:await accountAuth(m[1])});store(MYKEY,m[1]);store(MYBASE,'');await sync();await list()}catch(e2){toast(e2.status===404?'このマイキーは見つかりません。リンクを確認してください。':e2.message);e.target.disabled=false}}});
 const list=async()=>{
 const keys=Object.entries(linkKeys()).map(([key,token])=>{const [,kind,id]=key.match(/^live-shiori-v1-(.+)-([a-f0-9]{24})$/);return {kind,id,key,token}});
 const editSet=new Set(keys.filter(k=>k.kind==='setlist-edit').map(k=>k.id)),targets=keys.filter(k=>!(k.kind==='setlist-member'&&editSet.has(k.id))).slice(0,90);
 const fetchOne=async t=>{const path=t.kind==='edit'?'/api/events/':'/api/setlists/';try{const r=await fetch(API+path+t.id,{cache:'no-store',headers:{Authorization:'Bearer '+t.token}});if(r.status===404)return {...t,gone:true};const b=await r.json();if(!r.ok||!b?.data)return {...t,error:true};return {...t,b}}catch{return {...t,error:true}}};
 const all=await Promise.all(targets.map(fetchOne)),pick=kind=>all.filter(x=>x.kind===kind).sort((a,b)=>String(b.b?.updatedAt||'').localeCompare(String(a.b?.updatedAt||'')));
 const row=(x,href,title,meta)=>x.gone?`<div class="mine-row gone"><div><b>見つかりません</b><span>削除されたか、保存期間が終わったか、リンクが作り直されました</span></div><button class="text-btn" data-forget="${esc(x.key)}">一覧から外す</button></div>`:x.error?`<div class="mine-row gone"><div><b>読み込めませんでした</b><span>時間をおいて再度お試しください</span></div></div>`:`<a class="mine-row" href="${esc(href)}"><div><b>${esc(title)}</b><span>${meta}</span></div><span class="mine-go">開く →</span></a>`;
 const section=(h,list,empty,href)=>`<h2>${h}${href?`<a class="mine-new" href="${href}">＋ 新しくつくる</a>`:''}</h2>${list.length?list.join(''):`<p class="tip">${empty}</p>`}`;
 const events=pick('edit').map(x=>row(x,'?event='+x.id,x.b?.data.title||'タイトル未入力',x.b?[day(x.b.data.date),x.b.data.venue&&'@'+esc(x.b.data.venue),'更新 '+at(x.b.updatedAt),!x.b.manage&&'編集リンクが無効の可能性があります'].filter(Boolean).join(' · '):''));
 const sl=x=>x.b?[x.b.data.date?day(x.b.data.date):'',x.b.publication?.published?'公開中':'未公開',x.b.link?.valid?'イベントに紐づけ済み':'','更新 '+at(x.b.updatedAt)].filter(Boolean).join(' · '):'';
 const setlists=pick('setlist-edit').map(x=>row(x,'?setlist='+x.id,x.b?.data.title||'タイトル未入力',sl(x)));
 const member=pick('setlist-member').map(x=>row(x,'?setlist='+x.id+'&view=member',x.b?.data.title||'タイトル未入力',sl(x)));
 const where=load(MYKEY)?'このブラウザと同じマイキーの端末で':'このブラウザで';
 $('mine-body').innerHTML=section('イベント',events,where+'作ったイベントはありません。','./#timetable')+section('セトリ',setlists,where+'作ったセトリはありません。','?setlist=new')+(member.length?section('メンバーとして見ているセトリ',member,''):'');
 $('mine-status').textContent=targets.length?'':where+'作ったイベント・セトリはありません。';};
 $('mine-body').addEventListener('click',e=>{const k=e.target.dataset.forget;if(!k)return;store(k,'');e.target.closest('.mine-row').remove()});
 await sync();await list();
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
 const LABEL={event_view:'イベント閲覧',public_view:'公開セトリ閲覧',member_view:'メンバー用セトリ閲覧',event_create:'イベント作成',event_update:'イベント保存',event_delete:'イベント削除',setlist_create:'セトリ作成',setlist_update:'セトリ保存',setlist_delete:'セトリ削除',publish_first:'初回公開',republish:'再公開',publish_update:'公開内容の更新',unpublish:'公開停止',link:'紐づけ',unlink:'紐づけ解除',youtube_search:'YouTube検索（枠を使う）',youtube_cache:'YouTube検索（使い回し）',error:'サーバーエラー',interest_open:'今後の追加機能：案内を開いた',interest_retention:'使ってみたい：保存期間の延長',interest_design:'使ってみたい：ロゴ・デザイン',interest_history:'使ってみたい：変更履歴・復元',interest_separate:'使ってみたい：出演者だけの案内',interest_library:'使ってみたい：曲のライブラリ'};
 const usage=st=>{const sum=(k,n)=>st.days.slice(0,n).reduce((a,d)=>a+d[k],0),DAILY=[['イベント閲覧',d=>d.event_view],['公開セトリ閲覧',d=>d.public_view],['メンバー用閲覧',d=>d.member_view],['作成',d=>d.event_create+d.setlist_create],['保存',d=>d.event_update+d.setlist_update],['公開',d=>d.publish_first+d.republish]];
  return `<h2>利用状況</h2><p class="tip">操作が成功した延べ回数です（人数ではありません）。同時アクセス時に数え漏れることがある概数です。日付は日本時間。計測を始める前の日は0になります。</p>${table(['操作','直近7日','直近30日','直近90日'],st.metrics.map(k=>`<tr><td>${LABEL[k]||esc(k)}</td><td>${sum(k,7)}</td><td>${sum(k,30)}</td><td>${sum(k,90)}</td></tr>`))}<h2>日別（直近30日）</h2>${table(['日付',...DAILY.map(x=>x[0])],st.days.slice(0,30).map(d=>`<tr><td>${esc(d.date)}</td>${DAILY.map(x=>`<td>${x[1](d)}</td>`).join('')}</tr>`))}`};
 // プランの列：押すと free／paid を切り替える（管理キー必須の POST /api/admin/plan）。期限切れは切り替えない
 const planCell=(type,x)=>`<td><button type="button" class="plan-btn${x.plan==='paid'?' paid':''}" data-type="${type}" data-id="${esc(x.id)}" data-plan="${x.plan}" ${x.expired?'disabled':''} title="押すと${x.plan==='paid'?'free':'paid'}にします">${x.plan}</button></td>`;
 const bindPlans=key=>document.querySelectorAll('.plan-btn').forEach(b=>b.onclick=async()=>{const plan=b.dataset.plan==='paid'?'free':'paid';b.disabled=true;
  try{const r=await fetch(API+'/api/admin/plan',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({type:b.dataset.type,id:b.dataset.id,plan})});const body=await r.json().catch(()=>null);if(!r.ok||!body)throw Error(body?.error||'切り替えられませんでした（'+r.status+'）');
   b.dataset.plan=body.plan;b.textContent=body.plan;b.title='押すと'+(body.plan==='paid'?'free':'paid')+'にします';b.classList.toggle('paid',body.plan==='paid');b.closest('tr').querySelector('.exp').textContent=body.expiresAt?at(body.expiresAt):'自動削除なし';shiori.toast(b.dataset.id+' を '+body.plan+' にしました')}
  catch(e){shiori.toast(e.message)}finally{b.disabled=false}});
 const show=async key=>{$('admin-status').textContent='読み込み中…';try{const [events,setlists,st]=await Promise.all([fetchAll('events',key),fetchAll('setlists',key),stats(key)]);try{sessionStorage.setItem(KEYNAME,key)}catch{}
  const live=a=>a.filter(x=>!x.expired);
  $('admin-body').innerHTML=`<div class="admin-summary"><div><b>${live(events).length}</b>イベント</div><div><b>${live(setlists).length}</b>セトリ</div><div><b>${live(setlists).filter(x=>x.published).length}</b>公開中のセトリ</div><div><b>${live(setlists).filter(x=>x.linked).length}</b>紐づけありのセトリ</div></div>
${usage(st)}
<h2>イベント</h2>${table(['ID','プラン','最終更新','保存回数','出演枠','休憩','紐づけ用リンク','紐づけ','保存期限'],events.map(e=>`<tr class="${e.expired?'expired':''}"><td><code>${esc(e.id)}</code></td>${planCell('events',e)}<td>${at(e.updatedAt)}</td><td>${e.revision}</td><td>${e.slots}</td><td>${e.breaks}</td><td>${e.connectKeys}</td><td>${e.links}</td><td class="exp">${e.expired?'期限切れ':e.expiresAt?at(e.expiresAt):'自動削除なし'}</td></tr>`))}
<h2>セトリ</h2>${table(['ID','プラン','最終更新','保存回数','曲数','項目数','動画','公開','初回公開','紐づけ','保存期限'],setlists.map(x=>`<tr class="${x.expired?'expired':''}"><td><code>${esc(x.id)}</code></td>${planCell('setlists',x)}<td>${at(x.updatedAt)}</td><td>${x.revision}</td><td>${x.songs}</td><td>${x.items}</td><td>${x.videos}</td><td>${x.published?'公開中':'—'}</td><td>${at(x.firstPublishedAt)}</td><td>${x.linked?'あり':'—'}</td><td class="exp">${x.expired?'期限切れ':x.expiresAt?at(x.expiresAt):'自動削除なし'}</td></tr>`))}
<p class="tip">プランのボタンで free／paid を切り替えます（利用者の画面には出ません。paid は自動削除されません。free に戻すと通常の保存期間になり、少なくとも30日は残ります）。IDは先頭6文字だけを表示しています。日時は日本時間。紐づけの数は片側だけ残った情報も含みます。</p>`;$('admin-status').textContent=`${at(new Date().toISOString())} 時点`;$('admin-form').hidden=true;bindPlans(key)}
  catch(e){$('admin-status').textContent=e.message;try{sessionStorage.removeItem(KEYNAME)}catch{}}};
 $('admin-form').onsubmit=e=>{e.preventDefault();const key=$('admin-key').value.trim();if(key)show(key)};
 try{const saved=sessionStorage.getItem(KEYNAME);if(saved)show(saved)}catch{}
 return;}
// プライバシーについて（?page=privacy）：内容は実装（worker/api.mjs・各画面）と公開構成（DEPLOY.md）に合わせて更新すること
if(page==='privacy'){document.title='プライバシーについて｜ライブのしおり';document.querySelector('link[rel=canonical]').href='https://shiori.whathides.co.jp/?page=privacy';
 document.querySelector('.intro').outerHTML='<section class="intro"><h1><span>プライバシーについて</span></h1><p>ライブのしおりが扱う情報と、その保存・公開の範囲をまとめています。</p></section>';
 document.querySelector('.workspace').outerHTML=`<article class="card doc">
<h2>アカウントはありません</h2><p>登録やログインはなく、氏名・メールアドレス・電話番号などはお預かりしません。イベントやセトリは、作成時に発行される秘密のリンク（閲覧・編集・メンバー用・紐づけ用・公開セトリ）で見たり編集したりします。</p><p>別の端末やブラウザでも同じように編集したい場合は、マイキーを使えます（任意）。マイキーも秘密のリンクの一つで、個人情報の入力は不要です。</p>
<h2>保存する情報</h2><ul><li>イベント・セトリに入力された内容（イベント名、出演者名、曲名、メモ、コメント、動画リンクなど）</li><li>作成・更新日時、保存期限、公開状態、イベントとセトリの紐づけ</li><li>リンクの照合用データ（秘密のリンクそのものではなく、元に戻せない形に変換した値）</li><li>マイキーを使う場合：同期する編集リンク・メンバー用リンクの一覧と更新日時。一覧は、お使いの端末でマイキーから作った鍵で暗号化してから送るため、運営者を含めサーバー側では中身を読めません。マイキーそのものも送りません。</li></ul><p>入力欄には個人情報を書かないでください。</p>
<h2>見られる人</h2><ul><li>イベントの閲覧リンクを知っている人は、誰でもイベントの内容を見られます。</li><li>公開前のセトリは、メンバー用リンクまたは編集リンクを知っている人だけが見られます。主催者を含め、イベント側には表示されません。</li><li>公開したセトリは、公開セトリのリンクを知っている人が誰でも見られます。メンバー向けメモ・MC・休憩・演奏時間は公開されません。</li><li>マイキーのリンクを知っている人は、そのマイキーで同期しているすべてのイベント・セトリを編集できます。</li><li>リンクは転送されると、転送先の人も同じように見られます。</li></ul><p>イベント・セトリのページは検索エンジンに載らないよう設定していますが、アクセスを制限するものではありません。公開停止や削除をしても、すでに保存・転載・撮影された内容は取り消せません。</p>
<h2>保存期間と削除</h2><p>イベント・セトリとも、開催日の90日後（開催日が未設定なら最終更新の180日後。いずれも保存から最低30日）に自動で削除します。ただし、運営者が個別に設定したもの（編集画面に「自動削除の対象外」と表示されます）は自動で削除しません。編集リンクからいつでも削除でき、削除するとすべてのリンクが使えなくなります。</p><p>マイキーの一覧は、最後に同期してから1年使われなければ自動で削除します。「作ったもの・マイキー」のページからいつでも削除でき、削除後は削除済みであることを示す印だけを1年間残します（同じマイキーで作り直されないようにするため）。</p>
<h2>アクセス情報</h2><p>短時間の大量作成を防ぐため、作成時に接続元のIPアドレスを秘密の値と組み合わせて元に戻せない形に変換し、1時間単位の回数だけを記録します（IPアドレスそのものは保存しません）。このカウンタは毎日の定期処理で削除します（最長で1日程度残ります）。また、運用状況を把握するため、閲覧・作成・公開などの操作が成功した回数と、編集画面の「今後の追加機能（準備中）」で押された「使ってみたい」の回数を、種類ごと・日ごとに数えています。誰がどのページを見たか、IPアドレス、入力内容は記録せず、この回数は約90日で削除します。個人を識別するアクセス解析や、Cookie・広告による追跡は行っていません。</p>
<h2>運営者による確認</h2><p>運営者は、運用状況を確認するため、上記の操作の回数と、イベント・セトリの件数、更新日時、保存期限、出演枠や曲の数、公開状態などの管理情報を見ることがあります。管理画面には、入力内容（タイトル・曲名・メモなど）やリンクは表示されません。</p>
<h2>利用している外部サービス</h2><ul><li>GitHub Pages（画面の配信）</li><li>Cloudflare Workers・R2（保存と読み出し）</li><li>Google Fonts（文字の表示）</li><li>iTunes Search API（セトリの「曲を検索」を押したときのみ）</li></ul><p>ページを開くと、これらのサービスに通常の通信情報（IPアドレス、ブラウザの種類など）が送られます。「曲を検索」を押すと、その曲の曲名と原曲アーティストが Apple に送られます。各サービスでの取り扱いは、それぞれの方針に従います。</p>
<h2>このブラウザに保存する情報</h2><p>入力途中の下書きと、開いたリンクのキー、マイキーを使う場合はマイキーと前回同期した一覧、「使ってみたい」を押した機能を、このブラウザ（localStorage）に保存します。共用の端末では、使い終わったらブラウザのサイトデータを削除してください。</p>
<p class="tip">2026年10月19日 制定／2026年10月31日 改定（マイキー）</p></article>`;
 document.documentElement.classList.remove('loading');return;}
})();
