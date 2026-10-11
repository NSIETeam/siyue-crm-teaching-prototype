// Server-backed enrollment form and entry page. Mutations go through businessAPI draft APIs.
(function (root) {
  'use strict';

  let activeStep = 1;
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
  const isEnrollment = operation => ['enrollment.create', 'enrollment.batchCreate'].includes(operation?.id);
  const isBatch = operation => operation?.id === 'enrollment.batchCreate';
  const selectedStudentSearch = new Map();
  const modelPath = operation => isBatch(operation) ? [] : [];
  const pathFor = (operation, path) => [...modelPath(operation), ...path];
  const dataRows = (ctx, key) => Array.isArray(ctx?.data?.[key]) ? ctx.data[key] : [];
  const campusLabel = (ctx, id) => dataRows(ctx, 'campuses').find(row => row.id === id)?.name || '';
  const courseFor = (ctx, klass) => dataRows(ctx, 'courses').find(row => row.id === klass?.courseId) || null;
  const teacherLabel = (ctx, id, fallback) => dataRows(ctx, 'directory').find(row => row.id === id)?.name || fallback || '';
  const money = cents => Number.isFinite(Number(cents)) ? `¥${(Number(cents) / 100).toFixed(2)}` : '—';
  const normalizePhone = value => String(value || '').normalize('NFKC').trim().replace(/[\s()-]/g, '').replace(/^(?:\+86|0086)(?=1\d{10}$)/, '');
  const normalizeName = value => String(value || '').normalize('NFKC').trim();
  const students = ctx => dataRows(ctx, 'students').filter(row => row.active !== false);
  const classes = ctx => dataRows(ctx, 'classes').filter(row => row.active !== false && !['已结束', '已取消', '已关闭', 'cancelled', 'ended', 'inactive'].includes(row.status));
  const offers = ctx => (ctx?.data?.activities?.coupon || []).filter(row => row.published === true && ['进行中', '未开始', 'active', 'published'].includes(row.status));

  function initialize(ctx) {
    if (!isBatch(ctx?.operation) || !root.businessAPI?.academicSet) return false;
    const draft = clone(ctx.draft || {});
    if (Array.isArray(draft.rows) && draft.rows.length) {
      if (!Array.isArray(draft.studentIds)) return true;
      delete draft.studentIds;
      return root.businessAPI.academicSet([], draft);
    }
    if (Array.isArray(draft.studentIds) && draft.studentIds.length) {
      draft.rows = draft.studentIds.map(studentId => ({ studentId }));
      delete draft.studentIds;
      return root.businessAPI.academicSet([], draft);
    }
    delete draft.studentIds;
    draft.rows = [{ studentDraft: { name: '', phone: '' } }];
    return root.businessAPI.academicSet([], draft);
  }

  function stepNav() {
    const rows = [['学生信息', 1], ['报名信息', 2], ['费用结算', 3]];
    return `<div class="steps" aria-label="报名步骤">${rows.map(([label, step], index) => `${index ? '<span class="step-line"></span>' : ''}<span class="step${activeStep === step ? ' active' : step < activeStep ? ' done' : ''}" data-enrollment-step="${step}" aria-current="${activeStep === step ? 'step' : 'false'}" onclick="SiyueBusinessEnrollment.goTo(${step})"><i>${step < activeStep ? '✓' : step}</i>${label}</span>`).join('')}</div>`;
  }

  function input(ctx, path, label, value, { required = false, type = 'text', valueType = 'string', placeholder = '', disabled = false, help = '', min = '', max = '' } = {}) {
    const p = escape(JSON.stringify(pathFor(ctx.operation, path)));
    const disabledAttr = disabled || ctx.disabled ? 'disabled' : '';
    const req = required ? '<em>*</em>' : '';
    const attrs = `data-business-path="${p}" data-business-type="${valueType}" oninput="businessAPI.input(${p},this.value,'${valueType}'); SiyueBusinessEnrollment.refreshValidation()" onchange="businessAPI.change(${p},this.value,'${valueType}')"`;
    const limit = `${min !== '' ? `min="${escape(min)}"` : ''} ${max !== '' ? `max="${escape(max)}"` : ''}`;
    return `<div class="field"><label class="${required ? 'required' : ''}">${escape(label)}</label><input class="input" type="${type}" value="${escape(value)}" placeholder="${escape(placeholder)}" ${attrs} ${disabledAttr} ${limit}>${help ? `<div class="help">${escape(help)}</div>` : ''}</div>`;
  }

  function select(ctx, path, label, rows, value, { required = false, disabled = false, empty = '请选择', valueType = 'string', onChange = '' } = {}) {
    const p = escape(JSON.stringify(pathFor(ctx.operation, path)));
    const options = rows.map(row => `<option value="${escape(row.id)}" ${String(value || '') === String(row.id) ? 'selected' : ''}>${escape(row.label)}</option>`).join('');
    const req = required ? '<em>*</em>' : '';
    const disabledAttr = disabled || ctx.disabled ? 'disabled' : '';
    const handler = onChange || `businessAPI.change(${p},this.value,'${valueType}')`;
    return `<div class="field"><label class="${required ? 'required' : ''}">${escape(label)}</label><select class="select" data-business-path="${p}" data-business-type="${valueType}" onchange="${handler}" ${disabledAttr}><option value="">${escape(empty)}</option>${options}</select></div>`;
  }

  function checkbox(ctx, path, label, checked, disabled) {
    const p = escape(JSON.stringify(pathFor(ctx.operation, path)));
    return `<label class="be-check"><input type="checkbox" data-business-path="${p}" data-business-type="boolean" ${checked ? 'checked' : ''} onchange="businessAPI.change(${p},this.checked,'boolean')" ${disabled || ctx.disabled ? 'disabled' : ''}><span>${escape(label)}</span></label>`;
  }

  function section(step, title, content) {
    return `<section class="enrollment-section" id="be-step-${step}"><h2 class="section-title">${title}</h2>${content}</section>`;
  }

  function modeTabs(parent, isNew, disabled) {
    const arg = escape(JSON.stringify(parent));
    return `<div class="tabs enrollment-mode-tabs" role="tablist" aria-label="学生来源"><button type="button" class="tab ${!isNew ? 'active' : ''}" role="tab" aria-selected="${!isNew}" onclick="businessAPI.studentMode(${arg},false)" ${disabled ? 'disabled' : ''}>选择已有学生</button><button type="button" class="tab ${isNew ? 'active' : ''}" role="tab" aria-selected="${isNew}" onclick="businessAPI.studentMode(${arg},true)" ${disabled ? 'disabled' : ''}>登记新学生</button></div>`;
  }

  function identityControl(ctx, draft, parent, rowIndex = null) {
    const isNew = !!draft?.studentDraft;
    const pathRoot = rowIndex === null ? [] : ['rows', rowIndex];
    const feedback = `<p class="help enrollment-feedback" id="be-identity-error-${rowIndex === null ? 'single' : rowIndex}" role="status">${(rowIndex === null ? singleIssues(draft, ctx) : rowIssues(draft, ctx, rowIndex)).map(escape).join('；')}</p>`;
    const control = isNew
      ? `<div class="form-grid">${input(ctx, [...pathRoot, 'studentDraft', 'name'], '学生姓名', draft.studentDraft?.name || '', { required: true, placeholder: '请输入学生姓名', disabled: ctx.disabled })}${input(ctx, [...pathRoot, 'studentDraft', 'phone'], '联系电话', draft.studentDraft?.phone || '', { required: true, type: 'tel', placeholder: '请输入手机号', help: '支持带国家码和空格的手机号格式。', disabled: ctx.disabled })}${select(ctx, [...pathRoot, 'studentDraft', 'grade'], '年级', gradeChoices(), draft.studentDraft?.grade || '', { disabled: ctx.disabled, empty: '请选择年级' })}${select(ctx, [...pathRoot, 'studentDraft', 'campusId'], '所属校区', campusChoices(ctx), draft.studentDraft?.campusId || '', { disabled: ctx.disabled, empty: '使用默认校区' })}</div>${draft.studentDraft?.originLeadId ? `<input type="hidden" data-business-path="${escape(JSON.stringify(pathFor(ctx.operation, [...pathRoot, 'studentDraft', 'originLeadId'])))}" data-business-type="string" value="${escape(draft.studentDraft.originLeadId)}">` : ''}${feedback}`
      : `${studentPicker(ctx, pathRoot, draft?.studentId || '')}${feedback}`;
    return `${modeTabs(parent, isNew, !!ctx.disabled)}${control}`;
  }

  function singleIssues(draft, ctx) {
    const hasStudent = !!draft.studentId, newStudent = draft.studentDraft;
    if (hasStudent === !!newStudent) return ['请选择已有学生或填写新生资料'];
    if (newStudent) {
      const issues = [];
      if (!String(newStudent.name || '').trim()) issues.push('请填写学生姓名');
      if (!/^1[3-9]\d{9}$/.test(normalizePhone(newStudent.phone))) issues.push('请填写有效手机号');
      if (students(ctx).some(row => normalizeName(row.name) === normalizeName(newStudent.name) && normalizePhone(row.phone) === normalizePhone(newStudent.phone))) issues.push('该学生档案已存在，请选择已有学生');
      return issues;
    }
    return students(ctx).some(row => row.id === draft.studentId) ? [] : ['请从当前可见学生中选择'];
  }

  function rowIssues(row, ctx, index) {
    const hasStudent = !!row?.studentId, hasDraft = !!row?.studentDraft;
    if (hasStudent === hasDraft) return ['请选择已有学生或填写新生资料'];
    if (hasDraft) {
      const issues = [];
      if (!String(row.studentDraft.name || '').trim()) issues.push('请填写学生姓名');
      if (!/^1[3-9]\d{9}$/.test(normalizePhone(row.studentDraft.phone))) issues.push('请填写有效手机号');
      if (students(ctx).some(student => normalizeName(student.name) === normalizeName(row.studentDraft.name) && normalizePhone(student.phone) === normalizePhone(row.studentDraft.phone))) issues.push('该学生档案已存在，请选择已有学生');
      const duplicates = (ctx.draft.rows || []).filter((item, itemIndex) => itemIndex !== index && item?.studentDraft && normalizeName(item.studentDraft.name) === normalizeName(row.studentDraft.name) && normalizePhone(item.studentDraft.phone) === normalizePhone(row.studentDraft.phone) && normalizeName(row.studentDraft.name) && normalizePhone(row.studentDraft.phone)).length;
      if (duplicates) issues.push('本批重复登记了同一学生');
      return issues;
    }
    if (!students(ctx).some(student => student.id === row.studentId)) return ['请从当前可见学生中选择'];
    const duplicates = (ctx.draft.rows || []).filter(item => item.studentId === row.studentId).length;
    return duplicates > 1 ? ['本批重复选择了同一学生'] : [];
  }

  function studentPicker(ctx, pathRoot, selectedId) {
    const rows = students(ctx);
    const path = [...pathRoot, 'studentId'];
    const p = escape(JSON.stringify(pathFor(ctx.operation, path)));
    if (!rows.length) return `<p class="help">当前没有可选择的学生，请切换为登记新学生。</p>`;
    const searchKey = rowIndexKey(pathRoot), query = selectedStudentSearch.get(searchKey) || '';
    return `<div class="enrollment-student-picker"><input class="input enrollment-student-search" type="search" aria-label="搜索已有学生" placeholder="搜索姓名、手机号或年级" value="${escape(query)}" oninput="SiyueBusinessEnrollment.filterStudents(this,'${escape(searchKey)}')" ${ctx.disabled ? 'disabled' : ''}><div class="table-wrap"><table class="table enrollment-student-table"><thead><tr><th>选择</th><th>学生姓名</th><th>联系电话</th><th>年级</th></tr></thead><tbody>${rows.map(row => `<tr data-student-search="${escape([row.name, row.phone, row.grade].join(' ').toLowerCase())}" ${String(selectedId) === String(row.id) ? 'data-selected="true"' : ''}><td><input type="radio" name="enrollment-student-${searchKey}" value="${escape(row.id)}" data-business-path="${p}" data-business-type="string" ${String(selectedId) === String(row.id) ? 'checked' : ''} onchange="businessAPI.change(${p},this.value,'string')" ${ctx.disabled ? 'disabled' : ''}></td><td>${escape(row.name)}</td><td>${escape(row.phone || '—')}</td><td>${escape(row.grade || '—')}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  function rowIndexKey(pathRoot) { return pathRoot.length ? pathRoot.join('-') : 'single'; }
  function gradeChoices() {
    const rows = root.SiyueAcademicDictionary?.grades;
    return Array.isArray(rows) ? rows.map(row => ({ id: row.value, label: row.label || row.value })) : [];
  }
  function campusChoices(ctx) {
    return dataRows(ctx, 'campuses').filter(row => row.active !== false).map(row => ({ id: row.id, label: row.name || row.id }));
  }
  function filterStudents(inputElement) {
    const query = String(inputElement?.value || '').normalize('NFKC').trim().toLowerCase();
    const picker = inputElement?.closest?.('.enrollment-student-picker');
    if (!picker) return false;
    const searchKey = String(inputElement.getAttribute('oninput') || '').match(/filterStudents\(this,'([^']+)'\)/)?.[1];
    if (searchKey) selectedStudentSearch.set(searchKey, inputElement.value || '');
    for (const row of picker.querySelectorAll('tbody tr')) {
      const normalized = String(row.getAttribute('data-student-search') || '').normalize('NFKC').toLowerCase();
      row.hidden = !row.hasAttribute('data-selected') && !!query && !normalized.includes(query);
    }
    return true;
  }

  function classChoices(ctx) {
    return classes(ctx).map(row => ({ id: row.id, label: `${row.name}${campusLabel(ctx, row.campusId) ? ` · ${campusLabel(ctx, row.campusId)}` : ''}${row.date ? ` · ${row.date}` : ''}` }));
  }

  function classSummary(ctx, klass) {
    if (!klass) return '<div class="be-empty">请选择报名班级</div>';
    const course = courseFor(ctx, klass), campus = campusLabel(ctx, klass.campusId), teacher = teacherLabel(ctx, klass.teacherId, klass.teacher);
    const firstSession = (klass.schedule || [])[0];
    return `<div class="summary-box enrollment-class-summary"><div class="summary-line"><span>报名班级</span><strong>${escape(klass.name)}</strong></div>${course ? `<div class="summary-line"><span>课程</span><strong>${escape(course.name)}</strong></div>` : ''}${campus ? `<div class="summary-line"><span>校区</span><strong>${escape(campus)}</strong></div>` : ''}${teacher ? `<div class="summary-line"><span>授课老师</span><strong>${escape(teacher)}</strong></div>` : ''}${firstSession ? `<div class="summary-line"><span>开课时间</span><strong>${escape(`${firstSession.date || ''} ${firstSession.time || ''}`)}</strong></div>` : ''}${course?.priceCents !== undefined ? `<div class="summary-line"><span>课程标价</span><strong>${money(course.priceCents)}</strong></div>` : ''}</div>`;
  }

  function classSection(ctx) {
    const selected = classes(ctx).find(row => row.id === ctx.draft.classId);
    const rows = classChoices(ctx);
    return `${select(ctx, ['classId'], '报名班级', rows, ctx.draft.classId || '', { required: true, disabled: ctx.disabled })}${classSummary(ctx, selected)}`;
  }

  function settlementSection(ctx, batch) {
    const offerRows = offers(ctx).map(row => ({ id: row.id, label: row.name || row.title || row.id }));
    const studentRows = students(ctx).map(row => ({ id: row.id, label: `${row.name} · ${row.phone || '未填电话'}` }));
    const selectedClass = classes(ctx).find(row => row.id === ctx.draft.classId);
    const course = courseFor(ctx, selectedClass);
    const extra = `<div class="form-grid">${select(ctx, ['couponId'], '优惠券', offerRows, ctx.draft.couponId || '', { disabled: ctx.disabled, empty: '不使用优惠券' })}${select(ctx, ['referrerStudentId'], '推荐学生', studentRows, ctx.draft.referrerStudentId || '', { disabled: ctx.disabled, empty: '无推荐学生' })}</div>`;
    const batchExtra = batch ? `<div class="summary-box">${(ctx.draft.rows || []).map((row, index) => {
      const student = students(ctx).find(item => item.id === row.studentId), name = row.studentDraft?.name || student?.name || `第 ${index + 1} 行学生`;
      return `<div class="summary-line"><span>${escape(name)} · ${escape(course?.name || '未选课程')}</span><strong>待预览金额</strong></div>`;
    }).join('')}</div>` : `<div class="summary-box"><div class="summary-line"><span>${escape(course?.name || '未选课程')} · ${escape(ctx.draft.studentDraft?.name || students(ctx).find(row => row.id === ctx.draft.studentId)?.name || '未选学生')}</span><strong>待预览金额</strong></div></div>`;
    return `${batchExtra}${extra}<p class="help">优惠与应收金额以确认页为准。</p>`;
  }

  function renderSingle(ctx) {
    return `${section(1, '学生信息', identityControl(ctx, ctx.draft, []))}<hr class="divider">${section(2, '报名信息', classSection(ctx))}<hr class="divider">${section(3, '费用结算', settlementSection(ctx, false))}`;
  }

  function renderBatchRows(ctx) {
    const rows = Array.isArray(ctx.draft.rows) ? ctx.draft.rows : [];
    if (!rows.length) return '<div class="be-empty">暂无学生</div>';
    return `<div class="be-batch-table">${rows.map((row, index) => {
      const issues = rowIssues(row, ctx, index), mode = row?.studentDraft ? '登记新学生' : '选择已有学生';
      return `<article class="subcard enrollment-batch-row${issues.length ? ' has-errors' : ''}" id="be-row-${index}"><div class="subcard-head"><h3>学生 ${index + 1}</h3><span>${mode}</span></div>${identityControl(ctx, row, ['rows', index], index)}<button class="btn small danger" type="button" onclick="SiyueBusinessEnrollment.removeRow(${index})" ${ctx.disabled ? 'disabled' : ''}>移出本批</button></article>`;
    }).join('')}</div><button type="button" class="btn" onclick="SiyueBusinessEnrollment.addRow()" ${ctx.disabled ? 'disabled' : ''}>＋ 添加学生</button>`;
  }

  function renderBatch(ctx) {
    return `${section(1, '学生信息', renderBatchRows(ctx))}${section(2, '报名信息', classSection(ctx))}${section(3, '费用结算', settlementSection(ctx, true))}`;
  }

  function renderForm(ctx) {
    if (!isEnrollment(ctx?.operation)) return null;
    return `<div class="enrollment-form${ctx.disabled ? ' is-disabled' : ''}" aria-label="报名办理">${stepNav()}${isBatch(ctx.operation) ? renderBatch(ctx) : renderSingle(ctx)}</div>`;
  }

  function permittedOperation(id, ctx) {
    const api = root.businessAPI;
    const catalog = api?.catalog?.();
    const operation = Array.isArray(catalog) ? catalog.find(row => row.id === id) : null;
    if (!operation || operation.implemented === false || operation.execution === 'planned') return false;
    if (typeof ctx?.permitted === 'function') return !!ctx.permitted(id);
    const permissions = ctx?.permissions || ctx?.user?.permissions;
    if (Array.isArray(permissions) && operation.permission) return permissions.includes(operation.permission);
    return true;
  }

  function renderPage(ctx) {
    if (!['enroll', 'quickEnroll'].includes(ctx?.page)) return null;
    const tabs = [
      ['enrollment.create', '单个报名'],
      ['enrollment.batchCreate', '批量报名']
    ].filter(([id]) => permittedOperation(id, ctx));
    if (!tabs.length) return '<section class="be-enroll-entry"><p>当前账号没有报名权限。</p></section>';
    return `<div class="card enrollment-entry"><div class="tabs" role="tablist" aria-label="报名方式">${tabs.map(([id, label], index) => `<button type="button" role="tab" aria-selected="${index === 0}" class="tab ${index === 0 ? 'active' : ''}" onclick="businessAPI.open('${id}')">${label}</button>`).join('')}</div><div class="pad">${classChoices(ctx).length ? '' : '<p class="help">当前没有可报名的有效班级。</p>'}</div></div>`;
  }

  function renderTabs(ctx) {
    const tabs = [
      ['enrollment.create', '单个报名'],
      ['enrollment.batchCreate', '批量报名']
    ].filter(([id]) => permittedOperation(id, ctx));
    if (!tabs.length) return '';
    return `<div class="tabs enrollment-entry-tabs" role="tablist" aria-label="报名方式">${tabs.map(([id, label]) => {
      const active = ctx?.operation?.id === id;
      return `<button type="button" role="tab" aria-selected="${active}" class="tab ${active ? 'active' : ''}" onclick="businessAPI.open('${id}')">${label}</button>`;
    }).join('')}</div>`;
  }

  function goTo(step) {
    if (![1, 2, 3].includes(step)) return false;
    activeStep = step;
    const doc = root.document;
    if (doc) {
      for (const button of doc.querySelectorAll('[data-enrollment-step]')) {
        const selected = Number(button.getAttribute('data-enrollment-step')) === step;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-current', selected ? 'step' : 'false');
      }
      doc.querySelector(`#be-step-${step}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
    return true;
  }

  function addRow() {
    const ctx = root.businessAPI?.academicDraft?.();
    if (!ctx || !isBatch(ctx.operation) || ctx.disabled) return false;
    const draft = clone(ctx.draft || {}), rows = [...(draft.rows || [])];
    rows.push({ studentDraft: { name: '', phone: '' } });
    draft.rows = rows;
    return root.businessAPI.academicSet([], draft);
  }

  function removeRow(index) {
    const ctx = root.businessAPI?.academicDraft?.();
    if (!ctx || !isBatch(ctx.operation) || ctx.disabled) return false;
    const draft = clone(ctx.draft || {}), rows = [...(draft.rows || [])];
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) return false;
    rows.splice(index, 1);
    draft.rows = rows;
    return root.businessAPI.academicSet([], draft);
  }

  function refreshValidation() {
    const ctx = root.businessAPI?.academicDraft?.();
    if (!ctx || !isEnrollment(ctx.operation)) return false;
    const doc = root.document;
    if (!doc) return false;
    if (isBatch(ctx.operation)) {
      (ctx.draft.rows || []).forEach((row, index) => {
        const issues = rowIssues(row, ctx, index), host = doc.querySelector(`#be-row-${index}`), feedback = doc.querySelector(`#be-identity-error-${index}`);
        if (host) host.classList.toggle('has-errors', issues.length > 0);
        if (feedback) feedback.textContent = issues.join('；');
      });
    } else {
      const feedback = doc.querySelector('#be-identity-error-single');
      if (feedback) feedback.textContent = singleIssues(ctx.draft, ctx).join('；');
    }
    return true;
  }

  function reset() { activeStep = 1; selectedStudentSearch.clear(); }

  root.SiyueBusinessEnrollment = {
    renderForm, renderPage, renderTabs, initialize, reset, goTo, addRow, removeRow, filterStudents,
    refreshValidation, rowIssues, singleIssues
  };
})(typeof window === 'undefined' ? globalThis : window);
