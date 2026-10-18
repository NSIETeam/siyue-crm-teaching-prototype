'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8'),plain=x=>JSON.parse(JSON.stringify(x)),decode=x=>x.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const settle=()=>new Promise(r=>setImmediate(r));
const ops=[...require('../backend/src/business-academic.cjs').operations,...require('../backend/src/business-commerce.cjs').operations,...require('../backend/src/business-student-communication.cjs').operations].filter(o=>['course.create','product.publish','promotion.create','session.attendance','student.communicate'].includes(o.id)).map(o=>({id:o.id,label:o.label,permission:o.permission,inputSchema:o.inputSchema,execution:'server'}));
async function app(options={}){
 const data={courses:[{id:'Q',name:'数学',version:1,published:true,priceCents:10000,lessons:[{id:'E1',title:'数字'}],storefront:{classIds:['C','D']}}],classes:[{id:'C',name:'数学一班',courseId:'Q',teacherId:'T',campusId:'N',durationMinutes:60,schedule:[{id:'L',lessonId:'E1',date:'2026-10-14',time:'09:00–10:00'}]},{id:'D',name:'数学二班',courseId:'Q',teacherId:'T',campusId:'N',schedule:[]}],students:[{id:'S1',name:'锁定学生',phone:'13800000000',version:1},{id:'S2',name:'未点名学生',phone:'13900000000',version:2}],enrollments:[{studentId:'S1',classId:'C',status:'active'},{studentId:'S2',classId:'C',status:'active'}],campuses:[{id:'N',name:'校区'}],directory:[{id:'T',name:'教师'}],activities:{coupon:[],group:[],joint:[]},shelved:['Q'],hiddenShelved:[],...options.data};
 const roster=options.roster||[{studentId:'S1',name:'锁定学生',phone:'138****0000',recorded:true,locked:true,consumptionConfirmed:true,attendanceStatus:'attended',note:''},{studentId:'S2',name:'未点名学生',phone:'139****0000',recorded:false,locked:false,consumptionConfirmed:false,attendanceStatus:'attended',note:''}];
 const calls=[],toasts=[];let revision=1,subscriber,html='',controls=[];
 const attr=(attrs,name)=>decode(attrs.match(new RegExp('(?:^|\\s)'+name+'="([^\"]*)"'))?.[1]||'');
 const view={scrollTop:0,scrollLeft:0,setAttribute(){},removeAttribute(){},get innerHTML(){return html},set innerHTML(value){html=value;controls=[];for(const m of value.matchAll(/<(input|select|textarea)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)){const[,tag,attrs,body='']=m;if(!attrs.includes('data-business-path='))continue;const selected=tag==='select'?[...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].find(x=>/\bselected\b/.test(x[1])):null;controls.push({type:attr(attrs,'type')||tag,disabled:/\bdisabled\b/.test(attrs),checked:/\bchecked\b/.test(attrs),dataset:{businessPath:attr(attrs,'data-business-path'),businessType:attr(attrs,'data-business-type')},value:tag==='textarea'?decode(body):tag==='select'?selected?attr(selected[1],'value'):'' :attr(attrs,'value')});}},querySelector(){return null}};
 const crumb={textContent:'',setAttribute(){}};
 const document={addEventListener(){},scrollingElement:view,querySelector:s=>s==='#view'?view:s==='#crumb'?crumb:null,querySelectorAll:s=>s==='#business-form [data-business-path]'?controls:[],getElementById:()=>null};
 const user={id:'A',version:1,permissions:[...new Set(ops.map(o=>o.permission)),'student.read'],scope:{type:'all'},roleIds:['academic']};
 const sandbox={SIYUE_AUTH_API:true,URLSearchParams,document,state:{page:options.page||'attendance'},a:{},leadState:{},mallState:{},mfState:{},workflowState:{},sysRules:{},permissionCanVisit:()=>true,render(){},nav(){},accountOpen(){},workspaceBack(){},workflowSearchEntries(){},toast:m=>toasts.push(m),crypto:{randomUUID:()=>String(Math.random())},employeeAuth:{subscribe:fn=>{subscriber=fn},current:()=>user,has:p=>user.permissions.includes(p),async request(endpoint,init={}){calls.push({endpoint,init:plain(init)});if(endpoint==='v1/state?crm=compact')return {state:plain(data),revision,capabilities:{businessReady:true}};if(endpoint==='v1/catalog')return {operations:ops};if(endpoint.startsWith('v1/sessions/attendance-roster?'))return {roster:plain(roster)};if(endpoint.startsWith('v1/students/communications?')){if(options.history)return options.history();const query=new URLSearchParams(endpoint.split('?')[1]),records=(data.studentCommunications||[]).filter(r=>r.studentId===query.get('studentId')&&r.classId===query.get('classId'));return {total:records.length,records:plain(records)}};if(endpoint.endsWith('/preview'))return {previewToken:'p'+revision,revision,result:options.recordPreview?{record:plain(init.body.input)}:{input:plain(init.body.input)}};if(endpoint.endsWith('/execute')){revision++;if(endpoint.includes('student.communicate'))(data.studentCommunications||=[]).push({...plain(init.body.input),id:'COMM'+revision,actorId:user.id,actorName:'教务',createdAt:new Date().toISOString()});if(endpoint.includes('product.publish'))data.courses[0].storefront.classIds=plain(init.body.input.classIds);if(endpoint.includes('promotion.create'))data.activities[init.body.input.type].push({...plain(init.body.input),id:'P',version:1});return {revision,state:plain(data),result:{record:{...plain(init.body.input)}}};}throw Error('Unexpected '+endpoint)}}};
 sandbox.window=sandbox;vm.createContext(sandbox);for(const name of ['page-layouts.js','business-presenter.js','academic-planner.js','business-academic.js','crm-followup-layout.js','business-student-communication.js','business-commerce-selection.js','business-api.js'])vm.runInContext(source(name),sandbox,{filename:name});subscriber(user);await settle();await settle();
 return {api:sandbox.businessAPI,communication:sandbox.SiyueStudentCommunication,academic:sandbox.SiyueBusinessAcademic,commerce:sandbox.SiyueBusinessCommerceSelection,planner:sandbox.SiyueAcademicPlanner,calls,toasts,get html(){return html},get controls(){return controls},get data(){return data},field(p){return controls.find(c=>c.dataset.businessPath===JSON.stringify(p))}};
}

