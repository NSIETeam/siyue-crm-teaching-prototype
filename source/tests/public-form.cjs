'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../public-form.js'),'utf8');
const form={id:'FORM_1',title:'真实登记 <测试>',fields:[{id:'name',type:'name',title:'姓名',required:true},{id:'phone',type:'phone',title:'手机',required:true},{id:'multi',type:'multiple',title:'意向',options:['数学','语文']}]};
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});
async function create({payload={form,submissionKey:'visitor-key-1'},url='https://example.invalid/crm/public-form.html?id=FORM_1'}={}){const elements=new Map(),controls=[],calls=[];let responder=()=>response({received:true,submissionId:'SUB_1'});const el=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn},querySelectorAll(){return controls}});return elements.get(id)};const context={URL,location:new URL(url),crypto:{randomUUID:()=> 'new-key'},document:{getElementById:el},fetch:async(url,options)=>{calls.push({url,options});return options.method==='GET'?response(payload):responder(url,options)},console};vm.createContext(context);vm.runInContext(code,context);await new Promise(r=>setImmediate(r));return {calls,elements,controls,setResponder(fn){responder=fn},setControls(values={name:' 张同学 ',phone:'13800000001',multi:['数学']}){controls.splice(0,controls.length,...Object.entries(values).flatMap(([field,value])=>Array.isArray(value)?value.map((choice,index)=>({dataset:{field},value:choice,checked:index===0})):({dataset:{field},value:String(value??'')})))},changeField(field,value){const control=controls.find(row=>row.dataset.field===field);if(!control)throw Error('missing control '+field);control.value=value;elements.get('public-submit').listeners.change({target:control})},selectTrial(slotId){elements.get('public-submit').listeners.change({target:{id:'trial-slot',value:slotId,dataset:{}}})},submit(){return elements.get('public-submit').listeners.submit({preventDefault(){}})}}}
test('public page loads independently, escapes title and never sends employee credentials',async()=>{const b=await create();assert.match(b.elements.get('public-form-root').innerHTML,/真实登记 &lt;测试&gt;/);assert.equal(b.calls[0].url,'/crm-api/v1/public/forms/FORM_1');assert.equal(b.calls[0].options.credentials,'same-origin');assert.equal(b.calls[0].options.headers.Authorization,undefined);assert.equal(b.calls[0].options.headers['X-CSRF-Token'],undefined)});
test('unknown field types and invalid links fail closed without employee interface',async()=>{const b=await create({payload:{form:{...form,fields:[{id:'u',type:'upload'}]},submissionKey:'key'}});assert.match(b.elements.get('public-form-root').innerHTML,/暂不支持/);assert(!b.elements.has('public-submit'));const invalid=await create({url:'https://example.invalid/?id=..%2Fusers'});assert.equal(invalid.calls.length,0);assert.match(invalid.elements.get('public-form-root').innerHTML,/链接无效/)});
test('required fields are validated and successful submit uses answer IDs and receipt',async()=>{const b=await create();await b.submit();assert.equal(b.calls.length,1);assert.match(b.elements.get('public-form-root').innerHTML,/请填写姓名/);b.setControls();await b.submit();const post=b.calls[1];assert.equal(post.options.headers['Idempotency-Key'],'visitor-key-1');assert.deepEqual(JSON.parse(post.options.body),{answersById:{name:'张同学',phone:'13800000001',multi:['数学']},submissionId:'visitor-key-1'});assert.match(b.elements.get('public-form-root').innerHTML,/提交成功/);await b.submit();assert.equal(b.calls.length,2)});
test('double submit is suppressed and lost responses retry same body and idempotency key',async()=>{const b=await create();b.setControls();let reject;b.setResponder(()=>new Promise((_,r)=>reject=r));const pending=b.submit();await b.submit();assert.equal(b.calls.length,2);reject(Error('网络中断'));await pending;assert.match(b.elements.get('public-form-root').innerHTML,/重试确认提交结果/);const original=b.calls[1];b.controls[0].value='不应替换原提交';b.setResponder(()=>response({received:true,submissionId:'SUB_1'}));await b.submit();assert.equal(b.calls[2].options.body,original.options.body);assert.equal(b.calls[2].options.headers['Idempotency-Key'],original.options.headers['Idempotency-Key']);assert.match(b.elements.get('public-form-root').innerHTML,/回执编号：SUB_1/)});
test('known validation failure unlocks correction and creates new logical request key',async()=>{const b=await create();b.setControls();b.setResponder(()=>response({message:'手机号无效'},400));await b.submit();assert.match(b.elements.get('public-form-root').innerHTML,/手机号无效/);assert.match(b.elements.get('public-form-root').innerHTML,/value="张同学"/);b.controls[1].value='13900000001';b.setResponder(()=>response({received:true,submissionId:'SUB_2'}));await b.submit();assert.equal(b.calls[2].options.headers['Idempotency-Key'],'new-key');assert.equal(JSON.parse(b.calls[2].options.body).answersById.phone,'13900000001')});

