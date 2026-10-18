/* Opt-in Java CRM workspace. The server remains the source of identity, scope, and CRM facts. */
(function (root) {
  'use strict';
  if (!root.SIYUE_JAVA_AUTH_MODE) return;

  const javaState = { client: null, auth: null, identity: null, page: 'home', view: 'mine',
    list: null, listTitle: '', listQuery: {}, customerSearchDraft: null, resourceSearch: null, queueContext: {}, pageNumber: 1, selectedFormId: '', reportFrom: '', reportUntil: '',
    importInput: null, importPreview: null, importReceipt: null, importIdempotencyKey: '', importBusy: false, importUncertain: false,
    taskBatchReceipt: null, taskBatchForm: null, taskBatchDraft: null, taskBatchPreview: null, taskBatchStale: false,
    taskBatchIdempotencyKey: null, taskBatchBusy: false, taskBatchUncertain: false,
    activityDraft: null, activityCreateInput: null, activityCreateKey: null, activityCreateBusy: false, activityCreateUncertain: false,
    activityDetail: null, taskDetail: null, attributionDetail: null, attributionRequestPage: 1,
    routingRulePage: 1, routingQueuePage: 1,
    customerDetail: null, customerContactMutation: null, customerStudentMutation: null, customerStudentFormOpen: false, ticketTypes: [], ticketTypeError: '', ticketDetail: null,
    needDetail: null, transactionDetail: null, opportunityDetail: null, leadDetail: null, routingPreview: null, routingSelection: new Map(),
    savedViews: [], selectedSavedViewId: '', savedViewsError: '', busy: false, accessDenied: false, error: '' };
  const view = document.getElementById('view');
  const title = document.getElementById('crumb');
  const academicPages = new Map((root.siyueJavaAcademic?.pages || []).map(page => [page.id, page]));
  const commercePages = new Map((root.siyueJavaCommerce?.pages || []).map(page => [page.id, page]));
  const needPages = new Map([...(root.SiyueCrmNeeds?.pages || []), ...(root.SiyueCrmTaskRouting?.pages || [])].map(page => [page.id, page]));
  let academicWorkspace = null;
  let commerceWorkspace = null;
  let workTabs = null, activeWorkKey = null, navigationEpoch = 0, loginEpoch = 0, pendingWrites = 0;
  let tabRestoring = false, directorySequence = 0, workbenchSequence = 0;
  let workspaceBlockMessage = '';
  let resourceSearchDraft = { searchType: 'name', query: '' }, resourceSearchError = '', resourceSearchSequence = 0;
  const workspaceBlockMessages = new Set(['当前提交结果尚未确认，请在原页使用原请求重试确认后再切换或关闭。', '正在提交，请等待结果后再切换或关闭。']);
  const workSessions = new Map();
  const stateKeys = Object.keys(javaState).filter(key => !['client', 'auth', 'identity', 'busy'].includes(key));
  const emptyState = Object.fromEntries(stateKeys.map(key => [key, javaState[key]]));
  const pageWorkKey = page => `java:page:${page}`;
  const leadWorkKey = id => `java:lead:${id}`;
  const opportunityWorkKey = id => `java:opportunity:${id}`;
  const activityWorkKey = id => `java:activity:${id}`;
  const taskWorkKey = id => `java:task:${id}`;
  const staleWorkspace = () => Object.assign(new Error('工作页已切换'), { staleWorkspace: true });
  const isStaleWorkspace = error => error?.staleWorkspace === true;

  // API callbacks from an old workspace must never populate the newly selected tab.
  function guardedApi(api) {
    const readMethods = new Set(['me', 'list', 'get', 'events', 'workbench', 'cashFlow', 'receipts', 'principals',
      'submissions', 'activityForms', 'rules', 'simulate', 'preview', 'queue', 'batches', 'previewBatch',
      'customerStudents', 'audience', 'assignees', 'context', 'opportunities', 'types', 'requestsForOrder', 'adjustmentsForOrder',
      'students', 'existing', 'options', 'optionsFor', 'consultations', 'nameIndexStatus', 'numberIndexStatus',
      'supervisors', 'globalTasks', 'globalEmployees', 'employees', 'previewCreate', 'previewAllocation', 'previewRecall', 'previewTransfer', 'previewSchedule', 'previewCancel']);
    return Object.fromEntries(Object.entries(api).map(([name, value]) => {
      if (name === 'academic') return [name, value]; // Academic owns its own request lifecycle.
      if (value && typeof value === 'object') return [name, guardedApi(value)];
      if (typeof value !== 'function') return [name, value];
      return [name, async (...args) => {
        const epoch = navigationEpoch, session = loginEpoch;
        const writes = !readMethods.has(name);
        if (writes) pendingWrites++;
        try {
          const result = await value.apply(api, args);
          if (epoch !== navigationEpoch || session !== loginEpoch) throw staleWorkspace();
          return result;
        } catch (error) {
          if (epoch !== navigationEpoch || session !== loginEpoch) throw staleWorkspace();
          throw error;
        } finally { if (writes && session === loginEpoch) pendingWrites--; }
      }];
    }));
  }
  function stateSnapshot() {
    return Object.fromEntries(stateKeys.map(key => [key, javaState[key]]));
  }
  function newPageSnapshot(page) {
    const data = { ...emptyState, page, listQuery: {}, routingSelection: new Map(), savedViews: [],
      queueContext: page === 'leadTodo' ? null : page === 'myLeads' ? { ownerId: javaState.identity.principalId } : {} };
    if (page === 'crmReports') {
      const today = new Date(); data.reportFrom = localDateTime(today);
      today.setDate(today.getDate() + 1); data.reportUntil = localDateTime(today);
    }
    return data;
  }
  function sessionDirty(data) {
    return !!(data.needDetail?.module.isDirty() || data.activityDetail?.selection?.size || data.activityDraft?.dirty || data.activityCreateUncertain || data.taskDetail?.draftChanged || data.taskDetail?.review || data.leadDetail?.draftChanged || data.opportunityDetail?.draftChanged || data.transactionDetail?.draftChanged || data.transactionDetail?.review && !data.transactionDetail?.completed || data.taskBatchForm || (data.importInput && !data.importReceipt));
  }
  function syncWorkTab() {
    if (!workTabs || !activeWorkKey) return;
    const detail = javaState.leadDetail;
    const opportunity = javaState.opportunityDetail?.opportunity;
    workTabs.upsert({ key: activeWorkKey, title: javaState.needDetail ? javaState.needDetail.module.title() : javaState.activityDetail ? `活动名单 · ${javaState.activityDetail.activity.title}` : javaState.taskDetail ? `任务 · ${javaState.taskDetail.data?.task?.title || javaState.taskDetail.id}` : javaState.transactionDetail ? `${salesTitles[javaState.transactionDetail.kind]} · ${javaState.transactionDetail.record.id}` : detail ? `线索 · ${detail.lead.title || detail.lead.id}` : opportunity ? `商机 · ${opportunity.title || opportunity.id}` : javaState.resourceSearch ? `资源检索 · ${javaState.resourceSearch.label}` : supported.get(javaState.page),
      closable: activeWorkKey !== pageWorkKey('home'), dirty: sessionDirty(javaState) }, { active: false });
  }
  function saveWorkSession() {
    if (!workTabs || !activeWorkKey) return;
    workSessions.set(activeWorkKey, { data: stateSnapshot(), scrollY: root.scrollY || 0 });
    syncWorkTab();
  }
  function clearWorkspaceBlock() {
    if (workspaceBlockMessage) { workTabs?.setMessage(''); workspaceBlockMessage = ''; }
    for (const holder of [javaState, javaState.leadDetail, javaState.opportunityDetail, javaState.transactionDetail, javaState.taskDetail]) {
      if (holder && workspaceBlockMessages.has(holder.error)) holder.error = '';
    }
  }
  function canLeaveWorkspace() {
    if (academicPages.has(javaState.page) && academicWorkspace?.canLeave?.() === false) return false;
    if (commercePages.has(javaState.page) && commerceWorkspace?.canLeave?.() === false) return false;
    if (javaState.needDetail?.module.canLeave() === false) {
      workspaceBlockMessage = '当前提交结果尚未确认，请在原页使用原请求重试确认后再切换或关闭。';
      workTabs?.setMessage(workspaceBlockMessage); javaState.error = workspaceBlockMessage; render(); return false;
    }
    const uncertain = taskDetailLocked() || leadIsLocked() || opportunityIsLocked() || salesIsLocked() || javaState.importUncertain
      || javaState.activityCreateUncertain || (javaState.taskBatchIdempotencyKey && !javaState.taskBatchStale);
    if (pendingWrites || javaState.importBusy || javaState.activityCreateBusy || javaState.taskBatchBusy || uncertain) {
      const message = uncertain ? '当前提交结果尚未确认，请在原页使用原请求重试确认后再切换或关闭。' : '正在提交，请等待结果后再切换或关闭。';
      workspaceBlockMessage = message; workTabs?.setMessage(message);
      if (javaState.taskDetail) javaState.taskDetail.error = message;
      else if (javaState.transactionDetail) javaState.transactionDetail.error = message;
      else if (javaState.leadDetail) javaState.leadDetail.error = message;
      else if (javaState.opportunityDetail) javaState.opportunityDetail.error = message;
      else javaState.error = message;
      render(); return false;
    }
    if (!workTabs && javaState.transactionDetail && sessionDirty(javaState) && !root.confirm('此办理页有未保存的内容。确认离开并放弃吗？')) return false;
    return true;
  }
  async function activateWorkSession(key) {
    if ((key === activeWorkKey && !javaState.accessDenied) || !workSessions.has(key) || !javaState.identity) return;
    if (!canLeaveWorkspace()) return;
    saveWorkSession(); leaveNeedWorkspace();
    const target = workSessions.get(key), epoch = ++navigationEpoch;
    activeWorkKey = key; Object.assign(javaState, target.data);
    state.page = javaState.page; tabRestoring = true;
    syncWorkTab(); workTabs.setActive(key); clearWorkspaceBlock(); render(); root.SiyueNavigation?.sync();
    try {
      const identity = await javaState.client.identity.me();
      if (epoch !== navigationEpoch) return;
      if (identity.principalId !== javaState.identity.principalId) throw new Error('登录身份已经变化，请退出后重新登录。');
      javaState.identity = identity;
      configureMenu(new Set(identity.permissions || []));
      if ((pagePermissions.get(javaState.page) || []).some(code => !identity.permissions?.includes(code)) || needPages.get(javaState.page)?.scope === 'all' && identity.scope !== 'all') throw new Error('当前账号已没有访问此工作页的权限。');
      javaState.error = ''; javaState.accessDenied = false;
      if (javaState.taskBatchForm) {
        const form = javaState.taskBatchForm;
        if (!identity.permissions?.includes('crm.task.write')) throw new Error('当前账号已没有任务创建权限，草稿暂不可查看。');
        if (form.assignees) { form.assignees.busy = false; form.assignees.generation++; }
        if (form.picker) { form.picker.busy = false; form.picker.sequence = (form.picker.sequence || 0) + 1; }
        for (const target of form.targets) { target.studentLoading = false; target.studentSequence++; }
      }
      // Nested directories have no isolated detail contract yet: reload their authorized parent list.
      javaState.customerDetail = null; javaState.ticketDetail = null; javaState.attributionDetail = null;
      if (javaState.needDetail) {
        await javaState.needDetail.module.restore(null, identity);
      } else if (needPages.has(javaState.page)) {
        javaState.needDetail = makeNeedDetail({ mode: needMode(javaState.page), origin: { key: pageWorkKey('home'), page: 'home' } });
        await javaState.needDetail.module.open(javaState.needDetail.route);
      } else if (javaState.activityDetail) {
        javaState.activityDetail.busy = false;
        await loadActivityAudience(javaState.activityDetail);
      } else if (javaState.taskDetail) {
        javaState.taskDetail.loading = false;
        await refreshTaskDetail(javaState.taskDetail);
      } else if (javaState.transactionDetail) {
        javaState.transactionDetail.loading = false;
        await refreshSalesTransaction();
      } else if (javaState.leadDetail) {
        javaState.leadDetail.loading = false;
        await refreshLeadDetail();
      } else if (javaState.opportunityDetail) {
        javaState.opportunityDetail.loading = false;
        await refreshOpportunityDetail();
      } else if (javaState.page === 'home') await loadWorkbench();
      else if (javaState.page !== 'crmImports') await loadDirectory(javaState.page, javaState.listQuery, javaState.pageNumber);
    } catch (error) {
      if (isStaleWorkspace(error) || epoch !== navigationEpoch) return;
      javaState.accessDenied = true; javaState.error = error.message || '工作页权限核对失败，请重新选择页签重试。';
    } finally {
      if (epoch === navigationEpoch) {
        tabRestoring = false; render(); syncWorkTab();
        root.scrollTo?.(0, target.scrollY || 0);
      }
    }
  }
  async function closeWorkSession(key) {
    if (key === pageWorkKey('home') || !workSessions.has(key) || !canLeaveWorkspace()) return;
    if (key === activeWorkKey) saveWorkSession();
    const target = workSessions.get(key);
    if (sessionDirty(target.data) && !root.confirm('此工作页有未保存的内容。确认关闭并放弃这些内容吗？')) return;
    if (key === activeWorkKey) {
      const keys = [...workSessions.keys()], index = keys.indexOf(key);
      const nextKey = keys[index - 1] || keys[index + 1] || pageWorkKey('home');
      await activateWorkSession(nextKey);
      if (activeWorkKey === key) return;
    }
    target.data.needDetail?.module.dispose();
    workSessions.delete(key); workTabs.remove(key);
  }
  function resetWorkSessions() {
    for (const session of workSessions.values()) session.data.needDetail?.module.dispose();
    javaState.needDetail?.module.dispose(); javaState.needDetail = null;
    navigationEpoch++; loginEpoch++; pendingWrites = 0; tabRestoring = false;
    activeWorkKey = null; workSessions.clear(); workTabs?.reset(); workspaceBlockMessage = '';
  }

  const supported = new Map([
    ['home', '工作台'], ['crmCustomers', '客户档案'], ['crmCampaigns', '获客活动'],
    ['marketingForms', '表单管理'], ['formSubmissions', '提交审核'], ['crmImports', '批量导入'], ['crmReports', '经营报表'],
    ['leadTodo', '今日待办'], ['myLeads', '我的线索'], ['leadManage', '线索管理'],
    ['crmOpportunities', '销售机会'], ['crmAttribution', '业绩归因'],
    ['crmTasks', '任务中心'], ['crmTaskBatches', '任务批次'], ['crmServices', '服务工单'],
    ['orders', '收费订单'], ['crmRouting', '分配规则'], ['permissions', '员工与权限']
  ]);
  const pagePermissions = new Map([
    ['crmCustomers', ['crm.customer.read']], ['crmCampaigns', ['crm.activity.read']],
    ['marketingForms', ['crm.form.read']], ['formSubmissions', ['crm.form.read', 'crm.form.submission.read']],
    ['crmImports', ['crm.customer.read', 'crm.customer.write', 'crm.lead.read', 'crm.lead.write', 'crm.touchpoint.write']],
    ['crmReports', ['report.read']],
    ['leadTodo', ['crm.lead.read']], ['myLeads', ['crm.lead.read']], ['leadManage', ['crm.lead.read']],
    ['crmOpportunities', ['crm.opportunity.read']], ['crmAttribution', ['crm.order.read']], ['crmTasks', ['crm.task.read']],
    ['crmTaskBatches', ['crm.task.read']], ['crmServices', ['crm.ticket.read']], ['orders', ['crm.order.read']],
    ['crmRouting', ['crm.lead.assign', 'crm.lead.read']], ['permissions', ['system.access.manage']]
  ]);
  for (const page of academicPages.values()) {
    supported.set(page.id, page.title);
    pagePermissions.set(page.id, page.permissions);
  }
  for (const page of commercePages.values()) {
    supported.set(page.id, page.title);
    pagePermissions.set(page.id, [page.permission]);
  }
  for (const page of needPages.values()) { supported.set(page.id, page.title); pagePermissions.set(page.id, page.permissions); }
  const accessPermissionCatalog = [
    'attendance.manage', 'attendance.read', 'audit.read', 'class.assign', 'class.read', 'class.write', 'commerce.read', 'commerce.manage', 'course.read', 'course.write',
    'crm.activity.read', 'crm.activity.write', 'crm.attribution.correct.request', 'crm.attribution.correct.review',
    'crm.customer.read', 'crm.customer.write', 'crm.customer.identity.write', 'crm.customer.search.manage', 'crm.form.publish', 'crm.form.read', 'crm.form.submission.read',
    'crm.form.submission.review', 'crm.form.write', 'crm.lead.assign', 'crm.lead.follow', 'crm.lead.policy.manage',
    'crm.lead.read', 'crm.lead.write', 'crm.opportunity.read', 'crm.opportunity.write', 'crm.opportunity.intake', 'crm.opportunity.assign', 'crm.opportunity.config.manage', 'crm.order.read', 'crm.order.write',
    'crm.receipt.record', 'crm.refund.approve', 'crm.refund.read', 'crm.refund.record', 'crm.refund.request',
    'crm.task.assign', 'crm.task.manage', 'crm.task.read', 'crm.task.write', 'crm.ticket.assign', 'crm.ticket.read', 'crm.ticket.type.manage',
    'crm.ticket.write', 'crm.touchpoint.read', 'crm.touchpoint.write', 'enrollment.manage', 'report.read', 'session.move',
    'student.communicate', 'student.communication.read', 'student.read', 'student.write'
  ];
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  function configureMenu(permissions = new Set()) {
    for (const item of document.querySelectorAll('.sidebar-menu .menu-item[data-page]')) {
      const required = pagePermissions.get(item.dataset.page) || [];
      item.hidden = !supported.has(item.dataset.page) || required.some(permission => !permissions.has(permission)) || needPages.get(item.dataset.page)?.scope === 'all' && javaState.identity?.scope !== 'all';
    }
    for (const group of document.querySelectorAll('.sidebar-menu .nav-toggle[data-nav-toggle]')) {
      const children = document.getElementById(group.getAttribute('aria-controls'));
      const hasItems = children && [...children.querySelectorAll('.menu-item[data-page]')].some(item => !item.hidden);
      group.hidden = !hasItems;
      if (!hasItems) group.setAttribute('aria-expanded', 'false');
      if (children) children.hidden = !hasItems || group.getAttribute('aria-expanded') !== 'true';
    }
    document.querySelectorAll('.sidebar-menu .nav-children').forEach(panel => {
      const hasItems = [...panel.querySelectorAll('.menu-item[data-page]')].some(item => !item.hidden);
      if (!hasItems) panel.hidden = true;
    });
    const menu = document.querySelector('.sidebar-menu');
    menu?.addEventListener('click', event => {
      const item = event.target.closest('.menu-item[data-page]');
      if (!item || item.hidden) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openPage(item.dataset.page);
    }, true);
  }

  function needMode(page) { return page === 'crmTaskRouting' ? 'taskRouting' : page === 'crmCustomerSearchMaintenance' ? 'searchMaintenance' : page === 'crmNeedConfiguration' ? 'configuration' : page === 'crmNeedNotifications' ? 'notifications' : 'intake'; }
  function leaveNeedWorkspace() {
    javaState.needDetail?.module.suspend();
    if (!workTabs) javaState.needDetail?.module.dispose();
    javaState.needDetail = null;
  }
  function makeNeedDetail(route) {
    const routing = route.workspace === 'taskRouting' || route.mode === 'taskRouting';
    if (routing) route = { ...route, workspace: 'taskRouting', mode: route.mode === 'taskRouting' ? 'list' : route.mode };
    const detail = { route, module: null };
    detail.module = (routing ? root.SiyueCrmTaskRouting : root.SiyueCrmNeeds).create({ api: javaState.client.crm, identity: javaState.identity,
      render: () => { if (javaState.needDetail === detail) { if (detail.module.canLeave()) clearWorkspaceBlock(); render(); } },
      onChange: syncWorkTab,
      onOpenOpportunity: id => openOpportunityDetail(id, { page: 'crmOpportunities', listQuery: {}, pageNumber: 1, size: 1, ids: [id], exactOpportunityId: id, returnWorkKey: activeWorkKey, scrollY: 0 }),
      onOpenIdentifiers: target => openNeedWorkspace({ mode: 'identifiers', ...target }),
      onOpenBatch: target => openTaskRoutingWorkspace({ mode: 'batch', ...target }),
      onOpenTask: id => openTaskDetail(id),
      onReturn: () => returnNeedWorkspace(detail) });
    return detail;
  }
  async function returnNeedWorkspace(detail) {
    if (javaState.needDetail !== detail || !canLeaveWorkspace()) return;
    const origin = detail.route.origin;
    if (workTabs && origin?.key && workSessions.has(origin.key)) return activateWorkSession(origin.key);
    return openPage(origin?.page || 'crmCustomers');
  }
  async function openNeedWorkspace(route) {
    if (!root.SiyueCrmNeeds || !javaState.identity || !canLeaveWorkspace()) return;
    const permissions = route.mode === 'identifiers' ? ['crm.customer.read'] : route.mode === 'searchMaintenance' ? ['crm.customer.search.manage'] : route.mode === 'profile' ? ['crm.opportunity.read'] : route.mode === 'configuration' ? ['crm.opportunity.config.manage'] : route.mode === 'notifications' ? ['crm.opportunity.read'] : ['crm.opportunity.intake', 'crm.customer.read'];
    if (permissions.some(code => !javaState.identity.permissions.includes(code)) || route.mode === 'identifiers' && !javaState.identity.permissions.includes('crm.opportunity.intake') && !javaState.identity.permissions.includes('student.read') || route.mode === 'searchMaintenance' && javaState.identity.scope !== 'all') { javaState.error = '当前账号没有接待或需求办理权限。'; render(); return; }
    const page = route.mode === 'identifiers' ? 'crmCustomers' : route.mode === 'searchMaintenance' ? 'crmCustomerSearchMaintenance' : route.mode === 'profile' ? 'crmOpportunities' : route.mode === 'configuration' ? 'crmNeedConfiguration' : route.mode === 'notifications' ? 'crmNeedNotifications' : 'crmNeedIntake';
    const key = route.mode === 'identifiers' ? `java:need:identifiers:${route.customerId}:${route.studentId}` : route.mode === 'profile' ? `java:need:profile:${route.opportunityId}` : route.mode === 'intake' && (route.sourceLeadId || route.customerId || route.register) ? `java:need:intake:${route.sourceLeadId || route.customerId || 'register'}` : pageWorkKey(page);
    if (workTabs && workSessions.has(key)) return activateWorkSession(key);
    const origin = route.origin || { key: activeWorkKey, page: javaState.page, query: { ...javaState.listQuery }, pageNumber: javaState.pageNumber };
    saveWorkSession(); leaveNeedWorkspace(); navigationEpoch++;
    Object.assign(javaState, newPageSnapshot(page)); javaState.needDetail = makeNeedDetail({ ...route, origin });
    const detail = javaState.needDetail;
    activeWorkKey = workTabs ? key : null; state.page = page; javaState.error = '';
    if (workTabs) { saveWorkSession(); workTabs.setActive(key); }
    render(); root.SiyueNavigation?.sync();
    try { await detail.module.open(detail.route); }
    catch (error) { if (!isStaleWorkspace(error) && javaState.needDetail === detail) { javaState.error = error.message || '需求工作页打开失败'; render(); } }
  }

  async function openTaskRoutingWorkspace(route) {
    if (!root.SiyueCrmTaskRouting || !javaState.identity || !canLeaveWorkspace()) return;
    const required = route.mode === 'create' ? ['crm.task.write', 'crm.task.assign', 'crm.activity.read', 'crm.customer.read'] : ['crm.task.read', 'crm.task.manage'];
    if (required.some(code => !javaState.identity.permissions.includes(code))) { javaState.error = '当前账号没有发起或管理营销任务的权限。'; render(); return; }
    const page = route.mode === 'create' ? 'crmCampaigns' : 'crmTaskRouting';
    const key = route.mode === 'create' ? `java:task-routing:create:${idempotencyKey()}` : route.batchId ? `java:task-routing:batch:${route.batchId}` : pageWorkKey(page);
    if (workTabs && workSessions.has(key)) {
      const existing = workSessions.get(key).data.needDetail;
      if (route.tab && existing?.module.isDirty()) { javaState.error = '该批次已有选择或未保存草稿，请先打开已有页签继续处理。'; render(); return; }
      if (route.tab && existing) existing.route = { ...existing.route, ...route, workspace: 'taskRouting' };
      await activateWorkSession(key);
      if (route.tab && javaState.needDetail === existing && !javaState.accessDenied) await existing.module.open(existing.route);
      return;
    }
    const origin = route.origin || { key: activeWorkKey, page: javaState.page, query: { ...javaState.listQuery }, pageNumber: javaState.pageNumber };
    saveWorkSession(); leaveNeedWorkspace(); navigationEpoch++;
    Object.assign(javaState, newPageSnapshot(page)); state.page = page;
    javaState.needDetail = makeNeedDetail({ ...route, workspace: 'taskRouting', origin }); const detail = javaState.needDetail;
    activeWorkKey = workTabs ? key : null; javaState.error = '';
    if (workTabs) { saveWorkSession(); workTabs.setActive(key); }
    render(); root.SiyueNavigation?.sync();
    try { await detail.module.open(detail.route); }
    catch (error) { if (!isStaleWorkspace(error) && javaState.needDetail === detail) { javaState.error = error.message || '任务工作页打开失败'; render(); } }
  }

  function openPage(page, overrides = null) {
    if (!overrides && !javaState.accessDenied && javaState.page === page && !javaState.leadDetail && !javaState.opportunityDetail && !javaState.transactionDetail && !javaState.activityDetail && !javaState.taskDetail && !javaState.needDetail && (academicPages.has(page) || commercePages.has(page) || (workTabs && activeWorkKey === pageWorkKey(page)))) return;
    if (!canLeaveWorkspace()) return;
    if (leadIsLocked()) { javaState.leadDetail.error = '当前提交尚未确认，请先完成原记录的重试确认。'; render(); return; }
    if (!supported.has(page) || !javaState.identity) return;
    const required = pagePermissions.get(page) || [];
    if (needPages.get(page)?.scope === 'all' && javaState.identity.scope !== 'all') { javaState.error = '此维护页仅限明确授权的全局管理员。'; render(); return; }
    const permissions = new Set(javaState.identity.permissions || []);
    if (required.some(permission => !permissions.has(permission))) {
      javaState.error = '当前账号没有访问此页面的权限。';
      render();
      return;
    }
    if (workTabs && !academicPages.has(page) && !commercePages.has(page)) {
      const key = pageWorkKey(page);
      if (!workSessions.has(key)) workSessions.set(key, { data: newPageSnapshot(page), scrollY: 0 });
      if (overrides) {
        if (key === activeWorkKey) saveWorkSession();
        Object.assign(workSessions.get(key).data, overrides);
        if (key === activeWorkKey) activeWorkKey = null;
      }
      return activateWorkSession(key);
    }
    saveWorkSession(); leaveNeedWorkspace(); navigationEpoch++; tabRestoring = false; activeWorkKey = null; workTabs?.setActive(null);
    javaState.accessDenied = false;
    javaState.error = '';
    javaState.page = page;
    javaState.list = null;
    javaState.listQuery = {};
    javaState.customerSearchDraft = null;
    javaState.queueContext = page === 'leadTodo' ? null
      : page === 'myLeads' ? { ownerId: javaState.identity.principalId } : {};
    javaState.pageNumber = 1;
    javaState.savedViews = [];
    javaState.selectedSavedViewId = '';
    javaState.savedViewsError = '';
    javaState.customerDetail = null;
    javaState.ticketDetail = null;
    javaState.transactionDetail = null; javaState.opportunityDetail = null; javaState.activityDetail = null; javaState.taskDetail = null;
    javaState.leadDetail = null;
    javaState.attributionDetail = null;
    javaState.routingPreview = null;
    javaState.routingSelection = new Map();
    if (page === 'crmRouting') { javaState.routingRulePage = 1; javaState.routingQueuePage = 1; }
    if (!['crmTasks', 'crmTaskBatches'].includes(page)) {
      javaState.taskBatchForm = null;
      javaState.taskBatchBusy = false;
      javaState.taskBatchDraft = null;
      javaState.taskBatchPreview = null;
      javaState.taskBatchIdempotencyKey = null;
    }
    if (page === 'crmReports' && !javaState.reportFrom) {
      const today = new Date();
      javaState.reportFrom = localDateTime(today);
      today.setDate(today.getDate() + 1);
      javaState.reportUntil = localDateTime(today);
    }
    if (overrides) Object.assign(javaState, overrides);
    state.page = page;
    if (needPages.has(page)) {
      javaState.needDetail = makeNeedDetail({ mode: needMode(page), origin: { key: pageWorkKey('home'), page: 'home' } });
      void javaState.needDetail.module.open(javaState.needDetail.route); root.SiyueNavigation?.sync(); return;
    }
    if (academicPages.has(page) && academicWorkspace) {
      void academicWorkspace.open(page);
      root.SiyueNavigation?.sync();
      return;
    }
    if (commercePages.has(page) && commerceWorkspace) {
      void commerceWorkspace.open(page);
      root.SiyueNavigation?.sync();
      return;
    }
    render();
    root.SiyueNavigation?.sync();
    if (page === 'crmImports') {
      if (javaState.importBusy || javaState.importUncertain) return;
      javaState.importInput = null;
      javaState.importPreview = null;
      javaState.importReceipt = null;
      javaState.importIdempotencyKey = '';
    } else if (page === 'home') void loadWorkbench();
    else if (page === 'leadTodo' && !overrides) void loadTodayQueue();
    else void loadDirectory(page, javaState.listQuery, javaState.pageNumber);
  }

  function gate(message = '') {
    resetWorkSessions();
    resourceSearchDraft = { searchType: 'name', query: '' }; resourceSearchError = '';
    syncResourceSearch(true);
    document.documentElement.classList.add('employee-auth-locked');
    view.innerHTML = '';
    let panel = document.getElementById('employee-auth-gate');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'employee-auth-gate';
      document.body.append(panel);
    }
    panel.innerHTML = `<div class="employee-auth-card"><img src="assets/siyue-peiyou-logo.png" alt="思跃培优" onerror="this.hidden=true"><h1>员工登录</h1><p>使用机构分配的员工账号访问 CRM。</p><p class="employee-auth-error" role="alert">${escapeHtml(message)}</p><button class="btn primary" id="java-crm-login" ${javaState.busy ? 'disabled' : ''}>${javaState.busy ? '正在连接…' : '使用机构账号登录'}</button><p class="help">登录由机构身份服务验证，数据权限由思跃服务端确认。</p></div>`;
    panel.querySelector('#java-crm-login').addEventListener('click', signIn);
  }

  async function signIn() {
    if (javaState.busy) return;
    javaState.busy = true;
    gate('');
    try {
      const java = await root.siyueJavaApiClient.createFromOidc({ baseUrl: '/crm-api/v2/' });
      javaState.auth = java.auth;
      javaState.client = guardedApi(java.api);
      if (java.identity) {
        javaState.identity = java.identity;
        restoreJavaReturnPath(java.callback);
        await enterWorkspace();
      } else {
        await java.signIn({ returnTo: `${location.pathname}?java-crm=1` });
      }
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      javaState.busy = false;
      gate(error.message || '登录服务暂不可用，请稍后重试。');
    }
  }

  function restoreJavaReturnPath(callback) {
    if (typeof callback?.returnTo !== 'string') return;
    try {
      const current = new URL(location.href), target = new URL(callback.returnTo, current.origin);
      if (target.origin !== current.origin || !['/crm/', '/crm/index.html'].includes(target.pathname)
          || target.searchParams.get('java-crm') !== '1') return;
      for (const name of ['code', 'state', 'error', 'error_description', 'iss', 'session_state']) target.searchParams.delete(name);
      root.history?.replaceState?.(root.history.state, '', `${target.pathname}${target.search}${target.hash}`);
    } catch { /* An invalid return path must not redirect a successfully verified identity. */ }
  }

  async function enterWorkspace() {
    javaState.busy = false;
    academicWorkspace?.dispose();
    commerceWorkspace?.dispose();
    const identity = javaState.identity, session = loginEpoch;
    academicWorkspace = root.siyueJavaAcademic?.create({ api: javaState.client.academic,
      identity, render: () => {
        if (loginEpoch === session && javaState.identity && academicPages.has(javaState.page)) render();
      } }) || null;
    commerceWorkspace = root.siyueJavaCommerce?.create({ api: javaState.client, identity,
      render: () => { if (loginEpoch === session && javaState.identity && commercePages.has(javaState.page)) render(); } }) || null;
    document.getElementById('employee-auth-gate')?.remove();
    document.documentElement.classList.remove('employee-auth-locked');
    configureMenu(new Set(javaState.identity.permissions || []));
    root.document.querySelector('.topbar .user').innerHTML = `<span>${escapeHtml(javaState.identity.displayName || javaState.identity.name || javaState.identity.principalId || '员工')}</span><button class="btn small" id="java-crm-logout">退出</button>`;
    document.getElementById('java-crm-logout').addEventListener('click', () => {
      academicWorkspace?.dispose();
      academicWorkspace = null;
      commerceWorkspace?.dispose();
      commerceWorkspace = null;
      javaState.auth?.signOut();
      javaState.transactionDetail = null; javaState.opportunityDetail = null; javaState.leadDetail = null;
      javaState.client = null;
      javaState.identity = null;
      javaState.taskBatchForm = null; javaState.taskBatchDraft = null; javaState.taskBatchPreview = null;
      javaState.taskBatchReceipt = null; javaState.taskBatchIdempotencyKey = null; javaState.taskBatchBusy = false;
      gate();
    });
    state.page = 'home';
    Object.assign(javaState, newPageSnapshot('home'));
    workTabs = root.SiyueWorkTabs?.create({ onActivate: activateWorkSession, onClose: closeWorkSession }) || null;
    if (workTabs) {
      activeWorkKey = pageWorkKey('home'); saveWorkSession(); workTabs.setActive(activeWorkKey);
    }
    render();
    root.SiyueNavigation?.sync();
    await loadWorkbench();
  }

  async function loadWorkbench() {
    const sequence = ++workbenchSequence;
    try {
      const result = await javaState.client.crm.workbench({ view: javaState.view });
      if (sequence !== workbenchSequence) return;
      javaState.list = result;
      javaState.error = '';
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (sequence !== workbenchSequence) return;
      javaState.error = error.message || '工作台加载失败';
    }
    render();
  }

  function leadQueueContext(query) {
    // Preserve the selected person/team and time window while editable filters change.
    return Object.fromEntries(['ownerId', 'campusId', 'nextFollowFrom', 'nextFollowUntil', 'unassignedOnly']
      .filter(key => query[key] !== undefined).map(key => [key, query[key]]));
  }

  async function loadTodayQueue(query = {}, pageNumber = 1) {
    try {
      const work = await javaState.client.crm.workbench({ view: 'mine' });
      if (javaState.page !== 'leadTodo') return;
      const today = work.cards?.find(card => card.key === 'dueToday');
      if (!today?.filters?.ownerId || !today.filters.nextFollowFrom || !today.filters.nextFollowUntil) {
        throw new Error('今日待办范围暂不可用，请刷新后重试。');
      }
      javaState.queueContext = leadQueueContext(today.filters);
      await loadDirectory('leadTodo', { ...today.filters, ...query }, pageNumber);
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (javaState.page !== 'leadTodo') return;
      javaState.error = error.message || '今日待办加载失败';
      render();
    }
  }

  async function loadTicketTypes() {
    javaState.ticketTypes = [];
    javaState.ticketTypeError = '';
    if (!javaState.identity.permissions?.includes('crm.ticket.type.manage')) return;
    try {
      const campusIds = javaState.identity.scope === 'all' ? [null] : javaState.identity.campusIds || [];
      const lists = await Promise.all(campusIds.map(campusId => javaState.client.crm.serviceTickets.types({
        ...(campusId ? { campusId } : {}), includeInactive: true
      })));
      javaState.ticketTypes = [...new Map(lists.flat().map(type => [type.id, type])).values()];
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      javaState.ticketTypeError = error.message || '工单类型目录加载失败'; }
  }

  function savedViewResourceForPage(page) {
    if (['leadTodo', 'myLeads', 'leadManage'].includes(page)) return 'leads';
    if (page === 'crmTasks') return 'tasks';
    if (page === 'crmTaskBatches') return 'taskBatches';
    if (page === 'crmOpportunities') return 'opportunities';
    if (page === 'crmServices') return 'serviceTickets';
    return null;
  }

  async function loadSavedViews(page, sequence = directorySequence) {
    const epoch = navigationEpoch;
    const resourceType = savedViewResourceForPage(page);
    if (!resourceType) { javaState.savedViews = []; return; }
    try {
      const result = await javaState.client.crm.savedViews.list(resourceType);
      if (sequence !== directorySequence || epoch !== navigationEpoch) return;
      javaState.savedViews = result;
      javaState.savedViewsError = '';
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (sequence !== directorySequence || epoch !== navigationEpoch) return;
      javaState.savedViews = [];
      javaState.savedViewsError = error.message || '个人视图暂不可用';
    }
  }

  function customerSearchTypes() {
    const permissions = javaState.identity?.permissions || [], rows = [['name', '姓名'], ['phone', '电话']];
    if (permissions.includes('crm.opportunity.intake') || permissions.includes('student.read')) rows.push(['student_number', '学号'], ['student_id', '学生系统编号']);
    if (permissions.includes('crm.opportunity.read')) rows.push(['opportunity_id', '商机编码']);
    if (permissions.includes('crm.lead.read')) rows.push(['lead_id', '线索编码']);
    return [...rows, ['email', '邮箱'], ['customer_id', '客户编号']];
  }
  function syncResourceSearch(forceHidden = false) {
    const form = document.getElementById('java-crm-resource-search');
    if (!form) return;
    const allowed = javaState.identity?.permissions?.includes('crm.customer.read');
    form.hidden = forceHidden || !allowed || javaState.page === 'home';
    const select = document.getElementById('java-crm-resource-type'), input = document.getElementById('java-crm-resource-query');
    const feedback = document.getElementById('java-crm-resource-error'), submit = document.getElementById('java-crm-resource-submit');
    if (!select || !input || !feedback || !submit) return;
    const choices = allowed ? customerSearchTypes() : [], available = choices.some(([value]) => value === resourceSearchDraft.searchType);
    const options = `${available ? '' : '<option value="" selected disabled>请重新选择检索方式</option>'}${choices.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}`;
    if (select.innerHTML !== options) select.innerHTML = options;
    select.value = available ? resourceSearchDraft.searchType : '';
    if (input.value !== resourceSearchDraft.query) input.value = resourceSearchDraft.query;
    submit.disabled = tabRestoring;
    feedback.textContent = resourceSearchError; feedback.hidden = !resourceSearchError;
  }
  function installResourceSearch() {
    const form = document.getElementById('java-crm-resource-search');
    if (!form) return;
    const capture = () => {
      resourceSearchDraft = { searchType: document.getElementById('java-crm-resource-type')?.value || '', query: document.getElementById('java-crm-resource-query')?.value || '' };
    };
    form.addEventListener('input', () => { capture(); resourceSearchError = ''; });
    form.addEventListener('change', capture);
    form.addEventListener('submit', async event => {
      event.preventDefault(); capture();
      if (!javaState.identity || javaState.page === 'home' || tabRestoring) return;
      if (!canLeaveWorkspace()) return;
      if (javaState.customerContactMutation?.key) { resourceSearchError = '当前联系方式提交结果尚未确认，请先在原客户页核对。'; syncResourceSearch(); return; }
      const choice = customerSearchTypes().find(([value]) => value === resourceSearchDraft.searchType);
      if (!javaState.identity.permissions?.includes('crm.customer.read') || !choice) { resourceSearchError = '当前账号没有使用此检索方式的权限，请重新选择。'; syncResourceSearch(); return; }
      if (!workTabs) { resourceSearchError = '工作页签未加载，请刷新后再进行资源检索。'; syncResourceSearch(); return; }
      const query = resourceSearchDraft.query.trim() ? resourceSearchDraft.query : '';
      const searchType = choice[0], key = `java:customer-search:${++resourceSearchSequence}`;
      const data = { ...newPageSnapshot('crmCustomers'), resourceSearch: { label: choice[1] },
        listQuery: { searchType, ...(query ? { query } : {}) }, customerSearchDraft: { searchType, query }, pageNumber: 1 };
      resourceSearchError = '';
      workSessions.set(key, { data, scrollY: 0 });
      await activateWorkSession(key);
    });
  }
  function customerSearchControls() {
    const draft = javaState.customerSearchDraft || { searchType: javaState.listQuery.searchType || 'name', query: javaState.listQuery.query || '' }, choices = customerSearchTypes();
    const unavailable = !choices.some(([value]) => value === draft.searchType);
    const applied = javaState.listQuery.query ? `${choices.find(([value]) => value === javaState.listQuery.searchType)?.[1] || '原检索方式'}：${javaState.listQuery.query}（精确匹配）` : '当前范围客户（未按身份条件过滤）';
    return `<form id="java-crm-customer-search" class="filters"><select class="select" name="searchType" aria-label="检索方式">${unavailable ? '<option value="" selected disabled>原检索方式已无权限，请重新选择</option>' : ''}${choices.map(([value, label]) => `<option value="${value}"${draft.searchType === value ? ' selected' : ''}>${label}</option>`).join('')}</select><input class="input" name="query" maxlength="254" aria-label="检索内容（精确匹配）" placeholder="输入所选身份信息" value="${escapeHtml(draft.query)}"><button class="btn primary" type="submit">搜索</button></form><p class="help">学号为已备案的真实业务学号；学生系统编号另选。${escapeHtml(applied)} · 总数按客户去重</p>`;
  }
  async function loadDirectory(page, query = {}, pageNumber = 1) {
    if (page === 'crmCustomers') {
      query = { ...query, searchType: query.searchType || 'name' };
      javaState.customerSearchDraft ||= { searchType: query.searchType, query: query.query || '' };
    }
    if (page === 'leadTodo' && javaState.queueContext === null) return loadTodayQueue(query, pageNumber);
    if (['leadTodo', 'myLeads', 'leadManage'].includes(page)) query = { ...query, ...javaState.queueContext };
    if (['crmTasks', 'crmTaskBatches'].includes(page)) query = { ...query, ...Object.fromEntries(Object.entries(javaState.queueContext || {}).filter(([key]) => ['batchId', 'activityId'].includes(key))) };
    const sequence = ++directorySequence, epoch = navigationEpoch;
    javaState.list = null;
    javaState.listQuery = query;
    javaState.pageNumber = pageNumber;
    javaState.customerDetail = null;
    render();
    try {
      const api = javaState.client.crm;
      if (page === 'crmCustomers' && query.query && !customerSearchTypes().some(([value]) => value === query.searchType)) throw new Error('当前账号没有使用此检索方式的权限，请重新选择。');
      const result = page === 'permissions' ? await javaState.client.system.access.principals({ page: pageNumber, size: 50 })
        : page === 'crmCustomers' ? await api.customers.list({ page: pageNumber, size: 50, ...query, searchType: query.query ? query.searchType : 'auto' })
        : page === 'crmCampaigns' ? await api.activities.list({ page: pageNumber, size: 50, ...query })
        : page === 'marketingForms' ? await api.forms.list({ page: pageNumber, size: 50, ...query })
        : page === 'formSubmissions' && javaState.selectedFormId ? await api.forms.submissions(javaState.selectedFormId, { page: pageNumber, size: 50, ...query })
        : page === 'formSubmissions' ? await api.forms.list({ page: pageNumber, size: 50 })
        : page === 'crmReports' ? await api.reports.cashFlow({
          fromAt: toJavaInstant(javaState.reportFrom), untilAt: toJavaInstant(javaState.reportUntil), page: pageNumber, size: 50
        })
        : ['orders', 'crmAttribution'].includes(page) ? await api.orders.list({ page: pageNumber, size: 50, ...query })
        : page === 'crmRouting' ? await Promise.all([
          api.leadRouting.rules({ page: javaState.routingRulePage, size: 50 }),
          api.leadRouting.queue(javaState.routingQueuePage, 50)
        ]).then(([rules, queue]) => ({ rules, queue }))
        : page === 'crmOpportunities' ? await api.opportunities.list({ page: pageNumber, size: 50, ...query })
        : page === 'crmTaskBatches' ? await api.tasks.batches({ page: pageNumber, size: 50, ...query })
        : page === 'crmTasks' ? await api.tasks.list({ page: pageNumber, size: 50, ...query })
        : page === 'crmServices' ? await api.serviceTickets.list({ page: pageNumber, size: 50, ...query })
        : await api.leads.list({ page: pageNumber, size: 50, activeOnly: query.status === 'archived' ? false : true, ...query });
      if (sequence !== directorySequence || epoch !== navigationEpoch) return;
      javaState.list = result;
      javaState.error = '';
      await loadSavedViews(page, sequence);
      if (sequence !== directorySequence || epoch !== navigationEpoch) return;
      if (page === 'crmServices') await loadTicketTypes();
      else { javaState.ticketTypes = []; javaState.ticketTypeError = ''; }
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (sequence !== directorySequence || epoch !== navigationEpoch) return;
      javaState.list = null;
      javaState.error = error.message || '清单加载失败';
    }
    render();
  }

  function workbench() {
    const data = javaState.list;
    const cards = data?.cards || [];
    return `<div class="heading"><div><h1>工作台</h1><p class="subtitle">待办数据来自 Java 服务端，按当前账号的数据范围统计。</p></div><div class="toolbar-right"><label for="java-crm-scope">查看范围</label><select class="select" id="java-crm-scope" style="width:auto"><option value="mine" ${javaState.view === 'mine' ? 'selected' : ''}>我的工作</option><option value="scope" ${javaState.view === 'scope' ? 'selected' : ''}>我的管理范围</option></select></div></div>
      ${javaState.error ? `<p class="notice" role="alert">${escapeHtml(javaState.error)}</p>` : ''}
      <div class="card pad"><div class="toolbar"><h2 class="section-title">跟进待办</h2><span class="muted">统计日期：${escapeHtml(data?.date || '加载中')}</span></div><div class="java-crm-cards">${cards.map(card => `<button class="card pad java-crm-count" data-card="${escapeHtml(card.key)}"><span>${escapeHtml(card.label)}</span><strong>${Number(card.count) || 0}</strong></button>`).join('') || '<div class="empty">正在读取服务端统计…</div>'}</div><p class="help">更新时间：${escapeHtml(data?.generatedAt || '—')} · 点击数字查看对应线索清单</p></div>`;
  }

  const columns = {
    crmCustomers: [['displayName', '客户'], ['campusId', '校区'], ['ownerId', '负责人']],
    crmCampaigns: [['title', '活动'], ['campusId', '校区'], ['activityType', '类型'], ['status', '状态'], ['startsAt', '开始时间'], ['endsAt', '结束时间'], ['participantIds', '参与员工'], ['promoterIds', '推广员工']],
    marketingForms: [['title', '表单'], ['formKind', '类型'], ['status', '状态'], ['currentRevision', '版本']],
    formSubmissions: [['submittedAt', '提交时间'], ['status', '审核状态'], ['formId', '表单编号'], ['leadId', '线索编号']],
    crmOpportunities: [['title', '商机'], ['subject', '学科'], ['stage', '阶段'], ['ownerId', '负责人']],
    orders: [['id', '订单'], ['opportunityId', '商机'], ['customerId', '客户'], ['attributedOwnerId', '成交归属'], ['totalAmount', '应收'], ['receivedAmount', '实收'], ['refundedAmount', '退款'], ['status', '状态']],
    crmTasks: [['title', '任务'], ['customerId', '客户'], ['studentId', '学生编号'], ['identityStatus', '学生身份'], ['subject', '学科'], ['term', '学期'], ['taskType', '类型'], ['status', '状态'], ['ownerId', '负责人']],
    crmTaskBatches: [['title', '批次'], ['taskType', '任务类型'], ['serviceType', '服务事项'], ['campusId', '校区'], ['dueAt', '截止时间'], ['status', '状态'], ['createdCount', '任务数'], ['skippedCount', '跳过数'], ['openCount', '未完成'], ['completedCount', '已完成']],
    crmServices: [['title', '工单'], ['status', '状态'], ['ownerId', '负责人']],
    accessPrincipals: [['principalId', '员工编号'], ['scope', '数据范围'], ['campusIds', '授权校区'], ['permissionCodes', '角色权限'], ['active', '账号状态']],
    crmLeads: [['title', '线索'], ['source', '来源'], ['status', '状态'], ['ownerId', '负责人'], ['nextFollowAt', '下次跟进']]
  };

  function directoryCellValue(page, key, value) {
    let labels;
    if (['crmTasks', 'crmTaskBatches'].includes(page)) {
      if (key === 'taskType') labels = { marketing: '营销初筛', service: '客户服务' };
      if (key === 'status') labels = { pending: '待办理', in_progress: '处理中', active: '进行中', completed: '已完成', cancelled: '已取消' };
    } else if (page === 'crmCampaigns') {
      if (key === 'activityType') labels = { event: '活动', campaign: '推广活动', referral: '转介绍', other: '其他' };
      if (key === 'status') labels = { active: '进行中', closed: '已结束' };
    } else if (page === 'crmOpportunities' && key === 'stage') labels = opportunityStages;
    if (labels && Object.hasOwn(labels, value)) return labels[value];
    if (key === 'identityStatus') return taskIdentityLabel(value);
    return Array.isArray(value) ? value.join('、') : value ?? '—';
  }

  function queueFilterFields(resourceType) {
    const choices = values => [['', '全部'], ...values];
    if (resourceType === 'leads') return [
      ['status', '线索状态', choices([['new', '待初筛'], ['contacting', '跟进中'], ['qualified', '有效需求'],
        ['no_need', '无需求'], ['unreachable', '未联系上'], ['invalid_contact', '联系方式无效'], ['archived', '已归档']])],
      ['customerId', '客户编号'], ['activityId', '活动编号']
    ];
    if (['tasks', 'taskBatches'].includes(resourceType)) return [
      ['status', '状态', choices(resourceType === 'tasks'
        ? [['pending', '待办理'], ['in_progress', '处理中'], ['completed', '已完成'], ['cancelled', '已取消']]
        : [['active', '进行中'], ['completed', '已完成'], ['cancelled', '已取消']])],
      ['taskType', '任务类型', choices([['marketing', '营销初筛'], ['service', '客户服务']])]
    ];
    if (resourceType === 'opportunities') return [
      ['stage', '商机阶段', choices([['qualified', '需求确认'], ['appointment', '已预约'], ['trial', '已试听'],
        ['negotiation', '待报名'], ['won', '成交'], ['closed', '已关闭']])],
      ['customerId', '客户编号']
    ];
    if (resourceType === 'serviceTickets') return [
      ['status', '工单状态', choices([['open', '待受理'], ['processing', '处理中'], ['closed', '已办结']])]
    ];
    return [];
  }

  function queueFilterControls(page) {
    const resourceType = savedViewResourceForPage(page);
    if (!resourceType) return '';
    const fields = queueFilterFields(resourceType).map(([key, label, choices]) => choices
      ? `<label>${label}<select class="select" name="${key}">${choices.map(([value, text]) => `<option value="${value}" ${String(javaState.listQuery[key] || '') === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`
      : `<label>${label}<input class="input" name="${key}" maxlength="120" value="${escapeHtml(javaState.listQuery[key] || '')}"></label>`).join('');
    return `<form id="java-crm-queue-filters" class="filters">${fields}<button type="submit" class="btn primary">应用筛选</button>${savedViewToolbar(page)}</form>`;
  }
  function activityFilterControls() {
    const query = javaState.listQuery || {}, campusIds = javaState.identity.campusIds || [];
    return `<form id="java-crm-activity-filters" class="filters"><label>活动范围<select class="select" name="view"><option value="scope" ${query.view !== 'created' && query.view !== 'participating' ? 'selected' : ''}>授权范围</option><option value="created" ${query.view === 'created' ? 'selected' : ''}>我创建的</option><option value="participating" ${query.view === 'participating' ? 'selected' : ''}>我参与的</option></select></label><label>活动类型<select class="select" name="activityType"><option value="">全部类型</option>${[['event','线下活动'],['campaign','推广活动'],['referral','转介绍'],['other','其他']].map(([value,label]) => `<option value="${value}" ${query.activityType === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>状态<select class="select" name="status"><option value="">全部状态</option><option value="active" ${query.status === 'active' ? 'selected' : ''}>进行中</option><option value="closed" ${query.status === 'closed' ? 'selected' : ''}>已结束</option></select></label><label>校区<select class="select" name="campusId"><option value="">授权校区</option>${campusIds.map(id => `<option value="${escapeHtml(id)}" ${query.campusId === id ? 'selected' : ''}>${escapeHtml(id)}</option>`).join('')}</select></label><label>活动名称<input class="input" name="query" maxlength="120" value="${escapeHtml(query.query || '')}" placeholder="搜索活动名称"></label><button class="btn primary" type="submit">筛选</button><button class="btn" id="java-crm-activity-reset" type="button">重置</button></form>`;
  }

  function savedViewToolbar(page) {
    const resourceType = savedViewResourceForPage(page);
    if (!resourceType) return '';
    const selected = javaState.savedViews.find(item => item.id === javaState.selectedSavedViewId);
    return `<div class="sy-saved-filter-tools"><div class="toolbar"><label for="java-crm-saved-view">个人保存视图</label><select class="select" id="java-crm-saved-view"><option value="">选择视图</option>${javaState.savedViews.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === javaState.selectedSavedViewId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select><div class="actions"><button type="button" class="btn" id="java-crm-view-apply" ${selected ? '' : 'disabled'}>应用</button><button type="button" class="btn" id="java-crm-view-save">保存当前筛选</button><button type="button" class="btn" id="java-crm-view-update" ${selected ? '' : 'disabled'}>更新筛选</button><button type="button" class="btn" id="java-crm-view-rename" ${selected ? '' : 'disabled'}>重命名</button><button type="button" class="btn" id="java-crm-view-delete" ${selected ? '' : 'disabled'}>删除</button></div></div>${javaState.savedViewsError ? `<p class="help">${escapeHtml(javaState.savedViewsError)}</p>` : '<p class="help">每个视图只对当前员工可见；筛选条件仍由服务端白名单校验。</p>'}</div>`;
  }

  function currentSavedViewFilters(resourceType) {
    return Object.fromEntries(queueFilterFields(resourceType).map(([key]) => [key,
      String(javaState.listQuery[key] ?? '').trim()]).filter(([, value]) => value));
  }

  function activityDateTimeInput(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  function newActivityDraft() {
    const starts = new Date(); starts.setSeconds(0, 0);
    const ends = new Date(starts.getTime() + 60 * 60 * 1000);
    return { campusId: '', title: '', activityType: 'event', startsAt: activityDateTimeInput(starts),
      endsAt: activityDateTimeInput(ends), description: '', participantIds: '', promoterIds: '', dirty: false };
  }
  function activityCreateForm() {
    const draft = javaState.activityDraft || newActivityDraft();
    const locked = javaState.activityCreateBusy || javaState.activityCreateUncertain;
    const campuses = javaState.identity.campusIds || [];
    const campusField = campuses.length
      ? `<label class="field"><span class="required">校区</span><select class="select" name="campusId" required>${campuses.map(id => `<option value="${escapeHtml(id)}" ${draft.campusId === id ? 'selected' : ''}>${escapeHtml(id)}</option>`).join('')}</select></label>`
      : `<label class="field"><span class="required">校区编号</span><input class="input" name="campusId" maxlength="120" required value="${escapeHtml(draft.campusId)}" placeholder="输入已授权校区编号"></label>`;
    return `<section class="card pad java-crm-activity-create"><div class="toolbar"><h2 class="section-title">活动信息</h2><button class="btn" id="java-crm-activity-cancel" type="button" ${locked ? 'disabled' : ''}>取消</button></div><form id="java-crm-activity-form"><fieldset ${locked ? 'disabled' : ''}><div class="form-grid">${campusField}<label class="field"><span class="required">活动名称</span><input class="input" name="title" maxlength="120" required value="${escapeHtml(draft.title)}" placeholder="例如：秋季体验课开放日"></label><label class="field"><span class="required">活动类型</span><select class="select" name="activityType"><option value="event" ${draft.activityType === 'event' ? 'selected' : ''}>线下活动</option><option value="campaign" ${draft.activityType === 'campaign' ? 'selected' : ''}>推广活动</option><option value="referral" ${draft.activityType === 'referral' ? 'selected' : ''}>转介绍</option><option value="other" ${draft.activityType === 'other' ? 'selected' : ''}>其他</option></select></label><label class="field"><span class="required">开始时间</span><input class="input" type="datetime-local" name="startsAt" required value="${escapeHtml(draft.startsAt)}"></label><label class="field"><span class="required">结束时间</span><input class="input" type="datetime-local" name="endsAt" required value="${escapeHtml(draft.endsAt)}"></label><label class="field full"><span>活动说明</span><textarea class="textarea" name="description" maxlength="2000" placeholder="说明活动目标、适用对象或执行要求">${escapeHtml(draft.description)}</textarea></label><label class="field"><span>参与员工编号</span><textarea class="textarea" name="participantIds" maxlength="5000" placeholder="多个编号用逗号分隔">${escapeHtml(draft.participantIds)}</textarea></label><label class="field"><span>推广员工编号</span><textarea class="textarea" name="promoterIds" maxlength="5000" placeholder="多个编号用逗号分隔">${escapeHtml(draft.promoterIds)}</textarea></label></div></fieldset><p class="help">参与与推广成员在此维护；任务分配时再选择具体接收人。</p><div class="form-actions">${javaState.activityCreateUncertain ? '<button class="btn primary" id="java-crm-activity-retry" type="button">按原请求重试确认</button>' : `<button class="btn primary" id="java-crm-activity-submit" type="submit" ${javaState.activityCreateBusy ? 'disabled' : ''}>${javaState.activityCreateBusy ? '正在创建…' : '创建活动'}</button>`}</div></form></section>`;
  }

  function directory() {
    if (javaState.activityDetail) return activityAudiencePage();
    if (javaState.taskDetail) return taskDetailPage();
    if (javaState.transactionDetail) return salesTransactionPage();
    if (javaState.leadDetail) return leadDetailPage();
    if (javaState.customerDetail) return customerDetailPage();
    if (javaState.opportunityDetail) return opportunityDetailPage();
    if (javaState.ticketDetail) return serviceTicketDetailPage();
    if (javaState.attributionDetail) return attributionDetailPage();
    if (javaState.page === 'crmImports') return importPage();
    const page = javaState.page === 'crmCustomers' ? 'crmCustomers' : javaState.page === 'crmCampaigns' ? 'crmCampaigns'
      : javaState.page === 'marketingForms' ? 'marketingForms' : javaState.page === 'formSubmissions' ? 'formSubmissions'
      : javaState.page === 'crmOpportunities' ? 'crmOpportunities' : javaState.page === 'crmTaskBatches' ? 'crmTaskBatches' : javaState.page === 'crmTasks' ? 'crmTasks'
      : javaState.page === 'crmServices' ? 'crmServices' : javaState.page === 'permissions' ? 'accessPrincipals'
      : ['orders', 'crmAttribution'].includes(javaState.page) ? 'orders' : 'crmLeads';
    const titleText = supported.get(javaState.page);
    if (javaState.page === 'crmReports') return reportsPage();
    if (javaState.page === 'crmRouting') return routingPage();
    if (javaState.page === 'crmAttribution') return attributionPage();
    if (javaState.page === 'formSubmissions' && !javaState.selectedFormId) return formPickerPage();
    const rows = javaState.list?.items || [];
    const fields = columns[page];
    const extraLabels = {
      crmCustomers: '<th>详情</th>', crmCampaigns: '<th>操作</th>', crmLeads: '<th>办理</th>', crmOpportunities: '<th>推进</th>',
      crmTasks: '<th>办理</th>', crmServices: '<th>处理</th>', orders: '<th>收款</th>',
      crmAttribution: '<th>纠错</th>', marketingForms: '<th>提交</th>',
      formSubmissions: '<th>审核内容</th><th>处理</th>'
    };
    if (javaState.page === 'permissions') extraLabels.permissions = '<th>操作</th>';
    const extra = extraLabels[javaState.page] || extraLabels[page] || '';
    const actions = row => {
      if (page === 'marketingForms') return `<td><button class="btn small" data-form-submissions="${escapeHtml(row.id)}">查看提交</button>${row.status === 'draft' && javaState.identity.permissions?.includes('crm.form.write') ? ` <button class="btn small" data-form-edit="${escapeHtml(row.id)}">编辑</button>` : ''}${row.status === 'draft' && javaState.identity.permissions?.includes('crm.form.publish') ? ` <button class="btn small" data-form-publish="${escapeHtml(row.id)}" data-version="${Number(row.version) || 0}">发布</button>` : ''}</td>`;
      if (javaState.page === 'permissions') return `<td>${row.principalId === javaState.identity.principalId ? '本人授权不可自助修改' : `<button class="btn small" data-access-edit="${escapeHtml(row.principalId)}">编辑授权</button>`}</td>`;
      if (page === 'crmCustomers') return `<td><button class="btn small" data-customer-id="${escapeHtml(row.id)}">客户全景</button></td>`;
      if (page === 'crmCampaigns') return `<td>${canReadActivityAudience() ? `<button class="btn small" data-activity-detail="${escapeHtml(row.id)}">活动名单 / 发起任务</button>` : ''}${javaState.identity.permissions?.includes('crm.activity.form.link') ? `<button class="btn small" data-activity-form="${escapeHtml(row.id)}">关联表单</button>` : ''}${row.status === 'active' && javaState.identity.permissions?.includes('crm.activity.write') ? ` <button class="btn small" data-activity-members="${escapeHtml(row.id)}" data-version="${Number(row.version) || 0}" data-participants="${escapeHtml((row.participantIds || []).join(', '))}" data-promoters="${escapeHtml((row.promoterIds || []).join(', '))}">维护成员</button> <button class="btn small" data-activity-close="${escapeHtml(row.id)}" data-version="${Number(row.version) || 0}">结束活动</button>` : '—'}</td>`;
      if (page === 'crmLeads') return `<td><button class="btn small" data-lead-detail="${escapeHtml(row.id)}">${canFollowLead(row) ? '详情与跟进' : '查看详情'}</button></td>`;
      if (page === 'crmOpportunities') return `<td><button class="btn small" data-opportunity-detail="${escapeHtml(row.id)}">详情与跟进</button>${javaState.identity.permissions?.includes('crm.opportunity.write') ? ` <button class="btn small" data-opportunity-stage="${escapeHtml(row.id)}" data-version="${Number(row.version) || 0}">推进阶段</button>` : '—'}${javaState.identity.permissions?.includes('crm.order.write') ? ` <button class="btn small" data-order-create="${escapeHtml(row.id)}" data-version="${Number(row.version) || 0}">生成订单</button>` : ''}</td>`;
      if (javaState.page === 'crmAttribution') return `<td><button class="btn small" data-attribution-order="${escapeHtml(row.id)}">查看归因与申请</button></td>`;
      if (page === 'orders') return `<td>${salesWritable('receipt', row) ? `<button class="btn small" data-order-receipt="${escapeHtml(row.id)}" data-version="${Number(row.version) || 0}">登记实收</button>` : '—'}</td>`;
      if (page === 'crmTasks') return `<td><button class="btn small" data-task-detail="${escapeHtml(row.id)}">详情与办理</button></td>`;
      if (page === 'crmServices') return `<td><button class="btn small" data-ticket-detail="${escapeHtml(row.id)}">处理记录</button>${['closed', 'cancelled'].includes(row.status) ? '' : `${javaState.identity.permissions?.includes('crm.ticket.assign') ? ` <button class="btn small" data-ticket-assign="${escapeHtml(row.id)}" data-version="${Number(row.version) || 0}">转派</button>` : ''}${javaState.identity.permissions?.includes('crm.ticket.write') ? ` <button class="btn small" data-ticket-followup="${escapeHtml(row.id)}" data-version="${Number(row.version) || 0}">记录处理</button> <button class="btn small" data-ticket-close="${escapeHtml(row.id)}" data-version="${Number(row.version) || 0}">办结</button>` : ''}`}</td>`;
      if (page === 'formSubmissions') return `<td><details><summary>查看内容</summary>${Object.entries(row.answers || {}).map(([key, value]) => `<p><strong>${escapeHtml(key)}</strong>：${escapeHtml(Array.isArray(value) ? value.join('、') : value)}</p>`).join('') || '<p>无表单答案</p>'}</details></td><td>${row.status === 'pending' && javaState.identity.permissions?.includes('crm.form.submission.review') ? `<button class="btn small" data-review="approve" data-id="${escapeHtml(row.id)}" data-version="${Number(row.version) || 0}">通过</button> <button class="btn small" data-review="reject" data-id="${escapeHtml(row.id)}" data-version="${Number(row.version) || 0}">驳回</button>` : '—'}</td>`;
      return '';
    };
    const customerFilter = page === 'crmCustomers' ? customerSearchControls() : '';
    const createActivity = page === 'crmCampaigns' && javaState.identity.permissions?.includes('crm.activity.write') ? '<button class="btn primary" id="java-crm-activity-create">新建活动</button>' : '';
    const createForm = page === 'marketingForms' && javaState.identity.permissions?.includes('crm.form.write') ? '<button class="btn primary" id="java-crm-form-create">新建表单</button>' : '';
    const createCustomer = page === 'crmCustomers' && javaState.identity.permissions?.includes('crm.customer.write') ? '<button class="btn primary" id="java-crm-customer-create">新建客户</button>' : '';
    const createTaskBatch = ['crmTasks', 'crmTaskBatches'].includes(page) && javaState.identity.permissions?.includes('crm.task.write') ? `<button class="btn primary" id="java-crm-task-batch-create" ${javaState.taskBatchForm || javaState.taskBatchBusy ? 'disabled' : ''}>新建任务批次</button>` : '';
    const createTicket = page === 'crmServices' && javaState.identity.permissions?.includes('crm.ticket.write')
      && javaState.identity.permissions?.includes('crm.customer.read') ? '<button class="btn primary" id="java-crm-ticket-create">新建工单</button>' : '';
    const createTicketType = page === 'crmServices' && javaState.identity.permissions?.includes('crm.ticket.type.manage')
      ? '<button class="btn" id="java-crm-ticket-type-create">新建工单类型</button>' : '';
    const createPrincipal = javaState.page === 'permissions' ? '<button class="btn primary" id="java-crm-access-create">添加员工账号</button>' : '';
    const batchReceipt = ['crmTasks', 'crmTaskBatches'].includes(page) ? taskBatchReceiptPanel() : '';
    const taskBatchReview = ['crmTasks', 'crmTaskBatches'].includes(page) ? taskBatchPanel() : '';
    const ticketTypePanel = page === 'crmServices' && javaState.identity.permissions?.includes('crm.ticket.type.manage')
      ? `<div class="card pad" style="margin-bottom:18px"><h2 class="section-title">工单类型配置</h2>${javaState.ticketTypeError ? `<p class="notice">${escapeHtml(javaState.ticketTypeError)}</p>` : ''}<div class="table-wrap"><table class="table"><thead><tr><th>名称</th><th>代码</th><th>校区</th><th>状态</th><th>操作</th></tr></thead><tbody>${javaState.ticketTypes.map(type => `<tr><td>${escapeHtml(type.name)}</td><td>${escapeHtml(type.typeCode)}</td><td>${escapeHtml(type.campusId || '全局')}</td><td>${type.active ? '启用' : '停用'}</td><td><button class="btn small" data-ticket-type-edit="${escapeHtml(type.id)}" data-version="${Number(type.version) || 0}" data-name="${escapeHtml(type.name)}" data-active="${Boolean(type.active)}">编辑 / ${type.active ? '停用' : '启用'}</button></td></tr>`).join('') || '<tr><td colspan="5">暂无工单类型</td></tr>'}</tbody></table></div></div>` : '';
    const activityCreatePanel = page === 'crmCampaigns' && javaState.activityDraft ? activityCreateForm() : '';
    return `<div class="heading"><div><h1>${escapeHtml(titleText)}</h1><p class="subtitle">${page === 'crmLeads' ? '查看本人或团队授权队列，记录沟通并安排下一次跟进。' : page === 'crmCampaigns' ? '管理获客活动、参与员工和活动来源；活动任务按活动名单生成并保留来源。' : '数据和权限由 Java 服务端按当前账号范围返回。'}</p></div><div class="actions"><button class="btn" id="java-crm-refresh">刷新</button>${createActivity}${createForm}${createCustomer}${createTaskBatch}${createTicket}${createTicketType}${createPrincipal}${page === 'formSubmissions' ? '<button class="btn" id="java-crm-form-picker">切换表单</button>' : ''}</div></div>${javaState.error ? `<p class="notice" role="alert">${escapeHtml(javaState.error)}</p>` : ''}${activityCreatePanel}${batchReceipt}${taskBatchReview}${['crmTasks', 'crmTaskBatches'].includes(page) && (javaState.listQuery.batchId || javaState.listQuery.activityId) ? `<p class="notice">当前任务范围：${escapeHtml(javaState.listQuery.batchId ? `批次 ${javaState.listQuery.batchId}` : `活动 ${javaState.listQuery.activityId}`)}；筛选和翻页保留此范围。</p>` : ''}${ticketTypePanel}${customerFilter}${page === 'crmCampaigns' ? activityFilterControls() : queueFilterControls(javaState.page)}<div class="card"><div class="table-wrap"><table class="table"><thead><tr>${fields.map(([, label]) => `<th>${label}</th>`).join('')}${extra}</tr></thead><tbody>${rows.map(row => `<tr>${fields.map(([key]) => `<td>${page === 'crmCampaigns' && key === 'title' && canReadActivityAudience() ? `<button class="btn link" data-activity-detail="${escapeHtml(row.id)}">${escapeHtml(row.title || row.id)}</button>` : page === 'crmOpportunities' && key === 'title' ? `<button class="btn link" data-opportunity-detail="${escapeHtml(row.id)}">${escapeHtml(row.title || row.id)}</button>` : page === 'crmLeads' && key === 'title' ? `<button class="btn link" data-lead-detail="${escapeHtml(row.id)}">${escapeHtml(row.title || row.id)}</button>` : escapeHtml(directoryCellValue(page, key, row[key]))}</td>`).join('')}${actions(row)}</tr>`).join('') || `<tr><td colspan="${fields.length + (extra ? (page === 'formSubmissions' ? 2 : 1) : 0)}">${javaState.list ? '当前范围没有记录' : page === 'crmCustomers' && javaState.error ? '检索未完成，请按上方提示处理。' : '正在加载…'}</td></tr>`}</tbody></table></div>${pageControls(javaState.list, rows.length)}</div>`;
  }

  const leadStatuses = { new: '待初筛', contacting: '跟进中', qualified: '有效需求', no_need: '无需求', unreachable: '未联系上', invalid_contact: '联系方式无效', archived: '已归档' };
  const leadChannels = { phone: '电话', wecom: '企微', in_person: '当面沟通', online: '线上咨询', other: '其他' };
  const leadRejections = new Set(['INVALID_INPUT', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'ALREADY_EXISTS', 'IDEMPOTENCY_CONFLICT', 'PREVIEW_STALE', 'RATE_LIMITED']);
  function canFollowLead(lead) {
    const permissions = javaState.identity?.permissions || [];
    return permissions.includes('crm.lead.write') && permissions.includes('crm.customer.read')
      && lead?.ownerId && (lead.ownerId === javaState.identity.principalId || permissions.includes('crm.lead.assign'))
      && lead.status !== 'archived';
  }
  function leadIsLocked(detail = javaState.leadDetail) { return Boolean(detail?.busy || detail?.pending); }
  function leadLocalTime(value) {
    if (!value) return '';
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 16) : '';
  }
  function leadFollowAt(value, original) {
    if (!value) return null;
    // datetime-local displays minutes. Keep the exact server instant when that displayed value is unchanged.
    if (original && value === leadLocalTime(original)) {
      if (new Date(original).getTime() <= Date.now()) throw new Error('下次回访时间须晚于当前时间。');
      return original;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('请填写有效的回访日期和时间。');
    const parsed = new Date(`${value}:00+08:00`);
    if (!Number.isFinite(parsed.getTime()) || leadLocalTime(parsed.toISOString()) !== value) throw new Error('回访日期和时间无效。');
    if (parsed.getTime() <= Date.now()) throw new Error('下次回访时间须晚于当前时间。');
    return parsed.toISOString();
  }
  function leadDraft(lead) {
    return { channel: 'phone', summary: '', nextFollowAt: leadLocalTime(lead.nextFollowAt), qualificationReason: '',
      opportunityTitle: lead.title || '', opportunitySubject: lead.subject || '', opportunityTerm: lead.term || '', opportunityDetail: lead.detail || '' };
  }
  function leadListQuery(context) {
    return { page: context.pageNumber, size: context.size, activeOnly: context.listQuery.status === 'archived' ? false : true,
      ...context.listQuery, ...context.queueContext };
  }
  function leadContext() {
    return { page: javaState.page, listQuery: { ...javaState.listQuery }, queueContext: { ...javaState.queueContext },
      pageNumber: javaState.pageNumber, size: Number(javaState.list?.size) || 50,
      ids: (javaState.list?.items || []).map(row => row.id), scrollY: root.scrollY || 0 };
  }
  async function freshLeadPage(detail) {
    const identity = await javaState.client.identity.me();
    if (javaState.leadDetail !== detail || !javaState.identity) return null;
    if (identity.principalId !== javaState.identity.principalId) throw new Error('登录身份已经变化，请重新登录。');
    javaState.identity = identity;
    if (!['crm.lead.read', 'crm.customer.read'].every(permission => identity.permissions?.includes(permission))) {
      throw new Error('当前账号已没有查看此线索的权限。');
    }
    return javaState.client.crm.leads.list(leadListQuery(detail.context));
  }
  async function leadSupplement(detail) {
    const epoch = navigationEpoch;
    const results = await Promise.allSettled([
      javaState.client.crm.leads.events(detail.lead.id), javaState.client.crm.customers.get(detail.lead.customerId)
    ]);
    if (epoch !== navigationEpoch || javaState.leadDetail !== detail) return;
    detail.events = results[0].status === 'fulfilled' && Array.isArray(results[0].value) ? results[0].value : [];
    detail.eventsError = results[0].status === 'rejected' ? results[0].reason.message || '时间线读取失败，请刷新详情。' : '';
    detail.customer = results[1].status === 'fulfilled' ? results[1].value : null;
    detail.customerError = results[1].status === 'rejected' ? results[1].reason.message || '客户摘要读取失败。' : '';
  }
  async function openLeadDetail(id, context = leadContext()) {
    if (!canLeaveWorkspace()) return;
    if (!context.ids.includes(id)) return;
    if (workTabs) {
      const key = leadWorkKey(id);
      if (workSessions.has(key)) return activateWorkSession(key);
      saveWorkSession(); leaveNeedWorkspace(); navigationEpoch++; activeWorkKey = key;
    }
    const detail = { lead: { id }, context, activeTab: 'follow', draft: {}, events: [], customer: null,
      loading: true, busy: false, pending: null, notice: '', error: '', refreshRequired: false, dirty: false };
    javaState.leadDetail = detail; javaState.error = '';
    if (workTabs) { saveWorkSession(); workSessions.get(activeWorkKey).scrollY = 0; workTabs.setActive(activeWorkKey); root.scrollTo?.(0, 0); }
    render();
    const generation = detail.readGeneration = (detail.readGeneration || 0) + 1;
    try {
      const page = await freshLeadPage(detail);
      if (javaState.leadDetail !== detail || detail.readGeneration !== generation) return;
      const lead = page?.items?.find(row => row.id === id);
      if (!lead) throw new Error('此线索已不在原筛选页或当前授权范围内，请返回列表刷新。');
      detail.lead = lead; detail.draft = leadDraft(lead); detail.draftInitialized = true; detail.draftChanged = false;
      await leadSupplement(detail);
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (javaState.leadDetail === detail) { detail.error = error.message || '线索详情读取失败'; detail.refreshRequired = true; } }
    finally { if (javaState.leadDetail === detail && detail.readGeneration === generation) { detail.loading = false; render(); } }
  }
  async function refreshLeadDetail() {
    const detail = javaState.leadDetail;
    if (!detail || leadIsLocked() || detail.loading) return;
    detail.loading = true; detail.error = ''; render();
    const generation = detail.readGeneration = (detail.readGeneration || 0) + 1;
    try {
      const page = await freshLeadPage(detail);
      if (javaState.leadDetail !== detail || detail.readGeneration !== generation) return;
      const lead = page?.items?.find(row => row.id === detail.lead.id);
      if (!lead) throw new Error('线索已离开原筛选页或授权范围，请返回列表刷新。');
      if (!detail.draftInitialized) { detail.draft = leadDraft(lead); detail.draftInitialized = true; }
      const previousDefault = leadLocalTime(detail.lead.nextFollowAt);
      if (detail.draft.nextFollowAt === previousDefault) detail.draft.nextFollowAt = leadLocalTime(lead.nextFollowAt);
      detail.lead = lead; detail.refreshRequired = false;
      await leadSupplement(detail);
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      detail.error = error.message || '刷新失败'; detail.refreshRequired = true;
      detail.lead = { id: detail.lead.id }; detail.customer = null; detail.events = []; }
    finally { if (javaState.leadDetail === detail && detail.readGeneration === generation) { detail.loading = false; render(); } }
  }
  async function nextLeadDetail(detail) {
    if (javaState.leadDetail !== detail || leadIsLocked()) return;
    detail.loading = true; render();
    const generation = detail.readGeneration = (detail.readGeneration || 0) + 1;
    try {
      const page = await freshLeadPage(detail);
      if (javaState.leadDetail !== detail || detail.readGeneration !== generation) return;
      const visible = new Set((page?.items || []).filter(canFollowLead).map(row => row.id));
      const index = detail.context.ids.indexOf(detail.lead.id);
      const nextId = detail.context.ids.slice(index + 1).find(id => visible.has(id));
      if (!nextId) { detail.notice = '已保存。本页后续没有仍可办理的线索，请返回列表。'; return; }
      detail.loading = false;
      await openLeadDetail(nextId, detail.context);
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      detail.error = `本次已保存，下一条读取失败：${error.message || '请稍后重试'}。`; }
    finally { if (javaState.leadDetail === detail && detail.readGeneration === generation) { detail.loading = false; render(); } }
  }
  function leadDetailPage() {
    const d = javaState.leadDetail, lead = d.lead;
    const locked = leadIsLocked(d), available = !d.loading && !d.refreshRequired && canFollowLead(lead);
    const disabled = locked || !available ? ' disabled' : '';
    const input = (label, name, type = 'text', max = 200) => `<label>${label}<input class="input" name="${name}" type="${type}" maxlength="${max}" value="${escapeHtml(d.draft[name] || '')}"></label>`;
    const recallHelp = lead.nextFollowAt ? '<p class="help">保留原时间即保留现有安排；清空回访时间将取消现有安排。</p>' : '';
    const follow = `<form id="java-crm-lead-followup-form"><fieldset${disabled}><legend>记录本次跟进</legend><div class="form-grid"><label>沟通方式<select class="select" name="channel">${Object.entries(leadChannels).map(([value, label]) => `<option value="${value}"${d.draft.channel === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>${input('下次回访（北京时间，可留空）', 'nextFollowAt', 'datetime-local')}${recallHelp}</div><label>沟通内容<textarea class="textarea" name="summary" required maxlength="2000">${escapeHtml(d.draft.summary || '')}</textarea></label><div class="actions"><button class="btn primary" type="submit" name="action" value="save">保存跟进</button><button class="btn" type="submit" name="action" value="next">保存并处理下一条</button></div></fieldset></form><p class="help">记录沟通事实；下一条仅在进入详情时的本页清单内查找，跳过已转交或不再符合筛选的记录。</p>`;
    const qualified = lead.status === 'qualified';
    const screening = qualified ? `<p class="notice">初筛已确认：有效需求。下一步可建立商机；不会自动记为成交。</p>`
      : `<form id="java-crm-lead-qualify-form"><fieldset${disabled}><legend>确认需求有效</legend><p>确认初筛是独立一步；成功后再填写并建立商机。</p><label>初筛说明<textarea class="textarea" name="qualificationReason" required maxlength="1000">${escapeHtml(d.draft.qualificationReason || '')}</textarea></label>${input('下次回访（北京时间，可留空）', 'nextFollowAt', 'datetime-local')}${recallHelp}<button class="btn primary" type="submit">确认需求有效</button></fieldset></form>`;
    const canCreate = available && (root.SiyueCrmNeeds ? javaState.identity.permissions?.includes('crm.opportunity.intake') && javaState.identity.permissions?.includes('crm.customer.read') : javaState.identity.permissions?.includes('crm.opportunity.write'));
    const opportunity = d.opportunity ? `<p class="notice">商机已建立或复用：${escapeHtml(d.opportunity.id)} · ${escapeHtml(d.opportunity.title)}。同类在途需求会追加到已有商机，并保留其原始来源与负责人。</p>`
      : qualified && canCreate && root.SiyueCrmNeeds ? `<section><h3>第二步：核对需求并建立商机</h3><p>沿用来源线索的客户、孩子与活动；部门、项目和已有需求在接待工作页核对。</p>${javaState.identity.permissions.includes('crm.opportunity.intake') && javaState.identity.permissions.includes('crm.customer.read') ? '<button class="btn primary" id="java-crm-lead-needs" type="button">核对需求并建立商机</button>' : '<p>请由具有接待权限的员工继续办理。</p>'}</section>`
      : qualified && canCreate ? `<form id="java-crm-lead-opportunity-form"><fieldset${locked ? ' disabled' : ''}><legend>第二步：建立商机</legend><p>客户、学生及活动沿用当前来源线索。请核对本次购买需求。</p><div class="form-grid">${input('购买需求名称', 'opportunityTitle')}${input('意向学科／项目', 'opportunitySubject', 'text', 100)}${input('意向学期', 'opportunityTerm', 'text', 100)}</div><label>需求说明<textarea class="textarea" name="opportunityDetail" maxlength="5000">${escapeHtml(d.draft.opportunityDetail || '')}</textarea></label><button class="btn primary" type="submit">确认建立商机</button></fieldset></form>`
        : qualified ? '<p>当前账号没有建立商机的权限，或线索已不在可办理范围。</p>' : '';
    const timeline = d.eventsError ? `<p class="notice" role="alert">${escapeHtml(d.eventsError)}</p>` : `<div class="table-wrap"><table class="table"><thead><tr><th>时间</th><th>事件</th><th>员工</th><th>方式</th><th>状态／归属变化</th><th>内容</th></tr></thead><tbody>${d.events.map(event => `<tr><td>${escapeHtml(leadLocalTime(event.occurredAt).replace('T', ' '))}</td><td>${escapeHtml({ followup: '沟通记录', status: '初筛状态', assigned: '分配', released: '释放', created: '登记' }[event.eventType] || event.eventType)}</td><td>${escapeHtml(event.actorId)}</td><td>${escapeHtml(leadChannels[event.channel] || '—')}</td><td>${escapeHtml([event.fromStatus, event.toStatus].filter(Boolean).map(value => leadStatuses[value] || value).join(' → ') || [event.fromOwnerId, event.toOwnerId].filter(Boolean).join(' → ') || '—')}</td><td>${escapeHtml(event.detail)}</td></tr>`).join('') || '<tr><td colspan="6">暂无跟进记录</td></tr>'}</tbody></table></div><p class="help">按服务端返回的最近事件展示；时间均为北京时间。</p>`;
    const customer = d.customerError ? `<p class="notice">${escapeHtml(d.customerError)}</p>` : `<p>客户：${escapeHtml(d.customer?.displayName || lead.customerId)}</p><p>学生：${escapeHtml(d.customer?.students?.find(student => student.studentId === lead.studentId || student.id === lead.studentId)?.name || lead.studentId || '尚未识别具体学生')}</p><p>来源：${escapeHtml(lead.source)} · 活动 ${escapeHtml(lead.activityId || '未关联')}</p><p>${escapeHtml(lead.detail || '未填写需求说明')}</p>${(d.customer?.contacts || []).map(contact => `<p>${escapeHtml(contact.personRole)} · ${escapeHtml(contact.channel)} · ${escapeHtml(contact.valueMasked)}</p>`).join('')}`;
    const tabs = [{ id: 'follow', label: '跟进', html: follow }, { id: 'screening', label: '初筛与商机', html: screening + opportunity },
      { id: 'timeline', label: '跟进时间线', html: timeline }, { id: 'customer', label: '客户与来源', html: customer }];
    let notice = d.loading ? '正在核对权限并读取线索…' : d.notice;
    if (d.pending?.uncertain) notice = '提交结果暂不明确。内容已锁定，请使用原记录重试确认；请勿刷新页面或另建同一记录。';
    else if (d.busy) notice = '正在提交，请稍候。';
    else if (!available && !d.loading && !d.refreshRequired) notice = lead.ownerId ? '此线索当前仅可查看，跟进需要本人负责或分配权限，以及线索写入权限。' : '公海线索须先分配负责人。';
    const footerHtml = `<button class="btn" id="java-crm-lead-back"${locked || d.loading ? ' disabled' : ''}>返回原列表</button><button class="btn" id="java-crm-lead-refresh"${locked || d.loading ? ' disabled' : ''}>刷新详情</button>${d.pending?.uncertain ? `<button class="btn primary" id="java-crm-lead-retry"${d.busy ? ' disabled' : ''}>用原记录重试确认</button>` : ''}${d.savedFollowup && !locked ? '<button class="btn" id="java-crm-lead-next">处理本页下一条</button>' : ''}`;
    const options = { title: lead.title || '线索详情', recordId: lead.id, status: leadStatuses[lead.status] || '',
      summary: [{ label: '客户', value: d.customer?.displayName || lead.customerId }, { label: '负责人', value: lead.ownerId || '待分配' },
        { label: '校区', value: lead.campusId }, { label: '意向需求', value: [lead.subject, lead.term].filter(Boolean).join(' · ') },
        { label: '下次回访（北京时间）', value: leadLocalTime(lead.nextFollowAt).replace('T', ' ') || '未安排' }], tabs, activeTab: d.activeTab, footerHtml, notice };
    const html = followupLayout(options);
    return `<div id="java-crm-lead-detail">${d.error ? `<p class="notice" role="alert">${escapeHtml(d.error)}</p>` : ''}${html}</div>`;
  }
  function leadReceipt(detail, pending, result) {
    if (!result || typeof result.id !== 'string' || !result.id || result.customerId !== detail.lead.customerId) return false;
    if (pending.kind === 'opportunity') {
      // The server can reuse an active demand with an earlier (or redacted) source lead.
      const sameNeed = field => typeof result[field] === 'string'
        && result[field].trim().toLowerCase() === pending.input[field].trim().toLowerCase();
      return /^[A-Za-z0-9_-]{1,120}$/.test(result.id) && sameNeed('subject') && sameNeed('term')
        && ['qualified', 'appointment', 'trial', 'negotiation'].includes(result.stage)
        && Number.isSafeInteger(result.version) && result.version >= 1;
    }
    return result.id === detail.lead.id && Number.isSafeInteger(result.version) && result.version > pending.input.expectedVersion && Object.prototype.hasOwnProperty.call(leadStatuses, result.status)
      && (pending.kind !== 'qualified' || result.status === 'qualified');
  }
  async function submitLeadStep(detail) {
    if (javaState.leadDetail !== detail || detail.busy || !detail.pending) return;
    const pending = detail.pending;
    detail.busy = true; detail.error = ''; render();
    let result;
    try {
      result = pending.kind === 'followup' ? await javaState.client.crm.leads.followup(detail.lead.id, pending.input, pending.key)
        : pending.kind === 'qualified' ? await javaState.client.crm.leads.updateStatus(detail.lead.id, pending.input, pending.key)
        : await javaState.client.crm.opportunities.create(pending.input, pending.key);
      if (!leadReceipt(detail, pending, result)) throw new Error('未收到可确认的保存回执');
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (javaState.leadDetail !== detail) return;
      const rejected = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && leadRejections.has(error.code);
      if (!pending.uncertain && rejected) {
        detail.pending = null;
        detail.refreshRequired = ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'ALREADY_EXISTS', 'PREVIEW_STALE'].includes(error.code);
        detail.error = `${error.message || '服务端拒绝了本次操作'}${detail.refreshRequired ? '；请刷新详情核对权限、负责人和版本。' : ''}`;
      } else { pending.uncertain = true; detail.error = error.message || '提交结果未确认'; }
      detail.busy = false; render(); return;
    }
    if (javaState.leadDetail !== detail) return;
    clearWorkspaceBlock();
    // A confirmed mutation and a failed history read are distinct outcomes. Never replay the successful step.
    detail.pending = null; detail.busy = false; detail.dirty = true; detail.context.dirty = true; detail.draftChanged = false;
    if (pending.kind === 'opportunity') { detail.opportunity = result; detail.notice = '商机已建立或复用，本次需求已提交。'; }
    else {
      detail.lead = result;
      javaState.list = javaState.list ? { ...javaState.list, items: (javaState.list.items || []).map(row => row.id === result.id ? result : row) } : null;
      if (pending.kind === 'followup') { detail.draft.summary = ''; detail.savedFollowup = true; detail.notice = '跟进已保存。'; }
      else { detail.draft.qualificationReason = ''; detail.notice = '初筛已确认：有效需求。请继续第二步建立商机。'; detail.activeTab = 'screening'; }
      detail.draft.nextFollowAt = leadLocalTime(result.nextFollowAt);
      await leadSupplement(detail);
    }
    const defaults = leadDraft(detail.lead);
    detail.draftChanged = Object.keys(defaults).some(key => detail.draft[key] !== defaults[key]);
    if (pending.kind === 'opportunity') detail.draftChanged = !!detail.draft.summary || !!detail.draft.qualificationReason
      || detail.draft.nextFollowAt !== defaults.nextFollowAt;
    if (pending.next) await nextLeadDetail(detail);
    else if (javaState.leadDetail === detail) render();
  }
  function bindLeadDetail() {
    const detail = javaState.leadDetail;
    if (!detail) return;
    const container = document.getElementById('java-crm-lead-detail');
    bindFollowupTabs(container, detail);
    const updateDraft = (name, value) => {
      if (javaState.leadDetail !== detail || leadIsLocked(detail) || !Object.prototype.hasOwnProperty.call(detail.draft, name)) return;
      if (detail.draft[name] !== String(value)) detail.draftChanged = true;
      detail.draft[name] = String(value);
      syncWorkTab();
      // Both mounted forms share this appointment. Tab switching intentionally does not rebuild their DOM.
      if (name === 'nextFollowAt') document.querySelectorAll('#java-crm-lead-detail [name="nextFollowAt"]').forEach(input => {
        if (input.value !== detail.draft.nextFollowAt) input.value = detail.draft.nextFollowAt;
      });
    };
    const collect = form => new FormData(form).forEach((value, key) => updateDraft(key, value));
    for (const [id, kind] of [['java-crm-lead-followup-form', 'followup'], ['java-crm-lead-qualify-form', 'qualified'], ['java-crm-lead-opportunity-form', 'opportunity']]) {
      const form = document.getElementById(id);
      form?.addEventListener('input', event => updateDraft(event.target.name, event.target.value));
      form?.addEventListener('change', event => updateDraft(event.target.name, event.target.value));
      form?.addEventListener('submit', async event => {
        event.preventDefault();
        if (leadIsLocked(detail) || detail.loading || detail.refreshRequired || !canFollowLead(detail.lead)) return;
        collect(event.currentTarget);
        try {
          const draft = detail.draft;
          let input;
          if (kind === 'followup') {
            if (!leadChannels[draft.channel] || !draft.summary.trim() || draft.summary.trim().length > 2000) throw new Error('请选择沟通方式并填写 2000 字以内的跟进内容。');
            input = { channel: draft.channel, summary: draft.summary.trim(), nextFollowAt: leadFollowAt(draft.nextFollowAt, detail.lead.nextFollowAt), expectedVersion: detail.lead.version };
          } else if (kind === 'qualified') {
            if (detail.lead.status === 'qualified') return;
            if (!draft.qualificationReason.trim() || draft.qualificationReason.trim().length > 1000) throw new Error('请填写 1000 字以内的初筛说明。');
            input = { status: 'qualified', reason: draft.qualificationReason.trim(), nextFollowAt: leadFollowAt(draft.nextFollowAt, detail.lead.nextFollowAt), expectedVersion: detail.lead.version };
          } else {
            if (!javaState.identity.permissions?.includes('crm.opportunity.write') || detail.lead.status !== 'qualified' || detail.opportunity) return;
            if (!draft.opportunityTitle.trim() || draft.opportunityTitle.trim().length > 200 || !draft.opportunitySubject.trim() || draft.opportunitySubject.trim().length > 100 || !draft.opportunityTerm.trim() || draft.opportunityTerm.trim().length > 100 || draft.opportunityDetail.length > 5000) throw new Error('请填写购买需求名称、学科和学期，并检查字段长度。');
            input = { customerId: detail.lead.customerId, sourceLeadId: detail.lead.id, title: draft.opportunityTitle.trim(), subject: draft.opportunitySubject.trim(), term: draft.opportunityTerm.trim(), detail: draft.opportunityDetail.trim() };
          }
          detail.pending = { kind, input: Object.freeze(input), key: idempotencyKey(), next: kind === 'followup' && event.submitter?.value === 'next', uncertain: false };
          await submitLeadStep(detail);
        } catch (error) {
          if (isStaleWorkspace(error)) return;
          detail.error = error.message || '请核对表单'; render(); }
      });
    }
    document.getElementById('java-crm-lead-needs')?.addEventListener('click', () => {
      const lead = detail.lead;
      if (leadIsLocked(detail) || lead.status !== 'qualified') return;
      return openNeedWorkspace({ mode: 'intake', customerId: lead.customerId, studentId: lead.studentId, sourceLeadId: lead.id, activityId: lead.activityId, title: detail.draft.opportunityTitle, subject: detail.draft.opportunitySubject || lead.subject, term: detail.draft.opportunityTerm || lead.term });
    });
    document.getElementById('java-crm-lead-retry')?.addEventListener('click', () => submitLeadStep(detail));
    document.getElementById('java-crm-lead-refresh')?.addEventListener('click', refreshLeadDetail);
    document.getElementById('java-crm-lead-next')?.addEventListener('click', () => nextLeadDetail(detail));
    document.getElementById('java-crm-lead-back')?.addEventListener('click', async () => {
      if (leadIsLocked(detail) || detail.loading) return;
      if (workTabs) return activateWorkSession(detail.context.returnWorkKey || pageWorkKey(detail.context.page));
      javaState.leadDetail = null; javaState.error = '';
      if (detail.dirty || detail.context.dirty) await loadDirectory(detail.context.page, detail.context.listQuery, detail.context.pageNumber);
      else render();
      root.scrollTo?.(0, detail.context.scrollY);
    });
  }

  function pageControls(data, rowCount) {
    if (!data) return '<div class="pad muted">正在加载…</div>';
    const page = Number(data.page) || javaState.pageNumber || 1;
    const size = Number(data.size) || 50;
    const total = Number(data.total ?? data.orderCount) || 0;
    const pages = Math.max(1, Math.ceil(total / size));
    return `<div class="pad toolbar"><span class="muted">共 ${total} 条 · 当前显示 ${rowCount} 条 · 第 ${page} / ${pages} 页</span><div class="actions"><button class="btn small" id="java-crm-page-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button><button class="btn small" id="java-crm-page-next" ${page >= pages ? 'disabled' : ''}>下一页</button></div></div>`;
  }

  function customerDetailPage() {
    const customer = javaState.customerDetail.customer;
    const touchpoints = javaState.customerDetail.touchpoints || [];
    const canLinkStudent = javaState.identity.permissions?.includes('crm.customer.write') && javaState.identity.permissions?.includes('student.read');
    const canCreateStudent = javaState.identity.permissions?.includes('crm.customer.write') && javaState.identity.permissions?.includes('student.write');
    const canAddContact = javaState.identity.permissions?.includes('crm.customer.write');
    const canReceiveNeed = root.SiyueCrmNeeds ? javaState.identity.permissions?.includes('crm.opportunity.intake') && javaState.identity.permissions?.includes('crm.customer.read') : javaState.identity.permissions?.includes('crm.opportunity.write');
    const newStudentForm = javaState.customerStudentFormOpen ? `<form id="java-crm-customer-student-create" class="card pad" style="margin-top:12px"><h3 class="section-title">新建未报名学生</h3><div class="business-form-grid"><label>学生姓名<input class="input" name="name" maxlength="100" required></label><label>年级<input class="input" name="grade" maxlength="40"></label><label>联系电话<input class="input" name="phone" maxlength="32" inputmode="tel"></label><label>与家庭关系<select class="select" name="relationship" required><option value="child">子女</option><option value="ward">监护对象</option><option value="self">本人</option><option value="other">其他</option></select></label></div><div class="form-actions"><button type="button" class="btn" id="java-crm-customer-student-cancel">取消</button><button type="submit" class="btn primary" ${javaState.busy ? 'disabled' : ''}>${javaState.busy ? '正在保存…' : '创建并关联'}</button></div></form>` : '';
    return `<div class="heading"><div><h1>${escapeHtml(customer.displayName)}</h1><p class="subtitle">客户全景 · 联系方式已脱敏</p></div><div><button class="btn" id="java-crm-customer-back">返回客户档案</button>${canAddContact ? `<button class="btn" id="java-crm-customer-contact-add" data-customer="${escapeHtml(customer.id)}">添加联系方式</button>` : ''}${canLinkStudent ? `<button class="btn" id="java-crm-customer-student-link" data-customer="${escapeHtml(customer.id)}">关联已有学生</button>` : ''}${canCreateStudent ? `<button class="btn" id="java-crm-customer-student-create-toggle">${javaState.customerStudentFormOpen ? '收起新建' : '新建家庭学生'}</button>` : ''}${javaState.identity.permissions?.includes('crm.lead.write') ? `<button class="btn" data-customer-lead="${escapeHtml(customer.id)}">登记初筛线索</button>` : ''}${canReceiveNeed ? `<button class="btn primary" data-customer-opportunity="${escapeHtml(customer.id)}">新建购买需求</button>` : ''}</div></div>${javaState.error ? `<p class="notice" role="alert">${escapeHtml(javaState.error)}</p>` : ''}<div class="card pad"><div class="toolbar"><h2 class="section-title">客户与家庭</h2><span class="muted">校区 ${escapeHtml(customer.campusId)} · 负责人 ${escapeHtml(customer.ownerId)}</span></div><div class="java-crm-cards"><section><h3>联系方式</h3>${customer.contacts?.map(contact => `<p>${escapeHtml(contact.personRole)} · ${escapeHtml(contact.channel)} · ${escapeHtml(contact.valueMasked)}${contact.primary ? ' · 主联系方式' : ''}</p>`).join('') || '<p class="muted">未登记联系方式</p>'}</section><section><h3>关联学生</h3>${customer.students?.map(student => `<p>${escapeHtml(student.name)} · ${escapeHtml(student.grade || '年级未登记')} · ${escapeHtml(student.relationship)}${root.SiyueCrmNeeds && student.studentId ? ` <button type="button" class="btn small" data-customer-identifiers="${escapeHtml(customer.id)}" data-student="${escapeHtml(student.studentId)}">学号备案</button>` : ''}</p>`).join('') || '<p class="muted">未关联学生</p>'}</section></div></div>${newStudentForm}${javaState.customerDetail.opportunities ? `<div class="card pad" style="margin-top:18px"><h2 class="section-title">购买需求与商机</h2>${javaState.customerDetail.opportunities.map(item => `<p>${escapeHtml(item.title)} · ${escapeHtml(item.subject)} · ${escapeHtml(item.term)} · ${escapeHtml(item.stage)}</p>`).join('') || '<p class="muted">暂无销售需求</p>'}</div>` : javaState.customerDetail.opportunityError ? `<p class="notice" style="margin-top:18px">${escapeHtml(javaState.customerDetail.opportunityError)}</p>` : ''}<div class="card pad" style="margin-top:18px"><h2 class="section-title">客户触点</h2>${javaState.customerDetail.touchpointError ? `<p class="notice">${escapeHtml(javaState.customerDetail.touchpointError)}</p>` : ''}<div class="table-wrap"><table class="table"><thead><tr><th>发生时间</th><th>来源</th><th>渠道</th><th>内容</th><th>学生</th></tr></thead><tbody>${touchpoints.map(item => `<tr><td>${escapeHtml(item.occurredAt)}</td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.channel)}</td><td>${escapeHtml(item.summary)}</td><td>${escapeHtml(item.studentId)}</td></tr>`).join('') || '<tr><td colspan="5">暂无触点记录</td></tr>'}</tbody></table></div></div>`;
  }

  async function refreshAttributionDetail(order) {
    const [requests, adjustments] = await Promise.all([
      javaState.client.crm.attribution.requestsForOrder(order.id, { page: javaState.attributionRequestPage, size: 50 }),
      javaState.client.crm.attribution.adjustmentsForOrder(order.id)
    ]);
    javaState.attributionDetail = { order, requests, adjustments };
  }

  function formPickerPage() {
    const rows = javaState.list?.items || [];
    return `<div class="heading"><div><h1>提交审核</h1><p class="subtitle">选择一张表单查看其提交记录。</p></div><button class="btn" id="java-crm-refresh">刷新表单</button></div>${javaState.error ? `<p class="notice" role="alert">${escapeHtml(javaState.error)}</p>` : ''}<div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>表单</th><th>类型</th><th>状态</th><th>当前版本</th><th></th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.title)}</td><td>${escapeHtml(row.formKind)}</td><td>${escapeHtml(row.status)}</td><td>${Number(row.currentRevision) || 0}</td><td><button class="btn small" data-form-submissions="${escapeHtml(row.id)}">查看提交</button></td></tr>`).join('') || `<tr><td colspan="5">${javaState.list ? '没有可审核表单' : '正在加载…'}</td></tr>`}</tbody></table></div>${pageControls(javaState.list, rows.length)}</div>`;
  }

  function importPage() {
    const campusIds = javaState.identity.campusIds || [];
    const campusOptions = campusIds.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join('');
    const preview = javaState.importPreview;
    const receipt = javaState.importReceipt;
    const summary = preview?.summary || receipt?.summary;
    const eligibleCount = Number(summary?.newCustomer || 0) + Number(summary?.existingTouch || 0);
    const rows = preview?.items || receipt?.items || [];
    return `<div class="heading"><div><h1>批量导入</h1><p class="subtitle">先预览查重与逐行错误，再确认提交。手机号仅显示脱敏结果。</p></div><button class="btn" id="java-crm-import-reset">重新选择文件</button></div>${javaState.error ? `<p class="notice" role="alert">${escapeHtml(javaState.error)}</p>` : ''}${receipt ? `<p class="notice">批次 ${escapeHtml(receipt.batchId)} 已提交。</p>` : ''}<form id="java-crm-import-form" class="card pad"><div class="filters"><label>名单文件<input class="input" name="file" id="java-crm-import-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></label><label>校区编号<input class="input" name="campusId" list="java-crm-import-campuses" maxlength="120" required><datalist id="java-crm-import-campuses">${campusOptions}</datalist></label><label>默认线索来源<select class="select" name="source"><option value="front_desk">前台</option><option value="online_form">线上表单</option><option value="phone">电话</option><option value="referral">转介绍</option><option value="other" selected>其他</option></select></label><label>关联活动编号（可留空）<input class="input" name="activityId" maxlength="120"></label></div><label>列映射 JSON（左侧字段固定：name、phone、guardian、grade、subject、term、source、note；右侧填写文件表头）<textarea class="input" name="mapping" rows="4" required>{"name":"学生姓名","phone":"监护人电话","guardian":"监护人姓名","grade":"年级","subject":"意向学科","term":"意向学期","note":"备注"}</textarea></label><div class="actions"><button class="btn primary" type="submit" ${javaState.importBusy ? 'disabled' : ''}>${javaState.importBusy ? '正在预览…' : '上传并预览'}</button>${preview && !receipt ? `<button class="btn primary" type="button" id="java-crm-import-apply" ${javaState.importBusy || !eligibleCount ? 'disabled' : ''}>${eligibleCount ? '确认导入有效数据' : '没有可导入的数据'}</button>` : ''}</div></form>${summary ? `<div class="java-crm-cards"><div class="card pad"><span>新客户</span><strong>${Number(summary.newCustomer) || 0}</strong></div><div class="card pad"><span>已有客户新触点</span><strong>${Number(summary.existingTouch) || 0}</strong></div><div class="card pad"><span>重复需求</span><strong>${Number(summary.duplicateDemand) || 0}</strong></div><div class="card pad"><span>需人工核对</span><strong>${Number(summary.needsReview) || 0}</strong></div><div class="card pad"><span>无效行</span><strong>${Number(summary.invalid) || 0}</strong></div></div><div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>行号</th><th>分类</th><th>学生</th><th>电话</th><th>校验结果</th></tr></thead><tbody>${rows.map(row => `<tr><td>${Number(row.rowNumber) || 0}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.studentName)}</td><td>${escapeHtml(row.phoneMasked)}</td><td>${escapeHtml((row.errors || []).join('；') || '可提交')}</td></tr>`).join('') || '<tr><td colspan="5">预览没有数据行</td></tr>'}</tbody></table></div><div class="pad muted">预览共 ${Number(preview?.total) || rows.length} 行；提交时服务端会重新查重和校验。</div></div>` : ''}`;
  }

  function reportsPage() {
    const data = javaState.list;
    const rows = data?.items || [];
    return `<div class="heading"><div><h1>经营报表</h1><p class="subtitle">按订单固定成交归属统计收款、退款和净现金流。</p></div></div>${javaState.error ? `<p class="notice" role="alert">${escapeHtml(javaState.error)}</p>` : ''}<form id="java-crm-report-filter" class="filters"><label>开始时间<input class="input" name="from" type="datetime-local" value="${escapeHtml(javaState.reportFrom.slice(0, 16))}" required></label><label>结束时间<input class="input" name="until" type="datetime-local" value="${escapeHtml(javaState.reportUntil.slice(0, 16))}" required></label><button class="btn primary">查询</button></form><div class="java-crm-cards"><div class="card pad"><span>期间订单数</span><strong>${Number(data?.orderCount) || 0}</strong></div><div class="card pad"><span>实收</span><strong>${escapeHtml(data?.receipts ?? '—')}</strong></div><div class="card pad"><span>退款</span><strong>${escapeHtml(data?.refunds ?? '—')}</strong></div><div class="card pad"><span>净现金流</span><strong>${escapeHtml(data?.netCashFlow ?? '—')}</strong></div></div><div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>订单</th><th>客户</th><th>成交归属</th><th>实收</th><th>退款</th><th>净现金流</th><th>最近变动</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.orderId)}</td><td>${escapeHtml(row.customerId)}</td><td>${escapeHtml(row.attributedOwnerId)}</td><td>${escapeHtml(row.receipts)}</td><td>${escapeHtml(row.refunds)}</td><td>${escapeHtml(row.netCashFlow)}</td><td>${escapeHtml(row.lastEventAt)}</td></tr>`).join('') || `<tr><td colspan="7">${data ? '该期间没有订单记录' : '请选择期间查询'}</td></tr>`}</tbody></table></div>${pageControls(data, rows.length)}</div>`;
  }

  function routingPage() {
    const result = javaState.list;
    const queuePage = result?.queue;
    const rulePage = result?.rules;
    const queue = queuePage?.items || [];
    const rules = rulePage?.items || [];
    const selection = javaState.routingSelection;
    const preview = javaState.routingPreview;
    const ruleCreate = javaState.identity.permissions?.includes('crm.lead.assign')
      ? '<button class="btn primary" id="java-crm-routing-rule-create">新建分配规则</button>' : '';
    const ruleActions = rule => javaState.identity.permissions?.includes('crm.lead.assign')
      ? `<td><button class="btn small" data-routing-rule-edit="${escapeHtml(rule.id)}" data-version="${Number(rule.version) || 0}">编辑</button></td>` : '';
    return `<div class="heading"><div><h1>分配规则</h1><p class="subtitle">规则按优先级匹配；变更后可预览未匹配线索，再确认重新分配。</p></div><div class="actions">${ruleCreate}<button class="btn" id="java-crm-refresh">刷新</button></div></div>${javaState.error ? `<p class="notice" role="alert">${escapeHtml(javaState.error)}</p>` : ''}<div class="card pad"><h2 class="section-title">自动分配规则</h2><div class="table-wrap"><table class="table"><thead><tr><th>规则</th><th>校区</th><th>活动</th><th>学科</th><th>来源</th><th>负责人</th><th>优先级</th><th>状态</th>${javaState.identity.permissions?.includes('crm.lead.assign') ? '<th>操作</th>' : ''}</tr></thead><tbody>${rules.map(rule => `<tr><td>${escapeHtml(rule.name)}</td><td>${escapeHtml(rule.campusId)}</td><td>${escapeHtml(rule.activityId || '不限')}</td><td>${escapeHtml(rule.subject || '不限')}</td><td>${escapeHtml(rule.source || '不限')}</td><td>${escapeHtml(rule.ownerId)}</td><td>${Number(rule.priority)}</td><td>${rule.active ? '启用' : '停用'}</td>${ruleActions(rule)}</tr>`).join('') || `<tr><td colspan="${javaState.identity.permissions?.includes('crm.lead.assign') ? 9 : 8}">${result ? '没有适用规则' : '正在加载…'}</td></tr>`}</tbody></table></div>${routePageControls(rulePage, 'rules')}</div><div class="card pad" style="margin-top:18px"><div class="toolbar"><h2 class="section-title">未匹配线索</h2><div class="actions"><button class="btn" id="java-crm-routing-preview" ${selection.size ? '' : 'disabled'}>预览分配</button><button class="btn primary" id="java-crm-routing-apply" ${preview?.assignable ? '' : 'disabled'}>确认分配</button></div></div>${preview ? `<p class="notice">预览：${Number(preview.assignable) || 0} 条可分配，${Number(preview.unmatched) || 0} 条仍无匹配规则。</p><div class="table-wrap"><table class="table"><thead><tr><th>线索</th><th>命中规则</th><th>负责人</th><th>说明</th></tr></thead><tbody>${(preview.plans || []).map(plan => `<tr><td>${escapeHtml(plan.leadId)}</td><td>${escapeHtml(plan.matchedRuleId)}</td><td>${escapeHtml(plan.ownerId)}</td><td>${escapeHtml(plan.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}<div class="table-wrap"><table class="table"><thead><tr><th>选择</th><th>线索</th><th>校区</th><th>未匹配原因</th><th>进入时间</th></tr></thead><tbody>${queue.map(item => `<tr><td><input type="checkbox" data-routing-lead="${escapeHtml(item.leadId)}" data-version="${Number(item.version) || 0}" ${selection.has(item.leadId) ? 'checked' : ''}></td><td>${escapeHtml(item.leadId)}</td><td>${escapeHtml(item.campusId)}</td><td>${escapeHtml(item.reason)}</td><td>${escapeHtml(item.createdAt)}</td></tr>`).join('') || `<tr><td colspan="5">${result ? '未匹配队列为空' : '正在加载…'}</td></tr>`}</tbody></table></div>${routePageControls(queuePage, 'queue')}</div>`;
  }

  function routePageControls(data, list) {
    if (!data) return '<p class="pad muted">正在加载…</p>';
    const page = Number(data.page) || 1;
    const pages = Math.max(1, Math.ceil((Number(data.total) || 0) / (Number(data.size) || 50)));
    return `<div class="pad toolbar"><span class="muted">共 ${Number(data.total) || 0} 条 · 第 ${page} / ${pages} 页</span><div class="actions"><button class="btn small" data-routing-page="${list}" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button><button class="btn small" data-routing-page="${list}" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>下一页</button></div></div>`;
  }

  function attributionPage() {
    const rows = javaState.list?.items || [];
    return `<div class="heading"><div><h1>业绩归因</h1><p class="subtitle">逐单查看成交归属、纠错申请和已批准的追加调整。</p></div><button class="btn" id="java-crm-refresh">刷新订单</button></div>${javaState.error ? `<p class="notice" role="alert">${escapeHtml(javaState.error)}</p>` : ''}<div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>订单</th><th>商机</th><th>客户</th><th>当前成交归属</th><th>应收</th><th>实收</th><th>退款</th><th>状态</th><th>纠错</th></tr></thead><tbody>${rows.map(order => `<tr><td>${escapeHtml(order.id)}</td><td>${escapeHtml(order.opportunityId)}</td><td>${escapeHtml(order.customerId)}</td><td>${escapeHtml(order.attributedOwnerId)}</td><td>${escapeHtml(order.totalAmount)}</td><td>${escapeHtml(order.receivedAmount)}</td><td>${escapeHtml(order.refundedAmount)}</td><td>${escapeHtml(order.status)}</td><td><button class="btn small" data-attribution-order="${escapeHtml(order.id)}">查看归因与申请</button></td></tr>`).join('') || `<tr><td colspan="9">${javaState.list ? '当前范围没有订单' : '正在加载…'}</td></tr>`}</tbody></table></div>${pageControls(javaState.list, rows.length)}</div>`;
  }

  function attributionDetailPage() {
    const detail = javaState.attributionDetail;
    const requests = detail.requests?.items || [];
    const canReview = javaState.identity.permissions?.includes('crm.attribution.correct.review');
    const canRequest = javaState.identity.permissions?.includes('crm.attribution.correct.request');
    return `<div class="heading"><div><h1>订单归因详情</h1><p class="subtitle">原始成交快照保留；审批通过后以追加调整记录计算当前归属。</p></div><div class="actions"><button class="btn" id="java-crm-attribution-back">返回订单</button>${canRequest ? '<button class="btn primary" id="java-crm-attribution-request">申请纠错</button>' : ''}</div></div>${javaState.error ? `<p class="notice" role="alert">${escapeHtml(javaState.error)}</p>` : ''}<div class="card pad"><h2 class="section-title">订单 ${escapeHtml(detail.order.id)}</h2><p>商机：${escapeHtml(detail.order.opportunityId)} · 客户：${escapeHtml(detail.order.customerId)} · 成交归属快照：${escapeHtml(detail.order.attributedOwnerId)}</p><p>应收：${escapeHtml(detail.order.totalAmount)} · 实收：${escapeHtml(detail.order.receivedAmount)} · 退款：${escapeHtml(detail.order.refundedAmount)}</p></div><div class="card pad" style="margin-top:18px"><h2 class="section-title">纠错申请</h2><div class="table-wrap"><table class="table"><thead><tr><th>申请</th><th>申请人</th><th>原归属</th><th>申请归属</th><th>原因</th><th>凭证说明</th><th>状态</th><th>审批意见</th>${canReview ? '<th>处理</th>' : ''}</tr></thead><tbody>${requests.map(request => `<tr><td>${escapeHtml(request.id)}</td><td>${escapeHtml(request.applicantId)}</td><td>${escapeHtml(request.originalOwnerId)}</td><td>${escapeHtml(request.proposedOwnerId)}</td><td>${escapeHtml(request.reason)}</td><td>${escapeHtml(request.evidence || '—')}</td><td>${escapeHtml(request.status)}</td><td>${escapeHtml(request.reviewNote || '—')}</td>${canReview ? `<td>${request.status === 'pending_approval' && request.applicantId !== javaState.identity.principalId ? `<button class="btn small" data-attribution-review="${escapeHtml(request.id)}" data-version="${Number(request.version) || 0}" data-decision="approve">批准</button> <button class="btn small" data-attribution-review="${escapeHtml(request.id)}" data-version="${Number(request.version) || 0}" data-decision="reject">驳回</button>` : '—'}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${canReview ? 9 : 8}">没有归因纠错申请</td></tr>`}</tbody></table></div>${attributionRequestControls(detail.requests, requests.length)}</div><div class="card pad" style="margin-top:18px"><h2 class="section-title">已批准的归属调整</h2><div class="table-wrap"><table class="table"><thead><tr><th>调整编号</th><th>原归属</th><th>新归属</th><th>审批人</th><th>原因</th><th>凭证</th><th>生效时间</th></tr></thead><tbody>${(detail.adjustments || []).map(item => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.fromOwnerId)}</td><td>${escapeHtml(item.toOwnerId)}</td><td>${escapeHtml(item.reviewerId)}</td><td>${escapeHtml(item.reason)}</td><td>${escapeHtml(item.evidence || '—')}</td><td>${escapeHtml(item.adjustedAt)}</td></tr>`).join('') || '<tr><td colspan="7">没有已批准的调整</td></tr>'}</tbody></table></div></div>`;
  }

  function attributionRequestControls(data, rowCount) {
    if (!data) return '<p class="pad muted">正在加载…</p>';
    const page = Number(data.page) || 1;
    const pages = Math.max(1, Math.ceil((Number(data.total) || 0) / (Number(data.size) || 50)));
    return `<div class="pad toolbar"><span class="muted">共 ${Number(data.total) || 0} 项申请 · 当前显示 ${rowCount} 项 · 第 ${page} / ${pages} 页</span><div class="actions"><button class="btn small" id="java-crm-attribution-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button><button class="btn small" id="java-crm-attribution-next" ${page >= pages ? 'disabled' : ''}>下一页</button></div></div>`;
  }

  const opportunityStages = { qualified: '需求确认', appointment: '已预约', trial: '已试听', negotiation: '待报名', won: '成交', closed: '已关闭' };
  function opportunityIsLocked(detail = javaState.opportunityDetail) { return Boolean(detail?.busy || detail?.pending); }
  function canFollowOpportunity(opportunity) {
    const identity = javaState.identity;
    return identity?.permissions?.includes('crm.opportunity.read') && identity.permissions.includes('crm.opportunity.write') && opportunity?.ownerId
      && (['all', 'campus'].includes(identity.scope) || opportunity.ownerId === identity.principalId)
      && ['qualified', 'appointment', 'trial', 'negotiation'].includes(opportunity.stage);
  }
  function opportunityDraft(opportunity) {
    return { channel: 'phone', summary: '', nextFollowAt: leadLocalTime(opportunity.nextFollowAt) };
  }
  function opportunityQuery(context) { return { ...context.listQuery, page: context.pageNumber, size: context.size }; }
  async function freshOpportunityPage(detail) {
    const identity = await javaState.client.identity.me();
    if (javaState.opportunityDetail !== detail || !javaState.identity) return null;
    if (identity.principalId !== javaState.identity.principalId) throw new Error('登录身份已经变化，请重新登录。');
    javaState.identity = identity;
    if (!identity.permissions?.includes('crm.opportunity.read')) throw new Error('当前账号已没有查看商机的权限。');
    if (detail.context.exactOpportunityId) {
      const data = await javaState.client.crm.needs.get(detail.context.exactOpportunityId);
      return { items: data?.opportunity ? [data.opportunity] : [], total: data?.opportunity ? 1 : 0, page: 1, size: 1 };
    }
    return javaState.client.crm.opportunities.list(opportunityQuery(detail.context));
  }
  function clearOpportunityRelated(detail) {
    detail.events = []; detail.customer = null; detail.source = []; detail.touchpoints = []; detail.orders = null; detail.other = null;
    detail.relatedErrors = {};
  }
  async function opportunitySupplement(detail) {
    const epoch = navigationEpoch, generation = detail.relatedGeneration = (detail.relatedGeneration || 0) + 1;
    const opportunity = detail.opportunity, api = javaState.client.crm, permissions = javaState.identity.permissions || [];
    const calls = [['events', () => api.opportunities.events(opportunity.id)]];
    const errors = {};
    if (permissions.includes('crm.customer.read')) calls.push(['customer', () => api.customers.get(opportunity.customerId)]);
    else errors.customer = '当前账号没有客户档案查看权限。';
    if (opportunity.sourceLeadId && permissions.includes('crm.lead.read')) calls.push(['source', () => api.leads.events(opportunity.sourceLeadId)]);
    else errors.source = opportunity.sourceLeadId ? '当前账号没有来源线索记录查看权限。' : '未关联可见的来源线索。';
    if (permissions.includes('crm.order.read')) calls.push(['orders', () => api.orders.list({ opportunityId: opportunity.id, page: detail.orderPage, size: 20 })]);
    else errors.orders = '当前账号没有订单查看权限。';
    if (permissions.includes('crm.customer.read')) calls.push(['other', () => api.opportunities.list({ customerId: opportunity.customerId, page: detail.otherPage, size: 20 })]);
    else errors.other = '当前账号没有按客户查看其他需求的权限。';
    if (permissions.includes('crm.customer.read') && permissions.includes('crm.touchpoint.read')) calls.push(['touchpoints', () => api.customers.touchpoints.list(opportunity.customerId)]);
    else errors.touchpoints = '当前账号没有客户触点查看权限。';
    const results = await Promise.allSettled(calls.map(([, read]) => read()));
    if (epoch !== navigationEpoch || javaState.opportunityDetail !== detail || detail.relatedGeneration !== generation) return;
    clearOpportunityRelated(detail); detail.relatedErrors = errors;
    results.forEach((result, index) => {
      const key = calls[index][0];
      if (result.status === 'fulfilled') detail[key] = result.value;
      else detail.relatedErrors[key] = result.reason.message || '读取失败，请刷新详情重试。';
    });
  }
  async function openOpportunityDetail(id, context = leadContext()) {
    if (!canLeaveWorkspace() || !context.ids.includes(id)) return;
    if (workTabs) {
      const key = opportunityWorkKey(id);
      if (workSessions.has(key)) return activateWorkSession(key);
      saveWorkSession(); leaveNeedWorkspace(); navigationEpoch++; activeWorkKey = key;
    }
    if (context.exactOpportunityId) { javaState.page = 'crmOpportunities'; state.page = javaState.page; }
    if (!workTabs) leaveNeedWorkspace();
    const detail = { opportunity: { id }, context, activeTab: 'follow', draft: {}, loading: true,
      pending: null, busy: false, error: '', notice: '', refreshRequired: false, orderPage: 1, otherPage: 1 };
    clearOpportunityRelated(detail);
    javaState.leadDetail = null; javaState.opportunityDetail = detail; javaState.error = '';
    if (workTabs) { saveWorkSession(); workSessions.get(activeWorkKey).scrollY = 0; workTabs.setActive(activeWorkKey); root.scrollTo?.(0, 0); }
    render();
    const generation = detail.readGeneration = 1;
    try {
      const page = await freshOpportunityPage(detail);
      if (javaState.opportunityDetail !== detail || detail.readGeneration !== generation) return;
      const row = page?.items?.find(item => item.id === id);
      if (!row) throw new Error('此商机已不在原筛选页或当前授权范围内，请返回列表刷新。');
      detail.opportunity = row; detail.draft = opportunityDraft(row); detail.draftInitialized = true; detail.draftChanged = false;
      await opportunitySupplement(detail);
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (javaState.opportunityDetail === detail) { detail.error = error.message || '商机读取失败'; detail.refreshRequired = true; }
    } finally { if (javaState.opportunityDetail === detail && detail.readGeneration === generation) { detail.loading = false; render(); } }
  }
  async function refreshOpportunityDetail() {
    const detail = javaState.opportunityDetail;
    if (!detail || opportunityIsLocked() || detail.loading) return;
    detail.loading = true; detail.error = ''; render();
    const generation = detail.readGeneration = (detail.readGeneration || 0) + 1;
    try {
      const page = await freshOpportunityPage(detail);
      if (javaState.opportunityDetail !== detail || detail.readGeneration !== generation) return;
      const row = page?.items?.find(item => item.id === detail.opportunity.id);
      if (!row) throw new Error('商机已离开原筛选页或授权范围，请返回列表刷新。');
      if (!detail.draftInitialized) { detail.draft = opportunityDraft(row); detail.draftInitialized = true; }
      if (detail.draft.nextFollowAt === leadLocalTime(detail.opportunity.nextFollowAt)) detail.draft.nextFollowAt = leadLocalTime(row.nextFollowAt);
      if (detail.opportunity.ownerId && detail.opportunity.ownerId !== row.ownerId) detail.notice = '负责人已更新，请核对当前负责人后继续办理。';
      detail.opportunity = row; detail.refreshRequired = false;
      await opportunitySupplement(detail);
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (javaState.opportunityDetail === detail) {
        detail.error = error.message || '刷新失败'; detail.refreshRequired = true;
        detail.opportunity = { id: detail.opportunity.id }; clearOpportunityRelated(detail);
      }
    } finally { if (javaState.opportunityDetail === detail && detail.readGeneration === generation) { detail.loading = false; render(); } }
  }
  async function nextOpportunityDetail(detail) {
    if (javaState.opportunityDetail !== detail || opportunityIsLocked()) return;
    detail.loading = true; render();
    try {
      const page = await freshOpportunityPage(detail);
      if (javaState.opportunityDetail !== detail) return;
      const visible = new Set((page?.items || []).filter(canFollowOpportunity).map(row => row.id));
      const index = detail.context.ids.indexOf(detail.opportunity.id);
      const next = detail.context.ids.slice(index + 1).find(id => visible.has(id));
      if (!next) { detail.notice = '已保存。本页后续没有仍可办理的商机，请返回列表。'; return; }
      detail.loading = false; await openOpportunityDetail(next, detail.context);
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (javaState.opportunityDetail === detail) detail.error = `本次已保存，下一条读取失败：${error.message || '请稍后重试'}。`;
    } finally { if (javaState.opportunityDetail === detail) { detail.loading = false; render(); } }
  }
  function followupLayout(options) {
    return root.SiyueCrmFollowup?.render(options) || `<section><h1>${escapeHtml(options.title)}</h1><p>${escapeHtml(options.status)}</p>${options.actionsHtml || ''}${options.summary.map(item => `<p>${escapeHtml(item.label)}：${escapeHtml(item.value)}</p>`).join('')}<p class="notice">${escapeHtml(options.notice)}</p><nav>${options.tabs.map(tab => `<button data-crm-followup-tab="${tab.id}">${tab.label}</button>`).join('')}</nav>${options.tabs.map(tab => `<section data-crm-followup-panel="${tab.id}"${tab.id === options.activeTab ? '' : ' hidden'}>${tab.html}</section>`).join('')}${options.footerHtml}</section>`;
  }
  function bindFollowupTabs(container, detail) {
    if (root.SiyueCrmFollowup?.bind) root.SiyueCrmFollowup.bind(container, id => { detail.activeTab = id; });
    else document.querySelectorAll('[data-crm-followup-tab]').forEach(button => button.addEventListener('click', () => {
      detail.activeTab = button.dataset.crmFollowupTab;
      document.querySelectorAll('[data-crm-followup-panel]').forEach(panel => { panel.hidden = panel.dataset.crmFollowupPanel !== detail.activeTab; });
    }));
  }
  function opportunityRelatedPage(detail, kind, columns, cells) {
    if (detail.relatedErrors[kind]) return `<p class="notice" role="alert">${escapeHtml(detail.relatedErrors[kind])}</p>`;
    const data = detail[kind];
    if (!data) return '<p>正在读取…</p>';
    const rows = data.items || [], page = Number(data.page) || 1, pages = Math.max(1, Math.ceil(Number(data.total) / (Number(data.size) || 20)));
    const shown = kind === 'other' ? rows.filter(row => row.id !== detail.opportunity.id) : rows;
    return `<div class="table-wrap"><table class="table"><thead><tr>${columns.map(label => `<th>${label}</th>`).join('')}${kind === 'orders' ? '<th>办理</th>' : ''}</tr></thead><tbody>${shown.map(row => `<tr>${cells(row).map(value => `<td>${escapeHtml(value ?? '—')}</td>`).join('')}${kind === 'orders' ? `<td>${salesWritable('receipt', row) && !detail.loading && !opportunityIsLocked(detail) ? `<button type="button" class="btn" data-order-receipt="${escapeHtml(row.id)}" data-version="${row.version}">登记实收</button>` : '—'}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${columns.length}">本页没有${kind === 'other' ? '其他需求' : '关联订单'}</td></tr>`}</tbody></table></div><div class="toolbar"><p>${kind === 'other' ? '客户需求共' : '关联订单共'} ${Number(data.total) || 0} 条${kind === 'other' ? '（含当前需求，本表不重复显示）' : ''} · 第 ${page} / ${pages} 页</p><div class="actions"><button class="btn" data-opportunity-related="${kind}" data-page="${page - 1}"${page <= 1 || detail.loading || opportunityIsLocked(detail) ? ' disabled' : ''}>上一页</button><button class="btn" data-opportunity-related="${kind}" data-page="${page + 1}"${page >= pages || detail.loading || opportunityIsLocked(detail) ? ' disabled' : ''}>下一页</button></div></div>`;
  }
  function positiveMoney(value) {
    const text = String(value ?? '').trim();
    if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(text) || /^0(?:\.0{1,2})?$/.test(text))
      throw new Error('请输入大于 0、整数部分最多 16 位且小数最多 2 位的金额（元）。');
    const [whole, fraction = ''] = text.split('.');
    return `${whole}.${fraction.padEnd(2, '0')}`;
  }
  function opportunityDetailPage() {
    const d = javaState.opportunityDetail, opportunity = d.opportunity;
    const locked = opportunityIsLocked(d), available = !d.loading && !d.refreshRequired && canFollowOpportunity(opportunity);
    const follow = `<form id="java-crm-opportunity-followup-form"><fieldset${locked || !available ? ' disabled' : ''}><legend>记录本次跟进</legend><div class="form-grid"><label>沟通方式<select class="select" name="channel">${Object.entries(leadChannels).map(([value, label]) => `<option value="${value}"${d.draft.channel === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label>下次回访（北京时间，可留空）<input class="input" name="nextFollowAt" type="datetime-local" value="${escapeHtml(d.draft.nextFollowAt || '')}"></label></div>${opportunity.nextFollowAt ? '<p class="help">保留原时间即保留现有安排；清空回访时间将取消现有安排。</p>' : ''}<label>沟通内容<textarea class="textarea" name="summary" required maxlength="5000">${escapeHtml(d.draft.summary || '')}</textarea></label></fieldset></form><p class="help">下一条仅在进入详情时的本页清单内查找，跳过无权办理或不再符合筛选的记录。保存跟进不会记为成交。</p>`;
    const timeline = (rows, source = false) => `<div class="table-wrap"><table class="table"><thead><tr><th>时间（北京时间）</th><th>事件</th><th>员工</th><th>方式</th><th>${source ? '线索状态' : '阶段变化'}</th><th>内容</th></tr></thead><tbody>${(rows || []).map(row => `<tr><td>${escapeHtml(leadLocalTime(row.occurredAt).replace('T', ' '))}</td><td>${escapeHtml({ created: '登记', followup: '沟通记录', stage: '阶段推进', status: '初筛状态', assigned: '分配', released: '释放' }[row.eventType] || row.eventType)}</td><td>${escapeHtml(row.actorId)}</td><td>${escapeHtml(leadChannels[row.channel] || '—')}</td><td>${escapeHtml([source ? row.fromStatus : row.fromStage, source ? row.toStatus : row.toStage].filter(Boolean).map(value => (source ? leadStatuses : opportunityStages)[value] || value).join(' → ') || '—')}</td><td>${escapeHtml(row.detail)}</td></tr>`).join('') || '<tr><td colspan="6">暂无记录</td></tr>'}</tbody></table></div><p class="help">展示当前可见的最近 100 条记录。</p>`;
    const relatedError = kind => `<p class="notice" role="alert">${escapeHtml(d.relatedErrors[kind])}</p>`;
    const customer = d.relatedErrors.customer ? relatedError('customer') : `<p>客户：${escapeHtml(d.customer?.displayName || opportunity.customerId)}</p><p>学生：${escapeHtml(d.customer?.students?.find(row => (row.studentId || row.id) === opportunity.studentId)?.name || opportunity.studentId || '未指定')}</p>${(d.customer?.contacts || []).map(row => `<p>${escapeHtml(({ guardian: '监护人', student: '学生', other: '其他' })[row.personRole] || row.personRole || '—')} · ${escapeHtml(({ phone: '电话', email: '邮箱' })[row.channel] || row.channel || '—')} · ${escapeHtml(row.valueMasked || '—')}</p>`).join('')}`;
    const sourceRecords = d.relatedErrors.source ? relatedError('source') : `<p>来源线索：${escapeHtml(opportunity.sourceLeadId)}</p>${timeline(d.source, true)}`;
    const opportunityRecords = d.relatedErrors.events ? relatedError('events') : timeline(d.events);
    const track = [...(d.events || []).map(row => ({ ...row, sourceLabel: '商机' })),
      ...(d.source || []).map(row => ({ ...row, sourceLabel: '来源线索' })),
      ...(d.touchpoints || []).map(row => ({ ...row, sourceLabel: '客户触点', eventType: row.source, detail: row.summary }))]
      .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
    const trajectory = `<p class="help">按时间合并当前可见的商机、来源线索事件及客户触点，各取最近 100 条；客户触点可能涉及该家庭的其他需求。</p>${d.relatedErrors.events ? relatedError('events') : ''}${d.relatedErrors.source ? relatedError('source') : ''}${d.relatedErrors.touchpoints ? relatedError('touchpoints') : ''}<div class="table-wrap"><table class="table"><thead><tr><th>时间（北京时间）</th><th>来源</th><th>事件</th><th>员工</th><th>内容</th></tr></thead><tbody>${track.map(row => `<tr><td>${escapeHtml(leadLocalTime(row.occurredAt).replace('T', ' '))}</td><td>${escapeHtml(row.sourceLabel)}</td><td>${escapeHtml({ created: '登记', followup: '沟通记录', stage: '阶段推进', status: '初筛状态', assigned: '分配', released: '释放' }[row.eventType] || row.eventType)}</td><td>${escapeHtml(row.actorId)}</td><td>${escapeHtml(row.detail)}</td></tr>`).join('') || '<tr><td colspan="5">暂无可见轨迹</td></tr>'}</tbody></table></div>`;
    const tabs = [{ id: 'follow', label: '跟进', html: `${follow}<section><h3>商机跟进记录</h3>${opportunityRecords}</section><section><h3>来源线索跟进记录</h3>${sourceRecords}</section>` },
      { id: 'customer', label: '画像', html: `<p class="help">当前可见的客户资料与购买需求。</p>${customer}<p>需求说明：${escapeHtml(opportunity.detail || '未填写')}</p><p>来源活动：${escapeHtml(opportunity.activityId || '未关联可见活动')}</p>` },
      { id: 'timeline', label: '轨迹', html: trajectory },
      { id: 'orders', label: '订单', html: opportunityRelatedPage(d, 'orders', ['订单', '应收', '实收', '退款', '状态'], row => [row.id, row.totalAmount, row.receivedAmount, row.refundedAmount, row.status]) },
      { id: 'other', label: '商机列表', html: opportunityRelatedPage(d, 'other', ['需求', '学科', '学期', '负责人', '阶段'], row => [row.title, row.subject, row.term, row.ownerId, opportunityStages[row.stage] || row.stage]) }];
    let notice = d.loading ? '正在核对权限并读取商机…' : d.notice;
    if (d.pending?.uncertain) notice = '提交结果暂不明确。内容已锁定，请使用原记录重试确认；请勿刷新页面或另建同一记录。';
    else if (d.busy) notice = '正在核对并保存，请稍候。';
    else if (!available && !d.loading && !d.refreshRequired) notice = ['closed', 'won'].includes(opportunity.stage) ? '此商机已经结束，仅可查看历史记录。' : '此商机当前仅可查看，请核对授权范围及跟进权限。';
    const footerHtml = `<button class="btn primary" form="java-crm-opportunity-followup-form" type="submit" name="action" value="save"${locked || !available ? ' disabled' : ''}>保存跟进</button><button class="btn" form="java-crm-opportunity-followup-form" type="submit" name="action" value="next"${locked || !available ? ' disabled' : ''}>保存并处理下一条</button><button class="btn" id="java-crm-opportunity-back"${locked || d.loading ? ' disabled' : ''}>返回原列表</button><button class="btn" id="java-crm-opportunity-refresh"${locked || d.loading ? ' disabled' : ''}>刷新详情</button>${d.pending?.uncertain ? `<button class="btn primary" id="java-crm-opportunity-retry"${d.busy ? ' disabled' : ''}>用原记录重试确认</button>` : ''}${d.savedFollowup && !locked ? '<button class="btn" id="java-crm-opportunity-next">处理本页下一条</button>' : ''}`;
    const options = { title: opportunity.title || '商机详情', recordId: opportunity.id, status: opportunityStages[opportunity.stage] || '',
      summary: [{ label: '客户', value: d.customer?.displayName || opportunity.customerId }, { label: '负责人', value: opportunity.ownerId }, { label: '校区', value: opportunity.campusId }, { label: '意向需求', value: [opportunity.subject, opportunity.term].filter(Boolean).join(' · ') }, { label: '下次回访（北京时间）', value: leadLocalTime(opportunity.nextFollowAt).replace('T', ' ') || '未安排' }],
      actionsHtml: `${root.SiyueCrmNeeds && !locked && !d.loading && !d.refreshRequired ? `<button type="button" class="btn" id="java-crm-opportunity-needs">需求资料／分配</button>` : ''}${!locked && !d.loading && !d.refreshRequired && salesWritable('stage', opportunity) ? `<button type="button" class="btn" data-opportunity-stage="${escapeHtml(opportunity.id)}" data-version="${opportunity.version}">推进阶段</button>` : ''}${!locked && !d.loading && !d.refreshRequired && salesWritable('order', opportunity) ? `<button type="button" class="btn" data-order-create="${escapeHtml(opportunity.id)}" data-version="${opportunity.version}">创建订单</button>` : ''}` + '<button type="button" class="btn" disabled title="通信渠道待配置">外呼（待配置）</button><button type="button" class="btn" disabled title="通信渠道待配置">企微（待配置）</button><button type="button" class="btn" disabled title="通信渠道待配置">短信（待配置）</button>', tabs, activeTab: d.activeTab, notice, footerHtml };
    return `<div id="java-crm-opportunity-detail">${d.error ? `<p class="notice" role="alert">${escapeHtml(d.error)}</p>` : ''}${followupLayout(options)}</div>`;
  }
  async function submitOpportunityFollowup(detail) {
    if (javaState.opportunityDetail !== detail || detail.busy || !detail.pending) return;
    const pending = detail.pending; detail.busy = true; detail.error = ''; render();
    let result;
    try {
      result = await javaState.client.crm.opportunities.followup(detail.opportunity.id, pending.input, pending.key);
      if (!result || result.id !== detail.opportunity.id || result.customerId !== detail.opportunity.customerId
          || !Number.isSafeInteger(result.version) || result.version <= pending.input.expectedVersion
          || !Object.prototype.hasOwnProperty.call(opportunityStages, result.stage)) throw new Error('未收到可确认的保存回执');
    } catch (error) {
      if (isStaleWorkspace(error) || javaState.opportunityDetail !== detail) return;
      const rejected = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && leadRejections.has(error.code);
      if (!pending.uncertain && rejected) {
        detail.pending = null; detail.refreshRequired = ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'ALREADY_EXISTS', 'PREVIEW_STALE'].includes(error.code);
        detail.error = `${error.message || '服务端拒绝了本次操作'}${detail.refreshRequired ? '；请刷新详情核对权限、负责人和版本。' : ''}`;
      } else { pending.uncertain = true; detail.error = error.message || '提交结果未确认'; }
      detail.busy = false; render(); return;
    }
    if (javaState.opportunityDetail !== detail) return;
    clearWorkspaceBlock();
    detail.pending = null; detail.busy = false; detail.dirty = true; detail.context.dirty = true;
    detail.opportunity = result; detail.draft = opportunityDraft(result); detail.draftChanged = false; detail.savedFollowup = true; detail.notice = '跟进已保存。';
    javaState.list = javaState.list ? { ...javaState.list, items: (javaState.list.items || []).map(row => row.id === result.id ? result : row) } : null;
    await opportunitySupplement(detail);
    if (pending.next) await nextOpportunityDetail(detail);
    else if (javaState.opportunityDetail === detail) render();
  }
  function bindOpportunityDetail() {
    const detail = javaState.opportunityDetail; if (!detail) return;
    bindFollowupTabs(document.getElementById('java-crm-opportunity-detail'), detail);
    const form = document.getElementById('java-crm-opportunity-followup-form');
    const update = (name, value) => {
      if (javaState.opportunityDetail !== detail || opportunityIsLocked(detail) || !Object.prototype.hasOwnProperty.call(detail.draft, name)) return;
      detail.draft[name] = String(value);
      const defaults = opportunityDraft(detail.opportunity);
      detail.draftChanged = Object.keys(defaults).some(key => detail.draft[key] !== defaults[key]); syncWorkTab();
    };
    form?.addEventListener('input', event => update(event.target.name, event.target.value));
    form?.addEventListener('change', event => update(event.target.name, event.target.value));
    form?.addEventListener('submit', async event => {
      event.preventDefault();
      if (javaState.opportunityDetail !== detail || opportunityIsLocked(detail) || detail.loading || detail.refreshRequired || !canFollowOpportunity(detail.opportunity)) return;
      new FormData(event.currentTarget).forEach((value, key) => update(key, value));
      detail.busy = true; detail.error = ''; render();
      try {
        const draft = detail.draft;
        if (!leadChannels[draft.channel] || !draft.summary.trim() || draft.summary.trim().length > 5000) throw new Error('请选择沟通方式并填写 5000 字以内的跟进内容。');
        const nextFollowAt = leadFollowAt(draft.nextFollowAt, detail.opportunity.nextFollowAt);
        const page = await freshOpportunityPage(detail);
        if (javaState.opportunityDetail !== detail) return;
        const current = page?.items?.find(row => row.id === detail.opportunity.id);
        if (!current || !canFollowOpportunity(current) || current.version !== detail.opportunity.version || current.ownerId !== detail.opportunity.ownerId) {
          detail.refreshRequired = true; throw new Error('商机版本、负责人或授权范围已变化；草稿已保留，请刷新详情核对后再保存。');
        }
        detail.pending = { input: Object.freeze({ channel: draft.channel, detail: draft.summary.trim(), nextFollowAt, expectedVersion: current.version }), key: idempotencyKey(), next: event.submitter?.value === 'next', uncertain: false };
        detail.busy = false; await submitOpportunityFollowup(detail);
      } catch (error) {
        if (isStaleWorkspace(error) || javaState.opportunityDetail !== detail) return;
        detail.busy = false; detail.error = error.message || '请核对表单'; render();
      }
    });
    document.getElementById('java-crm-opportunity-retry')?.addEventListener('click', () => submitOpportunityFollowup(detail));
    document.getElementById('java-crm-opportunity-refresh')?.addEventListener('click', refreshOpportunityDetail);
    document.getElementById('java-crm-opportunity-next')?.addEventListener('click', () => nextOpportunityDetail(detail));
    document.querySelectorAll('[data-opportunity-related]').forEach(button => button.addEventListener('click', async () => {
      if (detail.loading || opportunityIsLocked(detail) || javaState.opportunityDetail !== detail) return;
      const kind = button.dataset.opportunityRelated, data = detail[kind], page = Number(button.dataset.page);
      if (!['orders', 'other'].includes(kind) || !data || !Number.isInteger(page) || page < 1 || page > Math.ceil(data.total / data.size)) return;
      detail[kind === 'orders' ? 'orderPage' : 'otherPage'] = page; detail.loading = true; render();
      await opportunitySupplement(detail);
      if (javaState.opportunityDetail === detail) { detail.loading = false; render(); }
    }));
    document.getElementById('java-crm-opportunity-back')?.addEventListener('click', async () => {
      if (opportunityIsLocked(detail) || detail.loading) return;
      if (workTabs) return activateWorkSession(detail.context.returnWorkKey || pageWorkKey(detail.context.page));
      if (detail.draftChanged && !root.confirm('跟进尚未保存。确认返回并放弃草稿吗？')) return;
      javaState.opportunityDetail = null; javaState.error = '';
      if (detail.dirty || detail.context.dirty) await loadDirectory(detail.context.page, detail.context.listQuery, detail.context.pageNumber);
      else render();
      root.scrollTo?.(0, detail.context.scrollY);
    });
  }

  const salesTitles = { stage: '推进商机阶段', order: '创建收费订单', receipt: '登记实际收款' };
  const receiptMethods = { bank_transfer: '银行转账', pos: 'POS 刷卡', cash: '现金', online: '线上支付', other: '其他' };
  const orderStatuses = { pending: '待收款', partially_received: '部分收款', partially_paid: '部分收款', received: '已收齐', paid: '已收齐', cancelled: '已取消' };
  function salesIsLocked(detail = javaState.transactionDetail) { return Boolean(detail?.busy || detail?.pending); }
  function salesPermissions(kind) { return kind === 'stage' ? ['crm.opportunity.read', 'crm.opportunity.write']
    : kind === 'order' ? ['crm.opportunity.read', 'crm.order.write'] : ['crm.order.read', 'crm.receipt.record']; }
  function salesMoneyCents(value) {
    const match = /^(0|[1-9]\d{0,15})(?:\.(\d{1,2}))?$/.exec(String(value ?? ''));
    return match ? BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0')) : null;
  }
  function sourceOpportunityDraft(detail) {
    const id = detail.kind === 'receipt' ? detail.record.opportunityId : detail.record.id;
    const source = workSessions.get(opportunityWorkKey(id))?.data.opportunityDetail || detail.origin.opportunityDetail;
    return source?.opportunity?.id === id && source.draftChanged ? source : null;
  }
  function salesEndsOpportunity(detail, input = detail.review?.input) {
    return detail.kind === 'stage' && (input?.stage || detail.draft.stage) === 'closed'
      || detail.kind === 'receipt' && salesMoneyCents(detail.record.receivedAmount) === 0n;
  }
  function guardSourceOpportunityDraft(detail, input) {
    if (salesEndsOpportunity(detail, input) && sourceOpportunityDraft(detail))
      throw Object.assign(new Error('来源商机还有未保存的跟进内容。请先返回商机保存，或明确放弃草稿后再办理；本次操作完成后该商机将不能继续跟进。'), { sourceDraftBlocked: true });
  }
  function salesWritable(kind, record) {
    const identity = javaState.identity;
    if (!salesPermissions(kind).every(code => identity?.permissions?.includes(code)) || !Number.isSafeInteger(record?.version) || record.version < 1) return false;
    // The server list has already applied current resource scope. Own-scope checks additionally protect stale UI actions.
    if (kind === 'receipt') {
      const total = salesMoneyCents(record.totalAmount), received = salesMoneyCents(record.receivedAmount);
      return ['pending', 'partially_received', 'partially_paid'].includes(record.status) && (total === null || received === null || total > received);
    }
    if (!['all', 'campus'].includes(identity.scope) && record.ownerId !== identity.principalId) return false;
    return kind === 'stage' ? record.stage !== 'won' : ['qualified', 'appointment', 'trial', 'negotiation'].includes(record.stage);
  }
  function salesDraft(kind, record, initialReceivedAt) {
    if (kind === 'stage') return { stage: record.stage === 'closed' ? 'qualified' : '', reason: '', nextFollowAt: leadLocalTime(record.nextFollowAt) };
    if (kind === 'order') return { totalAmount: '', productSnapshot: [record.title, record.subject, record.term].filter(Boolean).join(' · ').slice(0, 300) };
    return { amount: '', method: 'bank_transfer', reference: '', receivedAt: leadLocalTime(initialReceivedAt), verified: '' };
  }
  function salesRecordFingerprint(kind, row) {
    return JSON.stringify(kind === 'receipt' ? [row.id, row.version, row.customerId, row.opportunityId, row.attributedOwnerId, row.currentAttributionOwnerId, row.status, row.totalAmount, row.receivedAmount, row.refundedAmount]
      : [row.id, row.version, row.customerId, row.ownerId, row.campusId, row.stage, row.nextFollowAt]);
  }
  async function salesIdentity(detail) {
    const identity = await javaState.client.identity.me();
    if (javaState.transactionDetail !== detail || !javaState.identity) throw staleWorkspace();
    if (identity.principalId !== javaState.identity.principalId) throw new Error('登录身份已经变化，请重新登录。');
    javaState.identity = identity;
    if (!salesPermissions(detail.kind).every(code => identity.permissions?.includes(code))) throw new Error('当前账号已没有办理此操作的权限。');
    return identity;
  }
  async function readSalesRecord(detail) {
    await salesIdentity(detail);
    const query = { ...detail.context.listQuery, page: detail.context.pageNumber, size: detail.context.size };
    const result = detail.kind === 'receipt' ? await javaState.client.crm.orders.list(query) : await javaState.client.crm.opportunities.list(query);
    if (javaState.transactionDetail !== detail) throw staleWorkspace();
    const row = result?.items?.find(item => item.id === detail.record.id);
    if (!row) throw new Error('记录已离开原筛选页或当前授权范围，请返回原列表刷新。');
    return row;
  }
  async function openSalesTransaction(kind, id) {
    if (javaState.transactionDetail?.kind === kind && javaState.transactionDetail.record.id === id) return;
    if (!canLeaveWorkspace()) return;
    const opportunity = javaState.opportunityDetail;
    const record = (kind === 'receipt' ? opportunity?.orders?.items?.find(row => row.id === id)
      : opportunity?.opportunity?.id === id ? opportunity.opportunity : null) || javaState.list?.items?.find(row => row.id === id);
    if (!record || !salesWritable(kind, record)) { javaState.error = '当前记录没有可用的办理权限或已不允许此操作。'; render(); return; }
    const key = `java:sales:${kind}:${id}`;
    if (workTabs && workSessions.has(key)) return activateWorkSession(key);
    const origin = stateSnapshot(), originKey = activeWorkKey;
    const context = kind === 'receipt' && opportunity ? { ...opportunity.context, listQuery: { opportunityId: opportunity.opportunity.id }, pageNumber: opportunity.orderPage, size: 20 }
      : opportunity ? { ...opportunity.context } : leadContext();
    if (workTabs) { saveWorkSession(); leaveNeedWorkspace(); navigationEpoch++; activeWorkKey = key; }
    const initialReceivedAt = new Date().toISOString();
    javaState.transactionDetail = { kind, record: { ...record }, origin, originKey, context, initialReceivedAt,
      draft: salesDraft(kind, record, initialReceivedAt), draftChanged: false, review: null, pending: null, completed: null,
      busy: false, loading: false, refreshRequired: false, postReadError: '', notice: '', error: '' };
    javaState.opportunityDetail = null; javaState.leadDetail = null; javaState.error = '';
    if (workTabs) { saveWorkSession(); workSessions.get(key).scrollY = 0; workTabs.setActive(key); root.scrollTo?.(0, 0); }
    await refreshSalesTransaction();
  }
  async function refreshSalesTransaction() {
    const detail = javaState.transactionDetail; if (!detail || salesIsLocked(detail) || detail.loading) return;
    detail.loading = true; detail.error = ''; render();
    const generation = detail.readGeneration = (detail.readGeneration || 0) + 1;
    try {
      const row = await readSalesRecord(detail);
      if (javaState.transactionDetail !== detail || detail.readGeneration !== generation) return;
      if (!detail.completed && salesRecordFingerprint(detail.kind, row) !== salesRecordFingerprint(detail.kind, detail.record)) {
        detail.review = null;
        detail.notice = '记录或归属已更新，填写内容已保留，请重新核对。';
      }
      if (detail.kind === 'stage' && detail.draft.nextFollowAt === leadLocalTime(detail.record.nextFollowAt)) detail.draft.nextFollowAt = leadLocalTime(row.nextFollowAt);
      detail.record = row; detail.refreshRequired = false; detail.postReadError = '';
    } catch (error) {
      if (isStaleWorkspace(error) || javaState.transactionDetail !== detail) return;
      detail.refreshRequired = true; detail.review = null;
      if (detail.completed) detail.postReadError = `办理已成功，当前记录重读失败：${error.message || '请稍后刷新'}。请勿重复提交。`;
      else { detail.error = error.message || '核对记录失败'; detail.record = { id: detail.record.id }; }
    } finally { if (javaState.transactionDetail === detail && detail.readGeneration === generation) { detail.loading = false; render(); } }
  }
  function receiptInstant(value, original) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('请填写实际到账日期和时间。');
    const instant = original && value === leadLocalTime(original) ? original : new Date(`${value}:00+08:00`).toISOString();
    if (leadLocalTime(instant) !== value || new Date(instant).getTime() > Date.now()) throw new Error('实际到账时间无效或晚于当前时间。');
    return instant;
  }
  async function loadOrderClassQuotes(page=1) {
    const detail=javaState.transactionDetail;
    if(!detail || detail.kind!=='order' || salesIsLocked(detail) || detail.review || detail.completed || detail.quotesBusy) return;
    detail.quotesBusy=true;detail.error='';render();
    try {
      const quotes=await javaState.client.crm.orders.classQuotes({opportunityId:detail.record.id,page,size:20});
      if(javaState.transactionDetail!==detail) return;
      if(!Array.isArray(quotes?.items) || !Number.isSafeInteger(quotes.total) || quotes.total<0) throw Error('班级报价回执无效');
      detail.quotes=quotes;detail.classQuote=null;
    } catch(error) { if(javaState.transactionDetail===detail) detail.error=error.message || '班级报价读取失败'; }
    finally { if(javaState.transactionDetail===detail) { detail.quotesBusy=false;render(); } }
  }
  function orderClassQuotePanel(detail) {
    if(typeof javaState.client.crm.orders.classQuotes!=='function') return '';
    const data=detail.quotes, page=data?.page || 1, pages=Math.max(1,Math.ceil((data?.total || 0)/20));
    return `<section><h3>班级报价</h3><button type="button" class="btn" id="java-crm-order-classes-load"${detail.quotesBusy ? ' disabled' : ''}>${detail.quotesBusy ? '读取中…' : '选择班级报价'}</button>${detail.classQuote ? `<p>已选：${escapeHtml(detail.classQuote.terms.className)} · 课程费 ${escapeHtml(detail.classQuote.terms.fees.courseFee)} 元 · 教辅费 ${escapeHtml(detail.classQuote.terms.fees.materialFee)} 元</p><button type="button" class="btn" id="java-crm-order-class-clear">使用自定义报价</button>` : ''}${!data ? '' : `<div class="table-wrap"><table class="table"><thead><tr><th>班级</th><th>课程费</th><th>教辅费</th><th>合计</th><th>操作</th></tr></thead><tbody>${data.items.map(quote=>`<tr><td>${escapeHtml(quote.terms?.className)}</td><td>${escapeHtml(quote.terms?.fees?.courseFee)}</td><td>${escapeHtml(quote.terms?.fees?.materialFee)}</td><td>${escapeHtml(quote.totalAmount)}</td><td><button type="button" class="btn" data-order-class-pick="${escapeHtml(quote.terms?.classId)}">选择</button></td></tr>`).join('') || '<tr><td colspan="5">暂无可用班级报价</td></tr>'}</tbody></table></div><p>共 ${data.total} 条 · 第 ${page}/${pages} 页</p><button type="button" class="btn" data-order-class-page="${page-1}"${page<=1 || detail.quotesBusy ? ' disabled' : ''}>上一页</button><button type="button" class="btn" data-order-class-page="${page+1}"${page>=pages || detail.quotesBusy ? ' disabled' : ''}>下一页</button>`}</section>`;
  }
  function salesInput(detail) {
    const draft = detail.draft, row = detail.record;
    guardSourceOpportunityDraft(detail);
    if (detail.kind === 'stage') {
      if (!['qualified', 'appointment', 'trial', 'negotiation', 'closed'].includes(draft.stage) || draft.stage === row.stage
        || row.stage === 'closed' && draft.stage !== 'qualified') throw new Error('请选择可办理的新阶段；已关闭商机只能重新开启到需求确认。');
      if (draft.reason.length > 1000 || draft.stage === 'closed' && !draft.reason.trim()) throw new Error('关闭时须填写原因，说明最多 1000 字。');
      return { stage: draft.stage, reason: draft.reason.trim(), nextFollowAt: draft.stage === 'closed' ? null : leadFollowAt(draft.nextFollowAt, row.nextFollowAt), expectedVersion: row.version };
    }
    if (detail.kind === 'order') {
      if (!draft.productSnapshot.trim() || draft.productSnapshot.trim().length > 300) throw new Error('请填写 300 字以内的订单产品、学科和学期说明。');
      const input = { opportunityId:row.id,totalAmount:positiveMoney(detail.classQuote ? detail.classQuote.totalAmount : draft.totalAmount),productSnapshot:draft.productSnapshot.trim(),expectedOpportunityVersion:row.version };
      if(detail.classQuote) input.classBinding={classId:detail.classQuote.terms.classId,expectedVersion:detail.classQuote.terms.classVersion};
      return input;
    }
    if (!receiptMethods[draft.method] || draft.reference.length > 1000) throw new Error('请选择收款方式，凭证说明最多 1000 字。');
    if (draft.verified !== 'on') throw new Error('请先核实实际到账并勾选确认。');
    return { amount: positiveMoney(draft.amount), method: draft.method, reference: draft.reference.trim(),
      receivedAt: receiptInstant(draft.receivedAt, detail.initialReceivedAt), expectedOrderVersion: row.version };
  }
  function classOrderFacts(terms) {
    if(!terms) return [];
    const fee=terms.fees, rules={unused_lessons:'根据未上讲次退费',first_n_full:`前${fee.refundLessonCount}讲退班，全额退费`,last_n_none:`后${fee.refundLessonCount}讲退班，不退费用`};
    return [['关联班级',terms.className],['课程费（元）',fee.courseFee],['教辅费（元）',fee.materialFee],['课程费退款规则',rules[fee.courseRefundRule]],['教辅费退款规则',fee.materialRefundRule==='after_start' ? '开课后不退' : '报名后不退']];
  }
  function salesReviewFacts(detail, input) {
    if (detail.kind === 'stage') return [['新阶段', opportunityStages[input.stage]], ['阶段说明', input.reason || '未填写'],
      ['下次回访（北京时间）', leadLocalTime(input.nextFollowAt).replace('T', ' ') || '取消／不安排回访'], ['办理影响', input.stage === 'closed' ? '关闭此商机并取消回访安排，保留历史记录。' : '仅推进商机阶段，不记为收款成交。']];
    if (detail.kind === 'order') return [...classOrderFacts(input.classBinding ? detail.classQuote?.terms : null),['订单产品说明', input.productSnapshot], ['订单应收（元）', input.totalAmount],
      ['成交归属快照', detail.record.ownerId], ['办理影响', '按当前商机负责人冻结订单归属；建单不产生实收。同一商机仅创建一张订单，分期收款记入原订单。']];
    return [['本次实收（元）', input.amount], ['收款方式', receiptMethods[input.method]], ['实际到账（北京时间）', leadLocalTime(input.receivedAt).replace('T', ' ')],
      ['凭证说明', input.reference || '未填写'], ['办理影响', '追加实际收款记录；首次实收将商机记为成交。订单原始成交归属保留，退款不会增加可收金额。']];
  }
  function salesTransactionPage() {
    const detail = javaState.transactionDetail, row = detail.record, draft = detail.draft;
    const locked = salesIsLocked(detail), available = !detail.loading && !detail.refreshRequired && !detail.completed && salesWritable(detail.kind, row);
    const disabled = locked || !available ? ' disabled' : '';
    const sourceDraftBlocked = !detail.completed && salesEndsOpportunity(detail) && sourceOpportunityDraft(detail);
    const input = (label, name, type = 'text', extra = '') => `<label>${label}<input class="input" name="${name}" type="${type}" value="${escapeHtml(draft[name] || '')}" ${extra}></label>`;
    const select = (label, name, options) => `<label>${label}<select class="select" name="${name}">${options.map(([value, text]) => `<option value="${value}"${draft[name] === value ? ' selected' : ''}>${text}</option>`).join('')}</select></label>`;
    let fields;
    if (detail.kind === 'stage') {
      const stages = row.stage === 'closed' ? [['qualified', opportunityStages.qualified]] : Object.entries(opportunityStages).filter(([stage]) => stage !== 'won' && stage !== row.stage);
      fields = `<div class="form-grid">${select('新阶段', 'stage', [['', '请选择'], ...stages])}${input('下次回访（北京时间，可清空）', 'nextFollowAt', 'datetime-local')}</div><p class="help">保留原时间即沿用现有回访；清空即取消，关闭商机也会取消回访。过期回访须明确调整后再推进。</p><label>阶段说明／关闭原因<textarea class="textarea" name="reason" maxlength="1000">${escapeHtml(draft.reason || '')}</textarea></label>`;
    } else if (detail.kind === 'order') fields = `${orderClassQuotePanel(detail)}${input('订单应收（元）', 'totalAmount', 'text', 'inputmode="decimal" maxlength="19" required' + (detail.classQuote ? ' readonly' : ''))}<label>订单产品／学科／学期说明<textarea class="textarea" name="productSnapshot" required maxlength="300">${escapeHtml(draft.productSnapshot || '')}</textarea></label><p class="help">创建订单时冻结当前商机负责人的成交归属；实际收款另行登记。</p>`;
    else fields = `<div class="form-grid">${input('本次实际到账金额（元）', 'amount', 'text', 'inputmode="decimal" maxlength="19" required')}${select('收款方式', 'method', Object.entries(receiptMethods))}${input('实际到账时间（北京时间）', 'receivedAt', 'datetime-local', 'required')}</div><label>凭证编号／说明<textarea class="textarea" name="reference" maxlength="1000">${escapeHtml(draft.reference || '')}</textarea></label><label><input type="checkbox" name="verified"${draft.verified === 'on' ? ' checked' : ''} required> 已核对本次款项实际到账</label><p class="help">登记实收将追加收款事实，请勿将未到账、预期收款或退款金额重复登记。</p>`;
    const summary = detail.kind === 'receipt' ? [{ label: '订单', value: row.id }, { label: '关联商机', value: row.opportunityId }, { label: '客户', value: row.customerId },
      { label: '原始成交归属', value: row.attributedOwnerId }, { label: '当前业绩归属', value: row.currentAttributionOwnerId || row.attributedOwnerId },
      { label: '应收／累计实收／退款（元）', value: [row.totalAmount, row.receivedAmount, row.refundedAmount].map(value => value ?? '—').join(' ／ ') }, { label: '订单产品', value: row.productSnapshot }, { label: '订单状态', value: orderStatuses[row.status] || row.status }]
      : [{ label: '商机', value: row.title || row.id }, { label: '客户', value: row.customerId }, { label: '负责人', value: row.ownerId }, { label: '校区', value: row.campusId },
        { label: '当前阶段', value: opportunityStages[row.stage] }, { label: '学科／学期', value: [row.subject, row.term].filter(Boolean).join(' · ') }, { label: '原回访（北京时间）', value: leadLocalTime(row.nextFollowAt).replace('T', ' ') || '未安排' }];
    let content = `<form id="java-crm-sales-form"><fieldset${disabled}>${fields}</fieldset></form>`;
    if (detail.review) content = `<h3>提交前核对</h3><dl>${detail.review.facts.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl><p class="help">确认后按以上内容提交。当前版本、归属和权限会再次核对。</p>`;
    if (detail.completed) content = `<h3>办理已完成</h3><p>${escapeHtml(salesTitles[detail.kind])}成功，记录编号：${escapeHtml(detail.completed.id)}</p><dl>${detail.completedFacts.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>${detail.postReadError ? `<p class="notice" role="alert">${escapeHtml(detail.postReadError)}</p>` : ''}`;
    const footerHtml = `${sourceDraftBlocked && !locked ? '<button class="btn" id="java-crm-sales-discard-source">放弃来源商机草稿</button>' : ''}${!detail.completed ? detail.review ? `<button class="btn" id="java-crm-sales-edit"${locked ? ' disabled' : ''}>返回修改</button><button class="btn primary" id="java-crm-sales-commit"${detail.busy || detail.loading || detail.refreshRequired && !detail.pending || sourceDraftBlocked && !detail.pending ? ' disabled' : ''}>${detail.busy ? '正在提交…' : detail.pending?.uncertain ? '使用原提交重试确认' : '确认提交'}</button>` : `<button class="btn primary" form="java-crm-sales-form" type="submit"${disabled}>核对后提交</button>` : ''}<button class="btn" id="java-crm-sales-refresh"${locked || detail.loading ? ' disabled' : ''}>刷新记录</button><button class="btn" id="java-crm-sales-back"${locked || detail.loading ? ' disabled' : ''}>返回来源页面</button><button class="btn" id="java-crm-sales-cancel"${locked || detail.loading ? ' disabled' : ''}>${detail.completed ? '关闭办理页' : '取消办理'}</button>${detail.completed && detail.kind !== 'order' ? `<button class="btn" id="java-crm-sales-again"${locked || detail.loading || detail.refreshRequired || !salesWritable(detail.kind, row) ? ' disabled' : ''}>${detail.kind === 'receipt' ? '登记另一笔实收' : '继续办理阶段'}</button>` : ''}`;
    const notice = detail.pending?.uncertain ? '提交结果暂不明确。本次内容已锁定，请使用原提交重试确认；请勿刷新页面或另建相同记录。'
      : detail.loading ? '正在读取当前授权记录…' : detail.busy ? '正在核对并提交，请稍候。' : detail.notice || (!available && !detail.completed ? '当前记录仅可查看，请核对权限、状态或刷新记录。' : '');
    return `<div id="java-crm-sales-detail">${detail.error ? `<p class="notice" role="alert">${escapeHtml(detail.error)}</p>` : ''}${followupLayout({ title: salesTitles[detail.kind], recordId: row.id, status: detail.completed ? '已完成' : detail.review ? '待确认' : '填写', summary,
      tabs: [{ id: 'transaction', label: detail.completed ? '办理结果' : detail.review ? '核对内容' : '办理信息', html: content }], activeTab: 'transaction', notice, footerHtml })}</div>`;
  }
  function salesReceipt(detail, pending, result) {
    if (!result || typeof result.id !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(result.id)) return false;
    const input = pending.input, record = pending.record;
    if (detail.kind === 'stage') return result.id === record.id && result.customerId === record.customerId
      && result.stage === input.stage && result.ownerId === record.ownerId && Number.isSafeInteger(result.version) && result.version === input.expectedVersion + 1
      && (input.nextFollowAt === null ? result.nextFollowAt === null : typeof result.nextFollowAt === 'string' && new Date(result.nextFollowAt).getTime() === new Date(input.nextFollowAt).getTime());
    try {
      if (detail.kind === 'order') return result.opportunityId === record.id && result.customerId === record.customerId
        && result.attributedOwnerId === record.ownerId && result.campusId === record.campusId && result.productSnapshot === input.productSnapshot
        && positiveMoney(result.totalAmount) === input.totalAmount && result.version === 1
        && (!input.classBinding || result.classTerms?.classId === input.classBinding.classId && result.classTerms.classVersion === input.classBinding.expectedVersion
          && result.classTerms.courseId === detail.classQuote.terms.courseId && result.classTerms.className === detail.classQuote.terms.className
          && ['courseFee','materialFee'].every(key=>salesMoneyCents(result.classTerms.fees?.[key]) !== null && salesMoneyCents(result.classTerms.fees[key]) === salesMoneyCents(detail.classQuote.terms.fees[key]))
          && ['courseRefundRule','materialRefundRule','refundLessonCount'].every(key=>result.classTerms.fees[key] === detail.classQuote.terms.fees[key]));
      return result.orderId === record.id && result.actorId === javaState.identity.principalId && (result.reference || '') === input.reference
        && positiveMoney(result.amount) === input.amount && result.method === input.method
        && Number.isFinite(new Date(result.receivedAt).getTime()) && new Date(result.receivedAt).getTime() === new Date(input.receivedAt).getTime();
    } catch (_) { return false; }
  }
  async function commitSalesTransaction() {
    const detail = javaState.transactionDetail;
    if (!detail || detail.busy || detail.loading || detail.completed || !detail.review || detail.refreshRequired && !detail.pending) return;
    detail.busy = true; detail.error = ''; render();
    if (!detail.pending) {
      try {
        guardSourceOpportunityDraft(detail, detail.review.input);
        const current = await readSalesRecord(detail);
        if (!salesWritable(detail.kind, current) || salesRecordFingerprint(detail.kind, current) !== detail.review.fingerprint) {
          detail.refreshRequired = true; throw new Error('记录版本、状态或归属已变化，填写内容已保留；请刷新记录并重新核对。');
        }
        detail.pending = { input: detail.review.input, key: detail.review.key, record: { ...current }, uncertain: false, attempted: false };
      } catch (error) {
        if (isStaleWorkspace(error) || javaState.transactionDetail !== detail) return;
        detail.busy = false; detail.error = error.message || '提交前核对失败'; detail.refreshRequired = error.sourceDraftBlocked !== true; render(); return;
      }
    }
    const pending = detail.pending;
    let result;
    try {
      // Retries deliberately do not compare current versions: the original write may already have succeeded.
      await salesIdentity(detail);
      const api = javaState.client.crm;
      pending.attempted = true;
      result = detail.kind === 'stage' ? await api.opportunities.updateStage(detail.record.id, pending.input, pending.key)
        : detail.kind === 'order' ? await api.orders.create(pending.input, pending.key)
        : await api.orders.recordReceipt(detail.record.id, pending.input, pending.key);
      if (!salesReceipt(detail, pending, result)) throw new Error('未收到可确认的办理回执。');
    } catch (error) {
      if (isStaleWorkspace(error) || javaState.transactionDetail !== detail) return;
      const rejected = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && leadRejections.has(error.code);
      if (!pending.attempted || !pending.uncertain && rejected) {
        detail.pending = null; detail.review = null; detail.refreshRequired = !pending.attempted || ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'ALREADY_EXISTS', 'PREVIEW_STALE'].includes(error.code);
        detail.error = `${error.message || '服务端拒绝了本次操作'}${detail.refreshRequired ? '；请刷新记录重新核对。' : '；可修改填写内容后重新核对。'}`;
      } else { pending.uncertain = true; detail.error = error.message || '结果尚未确认'; }
      detail.busy = false; render(); return;
    }
    if (javaState.transactionDetail !== detail) return;
    clearWorkspaceBlock();
    // Receipt confirmation ends the write. Subsequent reads cannot turn a confirmed write into an unknown submission.
    detail.completed = result; detail.completedFacts = detail.review.facts; detail.pending = null; detail.review = null;
    detail.busy = false; detail.draftChanged = false; detail.notice = '已确认保存成功。'; detail.context.dirty = true;
    if (detail.kind === 'stage') detail.record = result;
    await refreshSalesTransaction();
  }
  async function returnFromSalesTransaction(discard = false, guarded = false) {
    const detail = javaState.transactionDetail; if (!detail || salesIsLocked(detail) || detail.loading) return;
    if (discard && !detail.completed && sessionDirty(javaState) && !root.confirm('确认取消本次办理并放弃未保存的内容吗？')) return;
    if (workTabs) {
      const key = activeWorkKey;
      const target = workSessions.has(detail.originKey) ? detail.originKey : pageWorkKey(detail.context.page);
      if (!workSessions.has(target)) workSessions.set(target, { data: { ...newPageSnapshot(detail.context.page), listQuery: detail.context.listQuery, queueContext: detail.context.queueContext, pageNumber: detail.context.pageNumber }, scrollY: detail.context.scrollY || 0 });
      await activateWorkSession(target);
      if (discard && activeWorkKey !== key) { workSessions.delete(key); workTabs.remove(key); }
      return;
    }
    if (!discard && !guarded && !detail.completed && sessionDirty(javaState) && !root.confirm('确认离开并放弃本次办理内容吗？')) return;
    navigationEpoch++; Object.assign(javaState, detail.origin); state.page = javaState.page;
    if (javaState.opportunityDetail) await refreshOpportunityDetail();
    else await loadDirectory(detail.context.page, detail.context.listQuery, detail.context.pageNumber);
    root.scrollTo?.(0, detail.context.scrollY || 0);
  }
  function bindSalesTransaction() {
    const detail = javaState.transactionDetail; if (!detail) return;
    bindFollowupTabs(document.getElementById('java-crm-sales-detail'), detail);
    document.getElementById('java-crm-order-classes-load')?.addEventListener('click',()=>loadOrderClassQuotes());
    document.querySelectorAll('[data-order-class-page]').forEach(button=>button.addEventListener('click',()=>loadOrderClassQuotes(Number(button.dataset.orderClassPage))));
    document.querySelectorAll('[data-order-class-pick]').forEach(button=>button.addEventListener('click',()=>{
      if(salesIsLocked(detail) || detail.review || detail.completed || detail.quotesBusy) return;
      const quote=detail.quotes?.items.find(row=>row.terms?.classId===button.dataset.orderClassPick);
      try {
        if(!quote || !Number.isSafeInteger(quote.terms.classVersion) || quote.terms.classVersion<1 || typeof quote.terms.courseId!=='string' || !quote.terms.courseId
          || salesMoneyCents(quote.terms.fees?.courseFee)===null || salesMoneyCents(quote.terms.fees?.materialFee)===null
          || salesMoneyCents(quote.totalAmount)!==salesMoneyCents(quote.terms.fees.courseFee)+salesMoneyCents(quote.terms.fees.materialFee)) throw Error('班级报价无效，请重新查询');
        const amount=positiveMoney(quote.totalAmount);detail.classQuote=JSON.parse(JSON.stringify(quote));detail.draft.totalAmount=amount;detail.draft.productSnapshot=quote.terms.className;
        detail.draftChanged=true;detail.quotes=null;detail.error='';render();
      } catch(error) { detail.error=error.message;render(); }
    }));
    document.getElementById('java-crm-order-class-clear')?.addEventListener('click',()=>{
      if(salesIsLocked(detail) || detail.review || detail.completed) return;
      detail.classQuote=null;detail.draft.totalAmount='';detail.draftChanged=true;render();
    });
    const form = document.getElementById('java-crm-sales-form');
    const update = (name, value) => {
      if (javaState.transactionDetail !== detail || salesIsLocked(detail) || detail.review || detail.completed || !Object.prototype.hasOwnProperty.call(detail.draft, name)) return;
      detail.draft[name] = String(value); const defaults = salesDraft(detail.kind, detail.record, detail.initialReceivedAt);
      detail.draftChanged = Object.keys(defaults).some(key => detail.draft[key] !== defaults[key]); syncWorkTab();
    };
    const change = event => update(event.target.name, event.target.type === 'checkbox' ? event.target.checked ? 'on' : '' : event.target.value);
    form?.addEventListener('input', change); form?.addEventListener('change', change);
    form?.addEventListener('submit', event => {
      event.preventDefault(); if (detail.quotesBusy) return;
      if (javaState.transactionDetail !== detail || salesIsLocked(detail) || detail.review || detail.loading || detail.refreshRequired || detail.completed || !salesWritable(detail.kind, detail.record)) return;
      if (detail.kind === 'receipt') update('verified', '');
      new FormData(event.currentTarget).forEach((value, key) => update(key, value));
      try {
        const input = Object.freeze(salesInput(detail));
        detail.review = { input, key: idempotencyKey(), fingerprint: salesRecordFingerprint(detail.kind, detail.record), facts: salesReviewFacts(detail, input) };
        detail.error = ''; render();
      } catch (error) { detail.error = error.message || '请核对填写内容'; render(); }
    });
    document.getElementById('java-crm-sales-discard-source')?.addEventListener('click', () => {
      if (salesIsLocked(detail) || detail.completed) return;
      const source = sourceOpportunityDraft(detail);
      if (!source || !root.confirm('确认放弃来源商机未保存的跟进内容吗？已保存的跟进记录将保留。')) return;
      source.draft = opportunityDraft(source.opportunity); source.draftChanged = false;
      const key = opportunityWorkKey(source.opportunity.id), saved = workSessions.get(key);
      if (saved) workTabs?.upsert({ key, title: `商机 · ${source.opportunity.title || source.opportunity.id}`, closable: true, dirty: sessionDirty(saved.data) }, { active: false });
      detail.error = ''; render();
    });
    document.getElementById('java-crm-sales-edit')?.addEventListener('click', () => { if (!salesIsLocked(detail)) { detail.review = null; render(); } });
    document.getElementById('java-crm-sales-commit')?.addEventListener('click', commitSalesTransaction);
    document.getElementById('java-crm-sales-refresh')?.addEventListener('click', refreshSalesTransaction);
    document.getElementById('java-crm-sales-back')?.addEventListener('click', () => returnFromSalesTransaction());
    document.getElementById('java-crm-sales-cancel')?.addEventListener('click', () => returnFromSalesTransaction(true));
    document.getElementById('java-crm-sales-again')?.addEventListener('click', async () => {
      if (!detail.completed || detail.kind === 'order' || detail.refreshRequired || detail.loading || !salesWritable(detail.kind, detail.record)) return;
      detail.completed = null; detail.initialReceivedAt = new Date().toISOString(); detail.draft = salesDraft(detail.kind, detail.record, detail.initialReceivedAt); detail.draftChanged = false; detail.notice = ''; await refreshSalesTransaction();
    });
  }

  function serviceTicketDetailPage() {
    const { ticket, events } = javaState.ticketDetail;
    const permissions = javaState.identity.permissions || [];
    const canLinkRefund = permissions.includes('crm.ticket.write') && permissions.includes('crm.refund.read')
      && permissions.includes('crm.order.read') && !ticket.refundRequestId && !['closed', 'cancelled'].includes(ticket.status);
    return `<div class="heading"><div><h1>${escapeHtml(ticket.title)}</h1><p class="subtitle">服务工单 · 处理过程、转派和售后关联按时间留痕。</p></div><div class="actions"><button class="btn" id="java-crm-ticket-back">返回工单</button>${canLinkRefund ? '<button class="btn primary" id="java-crm-ticket-refund-link">关联退款申请</button>' : ''}</div></div>${javaState.error ? `<p class="notice" role="alert">${escapeHtml(javaState.error)}</p>` : ''}<div class="card pad"><h2 class="section-title">工单概况</h2><p>客户 ${escapeHtml(ticket.customerId)} · 类型 ${escapeHtml(ticket.type)} · 校区 ${escapeHtml(ticket.campusId)} · 负责人 ${escapeHtml(ticket.ownerId)}</p><p>状态 ${escapeHtml(ticket.status)} · 截止 ${escapeHtml(ticket.dueAt || '未设置')} · 下次回访 ${escapeHtml(ticket.nextFollowAt || '未安排')}</p><p>${escapeHtml(ticket.description || '暂无问题描述')}</p><p>退款申请 ${escapeHtml(ticket.refundRequestId || '未关联')} · 状态 ${escapeHtml(ticket.refundStatus || '—')} · 金额 ${escapeHtml(ticket.refundAmount ?? '—')} · 时间 ${escapeHtml(ticket.refundAt || '—')}</p><p>处理结论 ${escapeHtml(ticket.resolution || '未办结')} · 实际结果 ${escapeHtml(ticket.actualResult || '—')}</p></div><div class="card pad" style="margin-top:18px"><h2 class="section-title">处理时间线</h2><div class="table-wrap"><table class="table"><thead><tr><th>时间</th><th>事件</th><th>员工</th><th>状态变化</th><th>退款申请</th><th>说明 / 结果</th></tr></thead><tbody>${events.map(event => `<tr><td>${escapeHtml(event.occurredAt)}</td><td>${escapeHtml(event.eventType)}</td><td>${escapeHtml(event.actorId)}</td><td>${escapeHtml([event.fromStatus, event.toStatus].filter(Boolean).join(' → ') || '—')}</td><td>${escapeHtml(event.refundRequestId || '—')}</td><td>${escapeHtml([event.detail, event.actualResult].filter(Boolean).join(' · ') || '—')}</td></tr>`).join('') || '<tr><td colspan="6">暂无处理记录</td></tr>'}</tbody></table></div></div>`;
  }

  function render() {
    syncResourceSearch();
    if (!javaState.identity) return;
    title.textContent = supported.get(javaState.page) || '工作台';
    const back = document.getElementById('workspace-back');
    if (back) back.disabled = (javaState.page === 'home' && !javaState.leadDetail) || taskDetailLocked() || leadIsLocked() || opportunityIsLocked() || salesIsLocked() || javaState.activityCreateBusy || javaState.activityCreateUncertain || javaState.needDetail?.module.canLeave() === false || pendingWrites > 0;
    syncWorkTab();
    if (tabRestoring || javaState.accessDenied) {
      view.innerHTML = `<p class="notice" role="status">${escapeHtml(tabRestoring ? '正在核对工作页权限与最新记录…' : javaState.error)}</p>`; return;
    }
    if (javaState.needDetail) {
      view.innerHTML = (javaState.error ? `<p class="notice" role="alert">${escapeHtml(javaState.error)}</p>` : '') + javaState.needDetail.module.html();
      javaState.needDetail.module.bind(view); return;
    }
    if (academicPages.has(javaState.page)) {
      view.innerHTML = (javaState.error ? `<p class="notice" role="alert">${escapeHtml(javaState.error)}</p>` : '')
        + (academicWorkspace?.html() || '<p role="alert">教务工作区未加载，请刷新后重试。</p>');
      academicWorkspace?.bind();
      return;
    }
    if (commercePages.has(javaState.page)) {
      view.innerHTML = (javaState.error ? `<p class="notice" role="alert">${escapeHtml(javaState.error)}</p>` : '')
        + (commerceWorkspace?.html() || '<p role="alert">商城工作区未加载，请刷新后重试。</p>');
      commerceWorkspace?.bind(view);
      return;
    }
    view.innerHTML = javaState.page === 'home' ? workbench() : directory();
    document.getElementById('java-crm-scope')?.addEventListener('change', event => {
      javaState.view = event.target.value;
      void loadWorkbench();
    });
    document.getElementById('java-crm-refresh')?.addEventListener('click', () => void loadDirectory(javaState.page, javaState.listQuery, javaState.pageNumber));
    document.getElementById('java-crm-import-reset')?.addEventListener('click', () => {
      if (javaState.importBusy || javaState.importUncertain) return;
      javaState.importInput = null;
      javaState.importPreview = null;
      javaState.importReceipt = null;
      javaState.importIdempotencyKey = '';
      javaState.error = '';
      render();
    });
    document.getElementById('java-crm-import-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      if (javaState.importBusy || javaState.importUncertain) return;
      const formData = new FormData(event.currentTarget);
      const file = formData.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') return;
      const format = file.name.toLowerCase().endsWith('.csv') ? 'csv' : file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : '';
      if (!format) { javaState.error = '仅支持 CSV 或 XLSX 文件。'; render(); return; }
      if (file.size > 680000) { javaState.error = '文件超过 680 KB，请拆分成多个批次后导入。'; render(); return; }
      let mapping;
      try {
        mapping = JSON.parse(String(formData.get('mapping') || ''));
        if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object') throw new Error('列映射必须是 JSON 对象。');
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '列映射 JSON 无效。'; render(); return; }
      const epoch = navigationEpoch;
      javaState.importBusy = true;
      javaState.error = '';
      javaState.importReceipt = null;
      javaState.importPreview = null;
      javaState.importIdempotencyKey = '';
      render();
      try {
        const buffer = await file.arrayBuffer();
        if (epoch !== navigationEpoch) return;
        const content = format === 'csv' ? new TextDecoder('utf-8', { fatal: true }).decode(buffer) : bytesToBase64(new Uint8Array(buffer));
        const input = { format, content, mapping, campusId: String(formData.get('campusId') || ''),
          activityId: String(formData.get('activityId') || '').trim() || null,
          source: String(formData.get('source') || 'other'), fileName: file.name };
        javaState.importInput = input;
        javaState.importPreview = await javaState.client.crm.imports.preview(input);
        javaState.importIdempotencyKey = idempotencyKey();
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '导入预览失败';
      } finally {
        if (epoch === navigationEpoch) { javaState.importBusy = false; render(); }
      }
    });
    document.getElementById('java-crm-import-apply')?.addEventListener('click', async () => {
      const summary = javaState.importPreview?.summary;
      const eligible = Number(summary?.newCustomer || 0) + Number(summary?.existingTouch || 0);
      if (!javaState.importInput || !eligible || !root.confirm(`确认提交 ${eligible} 行有效数据？需人工核对或无效的数据不会被导入。`)) return;
      const epoch = navigationEpoch;
      javaState.importBusy = true;
      javaState.error = '';
      render();
      try {
        javaState.importReceipt = await javaState.client.crm.imports.apply(javaState.importInput, javaState.importIdempotencyKey);
        javaState.importPreview = null; javaState.importUncertain = false; clearWorkspaceBlock();
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.importUncertain = javaState.importUncertain || !(Number.isInteger(error.status) && error.status >= 400 && error.status < 500);
        javaState.error = error.message || '导入提交失败；重试将沿用同一幂等键。';
      } finally {
        if (epoch === navigationEpoch) { javaState.importBusy = false; render(); }
      }
    });
    document.getElementById('java-crm-page-prev')?.addEventListener('click', () => {
      if (javaState.pageNumber > 1) void loadDirectory(javaState.page, javaState.listQuery, javaState.pageNumber - 1);
    });
    document.getElementById('java-crm-page-next')?.addEventListener('click', () => {
      const total = Number(javaState.list?.total ?? javaState.list?.orderCount) || 0;
      const size = Number(javaState.list?.size) || 50;
      if (javaState.pageNumber < Math.ceil(total / size)) void loadDirectory(javaState.page, javaState.listQuery, javaState.pageNumber + 1);
    });
    document.getElementById('java-crm-activity-filters')?.addEventListener('submit', event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const query = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value || '').trim()])
        .filter(([key, value]) => value && ['view', 'activityType', 'status', 'campusId', 'query'].includes(key)));
      if (!query.view) query.view = 'scope';
      void loadDirectory('crmCampaigns', query, 1);
    });
    document.getElementById('java-crm-activity-reset')?.addEventListener('click', () => {
      javaState.error = ''; void loadDirectory('crmCampaigns', {}, 1);
    });
    document.getElementById('java-crm-activity-create')?.addEventListener('click', () => {
      if (javaState.activityCreateBusy || javaState.activityCreateUncertain) return;
      if (!javaState.activityDraft) {
        javaState.activityDraft = newActivityDraft();
        javaState.activityDraft.campusId = javaState.identity.campusIds?.[0] || '';
      }
      javaState.error = ''; render();
    });
    document.getElementById('java-crm-activity-cancel')?.addEventListener('click', () => {
      if (javaState.activityCreateBusy || javaState.activityCreateUncertain) return;
      if (javaState.activityDraft?.dirty && !root.confirm('取消将放弃当前活动草稿，确认继续吗？')) return;
      javaState.activityDraft = null; javaState.activityCreateInput = null; javaState.activityCreateKey = null;
      javaState.error = ''; render();
    });
    document.getElementById('java-crm-activity-form')?.addEventListener('input', event => {
      if (!javaState.activityDraft || javaState.activityCreateBusy || javaState.activityCreateUncertain) return;
      const field = event.target?.name;
      if (!field || !Object.hasOwn(javaState.activityDraft, field)) return;
      javaState.activityDraft[field] = event.target.value; javaState.activityDraft.dirty = true;
      javaState.activityCreateInput = null; javaState.activityCreateKey = null;
    });
    const submitActivityCreate = async retry => {
      if (!javaState.activityDraft || javaState.activityCreateBusy || retry !== javaState.activityCreateUncertain) return;
      let input = javaState.activityCreateInput;
      if (!retry) {
        const draft = javaState.activityDraft;
        const participants = parseCodeList(draft.participantIds), promoters = parseCodeList(draft.promoterIds);
        if (!participants || !promoters) { javaState.error = '员工编号格式无效；使用英文字母、数字、点、横线或下划线，编号之间用逗号分隔。'; render(); return; }
        try {
          const startsAt = toJavaInstant(draft.startsAt), endsAt = toJavaInstant(draft.endsAt);
          if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('活动结束时间须晚于开始时间。');
          input = { campusId: draft.campusId.trim(), title: draft.title.trim(), activityType: draft.activityType,
            startsAt, endsAt, description: draft.description.trim(), participantIds: participants, promoterIds: promoters };
          if (!input.campusId || !input.title) throw new Error('请填写校区和活动名称。');
        } catch (error) { javaState.error = error.message || '活动信息无效。'; render(); return; }
        javaState.activityCreateInput = input;
        javaState.activityCreateKey = idempotencyKey();
      }
      const epoch = navigationEpoch;
      javaState.activityCreateBusy = true; javaState.error = ''; render();
      try {
        const identity = await javaState.client.identity.me();
        if (identity.principalId !== javaState.identity.principalId || !identity.permissions?.includes('crm.activity.write')) {
          throw Object.assign(new Error('当前账号已没有创建活动权限，请重新登录或联系管理员。'), { status: 403 });
        }
        await javaState.client.crm.activities.create(input, javaState.activityCreateKey);
        if (epoch !== navigationEpoch) return;
        javaState.activityDraft = null; javaState.activityCreateInput = null; javaState.activityCreateKey = null;
        javaState.activityCreateUncertain = false; javaState.error = '';
        await loadDirectory('crmCampaigns', {}, 1);
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        if (epoch !== navigationEpoch) return;
        javaState.activityCreateUncertain = !(Number.isInteger(error.status) && error.status >= 400 && error.status < 500);
        if (!javaState.activityCreateUncertain) { javaState.activityCreateInput = null; javaState.activityCreateKey = null; }
        javaState.error = javaState.activityCreateUncertain
          ? `${error.message || '活动创建结果未确认'}；按原请求重试，不要修改内容或重复新建。`
          : (error.message || '活动创建失败，请检查字段后重试。');
      } finally {
        if (epoch === navigationEpoch) { javaState.activityCreateBusy = false; render(); }
      }
    };
    document.getElementById('java-crm-activity-form')?.addEventListener('submit', event => {
      event.preventDefault(); void submitActivityCreate(false);
    });
    document.getElementById('java-crm-activity-retry')?.addEventListener('click', () => void submitActivityCreate(true));
    document.getElementById('java-crm-form-create')?.addEventListener('click', async () => {
      const input = askMarketingForm();
      if (!input) return;
      await runMutation(() => javaState.client.crm.forms.create(input, idempotencyKey()), 'marketingForms');
    });
    bindTaskBatch();
    bindActivityAudience();
    bindTaskDetail();
    document.getElementById('java-crm-routing-rule-create')?.addEventListener('click', async () => {
      const input = askRoutingRuleInput();
      if (!input) return;
      try {
        await javaState.client.crm.leadRouting.createRule(input, idempotencyKey());
        javaState.error = '';
        await loadDirectory('crmRouting');
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '分配规则创建失败'; render(); }
    });
    document.querySelectorAll('[data-routing-rule-edit]').forEach(button => button.addEventListener('click', async () => {
      const rule = javaState.list?.rules?.items?.find(item => item.id === button.dataset.routingRuleEdit);
      if (!rule) return;
      const input = askRoutingRuleInput(rule);
      if (!input) return;
      input.expectedVersion = Number(button.dataset.version);
      try {
        await javaState.client.crm.leadRouting.updateRule(rule.id, input, idempotencyKey());
        javaState.error = '';
        await loadDirectory('crmRouting', {}, javaState.routingRulePage);
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '分配规则更新失败'; render(); }
    }));
    document.querySelectorAll('[data-routing-page]').forEach(button => button.addEventListener('click', () => {
      const pageNumber = Number(button.dataset.page);
      if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) return;
      if (button.dataset.routingPage === 'rules') javaState.routingRulePage = pageNumber;
      else if (button.dataset.routingPage === 'queue') javaState.routingQueuePage = pageNumber;
      else return;
      javaState.routingPreview = null;
      javaState.routingSelection.clear();
      void loadDirectory('crmRouting');
    }));
    document.querySelectorAll('[data-form-edit]').forEach(button => button.addEventListener('click', async () => {
      const form = javaState.list?.items?.find(item => item.id === button.dataset.formEdit);
      if (!form) return;
      const input = askMarketingForm(form);
      if (!input) return;
      await runMutation(() => javaState.client.crm.forms.update(form.id, input, form.version, idempotencyKey()), 'marketingForms');
    }));
    document.querySelectorAll('[data-form-publish]').forEach(button => button.addEventListener('click', async () => {
      if (!root.confirm('发布当前草稿版本？已发布版本不可修改，后续调整需生成新版本。')) return;
      await runMutation(() => javaState.client.crm.forms.publish(button.dataset.formPublish, {
        expectedVersion: Number(button.dataset.version)
      }, idempotencyKey()), 'marketingForms');
    }));
    document.querySelectorAll('[data-activity-close]').forEach(button => button.addEventListener('click', async () => {
      if (!root.confirm('结束此活动？已记录的来源触点将保留。')) return;
      await runMutation(() => javaState.client.crm.activities.close(button.dataset.activityClose, {
        expectedVersion: Number(button.dataset.version)
      }, idempotencyKey()), 'crmCampaigns');
    }));
    document.querySelectorAll('[data-activity-members]').forEach(button => button.addEventListener('click', async () => {
      const participantText = root.prompt('参与员工编号（逗号分隔，可留空）', button.dataset.participants || '');
      if (participantText === null) return;
      const promoterText = root.prompt('推广员工编号（逗号分隔，可留空）', button.dataset.promoters || '');
      if (promoterText === null) return;
      const participantIds = parseCodeList(participantText);
      const promoterIds = parseCodeList(promoterText);
      if (!participantIds || !promoterIds) { javaState.error = '员工编号列表格式无效。'; render(); return; }
      await runMutation(() => javaState.client.crm.activities.updateMembers(button.dataset.activityMembers, {
        participantIds, promoterIds, expectedVersion: Number(button.dataset.version)
      }, idempotencyKey()), 'crmCampaigns');
    }));
    document.querySelectorAll('[data-activity-form]').forEach(button => button.addEventListener('click', async () => {
      const formId = root.prompt('请输入已发布的表单编号');
      if (!formId?.trim()) return;
      await runMutation(() => javaState.client.crm.forms.linkActivityForm(button.dataset.activityForm,
        { formId: formId.trim() }, idempotencyKey()), 'crmCampaigns');
    }));
    document.querySelectorAll('[data-routing-lead]').forEach(input => input.addEventListener('change', () => {
      const id = input.dataset.routingLead;
      if (input.checked) javaState.routingSelection.set(id, Number(input.dataset.version));
      else javaState.routingSelection.delete(id);
      javaState.routingPreview = null;
      render();
    }));
    document.getElementById('java-crm-routing-preview')?.addEventListener('click', async () => {
      const leads = [...javaState.routingSelection].map(([leadId, expectedVersion]) => ({ leadId, expectedVersion }));
      try {
        javaState.routingPreview = await javaState.client.crm.leadRouting.preview({ leads });
        javaState.error = '';
        render();
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '分配预览失败';
        render();
      }
    });
    document.getElementById('java-crm-routing-apply')?.addEventListener('click', async () => {
      const leads = [...javaState.routingSelection].map(([leadId, expectedVersion]) => ({ leadId, expectedVersion }));
      if (!javaState.routingPreview?.assignable || !root.confirm(`将重新校验并处理 ${leads.length} 条线索，确认继续？`)) return;
      try {
        await javaState.client.crm.leadRouting.apply({ leads }, idempotencyKey());
        javaState.routingSelection.clear();
        javaState.routingPreview = null;
        await loadDirectory('crmRouting');
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '批量分配失败';
        render();
      }
    });
    const customerSearchForm = document.getElementById('java-crm-customer-search');
    const captureCustomerSearch = form => {
      const values = new FormData(form);
      javaState.customerSearchDraft = { searchType: values.get('searchType')?.toString() || 'name', query: values.get('query')?.toString() || '' };
      return javaState.customerSearchDraft;
    };
    const runCustomerSearch = event => {
      event.preventDefault(); if (javaState.page !== 'crmCustomers' || !canLeaveWorkspace()) return;
      const draft = captureCustomerSearch(event.currentTarget), query = draft.query.trim() ? draft.query : '';
      void loadDirectory('crmCustomers', { searchType: draft.searchType, ...(query ? { query } : {}) }, 1);
    };
    customerSearchForm?.addEventListener('submit', runCustomerSearch);
    customerSearchForm?.addEventListener('input', event => { if (javaState.page === 'crmCustomers' && canLeaveWorkspace()) captureCustomerSearch(event.currentTarget); });
    customerSearchForm?.addEventListener('change', event => { if (event.target.name === 'searchType') runCustomerSearch(event); });
    document.getElementById('java-crm-access-create')?.addEventListener('click', async () => {
      const principalId = root.prompt('稳定员工编号（仅字母、数字、下划线、连字符）');
      if (!principalId?.trim()) return;
      const issuer = root.prompt('OIDC issuer 绝对 HTTPS 地址');
      if (!issuer?.trim()) return;
      const subject = root.prompt('OIDC subject（由身份服务提供）');
      if (!subject?.trim()) return;
      const scope = root.prompt('数据范围：all / campus / assigned / own', 'own');
      if (!['all', 'campus', 'assigned', 'own'].includes(scope)) return;
      const permissionsText = root.prompt(`授权代码（逗号分隔；可多选）：\n${accessPermissionCatalog.join(', ')}`);
      if (permissionsText === null) return;
      const campusText = scope === 'all' ? '' : root.prompt('可访问校区编号（逗号分隔；全局范围不需要）', '');
      if (campusText === null) return;
      const permissionCodes = parseCodeList(permissionsText);
      const campusIds = parseCodeList(campusText);
      if (!permissionCodes || !campusIds) { javaState.error = '权限或校区编号列表格式无效。'; render(); return; }
      if (permissionCodes.some(code => !accessPermissionCatalog.includes(code))) {
        javaState.error = '权限列表中有未登记的代码，请从系统权限目录中选择。'; render(); return;
      }
      try {
        await javaState.client.system.access.createPrincipal({ principalId: principalId.trim(), issuer: issuer.trim(),
          subject: subject.trim(), scope, permissionCodes, campusIds }, idempotencyKey());
        await loadDirectory('permissions');
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '员工账号创建失败'; render(); }
    });
    document.querySelectorAll('[data-access-edit]').forEach(button => button.addEventListener('click', async () => {
      const principal = javaState.list?.items?.find(item => item.principalId === button.dataset.accessEdit);
      if (!principal || principal.principalId === javaState.identity.principalId) return;
      const scope = root.prompt('数据范围：all / campus / assigned / own', principal.scope);
      if (!['all', 'campus', 'assigned', 'own'].includes(scope)) return;
      const activeValue = root.prompt('账号启用：true / false', String(principal.active));
      if (!['true', 'false'].includes(activeValue)) return;
      const permissionsText = root.prompt(`权限代码（逗号分隔）：\n${accessPermissionCatalog.join(', ')}`, principal.permissionCodes.join(','));
      if (permissionsText === null) return;
      const campusText = scope === 'all' ? '' : root.prompt('授权校区编号（逗号分隔）', principal.campusIds.join(','));
      if (campusText === null) return;
      const permissionCodes = parseCodeList(permissionsText);
      const campusIds = parseCodeList(campusText);
      if (!permissionCodes || !campusIds) { javaState.error = '权限或校区编号列表格式无效。'; render(); return; }
      if (permissionCodes.some(code => !accessPermissionCatalog.includes(code))) {
        javaState.error = '权限列表中有未登记的代码，请从系统权限目录中选择。'; render(); return;
      }
      try {
        await javaState.client.system.access.updatePrincipal(principal.principalId, {
          expectedVersion: Number(principal.version), scope, active: activeValue === 'true', permissionCodes, campusIds
        }, idempotencyKey());
        await loadDirectory('permissions');
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '员工授权更新失败'; render(); }
    }));
    document.getElementById('java-crm-queue-filters')?.addEventListener('submit', event => {
      event.preventDefault();
      const query = {};
      new FormData(event.currentTarget).forEach((value, key) => {
        const normalized = value.toString().trim();
        if (normalized) query[key] = normalized;
      });
      javaState.selectedSavedViewId = '';
      void loadDirectory(javaState.page, query);
    });
    document.getElementById('java-crm-saved-view')?.addEventListener('change', event => {
      javaState.selectedSavedViewId = event.currentTarget.value;
      render();
    });
    document.getElementById('java-crm-view-apply')?.addEventListener('click', () => {
      const saved = javaState.savedViews.find(item => item.id === javaState.selectedSavedViewId);
      if (saved) void loadDirectory(javaState.page, saved.filters);
    });
    document.getElementById('java-crm-view-save')?.addEventListener('click', async () => {
      const resourceType = savedViewResourceForPage(javaState.page);
      if (!resourceType) return;
      const name = root.prompt('个人视图名称');
      if (!name?.trim()) return;
      try {
        const saved = await javaState.client.crm.savedViews.create({
          resourceType, name: name.trim(), filters: currentSavedViewFilters(resourceType)
        }, idempotencyKey());
        javaState.selectedSavedViewId = saved.id;
        await loadSavedViews(javaState.page);
        javaState.error = '';
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '保存个人视图失败'; }
      render();
    });
    document.getElementById('java-crm-view-rename')?.addEventListener('click', async () => {
      const resourceType = savedViewResourceForPage(javaState.page);
      const saved = javaState.savedViews.find(item => item.id === javaState.selectedSavedViewId);
      if (!resourceType || !saved) return;
      const name = root.prompt('个人视图新名称', saved.name);
      if (!name?.trim()) return;
      try {
        await javaState.client.crm.savedViews.update(saved.id, {
          name: name.trim(), filters: saved.filters, expectedVersion: saved.version
        }, idempotencyKey());
        await loadSavedViews(javaState.page);
        javaState.error = '';
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '视图重命名失败'; }
      render();
    });
    document.getElementById('java-crm-view-update')?.addEventListener('click', async () => {
      const resourceType = savedViewResourceForPage(javaState.page);
      const saved = javaState.savedViews.find(item => item.id === javaState.selectedSavedViewId);
      if (!resourceType || !saved) return;
      try {
        await javaState.client.crm.savedViews.update(saved.id, {
          name: saved.name, filters: currentSavedViewFilters(resourceType), expectedVersion: saved.version
        }, idempotencyKey());
        await loadSavedViews(javaState.page);
        javaState.error = '';
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '个人视图筛选更新失败'; }
      render();
    });
    document.getElementById('java-crm-view-delete')?.addEventListener('click', async () => {
      const saved = javaState.savedViews.find(item => item.id === javaState.selectedSavedViewId);
      if (!saved || !root.confirm(`删除个人视图“${saved.name}”？`)) return;
      try {
        await javaState.client.crm.savedViews.remove(saved.id, { expectedVersion: saved.version }, idempotencyKey());
        javaState.selectedSavedViewId = '';
        await loadSavedViews(javaState.page);
        javaState.error = '';
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '视图删除失败'; }
      render();
    });
    document.getElementById('java-crm-customer-create')?.addEventListener('click', async () => {
      if (root.SiyueCrmNeeds && javaState.identity.permissions.includes('crm.opportunity.intake')) return openNeedWorkspace({ mode: 'intake', register: true });
      const input = askCustomerInput();
      if (!input) return;
      try {
        const customer = await javaState.client.crm.customers.create(input, idempotencyKey());
        javaState.customerDetail = { customer, touchpoints: [] };
        javaState.error = '';
        render();
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '客户档案创建失败';
        render();
      }
    });
    document.querySelectorAll('[data-customer-id]').forEach(button => button.addEventListener('click', async () => {
      javaState.error = '';
      try {
        const id = button.dataset.customerId;
        const canReadOpportunities = javaState.identity.permissions?.includes('crm.opportunity.read');
        const [customerResult, touchpointResult, opportunityResult] = await Promise.allSettled([
          javaState.client.crm.customers.get(id), javaState.client.crm.customers.touchpoints.list(id),
          canReadOpportunities ? javaState.client.crm.opportunities.list({ customerId: id, page: 1, size: 50 }) : Promise.resolve(null)
        ]);
        if (customerResult.status === 'rejected') throw customerResult.reason;
        javaState.customerDetail = { customer: customerResult.value,
          touchpoints: touchpointResult.status === 'fulfilled' ? touchpointResult.value : [],
          touchpointError: touchpointResult.status === 'rejected' ? touchpointResult.reason.message : '',
          opportunities: canReadOpportunities && opportunityResult.status === 'fulfilled' ? opportunityResult.value.items : null,
          opportunityError: opportunityResult.status === 'rejected' ? opportunityResult.reason.message : '' };
        render();
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '客户详情加载失败';
        render();
      }
    }));
    document.querySelectorAll('[data-customer-lead]').forEach(button => button.addEventListener('click', async () => {
      const customer = javaState.customerDetail?.customer;
      const input = askLeadInput(customer, button.dataset.customerLead);
      if (!input) return;
      try {
        const lead = await javaState.client.crm.leads.create(input, idempotencyKey());
        javaState.error = `已登记线索 ${lead.id}，负责人 ${lead.ownerId || '待分配'}。`;
        render();
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '线索登记失败';
        render();
      }
    }));
    document.querySelectorAll('[data-lead-detail]').forEach(button => button.addEventListener('click', () => openLeadDetail(button.dataset.leadDetail)));
    bindLeadDetail();
    document.querySelectorAll('[data-opportunity-detail]').forEach(button => button.addEventListener('click', () => openOpportunityDetail(button.dataset.opportunityDetail)));
    bindOpportunityDetail();
    document.getElementById('java-crm-opportunity-needs')?.addEventListener('click', () => {
      if (javaState.opportunityDetail && !opportunityIsLocked()) return openNeedWorkspace({ mode: 'profile', opportunityId: javaState.opportunityDetail.opportunity.id });
    });
    document.querySelectorAll('[data-opportunity-stage]').forEach(button => button.addEventListener('click', () => openSalesTransaction('stage', button.dataset.opportunityStage)));
    document.querySelectorAll('[data-order-create]').forEach(button => button.addEventListener('click', () => openSalesTransaction('order', button.dataset.orderCreate)));
    document.querySelectorAll('[data-order-receipt]').forEach(button => button.addEventListener('click', () => openSalesTransaction('receipt', button.dataset.orderReceipt)));
    bindSalesTransaction();
    document.querySelectorAll('[data-attribution-order]').forEach(button => button.addEventListener('click', async () => {
      const order = javaState.list?.items?.find(item => item.id === button.dataset.attributionOrder);
      if (!order) return;
      javaState.attributionRequestPage = 1;
      try { await refreshAttributionDetail(order); }
      catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '归因详情加载失败'; }
      render();
    }));
    document.getElementById('java-crm-attribution-back')?.addEventListener('click', () => {
      javaState.attributionDetail = null;
      javaState.error = '';
      render();
    });
    document.getElementById('java-crm-attribution-prev')?.addEventListener('click', async () => {
      if (javaState.attributionRequestPage <= 1) return;
      javaState.attributionRequestPage -= 1;
      await refreshAttributionDetail(javaState.attributionDetail.order);
      render();
    });
    document.getElementById('java-crm-attribution-next')?.addEventListener('click', async () => {
      const detail = javaState.attributionDetail;
      const pages = Math.ceil((Number(detail?.requests?.total) || 0) / (Number(detail?.requests?.size) || 50));
      if (!detail || javaState.attributionRequestPage >= pages) return;
      javaState.attributionRequestPage += 1;
      await refreshAttributionDetail(detail.order);
      render();
    });
    document.getElementById('java-crm-attribution-request')?.addEventListener('click', async () => {
      const detail = javaState.attributionDetail;
      if (!detail) return;
      const proposedOwnerId = root.prompt('申请的新成交归属员工编号');
      if (!proposedOwnerId?.trim()) return;
      const reason = root.prompt('纠错原因（必填）');
      if (!reason?.trim()) return;
      const evidence = root.prompt('凭证说明（可留空）');
      if (evidence === null) return;
      try {
        await javaState.client.crm.attribution.requestCorrection(detail.order.id, {
          proposedOwnerId: proposedOwnerId.trim(), reason: reason.trim(), evidence: evidence.trim() || null
        }, idempotencyKey());
        javaState.attributionRequestPage = 1;
        await refreshAttributionDetail(detail.order);
        javaState.error = '';
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '归因纠错申请失败'; }
      render();
    });
    document.getElementById('java-crm-ticket-type-create')?.addEventListener('click', async () => {
      const campusIds = javaState.identity.campusIds || [];
      let campusId = null;
      if (javaState.identity.scope !== 'all') {
        campusId = root.prompt(`校区编号：\n${campusIds.join('\n')}`, campusIds[0] || '');
        if (!campusId || !campusIds.includes(campusId.trim())) return;
        campusId = campusId.trim();
      } else {
        const scope = root.prompt('校区编号；留空创建全局工单类型', '');
        if (scope === null) return;
        campusId = scope.trim() || null;
      }
      const typeCode = root.prompt('类型代码（小写英文和下划线，例如 learning_followup）');
      if (!typeCode?.trim() || !/^[a-z][a-z0-9_]{1,39}$/.test(typeCode.trim())) return;
      const name = root.prompt('类型名称');
      if (!name?.trim()) return;
      await runMutation(() => javaState.client.crm.serviceTickets.createType({
        campusId, typeCode: typeCode.trim(), name: name.trim(), active: true
      }, idempotencyKey()), 'crmServices');
    });
    document.querySelectorAll('[data-ticket-type-edit]').forEach(button => button.addEventListener('click', async () => {
      const name = root.prompt('工单类型名称', button.dataset.name);
      if (!name?.trim()) return;
      const activeValue = root.prompt('是否启用该类型？输入 yes 或 no', button.dataset.active === 'true' ? 'yes' : 'no');
      if (!['yes', 'no'].includes(activeValue)) return;
      await runMutation(() => javaState.client.crm.serviceTickets.updateType(button.dataset.ticketTypeEdit, {
        name: name.trim(), active: activeValue === 'yes', expectedVersion: Number(button.dataset.version)
      }, idempotencyKey()), 'crmServices');
    }));
    document.getElementById('java-crm-ticket-create')?.addEventListener('click', async () => {
      try {
        const campuses = javaState.identity.campusIds || [];
        const catalogs = await Promise.all(campuses.length
          ? campuses.map(campusId => javaState.client.crm.serviceTickets.types({ campusId }))
          : [javaState.client.crm.serviceTickets.types()]);
        const types = [...new Map(catalogs.flat().filter(type => type.active).map(type => [type.typeCode, type])).values()];
        if (!types.length) { javaState.error = '当前授权范围没有启用的工单类型。'; render(); return; }
        const typeCode = root.prompt(`工单类型代码：\n${types.map(type => `${type.typeCode} — ${type.name}`).join('\n')}`, types[0].typeCode);
        if (!typeCode?.trim() || !types.some(type => type.typeCode === typeCode.trim())) return;
        const customerId = root.prompt('客户档案编号');
        if (!customerId?.trim()) return;
        const titleValue = root.prompt('工单标题');
        if (!titleValue?.trim()) return;
        const description = root.prompt('问题描述或服务诉求');
        if (!description?.trim()) return;
        let ownerId = javaState.identity.principalId;
        if (javaState.identity.permissions?.includes('crm.ticket.assign')) {
          ownerId = root.prompt('负责人编号（留空则本人办理）', ownerId);
          if (ownerId === null) return;
        }
        const due = root.prompt('期望完成时间（ISO 时间，可留空）', '');
        if (due === null) return;
        let dueAt;
        try { dueAt = optionalInstant(due); }
        catch (error) {
          if (isStaleWorkspace(error)) return;
          javaState.error = error.message; render(); return; }
        await runMutation(() => javaState.client.crm.serviceTickets.create({
          customerId: customerId.trim(), typeCode: typeCode.trim(), title: titleValue.trim(),
          description: description.trim(), ownerId: ownerId?.trim() || null, dueAt
        }, idempotencyKey()), 'crmServices');
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '工单类型读取失败'; render(); }
    });
    document.querySelectorAll('[data-ticket-assign]').forEach(button => button.addEventListener('click', async () => {
      const ownerId = root.prompt('新负责人编号');
      if (!ownerId?.trim()) return;
      const reason = root.prompt('转派原因（必填）');
      if (!reason?.trim()) return;
      await runMutation(() => javaState.client.crm.serviceTickets.assign(button.dataset.ticketAssign, {
        ownerId: ownerId.trim(), reason: reason.trim(), expectedVersion: Number(button.dataset.version)
      }, idempotencyKey()), 'crmServices');
    }));
    document.querySelectorAll('[data-attribution-review]').forEach(button => button.addEventListener('click', async () => {
      const decision = button.dataset.decision;
      const note = root.prompt(decision === 'approve' ? '批准说明（必填）' : '驳回原因（必填）');
      if (!note?.trim()) return;
      if (decision === 'approve' && !root.confirm('确认追加归属调整？原成交快照会永久保留。')) return;
      try {
        await javaState.client.crm.attribution.review(button.dataset.attributionReview, {
          decision, note: note.trim(), expectedVersion: Number(button.dataset.version)
        }, idempotencyKey());
        await refreshAttributionDetail(javaState.attributionDetail.order);
        javaState.error = '';
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '归因纠错审批失败'; }
      render();
    }));
    document.querySelectorAll('[data-ticket-followup]').forEach(button => button.addEventListener('click', async () => {
      const detail = root.prompt('记录处理过程或回访内容');
      if (!detail?.trim()) return;
      const next = root.prompt('下次回访时间（ISO 时间，可留空）');
      let nextFollowAt;
      try { nextFollowAt = optionalInstant(next); }
      catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message; render(); return; }
      await runMutation(() => javaState.client.crm.serviceTickets.followup(button.dataset.ticketFollowup, {
        detail: detail.trim(), nextFollowAt, expectedVersion: Number(button.dataset.version)
      }, idempotencyKey()), javaState.page);
    }));
    document.querySelectorAll('[data-ticket-close]').forEach(button => button.addEventListener('click', async () => {
      const resolution = root.prompt('办结结果（必填）');
      if (!resolution?.trim()) return;
      await runMutation(() => javaState.client.crm.serviceTickets.close(button.dataset.ticketClose, {
        resolution: resolution.trim(), expectedVersion: Number(button.dataset.version)
      }, idempotencyKey()), javaState.page);
    }));
    document.querySelectorAll('[data-ticket-detail]').forEach(button => button.addEventListener('click', async () => {
      const ticket = javaState.list?.items?.find(item => item.id === button.dataset.ticketDetail);
      if (!ticket) return;
      try {
        const events = await javaState.client.crm.serviceTickets.events(ticket.id);
        javaState.ticketDetail = { ticket, events };
        javaState.error = '';
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '工单处理记录读取失败'; }
      render();
    }));
    document.getElementById('java-crm-ticket-back')?.addEventListener('click', () => {
      javaState.ticketDetail = null;
      javaState.error = '';
      render();
    });
    document.getElementById('java-crm-ticket-refund-link')?.addEventListener('click', async () => {
      const detail = javaState.ticketDetail;
      if (!detail) return;
      const refundRequestId = root.prompt('已存在且属于该客户的退款申请编号');
      if (!refundRequestId?.trim()) return;
      try {
        const ticket = await javaState.client.crm.serviceTickets.linkRefund(detail.ticket.id, {
          refundRequestId: refundRequestId.trim(), expectedVersion: Number(detail.ticket.version)
        }, idempotencyKey());
        const events = await javaState.client.crm.serviceTickets.events(ticket.id);
        javaState.ticketDetail = { ticket, events };
        javaState.error = '';
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '退款申请关联失败'; }
      render();
    });
    document.getElementById('java-crm-customer-back')?.addEventListener('click', () => {
      javaState.customerDetail = null;
      render();
    });
    document.getElementById('java-crm-customer-student-link')?.addEventListener('click', async buttonEvent => {
      const customerId = buttonEvent.currentTarget.dataset.customer;
      const studentId = root.prompt('已存在的学生档案编号');
      if (!studentId?.trim()) return;
      const relationship = root.prompt('家庭关系：child / ward / self / other', 'child');
      if (!['child', 'ward', 'self', 'other'].includes(relationship)) return;
      try {
        await javaState.client.crm.customers.addStudent(customerId, { studentId: studentId.trim(), relationship }, idempotencyKey());
        javaState.customerDetail.customer = await javaState.client.crm.customers.get(customerId);
        javaState.error = '';
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '学生关联失败'; }
      render();
    });
    document.getElementById('java-crm-customer-student-create-toggle')?.addEventListener('click', () => {
      javaState.customerStudentFormOpen = !javaState.customerStudentFormOpen;
      javaState.error = '';
      render();
    });
    document.getElementById('java-crm-customer-student-cancel')?.addEventListener('click', () => {
      javaState.customerStudentFormOpen = false;
      javaState.customerStudentMutation = null;
      javaState.error = '';
      render();
    });
    document.getElementById('java-crm-customer-student-create')?.addEventListener('submit', async event => {
      event.preventDefault();
      const customerId = javaState.customerDetail?.customer?.id;
      if (!customerId || javaState.busy) return;
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const input = { student: { name: String(values.name || '').trim(), grade: String(values.grade || '').trim() || null,
        phone: String(values.phone || '').trim() || null }, relationship: String(values.relationship || 'child') };
      if (!input.student.name || !['child', 'ward', 'self', 'other'].includes(input.relationship)) {
        javaState.error = '请填写学生姓名并选择有效的家庭关系。'; render(); return;
      }
      const fingerprint = JSON.stringify([customerId, input]);
      if (javaState.customerStudentMutation?.fingerprint !== fingerprint) {
        javaState.customerStudentMutation = { fingerprint, key: idempotencyKey() };
      }
      javaState.busy = true; javaState.error = ''; render();
      let stale = false;
      try {
        const linked = await javaState.client.crm.customers.createAndLinkStudent(customerId, input, javaState.customerStudentMutation.key);
        if (!linked?.linkId || !linked?.studentId || linked.name !== input.student.name || linked.relationship !== input.relationship) throw new Error('学生创建结果尚未确认；请用原内容重试确认。');
        const customer = await javaState.client.crm.customers.get(customerId);
        customer.students = [...(customer.students || []).filter(student => student.studentId !== linked.studentId), linked];
        javaState.customerDetail.customer = customer;
        javaState.customerStudentMutation = null;
        javaState.customerStudentFormOpen = false;
      } catch (error) {
        stale = isStaleWorkspace(error);
        if (!stale) javaState.error = error.message || '学生档案创建或家庭关联失败；可保持原内容重试确认。';
      } finally {
        javaState.busy = false;
        if (!stale) render();
      }
    });
    document.getElementById('java-crm-customer-contact-add')?.addEventListener('click', async buttonEvent => {
      const customerId = buttonEvent.currentTarget.dataset.customer;
      const personRole = root.prompt('联系方式所属人员：guardian / student / other', 'guardian');
      if (!['guardian', 'student', 'other'].includes(personRole)) return;
      const channel = root.prompt('联系方式类型：phone / email', 'phone');
      if (!['phone', 'email'].includes(channel)) return;
      const value = root.prompt(channel === 'phone' ? '电话号码' : '电子邮箱');
      if (!value?.trim()) return;
      const primaryAnswer = root.prompt('设为此类型的主要联系方式？输入 yes 或 no', 'no');
      if (!['yes', 'no'].includes(primaryAnswer)) return;
      const input = { personRole, channel, value: value.trim(), primary: primaryAnswer === 'yes' };
      const fingerprint = await contactFingerprint(customerId, input);
      if (!fingerprint || javaState.customerContactMutation?.fingerprint !== fingerprint) {
        javaState.customerContactMutation = { fingerprint, key: idempotencyKey() };
      }
      try {
        await javaState.client.crm.customers.addContact(customerId, input, javaState.customerContactMutation.key);
        javaState.customerDetail.customer = await javaState.client.crm.customers.get(customerId);
        javaState.customerContactMutation = null;
        javaState.error = '';
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '联系方式添加失败'; }
      render();
    });
    document.querySelectorAll('[data-customer-identifiers]').forEach(button => button.addEventListener('click', () => {
      void openNeedWorkspace({ mode: 'identifiers', customerId: button.dataset.customerIdentifiers, studentId: button.dataset.student });
    }));
    document.querySelectorAll('[data-customer-opportunity]').forEach(button => button.addEventListener('click', async () => {
      if (root.SiyueCrmNeeds) return openNeedWorkspace({ mode: 'intake', customerId: button.dataset.customerOpportunity });
      const title = root.prompt('购买需求名称');
      if (!title?.trim()) return;
      const subject = root.prompt('意向学科/项目');
      if (!subject?.trim()) return;
      const term = root.prompt('意向学期');
      if (!term?.trim()) return;
      const detail = root.prompt('需求说明（可留空）');
      if (detail === null) return;
      try {
        await javaState.client.crm.opportunities.create({
          customerId: button.dataset.customerOpportunity, title: title.trim(), subject: subject.trim(),
          term: term.trim(), detail: detail.trim()
        }, idempotencyKey());
        await openPage('crmOpportunities', { listQuery: { customerId: button.dataset.customerOpportunity }, pageNumber: 1 });
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        javaState.error = error.message || '新建购买需求失败';
        render();
      }
    }));
    document.querySelectorAll('[data-form-submissions]').forEach(button => button.addEventListener('click', () => {
      void openPage('formSubmissions', { selectedFormId: button.dataset.formSubmissions, listQuery: {}, pageNumber: 1 });
    }));
    document.querySelectorAll('[data-review]').forEach(button => button.addEventListener('click', async () => {
      const note = root.prompt(button.dataset.review === 'approve' ? '审核意见（必填）' : '驳回原因（必填）');
      if (!note?.trim()) return;
      const customerId = button.dataset.review === 'approve'
        ? root.prompt('如需关联已有客户，请输入客户档案编号；留空则按表单数据创建家庭。') : null;
      if (customerId === null && button.dataset.review === 'approve') return;
      const input = { decision: button.dataset.review, note: note.trim(), expectedVersion: Number(button.dataset.version) };
      if (customerId?.trim()) input.customerId = customerId.trim();
      try {
        await javaState.client.crm.forms.reviewSubmission(button.dataset.id, input, idempotencyKey());
        await loadDirectory('formSubmissions');
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        if (!input.customerId && button.dataset.review === 'approve'
            && String(error.message).includes('相同监护人电话')
            && root.confirm('该校区已有相同监护人电话。确认这是另一个家庭并创建独立客户档案吗？')) {
          try {
            await javaState.client.crm.forms.reviewSubmission(button.dataset.id,
              { ...input, confirmSeparateHousehold: true }, idempotencyKey());
            await loadDirectory('formSubmissions');
            return;
          } catch (retryError) {
            if (isStaleWorkspace(retryError)) return;
            javaState.error = retryError.message || '审核未完成';
            render();
            return;
          }
        }
        javaState.error = error.message || '审核未完成';
        render();
      }
    }));
    document.getElementById('java-crm-report-filter')?.addEventListener('submit', event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      javaState.reportFrom = String(values.get('from') || '');
      javaState.reportUntil = String(values.get('until') || '');
      void loadDirectory('crmReports');
    });
    document.getElementById('java-crm-form-picker')?.addEventListener('click', () => {
      javaState.selectedFormId = '';
      javaState.page = 'formSubmissions';
      state.page = 'formSubmissions';
      void loadDirectory('formSubmissions');
    });
    document.querySelectorAll('[data-card]').forEach(button => button.addEventListener('click', () => {
      const card = javaState.list?.cards?.find(item => item.key === button.dataset.card);
      if (!card) return;
      const page = card.key === 'public' ? 'leadManage' : 'leadTodo';
      void openPage(page, { queueContext: leadQueueContext(card.filters || {}), listQuery: card.filters || {}, pageNumber: 1 });
    }));
  }

  function idempotencyKey() {
    return (root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}-${Math.random()}`).replace(/[^A-Za-z0-9_-]/g, '');
  }
  async function contactFingerprint(customerId, input) {
    const subtle = root.crypto?.subtle;
    if (!subtle || typeof root.TextEncoder !== 'function') return '';
    const bytes = new root.TextEncoder().encode(JSON.stringify([customerId, input]));
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
    return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 8192;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return root.btoa(binary);
  }

  function askMarketingForm(existing = null) {
    const campusIds = javaState.identity.campusIds || [];
    const campusId = root.prompt(`校区编号（可用：${campusIds.join(', ') || '输入有权管理的校区编号'}）`, existing?.campusId || campusIds[0] || '');
    if (!campusId?.trim()) return null;
    const titleValue = root.prompt('表单名称', existing?.title || '');
    if (!titleValue?.trim()) return null;
    const description = root.prompt('表单说明（可留空）', existing?.description || '');
    if (description === null) return null;
    const formKind = root.prompt('表单类型：lead（销售线索）或 survey（问卷）', existing?.formKind || 'lead');
    if (!['lead', 'survey'].includes(formKind)) return null;
    const collectLead = formKind === 'lead' && root.confirm('审核通过后是否将此表单数据登记为销售线索？');
    const defaultLeadFields = [
      { id: 'studentName', title: '学生姓名', type: 'name', description: '', required: true, options: [] },
      { id: 'guardianPhone', title: '监护人电话', type: 'phone', description: '', required: true, options: [] },
      { id: 'subject', title: '意向学科', type: 'text', description: '', required: false, options: [] },
      { id: 'term', title: '意向学期', type: 'text', description: '', required: false, options: [] },
      { id: 'detail', title: '需求说明', type: 'textarea', description: '', required: false, options: [] }
    ];
    const defaultSurveyFields = [
      { id: 'feedback', title: '反馈内容', type: 'textarea', description: '', required: true, options: [] }
    ];
    let fields;
    try {
      const rawFields = root.prompt('字段定义 JSON（可按需调整标题、类型、必填项和选项）',
        JSON.stringify(existing?.fields || (formKind === 'lead' ? defaultLeadFields : defaultSurveyFields), null, 2));
      if (rawFields === null) return null;
      fields = JSON.parse(rawFields);
      if (!Array.isArray(fields) || fields.length < 1 || fields.length > 100) throw new Error('字段须为 1 至 100 项的 JSON 数组。');
      let leadFieldMapping = {};
      if (collectLead) {
        const defaults = existing?.leadFieldMapping || {
          studentName: 'studentName', guardianPhone: 'guardianPhone', subject: 'subject', term: 'term', detail: 'detail'
        };
        const rawMapping = root.prompt('线索映射 JSON；必需 studentName 和 guardianPhone', JSON.stringify(defaults));
        if (rawMapping === null) return null;
        leadFieldMapping = JSON.parse(rawMapping);
        if (!leadFieldMapping || Array.isArray(leadFieldMapping) || typeof leadFieldMapping !== 'object') throw new Error('线索映射须为 JSON 对象。');
      }
      return { campusId: campusId.trim(), title: titleValue.trim(), description: description.trim(),
        formKind, collectLead, fields, leadFieldMapping };
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      javaState.error = error.message || '表单内容格式无效。';
      render();
      return null;
    }
  }

  function askCustomerInput() {
    const campusIds = javaState.identity.campusIds || [];
    const campusId = root.prompt(`校区编号（可用：${campusIds.join(', ') || '输入有权管理的校区编号'}）`, campusIds[0] || '');
    if (!campusId?.trim()) return null;
    const displayName = root.prompt('学生或家庭档案名称');
    if (!displayName?.trim()) return null;
    const phone = root.prompt('监护人联系电话');
    if (!phone?.trim()) return null;
    const contacts = [{ personRole: 'guardian', channel: 'phone', value: phone.trim(), primary: true }];
    while (contacts.length < 20 && root.confirm('是否添加另一个家庭联系方式？')) {
      const personRole = root.prompt('联系人身份：guardian / student / other', 'guardian');
      if (!['guardian', 'student', 'other'].includes(personRole)) return null;
      const channel = root.prompt('联系方式类型：phone / email', 'phone');
      if (!['phone', 'email'].includes(channel)) return null;
      const value = root.prompt('联系方式');
      if (!value?.trim()) return null;
      contacts.push({ personRole, channel, value: value.trim(), primary: false });
    }
    return { campusId: campusId.trim(), displayName: displayName.trim(), contacts };
  }

  function parseCodeList(value) {
    const entries = String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
    if (entries.some(item => !/^[A-Za-z0-9_.-]{1,120}$/.test(item)) || new Set(entries).size !== entries.length) return null;
    return entries;
  }

  function canReadActivityAudience() {
    return ['crm.activity.read', 'crm.task.write', 'crm.customer.read'].every(code => javaState.identity?.permissions?.includes(code));
  }
  function activityAudienceLocked() { return javaState.taskBatchBusy || !!(javaState.taskBatchIdempotencyKey && !javaState.taskBatchStale); }
  async function freshTaskIdentity(required) {
    const principal = javaState.identity?.principalId, identity = await javaState.client.identity.me();
    if (!principal || identity.principalId !== principal) throw new Error('登录身份已变化，请重新登录。');
    javaState.identity = identity;
    if (required.some(code => !identity.permissions?.includes(code))) throw new Error('当前账号已没有办理此工作页的权限。');
    return identity;
  }
  async function openActivityAudience(id) {
    if (!canLeaveWorkspace() || !canReadActivityAudience()) return;
    const key = activityWorkKey(id);
    if (workTabs && workSessions.has(key)) return activateWorkSession(key);
    const activity = javaState.list?.items?.find(row => row.id === id);
    if (!activity) return;
    const origin = leadContext();
    if (workTabs) { saveWorkSession(); leaveNeedWorkspace(); navigationEpoch++; activeWorkKey = key; }
    javaState.activityDetail = { activity: { ...activity }, origin, query: { taskState: 'all' }, pageNumber: 1,
      data: null, selection: new Map(), busy: false, error: '', selectionStale: false, generation: 0 };
    javaState.taskDetail = null; javaState.taskBatchReceipt = null; javaState.error = '';
    if (workTabs) { saveWorkSession(); workTabs.setActive(key); }
    await loadActivityAudience(javaState.activityDetail);
  }
  async function loadActivityAudience(detail) {
    if (javaState.activityDetail !== detail || activityAudienceLocked()) return;
    const generation = ++detail.generation; detail.busy = true; detail.error = ''; detail.data = null; detail.accessVerified = false; render();
    try {
      await freshTaskIdentity(['crm.activity.read', 'crm.task.write', 'crm.customer.read']);
      const data = await javaState.client.crm.activities.audience(detail.activity.id, { ...detail.query, page: detail.pageNumber, size: 20 });
      if (javaState.activityDetail !== detail || detail.generation !== generation) return;
      if (data?.activityId !== detail.activity.id || data.unit !== 'source' || !Array.isArray(data.items)) throw new Error('活动名单返回格式不完整，请重新读取。');
      detail.data = data; detail.accessVerified = true;
      for (const row of data.items) {
        const selected = detail.selection.get(row.key);
        if (selected && JSON.stringify(selected.source) !== JSON.stringify(row.source)) detail.selectionStale = true;
      }
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (javaState.activityDetail === detail && detail.generation === generation) detail.error = error.message || '活动名单读取失败';
    } finally { if (javaState.activityDetail === detail && detail.generation === generation) { detail.busy = false; render(); } }
  }
  function taskBatchReceiptPanel() {
    const receipt = javaState.taskBatchReceipt;
    if (!receipt?.batch) return '';
    const assignments = {};
    for (const task of receipt.tasks || []) assignments[task.ownerId] = (assignments[task.ownerId] || 0) + 1;
    return `<section class="card pad"><h2 class="section-title">任务已分配</h2><p class="notice">任务批次 ${escapeHtml(receipt.batch.id)} 已创建：分配 ${Number(receipt.batch.createdCount) || 0} 项，跳过 ${Number(receipt.batch.skippedCount) || 0} 项。</p><p>来源活动：${escapeHtml(receipt.batch.activityId || '未记录')} · 按需求数统计，完成任务不等于成交。</p><p>本批分配：${Object.entries(assignments).map(([owner, count]) => `${escapeHtml(owner)}：${count}`).join('；') || '无'}</p>${javaState.identity?.permissions?.includes('crm.task.read') ? `<button class="btn primary" type="button" data-task-batch-open="${escapeHtml(receipt.batch.id)}">查看本批任务</button>` : '<p class="help">当前账号无任务查看权限，已确认的分配回执保留于此。</p>'}</section>`;
  }
  function activityAudiencePage() {
    const d = javaState.activityDetail, rows = d.data?.items || [], locked = activityAudienceLocked();
    const label = (text, name, value, attributes = '') => `<label>${text}<input class="input" name="${name}" value="${escapeHtml(value || '')}" ${attributes}></label>`;
    const select = (text, name, values) => `<label>${text}<select class="select" name="${name}">${values.map(([value, text]) => `<option value="${value}"${String(d.query[name] || '') === value ? ' selected' : ''}>${text}</option>`).join('')}</select></label>`;
    const heading = `<div class="heading"><div><h1>${escapeHtml(d.activity.title)} · 活动名单</h1><p class="subtitle">活动 ${escapeHtml(d.activity.id)} · 校区 ${escapeHtml(d.activity.campusId || '未分校区')} · 按来源记录选择，再核对具体购买需求。</p></div><button class="btn" id="java-crm-activity-back"${locked || d.busy ? ' disabled' : ''}>返回活动列表</button></div>`;
    if (!d.accessVerified) return `${heading}<p class="notice" role="${d.error ? 'alert' : 'status'}">${escapeHtml(d.error || '正在核对当前活动与来源权限…')}</p><button class="btn" id="java-crm-activity-refresh"${d.busy ? ' disabled' : ''}>重试读取名单</button>`;
    if (javaState.taskBatchForm) return `${heading}${javaState.error ? `<p class="notice" role="alert">${escapeHtml(javaState.error)}</p>` : ''}<p class="help">活动来源已保留。取消本次分配可回到原筛选和已选名单。</p>${taskBatchPanel()}`;
    return `${heading}${taskBatchReceiptPanel()}${javaState.error ? `<p class="notice" role="alert">${escapeHtml(javaState.error)}</p>` : ''}<section class="card pad"><form id="java-crm-activity-filters" class="filters"><fieldset${d.busy ? ' disabled' : ''} style="display:contents">${select('来源类型', 'sourceType', [['', '全部可见来源'], ['lead', '线索'], ['touchpoint', '客户触点']])}${label('客户编号（精确）', 'customerId', d.query.customerId, 'maxlength="120"')}${select('任务来源记录', 'taskState', [['all', '全部'], ...(javaState.identity.permissions.includes('crm.task.read') ? [['with_evidence', '有可见任务来源证据'], ['without_evidence', '未查到可见任务来源证据']] : [])])}${label('来源起始（北京时间）', 'fromAt', leadLocalTime(d.query.fromAt), 'type="datetime-local"')}${label('来源截止（北京时间）', 'untilAt', leadLocalTime(d.query.untilAt), 'type="datetime-local"')}<button class="btn primary" type="submit">${d.selection.size ? '清除已选并筛选' : '筛选名单'}</button></fieldset></form><p class="help">“未查到可见任务来源证据”仅表示当前任务授权范围未返回已记录的来源关联；历史来源未记录的任务不能判断是否已发。名单共 ${Number(d.data?.total) || 0} 条来源记录，不是人数或需求数。</p>${d.error ? `<p class="notice" role="alert">${escapeHtml(d.error)}</p>` : ''}${d.selectionStale ? '<p class="notice" role="alert">已选来源出现版本变化，请清空并重选当前名单；不会自动替换已确认的来源版本。</p>' : ''}<div class="toolbar"><strong>跨页已选 ${d.selection.size} 条来源（最多 500）</strong><div class="actions"><button class="btn" type="button" id="java-crm-activity-select-page"${d.busy || !rows.length ? ' disabled' : ''}>勾选当前页</button><button class="btn" type="button" id="java-crm-activity-clear"${d.busy || !d.selection.size ? ' disabled' : ''}>清空已选</button><button class="btn primary" type="button" id="java-crm-activity-assign"${d.busy || !d.selection.size || d.selectionStale ? ' disabled' : ''}>发起跟进任务</button><button class="btn" type="button" id="java-crm-activity-refresh"${d.busy ? ' disabled' : ''}>刷新名单</button></div></div><div id="java-crm-activity-audience" class="table-wrap"><table class="table"><thead><tr><th>选择</th><th>客户／学生</th><th>学科／学期</th><th>来源</th><th>来源负责人</th><th>发生时间（北京时间）</th><th>任务来源证据</th></tr></thead><tbody>${rows.map(row => `<tr><td><input type="checkbox" data-audience-key="${escapeHtml(row.key)}" aria-label="选择 ${escapeHtml(row.customerName || row.customerId)} ${escapeHtml(row.key)}"${d.selection.has(row.key) ? ' checked' : ''}></td><td>${escapeHtml(row.customerName || row.customerId)}<br><small>${escapeHtml(row.customerId)}</small><p>${escapeHtml(row.studentName || row.studentId || '学生待确认')}</p></td><td>${escapeHtml(row.subject || '待补全')} / ${escapeHtml(row.term || '待补全')}</td><td>${row.source?.type === 'lead' ? '线索' : '客户触点'}<br>${escapeHtml(row.source?.id)}</td><td>${escapeHtml(row.ownerId || '未记录')}</td><td>${escapeHtml(leadLocalTime(row.occurredAt).replace('T', ' '))}</td><td>${row.hasTaskEvidence ? '已记录可见任务来源' : '未查到可见关联证据'}</td></tr>`).join('') || `<tr><td colspan="7">${d.busy ? '正在读取授权名单…' : d.error ? '名单未能读取，请重试' : '当前筛选没有可见来源'}</td></tr>`}</tbody></table></div><div class="toolbar"><span>第 ${d.pageNumber} / ${Math.max(1, Math.ceil(Number(d.data?.total || 0) / 20))} 页 · 每页最多 20 条来源</span><div class="actions"><button class="btn" id="java-crm-activity-prev"${d.busy || d.pageNumber <= 1 ? ' disabled' : ''}>上一页</button><button class="btn" id="java-crm-activity-next"${d.busy || d.pageNumber * 20 >= (d.data?.total || 0) ? ' disabled' : ''}>下一页</button></div></div></section>`;
  }
  function prepareActivityTaskBatch(detail) {
    if (javaState.activityDetail !== detail || detail.busy || detail.selectionStale || !detail.selection.size || !canReadActivityAudience()) return;
    if (root.SiyueCrmTaskRouting) {
      void openTaskRoutingWorkspace({ mode: 'create', activity: { ...detail.activity }, targets: root.SiyueCrmTaskRouting.targetsFromAudience([...detail.selection.values()]) });
      return;
    }
    const form = newTaskBatchForm();
    form.title = `${detail.activity.title} · 跟进任务`.slice(0, 200); form.activityId = detail.activity.id;
    form.activityLabel = detail.activity.title; form.campusId = detail.activity.campusId || ''; form.activitySource = true; form.targets = [];
    const groups = new Map();
    for (const row of detail.selection.values()) {
      const key = JSON.stringify([row.customerId, row.studentId || null, (row.subject || '').toLowerCase(), (row.term || '').toLowerCase()]);
      let target = groups.get(key);
      if (!target) {
        target = newTaskTarget(form, { customerId: row.customerId, customerLabel: row.customerName || row.customerId, subject: row.subject, term: row.term });
        Object.assign(target, { identity: row.studentId ? 'known' : 'unknown', studentId: row.studentId || '',
          selectedStudent: row.studentId ? { studentId: row.studentId, name: row.studentName || row.studentId } : null,
          sources: [], sourceLocks: { student: !!row.studentId, subject: !!row.subject, term: !!row.term }, campusId: form.campusId });
        groups.set(key, target); form.targets.push(target);
      }
      if (!target.sources.some(source => source.type === row.source.type && source.id === row.source.id)) target.sources.push({ ...row.source });
    }
    javaState.taskBatchForm = form; javaState.taskBatchDraft = null; javaState.taskBatchPreview = null;
    javaState.taskBatchIdempotencyKey = null; javaState.taskBatchUncertain = false; javaState.taskBatchStale = false; javaState.error = '';
    render();
    if (javaState.identity.permissions.includes('crm.task.assign')) void loadTaskAssignees(form);
  }
  async function returnActivityAudience() {
    const detail = javaState.activityDetail; if (!detail || activityAudienceLocked() || detail.busy) return;
    if (workTabs) return activateWorkSession(pageWorkKey(detail.origin.page));
    if ((detail.selection.size || javaState.taskBatchForm) && !root.confirm('返回会放弃当前已选名单与未保存的分配草稿。确认返回吗？')) return;
    javaState.activityDetail = null; javaState.taskBatchForm = null; javaState.taskBatchDraft = null; javaState.taskBatchPreview = null;
    await loadDirectory(detail.origin.page, detail.origin.listQuery, detail.origin.pageNumber); root.scrollTo?.(0, detail.origin.scrollY);
  }
  function bindActivityAudience() {
    document.querySelectorAll('[data-activity-detail]').forEach(button => button.addEventListener('click', () => openActivityAudience(button.dataset.activityDetail)));
    document.querySelectorAll('[data-task-batch-open]').forEach(button => button.addEventListener('click', () => {
      if (!canLeaveWorkspace() || !javaState.identity.permissions.includes('crm.task.read')) return;
      openPage('crmTasks', { listQuery: { batchId: button.dataset.taskBatchOpen }, queueContext: { batchId: button.dataset.taskBatchOpen } });
    }));
    const d = javaState.activityDetail; if (!d) return;
    document.getElementById('java-crm-activity-back')?.addEventListener('click', returnActivityAudience);
    document.getElementById('java-crm-activity-refresh')?.addEventListener('click', () => loadActivityAudience(d));
    document.getElementById('java-crm-activity-filters')?.addEventListener('submit', event => {
      event.preventDefault(); if (javaState.activityDetail !== d || d.busy || activityAudienceLocked() || javaState.taskBatchForm) return;
      const input = Object.fromEntries(new FormData(event.currentTarget)), query = {};
      try {
        for (const name of ['sourceType', 'customerId', 'taskState']) if (String(input[name] || '').trim()) query[name] = String(input[name]).trim();
        if (!!input.fromAt !== !!input.untilAt) throw new Error('请同时填写起始和截止时间，或同时留空。');
        if (input.fromAt) { query.fromAt = toJavaInstant(input.fromAt); query.untilAt = toJavaInstant(input.untilAt); if (Date.parse(query.fromAt) >= Date.parse(query.untilAt)) throw new Error('截止时间须晚于起始时间。'); }
        d.query = query; d.pageNumber = 1; d.selection.clear(); d.selectionStale = false; javaState.error = ''; void loadActivityAudience(d);
      } catch (error) { javaState.error = error.message; render(); }
    });
    const choose = (row, checked) => { if (checked && !d.selection.has(row.key) && d.selection.size >= 500) { javaState.error = '最多勾选 500 条来源，请分批办理。'; return; } if (checked) d.selection.set(row.key, row); else d.selection.delete(row.key); };
    document.getElementById('java-crm-activity-audience')?.addEventListener('change', event => {
      if (d.busy || activityAudienceLocked() || javaState.taskBatchForm || javaState.activityDetail !== d) return;
      const row = d.data?.items?.find(item => item.key === event.target.dataset?.audienceKey); if (!row) return;
      choose(row, event.target.checked); render();
    });
    document.getElementById('java-crm-activity-select-page')?.addEventListener('click', () => { if (javaState.activityDetail !== d || d.busy) return; for (const row of d.data?.items || []) choose(row, true); render(); });
    document.getElementById('java-crm-activity-clear')?.addEventListener('click', () => { if (javaState.activityDetail !== d || d.busy) return; d.selection.clear(); d.selectionStale = false; javaState.error = ''; render(); });
    document.getElementById('java-crm-activity-assign')?.addEventListener('click', () => prepareActivityTaskBatch(d));
    for (const [id, delta] of [['java-crm-activity-prev', -1], ['java-crm-activity-next', 1]]) document.getElementById(id)?.addEventListener('click', () => {
      if (javaState.activityDetail !== d || d.busy || activityAudienceLocked()) return; const page = d.pageNumber + delta;
      if (page < 1 || (page - 1) * 20 >= (d.data?.total || 0)) return; d.pageNumber = page; void loadActivityAudience(d);
    });
  }

  function taskDetailLocked(detail = javaState.taskDetail) { return !!(detail?.busy || detail?.pending); }
  function taskIsOpen(task) { return ['pending', 'in_progress'].includes(task?.status); }
  function taskCanWrite(task) {
    return javaState.identity?.permissions?.includes('crm.task.write') && taskIsOpen(task)
      && (['all', 'campus'].includes(javaState.identity.scope) || task.ownerId === javaState.identity.principalId);
  }
  async function openTaskDetail(id, context = leadContext()) {
    if (!canLeaveWorkspace() || !javaState.identity.permissions.includes('crm.task.read')) return;
    const key = taskWorkKey(id);
    if (workTabs && workSessions.has(key)) return activateWorkSession(key);
    const origin = { ...context, returnWorkKey: context.returnWorkKey || activeWorkKey };
    const fromRouting = javaState.needDetail?.route.workspace === 'taskRouting';
    origin.allowNext = origin.page === 'crmTasks' && !fromRouting && origin.ids?.length > 0;
    if (workTabs) { saveWorkSession(); leaveNeedWorkspace(); navigationEpoch++; activeWorkKey = key; }
    if (fromRouting) { javaState.page = 'crmTasks'; state.page = 'crmTasks'; }
    javaState.taskDetail = { id, origin, data: null, loading: false, busy: false, generation: 0,
      draft: { result: '', note: '', opportunityId: '', needResolutionReason: '' }, draftChanged: false, review: null, pending: null,
      opportunityPage: 1, opportunities: null, opportunityError: '', error: '', notice: '', refreshRequired: false };
    javaState.activityDetail = null; javaState.error = '';
    if (workTabs) { saveWorkSession(); workTabs.setActive(key); }
    await refreshTaskDetail(javaState.taskDetail);
  }
  async function refreshTaskDetail(detail) {
    if (javaState.taskDetail !== detail || taskDetailLocked(detail)) return;
    const generation = ++detail.generation; detail.loading = true; detail.error = ''; render();
    try {
      await freshTaskIdentity(['crm.task.read']);
      const data = await javaState.client.crm.tasks.context(detail.id);
      if (javaState.taskDetail !== detail || detail.generation !== generation) return;
      if (data?.task?.id !== detail.id || !Number.isSafeInteger(data.task.version)) throw new Error('未收到可核对的任务详情。');
      if (detail.data?.task?.version !== data.task.version) detail.review = null;
      detail.data = data; detail.refreshRequired = false;
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (javaState.taskDetail === detail && detail.generation === generation) { detail.error = error.message || '任务详情读取失败'; detail.refreshRequired = true; detail.data = null; detail.opportunities = null; }
    } finally { if (javaState.taskDetail === detail && detail.generation === generation) { detail.loading = false; render(); } }
  }
  async function loadTaskOpportunities(detail, page = 1) {
    if (javaState.taskDetail !== detail || taskDetailLocked(detail) || !javaState.identity.permissions.includes('crm.opportunity.read')) return;
    const generation = detail.opportunityGeneration = (detail.opportunityGeneration || 0) + 1;
    detail.opportunityBusy = true; detail.opportunityError = ''; detail.opportunities = null; detail.opportunityPage = page; render();
    try {
      const result = await javaState.client.crm.tasks.opportunities(detail.id, { page, size: 20 });
      if (javaState.taskDetail !== detail || detail.opportunityGeneration !== generation) return;
      if (!Array.isArray(result?.items)) throw new Error('匹配商机返回格式不完整');
      detail.opportunities = result;
    } catch (error) { if (!isStaleWorkspace(error) && javaState.taskDetail === detail && detail.opportunityGeneration === generation) detail.opportunityError = error.message || '匹配商机读取失败'; }
    finally { if (javaState.taskDetail === detail && detail.opportunityGeneration === generation) { detail.opportunityBusy = false; render(); } }
  }
  function taskDetailPage() {
    const d = javaState.taskDetail, data = d.data, task = data?.task, locked = taskDetailLocked(d), available = taskCanWrite(task) && !d.loading && !d.refreshRequired;
    const statuses = { pending: '待办理', in_progress: '处理中', completed: '已完成', cancelled: '已取消' };
    const outcomes = task?.taskType === 'marketing' ? [['no_need', '无需求'], ['unreachable', '未联系上'], ['invalid_contact', '联系方式无效'], ...(javaState.identity.permissions.includes('crm.opportunity.read') ? [['qualified', '确认意向（关联已有商机）']] : [])]
      : [['completed', '已完成'], ['refused', '拒绝服务'], ['unreachable', '未联系上'], ['invalid_contact', '联系方式无效']];
    const opportunityPage = d.opportunities, opportunities = opportunityPage?.items || [], choice = d.selectedOpportunity;
    const options = choice && !opportunities.some(row => row.id === choice.id) ? [choice, ...opportunities] : opportunities;
    const identityReview = choice?.match === 'needs_identity_confirmation' ? `<section class="notice"><h3>需求身份待核对</h3><p>原任务未明确部门／项目。所选商机的部门编号 ${escapeHtml(choice.needIdentity?.departmentId || '未明确')}，项目编号 ${escapeHtml(choice.needIdentity?.projectId || '不适用')}。请与本次任务需求核对，确认后才关联完成。</p><label>本次身份确认依据<textarea class="textarea" name="needResolutionReason" required maxlength="1000">${escapeHtml(d.draft.needResolutionReason || '')}</textarea></label></section>` : '';
    const opportunity = d.draft.result === 'qualified' ? `<section class="card pad"><h3>关联当前任务的可见商机</h3><p class="help">仅返回匹配本任务客户、学生、学科和学期的授权商机。无匹配商机时请交由有权限的销售人员先建立需求；本页不会创建商机或确认成交。</p>${d.opportunityError ? `<p class="notice" role="alert">${escapeHtml(d.opportunityError)}</p>` : ''}<label>已有商机<select class="select" name="opportunityId" required${d.opportunityBusy ? ' disabled' : ''}><option value="">请选择匹配商机</option>${options.map(row => `<option value="${escapeHtml(row.id)}"${d.draft.opportunityId === row.id ? ' selected' : ''}>${escapeHtml(row.title)} · ${escapeHtml(row.id)} · ${escapeHtml(opportunityStages[row.stage] || row.stage)}${row.match === 'needs_identity_confirmation' ? ' · 需核对身份' : ''}</option>`).join('')}</select></label>${identityReview}<p>${d.opportunityBusy ? '正在读取…' : opportunityPage ? `当前授权范围有 ${Number(opportunityPage.total) || 0} 条匹配商机` : '请读取可见匹配商机'}</p><div class="actions"><button class="btn" type="button" id="java-crm-task-opportunities"${d.opportunityBusy ? ' disabled' : ''}>读取匹配商机</button><button class="btn" type="button" id="java-crm-task-opportunities-prev"${d.opportunityBusy || d.opportunityPage <= 1 ? ' disabled' : ''}>上一页商机</button><button class="btn" type="button" id="java-crm-task-opportunities-next"${d.opportunityBusy || d.opportunityPage * 20 >= (opportunityPage?.total || 0) ? ' disabled' : ''}>下一页商机</button></div></section>` : '';
    let form = `<form id="java-crm-task-detail-form"><fieldset${locked || !available ? ' disabled' : ''} style="border:0;padding:0"><div class="form-grid"><label>处理结果<select class="select" name="result" required><option value="">请选择</option>${outcomes.map(([value, label]) => `<option value="${value}"${d.draft.result === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label></div><label>处理备注<textarea class="textarea" name="note" maxlength="5000">${escapeHtml(d.draft.note)}</textarea></label>${opportunity}<div class="actions"><button class="btn primary" type="submit" name="action" value="save">核对完成结果</button>${d.origin.allowNext ? '<button class="btn" type="submit" name="action" value="next">核对并处理下一条</button>' : ''}</div></fieldset></form>`;
    if (d.review) form = `<h3>提交前核对</h3><dl><dt>任务</dt><dd>${escapeHtml(task?.title || d.id)}</dd><dt>本次动作</dt><dd>${d.review.kind === 'start' ? '开始办理（仅将任务置为处理中）' : `${escapeHtml(outcomes.find(([value]) => value === d.review.input.result)?.[1] || d.review.input.result)}${d.review.next ? '，保存后打开本页下一条可办理任务' : ''}`}</dd><dt>备注</dt><dd>${escapeHtml(d.review.input.note || '未填写')}</dd>${d.review.input.opportunityId ? `<dt>关联商机</dt><dd>${escapeHtml(d.review.input.opportunityId)}</dd>` : ''}${d.review.input.needResolution ? `<dt>确认部门／项目</dt><dd>${escapeHtml(d.review.input.needResolution.departmentId)}／${escapeHtml(d.review.input.needResolution.projectId || '不适用')}</dd><dt>确认依据</dt><dd>${escapeHtml(d.review.input.needResolution.reason)}</dd>` : ''}</dl><p class="help">任务完成独立统计，不改变商机成交、订单或实收。</p><div class="actions"><button class="btn" id="java-crm-task-detail-edit"${locked ? ' disabled' : ''}>返回修改</button><button class="btn primary" id="java-crm-task-detail-commit"${d.busy || d.loading ? ' disabled' : ''}>${d.pending?.uncertain ? '使用原提交重试确认' : '确认提交'}</button></div>`;
    if (task && !taskIsOpen(task) && !d.pending) form = `<p>任务${escapeHtml(statuses[task.status] || task.status)}，办理结果：${escapeHtml(outcomes.find(([value]) => value === task.result)?.[1] || (task.result === 'qualified' ? '确认意向（关联已有商机）' : task.result) || '—')}</p><p>${escapeHtml(task.resultNote || '')}</p>`;
    return `<div class="heading"><div><h1>${escapeHtml(task?.title || d.id)}</h1><p class="subtitle">任务 ${escapeHtml(d.id)} · ${escapeHtml(statuses[task?.status] || '正在读取')}</p></div><div class="actions"><button class="btn" id="java-crm-task-detail-refresh"${locked || d.loading ? ' disabled' : ''}>刷新任务</button><button class="btn" id="java-crm-task-detail-back"${locked || d.loading ? ' disabled' : ''}>返回原任务清单</button></div></div>${d.error ? `<p class="notice" role="alert">${escapeHtml(d.error)}</p>` : ''}${d.notice ? `<p class="notice">${escapeHtml(d.notice)}</p>` : ''}${d.pending?.uncertain ? '<p class="notice" role="alert">提交结果未确认，原内容和请求编号已锁定，请在此页重试；不能改内容或切换页面。</p>' : ''}${data ? `<section class="card pad"><div class="form-grid"><p>客户：${escapeHtml(data.customer?.displayName || data.customer?.id)}</p><p>学生：${escapeHtml(data.student?.name || task.studentId || '学生待确认（家庭需求）')}</p><p>学科／学期：${escapeHtml(task.subject || '—')} / ${escapeHtml(task.term || '—')}</p><p>负责人：${escapeHtml(task.ownerId)}</p><p>截止：${escapeHtml(leadLocalTime(task.dueAt).replace('T', ' '))}</p><p>来源活动：${escapeHtml(data.activityTitle || data.activityId || '未记录／不可见')}</p></div><p>来源：${escapeHtml(({ known: '来源已记录', restricted: '来源受权限限制', unknown: '历史来源未知' })[task.sourceStatus] || '未记录')} ${(task.sources || []).map(source => escapeHtml(`${source.type} ${source.id}`)).join('、')}</p><h3>本任务必要联系信息</h3>${data.contactPolicy === 'no_contacts_after_close' ? '<p class="help">任务结束后不再返回联系信息。</p>' : (data.contacts || []).map(contact => `<p>监护人 · ${escapeHtml(contact.channel)} · ${escapeHtml(contact.valueMasked)}${contact.primary ? ' · 主联系方式' : ''}</p>`).join('') || '<p class="help">当前任务没有可见的监护人联系信息。</p>'}<p class="help">仅展示任务授权的脱敏信息，不提供整个家庭档案或编辑权限。</p><button class="btn" type="button" disabled title="通信渠道待配置，脱敏号码不能用于真实拨号">联系渠道待配置</button></section><section class="card pad" style="margin-top:18px">${task.status === 'pending' && available && !d.review ? '<button class="btn" id="java-crm-task-start">开始办理</button>' : ''}${form}</section>` : `<p role="status">${d.loading ? '正在读取任务授权信息…' : '未能读取任务信息，请刷新重试。'}</p>`}`;
  }
  async function commitTaskDetail(detail) {
    if (javaState.taskDetail !== detail || detail.busy || detail.loading || !detail.review) return;
    detail.busy = true; detail.error = ''; render();
    try {
      await freshTaskIdentity(['crm.task.read', 'crm.task.write']);
      if (!detail.pending) {
        let latest;
        try { latest = await javaState.client.crm.tasks.context(detail.id); }
        catch (error) {
          if (javaState.taskDetail === detail && [403, 404].includes(error.status)) {
            detail.data = null; detail.opportunities = null; detail.selectedOpportunity = null;
            detail.review = null; detail.refreshRequired = true;
          }
          throw error;
        }
        if (javaState.taskDetail !== detail) return;
        if (!taskCanWrite(latest?.task) || latest.task.version !== detail.review.input.expectedVersion || latest.task.ownerId !== detail.data.task.ownerId) {
          detail.data = latest?.task?.id === detail.id && Number.isSafeInteger(latest.task.version)
            ? { ...latest, ...(taskIsOpen(latest.task) ? {} : { contacts: [], contactPolicy: 'no_contacts_after_close' }) } : null;
          detail.opportunities = null; detail.selectedOpportunity = null; detail.review = null; detail.refreshRequired = true;
          throw new Error('任务版本、负责人或权限已变化，请刷新后重新核对。');
        }
        detail.pending = { kind: detail.review.kind, input: detail.review.input, key: detail.review.key, next: detail.review.next, uncertain: false };
      }
      const pending = detail.pending, before = detail.data.task;
      const result = pending.kind === 'start' ? await javaState.client.crm.tasks.update(detail.id, pending.input, pending.key) : await javaState.client.crm.tasks.complete(detail.id, pending.input, pending.key);
      if (!result || result.id !== detail.id || result.customerId !== before.customerId || result.ownerId !== before.ownerId || (result.studentId || null) !== (before.studentId || null)
        || result.taskType !== before.taskType || (result.subject || null) !== (before.subject || null) || (result.term || null) !== (before.term || null)
        || !sameTaskNeedIdentity(result.needIdentity, before.needIdentity)
        || !sameTaskNeedIdentity(result.resolvedNeedIdentity, pending.input.needResolution || before.resolvedNeedIdentity)
        || result.version !== pending.input.expectedVersion + 1 || result.status !== (pending.kind === 'start' ? 'in_progress' : 'completed')
        || pending.kind === 'complete' && (result.result !== pending.input.result || (result.resultNote || '') !== (pending.input.note || '') || (result.opportunityId || null) !== (pending.input.opportunityId || null))) throw new Error('未收到可确认的任务办理回执');
      if (javaState.taskDetail !== detail) return;
      clearWorkspaceBlock();
      detail.data = { ...detail.data, task: result, ...(taskIsOpen(result) ? {} : { contacts: [], contactPolicy: 'no_contacts_after_close' }) };
      detail.pending = null; detail.review = null; detail.busy = false;
      if (pending.kind === 'complete') { detail.draftChanged = false; detail.draft = { result: '', note: '', opportunityId: '', needResolutionReason: '' }; }
      detail.notice = '任务办理已确认保存；没有修改商机成交或订单收款。';
      await refreshTaskDetail(detail);
      if (pending.kind === 'complete' && pending.next) await nextTaskDetail(detail);
    } catch (error) {
      if (isStaleWorkspace(error) || javaState.taskDetail !== detail) return;
      const pending = detail.pending;
      const rejected = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && leadRejections.has(error.code);
      if (pending && !pending.uncertain && rejected) { detail.pending = null; detail.review = null; detail.refreshRequired = true; }
      else if (pending) pending.uncertain = true;
      detail.error = error.message || '任务办理失败';
    } finally { if (javaState.taskDetail === detail) { detail.busy = false; render(); } }
  }
  async function nextTaskDetail(detail) {
    if (javaState.taskDetail !== detail || taskDetailLocked(detail) || detail.loading) return;
    if (!detail.origin.allowNext || !Array.isArray(detail.origin.ids)) return;
    detail.loading = true; detail.error = ''; render();
    const generation = detail.nextGeneration = (detail.nextGeneration || 0) + 1;
    try {
      const identity = await freshTaskIdentity(['crm.task.read']);
      const context = detail.origin;
      const query = { page: context.pageNumber, size: context.size, ...context.listQuery,
        ...Object.fromEntries(Object.entries(context.queueContext || {}).filter(([key]) => ['batchId', 'activityId'].includes(key))) };
      const page = await javaState.client.crm.tasks.list(query);
      if (javaState.taskDetail !== detail || detail.nextGeneration !== generation) return;
      const visible = new Map((page?.items || []).filter(task => task && typeof task.id === 'string').map(task => [task.id, task]));
      const index = context.ids.indexOf(detail.id);
      const nextId = context.ids.slice(index + 1).find(id => {
        const task = visible.get(id);
        return task && taskIsOpen(task) && identity.permissions?.includes('crm.task.write')
          && (['all', 'campus'].includes(identity.scope) || task.ownerId === identity.principalId);
      });
      if (!nextId) { detail.notice = '任务已保存。本页后续没有仍可办理的任务。'; return; }
      detail.loading = false;
      await openTaskDetail(nextId, context);
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (javaState.taskDetail === detail && detail.nextGeneration === generation) detail.notice = `任务已保存，但下一条读取失败：${error.message || '请刷新任务清单'}`;
    } finally { if (javaState.taskDetail === detail && detail.nextGeneration === generation) { detail.loading = false; render(); } }
  }
  async function returnTaskDetail() {
    const detail = javaState.taskDetail; if (!detail || taskDetailLocked(detail) || detail.loading) return;
    if (workTabs) return activateWorkSession(detail.origin.returnWorkKey || pageWorkKey(detail.origin.page));
    if (detail.draftChanged && !root.confirm('此任务有未保存内容，确认返回并放弃吗？')) return;
    javaState.taskDetail = null; await loadDirectory(detail.origin.page, detail.origin.listQuery, detail.origin.pageNumber); root.scrollTo?.(0, detail.origin.scrollY);
  }
  function bindTaskDetail() {
    document.querySelectorAll('[data-task-detail]').forEach(button => button.addEventListener('click', () => openTaskDetail(button.dataset.taskDetail)));
    const d = javaState.taskDetail; if (!d) return;
    document.getElementById('java-crm-task-detail-refresh')?.addEventListener('click', () => refreshTaskDetail(d));
    document.getElementById('java-crm-task-detail-back')?.addEventListener('click', returnTaskDetail);
    const form = document.getElementById('java-crm-task-detail-form');
    const update = (name, value) => {
      if (javaState.taskDetail !== d || taskDetailLocked(d) || d.review || !Object.hasOwn(d.draft, name)) return;
      if (name === 'opportunityId') { const selected = d.opportunities?.items?.find(row => row.id === value) || (d.selectedOpportunity?.id === value ? d.selectedOpportunity : null); if (value && !selected) return; d.selectedOpportunity = selected; }
      d.draft[name] = String(value); d.draftChanged = Object.values(d.draft).some(Boolean); syncWorkTab();
    };
    form?.addEventListener('input', event => update(event.target.name, event.target.value));
    form?.addEventListener('change', event => { update(event.target.name, event.target.value); if (event.target.name === 'result') { render(); if (d.draft.result === 'qualified') void loadTaskOpportunities(d); } else if (event.target.name === 'opportunityId') { d.draft.needResolutionReason = ''; render(); } });
    form?.addEventListener('submit', event => {
      event.preventDefault(); if (taskDetailLocked(d) || !taskCanWrite(d.data?.task) || d.refreshRequired) return;
      new FormData(event.currentTarget).forEach((value, name) => update(name, value));
      const task = d.data.task, allowed = task.taskType === 'marketing' ? ['qualified', 'no_need', 'unreachable', 'invalid_contact'] : ['completed', 'refused', 'unreachable', 'invalid_contact'];
      if (!allowed.includes(d.draft.result) || d.draft.note.length > 5000 || d.draft.result === 'qualified' && (!javaState.identity.permissions.includes('crm.opportunity.read') || !d.selectedOpportunity || d.selectedOpportunity.id !== d.draft.opportunityId)) { d.error = '请选择处理结果，并为确认意向选择当前可见的匹配商机。'; render(); return; }
      const input = { result: d.draft.result, note: d.draft.note.trim(), expectedVersion: task.version };
      if (d.draft.result === 'qualified') {
        input.opportunityId = d.draft.opportunityId;
        if (d.selectedOpportunity.match === 'needs_identity_confirmation') {
          const selected = d.selectedOpportunity, reason = d.draft.needResolutionReason.trim();
          if (!selected.needIdentity?.departmentId || !Number.isSafeInteger(selected.version) || selected.version < 1 || !reason || reason.length > 1000) { d.error = '请核对所选商机的部门／项目，填写身份确认依据；缺少明确身份或版本时请刷新候选。'; render(); return; }
          input.needResolution = { departmentId: selected.needIdentity.departmentId, projectId: selected.needIdentity.projectId || null, expectedOpportunityVersion: selected.version, reason };
        }
      }
      d.review = { kind: 'complete', input: Object.freeze(input), key: idempotencyKey(), next: event.submitter?.value === 'next' && d.origin.allowNext }; d.error = ''; render();
    });
    document.getElementById('java-crm-task-start')?.addEventListener('click', () => { if (!taskCanWrite(d.data?.task) || d.data.task.status !== 'pending' || taskDetailLocked(d)) return; d.review = { kind: 'start', input: Object.freeze({ status: 'in_progress', expectedVersion: d.data.task.version }), key: idempotencyKey() }; render(); });
    document.getElementById('java-crm-task-detail-edit')?.addEventListener('click', () => { if (!taskDetailLocked(d)) { d.review = null; render(); } });
    document.getElementById('java-crm-task-detail-commit')?.addEventListener('click', () => commitTaskDetail(d));
    document.getElementById('java-crm-task-opportunities')?.addEventListener('click', () => loadTaskOpportunities(d, d.opportunityPage));
    document.getElementById('java-crm-task-opportunities-prev')?.addEventListener('click', () => { if (d.opportunityPage > 1) return loadTaskOpportunities(d, d.opportunityPage - 1); });
    document.getElementById('java-crm-task-opportunities-next')?.addEventListener('click', () => { if (d.opportunityPage * 20 < (d.opportunities?.total || 0)) return loadTaskOpportunities(d, d.opportunityPage + 1); });
  }

  function sameTaskNeedIdentity(left, right) {
    return (left?.departmentId || null) === (right?.departmentId || null) && (left?.projectId || null) === (right?.projectId || null);
  }
  function taskIdentityLabel(value) {
    return ({ student_identified: '已确认学生', household_unidentified: '学生待确认（家庭需求）' })[value] || value || '身份未记录';
  }

  function newTaskTarget(form, previous = {}) {
    return { key: `target_${form.nextTarget++}`, customerId: previous.customerId || '',
      customerLabel: previous.customerLabel || '', identity: 'unknown', studentId: '',
      subject: previous.subject || '', term: previous.term || '', students: previous.students || [],
      sources: previous.sources ? previous.sources.map(source => ({ ...source })) : undefined, sourceLocks: previous.sourceLocks ? { ...previous.sourceLocks } : undefined, campusId: previous.campusId,
      studentPage: previous.studentPage || null, studentPageNumber: previous.studentPageNumber || 1,
      selectedStudent: null, studentSequence: 0, studentLoading: false, studentError: '' };
  }

  function newTaskBatchForm() {
    const form = { title: '', taskType: 'marketing', serviceType: '', activityId: '', activityLabel: '',
      strategy: 'even', dueAt: localDateTime(new Date(Date.now() + 86400000)), note: '', nextTarget: 1,
      targets: [], owners: [{ ownerId: javaState.identity.principalId, count: '0' }], picker: null, campusId: javaState.identity.campusIds?.[0] || '', assignees: null };
    form.targets.push(newTaskTarget(form));
    return form;
  }

  function taskAssigneeCampus(form) {
    if (form.activitySource) return form.campusId || '';
    const values = [...new Set(form.targets.filter(row => row.customerId && row.campusId !== undefined).map(row => row.campusId || ''))];
    if (values.length > 1) throw new Error('所选客户来自不同校区，请按校区分别发起任务。');
    return values.length ? values[0] : form.campusId || '';
  }
  async function loadTaskAssignees(form, page = form.assignees?.page || 1) {
    if (javaState.taskBatchForm !== form || javaState.taskBatchPreview || javaState.taskBatchBusy) return;
    const directory = form.assignees ||= { query: '', page: 1, data: null, busy: false, error: '', generation: 0 };
    const generation = ++directory.generation; directory.busy = true; directory.error = ''; directory.data = null; directory.page = page; render();
    try {
      await freshTaskIdentity(['crm.task.write']);
      const campusId = taskAssigneeCampus(form), query = { taskType: form.taskType, query: directory.query.trim(), page, size: 20 };
      if (campusId) query.campusId = campusId;
      const data = await javaState.client.crm.tasks.assignees(query);
      if (javaState.taskBatchForm !== form || form.assignees !== directory || directory.generation !== generation) return;
      if (!Array.isArray(data?.items) || data.workloadScope !== 'current_actor_scope') throw new Error('员工候选返回格式不完整，请重试。');
      directory.data = data;
      for (const owner of form.owners) { const row = data.items.find(item => item.principalId === owner.ownerId); if (row) Object.assign(owner, { displayName: row.displayName, pendingCount: row.pendingCount }); }
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (javaState.taskBatchForm === form && form.assignees === directory && directory.generation === generation) directory.error = error.message || '员工候选读取失败';
    } finally { if (javaState.taskBatchForm === form && form.assignees === directory && directory.generation === generation) { directory.busy = false; render(); } }
  }
  function taskAssigneePanel(form) {
    const directory = form.assignees, canAssign = javaState.identity.permissions.includes('crm.task.assign');
    const data = directory?.data, page = directory?.page || 1, rows = data?.items || [];
    const campuses = [...new Set([form.campusId, ...form.targets.map(row => row.campusId), ...(javaState.identity.campusIds || [])].filter(Boolean))];
    return `<section class="card pad"><h3>接收员工 · 已选 ${form.owners.length} 人</h3><p class="help">待办量为当前操作者授权范围、所选校区与任务类型内的待办理及处理中任务，不是员工全系统任务数。平均分配按本批需求均分，不按历史待办量自动均衡。</p><div class="filters">${form.activitySource ? `<p>活动校区：${escapeHtml(form.campusId || '未分校区')}</p>` : `<label>候选校区<select class="select" name="assigneeCampus"><option value="">未分校区</option>${campuses.map(id => `<option value="${escapeHtml(id)}"${id === form.campusId ? ' selected' : ''}>${escapeHtml(id)}</option>`).join('')}</select></label>`}<label>员工公开编号<input class="input" name="assigneeQuery" value="${escapeHtml(directory?.query || '')}" maxlength="120" placeholder="精确编号或前缀"></label><button class="btn" type="button" data-batch-action="search-assignees"${directory?.busy ? ' disabled' : ''}>查询候选员工</button></div>${directory?.error ? `<p class="notice" role="alert">${escapeHtml(directory.error)}</p>` : ''}${directory?.busy ? '<p role="status">正在读取可分配员工…</p>' : `<div class="table-wrap"><table class="table"><thead><tr><th>选择</th><th>员工</th><th>当前范围待办量</th></tr></thead><tbody>${rows.map(row => `<tr><td><input type="checkbox" name="assignee.${escapeHtml(row.principalId)}"${form.owners.some(owner => owner.ownerId === row.principalId) ? ' checked' : ''}${!canAssign ? ' disabled' : ''} aria-label="选择员工 ${escapeHtml(row.displayName || row.principalId)}"></td><td>${escapeHtml(row.displayName || row.principalId)}<br><small>${escapeHtml(row.principalId)}</small></td><td>${Number.isInteger(row.pendingCount) && row.pendingCount >= 0 ? row.pendingCount : '未返回'}</td></tr>`).join('') || '<tr><td colspan="3">尚无候选结果，请查询；提交时会再次校验资格。</td></tr>'}</tbody></table></div>`}<div class="toolbar"><small>共 ${Number(data?.total) || 0} 位候选 · 第 ${page} 页${data?.generatedAt ? ` · 统计更新 ${escapeHtml(leadLocalTime(data.generatedAt).replace('T', ' '))}` : ''}</small><div class="actions"><button class="btn small" type="button" data-batch-action="prev-assignees"${directory?.busy || page <= 1 ? ' disabled' : ''}>上一页员工</button><button class="btn small" type="button" data-batch-action="next-assignees"${directory?.busy || page * 20 >= (data?.total || 0) ? ' disabled' : ''}>下一页员工</button></div></div><h3>本次接收名单</h3>${form.owners.map((owner, index) => `<div class="filters"><p>${escapeHtml(owner.displayName || owner.ownerId)}<br><small>${escapeHtml(owner.ownerId)}</small></p><p>当前范围待办：${Number.isInteger(owner.pendingCount) ? owner.pendingCount : '待核对'}</p>${form.strategy === 'quota' ? `<label>本次指定数量<input class="input" name="owner.${index}.count" type="number" min="0" max="10000" step="1" required value="${escapeHtml(owner.count)}"></label>` : ''}${canAssign ? `<button class="btn small" type="button" data-batch-action="remove-owner" data-owner-index="${index}">移除员工</button>` : ''}</div>`).join('') || '<p class="help">请在候选表勾选接收员工，可跨页选择。</p>'}</section>`;
  }

  function taskBatchPanel() {
    const form = javaState.taskBatchForm;
    if (!form) return '';
    if (javaState.taskBatchPreview) return taskBatchPreviewPanel();
    const canReadCustomers = javaState.identity.permissions.includes('crm.customer.read');
    const canAssign = javaState.identity.permissions.includes('crm.task.assign');
    const field = (label, name, value, attributes = '') => `<label>${label}<input class="input" name="${escapeHtml(name)}" value="${escapeHtml(value)}" ${attributes}></label>`;
    const option = (value, label, selected) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`;
    return `<section class="card pad" style="margin-bottom:18px"><h2 class="section-title">新建任务批次</h2>
      <p class="help">每行是一项需求。同一客户可为不同孩子、学科或学期分别建任务；未确认学生时明确保留家庭需求，不自动推断学生。</p>
      <form id="java-crm-task-batch-form"><fieldset ${javaState.taskBatchBusy ? 'disabled' : ''} style="border:0;padding:0;min-width:0">
        <div class="filters">${field('批次名称', 'title', form.title, 'required maxlength="200"')}
          <label>任务类型<select class="select" name="taskType">${option('marketing', '营销初筛', form.taskType)}${option('service', '客户服务', form.taskType)}</select></label>
          ${form.taskType === 'service' ? field('服务事项', 'serviceType', form.serviceType, 'required maxlength="100" placeholder="例如：开课通知、学情回访"') : ''}
          ${field('截止时间（本机时区）', 'dueAt', form.dueAt, 'type="datetime-local" required')}</div>
        ${form.activitySource ? `<p>来源活动：${escapeHtml(form.activityLabel || form.activityId)} · ${escapeHtml(form.activityId)}</p>` : canReadActivityAudience() ? '<p class="help">从活动发起任务须选择真实来源。<button class="btn small" type="button" data-batch-action="go-activities">打开获客活动名单</button></p>' : ''}
        <h3>任务目标（${form.targets.length} 项需求，最多 500 项）</h3>
        ${form.targets.map((target, index) => `<section class="card pad" style="margin-bottom:12px"><div class="toolbar"><strong>需求 ${index + 1}</strong><div class="actions"><button class="btn small" type="button" data-batch-action="copy-target" data-target-key="${target.key}" ${form.targets.length >= 500 ? 'disabled' : ''}>同客户添加需求</button><button class="btn small" type="button" data-batch-action="remove-target" data-target-key="${target.key}" ${form.targets.length === 1 ? 'disabled' : ''}>移除</button></div></div>
          <div class="filters">${target.sources?.length ? `<div><span>来源客户</span><p>${escapeHtml(target.customerLabel || target.customerId)} · ${escapeHtml(target.customerId)}</p><small>${target.sources.map(source => escapeHtml(`${source.type === 'lead' ? '线索' : '触点'} ${source.id}`)).join('、')}</small></div>` : canReadCustomers ? `<div><span>客户</span><p>${escapeHtml(target.customerLabel || target.customerId || '尚未选择')} ${target.customerLabel ? `<small>${escapeHtml(target.customerId)}</small>` : ''}</p><button class="btn small" type="button" data-batch-action="pick-customer" data-target-key="${target.key}">查找客户</button></div>` : field('授权客户编号', `target.${target.key}.customerId`, target.customerId, 'required maxlength="120"')}
          <label>学生身份<select class="select" name="target.${target.key}.identity"${target.sourceLocks?.student ? ' disabled' : ''}>${option('unknown', '学生尚未确认（家庭需求）', target.identity)}${option('known', '已确认具体学生', target.identity)}</select></label>
          ${target.identity === 'known' ? target.sourceLocks?.student ? `<p>来源学生：${escapeHtml(target.selectedStudent?.name || target.studentId)} · ${escapeHtml(target.studentId)}</p>` : canReadCustomers ? taskStudentSelector(target) : field('已关联此客户的学生编号', `target.${target.key}.studentId`, target.studentId, 'required maxlength="120"') : '<p class="help">学生待确认；本行会保留为家庭需求。</p>'}
          ${field(`学科 / 项目${form.taskType === 'service' ? '（可选）' : ''}`, `target.${target.key}.subject`, target.subject, `${form.taskType === 'marketing' ? 'required' : ''} maxlength="100" ${target.sourceLocks?.subject ? 'readonly' : ''}`)}
          ${field(`学期${form.taskType === 'service' ? '（可选）' : ''}`, `target.${target.key}.term`, target.term, `${form.taskType === 'marketing' ? 'required' : ''} maxlength="100" ${target.sourceLocks?.term ? 'readonly' : ''}`)}</div>
          ${target.studentError ? `<p class="notice" role="alert">${escapeHtml(target.studentError)} <button class="btn small" type="button" data-batch-action="retry-students" data-target-key="${target.key}">重新读取</button></p>` : ''}
          ${target.identity === 'known' && canReadCustomers ? '<p class="help">按当前客户的任务办理范围读取关联学生，不要求已经报名，也不要求全局学生查看权限。</p>' : ''}</section>`).join('')}
        ${!form.activitySource ? `<button class="btn" type="button" data-batch-action="add-target" ${form.targets.length >= 500 ? 'disabled' : ''}>添加目标需求</button>` : '<p class="help">来源已明确的学生、学科和学期不能改成其他需求；缺失项可补齐。相同需求会合并来源后预览。</p>'}
        ${!canReadCustomers ? '<p class="help">当前账号没有客户目录查看权限。请填写您有权办理的客户和学生编号，由服务端验证范围与关联关系；学生未确认可留为家庭需求。</p>' : ''}
        <h3>分配方式</h3><div class="filters"><label>分配策略<select class="select" name="strategy">${option('even', '平均分配', form.strategy)}${option('quota', '指定名额', form.strategy)}${option('owner_first', '客户负责人优先（限已选员工）', form.strategy)}</select></label></div>
        <p class="help">${form.strategy === 'quota' ? '每位负责人填写名额，合计须等于去重后可创建的需求数；预览不通过时可调整后重试。' : form.strategy === 'owner_first' ? '优先分给名单中的客户原负责人，其余需求按名单平均分配。' : '按负责人名单平均分配可创建的需求。'}${canAssign ? '服务端会验证每位负责人的权限与校区范围。' : '当前账号仅可创建分配给本人的任务。'}</p>
        ${taskAssigneePanel(form)}
        <p><label>任务说明<textarea class="input" name="note" maxlength="5000" rows="3">${escapeHtml(form.note)}</textarea></label></p>
        ${taskBatchPickerPanel(form)}
        <div class="actions"><button class="btn" type="button" id="java-crm-task-batch-cancel">取消</button><button class="btn primary" type="submit">${javaState.taskBatchBusy ? '正在预览…' : '预览资格与分配'}</button></div>
      </fieldset></form></section>`;
  }

  function taskStudentSelector(target) {
    const current = target.selectedStudent;
    const rows = [...(target.students || [])];
    if (current && !rows.some(student => student.studentId === current.studentId)) rows.unshift(current);
    const page = Number(target.studentPage?.page) || target.studentPageNumber;
    const size = Number(target.studentPage?.size) || 20;
    const total = Number(target.studentPage?.total) || 0;
    const disabled = target.studentLoading || !target.customerId;
    return `<div><label>关联学生<select class="select" name="target.${target.key}.studentId" required ${disabled ? 'disabled' : ''}><option value="">${target.studentLoading ? '正在读取任务关联学生…' : '请选择关联学生'}</option>${rows.map(student => `<option value="${escapeHtml(student.studentId)}" ${student.studentId === target.studentId ? 'selected' : ''}>${escapeHtml(student.name)} · ${escapeHtml(student.studentId)}${student.grade ? ` · ${escapeHtml(student.grade)}` : ''}${current?.studentId === student.studentId && !target.students.some(item => item.studentId === student.studentId) ? '（已选，来自其他页）' : ''}</option>`).join('')}</select></label>
      ${!target.customerId ? '<p class="help">请先选择客户。</p>' : target.studentLoading ? '<p role="status">正在读取客户任务范围内的关联学生…</p>' : target.studentPage && !target.studentError ? `<div class="toolbar"><small>关联学生共 ${total} 位 · 第 ${page} / ${Math.max(1, Math.ceil(total / size))} 页</small><div class="actions"><button class="btn small" type="button" data-batch-action="prev-students" data-target-key="${target.key}" ${page <= 1 ? 'disabled' : ''}>上一页学生</button><button class="btn small" type="button" data-batch-action="next-students" data-target-key="${target.key}" ${page * size >= total ? 'disabled' : ''}>下一页学生</button></div></div>${!target.students.length ? '<p class="help">当前查询未返回可选学生，请核对客户或刷新目录。</p>' : ''}` : !target.studentError ? `<button class="btn small" type="button" data-batch-action="retry-students" data-target-key="${target.key}">读取关联学生</button>` : ''}</div>`;
  }

  function taskBatchPickerPanel(form) {
    const picker = form.picker;
    if (!picker) return '';
    const labels = { customers: '客户' };
    const rows = picker.data?.items || [];
    const page = Number(picker.data?.page) || picker.page;
    const size = Number(picker.data?.size) || 20;
    const total = Number(picker.data?.total) || 0;
    return `<section id="java-crm-task-batch-picker" class="card pad" aria-label="选择${labels[picker.kind]}" style="margin:16px 0"><div class="toolbar"><h3>选择${labels[picker.kind]}</h3><button class="btn small" type="button" data-batch-action="close-picker">收起选择器</button></div>
      ${picker.kind === 'customers' ? `<div class="filters"><input class="input" name="pickerQuery" aria-label="客户检索" placeholder="客户姓名、电话或邮箱" maxlength="254" value="${escapeHtml(picker.query)}"><button class="btn" type="button" data-batch-action="search-picker" ${picker.busy ? 'disabled' : ''}>检索</button></div>` : ''}
      ${picker.error ? `<p class="notice" role="alert">${escapeHtml(picker.error)} <button class="btn small" type="button" data-batch-action="retry-picker">重试</button></p>` : ''}
      ${picker.busy ? '<p role="status">正在读取授权范围…</p>' : !picker.error ? `<div class="table-wrap"><table class="table"><thead><tr><th>${labels[picker.kind]}</th><th>校区 / 范围</th><th>选择</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.displayName || row.title || row.principalId)}<br><small>${escapeHtml(row.id || row.principalId)}</small></td><td>${escapeHtml(row.campusId || (row.campusIds || []).join('、') || '—')}</td><td><button class="btn small" type="button" data-batch-action="select-picker" data-pick-id="${escapeHtml(row.id || row.principalId)}">选择</button></td></tr>`).join('') || '<tr><td colspan="3">当前范围没有匹配记录</td></tr>'}</tbody></table></div><div class="toolbar"><span>共 ${total} 条 · 第 ${page} 页</span><div class="actions"><button class="btn small" type="button" data-batch-action="prev-picker" ${page <= 1 ? 'disabled' : ''}>上一页</button><button class="btn small" type="button" data-batch-action="next-picker" ${page * size >= total ? 'disabled' : ''}>下一页</button></div></div>` : ''}</section>`;
  }

  function taskBatchPreviewPanel() {
    const preview = javaState.taskBatchPreview;
    const input = javaState.taskBatchDraft;
    const form = javaState.taskBatchForm;
    const targets = preview.eligibleTargets || [];
    const skipped = preview.skippedTargets || [];
    const customerName = id => {
      const row = form.targets.find(target => target.customerId === id);
      return row?.customerLabel ? `${row.customerLabel}（${id}）` : id;
    };
    const studentName = target => {
      if (!target.studentId) return '学生待确认（家庭需求）';
      const householdRows = form.targets.filter(row => row.customerId === target.customerId);
      const known = householdRows.map(row => row.selectedStudent).find(student => student?.studentId === target.studentId)
        || householdRows.flatMap(row => row.students || []).find(student => student.studentId === target.studentId);
      return known ? `${known.name}（${target.studentId}）` : target.studentId;
    };
    const rows = (values, skip) => values.map(target => `<tr><td>${escapeHtml(customerName(target.customerId))}</td><td>${escapeHtml(studentName(target))}</td><td>${escapeHtml(target.subject || '—')}</td><td>${escapeHtml(target.term || '—')}</td><td>${(target.sources || []).map(source => escapeHtml(`${source.type === 'lead' ? '线索' : '触点'} ${source.id}`)).join('、') || '未关联来源'}</td><td>${escapeHtml(skip ? ({ open_marketing_task: '同一学生与需求已有未完成营销任务', identity_review_required: '需求身份待核对，尚未创建任务' })[target.reason] || target.reason || '服务端未提供原因' : target.ownerId)}</td></tr>`).join('');
    const table = (values, skip) => `<div class="table-wrap"><table class="table"><thead><tr><th>客户</th><th>学生身份</th><th>学科 / 项目</th><th>学期</th><th>活动来源</th><th>${skip ? '跳过原因' : '分配负责人'}</th></tr></thead><tbody>${rows(values, skip) || `<tr><td colspan="6">${skip ? '没有跳过的需求' : '没有可创建的需求'}</td></tr>`}</tbody></table></div>`;
    return `<section class="card pad" style="margin-bottom:18px"><h2 class="section-title">任务批次预览</h2>
      <p><strong>${escapeHtml(input.title)}</strong> · ${input.taskType === 'marketing' ? '营销初筛' : `客户服务：${escapeHtml(input.serviceType)}`} · 截止：${escapeHtml(new Date(input.dueAt).toLocaleString())}（本机时区）</p>
      <p>选择 ${Number(preview.selectedCount) || 0} 项需求（按需求数统计，同一客户可有多项）；可创建 ${Number(preview.eligibleCount) || 0} 项，跳过 ${Number(preview.skippedCount) || 0} 项。${preview.campusId ? `校区：${escapeHtml(preview.campusId)}。` : ''}</p>
      <p>来源活动：${escapeHtml(input.activityId || '未关联')} · 分配口径：${escapeHtml({ even: '本批平均分配', quota: '指定数量', owner_first: '客户负责人优先（限已选员工）' }[input.strategy])}</p><p>负责人分布：${Object.entries(preview.assignmentCounts || {}).map(([owner, count]) => `${escapeHtml(owner)}：${Number(count) || 0}`).join('；') || '无'}</p>
      <h3>逐需求分配明细（${targets.length}）</h3>${table(targets, false)}<h3>跳过的需求（${skipped.length}）</h3>${table(skipped, true)}
      ${input.note ? `<p>任务说明：${escapeHtml(input.note)}</p>` : ''}
      ${javaState.taskBatchStale ? '<p class="notice" role="alert">需求资格或负责人分配已变化，旧预览不能提交。请重新预览并再次核对。</p>' : javaState.taskBatchIdempotencyKey && !javaState.taskBatchBusy ? '<p class="notice" role="alert">上次提交尚未确认成功。再次确认会沿用同一请求编号，避免重复创建。</p>' : ''}
      <div class="actions"><button class="btn" id="java-crm-task-batch-cancel" ${javaState.taskBatchBusy || (javaState.taskBatchIdempotencyKey && !javaState.taskBatchStale) ? 'disabled' : ''}>取消</button><button class="btn" id="java-crm-task-batch-edit" ${javaState.taskBatchBusy || (javaState.taskBatchIdempotencyKey && !javaState.taskBatchStale) ? 'disabled' : ''}>返回修改</button>${javaState.taskBatchStale ? `<button class="btn" id="java-crm-task-batch-refresh" ${javaState.taskBatchBusy ? 'disabled' : ''}>重新预览</button>` : ''}<button class="btn primary" id="java-crm-task-batch-apply" ${javaState.taskBatchBusy || javaState.taskBatchStale || !preview.eligibleCount ? 'disabled' : ''}>${javaState.taskBatchBusy ? '正在提交…' : javaState.taskBatchIdempotencyKey && !javaState.taskBatchStale ? '重试确认创建任务' : '确认创建任务'}</button></div></section>`;
  }

  function updateTaskBatchField(event) {
    const form = javaState.taskBatchForm;
    if (!form || javaState.taskBatchPreview || javaState.taskBatchBusy) return;
    const { name, value } = event.target;
    const parts = String(name || '').split('.');
    if (parts[0] === 'assignee') {
      if (!javaState.identity.permissions.includes('crm.task.assign')) return;
      const candidate = form.assignees?.data?.items?.find(row => row.principalId === parts[1]);
      if (!candidate) return;
      const index = form.owners.findIndex(row => row.ownerId === candidate.principalId);
      if (event.target.checked && index < 0) { if (form.owners.length >= 100) { javaState.error = '最多选择 100 位员工'; render(); return; } form.owners.push({ ownerId: candidate.principalId, displayName: candidate.displayName, pendingCount: candidate.pendingCount, count: '0' }); }
      else if (!event.target.checked && index >= 0) form.owners.splice(index, 1);
      render(); return;
    }
    if (parts[0] === 'target') {
      const target = form.targets.find(row => row.key === parts[1]);
      if (!target || !['customerId', 'identity', 'studentId', 'subject', 'term'].includes(parts[2])) return;
      if (target.sources?.length && (parts[2] === 'customerId' || target.sourceLocks?.student && ['identity', 'studentId'].includes(parts[2]) || target.sourceLocks?.[parts[2]])) return;
      if (parts[2] === 'customerId' && target.customerId !== value) {
        target.studentId = ''; target.selectedStudent = null; target.students = []; target.studentPage = null; target.studentPageNumber = 1;
      }
      target[parts[2]] = value;
      if (parts[2] === 'studentId') target.selectedStudent = target.students?.find(student => student.studentId === value) || (target.selectedStudent?.studentId === value ? target.selectedStudent : null);
      if (parts[2] === 'identity' && value === 'unknown') { target.studentId = ''; target.selectedStudent = null; }
    } else if (parts[0] === 'owner') {
      const owner = form.owners[Number(parts[1])];
      if (owner && parts[2] === 'count') owner.count = value;
    } else if (name === 'assigneeQuery') (form.assignees ||= { query: '', page: 1, generation: 0 }).query = value;
    else if (name === 'assigneeCampus' && !form.activitySource) { form.campusId = value; form.assignees = null; }
    else if (name === 'pickerQuery' && form.picker) form.picker.query = value;
    else if (['title', 'taskType', 'serviceType', 'strategy', 'dueAt', 'note'].includes(name)) form[name] = value;
    if (name === 'taskType' && event.type === 'change') form.assignees = null;
    if (event.type === 'change' && (['taskType', 'strategy', 'assigneeCampus'].includes(name) || ['identity', 'customerId'].includes(parts[2]))) render();
  }

  async function loadTaskBatchPicker(form, picker) {
    picker.busy = true; picker.error = ''; picker.data = null;
    const sequence = (picker.sequence || 0) + 1;
    picker.sequence = sequence;
    render();
    try {
      const query = { page: picker.page, size: 20 };
      if (picker.kind === 'customers') query.query = picker.query;
      const result = await javaState.client.crm.customers.list(query);
      if (javaState.taskBatchForm !== form || form.picker !== picker || picker.sequence !== sequence) return;
      picker.data = result;
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (javaState.taskBatchForm === form && form.picker === picker && picker.sequence === sequence) picker.error = error.message || '授权目录读取失败';
    } finally {
      if (javaState.taskBatchForm === form && form.picker === picker && picker.sequence === sequence) { picker.busy = false; render(); }
    }
  }

  async function loadTaskTargetStudents(form, target, page = target.studentPageNumber || 1) {
    const customerId = target.customerId;
    if (!customerId || !javaState.identity.permissions.includes('crm.task.write')
        || !javaState.identity.permissions.includes('crm.customer.read')) return;
    const sequence = ++target.studentSequence;
    target.studentLoading = true; target.studentError = ''; target.students = []; target.studentPage = null;
    target.studentPageNumber = page;
    const current = () => javaState.taskBatchForm === form && form.targets.includes(target)
      && target.customerId === customerId && target.studentSequence === sequence;
    render();
    try {
      const result = await javaState.client.crm.tasks.customerStudents(customerId, { page, size: 20 });
      if (!current()) return;
      if (!Array.isArray(result?.items)) throw new Error('任务关联学生目录返回格式无效，请稍后重试。');
      target.studentPage = result;
      target.students = result.items.map(student => ({ ...student, studentId: student.id }));
      const selected = target.students.find(student => student.studentId === target.studentId);
      if (selected) target.selectedStudent = selected;
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (current()) target.studentError = error.message || '任务关联学生读取失败';
    } finally {
      if (current()) { target.studentLoading = false; render(); }
    }
  }

  async function taskBatchFormAction(event) {
    const button = event.target.closest?.('[data-batch-action]');
    const form = javaState.taskBatchForm;
    if (!button || !form || javaState.taskBatchBusy || javaState.taskBatchPreview || button.disabled) return;
    event.preventDefault();
    const { batchAction: action, targetKey, ownerIndex, pickId } = button.dataset;
    const target = form.targets.find(row => row.key === targetKey);
    if (action === 'go-activities' && canReadActivityAudience()) return openPage('crmCampaigns');
    if (action === 'search-assignees') return loadTaskAssignees(form, 1);
    if (action === 'prev-assignees' && form.assignees?.page > 1) return loadTaskAssignees(form, form.assignees.page - 1);
    if (action === 'next-assignees' && form.assignees?.page * 20 < (form.assignees?.data?.total || 0)) return loadTaskAssignees(form, form.assignees.page + 1);
    if (action === 'add-target' && !form.activitySource && form.targets.length < 500) form.targets.push(newTaskTarget(form));
    if (action === 'copy-target' && target && form.targets.length < 500) { const copy = newTaskTarget(form, target); if (target.sourceLocks?.student) Object.assign(copy, { identity: 'known', studentId: target.studentId, selectedStudent: target.selectedStudent }); form.targets.push(copy); }
    if (action === 'remove-target' && form.targets.length > 1) {
      form.targets = form.targets.filter(row => row !== target);
      if (form.picker?.targetKey === targetKey) form.picker = null;
    }
    if (action === 'remove-owner' && javaState.identity.permissions.includes('crm.task.assign')) { form.owners.splice(Number(ownerIndex), 1); form.picker = null; }
    if (action === 'close-picker') form.picker = null;
    if (target?.customerId && !target.studentLoading) {
      if (action === 'retry-students') return loadTaskTargetStudents(form, target);
      const studentPage = Number(target.studentPage?.page) || target.studentPageNumber;
      if (action === 'prev-students' && studentPage > 1) return loadTaskTargetStudents(form, target, studentPage - 1);
      if (action === 'next-students' && studentPage * (target.studentPage?.size || 20) < (target.studentPage?.total || 0)) return loadTaskTargetStudents(form, target, studentPage + 1);
    }
    if (action === 'pick-customer') {
      const kind = 'customers';
      if (!javaState.identity.permissions.includes('crm.customer.read') || target?.sources?.length) return;
      form.picker = { kind, targetKey, ownerIndex, query: '', page: 1, data: null, busy: false, error: '' };
      const pending = loadTaskBatchPicker(form, form.picker);
      document.getElementById('java-crm-task-batch-picker')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      return pending;
    }
    const picker = form.picker;
    if (picker && ['search-picker', 'prev-picker', 'next-picker', 'retry-picker'].includes(action) && !picker.busy) {
      if (action === 'search-picker') picker.page = 1;
      if (action === 'prev-picker' && picker.page > 1) picker.page--;
      if (action === 'next-picker' && picker.page * (picker.data?.size || 20) < (picker.data?.total || 0)) picker.page++;
      return loadTaskBatchPicker(form, picker);
    }
    if (action === 'select-picker' && picker && !picker.busy && !picker.error) {
      const selected = picker.data?.items?.find(row => (row.id || row.principalId) === pickId);
      if (!selected) return;
      if (picker.kind === 'customers') {
        const row = form.targets.find(item => item.key === picker.targetKey);
        if (!row) return;
        row.customerId = selected.id; row.customerLabel = selected.displayName; row.campusId = selected.campusId || ''; form.campusId = row.campusId; form.assignees = null;
        row.studentId = ''; row.selectedStudent = null; row.studentPageNumber = 1; form.picker = null;
        return loadTaskTargetStudents(form, row);
      }
      form.picker = null;
    }
    render();
  }

  function taskBatchInput(form) {
    if (!form.title.trim()) throw new Error('请填写批次名称。');
    if (!['marketing', 'service'].includes(form.taskType)) throw new Error('请选择任务类型。');
    if (form.taskType === 'service' && !form.serviceType.trim()) throw new Error('请填写服务事项。');
    if (form.targets.length < 1 || form.targets.length > 500) throw new Error('每批需要 1–500 项需求。');
    const seen = new Map(), targets = [];
    form.targets.forEach((row, index) => {
      const target = { customerId: row.customerId.trim(), studentId: row.identity === 'known' ? row.studentId.trim() || null : null,
        subject: row.subject.trim() || null, term: row.term.trim() || null };
      if (!target.customerId) throw new Error(`需求 ${index + 1}：请选择客户或填写授权客户编号。`);
      if (row.identity === 'known' && !target.studentId) throw new Error(`需求 ${index + 1}：请选择已关联学生，或明确设为学生尚未确认。`);
      if (row.studentLoading && row.identity === 'known') throw new Error(`需求 ${index + 1}：关联学生仍在读取，请稍后预览。`);
      if (form.taskType === 'marketing' && (!target.subject || !target.term)) throw new Error(`需求 ${index + 1}：请填写学科和学期。`);
      if (row.sources?.length) target.sources = row.sources.map(source => ({ type: source.type, id: source.id, version: source.version ?? null }));
      if (form.activityId && !target.sources?.length) throw new Error(`需求 ${index + 1}：活动批次必须由活动名单选择真实来源。`);
      const key = taskDemandKey(target), previous = seen.get(key);
      if (previous) {
        if (!previous.sources?.length || !target.sources?.length) throw new Error(`需求 ${index + 1} 与已有需求重复；同一家庭不同孩子应分别选择已关联学生。`);
        for (const source of target.sources) if (!previous.sources.some(item => item.type === source.type && item.id === source.id)) previous.sources.push(source);
        if (previous.sources.length > 100) throw new Error('同一需求最多保留 100 条来源，请拆分所选来源。');
        return;
      }
      if (target.sources?.length > 100) throw new Error('同一需求最多保留 100 条来源，请拆分所选来源。');
      seen.set(key, target); targets.push(target);
    });
    const ownerIds = javaState.identity.permissions.includes('crm.task.assign') ? form.owners.map(row => row.ownerId.trim()) : [javaState.identity.principalId];
    if (!ownerIds.length || ownerIds.length > 100 || ownerIds.some(id => !id) || new Set(ownerIds).size !== ownerIds.length) throw new Error('请选择 1–100 位不重复的接收员工。');
    if (!['even', 'quota', 'owner_first'].includes(form.strategy)) throw new Error('请选择分配策略。');
    const quotas = form.strategy === 'quota' ? ownerIds.map((ownerId, index) => {
      const value = String(form.owners[index].count), count = Number(value);
      if (!value.trim() || !Number.isInteger(count) || count < 0 || count > 10000) throw new Error('每位负责人名额必须为 0–10000 的整数。');
      return { ownerId, count };
    }) : null;
    const due = new Date(form.dueAt);
    if (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now()) throw new Error('请选择晚于当前时间的任务截止时间。');
    return { title: form.title.trim(), taskType: form.taskType, serviceType: form.taskType === 'service' ? form.serviceType.trim() : null,
      targets, activityId: form.activityId || null, subject: null, term: null, ownerIds, strategy: form.strategy,
      quotas, dueAt: due.toISOString(), note: form.note.trim() };
  }
  function taskDemandKey(target) {
    return JSON.stringify([target.customerId, target.studentId || null, (target.subject || '').trim().toLowerCase(), (target.term || '').trim().toLowerCase()]);
  }
  function taskSourceSignature(sources) {
    if (!Array.isArray(sources)) return '';
    return JSON.stringify(sources.map(source => [source.type, source.id, source.version ?? null]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  }
  function validTaskBatchReceipt(receipt, input, preview) {
    const batch = receipt?.batch, tasks = receipt?.tasks;
    if (!batch || typeof batch.id !== 'string' || !batch.id || batch.createdCount !== preview.eligibleCount || batch.skippedCount !== preview.skippedCount
      || (batch.activityId || null) !== (input.activityId || null) || !Array.isArray(tasks) || tasks.length !== preview.eligibleCount
      || new Set(tasks.map(task => task.id)).size !== tasks.length) return false;
    const expected = new Map((preview.eligibleTargets || []).map(target => [taskDemandKey(target), target]));
    if (expected.size !== tasks.length) return false;
    for (const task of tasks) {
      const key = taskDemandKey(task), target = expected.get(key);
      if (!target || typeof task.id !== 'string' || !task.id || task.batchId !== batch.id || task.ownerId !== target.ownerId
        || task.taskType !== input.taskType || task.version !== 1 || task.status !== 'pending'
        || task.title !== input.title || (task.serviceType || null) !== (input.serviceType || null)
        || !Number.isFinite(Date.parse(task.dueAt)) || Date.parse(task.dueAt) !== Date.parse(input.dueAt)
        || (task.activityId || null) !== (input.activityId || null)
        || taskSourceSignature(task.sources || []) !== taskSourceSignature(target.sources || [])
        || task.sourceStatus !== ((target.sources || []).length ? 'known' : 'unknown')) return false;
      expected.delete(key);
    }
    return expected.size === 0;
  }

  async function previewTaskBatch(refresh = false) {
    const form = javaState.taskBatchForm;
    if (!form || javaState.taskBatchBusy) return;
    try {
      const input = refresh ? javaState.taskBatchDraft : taskBatchInput(form);
      javaState.taskBatchBusy = true; javaState.error = ''; render();
      await freshTaskIdentity(['crm.task.write', ...(input.activityId ? ['crm.activity.read', 'crm.customer.read'] : [])]);
      const preview = await javaState.client.crm.tasks.previewBatch(input);
      if (javaState.taskBatchForm !== form) return;
      javaState.taskBatchDraft = input; javaState.taskBatchPreview = preview;
      javaState.taskBatchStale = false; javaState.taskBatchIdempotencyKey = null; javaState.taskBatchUncertain = false;
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      if (javaState.taskBatchForm === form) javaState.error = error.message || '任务批次预览失败';
    } finally {
      if (javaState.taskBatchForm === form) { javaState.taskBatchBusy = false; render(); }
    }
  }

  function bindTaskBatch() {
    document.getElementById('java-crm-task-batch-create')?.addEventListener('click', () => {
      if (javaState.taskBatchBusy || javaState.taskBatchForm || !javaState.identity.permissions.includes('crm.task.write')) return;
      javaState.taskBatchForm = newTaskBatchForm(); javaState.taskBatchDraft = null; javaState.taskBatchPreview = null;
      javaState.taskBatchIdempotencyKey = null; javaState.taskBatchUncertain = false; javaState.taskBatchStale = false; javaState.error = ''; render();
      if (javaState.identity.permissions.includes('crm.task.assign')) void loadTaskAssignees(javaState.taskBatchForm);
    });
    const element = document.getElementById('java-crm-task-batch-form');
    element?.addEventListener('input', updateTaskBatchField);
    element?.addEventListener('change', updateTaskBatchField);
    element?.addEventListener('click', taskBatchFormAction);
    element?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.name === 'pickerQuery') {
        event.preventDefault();
        const form = javaState.taskBatchForm;
        if (form?.picker && !form.picker.busy) { form.picker.page = 1; void loadTaskBatchPicker(form, form.picker); }
      }
    });
    element?.addEventListener('submit', event => { event.preventDefault(); return previewTaskBatch(); });
    document.getElementById('java-crm-task-batch-cancel')?.addEventListener('click', () => {
      if (javaState.taskBatchBusy || (javaState.taskBatchIdempotencyKey && !javaState.taskBatchStale)) return;
      javaState.taskBatchForm = null; javaState.taskBatchDraft = null; javaState.taskBatchPreview = null;
      javaState.taskBatchIdempotencyKey = null; javaState.taskBatchStale = false; javaState.error = ''; render();
    });
    document.getElementById('java-crm-task-batch-edit')?.addEventListener('click', () => {
      if (javaState.taskBatchBusy || (javaState.taskBatchIdempotencyKey && !javaState.taskBatchStale)) return;
      javaState.taskBatchDraft = null; javaState.taskBatchPreview = null; javaState.taskBatchIdempotencyKey = null;
      javaState.taskBatchStale = false; javaState.error = ''; render();
    });
    document.getElementById('java-crm-task-batch-refresh')?.addEventListener('click', () => previewTaskBatch(true));
    document.getElementById('java-crm-task-batch-apply')?.addEventListener('click', async () => {
      const preview = javaState.taskBatchPreview;
      const form = javaState.taskBatchForm;
      if (!form || !preview || javaState.taskBatchBusy || javaState.taskBatchStale || !javaState.taskBatchDraft || !preview.eligibleCount) return;
      javaState.taskBatchBusy = true; javaState.error = ''; render();
      try {
        await freshTaskIdentity(['crm.task.write']);
        javaState.taskBatchIdempotencyKey ||= idempotencyKey();
        const receipt = await javaState.client.crm.tasks.createBatchChecked(javaState.taskBatchDraft, preview, javaState.taskBatchIdempotencyKey);
        if (javaState.taskBatchForm !== form) return;
        if (!validTaskBatchReceipt(receipt, javaState.taskBatchDraft, preview)) throw new Error('未收到可确认的任务批次回执，请使用原请求重试确认。');
        clearWorkspaceBlock();
        javaState.taskBatchReceipt = receipt; javaState.taskBatchForm = null; javaState.taskBatchDraft = null;
        javaState.taskBatchPreview = null; javaState.taskBatchIdempotencyKey = null; javaState.taskBatchUncertain = false; javaState.taskBatchStale = false;
        javaState.taskBatchBusy = false;
        if (javaState.activityDetail) { javaState.activityDetail.selection.clear(); javaState.activityDetail.selectionStale = false; await loadActivityAudience(javaState.activityDetail); }
        else await loadDirectory(javaState.page, javaState.listQuery, javaState.pageNumber);
      } catch (error) {
        if (isStaleWorkspace(error)) return;
        if (javaState.taskBatchForm === form) {
          javaState.error = error.message || '任务批次创建失败';
          if (error.code === 'PREVIEW_STALE' && !javaState.taskBatchUncertain) { javaState.taskBatchStale = true; if (javaState.activityDetail) javaState.activityDetail.selectionStale = true; }
          else if (javaState.taskBatchIdempotencyKey && !javaState.taskBatchUncertain && Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && leadRejections.has(error.code)) { javaState.taskBatchIdempotencyKey = null; javaState.taskBatchStale = true; }
          else if (javaState.taskBatchIdempotencyKey) javaState.taskBatchUncertain = true;
        }
      } finally {
        if (javaState.taskBatchForm === form) javaState.taskBatchBusy = false;
        render();
      }
    });
  }

  function askRoutingRuleInput(existing = null) {
    const name = root.prompt('规则名称', existing?.name || '');
    if (!name?.trim()) return null;
    const campusIds = javaState.identity.campusIds || [];
    const campusId = existing?.campusId || root.prompt(
      `适用校区编号（可用：${campusIds.join(', ') || '输入有权管理的校区编号'}）`, campusIds[0] || '');
    if (!campusId?.trim()) return null;
    let activityId = existing?.activityId || '';
    if (javaState.identity.permissions?.includes('crm.activity.read')) {
      activityId = root.prompt('限定活动编号（留空表示不限）', activityId);
      if (activityId === null) return null;
    }
    const subject = root.prompt('限定学科/项目（留空表示不限）', existing?.subject || '');
    if (subject === null) return null;
    const source = root.prompt('限定来源：online_form / front_desk / phone / referral / import / other（留空表示不限）', existing?.source || '');
    if (source === null || source && !['online_form', 'front_desk', 'phone', 'referral', 'import', 'other'].includes(source)) return null;
    const ownerId = root.prompt('接收线索的员工编号', existing?.ownerId || javaState.identity.principalId || '');
    if (!ownerId?.trim()) return null;
    const priorityText = root.prompt('优先级（数字越小越先匹配）', String(existing?.priority ?? 100));
    if (priorityText === null || !/^\d{1,5}$/.test(priorityText) || Number(priorityText) > 10000) {
      javaState.error = '优先级须为 0 到 10000 的整数。'; render(); return null;
    }
    let active = true;
    if (existing) {
      const activeValue = root.prompt('是否启用：true / false', String(existing.active));
      if (!['true', 'false'].includes(activeValue)) return null;
      active = activeValue === 'true';
    }
    const input = { name: name.trim(), ownerId: ownerId.trim(), priority: Number(priorityText), active,
      activityId: activityId.trim() || null, subject: subject.trim() || null, source: source.trim() || null };
    if (existing) input.expectedVersion = Number(existing.version);
    else input.campusId = campusId.trim();
    return input;
  }

  function askLeadInput(customer, customerId) {
    const source = root.prompt('线索来源：front_desk / online_form / phone / referral / import / other', 'front_desk');
    if (!['front_desk', 'online_form', 'phone', 'referral', 'import', 'other'].includes(source)) return null;
    const titleValue = root.prompt('本次咨询或需求名称');
    if (!titleValue?.trim()) return null;
    const subject = root.prompt('意向学科/项目（可留空）') || '';
    const term = root.prompt('意向学期（可留空）') || '';
    const detail = root.prompt('需求详情（可留空）');
    if (detail === null) return null;
    const studentOptions = (customer?.students || []).map(student => `${student.name}: ${student.studentId}`).join(', ');
    const studentId = root.prompt(`关联学生编号（可留空；可选 ${studentOptions || '暂无已关联学生'}）`, '');
    if (studentId === null) return null;
    if (studentId.trim() && !customer?.students?.some(student => student.studentId === studentId.trim())) {
      javaState.error = '学生编号不在当前客户档案的关联学生中。';
      render();
      return null;
    }
    const next = root.prompt('下次跟进时间（ISO 时间，可留空）', '');
    let nextFollowAt;
    try { nextFollowAt = optionalInstant(next); }
    catch (error) {
      if (isStaleWorkspace(error)) return;
      javaState.error = error.message;
      render();
      return null;
    }
    return { customerId, source, title: titleValue.trim(), subject: subject.trim(), term: term.trim(),
      detail: detail.trim(), studentId: studentId.trim() || null, nextFollowAt };
  }

  async function runMutation(operation, page) {
    try {
      await operation();
      javaState.error = '';
      await loadDirectory(page);
    } catch (error) {
      if (isStaleWorkspace(error)) return;
      javaState.error = error.message || '操作未完成';
      render();
    }
  }

  function localDateTime(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T00:00`;
  }

  function toJavaInstant(value) {
    return new Date(`${value}:00+08:00`).toISOString();
  }

  function optionalInstant(value) {
    if (!value?.trim()) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('时间格式无效，请使用 ISO 日期时间。');
    return date.toISOString();
  }

  installResourceSearch();
  configureMenu();
  const previousRender = root.render;
  root.render = function (...args) {
    if (javaState.identity) return render();
    return previousRender.apply(this, args);
  };
  root.nav = function (page) { return openPage(page); };
  root.workspaceBack = function () {
    if (!javaState.identity || !canLeaveWorkspace()) return;
    if (javaState.needDetail) return returnNeedWorkspace(javaState.needDetail);
    if (javaState.activityDetail) return returnActivityAudience();
    if (javaState.taskDetail) return returnTaskDetail();
    if (javaState.transactionDetail) return returnFromSalesTransaction(false, true);
    const detail = javaState.leadDetail || javaState.opportunityDetail;
    if (detail && workTabs) return activateWorkSession(detail.context.returnWorkKey || pageWorkKey(detail.context.page));
    if (detail) return document.getElementById(javaState.leadDetail ? 'java-crm-lead-back' : 'java-crm-opportunity-back')?.click?.();
    return openPage('home');
  };
  root.SIYUE_JAVA_CRM = Object.freeze({ signIn, openPage, openNeedWorkspace, openTaskRoutingWorkspace, getIdentity: () => javaState.identity });
  gate('');
  if (new URL(location.href).searchParams.has('code') || new URL(location.href).searchParams.has('error')) {
    void signIn();
  }
})(window);