test('real adapter collects unblurred communication and callback through preview execute and history reopen',async()=>{
 const a=await app({page:'students'});
 assert.equal(a.api.open('student.communicate',{studentId:'S1',classId:'C',channel:'phone',expectedVersion:1}),true);await settle();
 assert.match(a.html,/data-crm-followup-workspace/);assert.match(a.html,/沟通与回访记录/);
 a.field(['note']).value='实际表单未失焦内容';a.field(['nextFollowAt']).value='2027-01-02T10:30';a.field(['channel']).value='wecom';
 assert.equal(await a.api.preview(),true);const preview=a.calls.find(c=>c.endpoint.endsWith('/preview'));
 assert.equal(preview.init.body.input.note,'实际表单未失焦内容');assert.equal(preview.init.body.input.channel,'wecom');assert.equal(preview.init.body.input.nextFollowAt,new Date('2027-01-02T10:30').toISOString());
 assert.equal(preview.init.body.input.studentId,'S1');assert.equal(preview.init.body.input.classId,'C');assert.equal(preview.init.body.input.expectedVersion,1);
 assert.equal(await a.api.execute(),true);const execution=a.calls.find(c=>c.endpoint.endsWith('/execute'));assert.deepEqual(execution.init.body.input,preview.init.body.input);assert.ok(execution.init.headers['Idempotency-Key']);
 a.api.open('student.communicate',{studentId:'S1',classId:'C',channel:'text',expectedVersion:1});await settle();await settle();assert.match(a.html,/实际表单未失焦内容/);assert.match(a.html,/2027/);
});
test('real adapter student change clears text and selects authorized target version before preview',async()=>{
 const a=await app({page:'students'});a.api.open('student.communicate',{studentId:'S1',classId:'C',channel:'text',note:'前一学生内容',expectedVersion:1});await settle();
 assert.equal(a.communication.chooseStudent('S2'),true);a.field(['note']).value='新学生内容';assert.equal(await a.api.preview(),true);
 const input=a.calls.find(c=>c.endpoint.endsWith('/preview')).init.body.input;assert.equal(input.studentId,'S2');assert.equal(input.expectedVersion,2);assert.equal(input.note,'新学生内容');assert.doesNotMatch(a.html,/前一学生内容/);
});

test('async history redraw retains current unblurred note and callback form controls',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);const a=await app({page:'students',history:()=>pending});a.api.open('student.communicate',{studentId:'S1',classId:'C',channel:'text',expectedVersion:1});await settle();
 a.field(['note']).value='异步读取期间尚未失焦';a.field(['nextFollowAt']).value='2027-01-03T10:30';release({total:0,records:[]});await settle();
 assert.equal(a.field(['note']).value,'异步读取期间尚未失焦');assert.equal(a.field(['nextFollowAt']).value,'2027-01-03T10:30');
});


test('phone communication preview uses the channel label instead of the global phone field label',async()=>{
 const a=await app({page:'students',recordPreview:true});
 a.api.open('student.communicate',{studentId:'S1',classId:'C',channel:'phone',expectedVersion:1});await settle();
 a.field(['note']).value='电话沟通预览回归';assert.equal(await a.api.preview(),true);
 const preview=a.html.match(/<section class="business-preview">([\s\S]*?)<\/section>/)?.[1];
 assert.ok(preview,'server record is rendered in the communication preview');
 assert.match(preview,/<dt>沟通方式<\/dt><dd>电话<\/dd>/);
 assert.doesNotMatch(preview,/<dt>沟通方式<\/dt><dd>手机号<\/dd>/);
});
