'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
const source=readFileSync(require('node:path').join(__dirname,'../business-commerce-selection.js'),'utf8');
function harness(id='product.publish',draft={}){
 const ctx={operation:{id},draft,data:{courses:[{id:'C1',name:'数学<一年级>',grade:'一年级',subject:'数学',version:4,storefront:{classIds:['K1','K2']}},{id:'C2',name:'英语',version:2,storefront:{classIds:['K4']}},{id:'C3',name:'停用课程',active:false},{id:'C4',name:'无班级课程'}],classes:[{id:'K1',name:'周六班',courseId:'C1',campusId:'N1'},{id:'K2',name:'周日班',courseId:'C1'},{id:'K3',name:'停用班',courseId:'C1',active:false},{id:'K4',name:'英语班',courseId:'C2'},{id:'K5',name:'未上架班',courseId:'C1'}],campuses:[{id:'N1',name:'北校区'}],shelved:['C1','C2'],hiddenShelved:[]},disabled:false};
 const calls=[];const root={businessAPI:{academicDraft:()=>structuredClone(ctx),academicSet(path,value){assert.deepEqual(Array.from(path),[]);ctx.draft=JSON.parse(JSON.stringify(value));calls.push(structuredClone(value));return true},open(...args){calls.push(JSON.parse(JSON.stringify(args)));return true}}};
 runInNewContext(source,{window:root,Set,Map,JSON,Array,String,Number});
 return {ctx,calls,api:root.SiyueBusinessCommerceSelection};
}
function field(h,key,path=[key]){return h.api.field({...h.ctx,key,path})}
test('product course defaults every valid class and individual cancellation persists',()=>{
 const h=harness();assert.equal(h.api.selectCourse('C1',true),true);
 assert.deepEqual(h.ctx.draft.classIds,['K1','K2','K5']);assert.equal(h.ctx.draft.expectedVersion,4);
 assert.equal(h.api.toggleClass('C1','K2',false),true);assert.deepEqual(h.ctx.draft.classIds,['K1','K5']);
 const html=field(h,'courseId');assert.match(html,/数学&lt;一年级&gt;/);assert.match(html,/周日班/);assert.match(html,/北校区/);assert.doesNotMatch(html,/停用班/);assert.equal(field(h,'classIds'),'');
 assert.equal(h.api.toggleClass('C1','K4',true),false);assert.deepEqual(h.ctx.draft.classIds,['K1','K5']);
});
test('product replacement selects new course and never permits courses without valid classes',()=>{
 const h=harness();h.api.selectCourse('C1',true);h.api.toggleClass('C1','K1',false);h.api.selectCourse('C2',true);
 assert.deepEqual(h.ctx.draft,{courseId:'C2',classIds:['K4'],expectedVersion:2});
 assert.equal(h.api.selectCourse('C4',true),false);assert.equal(h.api.selectCourse('C3',true),false);
});
test('all classes are selected without a hidden hundred-class truncation',()=>{
 const h=harness();h.ctx.data.classes=Array.from({length:130},(_,i)=>({id:'KL'+i,courseId:'C1',name:'班级'+i}));
 h.api.selectCourse('C1',true);assert.equal(h.ctx.draft.classIds.length,130);assert.equal(h.ctx.draft.classIds.at(-1),'KL129');
});
for(const type of ['group','joint'])test(type+' selects all sellable classes, saves exclusions and preserves round trip selections',()=>{
 const h=harness('promotion.create',{type,name:'活动'});h.api.selectCourse('C1',true);h.api.selectCourse('C2',true);h.api.toggleClass('C1','K2',false);
 assert.deepEqual(h.ctx.draft.courseIds,['C1','C2']);assert.deepEqual(h.ctx.draft.selections,[{courseId:'C1',classIds:['K1']},{courseId:'C2',classIds:['K4']}]);
 assert.equal(h.api.toggleClass('C1','K5',true),false);assert.equal(field(h,'selections'),'');
 const readback=harness('promotion.update',{type,promotionId:'P1',expectedVersion:2,patch:structuredClone(h.ctx.draft)});
 const html=field(readback,'courseIds',['patch','courseIds']);assert.match(html,/已选 1 个/);
 readback.api.toggleClass('C1','K1',false);assert.deepEqual(readback.ctx.draft.patch.selections[0].classIds,[]);assert.match(field(readback,'courseIds',['patch','courseIds']),/至少保留一个班级/);
 assert.equal(readback.ctx.draft.expectedVersion,2);assert.equal(readback.ctx.draft.promotionId,'P1');
 readback.api.selectCourse('C1',false);assert.deepEqual(readback.ctx.draft.patch.courseIds,['C2']);
});
test('saved empty selection is preserved and renders a correction message',()=>{
 const h=harness('promotion.update',{type:'group',patch:{courseIds:['C1'],selections:[{courseId:'C1',classIds:[]}]}});
 assert.match(field(h,'courseIds',['patch','courseIds']),/已选 0 个/);assert.deepEqual(h.ctx.draft.patch.selections[0].classIds,[]);
});
test('legacy promotion class range comes from its storefront when first changed',()=>{
 const h=harness('promotion.update',{type:'group',patch:{courseIds:['C1']}});h.api.toggleClass('C1','K2',false);
 assert.deepEqual(h.ctx.draft.patch.selections,[{courseId:'C1',classIds:['K1']}]);
});
test('disabled drafts and unrelated operations cannot be changed',()=>{
 const h=harness();h.ctx.disabled=true;assert.equal(h.api.selectCourse('C1',true),false);assert.equal(h.api.toggleClass('C1','K1',true),false);
 h.ctx.operation.id='course.create';h.ctx.disabled=false;assert.equal(field(h,'courseId'),null);assert.equal(h.api.selectCourse('C1',true),false);
});
test('shelf editing reads exact persisted exclusions and passes version to server preview flow',()=>{
 const h=harness();h.ctx.data.courses[0].storefront.classIds=['K2'];const page={...h.ctx,page:'mallShelf',query:'数学',operations:[{id:'product.publish'}],permitted:()=>true};
 const html=h.api.renderPage(page);assert.match(html,/1 个可售班级/);assert.match(html,/修改上架班级/);assert.match(html,/班级详情/);assert.doesNotMatch(html,/英语班/);
 h.api.openProduct('C1');assert.deepEqual(h.calls.at(-1),['product.publish',{courseId:'C1',classIds:['K2'],expectedVersion:4}]);
});
test('hidden products cannot be selected for a promotion',()=>{
 const h=harness('promotion.create',{type:'group'});h.ctx.data.hiddenShelved=['C1'];assert.equal(h.api.selectCourse('C1',true),false);assert.doesNotMatch(field(h,'courseIds'),/数学&lt;/);
});
