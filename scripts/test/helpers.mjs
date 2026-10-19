// テスト共通：模擬R2（Map）、イベント・セトリの呼び出し、サンプルデータ。全テストファイルで同じ records を共有する
import {api} from '../../worker/api.mjs';
const records=new Map();let etag=0;
const env={BUCKET:{
 async get(k){let r=records.get(k);return r?{etag:r.etag,async json(){return JSON.parse(r.value)},async text(){return r.value}}:null},
 async put(k,value,opt){if(opt?.onlyIf&&records.get(k)?.etag!==opt.onlyIf.etagMatches)return null;records.set(k,{value,etag:String(++etag),customMetadata:opt?.customMetadata});return {etag:String(etag)}},
 async delete(k){for(const key of [].concat(k))records.delete(key)},
 async list({prefix}){return {objects:[...records].filter(([k])=>k.startsWith(prefix)).map(([key,r])=>({key,customMetadata:r.customMetadata})),truncated:false}}
}};
const data={title:'日本語ライブ',date:'2026-10-24',open:'13:30',start:'14:00',end:'16:00',venue:'HAND-CLAP',note:'こんにちは',acts:[{name:'だぁめんず',play:25,change:10}]};
const noIds=d=>({...d,acts:d.acts.map(({id,...a})=>a)});
const call=(path,method='GET',body,token,ip)=>api(new Request('https://example.com/api/events'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(ip?{'CF-Connecting-IP':ip}:{})},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),env);
const sl=(path,method='GET',body,token,ip)=>api(new Request('https://example.com/api/setlists'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(ip?{'CF-Connecting-IP':ip}:{})},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),env);
const sd={title:'10/24 HAND-CLAP',artist:'だぁめんず',date:'2026-10-24',venue:'HAND-CLAP',comment:'ありがとうございました',memo:'集合 12:00',videos:[],items:[{kind:'song',title:'夜明け',artist:'原曲さん',sec:210,memo:'カポ2'},{kind:'mc',title:'MC',sec:null,memo:'メンバー紹介'},{kind:'break',title:'休憩',sec:300,memo:''},{kind:'song',title:'二曲目',artist:'',sec:null,memo:''}]};
// 存在しない（または未公開・キー不一致の）セトリへの応答。区別できないことの確認に使う
const setlistGone=async()=>(await sl('/'+'0'.repeat(24))).json();
export {records,env,data,noIds,call,sl,sd,setlistGone};