const rewardForm={id:'FORM_REWARD',title:'奖励与试课',kind:'lead',collectLead:true,campusId:null,fields:[
 {id:'campus',type:'dropdown',title:'校区',options:['东城','西城'],required:true},
 {id:'grade',type:'dropdown',title:'年级',options:['小学一年级','小学二年级'],required:true},
 {id:'subject',type:'dropdown',title:'学科',options:['数学','语文'],required:true},
 {id:'name',type:'name',title:'学生姓名',required:true},
 {id:'phone',type:'phone',title:'家长手机号',required:true}
],settings:{trial:{enabled:true,campusFieldId:'campus',gradeFieldId:'grade',subjectFieldId:'subject',nameFieldId:'name',phoneFieldId:'phone',slots:[
 {id:'slot-east-math',campusId:'east',campus:'东城',course:'东城数学',grade:'小学一年级',subject:'数学',date:'2099-01-01',time:'10:00',remaining:2},
 {id:'slot-west-chinese',campusId:'west',campus:'西城',course:'西城语文',grade:'小学二年级',subject:'语文',date:'2099-01-02',time:'14:00',remaining:1}
]}}};
async function rewardPage(){return create({payload:{form:rewardForm,submissionKey:'reward-request-1'},url:'https://example.invalid/crm/public-form.html?id=FORM_REWARD'})}
function fillMatch(b,campus='东城',grade='小学一年级',subject='数学'){b.setControls({campus,grade,subject,name:'张同学',phone:'13800000001'});for(const [id,value] of [['campus',campus],['grade',grade],['subject',subject]])b.changeField(id,value)}

test('public receipt shows either a delivered material link or coupon claim code',async()=>{
 const material=await create({payload:{form,submissionKey:'material-request'}});
 material.setControls();material.setResponder(()=>response({received:true,submissionId:'SUB_MATERIAL',reward:{type:'material_link',title:'试听资料',url:'https://example.test/guide'}}));
 await material.submit();let html=material.elements.get('public-form-root').innerHTML;
 assert.match(html,/试听资料/);assert.ok(html.includes('https://example.test/guide'));assert.match(html,/打开资料链接/);
 const coupon=await create({payload:{form,submissionKey:'coupon-request'}});
 coupon.setControls();coupon.setResponder(()=>response({received:true,submissionId:'SUB_COUPON',reward:{type:'coupon',title:'新客优惠券',claimToken:'claim-code-123',discountMinor:5000,thresholdMinor:20000}}));
 await coupon.submit();html=coupon.elements.get('public-form-root').innerHTML;
 assert.match(html,/新客优惠券/);assert.match(html,/claim-code-123/);assert.match(html,/优惠金额：50.00 元/);assert.match(html,/办理报名时向工作人员出示领取码/);
});

test('trial options wait for all match fields, show matching slots, and appointment remains optional',async()=>{
 const b=await rewardPage();let html=b.elements.get('public-form-root').innerHTML;
 assert.match(html,/暂不预约/);assert.doesNotMatch(html,/slot-east-math|slot-west-chinese/);
 fillMatch(b);html=b.elements.get('public-form-root').innerHTML;
 assert.match(html,/东城数学/);assert.doesNotMatch(html,/西城语文/);
 await b.submit();const input=JSON.parse(b.calls.at(-1).options.body);
 assert.equal(input.answersById.campus,'东城');assert.equal(input.answersById.grade,'小学一年级');assert.equal(input.answersById.subject,'数学');
 assert.equal(Object.hasOwn(input,'trialBooking'),false,'the parent can submit without reserving a trial slot');
});

test('changing a match field clears the previously selected slot before submit',async()=>{
 const b=await rewardPage();fillMatch(b);b.selectTrial('slot-east-math');
 b.changeField('campus','西城');b.changeField('grade','小学二年级');b.changeField('subject','语文');
 const html=b.elements.get('public-form-root').innerHTML;
 assert.match(html,/西城语文/);assert.doesNotMatch(html,/东城数学/);
 b.setResponder(()=>response({received:true,submissionId:'SUB_SWITCH'}));await b.submit();
 const input=JSON.parse(b.calls.at(-1).options.body);
 assert.equal(Object.hasOwn(input,'trialBooking'),false,'a slot from the previous match cannot be carried into the request');
});

test('invalid trial slot is removed from the retry request while answers remain available',async()=>{
 const b=await rewardPage();fillMatch(b);b.selectTrial('slot-east-math');
 b.setResponder(()=>response({message:'该试课时段已无效'},409));await b.submit();
 assert.match(b.elements.get('public-form-root').innerHTML,/该试课时段已无效/);
 assert.match(b.elements.get('public-form-root').innerHTML,/value="张同学"/);
 b.setResponder(()=>response({received:true,submissionId:'SUB_NO_TRIAL'}));await b.submit();
 const request=JSON.parse(b.calls.at(-1).options.body);
 assert.equal(Object.hasOwn(request,'trialBooking'),false,'retry must omit the rejected slot');
 assert.equal(request.answersById.campus,'东城');assert.equal(request.answersById.phone,'13800000001');
});
