'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./helpers/commerce-fixture.cjs');
const {request,origin}=require('./helpers/remaining-http.cjs');
const raw=f=>f.database(store=>store.snapshot());
const publicRead=(f,id,type='group')=>request(f.server,'/v1/public/store'+(id?'?'+new URLSearchParams({promotionId:id,type}):''),'GET',undefined,{Origin:origin});
async function rejected(f,input,pattern){const before=raw(f),plan=await f.plan('promotion.update',input);assert.equal(plan.response.status,400,JSON.stringify(plan.response.body));assert.match(plan.response.body.message,pattern);assert.deepEqual(raw(f),before);}
test('promotion presentation survives commit and server restart, publishes only its exact available product range',async t=>{
 const {f,course,klass,promotion}=await setup(t),other=await promotion('group',{name:'不可混入的其他活动'}),fields={promotionTitle:'😀'.repeat(20),promotionSubtitle:'活动副标题',promotionIntroduction:'课程介绍\n真实学员成团',posterBackground:'#DDEEFF'};
 const created=(await f.execute('promotion.create',{type:'group',name:'活动内部名称',description:'内部兼容介绍',start:'2026-10-30',end:'2026-11-30',discountMinor:1000,courseIds:[course.id],groupSize:2,validHours:24,campusId:'A',...fields})).result.record;
 assert.equal(created.promotionTitle,fields.promotionTitle);assert.equal(created.posterBackground,'#ddeeff');
 assert(!(await publicRead(f)).body.promotions.some(p=>p.id===created.id));
 assert.equal((await publicRead(f,created.id)).status,404);
 await f.restart();
 let record=(await f.state()).state.activities.group.find(p=>p.id===created.id);
 assert.equal(record.promotionTitle,fields.promotionTitle);assert.equal(record.promotionIntroduction,fields.promotionIntroduction);
 await f.execute('promotion.publish',{type:'group',promotionId:created.id,expectedVersion:record.version});
 const visible=await publicRead(f,created.id);
 assert.equal(visible.status,200,JSON.stringify(visible.body));assert.equal(visible.body.selectedPromotionId,created.id);
 assert.deepEqual(visible.body.promotions.map(p=>p.id),[created.id]);assert.equal(visible.body.promotions[0].promotionTitle,fields.promotionTitle);
 assert.equal(visible.body.promotions[0].posterBackground,'#ddeeff');assert.deepEqual(visible.body.products.map(p=>p.id),[course.id]);assert.deepEqual(visible.body.products[0].classIds,[klass.id]);
 assert(!JSON.stringify(visible.body).includes(other.id));for(const key of ['createdBy','publishedBy','history','buyers','studentIds','visitorHash'])assert(!Object.hasOwn(visible.body.promotions[0],key));
 record=(await f.state()).state.activities.group.find(p=>p.id===created.id);
 await f.execute('promotion.update',{type:'group',promotionId:created.id,expectedVersion:record.version,patch:{promotionTitle:'新推广标题',promotionSubtitle:'',promotionIntroduction:'更新后的介绍',posterBackground:'https://images.example.org/promotion.jpg'}});
 assert.equal((await publicRead(f,created.id)).status,404,'editing removes public visibility until republished');
 await f.restart();record=(await f.state()).state.activities.group.find(p=>p.id===created.id);
 assert.equal(record.promotionTitle,'新推广标题');assert.equal(record.promotionSubtitle,'');assert.equal(record.posterBackground,'https://images.example.org/promotion.jpg');
 await f.execute('promotion.publish',{type:'group',promotionId:created.id,expectedVersion:record.version});
 assert.equal((await publicRead(f,created.id)).body.promotions[0].promotionIntroduction,'更新后的介绍');
 await f.execute('promotion.unpublish',{type:'group',promotionId:created.id});
 assert.equal((await publicRead(f,created.id)).status,404);
});
test('new promotion fields reject overflow, unsafe backgrounds and unlisted properties without changing saved state',async t=>{
 const {f,promotion}=await setup(t),offer=await promotion('group',{campusId:'A'});
 for(const patch of [{promotionTitle:'😀'.repeat(21)},{promotionSubtitle:'文'.repeat(21)},{promotionIntroduction:'文'.repeat(51)}])await rejected(f,{type:'group',promotionId:offer.id,patch},/最多(?:20|50)字/);
 for(const posterBackground of ['javascript:alert(1)','data:image/png;base64,AA','http://images.example.org/p.jpg','https://user:secret@images.example.org/a','https://localhost/a','https://x.localhost/a','https://intranet/a','https://x.local/a','https://127.0.0.1/a','https://2130706433/a','https://0x7f000001/a','https://10.1.2.3/a','https://172.31.0.1/a','https://192.168.1.1/a','https://169.254.1.1/a','https://[::1]/a','https://[fc00::1]/a','https://[::ffff:127.0.0.1]/a'])await rejected(f,{type:'group',promotionId:offer.id,patch:{posterBackground}},/海报背景/);
 await rejected(f,{type:'group',promotionId:offer.id,patch:{promotionTitle:'有效',promotionSecret:'越过白名单'}},/不支持/);
 const marketer=await f.employee({name:'乙校区运营',roleIds:['operations'],scope:{type:'campus',campusIds:['B']}});
 const before=raw(f),denied=await f.plan('promotion.update',{type:'group',promotionId:offer.id,patch:{promotionTitle:'越权推广'}},marketer);
 assert.equal(denied.response.status,403);assert.deepEqual(raw(f),before);
});
test('legacy fallback is not truncated or migrated; empty dedicated fields clear config and retain prior name and description',async t=>{
 const {f,promotion}=await setup(t),name='历史活动名称'.repeat(6),description='历史活动说明'.repeat(20),offer=await promotion('group',{name,description});
 let visible=await publicRead(f,offer.id);assert.equal(visible.body.promotions[0].promotionTitle,name);assert.equal(visible.body.promotions[0].promotionIntroduction,description);
 await f.execute('promotion.update',{type:'group',promotionId:offer.id,expectedVersion:offer.version,patch:{promotionTitle:'',promotionSubtitle:'',promotionIntroduction:'',posterBackground:''}});
 await f.restart();const record=(await f.state()).state.activities.group.find(p=>p.id===offer.id);
 assert.equal(record.name,name);assert.equal(record.description,description);assert.equal(record.promotionTitle,'');assert.equal(record.posterBackground,'');
 await f.execute('promotion.publish',{type:'group',promotionId:record.id,expectedVersion:record.version});
 visible=await publicRead(f,record.id);assert.equal(visible.body.promotions[0].promotionTitle,name);assert.equal(visible.body.promotions[0].promotionIntroduction,description);
 f.clock='2026-10-29T00:00:00Z';assert.equal((await publicRead(f,record.id)).status,404);
 f.clock='2026-12-01T00:00:00Z';assert.equal((await publicRead(f,record.id)).status,404);
 f.clock='2026-10-30T00:00:00Z';await f.execute('product.unpublish',{courseId:record.courseIds[0]});assert.equal((await publicRead(f,record.id)).status,404);
 for(const query of ['promotionId=missing&type=group','promotionId=missing&type=joint','promotionId=missing','promotionId=x&type=group&type=joint','promotionId=x&type=coupon']){const r=await request(f.server,'/v1/public/store?'+query,'GET',undefined,{Origin:origin});assert([400,404].includes(r.status),JSON.stringify(r.body));assert.equal(r.body.products,undefined);assert.equal(r.body.promotions,undefined);}
});
