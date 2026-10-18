/* Supervisor marketing-task distribution; facts, scope and plans are owned by Java. */
(function(root) {
  'use strict';
  const pages = [{id:'crmTaskRouting',title:'主管任务管理',permissions:['crm.task.read','crm.task.manage']}];
  const statuses={unassigned:'待分配',pending:'待执行',in_progress:'执行中',completed:'已完成',cancelled:'已取消'};
  const distribution={unassigned:'待分配',partial:'部分分配',allocated:'已分配',empty:'无有效任务'};
  const execution={not_started:'未开始',in_progress:'执行中',completed:'已完成',cancelled:'已取消'};
  const operations={allocation:'分配任务',recall:'回收任务',transfer:'转移主管',schedule:'调整日期',cancel:'取消未完任务'};
  const countFields=[['totalCount','任务总数',''],['unassignedCount','待分配','unassigned'],['pendingCount','待执行','pending'],['inProgressCount','执行中','in_progress'],['completedCount','已完成','completed'],['cancelledCount','已取消','cancelled']];
  const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const copy=v=>v==null?v:JSON.parse(JSON.stringify(v));
  const validId=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(v);
  const positive=v=>Number.isSafeInteger(v)&&v>0;
  const nonnegative=v=>Number.isSafeInteger(v)&&v>=0;
  const sameTime=(a,b)=>a==null&&b==null||Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b);
  const local=v=>v&&Number.isFinite(Date.parse(v))?new Date(Date.parse(v)+8*3600000).toISOString().slice(0,16):'';
  const instant=v=>{if(!v||!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(v))throw Error('请填写有效的北京时间。');const date=new Date(v+':00+08:00');if(!Number.isFinite(date.getTime()))throw Error('日期无效。');return date.toISOString();};
  const validCounts=c=>c&&countFields.every(([k])=>nonnegative(c[k]))&&nonnegative(c.allocatedCount)&&c.totalCount===c.unassignedCount+c.pendingCount+c.inProgressCount+c.completedCount+c.cancelledCount&&c.allocatedCount===c.pendingCount+c.inProgressCount+c.completedCount;
  const validBatch=b=>b&&validId(b.id)&&positive(b.managementVersion)&&validCounts(b.counts)&&['supervisor','direct'].includes(b.deliveryMode)&&Array.isArray(b.actions);
  const page=data=>{if(!data||!Array.isArray(data.items)||!nonnegative(data.total)||data.total<data.items.length||!positive(data.page)||!positive(data.size))throw Error('未收到有效分页结果，请重试。');return data;};
  function targetsFromAudience(rows) {
    const groups=new Map();
    for(const row of rows) {
      const key=JSON.stringify([row.customerId,row.studentId||null,(row.subject||'').toLowerCase(),(row.term||'').toLowerCase(),row.needIdentity||null]);
      let item=groups.get(key);
      if(!item){item={customerId:row.customerId,customerLabel:row.customerName||row.customerId,studentId:row.studentId||null,studentLabel:row.studentName||row.studentId||'',subject:row.subject||'',term:row.term||'',needIdentity:row.needIdentity||null,sources:[],locks:{student:!!row.studentId,subject:!!row.subject,term:!!row.term}};groups.set(key,item);}
      if(row.source&&!item.sources.some(source=>source.type===row.source.type&&source.id===row.source.id))item.sources.push(copy(row.source));
    }
    return [...groups.values()];
  }
  function create({api,identity,render,onChange=()=>{},onOpenBatch=()=>{},onOpenTask=()=>{},onReturn=()=>{}}) {
    const routing=api.taskRouting;let actor=identity,generation=0,active=true,disposed=false,bound=null;
    let s={route:{},mode:'list',tab:'supervisor',filters:{view:'responsible'},taskQuery:{},pages:{supervisor:1,employees:1,tasks:1,history:1},data:null,batch:null,history:null,loading:false,error:'',notice:'',restricted:false,selection:{},selectionStale:false,dialog:null,pending:null,receipt:null,dirty:false};
    const has=code=>actor?.permissions?.includes(code),locked=()=>!!s.pending||!!s.dialog?.writing;
    const still=token=>active&&!disposed&&token===generation;
    const draw=()=>{if(active&&!disposed){render();onChange();}};
    const requireCodes=codes=>{if(codes.some(code=>!has(code)))throw Error('当前账号没有办理此任务工作页的权限。');};
    const requirement=()=>s.mode==='create'?['crm.task.write','crm.task.assign','crm.activity.read','crm.customer.read']:['crm.task.read','crm.task.manage'];
    const permitted=kind=>!!s.batch?.actions.includes(kind)&&has('crm.task.write')&&has('crm.task.assign');
    function restrict(){s.restricted=true;s.data=null;s.batch=null;s.history=null;if(s.dialog){s.dialog.candidates=null;s.dialog.children=null;}s.selection={};s.selectionStale=true;}
    const button=(text,action,attrs='',disabled=false,primary=false)=>`<button class="btn${primary?' primary':''}" type="button" data-tr-action="${action}"${attrs}${disabled||locked()&&action!=='retry'?' disabled':''}>${e(text)}</button>`;
    const field=(label,name,value='',attrs='')=>`<label>${e(label)}<input class="input" name="${e(name)}" value="${e(value)}" ${attrs}></label>`;
    const select=(label,name,value,rows)=>`<label>${e(label)}<select class="select" name="${e(name)}">${rows.map(([key,text])=>`<option value="${e(key)}"${key===String(value||'')?' selected':''}>${e(text)}</option>`).join('')}</select></label>`;
    const table=(heads,rows)=>`<div class="tr-table"><table class="table"><thead><tr>${heads.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${heads.length}">${s.loading?'正在读取当前授权范围…':s.error?'读取未完成，请按提示重试。':'当前范围暂无记录'}</td></tr>`}</tbody></table></div>`;
    function pager(data,action='page'){return data?`<div class="tr-toolbar"><span>共 ${e(data.total)} ${s.tab==='employees'&&action==='page'?'个批次／员工组':'条'} · 第 ${data.page} / ${Math.max(1,Math.ceil(data.total/data.size))} 页</span><span>${button('上一页',action,` data-page="${data.page-1}"`,data.page<=1)}${button('下一页',action,` data-page="${data.page+1}"`,data.page*data.size>=data.total)}</span></div>`:'';}
    function makeDialog(kind) {return {kind,title:'',note:'',mode:'supervisor',supervisorId:'',startsAt:'',dueAt:'',reason:'',strategy:'even',sourceOwnerPolicy:'none',owners:[],candidateQuery:'',candidatePage:1,candidates:null,candidateBusy:false,candidateSequence:0,children:null,childTarget:null,childPage:1,preview:null,error:'',writing:false};}
    async function load() {
      requireCodes(requirement());const token=++generation;s.loading=true;s.error='';s.data=null;s.history=null;draw();
      try {
        if(s.mode==='create'){s.restricted=false;return;}
        const q={...s.filters,...s.taskQuery,page:s.pages[s.tab]||1,size:20,...(s.route.batchId?{batchId:s.route.batchId,view:'scope'}:{})};
        const dataCall=s.tab==='supervisor'?routing.batches(q):s.tab==='employees'?routing.globalEmployees(q):s.tab==='history'?routing.events(s.route.batchId,{page:s.pages.history,size:20}):routing.globalTasks(q);
        const result=await Promise.all([s.route.batchId?routing.get(s.route.batchId):null,dataCall]);if(!still(token))return;
        if(result[0]&&!validBatch(result[0]))throw Error('批次摘要回执无效。');
        const data=page(result[0]&&s.tab==='supervisor'?{items:[result[0]],total:1,page:1,size:20}:result[1]);if(s.tab==='supervisor'&&data.items.some(item=>!validBatch(item)))throw Error('批次数量口径无效。');
        if(s.tab==='employees'&&data.items.some(item=>!validCounts(item.counts)))throw Error('员工任务数量口径无效。');
        if(s.tab==='tasks'&&data.items.some(item=>!validId(item.id)||!positive(item.version)))throw Error('任务明细缺少有效版本。');
        s.batch=result[0];s.data=data;s.restricted=false;
        for(const row of data.items)if(s.selection[row.id]&&s.selection[row.id].version!==row.version)s.selectionStale=true;
      }catch(error){if(still(token)){s.error=error.message||'读取失败';if([401,403,404].includes(error.status))restrict();}}
      finally{if(still(token)){s.loading=false;draw();}}
    }
    async function candidates(pageNumber=1) {
      const d=s.dialog;if(!d||locked())return;const seq=++d.candidateSequence,token=generation;d.candidateBusy=true;d.candidates=null;d.candidatePage=pageNumber;d.error='';draw();
      try {
        const supervisor=d.kind==='transfer'||d.kind==='create'&&d.mode==='supervisor';
        const q={query:d.candidateQuery,page:pageNumber,size:20};
        const result=supervisor?await routing.supervisors({...q,...(d.kind==='transfer'?{batchId:s.route.batchId}:{campusId:s.route.activity.campusId})}):d.kind==='create'?await api.tasks.assignees({...q,campusId:s.route.activity.campusId,taskType:'marketing'}):await routing.assignees(s.route.batchId,q);
        if(!still(token)||s.dialog!==d||d.candidateSequence!==seq)return;page(result);
        d.candidates=d.kind==='create'&&!supervisor?{...result,items:result.items.map(row=>({id:row.principalId,label:row.displayName,pendingCount:row.pendingCount})),countScope:result.workloadScope}:result;
        if(d.candidates.items.some(row=>!validId(row.id)||!nonnegative(row.pendingCount)))throw Error('候选人员回执无效。');
      }catch(error){if(still(token)&&s.dialog===d&&d.candidateSequence===seq){d.error=error.message||'候选读取失败';if([401,403,404].includes(error.status))d.candidates=null;}}
      finally{if(still(token)&&s.dialog===d&&d.candidateSequence===seq){d.candidateBusy=false;draw();}}
    }
    function capture(form) {
      const values={};new root.FormData(form).forEach((v,k)=>{values[k]=String(v);});return values;
    }
    function update(values) {
      const d=s.dialog;if(!d||locked())return;
      for(const [key,value] of Object.entries(values)) {
        if(['title','note','mode','supervisorId','startsAt','dueAt','reason','strategy','sourceOwnerPolicy','candidateQuery'].includes(key))d[key]=value;
        if(key.startsWith('quota.')){const owner=d.owners.find(item=>item.id===key.slice(6));if(owner)owner.count=value;}
        const match=/^target\.(\d+)\.(subject|term)$/.exec(key);if(match){const target=d.targets[Number(match[1])];if(target&&!target.locks[match[2]])target[match[2]]=value;}
      }
      d.preview=null;d.error='';s.dirty=true;onChange();
    }
    function plan(d) {
      if(!d.owners.length||d.owners.length>100)throw Error('请选择1–100位候选员工。');
      const result={strategy:d.strategy,ownerIds:d.owners.map(row=>row.id)};
      if(d.strategy==='quota'){result.quotas=d.owners.map(row=>({ownerId:row.id,count:Number(row.count)}));if(result.quotas.some(row=>!nonnegative(row.count)))throw Error('指定数量须为非负整数。');}
      else if(d.strategy!=='even')throw Error('请选择平均分配或指定数量。');return result;
    }
    function inputForDialog() {
      const d=s.dialog;if(d.kind==='create') {
        requireCodes(['crm.task.write','crm.task.assign']);if(!s.route.activity?.campusId)throw Error('活动未明确负责校区，不能发起此模式的任务。');
        if(!d.title.trim()||d.title.trim().length>200)throw Error('请填写200字以内任务名称。');
        const startsAt=instant(d.startsAt),dueAt=instant(d.dueAt);if(Date.parse(dueAt)<=Date.parse(startsAt))throw Error('截止时间须晚于开始时间。');
        const delivery=d.mode==='supervisor'?{mode:'supervisor',supervisorId:d.supervisorId,employeePlan:null}:{mode:'direct',supervisorId:null,employeePlan:plan(d)};
        if(d.mode==='supervisor'&&!validId(d.supervisorId))throw Error('请选择一位合资格主管。');
        const targets=d.targets.map(row=>({customerId:row.customerId,studentId:row.studentId||null,subject:row.subject.trim()||null,term:row.term.trim()||null,needIdentity:row.needIdentity||null,sources:copy(row.sources)}));
        if(!targets.length||targets.length>500||targets.some(row=>!row.sources.length))throw Error('请选择1–500项有真实活动来源的需求。');
        if(targets.some(row=>!row.subject||!row.term||row.subject.length>100||row.term.length>100))throw Error('每项营销需求须填写100字以内的学科和学期。');
        return {title:d.title.trim(),taskType:'marketing',campusId:s.route.activity.campusId,activityId:s.route.activity.id,startsAt,dueAt,delivery,targets,note:d.note.trim()};
      }
      if(!permitted(d.kind)||!s.batch||s.selectionStale)throw Error('当前批次或选中版本已变化，请刷新后重新核对。');
      const input={expectedManagementVersion:s.batch.managementVersion};
      if(['allocation','recall'].includes(d.kind)){input.selection=Object.values(s.selection).map(row=>({taskId:row.id,expectedVersion:row.version}));if(!input.selection.length)throw Error('请先勾选本批次明细。');}
      if(d.kind==='allocation'){Object.assign(input,plan(d),{sourceOwnerPolicy:d.sourceOwnerPolicy});if(d.sourceOwnerPolicy==='source_lead_owner_first'&&d.strategy!=='even')throw Error('来源线索负责人优先仅支持平均分配。');}
      if(d.kind==='transfer'){if(!validId(d.supervisorId))throw Error('请选择接收主管。');input.supervisorId=d.supervisorId;}
      if(d.kind==='schedule'){input.startsAt=d.startsAt===local(s.batch.startsAt)?s.batch.startsAt:instant(d.startsAt);input.dueAt=d.dueAt===local(s.batch.dueAt)?s.batch.dueAt:instant(d.dueAt);}
      if(d.kind!=='allocation'){if(!d.reason.trim()||d.reason.trim().length>1000)throw Error('请填写1000字以内原因。');input.reason=d.reason.trim();}
      return input;
    }
    const method=(prefix,kind)=>`${prefix}${kind[0].toUpperCase()+kind.slice(1)}`;
    const targetSignature=t=>JSON.stringify([t?.customerId,t?.studentId||null,t?.subject||null,t?.term||null,t?.needIdentity?.departmentId||null,t?.needIdentity?.projectId||null,(t?.sources||[]).map(source=>[source.type,source.id,source.version??null]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
    const countSignature=counts=>JSON.stringify(Object.entries(counts||{}).sort(([a],[b])=>a.localeCompare(b)));
    function validPreview(kind,input,p) {
      if(!p||p.action!==kind)return false;
      if(kind==='create') {
        if(!(p.campusId===input.campusId&&p.deliveryMode===input.delivery.mode&&(p.supervisorId||null)===(input.delivery.supervisorId||null)&&sameTime(p.startsAt,input.startsAt)&&sameTime(p.dueAt,input.dueAt)&&p.selectedCount===input.targets.length&&nonnegative(p.reservedCount)&&nonnegative(p.skippedCount)&&p.selectedCount===p.reservedCount+p.skippedCount&&Array.isArray(p.targets)&&p.targets.length===p.reservedCount&&Array.isArray(p.skippedTargets)&&p.skippedTargets.length===p.skippedCount))return false;
        const all=[...p.targets,...p.skippedTargets];if(new Set(all.map(row=>row.targetKey)).size!==all.length||JSON.stringify(all.map(row=>targetSignature(row.target)).sort())!==JSON.stringify(input.targets.map(targetSignature).sort()))return false;
        const counts={};for(const row of p.targets){if(input.delivery.mode==='supervisor'){if(row.ownerId!=null||row.status!=='unassigned')return false;}else{if(!input.delivery.employeePlan.ownerIds.includes(row.ownerId)||row.status!=='pending')return false;counts[row.ownerId]=(counts[row.ownerId]||0)+1;}}
        return countSignature(counts)===countSignature(p.assignmentCounts);
      }
      if(!(p.batchId===s.route.batchId&&p.managementVersion===input.expectedManagementVersion&&nonnegative(p.selectedCount)&&nonnegative(p.assignableCount)&&nonnegative(p.blockedCount)&&Array.isArray(p.assignments)&&p.assignments.length===p.assignableCount&&Array.isArray(p.blocked)&&p.blocked.length===p.blockedCount))return false;
      const all=[...p.assignments,...p.blocked];if(new Set(all.map(row=>row.taskId)).size!==all.length)return false;
      if(input.selection&&(p.selectedCount!==input.selection.length||JSON.stringify(all.map(row=>row.taskId).sort())!==JSON.stringify(input.selection.map(row=>row.taskId).sort())))return false;
      return p.assignments.every(row=>positive(row.expectedVersion)&&(!input.selection||input.selection.some(selected=>selected.taskId===row.taskId&&selected.expectedVersion===row.expectedVersion))&&(kind!=='allocation'||row.fromStatus==='unassigned'&&row.toStatus==='pending'&&validId(row.toOwnerId))&&(kind!=='recall'||['pending','in_progress'].includes(row.fromStatus)&&row.toStatus==='unassigned'&&row.toOwnerId==null)&&(kind!=='cancel'||row.toStatus==='cancelled')&&(kind!=='schedule'||sameTime(row.toDueAt,input.dueAt)));
    }
    async function preview() {
      const d=s.dialog;if(!d||locked())return;const input=inputForDialog(),token=generation;d.writing=true;d.error='';draw();
      try{const p=await (d.kind==='create'?routing.previewCreate(input):routing[method('preview',d.kind)](s.route.batchId,input));if(!still(token)||s.dialog!==d)return;if(!validPreview(d.kind,input,p))throw Error('预览回执不完整或与当前办理不符。');d.preview={input:copy(input),expectedPreview:copy(p)};}
      catch(error){if(still(token)&&s.dialog===d){d.error=error.message||'预览失败';if([401,403,404].includes(error.status))restrict();}}
      finally{if(still(token)&&s.dialog===d){d.writing=false;draw();}}
    }
    function validReceipt(pending,result) {
      if(!result||result.committed!==true||!validId(result.batchId)||!validId(result.operationId)||!['visible','left_scope'].includes(result.scopeStatus)||!Array.isArray(result.tasks))return false;
      if(pending.kind!=='create'&&result.batchId!==pending.batchId)return false;
      if(result.scopeStatus==='left_scope')return result.batch===null&&result.tasks.length===0;
      const b=result.batch,p=pending.body.expectedPreview,input=pending.body.input;
      if(!validBatch(b)||b.id!==result.batchId||new Set(result.tasks.map(row=>row.taskId)).size!==result.tasks.length)return false;
      if(pending.kind==='create') {
        if(b.title!==input.title||b.campusId!==input.campusId||b.deliveryMode!==input.delivery.mode||(b.supervisorId||null)!==(input.delivery.supervisorId||null)||b.managementVersion!==1||b.counts.totalCount!==p.reservedCount||!sameTime(b.startsAt,input.startsAt)||!sameTime(b.dueAt,input.dueAt)||result.tasks.length!==p.reservedCount)return false;
        const expected=p.targets.map(row=>`${row.ownerId||''}:${row.status}`).sort(),actual=result.tasks.map(row=>`${row.ownerId||''}:${row.status}`).sort();
        return JSON.stringify(expected)===JSON.stringify(actual)&&result.tasks.every(row=>validId(row.taskId)&&row.version===1&&sameTime(row.dueAt,input.dueAt));
      }
      if(b.managementVersion!==input.expectedManagementVersion+1||b.deliveryMode!==pending.baseline.deliveryMode||b.campusId!==pending.baseline.campusId||b.createdBy!==pending.baseline.createdBy||b.counts.totalCount!==pending.baseline.counts.totalCount||result.tasks.length!==p.assignments.length)return false;
      return result.tasks.every(row=>{const change=p.assignments.find(item=>item.taskId===row.taskId);return change&&row.version===change.expectedVersion+1&&(row.ownerId||null)===(change.toOwnerId||null)&&row.status===change.toStatus&&sameTime(row.dueAt,change.toDueAt);})&&(pending.kind!=='transfer'||b.supervisorId===input.supervisorId)&&(pending.kind!=='schedule'||sameTime(b.startsAt,input.startsAt)&&sameTime(b.dueAt,input.dueAt));
    }
    async function commit(retry=false) {
      const d=s.dialog;if(!retry){if(locked()||!d?.preview||d.preview.expectedPreview.blockedCount>0)return;s.pending={kind:d.kind,batchId:s.route.batchId||null,key:root.crypto.randomUUID(),body:copy(d.preview),baseline:copy(s.batch),uncertain:false};}
      const pending=s.pending;if(!pending||d?.writing)return;const token=generation;if(d)d.writing=true;s.error='';draw();
      try{const result=await (pending.kind==='create'?routing.commitCreate(pending.body,pending.key):routing[method('commit',pending.kind)](pending.batchId,pending.body,pending.key));if(!still(token))return;if(!validReceipt(pending,result))throw Error('未收到与原请求一致的成功回执，请用原请求确认。');
        s.pending=null;s.receipt=result;s.dirty=false;s.selection={};s.selectionStale=false;s.dialog=null;s.notice='办理已确认。';
        if(result.scopeStatus==='left_scope'){restrict();s.notice='办理已成功；该批次已不在当前查看范围，保留最小回执。';}
        else if(pending.kind==='create'){s.batch=result.batch;s.notice='营销任务已发起；主管模式可继续分配，员工模式直接进入本人任务队列。';}
        else {await load();s.notice='办理已确认。';}
      }catch(error){if(!still(token))return;if([401,403,404].includes(error.status))restrict();const rejected=error.status>=400&&error.status<500&&['PREVIEW_STALE','INVALID_INPUT','FORBIDDEN','NOT_FOUND','ALREADY_EXISTS','IDEMPOTENCY_CONFLICT'].includes(error.code);if(!pending.uncertain&&rejected){s.pending=null;if(d)d.preview=null;s.selectionStale=true;}else pending.uncertain=true;s.error=error.message||'提交结果尚未确认。';}
      finally{if(still(token)){if(d)d.writing=false;draw();}}
    }
    function countButtons(counts,batchId,ownerId='') {return countFields.map(([key,label,status])=>`<td>${button(String(counts[key]),'drill',` data-batch="${e(batchId)}" data-owner="${e(ownerId)}" data-status="${status}"`)}</td>`).join('');}
    function filtersHtml(){
      const staff=s.tab!=='supervisor'?`${field('员工编号','ownerId',s.taskQuery.ownerId,'maxlength="120"')}${select('任务状态','status',s.taskQuery.status,[['','全部'],...Object.entries(statuses)])}`:'';
      const common=`${field('任务名称','query',s.filters.query,'maxlength="200"')}${select('任务范围','view',s.filters.view,[['responsible','我负责的'],['created','我发起且当前可见'],['scope','当前管理范围']])}${select('分配状态','distributionStatus',s.filters.distributionStatus,[['','全部'],...Object.entries(distribution)])}${select('执行状态','executionStatus',s.filters.executionStatus,[['','全部'],...Object.entries(execution)])}`;
      const extra=`${field('负责校区编号','campusId',s.filters.campusId,'maxlength="120"')}${field('主管编号','supervisorId',s.filters.supervisorId,'maxlength="120"')}${field('创建起始（北京时间）','fromAt',local(s.filters.fromAt),'type="datetime-local"')}${field('创建截止（北京时间）','untilAt',local(s.filters.untilAt),'type="datetime-local"')}${staff}`;
      const activeExtra=['campusId','supervisorId','fromAt','untilAt'].some(key=>s.filters[key])||s.taskQuery.ownerId||s.taskQuery.status;
      return `<form data-tr-form="filters" class="tr-filters">${common}<details class="tr-filter-more"${activeExtra?' open':''}><summary>更多筛选${activeExtra?'（已设置）':''}</summary><div class="tr-filter-extra">${extra}</div></details><div class="tr-form-actions"><button class="btn primary" type="submit"${locked()||s.loading?' disabled':''}>搜索</button>${button('重置筛选','reset', '',s.loading)}</div></form>`;
    }
    function listHtml(){
      const rows=s.data?.items||[];
      if(s.tab==='supervisor')return table(['任务名称','主管','分配状态','执行状态',...countFields.map(([,label])=>label),'操作'],rows.map(row=>`<tr><td>${button(row.title,'batch',` data-batch="${e(row.id)}"`)}<small>${e(row.deliveryMode==='direct'?'员工直派':'主管分派')} · ${e(row.id)}</small></td><td>${e(row.supervisorId||'不设主管')}</td><td>${e(distribution[row.distributionStatus]||row.distributionStatus)}</td><td>${e(execution[row.executionStatus]||row.executionStatus)}</td>${countButtons(row.counts,row.id)}<td>${button('查看／管理','batch',` data-batch="${e(row.id)}"`)}</td></tr>`));
      if(s.tab==='employees')return table(['任务名称','员工',...countFields.map(([,label])=>label),'操作'],rows.map(row=>`<tr><td>${button(row.batchTitle||row.batchId,'batch',` data-batch="${e(row.batchId)}"`)}</td><td>${e(row.ownerId)}</td>${countButtons(row.counts,row.batchId,row.ownerId)}<td>${button('查看该员工明细','drill',` data-batch="${e(row.batchId)}" data-owner="${e(row.ownerId)}"`)}</td></tr>`));
      if(s.tab==='history')return table(['时间','操作','操作员工','主管变化','原因','条目变化'],rows.map(row=>`<tr><td>${e(local(row.occurredAt).replace('T',' '))}</td><td>${e(row.action==='create'?'发起任务':operations[row.action]||row.action)}</td><td>${e(row.actorId)}</td><td>${e(row.fromSupervisorId||'—')} → ${e(row.toSupervisorId||'—')}</td><td>${e(row.reason||'—')}</td><td>${(row.changes||[]).map(change=>`<p>${e(change.taskId)} · ${e(statuses[change.fromStatus]||change.fromStatus)} → ${e(statuses[change.toStatus]||change.toStatus)} · ${e(change.fromOwnerId||'未分配')} → ${e(change.toOwnerId||'未分配')}</p>`).join('')||'无员工任务变更'}</td></tr>`));
      return table([...(s.route.batchId?['选择']:[]),'任务／批次','客户／孩子','学科／学期','负责人','状态','截止','来源','操作'],rows.map(row=>`<tr>${s.route.batchId?`<td><input type="checkbox" data-tr-select="${e(row.id)}" aria-label="选择任务 ${e(row.id)}"${s.selection[row.id]?' checked':''}${['completed','cancelled'].includes(row.status)||locked()?' disabled':''}></td>`:''}<td>${e(row.id)}<br>${button(row.batchId,'batch',` data-batch="${e(row.batchId)}"`)}</td><td>${e(row.customerId)}<br>${e(row.studentId||'孩子待确认')}</td><td>${e(row.subject||'学科待确认')} / ${e(row.term||'学期待确认')}</td><td>${e(row.ownerId||'未分配')}</td><td>${e(statuses[row.status]||row.status)}</td><td>${e(local(row.dueAt).replace('T',' '))}</td><td>${row.sourceStatus==='known'?(row.sources||[]).map(source=>e(`${source.type==='lead'?'线索':'触点'} ${source.id}`)).join('<br>'):row.sourceStatus==='restricted'?'来源受权限限制':'历史来源未记录'}</td><td>${row.ownerId===actor.principalId&&has('crm.task.write')&&['pending','in_progress'].includes(row.status)?button('进入本人跟进','task',` data-task="${e(row.id)}"`):'仅管理查看'}</td></tr>`));
    }
    function candidatesHtml(d) {
      const supervisor=d.kind==='transfer'||d.kind==='create'&&d.mode==='supervisor';
      return `<section><h3>${supervisor?'选择接收主管（单人）':'选择员工与分配数量'}</h3><p class="help">使用当前授权校区与真实员工公开编号；未配置组织部门目录。${supervisor?'':'待完成量仅为当前操作者范围，不是全公司总量。'}</p><div class="tr-inline">${field('员工公开编号／前缀','candidateQuery',d.candidateQuery,'maxlength="120"')}${button('查询候选','candidates','',d.candidateBusy)}</div>${d.candidateBusy?'<p role="status">正在读取可接收人员…</p>':''}${table(['选择','员工公开编号','当前范围待完成量'],(d.candidates?.items||[]).map(row=>`<tr><td><input type="${supervisor?'radio':'checkbox'}" name="${supervisor?'supervisorId':'employee.'+e(row.id)}" value="${e(row.id)}" data-tr-candidate="${e(row.id)}"${(supervisor?d.supervisorId===row.id:d.owners.some(owner=>owner.id===row.id))?' checked':''}${locked()?' disabled':''}></td><td>${e(row.label||row.id)}</td><td>${e(row.pendingCount)}</td></tr>`))}${pager(d.candidates,'candidate-page')}${supervisor?`<p>已选主管：${e(d.supervisorId||'未选择')}</p>`:`${select('分配方式','strategy',d.strategy,[['even','系统平均分配'],['quota','手动指定数量']])}<div class="tr-owner-grid">${d.owners.map(owner=>`<div><strong>${e(owner.label||owner.id)}</strong>${d.strategy==='quota'?field('本次分配数量','quota.'+owner.id,owner.count,'type="number" min="0" max="500" step="1" required'):''}${button('移除','remove-owner',` data-owner="${e(owner.id)}"`)}</div>`).join('')||'<p>尚未勾选员工，可跨页选择。</p>'}</div>${d.kind==='allocation'?select('原线索负责人优先','sourceOwnerPolicy',d.sourceOwnerPolicy,[['none','不使用原负责人，按本次名单分配'],['source_lead_owner_first','已明确的来源线索负责人优先，其余平均']]):''}<p class="help">指定数量合计须等于本次合格需求数量，以服务端预览为准；原线索负责人优先不使用客户负责人代替。</p>`}</section>`;
    }
    function targetsHtml(d){return `<section><h3>来源需求 · ${d.targets.length} 项</h3><p class="help">来自活动中实际选中来源；同一孩子、学科、学期的来源已合并。来源已明确的身份不得改写，未明确可补充。未确认孩子可保留家庭需求。</p>${d.targets.map((row,i)=>`<div class="tr-target"><strong>${e(row.customerLabel||row.customerId)}</strong><small>${e(row.customerId)} · ${row.sources.map(source=>e(source.id)).join('、')}</small><p>孩子：${e(row.studentLabel||row.studentId||'待确认')}${!row.locks.student?button('选择关联孩子','children',` data-index="${i}"`):''}</p><div class="tr-grid">${field('学科',`target.${i}.subject`,row.subject,`maxlength="100"${row.locks.subject?' readonly':''}`)}${field('学期',`target.${i}.term`,row.term,`maxlength="100"${row.locks.term?' readonly':''}`)}</div></div>`).join('')}${d.children?`<div class="tr-target"><h4>选择当前家庭有效关联孩子</h4>${table(['孩子','年级',''],d.children.items.map(row=>`<tr><td>${e(row.name||row.id)}</td><td>${e(row.grade||'未登记')}</td><td>${button('选择','child-pick',` data-child="${e(row.id)}"`)}</td></tr>`))}${pager(d.children,'child-page')}${button('明确保留孩子待确认','child-unknown')}</div>`:''}</section>`;}
    function previewHtml(d){
      const p=d.preview.expectedPreview;
      const info=d.kind==='create'?`选中 ${p.selectedCount} 项需求 · 可创建 ${p.reservedCount} 项 · 跳过 ${p.skippedCount} 项`:`选中 ${p.selectedCount} 条 · 将变更 ${p.assignableCount} 条 · 阻止 ${p.blockedCount} 条 · 剩余待分配 ${p.remainingUnassignedCount} 条`;
      const assignments=Object.entries(p.assignmentCounts||{}).map(([owner,count])=>`${e(owner)}：${e(count)}`).join('；');
      const detail=d.kind==='create'?table(['客户／孩子','学科／学期','接收员工','状态','真实来源'],p.targets.map(row=>`<tr><td>${e(row.target.customerId)} / ${e(row.target.studentId||'孩子待确认')}</td><td>${e(row.target.subject||'待确认')} / ${e(row.target.term||'待确认')}</td><td>${e(row.ownerId||'主管待分配池')}</td><td>${e(statuses[row.status]||row.status)}</td><td>${(row.target.sources||[]).map(source=>e(source.id)).join('、')}</td></tr>`))+table(['跳过需求','原因'],p.skippedTargets.map(row=>`<tr><td>${e(row.target.customerId)} / ${e(row.target.subject||'待确认')}</td><td>${e(row.reason==='identity_review_required'?'需求身份待核对':row.reason==='open_marketing_task'?'已有未完营销任务':row.reason)}</td></tr>`)):table(['任务','负责人变化','状态变化','截止变化','依据'],p.assignments.map(row=>`<tr><td>${e(row.taskId)} · v${e(row.expectedVersion)}</td><td>${e(row.fromOwnerId||'未分配')} → ${e(row.toOwnerId||'未分配')}</td><td>${e(statuses[row.fromStatus]||row.fromStatus)} → ${e(statuses[row.toStatus]||row.toStatus)}</td><td>${e(local(row.fromDueAt))} → ${e(local(row.toDueAt))}</td><td>${e(row.basis)}</td></tr>`))+table(['被阻止条目','原因'],p.blocked.map(row=>`<tr><td>${e(row.taskId)}</td><td>${e(row.reason)}</td></tr>`));
      return `<section class="tr-preview"><h3>提交前核对</h3><p>${e(info)}</p>${d.kind==='transfer'?`<p>主管：${e(p.fromSupervisorId)} → ${e(p.toSupervisorId)}；员工任务归属不变。</p>`:''}${d.kind==='create'||d.kind==='schedule'?`<p>开始 ${e(local(p.startsAt))} · 截止 ${e(local(p.dueAt))}（北京时间）</p>`:''}${d.kind==='create'&&p.deliveryMode==='supervisor'?`<p>接收主管：${e(p.supervisorId)}；创建后直接进入其待分配队列，无需接受审批。</p>`:''}${d.kind==='create'&&p.deliveryMode==='direct'?'<p>直接分给员工，不再拆分。</p>':''}${d.reason?`<p>原因：${e(d.reason)}</p>`:''}${assignments?`<p>实际接收计划：${assignments}</p>`:''}${detail}<p class="notice">预计结果经过服务端按当前版本核对；提交时再校验。完成任务不会自动产生商机成交。</p><div class="tr-form-actions">${button('返回修改','edit-preview')}${button('确认提交','commit','',p.blockedCount>0||d.kind==='create'&&p.reservedCount===0,true)}</div></section>`;
    }
    function dialogHtml(){const d=s.dialog;if(!d||s.restricted)return '';return `<div class="tr-backdrop"><section class="tr-dialog" role="dialog" aria-modal="true" aria-labelledby="tr-dialog-title"><header><h2 id="tr-dialog-title">${e(d.kind==='create'?'发起营销任务':operations[d.kind])}</h2>${button('关闭','close-dialog')}</header>${d.error?`<p class="notice" role="alert">${e(d.error)}</p>`:''}${d.writing?'<p role="status">正在核对或提交，请稍候…</p>':''}${d.preview?previewHtml(d):`<form data-tr-form="operation"><fieldset${locked()?' disabled':''}>${d.kind==='create'?`<div class="tr-grid">${field('任务名称','title',d.title,'required maxlength="200"')}${select('执行人','mode',d.mode,[['supervisor','分配给主管，主管再分配员工'],['direct','分配给员工，不再拆分']])}${field('开始时间（北京时间）','startsAt',d.startsAt,'type="datetime-local" required')}${field('截止时间（北京时间）','dueAt',d.dueAt,'type="datetime-local" required')}${field('任务说明','note',d.note,'maxlength="2000"')}</div><p class="help">${d.mode==='supervisor'?'一个批次只选一名主管；创建后直接进入其待分配队列，无需接受审批。':'直接分给员工的营销任务不能再次拆分。'}</p>${targetsHtml(d)}`:''}${['allocation','transfer','create'].includes(d.kind)?candidatesHtml(d):''}${d.kind==='schedule'?`<div class="tr-grid">${field('开始时间（北京时间）','startsAt',d.startsAt,'type="datetime-local" required')}${field('截止时间（北京时间）','dueAt',d.dueAt,'type="datetime-local" required')}</div><p class="notice">只更新未完成任务日期，已完成事实保持原样。已开始后不能将开始时间推到未来。</p>`:''}${d.kind==='recall'?'<p class="notice">任务回收后，原员工将不能查看及跟进；任务编号和来源保留，主管可重新分配。仅回收选中的未完任务。</p>':''}${d.kind==='cancel'?'<p class="notice">将取消此批全部未完任务。已完成事实和历史记录保留，不可恢复删除。</p>':''}${!['create','allocation'].includes(d.kind)?`<label>办理原因<textarea class="textarea" name="reason" required maxlength="1000">${e(d.reason)}</textarea></label>`:''}<div class="tr-form-actions">${button('取消','close-dialog')}<button class="btn primary" type="submit"${locked()?' disabled':''}>核对影响与分配</button></div></fieldset></form>`}</section></div>`;}
    function receiptHtml(){const r=s.receipt;return r?`<section class="card pad"><h2>办理回执</h2><p>已提交 · 批次 ${e(r.batchId)} · 操作 ${e(r.operationId)}</p>${r.scopeStatus==='left_scope'||s.restricted?'<p>详情当前不可读；此处仅保留提交成功事实。</p>':`${r.batch?`<p>${e(r.batch.title)} · ${e(distribution[r.batch.distributionStatus])} · ${e(execution[r.batch.executionStatus])}</p>`:''}${has('crm.task.manage')&&has('crm.task.read')?button('查看本批管理明细','batch',` data-batch="${e(r.batchId)}"`):''}${r.tasks.filter(row=>row.ownerId===actor.principalId&&row.status==='pending').map(row=>button('跟进 '+row.taskId,'task',` data-task="${e(row.taskId)}"`)).join('')}`}</section>`:'';}
    function html(){
      const tabs=[['supervisor','主管任务'],['employees','员工任务'],['tasks','外呼线索'],...(s.route.batchId?[['history','批次历史']]:[])];
      const top=`<div class="heading"><div><h1>${e(s.restricted?'任务工作页':s.mode==='create'?'发起营销任务':s.batch?.title||'主管任务管理')}</h1><p class="subtitle">${s.restricted?'当前资料已隐藏。':s.mode==='create'?`来源活动：${e(s.route.activity?.title||s.route.activity?.id)} · 负责校区：${e(s.route.activity?.campusId||'未明确')}`:'管理分配与员工实际办理分开；兼岗人员须先分配给自己再跟进。'}</p></div><div class="actions">${button('返回原工作页','back')}${button('刷新','refresh','',s.loading)}</div></div>`;
      const notices=`${s.error?`<p class="notice" role="alert">${e(s.error)}</p>`:''}${s.notice?`<p role="status">${e(s.notice)}</p>`:''}${s.pending?.uncertain?`<section class="notice">提交结果尚未确认，请保持原内容与请求编号。${button('用原请求重试确认','retry','',s.dialog?.writing,true)}</section>`:''}`;
      if(s.restricted)return `<div class="java-crm-task-routing">${top}${notices}<p class="notice">原资料已隐藏，请重新核对当前权限。未确认提交仍保留原请求，不能修改后重发。</p>${receiptHtml()}</div>`;
      const summary=s.batch?`<section class="card pad"><div class="tr-summary">${[['负责校区',s.batch.campusId],['主管',s.batch.supervisorId||'员工直派'],['开始',local(s.batch.startsAt)],['截止',local(s.batch.dueAt)],['分配状态',distribution[s.batch.distributionStatus]],['执行状态',execution[s.batch.executionStatus]]].map(([label,value])=>`<div><small>${e(label)}</small><strong>${e(value)}</strong></div>`).join('')}</div><div class="tr-toolbar">${Object.entries(operations).filter(([kind])=>permitted(kind)).map(([kind,label])=>button(label,'operation',` data-kind="${kind}"`,s.loading||['allocation','recall'].includes(kind)&&!Object.keys(s.selection).length)).join('')}</div></section>`:'';
      const selection=s.route.batchId&&s.tab==='tasks'?`<div class="tr-toolbar"><strong>跨页已选 ${Object.keys(s.selection).length} 条未完明细</strong>${button('勾选本页','select-page','',s.loading)}${button('清空已选','clear-selection')}${s.selectionStale?'<p class="notice">已选条目版本发生变化，请清空重选。</p>':''}</div>`:'';
      const content=s.mode==='create'?`<section class="card pad"><p>本次来自已核对活动名单的 ${s.route.targets?.length||0} 项需求，完成任务不代表成交。</p>${!s.dialog&&!s.receipt?button('继续填写发起任务','resume-create','',false,true):''}</section>`:`${summary}<div class="tr-tabs">${tabs.map(([key,label])=>`<button type="button" data-tr-action="tab" data-tab="${key}" aria-pressed="${s.tab===key}"${locked()?' disabled':''}>${label}</button>`).join('')}</div>${s.tab==='history'?'':filtersHtml()}${s.tab==='tasks'?'<p class="help">“外呼线索”展示真实营销任务明细；通信供应商尚待配置，此页不会发起电话或伪造接通结果。</p>':''}${selection}${listHtml()}${pager(s.data)}`;
      return `<div class="java-crm-task-routing">${top}${notices}${receiptHtml()}${content}${dialogHtml()}</div>`;
    }
    async function loadChildren(index,pageNumber=1){const d=s.dialog;if(!d||locked()||d.targets[index]?.locks.student)return;const token=generation;d.childTarget=index;d.childPage=pageNumber;d.children=null;draw();try{const data=await api.tasks.customerStudents(d.targets[index].customerId,{page:pageNumber,size:20});if(still(token)&&s.dialog===d&&d.childTarget===index&&d.childPage===pageNumber){d.children=page(data);draw();}}catch(error){if(still(token)&&s.dialog===d){d.error=error.message||'关联孩子读取失败';draw();}}}
    async function action(name,data={}){
      if(locked()&&name!=='retry')return;
      if(name==='retry')return commit(true);
      if(name==='back')return onReturn();
      if(name==='refresh'){if(s.dialog)s.dialog.preview=null;return load();}
      if(name==='resume-create'){s.dialog=s.createDraft;draw();return;}
      if(name==='tab'){s.tab=data.tab;if(data.tab==='employees'&&s.taskQuery.status==='unassigned')delete s.taskQuery.status;s.selection={};s.selectionStale=false;return load();}
      if(name==='page'){s.pages[s.tab]=Number(data.page);return load();}
      if(name==='reset'){s.filters={view:'responsible'};s.taskQuery={};s.pages[s.tab]=1;s.selection={};return load();}
      if(name==='batch'||name==='drill'){return onOpenBatch({batchId:data.batch,tab:name==='drill'?'tasks':'supervisor',filters:copy(s.filters),taskQuery:{...(data.owner?{ownerId:data.owner}:{}),...(data.status?{status:data.status}:{})}});}
      if(name==='task')return onOpenTask(data.task);
      if(name==='clear-selection'){s.selection={};s.selectionStale=false;draw();return;}
      if(name==='select-page'){for(const row of s.data?.items||[])if(row.batchId===s.route.batchId&&!['completed','cancelled'].includes(row.status)&&Object.keys(s.selection).length<500)s.selection[row.id]=copy(row);draw();return;}
      if(name==='operation'){
        if(!permitted(data.kind))throw Error('当前批次未授权此操作。');const d=makeDialog(data.kind);d.startsAt=local(s.batch.startsAt);d.dueAt=local(s.batch.dueAt);s.dialog=d;draw();if(['allocation','transfer'].includes(d.kind))return candidates();return;
      }
      const d=s.dialog;if(!d)return;
      if(name==='close-dialog'){if(d.kind==='create')s.createDraft=d;s.dialog=null;draw();return;}
      if(name==='candidates')return candidates(1);
      if(name==='candidate-page')return candidates(Number(data.page));
      if(name==='remove-owner'){d.owners=d.owners.filter(row=>row.id!==data.owner);d.preview=null;s.dirty=true;draw();return;}
      if(name==='children')return loadChildren(Number(data.index));
      if(name==='child-page')return loadChildren(d.childTarget,Number(data.page));
      if(name==='child-pick'||name==='child-unknown'){const target=d.targets[d.childTarget];if(!target||target.locks.student)return;const child=name==='child-pick'?d.children?.items.find(row=>row.id===data.child):null;if(name==='child-pick'&&!child)return;target.studentId=child?.id||null;target.studentLabel=child?.name||'';d.children=null;d.preview=null;s.dirty=true;draw();return;}
      if(name==='edit-preview'){d.preview=null;draw();return;}
      if(name==='commit')return commit();
    }
    async function submit(form){if(locked())return;const values=capture(form);if(form.dataset.trForm==='filters'){
      const filters={view:values.view||'responsible'};for(const key of ['query','campusId','supervisorId','distributionStatus','executionStatus'])if(values[key])filters[key]=values[key];
      if(values.fromAt||values.untilAt){if(!values.fromAt||!values.untilAt)throw Error('创建期间须同时填写起止时间。');filters.fromAt=instant(values.fromAt);filters.untilAt=instant(values.untilAt);}
      s.filters=filters;s.taskQuery={...(values.ownerId?{ownerId:values.ownerId}:{}),...(values.status?{status:values.status}:{})};s.pages[s.tab]=1;s.selection={};s.selectionStale=false;return load();
    }update(values);return preview();}
    const handlers={
      click:event=>{const target=event.target.closest?.('[data-tr-action]');if(!target)return;event.preventDefault();Promise.resolve(action(target.dataset.trAction,target.dataset)).catch(error=>{if(s.dialog)s.dialog.error=error.message;else s.error=error.message;draw();});},
      submit:event=>{const form=event.target.closest?.('[data-tr-form]');if(!form)return;event.preventDefault();Promise.resolve(submit(form)).catch(error=>{if(s.dialog)s.dialog.error=error.message;else s.error=error.message;draw();});},
      input:event=>{const form=event.target.closest?.('[data-tr-form="operation"]');if(form&&!locked())update(capture(form));},
      change:event=>{if(locked())return;const target=event.target;if(target.dataset.trSelect){const row=s.data?.items.find(item=>item.id===target.dataset.trSelect);if(row&&row.batchId===s.route.batchId&&!['completed','cancelled'].includes(row.status)){if(target.checked){if(Object.keys(s.selection).length>=500){s.error='最多选择500条明细。';draw();return;}s.selection[row.id]=copy(row);}else delete s.selection[row.id];draw();}return;}
        const d=s.dialog;if(!d)return;if(target.dataset.trCandidate){const candidate=d.candidates?.items.find(row=>row.id===target.dataset.trCandidate);if(!candidate)return;if(d.kind==='transfer'||d.kind==='create'&&d.mode==='supervisor')d.supervisorId=candidate.id;else if(target.checked&&!d.owners.some(row=>row.id===candidate.id))d.owners.push({...candidate,count:'0'});else if(!target.checked)d.owners=d.owners.filter(row=>row.id!==candidate.id);d.preview=null;s.dirty=true;draw();return;}
        const form=target.closest?.('[data-tr-form="operation"]');if(form){update(capture(form));if(['mode','strategy','sourceOwnerPolicy'].includes(target.name)){if(target.name==='mode'){d.candidates=null;d.owners=[];d.supervisorId='';}if(d.strategy==='quota')d.sourceOwnerPolicy='none';draw();if(target.name==='mode')void candidates();}}},
      keydown:event=>{if(event.key==='Escape'&&s.dialog&&!locked()){event.preventDefault();void action('close-dialog');}}
    };
    function bind(container=root.document.getElementById('view')){if(bound===container)return;if(bound)for(const [name,handler]of Object.entries(handlers))bound.removeEventListener(name,handler);bound=container;if(bound)for(const [name,handler]of Object.entries(handlers))bound.addEventListener(name,handler);}
    async function open(route={}){active=true;s.route=copy(route);s.mode=route.mode||'list';s.tab=route.tab||'supervisor';s.filters=copy(route.filters||{view:'responsible'});s.taskQuery=copy(route.taskQuery||{});requireCodes(requirement());
      if(s.mode==='create'){const d=makeDialog('create');d.title=`${route.activity?.title||'活动'} · 跟进任务`.slice(0,200);d.targets=copy(route.targets||[]);s.dialog=d;s.createDraft=d;s.dirty=!!d.targets.length;draw();if(!route.activity?.campusId){d.error='来源活动未明确负责校区，不能发起本模式；请先核对活动资料。';draw();return;}await candidates();}
      else await load();
    }
    async function restore(snapshot,newIdentity=actor){active=true;actor=newIdentity;if(snapshot)s=copy(snapshot);generation++;try{requireCodes(requirement());if(locked()){restrict();draw();return;}s.restricted=false;if(s.mode==='create'){draw();if(s.dialog)await candidates();}else await load();}catch(error){restrict();s.error=error.message;draw();}}
    return {open,html,bind,restore,snapshot:()=>copy(s),suspend(){active=false;generation++;s.loading=false;if(s.dialog){s.dialog.candidateSequence++;s.dialog.candidateBusy=false;}},canLeave:()=>!locked(),isDirty:()=>s.dirty||!!Object.keys(s.selection).length||!!s.dialog?.preview,title:()=>s.restricted?'任务工作页':s.mode==='create'?'发起任务 · '+(s.route.activity?.title||s.route.activity?.id||'活动'):s.route.batchId?'主管任务 · '+(s.batch?.title||s.route.batchId):'主管任务管理',dispose(){disposed=true;active=false;generation++;if(bound)for(const[name,handler]of Object.entries(handlers))bound.removeEventListener(name,handler);bound=null;}};
  }
  root.SiyueCrmTaskRouting={pages,create,targetsFromAudience};
})(window);
