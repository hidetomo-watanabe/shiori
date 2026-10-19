// 運営管理の一覧：管理キー必須、入力内容・秘密キー・完全なIDを返さない
import assert from 'node:assert/strict';
import {api,cleanup,computeExpiry,memberToken,toPublic,connectToken,METRICS,CREATE_LIMIT_PER_HOUR} from '../../worker/api.mjs';
import {records,env,data,noIds,call,sl,sd,setlistGone} from './helpers.mjs';
// 運営管理の一覧：管理キー必須。入力内容・秘密キー・完全なIDを返さない
{const adm=(q,token,e=env)=>api(new Request('https://example.com/api/admin/list'+q,{headers:token?{Authorization:'Bearer '+token}:{}}),e);
assert.equal((await adm('?type=events','x')).status,403,'ADMIN_TOKEN 未設定なら拒否');
const aenv={...env,ADMIN_TOKEN:'a'.repeat(64)};
assert.equal((await adm('?type=events',undefined,aenv)).status,403);assert.equal((await adm('?type=events','b'.repeat(64),aenv)).status,403);
assert.equal((await adm('?type=config','a'.repeat(64),aenv)).status,400);
const r1=await sl('','POST',{data:{...sd,title:'秘密のタイトル',memo:'秘密のメモ'}},undefined,'203.0.113.140'),s1=await r1.json();
for(const type of ['events','setlists']){const r=await adm('?type='+type,'a'.repeat(64),aenv);assert.equal(r.status,200);const body=await r.json(),txt=JSON.stringify(body);assert.ok(body.items.length>0);
 for(const secret of ['秘密のタイトル','秘密のメモ','HAND-CLAP','だぁめんず','夜明け',s1.id,s1.editToken,s1.memberToken,'editHash','memberHash','2026-10-24'])assert.ok(!txt.includes(secret),type+'に含めない: '+secret);
 assert.ok(body.items.every(i=>/^[a-f0-9]{6}$/.test(i.id)),'IDは先頭6文字のみ');}
const st=(await(await adm('?type=setlists','a'.repeat(64),aenv)).json()).items.find(i=>i.id===s1.id.slice(0,6));assert.equal(st.songs,2);assert.equal(st.published,false);
assert.equal((await api(new Request('https://example.com/api/admin/list?type=events',{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(64)}}),aenv)).status,405);}
