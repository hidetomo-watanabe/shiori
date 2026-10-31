// マイキー：照合用キーで暗号化済みの一覧を保存・取得。同時更新は409、キーなし403、1年使われなければ定期削除、削除後は410で作り直さない
import assert from 'node:assert/strict';
import {api,cleanup} from '../../worker/api.mjs';
import {records,env} from './helpers.mjs';
{const ac=(method,body,token,ip)=>api(new Request('https://example.com/api/account',{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(ip?{'CF-Connecting-IP':ip}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);
const t='c'.repeat(48);
assert.equal((await ac('GET')).status,403,'キーなし');assert.equal((await ac('GET',undefined,'xyz')).status,403,'形式違い');
assert.equal((await ac('GET',undefined,t)).status,404,'未作成');
assert.equal((await ac('PUT',{data:'not base64!',revision:0},t)).status,400);assert.equal((await ac('PUT',{data:'QUJD'},t)).status,400,'revision必須');
assert.equal((await ac('PUT',{data:'QUJD',revision:1},t)).status,409,'未作成なのにrevision指定');
const r1=await ac('PUT',{data:'QUJD',revision:0},t,'203.0.113.200');assert.equal(r1.status,200);assert.equal((await r1.json()).revision,1);
const g=await(await ac('GET',undefined,t)).json();assert.deepEqual(g,{data:'QUJD',revision:1});
assert.equal((await ac('PUT',{data:'REVG',revision:0},t)).status,409,'古いrevision');
assert.equal((await(await ac('PUT',{data:'REVG',revision:1},t)).json()).revision,2);
const key=[...records.keys()].find(k=>k.startsWith('accounts/'));assert.ok(key&&!key.includes(t),'マイキー由来の照合用キーそのものは保存先名に使わない');assert.ok(!records.get(key).value.includes(t));
assert.equal((await ac('GET',undefined,'d'.repeat(48))).status,404,'別のキーでは読めない');
assert.equal((await ac('POST',{data:'QUJD',revision:0},t)).status,404);
records.set(key,{...records.get(key),customMetadata:{expiresAt:'2020-01-01T00:00:00.000Z'}});assert.equal((await cleanup(env)).accounts,1);assert.ok(!records.has(key));
await ac('PUT',{data:'QUJD',revision:0},t,'203.0.113.200');assert.equal((await(await ac('DELETE',undefined,t)).json()).deleted,true);
assert.equal((await ac('GET',undefined,t)).status,410,'削除済み');assert.equal((await ac('PUT',{data:'QUJD',revision:0},t)).status,410,'別の端末の同期で作り直さない');assert.equal((await ac('DELETE',undefined,t)).status,410);
assert.ok(!records.get(key).value.includes('QUJD'),'一覧は消える');assert.equal((await ac('DELETE',undefined,'e'.repeat(48))).status,404);}
