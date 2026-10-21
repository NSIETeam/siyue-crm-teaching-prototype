/* Browser prototype metrics. Server data scopes must be enforced by the API as well. */
const salesMetricsUI={period:'90',open:false};
const salesMetricsMinimum=10;
function salesMetricsStaffIdentity(staff){
 if(!staff)return null;
 const id=staff.id||staff.staffId||'',account=staff.account||staff.username||'';
 const sameName=(state.staff||[]).filter(x=>x.name===staff.name);
 return {id,account,name:staff.name||'',campus:staff.campus||'',campusId:staff.campusId||'',key:id?'id:'+id:account?'account:'+account:sameName.length<=1&&staff.name?'name:'+staff.name:''};
}
function salesMetricsActor(){
 const raw=typeof workflowCurrentActor==='function'?workflowCurrentActor():null;
 const name=raw&&typeof raw==='object'?raw.name:typeof raw==='string'?raw:typeof workflowActor==='function'?workflowActor():'';
 const records=(state.staff||[]).filter(s=>raw?.id?s.id===raw.id||s.staffId===raw.id:raw?.account?s.account===raw.account:s.name===name);
 const staff=records.length===1?records[0]:null,identity=salesMetricsStaffIdentity({...staff,...(raw&&typeof raw==='object'?raw:{}),name});
 const roleIds=Array.isArray(raw?.roleIds)?raw.roleIds:[raw?.roleId||raw?.role||permissionState.identity];
 const roleId=roleIds.find(id=>['admin','superadmin','super_admin','manager','principal','sales'].includes(id))||roleIds[0],role=permissionRole(roleId),permissions=raw?.permissions||raw?.grants||role?.grants||[];
 const campusIds=Array.isArray(raw?.scope?.campusIds)?raw.scope.campusIds:Array.isArray(raw?.campusIds)?raw.campusIds:[];
 const campusNames=Array.isArray(raw?.campuses)?raw.campuses:[];
 const campuses=new Set([...campusIds,...campusNames,raw?.campus||staff?.campus].filter(x=>x&&x!=='全部校区'));
 return {...identity,roleId,roleIds,permissions,campuses,scope:raw?.scope||null,authenticated:!!(raw&&typeof raw==='object'&&raw.id),active:raw?.active!==false&&!raw?.disabled&&!raw?.mustChangePassword&&staff?.active!==false&&(roleId==='admin'||roleId==='superadmin'||roleId==='super_admin'||role?.active!==false)};
}
function salesMetricsAccess(){
 const actor=salesMetricsActor();if(!actor.active)return {kind:'none',actor};
 if(actor.authenticated){
  if(!actor.permissions.includes('lead.conversion.read'))return {kind:'none',actor};
  const type=actor.scope?.type;
  if(type==='all')return {kind:'all',actor};
  if(type==='campus')return {kind:actor.campuses.size?'campus':'none',actor};
  if(type==='own'||type==='assigned')return {kind:actor.key?'self':'none',actor};
 }
 if(actor.roleIds.some(id=>['admin','superadmin','super_admin'].includes(id)))return {kind:'all',actor};
 if(actor.roleIds.some(id=>['manager','principal'].includes(id))||actor.permissions.includes('sales.metrics.campus'))return {kind:actor.campuses.size?'campus':'none',actor};
 if(actor.roleIds.includes('sales')||actor.permissions.includes('sales.metrics.self')||actor.permissions.includes('myLeads'))return {kind:actor.key?'self':'none',actor};
 return {kind:'none',actor};
}
function salesMetricsOwner(lead){
 const id=lead.ownerId||lead.ownerStaffId,account=lead.ownerAccount;
 const matches=(state.staff||[]).filter(s=>id?s.id===id||s.staffId===id:account?s.account===account:s.name===lead.owner);
 const staff=matches.length===1?matches[0]:null;
 const actor=salesMetricsActor();if(actor.authenticated&&!id&&!account)return null;
 if(id)return {...salesMetricsStaffIdentity(staff||{id,name:lead.owner}),campus:lead.campus||staff?.campus||'',campusId:lead.campusId||staff?.campusId||''};
 if(account)return {...salesMetricsStaffIdentity(actor.authenticated?{account,name:lead.owner}:staff||{account,name:lead.owner}),campus:lead.campus||staff?.campus||'',campusId:lead.campusId||staff?.campusId||''};
 if(matches.length>1||!lead.owner||lead.owner==='未分配')return null;
 return {...salesMetricsStaffIdentity(staff||{name:lead.owner}),campus:lead.campus||staff?.campus||'',campusId:lead.campusId||staff?.campusId||''};
}
function salesMetricsSameOwner(left,right){
 if(!left||!right)return false;
 if(left.id||right.id)return !!left.id&&!!right.id&&left.id===right.id;
 if(left.account||right.account)return !!left.account&&!!right.account&&left.account===right.account;
 // Names are a legacy bridge only when the employee directory has no ambiguity.
 return !!left.name&&left.name===right.name&&(state.staff||[]).filter(s=>s.name===left.name).length<=1;
}
function salesMetricsInScope(owner,access){
 if(!owner?.key)return false;
 if(access.kind==='all')return true;
 if(access.kind==='self')return access.actor.authenticated?!!owner.id&&owner.id===access.actor.id:salesMetricsSameOwner(owner,access.actor);
 return access.kind==='campus'&&access.actor.campuses.has(owner.campusId||owner.campus);
}
function salesMetricsPaid(order){
 const amount=typeof withdrawalMoney==='function'?withdrawalMoney(order?.paid):Number(String(order?.paid||'').replace(/[¥,]/g,''));
 return order?.paymentState==='已支付'&&Number.isFinite(amount)&&amount>0;
}
function salesMetricsPaidOrders(lead){
 if(!lead?.leadId)return [];
 return (a.orders||[]).filter(o=>o.originLeadId===lead.leadId&&salesMetricsPaid(o)&&o.studentId&&(a.students||[]).some(s=>s.id===o.studentId&&(s.originLeadId===lead.leadId||lead.studentId===s.id)));
}
function salesMetricsDate(value){
 const match=String(value||'').match(/^(\d{4}-\d{2}-\d{2})/);if(!match)return '';
 const date=match[1],ms=Date.parse(date+'T00:00:00Z');if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==date)return '';
 if(/T.*(?:Z|[+-]\d\d:\d\d)$/.test(String(value))){const instant=Date.parse(value);return Number.isFinite(instant)?new Date(instant+8*3600000).toISOString().slice(0,10):''}return date;
}
function salesMetricsRange(period=salesMetricsUI.period,now=new Date()){
 const to=new Date(new Date(now).getTime()+8*3600000).toISOString().slice(0,10);
 if(period==='all')return {from:'',to,label:'全部登记日期'};
 const days=period==='30'?30:90,endMs=Date.parse(to+'T00:00:00Z');
 return {from:new Date(endMs-(days-1)*86400000).toISOString().slice(0,10),to,label:'近'+days+'天登记'};
}
function salesMetricsSnapshot(lead,orders){
 const snap=lead.salesAttribution;
 if(snap?.version!==1||!snap.owner?.key||!salesMetricsDate(snap.convertedAt)||!orders.some(o=>o.id===snap.orderId))return null;
 return {...snap.owner,campus:snap.campus||snap.owner.campus||'',campusId:snap.campusId||snap.owner.campusId||''};
}
function salesMetricsRows(period=salesMetricsUI.period){
 const access=salesMetricsAccess(),range=salesMetricsRange(period),seen=new Set(),rows=[],excluded={missingDate:0,missingAttribution:0,missingId:0};
 if(access.kind==='none')return {rows,excluded,range,access};
 for(const lead of leadState.leads||[]){
  const current=salesMetricsOwner(lead),orders=salesMetricsPaidOrders(lead),converted=orders.length>0,owner=converted?salesMetricsSnapshot(lead,orders):current;
  const inScope=salesMetricsInScope(owner||current,access);if(!inScope)continue;
  if(!lead.leadId){excluded.missingId++;continue}if(seen.has(lead.leadId))continue;seen.add(lead.leadId);
  const date=salesMetricsDate(lead.createdAt);if(!date){excluded.missingDate++;continue}
  if(date>range.to||range.from&&date<range.from)continue;
  if(converted&&!owner){excluded.missingAttribution++;continue}
  rows.push({leadId:lead.leadId,owner,converted,createdAt:date});
 }
 return {rows,excluded,range,access};
}
function salesMetricsSummarize(rows){
 const total=rows.length,converted=rows.filter(x=>x.converted).length,reliable=total>=salesMetricsMinimum;
 return {total,converted,reliable,rate:reliable?converted/total*100:null,remaining:Math.max(0,salesMetricsMinimum-total),progress:Math.min(salesMetricsMinimum,total)};
}
function salesMetricsForStaff(staff,period=salesMetricsUI.period){
 const owner=salesMetricsStaffIdentity(staff),access=salesMetricsAccess();
 if(!salesMetricsInScope(owner,access))return null;
 return salesMetricsSummarize(salesMetricsRows(period).rows.filter(row=>salesMetricsSameOwner(owner,row.owner)));
}
function salesMetricsSetPeriod(period){if(!['30','90','all'].includes(period))return;salesMetricsUI.period=period;render()}
function salesMetricsCard(){
 const data=salesMetricsRows(),scope=data.access.kind;if(scope==='none')return '';
 const summary=salesMetricsSummarize(data.rows),excluded=Object.values(data.excluded).reduce((sum,n)=>sum+n,0);
 const title=scope==='self'?'我的转化':scope==='campus'?'授权校区销售转化':'全部销售转化',label=scope==='self'?'本人负责':'按负责人统计';
 const members=scope==='self'?[]:[...new Map(data.rows.map(row=>[row.owner.key,row.owner])).values()].map(owner=>({owner,summary:salesMetricsSummarize(data.rows.filter(row=>salesMetricsSameOwner(owner,row.owner)))}));
 const rate=summary.reliable?summary.rate.toFixed(1)+'%':'样本不足';
 return `<section class="card sales-metrics" aria-label="销售转化统计"><div class="sales-metrics-header"><strong>${title}</strong><span class="muted">${label}</span><select class="select" aria-label="转化统计周期" onchange="salesMetricsSetPeriod(this.value)">${[['30','近30天登记'],['90','近90天登记'],['all','全部登记日期']].map(([id,text])=>`<option value="${id}" ${salesMetricsUI.period===id?'selected':''}>${text}</option>`).join('')}</select></div><div class="sales-metrics-strip"><div><span>已转化 / 统计线索</span><strong>${summary.converted}<small> / ${summary.total}</small></strong></div><div><span>转化率</span><strong class="${summary.reliable?'':'sales-metrics-insufficient'}">${rate}</strong></div>${summary.reliable?'':`<div><span>观察样本</span><strong>${summary.progress}<small> / ${salesMetricsMinimum}</small></strong></div>`}</div>${summary.reliable?'':`<div class="sales-metrics-sample"><progress max="${salesMetricsMinimum}" value="${summary.progress}" aria-label="样本积累进度"></progress><span>再积累 ${summary.remaining} 条，暂不参与转化率排名</span></div>`}<details class="sales-metrics-definition"><summary>统计口径${excluded?' · '+excluded+' 条待核验':''}</summary><p>${data.range.label}${data.range.from?'（'+data.range.from+' 至 '+data.range.to+'）':''}；按线索 ID 去重。未转化按当前负责人，已转化按首次到账时负责人和校区快照归属。登记人与销售负责人分别保留。</p><p>仅关联学生档案的已支付订单计入转化；报名草稿、待支付、仅修改“已报名”阶段均不计入。同一线索多次付款只计一次转化。后续退课保留首次转化记录，本指标不是留存率。</p><p>缺少登记日期 ${data.excluded.missingDate} 条、成交归属 ${data.excluded.missingAttribution} 条、线索 ID ${data.excluded.missingId} 条，均不进入分子或分母。达到10条只解除小样本隐藏，并不代表统计已稳定。</p></details>${members.length?`<details class="sales-metrics-members"><summary>查看销售明细</summary>${aTable(['销售','已转化 / 统计线索','转化率'],members.map(({owner,summary:m})=>`<tr><td>${esc(owner.name)}<div class="muted">${esc(owner.campus)}</div></td><td>${m.converted} / ${m.total}</td><td>${m.reliable?m.rate.toFixed(1)+'%':'样本不足 · 不参与排名'}</td></tr>`))}</details>`:''}</section>`;
}
function salesMetricsOpen(){if(salesMetricsAccess().kind==='none'){toast('没有查看销售转化的权限');return}nav('home');document.querySelector('.sales-metrics')?.scrollIntoView?.({block:'nearest'})}
// Bind new ownership only to the signed-in account or the authenticated employee directory.
function salesMetricsSyncLeadIdentity(lead,options={}){
 const actor=salesMetricsActor();if(!actor.authenticated||!actor.active||!lead)return false;
 if(options.created)lead.registrarId=actor.id;
 if(!lead.owner||lead.owner==='未分配'){delete lead.ownerId;delete lead.ownerAccount;return true}
 if(options.assignment==='self'&&lead.owner===actor.name){lead.ownerId=actor.id;return true}
 const directory=typeof employeeAuthDirectory==='function'?employeeAuthDirectory():[];
 const matches=Array.isArray(directory)?directory.filter(s=>s.id&&s.name===lead.owner&&s.active!==false&&!s.disabled&&s.status!=='disabled'):[];
 if(matches.length===1){lead.ownerId=matches[0].id;return true}
 // Clear stale IDs after a named transfer instead of retaining the previous employee's access.
 if(options.ownerChanged){delete lead.ownerId;delete lead.ownerAccount}
 return false;
}
const salesMetricsSaveLeadBase=saveLead;
saveLead=auditAtomic(function(...args){
 const before=new Set(leadState.leads.map(l=>l.leadId)),editing=leadState.formMode==='edit',assignment=document.querySelector('input[name="lead-assign"]:checked')?.value||'self';
 const result=salesMetricsSaveLeadBase(...args);if(result===false||editing)return result;
 const created=leadState.leads.filter(l=>l.leadId&&!before.has(l.leadId));
 created.forEach(l=>salesMetricsSyncLeadIdentity(l,{created:true,assignment}));if(created.length)workflowPersist();return result;
});
for(const name of ['assignLead','workflowCommitTransfer','workflowCommitRelease']){
 const original=globalThis[name];if(typeof original!=='function')continue;
 globalThis[name]=auditAtomic(function(...args){
  const id=leadState.leads[leadState.selected]?.leadId,before=leadState.leads.find(l=>l.leadId===id),owner=before?.owner,signature=JSON.stringify(before);
  const result=original(...args),lead=leadState.leads.find(l=>l.leadId===id);
  if(result!==false&&lead&&JSON.stringify(lead)!==signature){salesMetricsSyncLeadIdentity(lead,{ownerChanged:lead.owner!==owner});workflowPersist()}return result;
 });
}
// New confirmations freeze the responsible salesperson within the existing atomic payment save.
const salesMetricsPaymentBase=workflowSimulatePayment;
workflowSimulatePayment=auditAtomic(function(id){
 const beforeOrder=a.orders.find(x=>x.id===id),wasPaid=salesMetricsPaid(beforeOrder),lead=leadState.leads.find(x=>x.leadId===beforeOrder?.originLeadId),hadPaid=lead?salesMetricsPaidOrders(lead).length>0:false;
 const result=salesMetricsPaymentBase(id),order=a.orders.find(x=>x.id===id);
 if(result===false||wasPaid||hadPaid||!lead||!salesMetricsPaid(order)||!salesMetricsPaidOrders(lead).some(x=>x.id===id)||lead.salesAttribution)return result;
 const owner=salesMetricsOwner(lead);if(!owner?.key)return result;
 const convertedAt=new Date().toISOString();lead.salesAttribution={version:1,owner:{...owner},campus:lead.campus||owner.campus,campusId:lead.campusId||owner.campusId||'',convertedAt,orderId:order.id};order.salesAttribution={...lead.salesAttribution,owner:{...owner}};workflowPersist();
 if(state.page==='home')render();return result;
});
const salesMetricsHomeBase=workflowHome;
workflowHome=function(...args){const result=salesMetricsHomeBase(...args);const view=$('#view'),html=salesMetricsCard();if(html)view.innerHTML=html+view.innerHTML;return result};
const salesMetricsMyLeadsBase=myLeadsPage;
myLeadsPage=function(...args){return salesMetricsCard()+salesMetricsMyLeadsBase(...args)};
// Candidate assignments use observed data; stored demonstration percentages no longer drive rankings.
leadCandidates=function(query='',sort='conversion'){
 const key=String(query).trim().toLowerCase();
 const people=leadEligibleStaff().filter(x=>!key||[x.name,x.account,x.phone].some(v=>String(v||'').toLowerCase().includes(key))).map(x=>{
  const metric=salesMetricsForStaff(x),pending=metric?(leadState.leads||[]).filter(l=>salesMetricsInScope(salesMetricsOwner(l),salesMetricsAccess())&&salesMetricsSameOwner(salesMetricsStaffIdentity(x),salesMetricsOwner(l))&&l.stage!=='已报名'&&l.status!=='cold').length:null;
  return {...x,conversionRate:metric?.rate??null,pendingLeads:pending,salesMetric:metric};
 });
 // Small samples and out-of-scope records have no numerical conversion ranking.
 return people.sort((x,y)=>sort==='capacity'?(x.pendingLeads??Infinity)-(y.pendingLeads??Infinity):Number(y.salesMetric?.reliable||false)-Number(x.salesMetric?.reliable||false)||(x.salesMetric?.reliable&&y.salesMetric?.reliable?y.conversionRate-x.conversionRate:0)).slice(0,5);
};
leadCandidateRows=function(){
 const people=leadCandidates($('#lead-assignee-search')?.value||'',leadState.candidateSort||'conversion');
 return people.length?people.map(x=>`<button type="button" class="lead-candidate ${leadState.assigneeId===x.index?'selected':''}" onclick="leadSelectAssignee(${x.index})"><span><strong>${esc(x.name)}</strong><small>${esc(x.campus||'未设置校区')} · ${esc(x.account||'')}</small></span>${x.salesMetric?`<span><b>${x.salesMetric.reliable?'转化率 '+x.salesMetric.rate.toFixed(1)+'%':'样本不足 · '+x.salesMetric.total+'/10'}</b><small>转化 ${x.salesMetric.converted}/${x.salesMetric.total} · 待跟进 ${x.pendingLeads}</small></span>`:'<span class="muted">可接收线索</span>'}</button>`).join(''):'<p class="help">未找到具备招生权限的同事</p>';
};
const salesMetricsLeadFormBase=leadFormContent;
leadFormContent=function(...args){return salesMetricsLeadFormBase(...args).replace(/(<div id="lead-candidates">)[\s\S]*?(<\/div><p class="help">)/,(_,start,end)=>start+leadCandidateRows()+end).replace('仅显示在职且所属职位具有线索或登记权限的员工；推荐顺序基于原型演示数据。','仅比较授权范围内、样本达到10条的销售；样本不足不参与转化率排名。')};
if(typeof commandWorkflows!=='undefined')commandWorkflows.push({id:'sales.metrics.view',label:'查看销售转化率',words:['我的转化率','销售业绩','转化数据','转化率','样本不足'],page:'home',allowed:()=>salesMetricsAccess().kind!=='none',run:salesMetricsOpen,hint:'查看本人或授权校区的真实统计口径'});
