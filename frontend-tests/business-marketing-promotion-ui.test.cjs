'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const rules=require('../promotion-content.js');
const source=fs.readFileSync(path.join(__dirname,'../business-commerce-selection.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function harness(update=false){
 const data={courses:[{id:'math',name:'数学提高',subject:'数学',grade:'四年级',courseType:'onsite',priceCents:10500,storefront:{classIds:['m1','m2']}},{id:'english',name:'英语阅读',subject:'英语',courseType:'live',priceCents:12000,storefront:{classIds:['e1']}}],classes:[{id:'m1',courseId:'math',name:'周六班',campusId:'A',capacity:20,students:5,teacherId:'t1',teachingMode:'group',schedule:[{date:'2030-11-01',time:'10:00-11:00',teacherId:'t1'},{date:'2030-12-01',time:'10:00-11:00',substituteTeacherId:'t2'}]},{id:'m2',courseId:'math',name:'周日班',capacity:10,students:3,schedule:[{date:'2030-11-02'}]},{id:'hidden',courseId:'math',name:'未上架班',capacity:999,students:999,schedule:[{date:'2099-01-01'}]},{id:'e1',courseId:'english',name:'英语班',capacity:12,studentIds:['filtered-roster-id'],schedule:[{date:'2030-11-03'}]}],directory:[{id:'t1',name:'老师甲'},{id:'t2',name:'老师乙'}],campuses:[{id:'A',name:'甲校区'}],shelved:['math','english'],hiddenShelved:[],activities:{group:[]}};
 const fields={name:'活动名',description:'原说明',start:'2030-10-01',end:'2030-12-31',discountMinor:1000,groupSize:2,validHours:24,courseIds:['math'],selections:[{courseId:'math',classIds:['m1']}]};
 const ctx={operation:{id:update?'promotion.update':'promotion.create'},draft:update?{type:'group',promotionId:'draft-1',patch:fields,expectedVersion:4}:{type:'group',...fields},data,disabled:false};
 const calls=[],nodes=new Map();let redraws=0;
 const root={SiyuePromotionContent:rules,location:{href:'https://www.siyuejn.com/crm/'},document:{getElementById:id=>nodes.get(id)||null},businessAPI:{academicDraft:()=>structuredClone(ctx),academicSet(path,next){ctx.draft=plain(next);calls.push(['set',plain(next)]);return true;},input(path,value){let target=ctx.draft;for(const key of path.slice(0,-1))target=target[key]||(target[key]={});target[path.at(-1)]=value;calls.push(['input',Array.from(path),value]);},redraw(){redraws++;},preview(){calls.push(['preview']);return true;},open(...args){calls.push(['open',...plain(args)]);return true;}}};
 vm.runInNewContext(source,{window:root,URL,Set,Map,JSON,Array,String,Number,Date,Object});
 const api=root.SiyueBusinessCommerceSelection;
 return {ctx,data,calls,nodes,api,root,get redraws(){return redraws;},value:()=>update?ctx.draft.patch:ctx.draft,html(){return api.field({...ctx,key:'courseIds',path:update?['patch','courseIds']:['courseIds']});}};
}
test('course name/subject filters preserve hidden selected courses and exact per-class exclusions',()=>{
 const h=harness(),before=plain(h.ctx.draft);
 assert.equal(h.api.pickerFilter('name','英语'),true);
 assert.match(h.html(),/英语阅读/);assert.doesNotMatch(h.html(),/数学提高|已选课程已停用/);
 assert.deepEqual(plain(h.ctx.draft),before);assert.equal(h.calls.length,0);
 assert.equal(h.api.selectCourse('english',true),true);
 assert.deepEqual(plain(h.value().selections),[{courseId:'math',classIds:['m1']},{courseId:'english',classIds:['e1']}]);
 h.api.pickerFilter('name','');h.api.pickerFilter('subject','数学');assert.doesNotMatch(h.html(),/英语阅读/);
 h.api.clearPickerFilters();assert.match(h.html(),/数学提高/);assert.match(h.html(),/英语阅读/);assert.match(h.html(),/已选 2 门/);
 assert.deepEqual(plain(h.value().selections[0].classIds),['m1']);
});
test('course-name search runs on input and restores the caret after filtering',()=>{
 const h=harness(),calls=[];
 h.root.document.querySelector=selector=>{assert.equal(selector,'[data-bcs-picker-filter="name"]');return {focus(options){calls.push(['focus',options.preventScroll]);},setSelectionRange(start,end){calls.push(['caret',start,end]);}};};
 assert.match(h.html(),/oninput="SiyueBusinessCommerceSelection\.pickerFilter\('name',this\.value,this\)"/);
 assert.equal(h.api.pickerFilter('name','英语',{selectionStart:2,selectionEnd:2}),true);
 assert.deepEqual(calls,[['focus',true],['caret',2,2]]);assert.match(h.html(),/找到 1 门课程/);
});
test('catalog summaries use sellable class dates, teachers, price and existing counts without roster inference',()=>{
 const h=harness(),html=h.html();
 assert.match(html,/2030-11-01/);assert.match(html,/2030-12-01/);assert.match(html,/面授/);assert.match(html,/老师甲/);assert.match(html,/老师乙/);assert.match(html,/¥105\.00/);assert.match(html,/8 \/ 30/);
 assert.doesNotMatch(html,/2099-01-01|999|filtered-roster-id/);assert.match(html,/— \/ 12/);
 const editor=h.api.renderGroupForm(h.ctx);assert.match(editor,/课程拼团价/);assert.match(editor,/¥95\.00/);assert.match(editor,/5 \/ 20/);assert.doesNotMatch(editor.split('<details')[0],/2030-11-02/);
});
test('locked drafts cannot change filters, selection or promotion fields',()=>{
 const h=harness();h.ctx.disabled=true;
 assert.equal(h.api.pickerFilter('name','英语'),false);assert.equal(h.api.clearPickerFilters(),false);
 assert.equal(h.api.selectCourse('english',true),false);assert.equal(h.api.posterColor('#e5f0fa'),false);
 assert.equal(h.api.promotionInput('promotionTitle',{value:'不可修改'}),false);assert.equal(h.calls.length,0);
});
test('dedicated group promotion fields do not appear in unrelated coupon or joint forms',()=>{
 for(const type of ['coupon','joint'])for(const update of [false,true]){
  const h=harness(update);h.ctx.draft.type=type;
  for(const key of ['promotionTitle','promotionSubtitle','promotionIntroduction','posterBackground'])assert.equal(h.api.field({...h.ctx,key,path:update?['patch',key]:[key]}),'');
 }
});
test('promotion edit writes dedicated patch fields and leaves legacy name/description untouched',()=>{
 const h=harness(true);assert.equal(h.api.groupNext(),true);
 const html=h.api.renderGroupForm(h.ctx);assert.match(html,/推广副标题/);assert.match(html,/海报设计/);assert.match(html,/0\/20/);assert.match(html,/0\/50/);assert.match(html,/原说明/);
 assert.match(html,/data-business-path="\[&quot;patch&quot;,&quot;promotionTitle&quot;\]"/);
 h.api.promotionInput('promotionTitle',{value:'专属推广标题',setCustomValidity(){},setAttribute(){}});
 assert.equal(h.value().promotionTitle,'专属推广标题');assert.equal(h.value().name,'活动名');assert.equal(h.value().description,'原说明');
 h.api.posterColor('#e5f0fa');assert.equal(h.value().posterBackground,'#e5f0fa');assert.equal(h.ctx.draft.expectedVersion,4);
});
test('Unicode limits count emoji and compatibility characters as codepoints without rewriting punctuation',()=>{
 const h=harness();h.api.groupNext();let validity='';const counter={textContent:'',classList:{toggle(){}}};h.nodes.set('bcs-count-promotionTitle',counter);
 const input={value:'😀'.repeat(20),setCustomValidity(v){validity=v;},setAttribute(){}};
 assert.equal(h.api.promotionInput('promotionTitle',input),true);assert.equal(counter.textContent,'20/20');assert.equal(validity,'');
 input.value+='😀';assert.equal(h.api.promotionInput('promotionTitle',input),false);assert.equal(counter.textContent,'21/20');assert.match(validity,/20/);
 assert.equal(h.api.groupNext(),false);assert.equal(h.calls.filter(c=>c[0]==='preview').length,0);
 input.value=' ﬃ ';assert.equal(h.api.promotionInput('promotionTitle',input),true);assert.equal(counter.textContent,'1/20');
 input.value='中文，原样。';assert.equal(h.api.promotionInput('promotionTitle',input),true);assert.equal(counter.textContent,'6/20');assert.equal(h.value().promotionTitle,'中文，原样。');assert.equal(rules.submitted({promotionTitle:input.value}).promotionTitle,'中文，原样。');
});
test('poster background validation rejects active or private destinations and escapes stored markup',()=>{
 const h=harness();h.api.groupNext();let error='';const input={value:'https://127.0.0.1/private',setCustomValidity(v){error=v;},setAttribute(){}};
 assert.equal(h.api.promotionInput('posterBackground',input),false);assert(error);assert.equal(h.api.groupNext(),false);
 input.value='https://cdn.example.com/poster.png';assert.equal(h.api.promotionInput('posterBackground',input),true);assert.equal(error,'');
 h.value().promotionSubtitle='<img src=x onerror=alert(1)>';const html=h.api.renderGroupForm(h.ctx);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x|style="[^\"]*url\(/);
});
test('list promotion preview is scoped to the selected activity and shares only published dedicated links',()=>{
 const h=harness();let qrData='';h.root.qrcode=()=>({addData(v){qrData=v;},make(){},createSvgTag(){return '<svg data-qr="local"></svg>';}});
 h.data.activities.group=[{id:'draft-1',name:'未发布活动',start:'2030-10-01',end:'2099-12-31',published:false},{id:'published-2',name:'已发布活动',promotionTitle:'第二活动',promotionSubtitle:'专属副标题',start:'2030-10-01',end:'2099-12-31',published:true}];
 const page={page:'mallGroup',data:h.data,operations:[],permitted:()=>false};assert.match(h.api.renderPage(page),/>推广</);
 assert.equal(h.api.showPromotion('invisible'),false);assert.equal(h.api.showPromotion('draft-1'),true);
 const draft=h.api.renderPage(page);assert.match(draft,/草稿/);assert.doesNotMatch(draft,/data-qr="local"|活动报名链接/);
 assert.equal(h.api.showPromotion('published-2'),true);const published=h.api.renderPage(page);
 assert.match(published,/专属副标题/);assert.match(published,/data-qr="local"/);assert.equal(qrData,'https://www.siyuejn.com/crm/commerce-store.html?promotionId=published-2&type=group');
 assert.doesNotMatch(qrData,/draft-1/);assert.equal(h.api.showPromotion(null),true);assert.doesNotMatch(h.api.renderPage(page),/bcs-promotion-share/);
});
