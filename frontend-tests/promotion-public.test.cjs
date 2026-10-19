'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.resolve(__dirname,'..'),shared=require('../promotion-content.js');
const {setup}=require('../backend/test/helpers/commerce-fixture.cjs'),{request}=require('../backend/test/helpers/remaining-http.cjs');
class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-30T00:00:00Z']))}static now(){return Date.parse('2026-10-30T00:00:00Z')}}
const offer=(extra={})=>({id:'PROMO_target',type:'group',name:'正确活动',description:'兼容介绍',start:'2026-10-30',end:'2026-11-30',groupSize:2,discountMinor:1000,courseIds:['course'],selections:[{courseId:'course',classIds:['klass']}],...extra});
const klass=(extra={})=>({id:'klass',name:'可选班级',campusId:'A',campusName:'甲校区',remainingSeats:3,schedule:[{date:'2026-10-31',time:'09:00–10:00',status:'未开始'}],...extra});
const product=(extra={})=>({id:'course',name:'可用课程',grade:'小四',subject:'数学',priceCents:10001,availableForApplication:true,classes:[klass()],...extra});
function harness(catalog,{url='https://www.siyuejn.com/crm/commerce-store.html?promotionId=PROMO_target&type=group',status=200,responses,fetch:fetcher}={}){
 const host={innerHTML:''},requests=[],qrUrls=[],scrolls=[],lookups=[];
 const root={Date:FixedDate,URL,URLSearchParams,console,location:{href:url},crypto:{randomUUID:()=> 'public-request-12345'},document:{readyState:'loading',title:'',body:{dataset:{apiBase:'/crm-api'}},getElementById(id){lookups.push(id);if(id==='commerce-store')return host;if((id==='courses'||id.startsWith('cs-course-'))&&host.innerHTML.includes('id="'+id+'"'))return {scrollIntoView(options){scrolls.push({id,options:JSON.parse(JSON.stringify(options)),html:host.innerHTML})}};return null},addEventListener(){}},fetch:async (url,options)=>{requests.push({url,options});if(fetcher)return fetcher(url,options);const next=responses?responses[requests.length-1]:{status,body:catalog};assert(next,'unexpected fetch '+url);if(next.error)throw next.error;return {ok:next.status===200,status:next.status,json:async()=>structuredClone(next.body)}}};
 root.window=root;const context=vm.createContext(root);
 vm.runInContext(fs.readFileSync(path.join(base,'promotion-content.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(base,'qrcode-vendor.js'),'utf8'),context);
 const factory=root.qrcode;root.qrcode=(...args)=>{const qr=factory(...args),add=qr.addData;qr.addData=value=>{qrUrls.push(value);return add.call(qr,value)};return qr};
 vm.runInContext(fs.readFileSync(path.join(base,'commerce-store.js'),'utf8'),context);
 return {root,host,requests,qrUrls,scrolls,lookups,api:root.SiyueCommerceStore};
}
test('ordinary course anchor scrolls to the actual rendered target only after async catalog load, never during edits or reloads',async()=>{
 let release;const response=new Promise(resolve=>{release=resolve}),catalog={products:[product()],promotions:[]};
 const h=harness(null,{url:'https://www.siyuejn.com/crm/commerce-store.html#cs-course-%63ourse',fetch:()=>response}),loading=h.api.load();
 assert.equal(h.scrolls.length,0);assert.doesNotMatch(h.host.innerHTML,/id="cs-course-course"/);assert.equal(h.api.snapshot().catalog,null);
 release({ok:true,status:200,json:async()=>structuredClone(catalog)});await loading;
 assert.equal(h.scrolls.length,1);assert.equal(h.scrolls[0].id,'cs-course-course');assert.deepEqual(h.scrolls[0].options,{block:'start'});assert.match(h.scrolls[0].html,/<fieldset id="cs-course-course">/);assert.match(h.scrolls[0].html,/id="courses"/);assert.doesNotMatch(h.scrolls[0].html,/正在加载课程/);
 assert.equal(h.api.snapshot().items.length,0);assert.equal(h.api.snapshot().quote,null);assert.equal(h.requests.length,1);
 h.api.buyer(0,'name','输入不抢滚动');h.api.choose('klass');await h.api.load();assert.equal(h.scrolls.length,1);assert.equal(h.requests.length,2);assert(h.requests.every(r=>r.url==='/crm-api/v1/public/store'));
});
test('only existing ordinary course anchors may scroll; invalid hashes and activity pages never scroll',async()=>{
 const catalog={products:[product()],promotions:[]},ordinary='https://www.siyuejn.com/crm/commerce-store.html';
 const all=harness(catalog,{url:ordinary+'#courses'});await all.api.load();assert.deepEqual(all.scrolls.map(s=>s.id),['courses']);
 for(const hash of ['','#cs-course-missing','#cs-submit','#%E0%A4%A','#cs-course-course%22%5Donclick%3Dalert(1)']){
  const h=harness(catalog,{url:ordinary+hash});await h.api.load();assert.deepEqual(h.scrolls,[]);assert(!h.lookups.some(id=>id!=='commerce-store'));
 }
 for(const options of [{url:ordinary+'?promotionId=PROMO_target&type=group#cs-course-course'},{url:ordinary+'?promotionId=PROMO_target&type=group#courses',responses:[{status:404,body:{}},{status:200,body:catalog}]},{url:ordinary+'?promotionId=invalid&type=group&type=joint#courses'}]){
  const h=harness({...catalog,promotions:[offer()]},options);await h.api.load();assert.deepEqual(h.scrolls,[]);
 }
});
test('ordinary anchor remains pending after a failed initial catalog request and positions after a successful retry',async()=>{
 const h=harness(null,{url:'https://www.siyuejn.com/crm/commerce-store.html#cs-course-course',responses:[{status:503,body:{message:'临时失败'}},{status:200,body:{products:[product()],promotions:[]}}]});
 await h.api.load();assert.equal(h.scrolls.length,0);await h.api.load();assert.deepEqual(h.scrolls.map(s=>s.id),['cs-course-course']);assert.equal(h.api.snapshot().items.length,0);assert.equal(h.api.snapshot().quote,null);
});
test('course cards use safe configured images above permanent subject artwork and the actual image-error handler restores artwork without changing enrollment',async()=>{
 const image='https://images.example.org/course.jpg?caption=%22quoted%22&size=small',catalog={products:[product({image})],promotions:[]},h=harness(null,{responses:[{status:404,body:{}},{status:200,body:catalog}]});await h.api.load();
 const tag=h.host.innerHTML.match(/<img class="cs-course-image"[^>]*>/)?.[0];assert(tag);assert.match(tag,/referrerpolicy="no-referrer"/);assert.match(tag,/loading="lazy"/);assert.match(tag,/decoding="async"/);assert.match(tag,/src="https:\/\/images.example.org\/course.jpg\?caption=%22quoted%22&amp;size=small"/);assert.match(h.host.innerHTML,/data-course-art="math"/);assert.match(h.host.innerHTML,/<svg viewBox="0 0 320 240"/);
 const handler=tag.match(/onerror="([^"]+)"/)[1],media={hasImage:true,hasArtwork:true},imageElement={tagName:'IMG',classList:{contains:name=>name==='cs-course-image'},remove(){media.hasImage=false}};
 vm.runInNewContext('(function(){'+handler+'}).call(imageElement)',{SiyueCommerceStore:h.api,imageElement});assert.deepEqual(media,{hasImage:false,hasArtwork:true});
 assert.equal(h.api.snapshot().items.length,0);assert.equal(h.api.snapshot().quote,null);assert.equal(h.requests.length,2);assert.equal(await h.api.submit(),false);
 let unrelatedRemoved=false;h.api.courseImageFailed({tagName:'DIV',classList:{contains:()=>true},remove(){unrelatedRemoved=true}});assert.equal(unrelatedRemoved,false);
});
test('missing course images produce complete subject covers while preserving real course names, prices and compact class counts',async()=>{
 const subjects=['数学','英语','语文','科学'],products=subjects.map((subject,i)=>product({id:'cover-'+i,subject,name:subject+'完整课程名称',classes:[klass({id:'class-A',name:'很长的班级说明无需堆在目录',campusId:'A'}),klass({id:'class-B',name:'另一段班级说明无需堆在目录',campusId:'B'})]})),h=harness(null,{responses:[{status:404,body:{}},{status:200,body:{products,promotions:[]}}]});await h.api.load();
 for(const kind of ['math','english','book','general'])assert(h.host.innerHTML.includes('data-course-art="'+kind+'"'));
 assert.equal((h.host.innerHTML.match(/<svg viewBox="0 0 320 240"/g)||[]).length,4);assert.doesNotMatch(h.host.innerHTML,/<img class="cs-course-image"|很长的班级说明|另一段班级说明/);assert.equal((h.host.innerHTML.match(/2 个班级 · 2 个校区/g)||[]).length,4);
 for(const p of products){assert(h.host.innerHTML.includes(p.name));assert(h.host.innerHTML.includes('#cs-course-'+p.id))}assert.equal((h.host.innerHTML.match(/¥100\.01/g)||[]).length,4);assert.match(h.host.innerHTML,/原活动优惠不能继续使用/);
});
test('course image URLs accept safe HTTPS or same-origin relative paths and reject unsafe values without injecting attributes',async()=>{
 const unsafe=['javascript:alert(1)','data:image/svg+xml,<svg onload=alert(1)>','data:image/png;base64,AA','blob:https://www.siyuejn.com/id','file:///tmp/a.jpg','http://images.example.org/a.jpg','//images.example.org/a.jpg','https://user:secret@images.example.org/a.jpg','https://localhost/a.jpg','https://192.168.1.1/a.jpg','https://[::1]/a.jpg','https://images.example.org/a.jpg" onload="alert(1)','/\\images.example.org/a.jpg'];
 const safe=['https://images.example.org/a.jpg?caption="safe"&n=1','assets/course.jpg','/assets/course.jpg','../assets/course.jpg'];
 for(const image of [...unsafe,...safe]){
  const h=harness(null,{responses:[{status:404,body:{}},{status:200,body:{products:[product({image,name:'课程<img src=x onerror=alert(1)>'})],promotions:[]}}]});await h.api.load();
  const tags=[...h.host.innerHTML.matchAll(/<img class="cs-course-image"[^>]*>/g)];assert.equal(tags.length,safe.includes(image)?1:0,image);assert.match(h.host.innerHTML,/data-course-art="math"/);assert.doesNotMatch(h.host.innerHTML,/ onload=|<img src=x/);assert.match(h.host.innerHTML,/课程&lt;img src=x onerror=alert\(1\)&gt;/);
  if(tags.length){const src=tags[0][0].match(/src="([^"]+)"/)[1].replace(/&amp;/g,'&');const parsed=new URL(src);assert.equal(parsed.protocol,'https:');assert.equal(parsed.username,'');assert.equal(parsed.password,'');assert.equal(parsed.origin,image.startsWith('https:')?'https://images.example.org':'https://www.siyuejn.com');assert(!src.includes('"'))}
 }
});
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
test('404 loads a separate current directory with correct fresh links and never reuses the expired promotion or its application',async()=>{
 const current=offer({id:'PROMO_current',name:'当前拼团',thresholdMinor:10001}),joint=offer({id:'PROMO_joint',type:'joint',name:'当前联报',thresholdMinor:20000,courseIds:['course','second'],selections:[{courseId:'course',classIds:['klass']},{courseId:'second',classIds:['second-class']}]}),directory={products:[product(),product({id:'second',name:'第二课程',classes:[klass({id:'second-class'})]})],promotions:[offer({name:'不能沿用的原优惠'}),current,joint]};
 const h=harness(null,{responses:[{status:404,body:{message:'此活动未开放'}},{status:200,body:directory}]});await h.api.load();
 assert.deepEqual(h.requests.map(r=>r.url),['/crm-api/v1/public/store?promotionId=PROMO_target&type=group','/crm-api/v1/public/store']);
 assert.equal(h.api.snapshot().catalog,null);assert.equal(h.api.snapshot().discoveryReason,'unavailable');assert.equal(h.api.snapshot().promotionId,'');assert.match(h.host.innerHTML,/原活动已失效或暂不可报名/);assert.match(h.host.innerHTML,/当前拼团|当前联报|可用课程/);assert.match(h.host.innerHTML,/每人课程原价满 ¥100\.01 可享此优惠/);assert.match(h.host.innerHTML,/课程原价合计满 ¥200\.00 可享此优惠/);
 const links=[...h.host.innerHTML.matchAll(/href="([^"]+)"/g)].map(m=>new URL(m[1].replace(/&amp;/g,'&')));
 assert(links.some(u=>u.searchParams.get('promotionId')==='PROMO_current'&&u.searchParams.get('type')==='group'));assert(links.some(u=>u.searchParams.get('promotionId')==='PROMO_joint'&&u.searchParams.get('type')==='joint'));
 assert(links.some(u=>!u.search&&u.hash==='#cs-course-course'));assert(!links.some(u=>u.searchParams.get('promotionId')==='PROMO_target'));
 assert.doesNotMatch(h.host.innerHTML,/不能沿用的原优惠|cs-application|提交报名申请|cs-poster/);assert.equal(h.api.choose('klass'),false);assert.equal(await h.api.quote(),false);assert.equal(await h.api.submit(),false);assert.equal(h.requests.length,2);
 const normal=harness(directory,{url:links.find(u=>u.hash==='#cs-course-course').href});await normal.api.load();assert.match(normal.host.innerHTML,/id="cs-course-course"/);assert.match(normal.host.innerHTML,/id="courses"/);assert.equal(normal.api.choose('klass'),undefined);
});
test('directory excludes stale, full or past classes and activities without enough same-class or every-course capacity',async()=>{
 const products=[product({name:'有余位未来课',classes:[klass(),klass({id:'another-class'})]}),product({id:'stale',name:'旧教学版本',availableForApplication:false}),product({id:'full',name:'满班',classes:[klass({remainingSeats:0})]}),product({id:'past',name:'仅过去课',classes:[klass({schedule:[{date:'2026-10-29',time:'09:00–10:00'}]})]}),product({id:'cancelled',name:'仅取消未来课',classes:[klass({schedule:[{date:'2026-10-31',time:'09:00–10:00',status:'已取消'}]})]}),product({id:'completed',name:'仅完成未来课',classes:[klass({schedule:[{date:'2026-10-31',time:'09:00–10:00',status:'completed'}]})]}),product({id:'starting',name:'课次此刻已开始',classes:[klass({schedule:[{date:'2026-10-30',time:'08:00–09:00'}]})]}),product({id:'one-seat',name:'单席课程',classes:[klass({id:'one-seat-class',remainingSeats:1})]})];
 const promotions=[offer({id:'valid',name:'有余位整团',campusId:'A'}),offer({id:'wrong-campus',name:'活动校区不符',campusId:'B'}),offer({id:'too-large',name:'不可跨班拼余位',groupSize:4,selections:[{courseId:'course',classIds:['klass','another-class']}]}),offer({id:'wrong-class',name:'不在活动班级范围',selections:[{courseId:'course',classIds:['unselected']}]}),offer({id:'one-seat-group',name:'整团席位不足',courseIds:['one-seat'],selections:[{courseId:'one-seat',classIds:['one-seat-class']}]}),offer({id:'missing-joint',type:'joint',name:'联报缺课程',courseIds:['course','stale'],selections:[{courseId:'course',classIds:['klass']},{courseId:'stale',classIds:['klass']}]})];
 const h=harness(null,{responses:[{status:404,body:{}},{status:200,body:{products,promotions}}]});await h.api.load();assert.match(h.host.innerHTML,/有余位未来课|有余位整团|单席课程/);assert.doesNotMatch(h.host.innerHTML,/旧教学版本|满班|仅过去课|仅取消未来课|仅完成未来课|课次此刻已开始|活动校区不符|不可跨班拼余位|不在活动班级范围|整团席位不足|联报缺课程/);assert.doesNotMatch(h.host.innerHTML,/可享此优惠/);
});
test('empty directory has independent empty states and directory failures can retry without requesting the expired activity again',async()=>{
 for(const failed of [{status:503,body:{message:'不要把服务错误当作空目录'}},{error:new TypeError('directory network unavailable')},{status:200,body:{products:[]}}]){
  const h=harness(null,{responses:[{status:404,body:{}},failed,{status:200,body:{products:[],promotions:[]}}]});await h.api.load();assert.match(h.host.innerHTML,/当前课程与优惠暂时加载失败|重试加载课程与优惠/);assert.doesNotMatch(h.host.innerHTML,/暂无可报名课程/);assert.equal(h.api.snapshot().directory,null);
  assert.equal(await h.api.loadRecommendations(),true);assert.deepEqual(h.requests.map(r=>r.url),['/crm-api/v1/public/store?promotionId=PROMO_target&type=group','/crm-api/v1/public/store','/crm-api/v1/public/store']);assert.match(h.host.innerHTML,/暂无可报名课程/);assert.match(h.host.innerHTML,/暂无可查看的优惠活动/);assert.doesNotMatch(h.host.innerHTML,/cs-application/);
 }
});
test('target 500, network failure and incomplete success keep the original error and retry without a silent directory fallback',async()=>{
 for(const failed of [{status:500,body:{message:'暂时服务失败'}},{error:new TypeError('network unavailable')},{status:200,body:{products:[],promotions:[offer({id:'another'})]}}]){
  const h=harness(null,{responses:[failed,{status:200,body:{products:[],promotions:[offer()]}}]});await h.api.load();assert.equal(h.requests.length,1);assert.equal(h.api.snapshot().directory,null);assert.equal(h.api.snapshot().discoveryReason,'');assert.match(h.host.innerHTML,/活动暂时加载失败/);assert.doesNotMatch(h.host.innerHTML,/原活动已失效|当前课程与优惠|cs-application/);
  await h.api.load();assert.equal(h.requests.length,2);assert(h.requests.every(r=>r.url.includes('?promotionId=PROMO_target&type=group')));assert.equal(h.api.snapshot().promotionId,'PROMO_target');assert.match(h.host.innerHTML,/本活动报名/);
 }
});
test('malformed activity links safely show the generic directory, and recommendation text and links cannot inject HTML or reuse raw parameters',async()=>{
 const marker='<img src=x onerror=alert(1)>',evilId='course" onclick="alert(1)',row=offer({id:'safe-current',promotionTitle:marker,promotionIntroduction:'<script>alert(2)</script>'}),catalog={products:[product({id:evilId,name:marker,classes:[klass({name:marker,campusName:marker})]}),product()],promotions:[row]};
 const h=harness(catalog,{url:'https://www.siyuejn.com/crm/commerce-store.html?promotionId='+encodeURIComponent('<script>rawTarget</script>')+'&type=group&type=joint'});await h.api.load();assert.deepEqual(h.requests.map(r=>r.url),['/crm-api/v1/public/store']);assert.equal(h.api.snapshot().discoveryReason,'invalid');assert.match(h.host.innerHTML,/活动链接无效/);assert.doesNotMatch(h.host.innerHTML,/rawTarget|<img src=x|<script>|" onclick="alert/);assert.match(h.host.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.match(h.host.innerHTML,/&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
 for(const m of h.host.innerHTML.matchAll(/href="([^"]+)"/g)){const u=new URL(m[1].replace(/&amp;/g,'&'));assert.equal(u.origin,'https://www.siyuejn.com');assert.equal(u.pathname,'/crm/commerce-store.html');assert(!u.href.includes('rawTarget'));assert(!u.searchParams.has('promotionId')||u.searchParams.get('promotionId')==='safe-current')}
});
test('real isolated HTTP unavailable activity loads only current catalog cards while valid targets stay bound to their own form',async t=>{
 const {f,course,promotion}=await setup(t),expired=await promotion('group',{name:'已停止旧活动'}),current=await promotion('group',{name:'可查看新活动'});await f.execute('promotion.unpublish',{type:'group',promotionId:expired.id});
 const fetcher=async(url,init)=>{const response=await request(f.server,url.replace(/^\/crm-api/,''),init.method);return {ok:response.status===200,status:response.status,json:async()=>response.body}};
 const h=harness(null,{url:'https://www.siyuejn.com/crm/commerce-store.html?promotionId='+expired.id+'&type=group',fetch:fetcher});await h.api.load();assert.equal(h.requests.length,2);assert.match(h.host.innerHTML,/可查看新活动/);assert(!h.host.innerHTML.includes('已停止旧活动'));assert(h.host.innerHTML.includes(course.name));assert.equal(h.api.snapshot().catalog,null);assert.doesNotMatch(h.host.innerHTML,/cs-application/);
 const valid=harness(null,{url:'https://www.siyuejn.com/crm/commerce-store.html?promotionId='+current.id+'&type=group',fetch:fetcher});await valid.api.load();assert.equal(valid.requests.length,1);assert.equal(valid.api.snapshot().promotionId,current.id);assert.equal(valid.api.snapshot().directory,null);assert.match(valid.host.innerHTML,/本活动报名/);assert.equal(valid.api.mode('standard'),false);assert.equal(valid.api.offer(expired.id),false);
});
test('background boundary is shared by browser and server and legacy fallback is retained',()=>{
 assert.equal(shared.count('😀'.repeat(20)),20);assert.equal(shared.submitted({promotionTitle:'😀'.repeat(20)}).promotionTitle,'😀'.repeat(20));assert.throws(()=>shared.submitted({promotionTitle:'😀'.repeat(21)}));
 for(const raw of ['data:image/png;base64,AA','javascript:alert(1)','https://user:secret@images.example.org/a','https://localhost/a','https://[::ffff:127.0.0.1]/a','https://192.168.1.1/a'])assert.throws(()=>shared.background(raw));
 assert.equal(shared.background('#ABCDEF'),'#abcdef');assert.equal(shared.background('https://images.example.org/a.png'),'https://images.example.org/a.png');
 const legacy={name:'旧标题'.repeat(20),description:'旧说明'.repeat(40),posterBackground:'javascript:alert(1)'};
 assert.deepEqual(shared.presentation(legacy),{promotionTitle:legacy.name,promotionSubtitle:'',promotionIntroduction:legacy.description,posterBackground:''});
});
