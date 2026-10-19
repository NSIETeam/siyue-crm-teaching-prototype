'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setup}=require('../backend/test/helpers/commerce-fixture.cjs');
const source=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
function harness({clock='2026-10-30T16:30:00Z',selection=true}={}){
 const NativeDate=Date;let tick=NativeDate.parse(clock);const FixedDate=class extends NativeDate{constructor(...args){super(...(args.length?args:[tick]))}static now(){return tick}};
 const calls=[],root={location:{href:'https://www.siyuejn.com/crm/'},businessAPI:{open(...args){calls.push(JSON.parse(JSON.stringify(args)));return true},redraw(){}}};
 const sandbox={window:root,Date:FixedDate,URL,Set,Map,JSON,Array,String,Number,Intl,Object};vm.createContext(sandbox);
 if(selection)vm.runInContext(source('business-commerce-selection.js'),sandbox);vm.runInContext(source('business-commerce-checkout.js'),sandbox);
 const operations=['promotion.create','promotion.update','promotion.publish','promotion.unpublish','commerce.checkout.create'].map(id=>({id,inputSchema:{properties:{patch:{properties:{}}}}}));
 const offer=extra=>({id:'test-offer',name:'合成测试活动',start:'2026-10-31',end:'2026-11-30',published:true,publishedVersion:2,version:2,courseIds:['course-a','course-b'],discountMinor:1000,groupSize:2,...extra});
 const context=(type,row,permitted=()=>true)=>({page:type==='group'?'mallGroup':'mallJoint',data:{activities:{[type]:[row]}},operations,permitted,user:{permissions:[]}});
 return {calls,selection:root.SiyueBusinessCommerceSelection,checkout:root.SiyueBusinessCommerceCheckout,offer,context,setClock(value){tick=NativeDate.parse(value)}};
}
for(const type of ['group','joint'])test(type+' list shows actual status and offers enrollment only while the published campaign is in effect',()=>{
 const h=harness(),cases=[
  [{},'进行中',true,false],
  [{start:'2026-11-01'},'未开始',false,false],
  [{end:'2026-10-30'},'已过期',false,false],
  [{published:false,status:'已结束',version:3},'已停止',false,true],
  [{published:false,status:'草稿'},'草稿',false,true],
  [{version:3},'待重新发布',false,false]
 ];
 for(const [extra,status,canEnroll,canPublish]of cases){
  const row=h.offer(extra),before=JSON.stringify(row),html=h.checkout.renderPage(h.context(type,row));
  assert(html.includes('>'+status+'</span>'),status);assert.equal(html.includes('>登记报名'+(type==='joint'?'申请':'')+'</button>'),canEnroll,status);
  assert.equal(/(?:groupAction\((?:'|&quot;)promotion.publish|publishOffer\()/.test(html),canPublish,status);
  const count=h.calls.length;assert.equal(h.checkout.openCreate(type,row.id),canEnroll,status);assert.equal(h.calls.length,count+(canEnroll?1:0));
  if(canEnroll)assert.equal(h.calls.at(-1)[1].buyers.length,type==='group'?2:1);
  assert.equal(JSON.stringify(row),before,'rendering must not mutate activity records');
 }
 const expired=h.checkout.renderPage(h.context(type,h.offer({published:false,end:'2026-10-30',status:'已结束'})));
 assert.match(expired,/活动已过期，请先编辑有效期后再发布/);assert.doesNotMatch(expired,/>草稿<\/span>|>发布活动<\/button>|>重新发布活动<\/button>/);
 const stopped=h.checkout.renderPage(h.context(type,h.offer({published:false,status:'已结束'})));
 assert.match(stopped,type==='group'?/>重新发布</:/>重新发布活动</);
});
test('campaign date boundaries use Beijing midnight and include the entire end date',()=>{
 const h=harness(),row=h.offer({start:'2026-10-31',end:'2026-10-31'}),state=stamp=>h.selection.promotionState(row,Date.parse(stamp));
 assert.equal(state('2026-10-30T15:59:59.999Z').status,'未开始');assert.equal(state('2026-10-30T16:00:00Z').canEnroll,true);
 assert.equal(state('2026-10-31T15:59:59.999Z').canEnroll,true);assert.equal(state('2026-10-31T16:00:00Z').status,'已过期');
});
test('stale campaign actions are checked again at click time without bypassing permissions',()=>{
 const h=harness(),row=h.offer(),ctx=h.context('group',row);h.checkout.renderPage(ctx);h.setClock('2026-12-01T00:00:00Z');
 assert.equal(h.checkout.openCreate('group',row.id),false);row.published=false;assert.equal(h.selection.groupAction('promotion.publish',row.id),false);assert.equal(h.calls.length,0);
 h.setClock('2026-10-31T00:00:00Z');h.checkout.renderPage(h.context('joint',h.offer(),()=>false));assert.equal(h.checkout.openCreate('joint',row.id),false);assert.equal(h.calls.length,0);
});
test('missing campaign status component asks for refresh and never offers enrollment or publication',()=>{
 const h=harness({selection:false}),html=h.checkout.renderPage(h.context('joint',h.offer()));assert.match(html,/活动状态组件未加载，请刷新页面/);assert.doesNotMatch(html,/>登记报名申请<|>发布活动</);assert.equal(h.checkout.openCreate('joint','test-offer'),false);
});
for(const type of ['group','joint'])test(type+' stopped activity can still be published through the existing server preview, while expired publication is rejected',async t=>{
 const h=harness(),{f,promotion}=await setup(t),row=await promotion(type);await f.execute('promotion.unpublish',{type,promotionId:row.id});
 const stopped=(await f.state()).state.activities[type].find(item=>item.id===row.id);assert.equal(h.selection.promotionState(stopped,Date.parse(f.clock)).canPublish,true);
 const plan=await f.plan('promotion.publish',{type,promotionId:row.id,expectedVersion:stopped.version});assert.equal(plan.response.status,200,JSON.stringify(plan.response.body));
 const published=await f.commit('promotion.publish',plan);assert.equal(published.status,200,JSON.stringify(published.body));assert.equal(h.selection.promotionState(published.body.result.record,Date.parse(f.clock)).canEnroll,true);
 await f.execute('promotion.unpublish',{type,promotionId:row.id});f.clock='2026-12-01T00:00:00Z';await f.refresh(f.admin);const expired=(await f.state()).state.activities[type].find(item=>item.id===row.id);
 assert.equal(h.selection.promotionState(expired,Date.parse(f.clock)).canPublish,false);const rejected=await f.plan('promotion.publish',{type,promotionId:row.id,expectedVersion:expired.version});assert.equal(rejected.response.status,400);assert.match(rejected.response.body.message,/活动已过期/);
});

test('joint publication rechecks the old button at Beijing midnight and preserves permission checks',()=>{
 const h=harness(),row=h.offer({published:false,status:'已结束',end:'2026-10-31'});let html=h.checkout.renderPage(h.context('joint',row));
 assert.match(html,/publishOffer/);assert.equal(h.checkout.publishOffer('joint',row.id),true);assert.deepEqual(h.calls.at(-1),['promotion.publish',{type:'joint',promotionId:row.id,expectedVersion:row.version}]);
 const count=h.calls.length;h.setClock('2026-10-31T16:00:00Z');assert.equal(h.checkout.publishOffer('joint',row.id),false);assert.equal(h.calls.length,count);
 h.setClock('2026-10-31T00:00:00Z');h.checkout.renderPage(h.context('joint',row,()=>false));assert.equal(h.checkout.publishOffer('joint',row.id),false);assert.equal(h.calls.length,count);
});
