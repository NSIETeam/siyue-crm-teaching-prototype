'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),{join}=require('node:path'),{runInNewContext}=require('node:vm');
const {setup}=require('../backend/test/helpers/commerce-fixture.cjs');
const source=readFileSync(join(__dirname,'../business-commerce-selection.js'),'utf8');
const header=['活动ID','活动名称','活动时间','状态','活动商品总数','发起团数','成团数','失败团数','已成团人数','操作'];
const csvHeader=['活动ID','活动名称','开始日期','结束日期','状态','商品数'];
const blobUtf8=async blob=>Buffer.from(await blob.arrayBuffer()).toString('utf8');
const epoch=Date.parse('2026-10-30T00:00:00Z');
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[epoch]))}static now(){return epoch}}
function harness(data,user={permissions:['order.read']}){
 const downloads=[],blobs=[],revoked=[],timers=[],ctx={page:'mallGroup',data,user,operations:[],permitted:()=>false};
 const root={businessAPI:{redraw(){}},document:{createElement(tag){assert.equal(tag,'a');const a={click(){downloads.push({href:a.href,download:a.download})}};return a}}};
 const url={createObjectURL(blob){assert(blob instanceof Blob);blobs.push(blob);return 'blob:group-'+blobs.length},revokeObjectURL(value){revoked.push(value)}};
 runInNewContext(source,{window:root,Date:FixedDate,Blob,URL:url,setTimeout(fn,ms){timers.push({fn,ms})},Set,Map,JSON,Array,String,Number});
 return {api:root.SiyueBusinessCommerceSelection,ctx,downloads,blobs,revoked,timers,render(){return root.SiyueBusinessCommerceSelection.renderPage(ctx)}};
}
const text=html=>html.replace(/<[^>]*>/g,'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function table(html){const markup=html.match(/<table class="table bcs-group-table">([\s\S]*?)<\/table>/)?.[1];assert(markup);return {headers:[...markup.matchAll(/<th>(.*?)<\/th>/g)].map(m=>text(m[1])),rows:[...markup.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(c=>text(c[1])))}}
function metrics(html){return [...html.match(/<div class="bcs-group-metrics">([\s\S]*?)<\/section>/)[1].matchAll(/<strong>(\d+)<\/strong><span>(.*?)<\/span>/g)].map(m=>[m[2],Number(m[1])])}
function parseCsv(csv){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<csv.length;i++){const c=csv[i];if(c==='"'){if(quoted&&csv[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(!quoted&&c===','){row.push(cell);cell=''}else if(!quoted&&c==='\r'&&csv[i+1]==='\n'){row.push(cell);rows.push(row);row=[];cell='';i++}else cell+=c}row.push(cell);rows.push(row);assert.equal(quoted,false);return rows}
const offer=(id,name,extra={})=>({id,name,start:'2026-10-01',end:'2026-11-30',published:true,courseIds:['C1'],...extra});
test('group list computes authorized activity summary and all nine cells across statuses, while filters preserve the current summary definition',()=>{
 const groups=[offer('GROUP-A','数学A',{courseIds:['C1','C2']}),offer('GROUP-B','数学B',{start:'2026-11-01',end:'2026-12-01'}),offer('GROUP-C','结束活动',{end:'2026-10-29',courseIds:['C1','C2','C3']}),offer('GROUP-D','草稿活动',{published:false,courseIds:[]})];
 const checkout=(id,status,buyers=0,type='group')=>({type,promotionId:id,summary:{status},buyers:Array.from({length:buyers},(_,i)=>({id:'S'+i}))});
 const h=harness({activities:{group:groups},commerceCheckouts:[...['awaiting_verification','paid','expired','cancelled','closed','partially_refunded'].map(s=>checkout('GROUP-A',s,s==='paid'?2:0)),checkout('GROUP-A','paid',99,'joint'),checkout('GROUP-B','paid',3),checkout('GROUP-B','awaiting_verification'),checkout('GROUP-C','closed'),checkout('UNRELATED','paid',99)]});
 const html=h.render(),t=table(html);assert.deepEqual(t.headers,header);assert.deepEqual(metrics(html),[['活动数',4],['进行中',1],['未开始',1]]);
 assert.deepEqual(t.rows.map(r=>r.slice(0,9)),[
  ['GROUP-A','数学A','2026-10-01 至 2026-11-30','进行中','2','6','1','3','2'],
  ['GROUP-B','数学B','2026-11-01 至 2026-12-01','未开始','1','2','1','0','3'],
  ['GROUP-C','结束活动','2026-10-01 至 2026-10-29','已结束','3','1','0','1','0'],
  ['GROUP-D','草稿活动','2026-10-01 至 2026-11-30','草稿','0','0','0','0','0']]);
 h.api.groupFilter('name','数学');h.api.groupFilter('id','group-a');h.api.groupFilter('status','进行中');
 assert.deepEqual(table(h.render()).rows.map(r=>r.slice(0,9)),[t.rows[0].slice(0,9)]);assert.deepEqual(metrics(h.render()),metrics(html));assert.match(h.render(),/共 1 条活动/);
 h.api.groupFilter('id','');h.api.groupFilter('status','未开始');assert.deepEqual(table(h.render()).rows.map(r=>r.slice(0,9)),[t.rows[1].slice(0,9)]);
 h.api.groupFilter('name','不存在');assert.match(h.render(),/暂无符合筛选条件/);assert.match(h.render(),/共 0 条活动/);assert.deepEqual(metrics(h.render()),metrics(html));
 for(const key of ['name','id','status'])h.api.groupFilter(key,'');assert.equal(table(h.render()).rows.length,4);
 h.ctx.user={permissions:[]};assert(table(h.render()).rows.every(r=>r.slice(5,9).every(c=>c==='—')));assert.deepEqual(metrics(h.render()),metrics(html));
});
test('group export creates the actual UTF-8 CSV Blob and download from the current combined filter, preserving quoting and protecting formula prefixes',async()=>{
 const names=['=导出,"引号"\n第二行','+导出','@导出','-导出','\t导出','\r导出'];
 // ctx.data is the server-authorized envelope; the HTTP test below checks its campus projection.
 const selected=names.map((name,i)=>offer('EXPORT-'+i,name)),h=harness({activities:{group:[...selected,offer('OTHER','导出'),offer('EXPORT-DRAFT','导出',{published:false}),offer('EXPORT-NONAME','其他名称')]},commerceCheckouts:[]});
 h.render();h.api.groupFilter('name','导出');h.api.groupFilter('id','EXPORT-');h.api.groupFilter('status','进行中');assert.equal(h.api.exportGroups(),true);
 assert.deepEqual(h.downloads,[{href:'blob:group-1',download:'拼团活动.csv'}]);assert.equal(h.blobs.length,1);assert.equal(h.blobs[0].type,'text/csv;charset=utf-8');
 const csv=await blobUtf8(h.blobs[0]);assert.equal(csv.charCodeAt(0),0xFEFF);assert.deepEqual(parseCsv(csv.slice(1)),[csvHeader,...selected.map(r=>[r.id,"'"+r.name,r.start,r.end,'进行中','1'])]);
 assert.deepEqual(h.revoked,[]);assert.equal(h.timers[0].ms,1000);h.timers[0].fn();assert.deepEqual(h.revoked,['blob:group-1']);
 h.ctx.page='mallShelf';assert.equal(h.api.exportGroups(),false);assert.equal(h.blobs.length,1);
});
test('isolated HTTP group receipt and cancellation update the same rendered row, and campus projection bounds both summary and actual CSV',async t=>{
 const {f,course,klass,promotion,cart}=await setup(t),foreignTeacher=await f.employee(),foreignClass=await f.klass(course,foreignTeacher,{campusId:'B'});
 await f.execute('product.publish',{courseId:course.id,classIds:[klass.id,foreignClass.id]});
 const a=await promotion('group',{name:'甲校区拼团',campusId:'A',selections:[{courseId:course.id,classIds:[klass.id]}]}),b=await promotion('group',{name:'乙校区拼团',campusId:'B',selections:[{courseId:course.id,classIds:[foreignClass.id]}]});
 const renderState=async(actor=f.admin)=>{const h=harness((await f.state(actor)).state,actor.user);return {h,row:table(h.render()).rows.find(r=>r[0]===a.id)}};
 assert.deepEqual((await renderState()).row.slice(4,9),['1','0','0','0','0']);
 const created=(await f.execute('commerce.checkout.create',cart('group',a))).result.checkout;
 assert.deepEqual((await renderState()).row.slice(4,9),['1','1','0','0','0']);
 await f.execute('commerce.checkout.accept',{checkoutId:created.id});assert.deepEqual((await renderState()).row.slice(4,9),['1','1','0','0','0']);
 await f.execute('commerce.checkout.confirmReceipt',{checkoutId:created.id,amountCents:18000,reference:'ISOLATED-GROUP-METRICS',method:'bank'});
 const paid=await f.state();assert.equal(paid.state.receipts.length,2);assert.equal(paid.state.orders.reduce((n,o)=>n+o.paidCents,0),18000);assert(paid.state.enrollments.every(e=>e.status==='active'));
 assert.deepEqual((await renderState()).row.slice(4,9),['1','1','1','0','2']);
 const cancelled=(await f.execute('commerce.checkout.create',cart('group',a,[2,3]))).result.checkout;await f.execute('commerce.checkout.cancel',{checkoutId:cancelled.id,reason:'隔离统计测试取消'});
 assert.deepEqual((await renderState()).row.slice(4,9),['1','2','1','1','2']);
 const scoped=await f.employee({name:'甲校区统计验证',roleIds:['principal'],scope:{type:'campus',campusIds:['A']}}),{h,row}=await renderState(scoped);
 assert.equal(table(h.render()).rows.length,1);assert.equal(row[0],a.id);assert.deepEqual(row.slice(4,9),['1','2','1','1','2']);assert.deepEqual(metrics(h.render()),[['活动数',1],['进行中',1],['未开始',0]]);
 h.api.groupFilter('id',a.id);assert.equal(h.api.exportGroups(),true);assert.deepEqual(parseCsv((await blobUtf8(h.blobs[0])).slice(1)),[csvHeader,[a.id,a.name,a.start,a.end,'进行中','1']]);assert(!(await blobUtf8(h.blobs[0])).includes(b.id));
});
