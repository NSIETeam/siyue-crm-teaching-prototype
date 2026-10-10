// 用户已明确的教学、财务中心导航。待业务参考补充后再细化页面。
const structurePages={learningActive:'在读学生',learningHistory:'历史学生',learningData:'数据管理',financeRefunds:'退转记录',financeArrears:'欠费记录',financeConsumption:'课消记录',financeReceipts:'收款设置'};
const structurePreviousRender=render,structurePreviousAcademicRender=academicRender;
render=function(){if(structurePages[state.page])structureRender();else structurePreviousRender()};
academicRender=function(){
  structurePreviousAcademicRender();
  if(state.page==='orders'){
    document.querySelectorAll('[data-nav-toggle]').forEach(e=>e.classList.remove('active-parent'));
    document.querySelector('[data-nav-toggle="finance"]').classList.add('active-parent');
    $('#crumb').textContent='财务中心 / 收费订单';
  }
};
function structureRender(){
  const page=state.page,learning=page.startsWith('learning');
  document.querySelectorAll('.menu-item').forEach(e=>e.classList.toggle('active',e.dataset.page===page));
  document.querySelectorAll('[data-nav-toggle]').forEach(e=>e.classList.remove('active-parent'));
  document.querySelector(`[data-nav-toggle="${learning?'learning':'finance'}"]`).classList.add('active-parent');
  $('#crumb').textContent=(learning?'教学':'财务中心')+' / '+structurePages[page];
  $('#view').innerHTML=({learningActive:()=>learningStudentsPage('在读'),learningHistory:()=>learningStudentsPage('历史'),learningData:learningDataPage,financeRefunds:financeRefundsPage,financeArrears:financeArrearsPage,financeConsumption:financeConsumptionPage,financeReceipts:financeReceiptsPage})[page]();
}
function learningStudentsPage(status){
  const list=a.students.map((s,index)=>({...s,index})).filter(s=>s.status===status);
  return heading(status==='在读'?'在读学生':'历史学生',`按学生当前状态查看${status}档案`)+`<div class="structure-summary"><div class="card"><strong>${list.length}</strong><span>${status}学生</span></div></div><div class="card pad"><div class="toolbar"><div class="toolbar-left"><input class="input" style="width:250px" placeholder="搜索学生姓名、电话或ID" oninput="filterRows(this.value)">${aSelect('learning-campus',['城中校区','园区校区'],'全部校区')}</div></div>${aTable(['学生ID','学生姓名','联系电话','所属校区','学生状态','在读班级','操作'],list.map(s=>`<tr><td>${esc(s.id)}</td><td>${esc(s.name)}</td><td>${esc(s.phone)}</td><td>${esc(s.campus)}</td><td>${esc(s.status)}</td><td>${esc(s.className)}</td><td><button class="btn small" onclick="a.selectedStudent=${s.index};nav('studentDetail')">查看档案</button></td></tr>`))}<div class="data-bar">共 ${list.length} 条学生</div></div>`;
}
function structureEmpty(title,description,headers){return heading(title,description)+`<div class="card pad"><p class="structure-note">当前仅确定页面入口，字段和业务规则待参考资料补充。</p>${aTable(headers,[])}<div class="data-bar">暂无记录</div></div>`}
function learningDataPage(){return heading('数据管理','教学数据的管理入口')+`<div class="card pad"><p class="structure-note">已预留数据管理页面；导入、导出、统计口径及权限规则待你提供参考资料后设计。</p><div class="empty">待补充教学数据管理的字段、操作和参考页面</div></div>`}
function financeRefundsPage(){return structureEmpty('退转记录','查看退课、退班、转课和转班产生的财务记录',['业务单号','学生','业务类型','原课程 / 班级','目标课程 / 班级','金额','办理时间','状态'])}
function financeArrearsPage(){const unpaid=a.orders.filter(o=>money(o.amount)>money(o.paid));return heading('欠费记录','根据已有收费订单展示未收金额')+`<div class="structure-summary"><div class="card"><strong>${unpaid.length}</strong><span>欠费订单</span></div><div class="card"><strong>¥${unpaid.reduce((sum,o)=>sum+money(o.amount)-money(o.paid),0).toFixed(2)}</strong><span>待收金额</span></div></div><div class="card pad">${aTable(['订单编号','学生','课程','订单金额','已收金额','待收金额','订单状态'],unpaid.map(o=>`<tr><td>${esc(o.id)}</td><td>${esc(o.student)}</td><td>${esc(o.product)}</td><td>${esc(o.amount)}</td><td>${esc(o.paid)}</td><td>¥${(money(o.amount)-money(o.paid)).toFixed(2)}</td><td>${esc(o.status)}</td></tr>`))}<div class="data-bar">共 ${unpaid.length} 条欠费订单</div></div>`}
function money(value){return Number(String(value).replace(/[^\d.]/g,''))||0}
function financeConsumptionPage(){return structureEmpty('课消记录','查看课程消课产生的记录',['学生','课程 / 班级','讲次','课消时间','课消数量','课消金额','状态'])}
function financeReceiptsPage(){return heading('收款设置','配置机构收款主体和支付方式')+`<div class="card pad"><p class="structure-note">当前仅确定“收款设置”入口。收款主体绑定、账户字段和支付渠道规则待参考资料补充。</p><div class="empty">待补充收款设置的字段和操作流程</div></div>`}
