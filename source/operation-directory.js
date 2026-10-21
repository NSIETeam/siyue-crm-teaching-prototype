/* Register deep links alongside workflow actions; searches never submit changes. */
function commandOpenPolicy(){nav('leadManage');const panel=document.querySelector('.workflow-policy-settings');if(panel){panel.open=true;panel.scrollIntoView?.({block:'nearest'});panel.querySelector('summary')?.focus?.()}}
function commandSystemTab(key){sysTab=key;nav('system')}
function commandScheduleView(view){workflowState.scheduleView=view;['teacher','student','room'].forEach(k=>workflowState[k]='');nav('schedule')}
const extraCommands=[
 ['线索保留与回收策略设置','线索保留 回收策略 保留策略 公海规则 回收规则 线索回收设置 个人保留天数 首次跟进时限','leadManage','policy',commandOpenPolicy,'展开设置，修改后另行确认发布'],
 ...Object.entries(sysTabs).map(([key,label])=>[label+'设置',label+' '+({org:'机构名称 机构地址',attendance:'请假消课 旷课消课 考勤修改期限',move:'调课提前时间 跨校区调课设置',transfer:'跨校区转班设置 转班开关',entry:'中途插班 新报名开关'}[key]),'system',null,()=>commandSystemTab(key),'打开对应配置标签']),
 ...[['teacher','老师课表','教师课表 老师排课 毛毛虫课表'],['student','学生课表','个人课表 学生毛毛虫'],['room','教室课表','教室占用 空闲教室'],['campus','校区课表','校区排课']].map(([view,label,words])=>[label,words,'schedule',null,()=>commandScheduleView(view),'切换课表视角后筛选对象和日期']),
 ['创建校区','新增校区 添加校区','campus','campus',()=>{nav('campus');state.mode='form';state.campusEdit=null;render()}],
 ...['学科','学期','年级','班型'].map(tab=>[tab+'配置',tab+'设置 '+tab+'字典','teaching',null,()=>{nav('teaching');state.tab=tab;state.editing=false;render()}]),
 ['创建营销表单','新建表单 获客表单 扫码填表 线索采集表','marketingForms','marketingForms',()=>mfNew()],
 ['创建资料领取表单','资料下载 资料领取 下载登记','marketingForms','marketingForms',()=>mfNewDownload()],
 ['创建拼团活动','双人同行 拼团优惠 新建拼团','mallGroup','mallGroup',()=>mallNew('group')],
 ['创建联报活动','多科联报 联报优惠 新建联报','mallJoint','mallJoint',()=>mallNew('joint')],
 ['课程上下架管理','上架课程 下架课程 发布商品 商品管理','mallShelf','mallShelf',()=>nav('mallShelf'),'选择课程后再确认上下架'],
 ['查看待收款订单','收款确认 到账确认 扫码收款 支付订单','orders',null,()=>nav('orders'),'进入订单列表选择具体订单'],
 ['查看待退款记录','退款确认 财务退款 退费记录','financeRefunds',null,()=>nav('financeRefunds')],
 ['查看欠费记录','催缴 欠款 未缴费 待收学费','financeArrears',null,()=>nav('financeArrears')],
 ['员工身份与职位设置','员工身份 身份设置 职位授权 角色设置','positions',null,()=>nav('positions')],
 ['查看权限变更日志','授权记录 权限日志','permissionLogs',null,()=>nav('permissionLogs')]
];
extraCommands.forEach(([label,words,page,guard,run,hint])=>{if(!commandWorkflows.some(x=>x.label===label))commandWorkflows.push({label,words:words.split(' '),page,guard,run,hint:hint||'打开对应功能'})});
// This command previously opened only a list, despite saying "create".
const createOfferCommand=commandWorkflows.find(x=>x.label==='创建优惠策略');if(createOfferCommand){createOfferCommand.run=()=>mallNew('coupon');createOfferCommand.words.push('老带新优惠','续费优惠','新建优惠券')}
const operationSvgPaths={view:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',edit:'<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="8" cy="18" r="2" fill="currentColor"/>',enroll:'<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 9"/>',archive:'<path d="M4 4h16l1 4H3l1-4ZM4 8v12h16V8m-12 4h8"/>',phone:'<path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 3a14 14 0 0 1-7-7l3-2-3-6Z"/>',wechat:'<path d="M12 4c-4.4 0-8 2.8-8 6.3 0 1.9 1.1 3.6 2.9 4.8L6 18l3.5-1.4c.8.2 1.6.3 2.5.3h.5"/><path d="M14 12c-3.3 0-6 2.1-6 4.7s2.7 4.8 6 4.8c.7 0 1.4-.1 2-.3l3 1.1-.8-2.3c1.1-.8 1.8-2 1.8-3.3 0-2.6-2.7-4.7-6-4.7Z"/><path d="M8 9h.01M13 9h.01m-.5 6h.01m4 0h.01"/>',record:'<path d="M6 3h9l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M8 12h8m-8 4h8"/>',transfer:'<path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4 4-4-4 4-4"/>',release:'<path d="M4 8h6l2 2h8v9H4V8Z"/><path d="M12 14h6m-3-3 3 3-3 3"/>'};
function operationSvg(kind){return `<svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${operationSvgPaths[kind]}</svg>`}
function operationCompactButtons(html){return html.replace(/<button\b([^>]*)>(详情|查看|编辑|课次操作|线索详情)<\/button>/g,(whole,attrs,label)=>{if(/aria-label=|title=/.test(attrs))return whole;const kind=label==='编辑'?'edit':label==='课次操作'?'calendar':'view';attrs=/class="/.test(attrs)?attrs.replace(/class="/, 'class="operation-icon '):attrs+' class="operation-icon"';return `<button${attrs} title="${label}" aria-label="${label}">${operationSvg(kind)}</button>`})}
const operationTable=aTable;aTable=function(headers,rows){return operationCompactButtons(operationTable(headers,rows))};
const operationLeadManagePage=leadManagePage;leadManagePage=function(){return operationLeadManagePage().replace('<summary>线索保留与回收策略设置</summary>',`<summary>${operationSvg('settings')}<span>线索保留与回收策略设置</span></summary>`)};
const operationLeadDetailPage=leadDetailPage;
const leadActionIcons={'转交同事':'transfer','释放到公海':'release','下次跟进':'calendar','转报名':'enroll','归档线索':'archive','电话呼叫':'phone','企微沟通':'wechat','沟通记录':'record'};
leadDetailPage=function(){return operationLeadDetailPage().replace(/(<button\b[^>]*>)(?:[◷✓▣☎◈♩♪]\s*)?(转交同事|释放到公海|下次跟进|转报名|归档线索|电话呼叫|企微沟通|沟通记录)(<\/button>)/g,(_,open,label,close)=>`${open}${operationSvg(leadActionIcons[label])}<span>${label}</span>${close}`)};
