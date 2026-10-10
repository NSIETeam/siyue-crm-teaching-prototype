// 快捷入口沿用线索档案及教务报名流程，示例登记人固定为当前登录用户王敏。
const shortcutUser='王敏';
let shortcutFiltersOpen=false;
const shortcutFilter={search:'',from:'',to:'',preset:'',stage:'',intent:''};
function shortcutDate(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function shortcutDayOffset(days){const date=new Date();date.setDate(date.getDate()-days);return shortcutDate(date)}
leadState.leads.forEach((l,i)=>l.leadId??=`LEAD-${i+1}`);
leadState.leads.slice(0,5).forEach((l,i)=>{l.registrar=shortcutUser;l.createdAt=`${shortcutDayOffset([5,0,28,8,1][i])} 10:30`});
leadPages.quickRegister='线索登记';
const shortcutPreviousRender=render;
render=function(){if(state.page!=='enroll')a.enrollingLeadId=null;if(state.page==='quickRegister'||state.page==='quickEnroll')shortcutRender();else shortcutPreviousRender()};
const shortcutPreviousLeadRender=leadRender;
leadRender=function(){if(state.page==='quickRegister')shortcutRender();else shortcutPreviousLeadRender()};
const shortcutPreviousAcademicRender=academicRender;
academicRender=function(){if(state.page==='quickEnroll')shortcutRender();else shortcutPreviousAcademicRender()};
const shortcutPreviousSaveLead=saveLead;
saveLead=function(){
  const fromShortcut=state.page==='quickRegister',creating=leadState.formMode==='create',before=leadState.leads.length;
  shortcutPreviousSaveLead();
  if(creating&&leadState.leads.length>before){
    leadState.leads[0].registrar=shortcutUser;
    leadState.leads[0].leadId=`LEAD-${Date.now()}`;
    leadState.leads[0].createdAt=new Date().toLocaleString('sv-SE').replace('T',' ');
    if(fromShortcut){state.page='quickRegister';shortcutRender()}
  }
};
const shortcutPreviousLeadToEnrollment=leadToEnrollment;
leadToEnrollment=function(){const lead=leadState.leads[leadState.selected];if(lead?.stage==='已报名')return shortcutPreviousLeadToEnrollment();if(lead&&!lead.leadId)lead.leadId=`LEAD-${Date.now()}`;a.enrollingLeadId=lead?.leadId||null;shortcutPreviousLeadToEnrollment()};
const shortcutPreviousFinishEnroll=finishEnroll;
finishEnroll=function(){const leadId=a.enrollingLeadId,course=a.classes[a.selectedClass]||a.classes[0];shortcutPreviousFinishEnroll();if(leadId&&course&&a.orders[0]){a.orders[0].originLeadId=leadId;a.orders[0].productCategory=course.productCategory||'正价课';const lead=leadState.leads.find(l=>l.leadId===leadId);if(lead){lead.stage='已报名';lead.status='mine';lead.history.push(['报名完成','今天',`已报名${course.course||course.name}。`])}}a.enrollingLeadId=null};
function shortcutRender(){
  leadRefreshSchoolGrades();
  const page=state.page;
  document.querySelectorAll('.menu-item').forEach(e=>e.classList.toggle('active',e.dataset.page===page));
  document.querySelectorAll('[data-nav-toggle]').forEach(e=>e.classList.remove('active-parent'));
  document.querySelector(page==='quickRegister'?'[data-nav-toggle="leads"]':'[data-nav-toggle="academic"]')?.classList.add('active-parent');
  $('#crumb').textContent=page==='quickRegister'?'线索 / 线索登记':'教务 / 业务办理 / 报名';
  $('#view').innerHTML=page==='quickRegister'
    ?shortcutRegisterPage()+(leadState.modal?leadModalPage():'')
    :enrollPage()+(a.modal?modalPage():'');
  if(page==='quickRegister')shortcutApplyFilters();
}
function shortcutRegisterPage(){
  const registered=leadState.leads.map((l,index)=>({...l,index})).filter(l=>l.registrar===shortcutUser);
  const today=shortcutDayOffset(0),ninetyDaysAgo=shortcutDayOffset(89);
  const valid=registered.filter(l=>shortcutMatchDate(l.createdAt,ninetyDaysAgo,today));
  const enrolledLeadIds=new Set(a.orders.filter(o=>o.productCategory==='正价课'&&o.originLeadId).map(o=>o.originLeadId));
  const convertedCount=new Set(registered.filter(l=>enrolledLeadIds.has(l.leadId)).map(l=>`${l.name}|${l.contactPhone||l.phone}`)).size;
  const stats=[
    ['累计登记',registered.length,'该账号全部登记线索总计；转交后仍计入。'],
    ['有效线索',valid.length,'该账号近90天登记的全部线索总计（含今天）。'],
    ['已转化',convertedCount,'该账号登记线索中，有过报名正价课行为的人数总计。']
  ];
  const rows=registered.map(l=>{const intent=shortcutIntent(l);return `<tr data-created="${esc(l.createdAt?.slice(0,10)||'')}" data-search="${esc([l.name,l.guardian,l.phone].join(' '))}" data-stage="${esc(l.stage)}" data-intent="${esc(intent)}"><td>${leadPerson(l)}</td><td>${esc(l.grade)}</td><td>${esc(l.subject)}</td><td>${esc(l.createdAt||'—')}</td><td>${esc(l.owner)}</td><td>${leadPill(l.stage)}</td><td><span class="shortcut-intent">${esc(intent)}</span></td><td>${esc(l.history.at(-1)?.[1]||'—')}</td><td><button class="btn small" onclick="leadDetail(${l.index},'quickRegister')">详情</button></td></tr>`});
  return heading('线索登记','查看本人录入的线索；分配、转化或归档后仍归入原登记人统计')+
    `<div class="shortcut-stats card" aria-label="线索登记统计">${stats.map(([name,value,note])=>`<div class="shortcut-stat" title="${esc(note)}"><span>${esc(name)}</span><strong>${value}</strong></div>`).join('')}<details class="shortcut-stat-help"><summary>统计口径</summary><div>${stats.map(([name,value,note])=>`<p><b>${esc(name)}：</b>${esc(note)}</p>`).join('')}</div></details></div>`+
    `<div class="card pad shortcut-register-card"><div class="toolbar"><div class="toolbar-left"><h2 class="section-title" style="margin:0">我录入的线索</h2><span class="count">共 ${registered.length} 条</span></div><div class="toolbar-right"><button class="btn" onclick="leadState.modal='import';leadRender()">批量导入</button><button class="btn primary" onclick="leadState.formMode='create';leadState.modal='form';leadRender()">+ 单个登记</button></div></div>`+
    `<div class="shortcut-filter-bar"><div class="shortcut-filter-field shortcut-search-field"><div class="shortcut-search"><svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 5 5"></path></svg><input id="quick-search" class="input" value="${esc(shortcutFilter.search)}" placeholder="搜索学生、家长或手机号" aria-label="搜索学生、家长或手机号" oninput="shortcutFilter.search=this.value;shortcutApplyFilters()"><button type="button" id="quick-filter-toggle" class="quick-filter-toggle ${shortcutFilterCount()?'is-filtered':''}" aria-label="${shortcutFilterDescription()}" title="${shortcutFilterDescription()}" aria-expanded="${shortcutFiltersOpen}" aria-controls="quick-filter-panel" onclick="shortcutToggleFilters()"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18l-7 8v7l-4 2v-9Z"/></svg><span id="quick-filter-badge" ${shortcutFilterCount()?'':'hidden'}>${shortcutFilterCount()}</span></button></div></div><div id="quick-filter-panel" class="quick-filter-panel" ${shortcutFiltersOpen?'':'hidden'}><div class="shortcut-date-row"><label for="quick-date-from">登记时间</label><div class="shortcut-date-range"><input id="quick-date-from" class="input" type="date" value="${shortcutFilter.from}" aria-label="登记开始日期" onchange="shortcutSetDate()"><span>至</span><input id="quick-date-to" class="input" type="date" value="${shortcutFilter.to}" aria-label="登记结束日期" onchange="shortcutSetDate()"></div><div class="shortcut-presets">${[['today','今天'],['yesterday','昨天'],['7','近7天'],['30','近30天'],['90','近90天']].map(([key,label])=>`<button class="btn ${shortcutFilter.preset===key?'selected':''}" onclick="shortcutPreset('${key}')">${label}</button>`).join('')}</div></div><div class="shortcut-extra-filters"><div class="shortcut-filter-field"><label for="quick-stage">当前阶段</label><select class="select" id="quick-stage" onchange="shortcutFilter.stage=this.value;shortcutApplyFilters()"><option value="">全部阶段</option>${['新线索','新分配','跟进中','已报名'].map(x=>`<option value="${x}" ${shortcutFilter.stage===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="shortcut-filter-field"><label for="quick-intent">意向度</label><select class="select" id="quick-intent" onchange="shortcutFilter.intent=this.value;shortcutApplyFilters()"><option value="">全部意向度</option>${['低意向','中意向','高意向','已报名'].map(x=>`<option value="${x}" ${shortcutFilter.intent===x?'selected':''}>${x}</option>`).join('')}</select></div></div><div class="quick-filter-footer"><button class="btn small" onclick="shortcutClearFilters()">清除筛选</button><button class="btn small" onclick="shortcutToggleFilters()">收起</button></div></div></div>`+
    `<div class="quick-lead-table">${aTable(['学生 / 家长','年级','意向学科','登记时间','当前负责人','当前阶段','意向度','最近更新','操作'],rows)}</div><div class="data-bar">共 <span id="quick-filter-count">${registered.length}</span> 条线索</div><p class="shortcut-rule">规则：登记时间按首次录入时间计算，后续分配、跟进或转化不改变；日期区间包含起止两天，快捷筛选按自然日计算。姓名／电话、登记时间、当前阶段、意向度同时筛选时取交集；已报名线索的意向度显示为“已报名”。</p></div>`;
}
function shortcutIntent(lead){if(lead.stage==='已报名')return '已报名';return {'冷意向':'低意向','温意向':'中意向','热意向':'高意向'}[lead.intent]||lead.intent||'未标记'}
function shortcutSetDate(){const from=$('#quick-date-from').value,to=$('#quick-date-to').value;if(from&&to&&from>to){toast('开始日期不能晚于结束日期');return}shortcutFilter.from=from;shortcutFilter.to=to;shortcutFilter.preset='';document.querySelectorAll('.shortcut-presets .btn').forEach(e=>e.classList.remove('selected'));shortcutApplyFilters()}
function shortcutPreset(key){const days={today:0,yesterday:1,'7':6,'30':29,'90':89}[key];shortcutFilter.from=shortcutDayOffset(days);shortcutFilter.to=shortcutDayOffset(key==='yesterday'?1:0);shortcutFilter.preset=key;shortcutRender()}
function shortcutMatchDate(createdAt,from,to){const date=(createdAt||'').slice(0,10);return (!from||date>=from)&&(!to||date<=to)}
function shortcutMatchFilters(record){const search=shortcutFilter.search.trim().toLowerCase();return (!search||record.search.toLowerCase().includes(search))&&shortcutMatchDate(record.created,shortcutFilter.from,shortcutFilter.to)&&(!shortcutFilter.stage||record.stage===shortcutFilter.stage)&&(!shortcutFilter.intent||record.intent===shortcutFilter.intent)}
function shortcutApplyFilters(){shortcutSyncFilterButton();let count=0;document.querySelectorAll('.quick-lead-table tbody tr').forEach(row=>{const found=shortcutMatchFilters(row.dataset);row.hidden=!found;if(found)count++});const label=$('#quick-filter-count');if(label)label.textContent=count}

function shortcutFilterCount(){return Number(!!(shortcutFilter.from||shortcutFilter.to))+Number(!!shortcutFilter.stage)+Number(!!shortcutFilter.intent)}
function shortcutFilterDescription(){const count=shortcutFilterCount();return '筛选线索'+(count?'，已启用 '+count+' 项条件':'')}
function shortcutSyncFilterButton(){const button=$('#quick-filter-toggle'),badge=$('#quick-filter-badge');if(button){button.classList.toggle('is-filtered',shortcutFilterCount()>0);button.setAttribute('aria-label',shortcutFilterDescription());button.title=shortcutFilterDescription()}if(badge){badge.hidden=!shortcutFilterCount();badge.textContent=shortcutFilterCount()}}
function shortcutToggleFilters(){shortcutFiltersOpen=!shortcutFiltersOpen;const panel=$('#quick-filter-panel'),button=$('#quick-filter-toggle');if(panel)panel.hidden=!shortcutFiltersOpen;if(button){button.setAttribute('aria-expanded',String(shortcutFiltersOpen));if(!shortcutFiltersOpen)button.focus?.()}}
function shortcutClearFilters(){Object.assign(shortcutFilter,{from:'',to:'',preset:'',stage:'',intent:''});shortcutRender()}
