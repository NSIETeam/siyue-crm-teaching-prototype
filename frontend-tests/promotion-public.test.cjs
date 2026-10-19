'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.resolve(__dirname,'..'),shared=require('../promotion-content.js');
const offer=(extra={})=>({id:'PROMO_target',type:'group',name:'正确活动',description:'兼容介绍',start:'2026-10-30',end:'2026-11-30',groupSize:2,discountMinor:1000,courseIds:['course'],selections:[{courseId:'course',classIds:['klass']}],...extra});
function harness(catalog,{url='https://www.siyuejn.com/crm/commerce-store.html?promotionId=PROMO_target&type=group',status=200}={}){
 const host={innerHTML:''},requests=[],qrUrls=[];
 const root={URL,URLSearchParams,console,location:{href:url},crypto:{randomUUID:()=> 'public-request-12345'},document:{readyState:'loading',title:'',body:{dataset:{apiBase:'/crm-api'}},getElementById:id=>id==='commerce-store'?host:null,addEventListener(){}},fetch:async (url,options)=>{requests.push({url,options});return {ok:status===200,status,json:async()=>structuredClone(catalog)}}};
 root.window=root;const context=vm.createContext(root);
 vm.runInContext(fs.readFileSync(path.join(base,'promotion-content.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(base,'qrcode-vendor.js'),'utf8'),context);
 const factory=root.qrcode;root.qrcode=(...args)=>{const qr=factory(...args),add=qr.addData;qr.addData=value=>{qrUrls.push(value);return add.call(qr,value)};return qr};
 vm.runInContext(fs.readFileSync(path.join(base,'commerce-store.js'),'utf8'),context);
 return {root,host,requests,qrUrls,api:root.SiyueCommerceStore};
}
test('public activity link binds form, poster and actual local QR to the same activity and escapes content',async()=>{
 const row=offer({promotionTitle:'<img src=x>',promotionSubtitle:'小班活动',promotionIntroduction:'<script>alert(1)</script>',posterBackground:'https://images.example.org/bg.jpg?caption=%22onerror'}),
 h=harness({decor:{title:'通用商城'},promotions:[row,offer({id:'other',name:'不能回落的其他活动'})],products:[]});
 await h.api.load();
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/crm-api/v1/public/store?promotionId=PROMO_target&type=group');
 assert.equal(h.api.snapshot().promotionId,row.id);assert.equal(h.api.snapshot().buyers.length,2);
 assert(h.host.innerHTML.includes('&lt;img src=x&gt;'));assert(h.host.innerHTML.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));assert(!h.host.innerHTML.includes('<script>alert'));
 assert(h.host.innerHTML.includes('cs-poster-background'));assert(h.host.innerHTML.includes('<svg'));assert(h.qrUrls.every(url=>new URL(url).searchParams.get('promotionId')===row.id));
 assert(h.qrUrls.every(url=>new URL(url).searchParams.get('type')==='group'));assert(!h.host.innerHTML.includes('不能回落的其他活动'));
 assert.equal(h.api.mode('standard'),false);assert.equal(h.api.offer('other'),false);
 assert.equal(h.api.snapshot().promotionId,row.id);
});
test('invalid, unpublished or removed activity never falls back to other activities',async()=>{
 const other={decor:{title:'不应展示的商城'},products:[],promotions:[offer({id:'other',name:'其他活动'})]};
 for(const options of [{},{status:404},{url:'https://www.siyuejn.com/crm/commerce-store.html?promotionId=PROMO_target&type=group&type=joint'}]){
  const h=harness(options.status?{message:'此活动未开放'}:other,options);await h.api.load();
  assert.equal(h.api.snapshot().catalog,null);assert(h.host.innerHTML.includes('活动暂不可用'));assert(!h.host.innerHTML.includes('其他活动'));assert(!h.host.innerHTML.includes('不应展示的商城'));
 }
});
test('background boundary is shared by browser and server and legacy fallback is retained',()=>{
 assert.equal(shared.count('😀'.repeat(20)),20);assert.equal(shared.submitted({promotionTitle:'😀'.repeat(20)}).promotionTitle,'😀'.repeat(20));assert.throws(()=>shared.submitted({promotionTitle:'😀'.repeat(21)}));
 for(const raw of ['data:image/png;base64,AA','javascript:alert(1)','https://user:secret@images.example.org/a','https://localhost/a','https://[::ffff:127.0.0.1]/a','https://192.168.1.1/a'])assert.throws(()=>shared.background(raw));
 assert.equal(shared.background('#ABCDEF'),'#abcdef');assert.equal(shared.background('https://images.example.org/a.png'),'https://images.example.org/a.png');
 const legacy={name:'旧标题'.repeat(20),description:'旧说明'.repeat(40),posterBackground:'javascript:alert(1)'};
 assert.deepEqual(shared.presentation(legacy),{promotionTitle:legacy.name,promotionSubtitle:'',promotionIntroduction:legacy.description,posterBackground:''});
});
