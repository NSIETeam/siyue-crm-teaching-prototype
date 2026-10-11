const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','business-decor.js'),'utf8');
function fixture({data={},operations=['store.design.save','store.design.publish'],disabled=false,readResult='data:image/png;base64,AAAA',autoRead=true}={}){
 const calls=[],readers=[],ui={draft:{},operation:null};
 const document={querySelector(selector){return selector==='.bd-form-editor'?{querySelector(sel){return sel==='.bd-preview'?{innerHTML:''}:null}}:null}};
 const api={
  academicDraft(){return {operation:ui.operation,draft:ui.draft,data,disabled}},
  snapshot(){return data},
  open(id,seed){calls.push({type:'open',id,seed:structuredClone(seed)});ui.operation={id};ui.draft=structuredClone(seed);return true},
  input(path,value,type){calls.push({type:'input',path,value,fieldType:type});let target=ui.draft;for(const k of path.slice(0,-1))target=target[k]??(target[k]={});target[path.at(-1)]=value},
  change(path,value,type){calls.push({type:'change',path,value,fieldType:type});let target=ui.draft;for(const k of path.slice(0,-1))target=target[k]??(target[k]={});target[path.at(-1)]=value},
  redraw(){calls.push({type:'redraw'})}
 };
 class Reader{readAsDataURL(file){this.file=file;readers.push(this);if(autoRead){this.result=readResult;this.onload?.()}}}
 const win={businessAPI:api,document,URL,FileReader:Reader};win.window=win;win.globalThis=win;
 vm.runInNewContext(source,win,{filename:'business-decor.js'});
 const permitted=op=>operations.includes(op.id);
 return {mod:win.SiyueBusinessDecor,api,calls,readers,ui,ctx:{page:'mallDecor',user:{},data,operations:operations.map(id=>({id})),permitted}};
}

