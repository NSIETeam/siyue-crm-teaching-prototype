'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {publicCatalog}=require('../src/business-commerce-checkout.cjs');
const {setup}=require('./helpers/commerce-fixture.cjs');
const {request,origin}=require('./helpers/remaining-http.cjs');
const now='2026-10-30T00:00:00Z';
function sample(){
 const courses=['math','language'].map(id=>({id,name:'合成课程'+id,active:true,version:1,published:true,publishedVersion:1,priceCents:10000,storefront:{status:'上架',courseVersion:1,classIds:[id+'-class'],content:{title:'合成课程'+id,priceCents:10000}}}));
 const classes=courses.map((course,index)=>({id:course.id+'-class',name:'合成班级',courseId:course.id,campusId:'A',room:'教室'+index,status:'active',capacity:4,schedule:[{id:course.id+'-session',date:'2026-10-31',time:index?'11:00–12:00':'09:00–10:00',status:'scheduled'}]}));
 const common={published:true,publishedVersion:1,version:1,start:'2026-10-30',end:'2026-11-30',discountMinor:1000,thresholdMinor:0,total:10,used:0};
 const group={...common,id:'group',type:'group',name:'合成拼团',courseIds:['math'],selections:[{courseId:'math',classIds:['math-class']}],groupSize:2,validHours:24};
 const joint={...common,id:'joint',type:'joint',name:'合成联报',courseIds:courses.map(c=>c.id),selections:courses.map(c=>({courseId:c.id,classIds:[c.id+'-class']}))};
 return {courses,classes,shelved:courses.map(c=>c.id),hiddenShelved:[],campuses:[{id:'A',name:'合成校区',active:true,roomDetails:[0,1].map(index=>({name:'教室'+index,capacity:4}))}],activities:{group:[group],joint:[joint]},enrollments:[],sessionAdjustments:[],students:[],trialBookings:[]};
}
const read=state=>publicCatalog(state,now);
function occupy(state,classId,count){for(let index=0;index<count;index++)state.enrollments.push({id:classId+'-enrollment-'+index,classId,studentId:classId+'-student-'+index,status:'active'});}
test('public course classes require an active future session and expose only that future schedule',()=>{
 for(const schedule of [[],[{id:'past',date:'2026-10-29',time:'09:00–10:00'}],...['cancelled','ended','completed','已取消','已结束','已完成'].map(status=>[{id:status,date:'2026-10-31',time:'09:00–10:00',status}])]){
  const state=sample();state.classes[0].schedule=schedule;const before=structuredClone(state),catalog=read(state),product=catalog.products.find(row=>row.id==='math');
  assert.deepEqual(product.classes,[]);assert.deepEqual(product.classIds,[]);assert.equal(product.availableForApplication,false);assert.equal(catalog.promotions.length,0);assert.deepEqual(state,before);
 }
 const state=sample(),future=structuredClone(state.classes[0].schedule[0]);state.classes[0].schedule=[{id:'past',date:'2026-10-29',time:'09:00–10:00'},{...future,id:'cancelled',status:'cancelled'},future];
 assert.deepEqual(read(state).products[0].classes[0].schedule.map(row=>row.id),[future.id]);
});
test('full classes keep truthful capacity but do not make a course or activity available',()=>{
 const state=sample();occupy(state,'math-class',4);const catalog=read(state),product=catalog.products.find(row=>row.id==='math');
 assert.equal(product.classes[0].remainingSeats,0);assert.equal(product.availableForApplication,false);assert.match(product.unavailableReason,/已满/);assert.equal(catalog.promotions.length,0);
});
test('a last single seat remains available for ordinary or joint enrollment but cannot hold a complete group',()=>{
 const state=sample();occupy(state,'math-class',3);const catalog=read(state);
 assert.equal(catalog.products[0].availableForApplication,true);assert.equal(catalog.products[0].classes[0].remainingSeats,1);assert.deepEqual(catalog.promotions.map(row=>row.id),['joint']);
});
test('new public activity discovery excludes exhausted quota and quota smaller than a whole group without exposing usage',()=>{
 for(const used of [1,2]){const state=sample();Object.assign(state.activities.group[0],{total:2,used});const catalog=read(state);assert(!catalog.promotions.some(row=>row.id==='group'));assert(catalog.products[0].availableForApplication);}
 const state=sample();Object.assign(state.activities.joint[0],{total:1,used:1});const before=structuredClone(state),catalog=read(state);
 assert.deepEqual(catalog.promotions.map(row=>row.id),['group']);for(const row of catalog.promotions)for(const field of ['used','studentIds','buyers','history'])assert(!Object.hasOwn(row,field));assert.deepEqual(state,before);
});
test('activities cannot borrow seats outside their selected class range and joint offers need every course',()=>{
 const state=sample(),spare={...structuredClone(state.classes[0]),id:'unselected-spare'};state.classes.push(spare);state.courses[0].storefront.classIds.push(spare.id);occupy(state,'math-class',4);
 const catalog=read(state);assert(catalog.products[0].availableForApplication,'ordinary product still has the separately shelved spare class');assert.equal(catalog.promotions.length,0,'no activity may borrow the unselected spare');
 const partial=sample();partial.classes[1].schedule=[];assert(!read(partial).promotions.some(row=>row.id==='joint'));assert(read(partial).promotions.some(row=>row.id==='group'));
});
test('hiding a fully reserved offer from new public applicants does not block its accepted checkout receipt',async t=>{
 const {f,promotion,cart}=await setup(t,{capacity:2}),offer=await promotion('group',{total:2,maxPerUser:1}),checkout=(await f.execute('commerce.checkout.create',cart('group',offer))).result.checkout;
 await f.execute('commerce.checkout.accept',{checkoutId:checkout.id});
 const before=f.database(store=>store.snapshot());assert.equal(before.state.activities.group.find(row=>row.id===offer.id).used,2);
 const catalog=await request(f.server,'/v1/public/store','GET',undefined,{Origin:origin});assert.equal(catalog.status,200);assert(!catalog.body.promotions.some(row=>row.id===offer.id));
 const targeted=await request(f.server,'/v1/public/store?'+new URLSearchParams({promotionId:offer.id,type:'group'}),'GET',undefined,{Origin:origin});assert.equal(targeted.status,404);assert.equal(targeted.body.products,undefined);assert.equal(targeted.body.promotions,undefined);
 assert.deepEqual(f.database(store=>store.snapshot()),before,'public discovery must not alter reservations or usage');
 const result=await f.execute('commerce.checkout.confirmReceipt',{checkoutId:checkout.id,amountCents:18000,reference:'ISOLATED-PUBLIC-DISCOVERY-RECEIPT',method:'bank'});
 assert.equal(result.result.checkout.status,'paid');const after=f.database(store=>store.snapshot());assert.equal(after.state.receipts.length,2);assert(after.state.enrollments.every(row=>row.status==='active'));assert.equal(after.state.activities.group.find(row=>row.id===offer.id).used,2);
});
