'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(operation='class.schedule'){
 const state={operation:{id:operation},draft:operation==='class.schedule'?{classId:'c1',sessions:[]}:{name:'测试课程',priceCents:10001,lessons:[{title:'讲一',durationMinutes:45},{title:'讲二',durationMinutes:80},{title:'讲三',durationMinutes:90}]},data:{dictionary:{subjects:['编程']},campuses:[{id:'p1',name:'一校区',grades:['小四'],subjects:['数学'],roomDetails:[{name:'教室1',capacity:30}]}],directory:[{id:'t1',name:'教师甲',roleIds:['teacher']}],courses:[{id:'q1',name:'四年级数学',grade:'小学四年级',subject:'数学',lessons:[{id:'l1',title:'讲一',durationMinutes:45},{id:'l2',title:'讲二',durationMinutes:80},{id:'l3',title:'讲三',durationMinutes:90}]}],classes:[{id:'c1',name:'甲班',courseId:'q1',campusId:'p1',teacherId:'t1',room:'教室1',schedule:[]},{id:'c2',name:'乙班',courseId:'q1',campusId:'p1',teacherId:'t1',room:'教室1',schedule:[{id:'busy',lessonId:'l1',date:'2099-01-06',time:'09:00–09:45'}]}],attendance:[],consumptions:[]},disabled:false};
 let writes=0,html='';const window={businessAPI:{academicDraft:()=>structuredClone(state),academicSet(p,v){writes++;if(!p.length)state.draft=structuredClone(v);else {let x=state.draft;p.slice(0,-1).forEach(k=>x=x[k]);x[p.at(-1)]=structuredClone(v)}render()}},document:{getElementById:()=>null}};const ctx=vm.createContext({window,globalThis:window,console,Date,module:undefined});
 for(const file of ['academic-dictionary.js','academic-planner.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:file});
 function render(){html=window.SiyueAcademicPlanner.field({...state,key:'sessions',path:['sessions'],schema:{type:'array'}})||'';return html}
 render();return {state,window,api:window.SiyueAcademicPlanner,render,html:()=>html,writes:()=>writes};
}
test('twelve readable grades, configured subjects, and campus multi-select scope share vocabulary',()=>{
 const f=setup('course.create'),field=(key,value)=>f.api.field({...f.state,draft:{[key]:value},key,path:[key],schema:{type:'string'},required:true});
 const grades=field('grade','小四');assert.equal((grades.match(/<option value=/g)||[]).length,13);assert.match(grades,/value="小四" selected>小学四年级/);assert.match(grades,/高中三年级/);assert.doesNotMatch(grades,/<input/);
 assert.match(field('subject',''),/编程/);const html=f.api.field({...f.state,operation:{id:'campus.create'},key:'grades',path:['grades'],schema:{type:'array'},draft:{grades:[]}});assert.equal((html.match(/type="checkbox"/g)||[]).length,12);
 const limited=f.api.field({...f.state,draft:{campusId:'p1'},key:'grade',path:['grade'],schema:{type:'string'}});assert.match(limited,/小学四年级/);assert.doesNotMatch(limited,/高中三年级/);
});
test('campus create and update room rows expose virtual seats with the exact accessible hint',()=>{
 const tip='教室里大概能临时添置几个小椅子';
 for(const [operation,draft,path] of [
  ['campus.create',{rooms:[{name:'101',capacity:20}]},['rooms',0]],
  ['campus.update',{patch:{rooms:[{name:'101',capacity:20,virtualSeats:3}]}},['patch','rooms',0]]
 ]){
  const f=setup(operation),html=f.api.field({...f.state,operation:{id:operation},draft,key:'item',path,schema:{type:'object'}});
  assert.match(html,/虚拟座位/);assert.match(html,/type="number" min="0" max="10000" step="1"/);assert.match(html,/value="(?:0|3)"/);
  assert.ok(html.includes(`title="${tip}"`));assert.ok(html.includes(`aria-label="${tip}"`));assert.match(html,/M10 6v6M10 15h\.01/);
  assert.ok(html.includes('&quot;virtualSeats&quot;'));
 }
});
test('price summary uses integer-cent per-lesson split, not duration, and escapes invalid input',()=>{
 const f=setup('course.create'),h=f.api.extra(f.state);assert.match(h,/¥33\.33–¥33\.34/);assert.match(h,/前 2 讲/);assert.match(h,/215 分钟/);assert.match(h,/实收分摊/);f.state.draft.priceCents=9000;assert.match(f.api.extra(f.state),/¥30\.00/);f.state.draft.lessons=[];assert.match(f.api.extra(f.state),/填写课程总价和讲次/);
});
test('placing, moving and dropping lessons keeps each fixed duration and stable session identity',()=>{
 const f=setup();f.api.select('l1');assert.equal(f.api.position('2099-01-06',600),true);assert.equal(f.state.draft.sessions[0].time,'10:00–10:45');f.state.draft.sessions[0].id='existing';f.api.position('2099-01-07',630);assert.equal(f.state.draft.sessions.length,1);assert.equal(f.state.draft.sessions[0].id,'existing');assert.equal(f.state.draft.sessions[0].time,'10:30–11:15');
 f.api.select('l2');f.api.position('2099-01-07',720);assert.equal(f.state.draft.sessions[1].time,'12:00–13:20');f.api.select('l3');f.api.position('2099-01-08',540);assert.equal(f.state.draft.sessions[2].time,'09:00–10:30');
 f.api.drop({preventDefault(){},dataTransfer:{getData:()=> 'l2'},currentTarget:{getBoundingClientRect:()=>({top:100})},clientY:100+300*1.2},'2099-01-08');assert.equal(f.state.draft.sessions.length,3);assert.equal(f.state.draft.sessions[1].time,'13:00–14:20');
});
test('planner displays occupied cells and conflict markers, then leaves authoritative check to server preview',()=>{
 const f=setup();f.api.select('l1');f.api.position('2099-01-06',540);const html=f.html();assert.match(html,/ap-busy/);assert.match(html,/乙班/);assert.match(html,/class="ap-block conflict/);assert.match(html,/时间冲突/);assert.match(html,/检查|预览确认后才保存/);assert.match(html,/height:54px/);
});
test('past, recorded and cross-day placements cannot change draft; pending switches need inline confirmation',()=>{
 const f=setup();f.api.select('l1');assert.equal(f.api.position('2000-01-01',540),false);assert.equal(f.state.draft.sessions.length,0);assert.equal(f.api.position('2099-01-06',1430),false);f.api.position('2099-01-06',600);f.state.draft.sessions[0].id='recorded';f.state.data.attendance.push({sessionId:'recorded'});assert.equal(f.api.position('2099-01-06',660),false);assert.equal(f.state.draft.sessions[0].time,'10:00–10:45');f.api.removeSelected();assert.equal(f.state.draft.sessions.length,1);
 f.api.filter('classId','c2');assert.match(f.html(),/切换会放弃/);assert.equal(f.state.draft.classId,'c1');f.api.cancelFilter();assert.equal(f.state.draft.classId,'c1');f.api.filter('classId','c2');f.api.confirmFilter();assert.equal(f.state.draft.classId,'c2');assert.equal(f.state.draft.sessions[0].id,'busy');
});
test('readonly or uncertain form prevents all planner writes and unrecognized drag payloads',()=>{
 const f=setup();f.state.disabled=true;const before=f.writes();f.api.position('2099-01-06',600);f.api.filter('classId','c2');f.api.week(7);assert.equal(f.writes(),before);f.state.disabled=false;f.api.drop({preventDefault(){},dataTransfer:{getData:()=> 'external'}},'2099-01-06');assert.equal(f.writes(),before);
});