test('mature default template is offered only as a server operation and does not mutate source',()=>{
 const data={decor:{}};const f=fixture({data});const before=structuredClone(data);
 const html=f.mod.renderPage(f.ctx);
 assert.match(html,/iPhone 17/);assert.match(html,/iphone17/);assert.match(html,/store-hero/);assert.match(html,/每一份热爱，都值得被看见/);
 assert.match(html,/使用此模板/);assert.deepEqual(data,before);
 assert.equal(f.mod.useTemplate(),true);assert.equal(f.calls.at(-1).type,'open');assert.equal(f.calls.at(-1).id,'store.design.save');
 assert.equal(f.calls.at(-1).seed.decor.title,'思跃培优网校');assert.deepEqual(f.calls.at(-1).seed.decor.modules,['轮播图','课程展示','机构介绍']);
 assert.doesNotMatch(source,/localStorage\.setItem|decorSave\(/);
});

test('existing published version is preserved; editing and publishing use their distinct operations',()=>{
 const published={title:'线上版本',subtitle:'说明',color:'#3979ed',modules:['介绍'],blocks:{介绍:{title:'已发布',body:'原文',image:'',cta:'查看'}}};
 const data={decor:{published, draft:null}};const f=fixture({data});
 const html=f.mod.renderPage(f.ctx);assert.match(html,/已发布版本/);assert.doesNotMatch(html,/使用成熟模板/);
 assert.equal(f.mod.edit('draft'),true);assert.equal(f.calls.at(-1).id,'store.design.save');assert.equal(f.calls.at(-1).seed.decor.title,'线上版本');
 assert.equal(f.mod.publishDraft(),false);assert.deepEqual(data.decor.published,published);
 data.decor.draft={...published,title:'草稿'};assert.equal(f.mod.publishDraft(),true);assert.equal(f.calls.at(-1).id,'store.design.publish');assert.equal(f.calls.at(-1).seed.decor.title,'草稿');assert.equal(data.decor.published.title,'线上版本');
});

test('read-only accounts see the mature template without edit or save affordances',()=>{
 const f=fixture({operations:[]});const html=f.mod.renderPage(f.ctx);
 assert.match(html,/iPhone 17/);assert.doesNotMatch(html,/使用此模板|编辑装修草稿|预览并发布/);
 const form=f.mod.renderForm({operation:{id:'store.design.save'},draft:{decor:f.mod.defaultTemplate()},data:{},disabled:true});
 assert.match(form,/disabled/);
});

test('custom modules, text and published course snapshots are retained and escaped',()=>{
 const decor={title:'<script>x</script>',subtitle:'',color:'#3979ed',modules:['自定义模块','课程展示'],blocks:{自定义模块:{title:'<img src=x onerror=1>',body:'正文',image:'javascript:alert(1)',cta:''},'课程展示':{title:'课程',body:'',image:'',cta:'',courseIds:null}}};
 const f=fixture({data:{decor:{draft:decor},courses:[{id:'c1',name:'未来草稿课名',storefront:{status:'上架',content:{title:'公开课程名',subject:'数学',grade:'小学'}}}],shelved:['c1']}});
 const html=f.mod.renderPage(f.ctx);assert.match(html,/自定义模块/);assert.match(html,/公开课程名/);assert.doesNotMatch(html,/未来草稿课名/);assert.doesNotMatch(html,/<script>x<\/script>/);
 f.ui.draft={decor};f.mod.select('自定义模块');
 const edit=f.mod.renderForm({operation:{id:'store.design.save'},draft:{decor},data:f.ctx.data,disabled:false});
 assert.match(edit,/自定义模块/);assert.match(edit,/value="javascript:alert\(1\)"/);assert.match(edit,/当前图片地址不符合要求/);assert.match(edit,/&lt;img src=x onerror=1&gt;/);assert.match(edit,/data-business-path="\[&quot;decor&quot;,&quot;blocks&quot;,&quot;自定义模块&quot;,&quot;title&quot;\]"/);
});

test('custom block selection on the ordinary mall page does not need an active business operation',()=>{
 const f=fixture({data:{decor:{published:{title:'商城',modules:['自建内容'],blocks:{自建内容:{title:'专题区块',body:'说明'}}}}}});
 f.mod.renderPage(f.ctx);assert.equal(f.ui.operation,null);assert.equal(f.mod.select('自建内容'),true);
 const html=f.mod.renderPage(f.ctx);assert.match(html,/专题区块/);assert.match(html,/自建内容/);
});

test('local image upload validates type and backend data length, then writes only to the shared draft',()=>{
 const f=fixture();f.ui.operation={id:'store.design.save'};f.ui.draft={decor:f.mod.defaultTemplate()};f.mod.select('轮播图');
 const html=f.mod.renderForm({operation:f.ui.operation,draft:f.ui.draft,data:{},disabled:false});
 assert.match(html,/accept="image\/png,image\/jpeg,image\/webp"/);
 assert.equal(f.mod.upload({files:[{type:'image/png',size:4}]}),true);
 assert.equal(f.ui.draft.decor.blocks['轮播图'].image,'data:image/png;base64,AAAA');
 assert.equal(Array.from(f.calls.at(-1).path).join('/'),'decor/blocks/轮播图/image');
 const readCount=f.readers.length;
 assert.equal(f.mod.upload({files:[{type:'image/gif',size:4}]}),false);assert.equal(f.readers.length,readCount);
 assert.equal(f.mod.upload({files:[{type:'image/png',size:524001}]}),false);assert.equal(f.readers.length,readCount);
 const tooLong=fixture({readResult:'data:image/png;base64,'+'A'.repeat(700000)});tooLong.ui.operation={id:'store.design.save'};tooLong.ui.draft={decor:tooLong.mod.defaultTemplate()};tooLong.mod.select('轮播图');
 tooLong.mod.upload({files:[{type:'image/png',size:10}]});assert.equal(tooLong.ui.draft.decor.blocks['轮播图'].image,'');
 const saved='data:image/jpeg;base64,BBBB';const withImage={...f.mod.defaultTemplate(),blocks:{...f.mod.defaultTemplate().blocks,'轮播图':{...f.mod.defaultTemplate().blocks['轮播图'],image:saved}}};
 const retained=f.mod.renderForm({operation:{id:'store.design.save'},draft:{decor:withImage},data:{},disabled:false});
 assert.match(retained,/value="data:image\/jpeg;base64,BBBB" data-business-path="\[&quot;decor&quot;,&quot;blocks&quot;,&quot;轮播图&quot;,&quot;image&quot;\]"/);assert.match(retained,/data-business-type="string"/);
});

test('late FileReader completion after leaving the editor cannot alter the draft',()=>{
 const f=fixture({autoRead:false});f.ui.operation={id:'store.design.save'};f.ui.draft={decor:f.mod.defaultTemplate()};f.mod.select('轮播图');
 assert.equal(f.mod.upload({files:[{type:'image/png',size:4}]}),true);
 f.ui.operation={id:'course.create'};f.ui.draft={};f.readers[0].result='data:image/png;base64,AAAA';f.readers[0].onload();
 assert.equal(f.calls.filter(x=>x.type==='input').length,0);
});

test('module/course edits change only the shared business draft and never publish locally',()=>{
 const f=fixture({data:{courses:[{id:'c1',name:'一',active:true},{id:'c2',name:'二',active:true}],shelved:['c1','c2']}});
 const draft=f.mod.defaultTemplate();f.ui.draft={decor:draft};f.mod.setModule('教师介绍',true);
 assert.equal(f.ui.draft.decor.modules.includes('教师介绍'),true);assert.equal(f.calls.at(-1).type,'change');
 f.mod.setCourse('c1',false);assert.deepEqual(f.ui.draft.decor.blocks['课程展示'].courseIds,['c2']);
 f.mod.useAllCourses();assert.deepEqual(f.ui.draft.decor.blocks['课程展示'].courseIds,['c1','c2']);
 assert.equal(f.mod.move(-1),true);assert.equal(f.calls.filter(x=>x.type==='change').length,2);assert.equal(f.calls.filter(x=>x.type==='input').length,2);
 assert.equal(f.mod.select({name:'无效'}),false);assert.equal(f.mod.select('自定义模块'),true);f.mod.reset();
});

test('unknown route returns null and reset clears presentation-only selection',()=>{
 const f=fixture();assert.equal(f.mod.renderPage({page:'courses'}),null);assert.equal(f.mod.renderForm({operation:{id:'course.create'}}),null);
 f.mod.select('轮播图');f.mod.previewMode('published');f.mod.reset();
 assert.equal(f.mod.renderPage({...f.ctx,data:{decor:{published:{title:'P',modules:['轮播图'],blocks:{轮播图:{title:'T'}}}}}}).includes('P'),true);
});

test('real BusinessStore preserves schema-checked hidden blocks through save, reload, restore and publish',()=>{
 const {BusinessStore}=require('../backend/src/business-store.cjs'),{operations}=require('../backend/src/business-commerce.cjs');
 const store=new BusinessStore(':memory:'),actor={id:'decor-test-admin',name:'装修测试管理员',version:1,roleIds:['superadmin'],permissions:['store.design'],scope:{type:'all'}},directory=[actor],save=operations.find(x=>x.id==='store.design.save'),publish=operations.find(x=>x.id==='store.design.publish');
 try{
  const f=fixture(),template=JSON.parse(JSON.stringify(f.mod.defaultTemplate()));
  assert.equal(Object.hasOwn(template.blocks['课程展示'],'courseIds'),false);
  template.modules=['轮播图','课程展示','机构介绍'];template.blocks['机构介绍'].body='本次真实存储验证的隐藏文案';
  let snap=store.snapshot(),p=store.preview(save,{decor:template},actor,directory,snap.revision);
  let result=store.execute(save,{decor:template},actor,directory,{revision:p.revision,previewToken:p.previewToken,key:'decor-save-real-0001'});assert.equal(result.revision,1);
  snap=store.snapshot();assert.equal(snap.state.decor.draft.blocks['机构介绍'].body,'本次真实存储验证的隐藏文案');
  const hidden=JSON.parse(JSON.stringify(store.snapshot().state.decor.draft));hidden.modules=['轮播图','课程展示'];
  snap=store.snapshot();p=store.preview(save,{decor:hidden},actor,directory,snap.revision);
  result=store.execute(save,{decor:hidden},actor,directory,{revision:p.revision,previewToken:p.previewToken,key:'decor-hide-real-0001'});assert.equal(result.revision,2);
  snap=store.snapshot();assert.equal(snap.state.decor.draft.blocks['机构介绍'].body,'本次真实存储验证的隐藏文案');
  p=store.preview(publish,{},actor,directory,snap.revision);
  result=store.execute(publish,{},actor,directory,{revision:p.revision,previewToken:p.previewToken,key:'decor-hidden-publish-0001'});assert.equal(result.revision,3);
  snap=store.snapshot();assert.deepEqual(snap.state.decor.published.modules,['轮播图','课程展示']);
  assert.deepEqual(Object.keys(snap.state.decor.published.blocks),['轮播图','课程展示']);
  const restored=JSON.parse(JSON.stringify(snap.state.decor.draft));restored.modules.push('机构介绍');
  p=store.preview(save,{decor:restored},actor,directory,snap.revision);
  result=store.execute(save,{decor:restored},actor,directory,{revision:p.revision,previewToken:p.previewToken,key:'decor-show-real-0001'});assert.equal(result.revision,4);
  snap=store.snapshot();assert.equal(snap.state.decor.draft.blocks['机构介绍'].body,'本次真实存储验证的隐藏文案');
  p=store.preview(publish,{},actor,directory,snap.revision);
  result=store.execute(publish,{},actor,directory,{revision:p.revision,previewToken:p.previewToken,key:'decor-publish-real-001'});assert.equal(result.revision,5);
  snap=store.snapshot();assert.equal(snap.state.decor.published.title,'思跃培优网校');
  assert.deepEqual(snap.state.decor.published.modules,['轮播图','课程展示','机构介绍']);
  assert.equal(snap.state.decor.published.blocks['机构介绍'].body,'本次真实存储验证的隐藏文案');
 }finally{store.close()}
});
