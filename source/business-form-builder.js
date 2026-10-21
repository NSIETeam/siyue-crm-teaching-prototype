// Server form builder for the authenticated business preview/execute flow.
(function (root) {
  'use strict';

  const types = [
    ['name', '姓名'], ['phone', '手机号'], ['text', '单行文字'],
    ['textarea', '多行文字'], ['single', '单选'], ['multiple', '多选'],
    ['dropdown', '下拉选择'], ['date', '日期'], ['time', '时间'],
    ['gender', '性别'], ['description', '说明文字'], ['divider', '分隔线']
  ];
  const choices = new Set(['single', 'multiple', 'dropdown', 'gender']);
  const decorative = new Set(['description', 'divider']);
  const excluded = new Set(['__proto__', 'constructor', 'prototype']);
  let selectedField = null;
  let trialCampusFilter = '';
  let trialCourseFilter = '';

  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
  const js = value => escape(JSON.stringify(String(value)));
  const fieldTitle = type => types.find(row => row[0] === type)?.[1] || '字段';
  const isBuilderOperation = operation => ['form.create', 'form.update'].includes(operation?.id);
  const isUpdate = operation => operation?.id === 'form.update';
  const modelPath = operation => isUpdate(operation) ? ['patch'] : [];

  function formRow(ctx) {
    const id = ctx?.draft?.formId;
    return (ctx?.data?.forms || []).find(row => row.id === id) || null;
  }

  function defaultFields(kind) {
    const rows = [
      { id: 'student-name', type: 'name', title: '学生姓名', required: true },
      { id: 'contact-phone', type: 'phone', title: '联系电话', required: true }
    ];
    if (kind === 'survey') rows.push({ id: 'parent-needs', type: 'textarea', title: '希望了解或改善哪些方面？', required: true });
    else rows.push({ id: 'lead-needs', type: 'textarea', title: '课程诉求', required: false });
    return rows;
  }

  function initialize(ctx) {
    if (!isBuilderOperation(ctx?.operation) || !root.businessAPI?.academicSet) return false;
    const operation = ctx.operation, draft = clone(ctx.draft || {});
    if (isUpdate(operation) && (!draft.patch || !Object.keys(draft.patch).length || draft.expectedVersion === undefined)) {
      const row = formRow(ctx);
      if (!row) return false;
      const patch = { ...(draft.patch || {}) };
      for (const key of ['title', 'kind', 'collectLead', 'campusId', 'fields', 'settings']) {
        if (patch[key] === undefined && row[key] !== undefined) patch[key] = clone(row[key]);
      }
      if (patch.kind === 'survey' && patch.collectLead !== false) patch.collectLead = false;
      return root.businessAPI.academicSet([], { ...draft, expectedVersion: draft.expectedVersion ?? row.version, patch });
    }
    if (!isUpdate(operation)) {
      const kind = draft.kind || 'custom';
      let changed = false;
      if (!draft.kind) { draft.kind = kind; changed = true; }
      if (draft.collectLead === undefined) { draft.collectLead = kind === 'lead'; changed = true; }
      if (kind === 'survey' && draft.collectLead !== false) { draft.collectLead = false; changed = true; }
      if (!Array.isArray(draft.fields) || !draft.fields.length) { draft.fields = defaultFields(kind); changed = true; }
      if (!draft.settings || typeof draft.settings !== 'object') {
        draft.settings = { quantity: 1000, maxPerIdentity: 1, source: '表单获客' }; changed = true;
      } else {
        for (const [key, value] of Object.entries({ quantity: 1000, maxPerIdentity: 1, source: '表单获客' })) {
          if (draft.settings[key] === undefined) { draft.settings[key] = value; changed = true; }
        }
      }
      if (changed) return root.businessAPI.academicSet([], draft);
    }
    return true;
  }

  function current(ctx) {
    const draft = ctx.draft || {};
    if (!isUpdate(ctx.operation)) return draft;
    return draft.patch || {};
  }

  function setPath(ctx, path, value) {
    if (ctx.disabled || !root.businessAPI?.academicSet) return false;
    return root.businessAPI.academicSet([...modelPath(ctx.operation), ...path], clone(value));
  }

  function readContext() {
    return root.businessAPI?.academicDraft?.() || null;
  }

  function setMeta(key, value) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled) return false;
    if (key === 'collectLead' && current(ctx).kind === 'survey') value = false;
    return setPath(ctx, [key], value);
  }

  function setSetting(key, value) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled) return false;
    const model = current(ctx), settings = { ...(model.settings || {}), [key]: value };
    return setPath(ctx, ['settings'], settings);
  }

  function setReward(type) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled) return false;
    let reward = null;
    if (type === 'coupon') reward = { type, promotionId: '' };
    else if (type === 'material_link') reward = { type, title: '', url: '' };
    else if (type !== 'none') return false;
    return setSetting('reward', reward);
  }

  function setTrialEnabled(enabled) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled) return false;
    const model = current(ctx), settings = model.settings || {};
    const trial = enabled ? (settings.trial || {
      enabled: true, campusFieldId: '', gradeFieldId: '', subjectFieldId: '',
      nameFieldId: '', phoneFieldId: '', slots: []
    }) : null;
    if (trial) trial.enabled = true;
    return setSetting('trial', trial);
  }

  function setTrialField(key, value) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled || !['campusFieldId', 'gradeFieldId', 'subjectFieldId', 'nameFieldId', 'phoneFieldId'].includes(key)) return false;
    const model = current(ctx), trial = clone(model.settings?.trial || {});
    if (value) trial[key] = value; else delete trial[key];
    trial.enabled = true;
    return setSetting('trial', trial);
  }

  function updateTrialSlot(id, key, value) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled || !['capacity'].includes(key)) return false;
    const model = current(ctx), trial = clone(model.settings?.trial || {}), slot = (trial.slots || []).find(row => row.id === id);
    if (!slot) return false;
    slot[key] = Math.max(1, Math.min(1000, Number(value) || 1));
    return setSetting('trial', trial);
  }

  function toggleTrialSlot(classId, sessionId, checked) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled) return false;
    const model = current(ctx), trial = clone(model.settings?.trial || { enabled: true, slots: [] });
    trial.enabled = true;
    trial.slots = Array.isArray(trial.slots) ? trial.slots : [];
    const old = trial.slots.findIndex(row => row.classId === classId && row.sessionId === sessionId);
    if (checked && old < 0) trial.slots.push({ id: newSlotId(trial.slots), classId, sessionId, capacity: 10 });
    if (!checked && old >= 0) trial.slots.splice(old, 1);
    return setSetting('trial', trial);
  }

  function removeTrialSlot(id) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled) return false;
    const model = current(ctx), trial = clone(model.settings?.trial || {});
    if (!(trial.slots || []).some(row => row.id === id)) return false;
    trial.slots = trial.slots.filter(row => row.id !== id);
    return setSetting('trial', trial);
  }

  function newSlotId(slots) {
    let id;
    do { id = `trial-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }
    while (slots.some(row => row.id === id));
    return id;
  }

  function addTrialMatchFields() {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled) return false;
    const model = current(ctx), fields = clone(model.fields || []);
    const addDropdown = (prefix, title, options) => {
      const titleByKey = { campus: '所在校区', grade: '学生年级', subject: '感兴趣的学科' };
      let field = fields.find(row => row.type === 'dropdown' && row.title === titleByKey[prefix]);
      if (!field) {
        const id = newFieldId(fields);
        field = { id, type: 'dropdown', title, required: true, options };
        fields.push(field);
      } else {
        field.required = true;
        field.options = [...options];
      }
      return field.id;
    };
    const campuses = (ctx.data?.campuses || []).filter(row => row.active !== false);
    const academic = root.SiyueAcademicDictionary;
    const grades = (academic?.grades || []).map(row => row.value || row);
    const subjects = academic?.subjects?.(ctx.data?.dictionary || {}, []) || [];
    const campusId = addDropdown('campus', '所在校区', campuses.map(row => row.name));
    const gradeId = addDropdown('grade', '学生年级', grades);
    const subjectId = addDropdown('subject', '感兴趣的学科', subjects);
    const nameField = fields.find(row => row.type === 'name');
    const phoneField = fields.find(row => row.type === 'phone');
    if (nameField) nameField.required = true;
    if (phoneField) phoneField.required = true;
    const nameId = nameField?.id || '';
    const phoneId = phoneField?.id || '';
    const next = { ...model, fields };
    if (isUpdate(ctx.operation)) {
      const draft = clone(ctx.draft || {}); draft.patch = next;
      if (draft.expectedVersion === undefined) return false;
      return root.businessAPI.academicSet([], draft);
    }
    const draft = clone(ctx.draft || {}); Object.assign(draft, next);
    const ok = root.businessAPI.academicSet([], draft);
    if (ok) {
      const trial = clone(next.settings?.trial || { enabled: true, slots: [] });
      Object.assign(trial, { enabled: true, campusFieldId: campusId, gradeFieldId: gradeId, subjectFieldId: subjectId, nameFieldId: nameId, phoneFieldId: phoneId });
      setSetting('trial', trial);
    }
    return ok;
  }

  function setTrialFilter(key, value) {
    if (key === 'campus') trialCampusFilter = value || '';
    if (key === 'course') trialCourseFilter = value || '';
    root.businessAPI?.redraw?.();
    return true;
  }

  function couponRows(ctx) {
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    return (ctx.data?.activities?.coupon || []).filter(row => row.published === true && ['进行中', 'active', 'published'].includes(row.status) && ['通用优惠', '满减券', '代金券'].includes(row.template || '通用优惠') && (!row.start || row.start <= today) && (!row.end || row.end >= today));
  }

  function futureSessions(ctx, model) {
    const trial = model.settings?.trial || {};
    const boundCampus = !!trial.campusFieldId;
    const chosenCampus = boundCampus ? trialCampusFilter : (model.campusId || '');
    return (ctx.data?.classes || []).filter(klass => klass.active !== false && !['已结束', '已结课', '已取消', 'ended', 'cancelled'].includes(klass.status) && (!chosenCampus || klass.campusId === chosenCampus) && (!trialCourseFilter || klass.courseId === trialCourseFilter)).flatMap(klass => {
      const course = (ctx.data?.courses || []).find(row => row.id === klass.courseId);
      if (!course || course.active === false) return [];
      return (klass.schedule || []).filter(session => {
        if (!session.id || ['已取消', '已结束', 'cancelled', 'ended'].includes(session.status)) return false;
        const start = Date.parse(`${session.date || ''}T${String(session.time || '').slice(0, 5)}:00+08:00`);
        return Number.isFinite(start) && start > Date.now();
      }).map(session => ({ klass, course, session }));
    }).sort((a, b) => `${a.session.date} ${a.session.time}`.localeCompare(`${b.session.date} ${b.session.time}`));
  }

  function slotIsUsableFuture(ctx, slot) {
    const klass = (ctx.data?.classes || []).find(row => row.id === slot.classId);
    const session = klass?.schedule?.find(row => row.id === slot.sessionId);
    const course = (ctx.data?.courses || []).find(row => row.id === klass?.courseId);
    const start = session && Date.parse(`${session.date || ''}T${String(session.time || '').slice(0, 5)}:00+08:00`);
    return !!klass && klass.active !== false && !['已结束', '已结课', '已取消', 'ended', 'cancelled'].includes(klass.status) &&
      !!course && course.active !== false && !!session && !['已取消', '已结束', 'cancelled', 'ended'].includes(session.status) &&
      Number.isFinite(start) && start > Date.now();
  }

  function hiddenSelectedSlots(ctx, slots, candidateRows, campuses, disabled) {
    const visible = new Set(candidateRows.map(row => row.klass.id + '|' + row.session.id));
    return slots.filter(slot => !visible.has(slot.classId + '|' + slot.sessionId)).map(slot => {
      const klass = (ctx.data?.classes || []).find(row => row.id === slot.classId);
      const session = klass?.schedule?.find(row => row.id === slot.sessionId);
      const course = (ctx.data?.courses || []).find(row => row.id === klass?.courseId);
      const campus = campuses.find(row => row.id === klass?.campusId);
      const status = slotIsUsableFuture(ctx, slot) ? '不在当前筛选结果中' : '已停用或已过期，请移除后再发布';
      return '<div class="sfb-selected-slot"><span><strong>' + escape(klass?.name || '班级已不可用') + ' · ' + escape(course?.name || '') +
        '</strong><small>' + escape(campus?.name || '') + ' · ' + escape(session?.date || '课次已不可用') + ' ' + escape(session?.time || '') +
        ' · ' + status + '</small></span><button type="button" onclick="SiyueBusinessFormBuilder.removeTrialSlot(' + js(slot.id) +
        ')" ' + (disabled ? 'disabled' : '') + '>移除</button></div>';
    }).join('');
  }

  function fieldBinding(label, key, fieldRows, selected, disabled) {
    return `<label class="sfb-control"><span>${escape(label)}</span><select onchange="SiyueBusinessFormBuilder.setTrialField('${key}',this.value)" ${disabled ? 'disabled' : ''}><option value="">请选择表单字段</option>${fieldRows.map(field => `<option value="${escape(field.id)}" ${selected === field.id ? 'selected' : ''}>${escape(field.title || field.id)} · ${escape(field.type)}</option>`).join('')}</select></label>`;
  }

  function rewardTrialSettings(ctx, model, disabled) {
    const settings = model.settings || {}, reward = settings.reward || null, trial = settings.trial || null;
    const rewardType = reward?.type || 'none';
    const rewardMarkup = `<div class="sfb-reward-grid"><label class="sfb-control"><span>提交奖励</span><select onchange="SiyueBusinessFormBuilder.setReward(this.value)" ${disabled ? 'disabled' : ''}><option value="none" ${rewardType === 'none' ? 'selected' : ''}>不设置奖励</option><option value="coupon" ${rewardType === 'coupon' ? 'selected' : ''}>领取优惠券</option><option value="material_link" ${rewardType === 'material_link' ? 'selected' : ''}>领取资料</option></select></label>${rewardType === 'coupon' ? `<label class="sfb-control"><span>已发布优惠券</span><select data-business-path="${escape(JSON.stringify(businessPath(ctx.operation, ['settings', 'reward', 'promotionId'])))}" data-business-type="string" onchange="businessAPI.change(${escape(JSON.stringify(businessPath(ctx.operation, ['settings', 'reward', 'promotionId'])))},this.value,'string')" ${disabled ? 'disabled' : ''}><option value="">请选择优惠券</option>${couponRows(ctx).map(row => `<option value="${escape(row.id)}" ${reward.promotionId === row.id ? 'selected' : ''}>${escape(row.name || row.title || row.id)}</option>`).join('')}</select>${!couponRows(ctx).length ? '<small>暂无当前可领取的已发布优惠券</small>' : ''}</label>` : ''}${rewardType === 'material_link' ? `${input('资料标题', reward.title || '', ctx.operation, ['settings', 'reward', 'title'], disabled)}${input('HTTPS 资料链接', reward.url || '', ctx.operation, ['settings', 'reward', 'url'], disabled, 'url', 'string', 'placeholder="https://"')}` : ''}</div>`;
    const fields = Array.isArray(model.fields) ? model.fields : [];
    const requiredFields = fields.filter(field => field.required === true);
    const nameFields = requiredFields.filter(field => ['name', 'text', 'single', 'dropdown'].includes(field.type));
    const phoneFields = requiredFields.filter(field => field.type === 'phone');
    const campusFields = requiredFields.filter(field => ['single', 'dropdown'].includes(field.type));
    const gradeFields = requiredFields.filter(field => ['name', 'phone', 'text', 'single', 'dropdown'].includes(field.type));
    const subjectFields = gradeFields;
    const courses = (ctx.data?.courses || []).filter(row => row.active !== false);
    const campuses = (ctx.data?.campuses || []).filter(row => row.active !== false);
    let sessionsMarkup = '';
    if (trial?.enabled) {
      const slots = trial.slots || [];
      const candidateRows = futureSessions(ctx, model);
      sessionsMarkup = `<div class="sfb-session-filter"><label class="sfb-control"><span>筛选校区</span><select onchange="SiyueBusinessFormBuilder.setTrialFilter('campus',this.value)" ${disabled || !trial.campusFieldId ? 'disabled' : ''}><option value="">全部校区</option>${campuses.map(row => `<option value="${escape(row.id)}" ${trialCampusFilter === row.id ? 'selected' : ''}>${escape(row.name)}</option>`).join('')}</select></label><label class="sfb-control"><span>筛选课程</span><select onchange="SiyueBusinessFormBuilder.setTrialFilter('course',this.value)" ${disabled ? 'disabled' : ''}><option value="">全部课程</option>${courses.map(row => `<option value="${escape(row.id)}" ${trialCourseFilter === row.id ? 'selected' : ''}>${escape(row.name)}</option>`).join('')}</select></label></div><div class="sfb-session-list">${candidateRows.map(({ klass, course, session }) => {
        const selected = slots.find(row => row.classId === klass.id && row.sessionId === session.id);
        const campus = campuses.find(row => row.id === klass.campusId);
        return `<div class="sfb-session-row"><label><input type="checkbox" ${selected ? 'checked' : ''} onchange="SiyueBusinessFormBuilder.toggleTrialSlot(${js(klass.id)},${js(session.id)},this.checked)" ${disabled ? 'disabled' : ''}><span><strong>${escape(klass.name)} · ${escape(course.name)}</strong><small>${escape(campus?.name || '校区未配置')} · ${escape(course.grade || '')} ${escape(course.subject || '')} · ${escape(session.date || '')} ${escape(session.time || '')}</small></span></label>${selected ? `<label class="sfb-capacity"><span>预约人数</span><input type="number" min="1" max="1000" value="${escape(selected.capacity)}" data-business-path="${escape(JSON.stringify(businessPath(ctx.operation, ['settings', 'trial', 'slots', slots.indexOf(selected), 'capacity'])))}" data-business-type="integer" oninput="businessAPI.input(${escape(JSON.stringify(businessPath(ctx.operation, ['settings', 'trial', 'slots', slots.indexOf(selected), 'capacity'])) )},this.value,'integer')" onchange="SiyueBusinessFormBuilder.updateTrialSlot(${js(selected.id)},'capacity',this.value)" ${disabled ? 'disabled' : ''}></label>` : ''}</div>`;
      }).join('') || '<p class="sfb-help">没有符合筛选条件的未来课次。</p>'}</div>`;
      sessionsMarkup = sessionsMarkup.slice(0, -6) + hiddenSelectedSlots(ctx, slots, candidateRows, campuses, disabled) + '</div>';
    }
    const bindingMarkup = trial?.enabled ? `<div class="sfb-binding-grid">${fieldBinding('校区字段（若表单已固定校区可不选）', 'campusFieldId', campusFields, trial.campusFieldId, disabled)}${fieldBinding('年级字段', 'gradeFieldId', gradeFields, trial.gradeFieldId, disabled)}${fieldBinding('学科字段', 'subjectFieldId', subjectFields, trial.subjectFieldId, disabled)}${fieldBinding('学生姓名字段', 'nameFieldId', nameFields, trial.nameFieldId, disabled)}${fieldBinding('家长手机号字段', 'phoneFieldId', phoneFields, trial.phoneFieldId, disabled)}</div>${!model.campusId && !trial.campusFieldId ? '<p class="sfb-notice">请先设置表单固定校区或绑定校区字段。</p>' : ''}${sessionsMarkup}` : '';
    return `<section class="sfb-reward-trial"><details><summary>填写奖励与试课</summary><div class="sfb-reward-content"><div class="sfb-settings-block"><h3>提交奖励</h3>${rewardMarkup}</div><div class="sfb-settings-block"><div class="sfb-settings-heading"><h3>试课预约</h3><label class="sfb-switch"><input type="checkbox" ${trial?.enabled ? 'checked' : ''} onchange="SiyueBusinessFormBuilder.setTrialEnabled(this.checked)" ${disabled ? 'disabled' : ''}><span>开放预约未来课次</span></label></div><p class="sfb-help">仅公开你明确勾选的未来课次；家长信息按下方绑定字段读取。</p>${trial?.enabled ? `<button type="button" class="sfb-link" onclick="SiyueBusinessFormBuilder.addTrialMatchFields()" ${disabled ? 'disabled' : ''}>＋ 添加试课匹配字段</button>${bindingMarkup}` : '<p class="sfb-help">默认关闭。开启后请选择字段并勾选可预约课次。</p>'}</div></div></details></section>`;
  }

  function setField(id, key, value) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled) return false;
    const fields = clone(current(ctx).fields || []), index = fields.findIndex(field => field.id === id);
    if (index < 0 || key === 'id' || excluded.has(key)) return false;
    fields[index][key] = value;
    return setPath(ctx, ['fields'], fields);
  }

  function setOption(id, index, value) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled) return false;
    const fields = clone(current(ctx).fields || []), field = fields.find(row => row.id === id);
    if (!field || !choices.has(field.type) || !Array.isArray(field.options) || !Number.isInteger(index) || index < 0 || index >= field.options.length) return false;
    field.options[index] = value;
    return setPath(ctx, ['fields'], fields);
  }

  function addField(type) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled || !types.some(row => row[0] === type)) return false;
    const model = current(ctx), fields = clone(model.fields || []);
    const id = newFieldId(fields), field = { id, type, title: fieldTitle(type), required: !decorative.has(type) };
    if (choices.has(type)) field.options = type === 'gender' ? ['男', '女', '其他'] : ['选项一', '选项二'];
    if (type === 'multiple') { field.min = 0; field.max = 2; }
    fields.push(field); selectedField = id;
    return setPath(ctx, ['fields'], fields);
  }

  function newFieldId(fields) {
    let id;
    do {
      id = `field-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    } while (fields.some(field => field.id === id));
    return id;
  }

  function select(id) {
    selectedField = id;
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation)) return false;
    const model = current(ctx), field = (model.fields || []).find(row => row.id === id) || null;
    const doc = root.document;
    if (doc) {
      for (const button of doc.querySelectorAll('.sfb-preview-field')) {
        button.classList.toggle('is-selected', button.getAttribute('data-field') === id);
      }
      const panel = doc.querySelector('.sfb-properties');
      if (panel && field) panel.outerHTML = editorField(field, !!ctx.disabled, ctx.operation, model);
      else if (panel && !field) panel.outerHTML = properties(model, null, !!ctx.disabled, ctx.operation);
    }
    return true;
  }

  function removeField(id) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled) return false;
    const fields = (clone(current(ctx).fields || [])).filter(field => field.id !== id);
    if (selectedField === id) selectedField = null;
    return setPath(ctx, ['fields'], fields);
  }

  function moveField(id, delta) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled) return false;
    const fields = clone(current(ctx).fields || []), index = fields.findIndex(field => field.id === id), next = index + delta;
    if (index < 0 || next < 0 || next >= fields.length) return false;
    [fields[index], fields[next]] = [fields[next], fields[index]];
    return setPath(ctx, ['fields'], fields);
  }

  function addOption(id) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled) return false;
    const fields = clone(current(ctx).fields || []), field = fields.find(row => row.id === id);
    if (!field || !choices.has(field.type)) return false;
    field.options = [...(field.options || []), '新选项'];
    if (field.type === 'multiple') field.max = field.options.length;
    return setPath(ctx, ['fields'], fields);
  }

  function removeOption(id, index) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled) return false;
    const fields = clone(current(ctx).fields || []), field = fields.find(row => row.id === id);
    if (!field || !choices.has(field.type) || !Array.isArray(field.options) || !Number.isInteger(index) || index < 0 || index >= field.options.length || field.options.length <= 1) return false;
    field.options.splice(index, 1);
    if (field.type === 'multiple') { field.max = Math.min(field.max ?? field.options.length, field.options.length); field.min = Math.min(field.min || 0, field.max); }
    return setPath(ctx, ['fields'], fields);
  }

  function fieldMarkup(field, index, selected, disabled) {
    const id = js(field.id), required = field.required ? '<em>*</em>' : '';
    let control = '';
    if (['single', 'multiple', 'gender'].includes(field.type)) {
      control = `<div class="sfb-preview-options">${(field.options || []).map(option => `<span>${field.type === 'multiple' ? '□' : '○'} ${escape(option)}</span>`).join('')}</div>`;
    } else if (field.type === 'dropdown') {
      control = `<div class="sfb-preview-input">${escape((field.options || [])[0] || '请选择')} <span>⌄</span></div>`;
    } else if (field.type === 'divider') control = '<hr>';
    else if (field.type === 'description') control = `<p class="sfb-preview-description">${escape(field.title || '说明文字')}</p>`;
    else control = `<div class="sfb-preview-input">${escape(field.type === 'textarea' ? '请输入内容' : field.type === 'date' ? '请选择日期' : field.type === 'time' ? '请选择时间' : `请输入${field.title || '内容'}`)}</div>`;
    const label = field.type === 'description' ? '' : `<span class="sfb-preview-label">${escape(field.title || '未命名字段')}${required}</span>`;
    return `<button type="button" class="sfb-preview-field${selected ? ' is-selected' : ''}${field.type === 'description' ? ' is-description' : ''}" data-field="${escape(field.id)}" data-field-index="${index}" onclick="SiyueBusinessFormBuilder.select(${id})" ${disabled ? 'disabled' : ''}>${label}${control}${field.description && field.type !== 'description' ? `<small>${escape(field.description)}</small>` : ''}</button>`;
  }

  function businessPath(operation, path) {
    return [...modelPath(operation), ...path];
  }

  function input(label, value, operation, path, disabled, inputType = 'text', valueType = 'string', attrs = '') {
    const p = escape(JSON.stringify(businessPath(operation, path)));
    const live = `data-business-path="${p}" data-business-type="${valueType}" oninput="businessAPI.input(${p},this.value,'${valueType}'); SiyueBusinessFormBuilder.syncPreview(${p},this.value)" onchange="businessAPI.change(${p},this.value,'${valueType}')"`;
    return `<label class="sfb-control"><span>${escape(label)}</span><input type="${inputType}" value="${escape(value)}" ${live} ${disabled ? 'disabled' : ''} ${attrs}></label>`;
  }

  function editorField(field, disabled, operation, model) {
    const id = js(field.id), index = model.fields.findIndex(row => row.id === field.id), fieldPath = ['fields', index];
    const options = choices.has(field.type) ? `<div class="sfb-options"><strong>选项</strong>${(field.options || []).map((option, optionIndex) => `<div class="sfb-option">${input(`选项 ${optionIndex + 1}`, option, operation, [...fieldPath, 'options', optionIndex], disabled)}<button type="button" onclick="SiyueBusinessFormBuilder.removeOption(${id},${optionIndex})" ${disabled ? 'disabled' : ''}>删除</button></div>`).join('')}<button type="button" class="sfb-link" onclick="SiyueBusinessFormBuilder.addOption(${id})" ${disabled ? 'disabled' : ''}>＋ 添加选项</button></div>` : '';
    const bounds = field.type === 'multiple' ? `<div class="sfb-inline">${input('最少选择', field.min ?? 0, operation, [...fieldPath, 'min'], disabled, 'number', 'integer', 'min="0"')}${input('最多选择', field.max ?? field.options?.length ?? 2, operation, [...fieldPath, 'max'], disabled, 'number', 'integer', 'min="1"')}</div>` : '';
    const requiredPath = escape(JSON.stringify(businessPath(operation, [...fieldPath, 'required'])));
    return `<section class="sfb-panel sfb-properties"><div class="sfb-panel-heading"><div><small>字段设置</small><h3>${escape(fieldTitle(field.type))}</h3></div><span class="sfb-field-number">${field.type}</span></div>${input('字段标题', field.title || '', operation, [...fieldPath, 'title'], disabled)}${input('提示说明', field.description || '', operation, [...fieldPath, 'description'], disabled)}<label class="sfb-required"><input type="checkbox" data-business-path="${requiredPath}" data-business-type="boolean" ${field.required ? 'checked' : ''} onchange="businessAPI.change(${requiredPath},this.checked,'boolean')" ${disabled || decorative.has(field.type) ? 'disabled' : ''}><span>填写人必须完成此项</span></label>${bounds}${options}<div class="sfb-field-actions"><button type="button" onclick="SiyueBusinessFormBuilder.moveField(${id},-1)" ${disabled ? 'disabled' : ''}>↑ 上移</button><button type="button" onclick="SiyueBusinessFormBuilder.moveField(${id},1)" ${disabled ? 'disabled' : ''}>↓ 下移</button><button type="button" class="sfb-danger" onclick="SiyueBusinessFormBuilder.removeField(${id})" ${disabled ? 'disabled' : ''}>删除字段</button></div></section>`;
  }

  function properties(model, selected, disabled, operation) {
    if (selected) return editorField(selected, disabled, operation, model);
    const isSurvey = model.kind === 'survey';
    const settings = model.settings || {};
    const kindPath = escape(JSON.stringify(businessPath(operation, ['kind']))), campusPath = escape(JSON.stringify(businessPath(operation, ['campusId']))), collectPath = escape(JSON.stringify(businessPath(operation, ['collectLead'])));
    return `<section class="sfb-panel sfb-properties"><div class="sfb-panel-heading"><div><small>表单设置</small><h3>基本信息</h3></div></div>${input('表单标题', model.title || '', operation, ['title'], disabled)}<label class="sfb-control"><span>收集用途</span><select data-business-path="${kindPath}" data-business-type="string" onchange="SiyueBusinessFormBuilder.setKind(this.value)" ${disabled ? 'disabled' : ''}><option value="lead" ${model.kind === 'lead' ? 'selected' : ''}>线索登记</option><option value="survey" ${isSurvey ? 'selected' : ''}>家长问卷</option><option value="custom" ${model.kind === 'custom' ? 'selected' : ''}>自定义表单</option></select></label><label class="sfb-control"><span>校区</span><select data-business-path="${campusPath}" data-business-type="string" onchange="businessAPI.change(${campusPath},this.value || null,'string')" ${disabled ? 'disabled' : ''}><option value="">不限定校区</option>${(readContext()?.data?.campuses || []).map(campus => `<option value="${escape(campus.id)}" ${model.campusId === campus.id ? 'selected' : ''}>${escape(campus.name)}</option>`).join('')}</select></label>${input('线索来源', settings.source || '表单获客', operation, ['settings', 'source'], disabled)}<div class="sfb-inline">${input('收集份数上限', settings.quantity ?? 1000, operation, ['settings', 'quantity'], disabled, 'number', 'integer', 'min="1"')}${input('每人填写上限', settings.maxPerIdentity ?? 1, operation, ['settings', 'maxPerIdentity'], disabled, 'number', 'integer', 'min="1"')}</div>${!isSurvey ? `<label class="sfb-required"><input type="checkbox" data-business-path="${collectPath}" data-business-type="boolean" ${model.collectLead ? 'checked' : ''} onchange="businessAPI.change(${collectPath},this.checked,'boolean')" ${disabled ? 'disabled' : ''}><span>审核通过后登记为销售线索</span></label>` : '<p class="sfb-notice">问卷审核通过后仅发布答案，不会创建销售线索。</p>'}<p class="sfb-help">表单用途决定审核后是否进入线索池；服务端会按当前账号权限执行校验。</p></section>`;
  }

  function render(ctx) {
    if (!isBuilderOperation(ctx?.operation)) return null;
    const operation = ctx.operation, draft = ctx.draft || {}, model = current(ctx), fields = Array.isArray(model.fields) ? model.fields : [];
    const disabled = !!ctx.disabled, selected = fields.find(field => field.id === selectedField) || null;
    const palette = types.map(([type, label]) => `<button type="button" class="sfb-palette-item" onclick="SiyueBusinessFormBuilder.addField('${type}')" ${disabled ? 'disabled' : ''}><span>＋</span>${escape(label)}</button>`).join('');
    const title = model.title || (operation.id === 'form.update' ? '编辑表单' : '新建表单');
    const preview = `<div class="sfb-phone-wrap"><div class="sfb-phone"><div class="sfb-phone-top"><i></i><span>公开填写预览</span><i></i></div><div class="sfb-phone-screen"><header><small>${escape(model.kind === 'survey' ? '家长问卷' : model.kind === 'lead' ? '线索登记' : '自定义表单')}</small><h2>${escape(title)}</h2><p>请按提示填写以下内容</p></header>${fields.length ? fields.map((field, index) => fieldMarkup(field, index, selected?.id === field.id, disabled)).join('') : '<div class="sfb-empty">从左侧添加字段，实时查看填写效果</div>'}<button type="button" class="sfb-submit-preview" disabled>提交</button></div></div></div>`;
    return `<div class="sfb-builder-wrap"><section class="sfb-builder${disabled ? ' is-disabled' : ''}" aria-label="服务端表单构建器"><aside class="sfb-panel sfb-palette"><div class="sfb-panel-heading"><div><small>添加内容</small><h3>字段组件</h3></div></div><p>选择组件添加到表单，选中预览中的字段后可编辑属性。</p><div class="sfb-palette-grid">${palette}</div><div class="sfb-usage"><strong>收集用途</strong><span>${escape(model.kind === 'survey' ? '家长问卷：审批后只发布答案' : model.collectLead ? '将审核通过的提交登记为线索' : '只收集表单答案，不创建销售线索')}</span></div></aside>${preview}${properties(model, selected, disabled, operation)}</section>${rewardTrialSettings(ctx, model, disabled)}</div>`;
  }

  function setMetaPath(path, value) {
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled) return false;
    const resolved = path.length === 0 ? [] : path;
    return setPath(ctx, resolved, value);
  }

  // Keep lightweight edits in the draft through businessAPI.input and update the
  // phone sample in place; this preserves focus and leaves the preview button mounted.
  function syncPreview(path, value) {
    const doc = root.document;
    if (!doc || !Array.isArray(path)) return false;
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation)) return false;
    const offset = modelPath(ctx.operation).length;
    const localPath = path.slice(offset);
    if (localPath.length === 1 && localPath[0] === 'title') {
      const title = doc.querySelector('.sfb-phone-screen header h2');
      if (title) title.textContent = value || (ctx.operation.id === 'form.update' ? '编辑表单' : '新建表单');
      return true;
    }
    const fieldsAt = localPath.indexOf('fields');
    if (fieldsAt < 0 || !Number.isInteger(Number(localPath[fieldsAt + 1]))) return false;
    const index = Number(localPath[fieldsAt + 1]), key = localPath[fieldsAt + 2];
    const field = current(ctx).fields?.[index];
    const sample = doc.querySelector(`.sfb-preview-field[data-field-index="${index}"]`);
    if (!field || !sample) return false;
    if (key === 'title') {
      if (field.type === 'description') {
        const content = sample.querySelector('.sfb-preview-description');
        if (content) content.textContent = value || '说明文字';
      } else {
        const label = sample.querySelector('.sfb-preview-label');
        if (label) {
          label.textContent = value || '未命名字段';
          if (field.required) {
            const mark = doc.createElement('em');
            mark.textContent = '*';
            label.append(mark);
          }
        }
      }
      return true;
    }
    if (key === 'description') {
      let help = sample.querySelector('small');
      if (!help && value) { help = doc.createElement('small'); sample.append(help); }
      if (help) { help.textContent = value; help.hidden = !value; }
      return true;
    }
    if (key === 'options' && Number.isInteger(Number(localPath[fieldsAt + 3]))) {
      const optionIndex = Number(localPath[fieldsAt + 3]);
      if (field.type === 'dropdown') {
        const control = sample.querySelector('.sfb-preview-input');
        if (control?.firstChild) control.firstChild.textContent = value || '请选择';
      } else {
        const option = sample.querySelectorAll('.sfb-preview-options span')[optionIndex];
        if (option) option.textContent = `${field.type === 'multiple' ? '□' : '○'} ${value}`;
      }
      return true;
    }
    return false;
  }

  function setKind(kind) {
    if (!['lead', 'survey', 'custom'].includes(kind)) return false;
    const ctx = readContext();
    if (!ctx || !isBuilderOperation(ctx.operation) || ctx.disabled) return false;
    const model = current(ctx), fields = clone(model.fields || []);
    const updates = { kind, ...(kind === 'survey' ? { collectLead: false } : {}) };
    if (kind === 'lead') {
      const defaults = defaultFields('lead').filter(field =>
        (field.type === 'name' && !fields.some(row => row.type === 'name')) ||
        (field.type === 'phone' && !fields.some(row => row.type === 'phone'))
      );
      if (defaults.length) updates.fields = [...defaults, ...fields];
    }
    const next = { ...model, ...updates };
    const draft = clone(ctx.draft || {});
    if (isUpdate(ctx.operation)) draft.patch = next;
    else Object.assign(draft, next);
    return root.businessAPI.academicSet([], draft);
  }

  root.SiyueBusinessFormBuilder = {
    initialize, render, reset() { selectedField = null; trialCampusFilter = ''; trialCourseFilter = ''; }, syncPreview,
    setMeta, setMetaPath, setSetting, setKind, setField, setOption,
    addField, removeField, moveField, addOption, removeOption, select,
    setReward, setTrialEnabled, setTrialField, updateTrialSlot, toggleTrialSlot, removeTrialSlot, addTrialMatchFields, setTrialFilter
  };
})(typeof window === 'undefined' ? globalThis : window);
