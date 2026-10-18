/* Java academic pages: scoped server queries, reviewable writes, no messaging delivery. */
(function (root) {
  'use strict';
  const pages = [
    ['course', '课程管理', ['course.read']], ['classes', '班级管理', ['class.read']],
    ['students', '学生管理', ['student.read']], ['attendance', '考勤', ['class.read', 'attendance.read']],
    ['schedule', '课表', ['class.read']], ['teacherCourses', '我的课表', ['class.read']],
    ['teacherStudents', '我的学生', ['student.read']], ['teacherMetrics', '数据统计', ['report.read']]
  ].map(([id, title, permissions]) => ({ id, title, permissions }));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attendanceLabels = { attended: '出勤', late: '迟到', left_early: '早退', leave: '请假', absent: '旷课' };
  const chargeableAttendance = new Set(['attended', 'late', 'left_early']);
  const decimalAmount = value => typeof value === 'string' && /^\d{1,16}\.\d{2}$/.test(value);
  const moneyFromCents = value => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
  function projectedConsumption(student, status) {
    if (student.attendanceId || !chargeableAttendance.has(status) || student.consumptionState === 'legacy_without_order') return 0n;
    if (student.consumptionState !== 'paid_entitlement' || !decimalAmount(student.consumptionAmount)) {
      throw Error(`${student.name}缺少本讲有效课时权益，不能登记出勤、迟到或早退，请先核对报名。`);
    }
    return BigInt(student.consumptionAmount.replace('.', ''));
  }
  function consumptionLabel(student) {
    if (student.attendanceId) return '已登记，本次不重复扣减';
    if (student.consumptionState === 'legacy_without_order') return '历史报名未关联订单，仅登记考勤，不计金额';
    if (student.consumptionState === 'paid_entitlement' && decimalAmount(student.consumptionAmount)) {
      return `${student.consumptionAmount} 元（出勤、迟到或早退时课消）`;
    }
    return '缺少本讲有效课时权益，不能登记出勤、迟到或早退';
  }
  const businessRejections = new Set(['INVALID_INPUT', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'IDEMPOTENCY_CONFLICT', 'PREVIEW_STALE', 'ALREADY_EXISTS', 'RATE_LIMITED']);
  const explicitlyRejected = error => Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 && businessRejections.has(error.code);
  function feeCents(value) {
    if (typeof value !== 'string' || !/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/.test(value)) return null;
    const [whole,fraction=''] = value.split('.');return BigInt(whole)*100n + BigInt(fraction.padEnd(2,'0'));
  }
  function confirmedReceipt(review, receipt) {
    if (review.operation === 'class.create') {
      const input = review.input, fees = receipt?.fees;
      return typeof receipt?.id === 'string' && !!receipt.id && receipt.version === 1
        && receipt.courseId === input.courseId && receipt.campusId === input.campusId && receipt.teacherId === input.teacherId
        && Array.isArray(receipt.schedule) && receipt.schedule.length === input.schedule.length
        && receipt.schedule.every((row,i)=>row.lessonId === input.schedule[i].lessonId && new Date(row.startsAt).getTime() === new Date(input.schedule[i].startsAt).getTime())
        && fees && feeCents(fees.courseFee) !== null && feeCents(fees.courseFee) === feeCents(input.fees.courseFee)
        && feeCents(fees.materialFee) !== null && feeCents(fees.materialFee) === feeCents(input.fees.materialFee)
        && fees.courseRefundRule === input.fees.courseRefundRule && fees.refundLessonCount === input.fees.refundLessonCount && fees.materialRefundRule === input.fees.materialRefundRule;
    }
    if (review.operation.startsWith('course.update:')) return receipt?.id === review.operation.slice('course.update:'.length) && receipt.name === review.input.name && receipt.year === review.input.year && receipt.version === review.input.expectedVersion + 1 && Array.isArray(receipt.lessons) && receipt.lessons.length === review.input.lessons.length && receipt.lessons.every((lesson,i) => lesson.title === review.input.lessons[i].title && typeof lesson.id === 'string' && lesson.id);
    if (review.operation.startsWith('course.status:')) return receipt?.id === review.operation.slice('course.status:'.length) && receipt.active === review.input.active && receipt.version === review.input.expectedVersion + 1;
    if (review.operation.startsWith('session.attendance:')) {
      return Array.isArray(receipt?.items) && receipt.items.length === review.input.rows.length
        && receipt.items.every(row => typeof row.id === 'string' && row.id && review.input.rows.some(input => input.studentId === row.studentId))
        && new Set(receipt.items.map(row => row.studentId)).size === review.input.rows.length;
    }
    if (review.operation.startsWith('attendance.correction:')) {
      const input = review.input, student = review.student;
      return receipt?.id === student.attendanceId && receipt.correctionId
        && receipt.classId === input.classId && receipt.sessionId === review.sessionId && receipt.studentId === student.id
        && receipt.status === input.status && receipt.note === input.note
        && receipt.version === student.attendanceVersion + 1
        && decimalAmount(receipt.consumptionAmount);
    }
    if (review.operation === 'enrollment.batchTransfer') {
      const rows=receipt?.items,input=review.input;
      return Array.isArray(rows)&&receipt.total===input.items.length&&rows.length===input.items.length
        &&rows.every(row=>typeof row.transferId==='string'&&row.transferId&&input.items.some(item=>item.enrollmentId===row.enrollmentId)
          &&row.targetClassId===input.targetClassId&&Number.isSafeInteger(row.version)&&row.version===input.items.find(item=>item.enrollmentId===row.enrollmentId).expectedVersion+1
          &&review.transferStudents?.some(item=>item.enrollmentId===row.enrollmentId&&item.studentId===row.studentId&&item.fromClassId===row.fromClassId))
        &&new Set(rows.map(row=>row.enrollmentId)).size===input.items.length;
    }
    return receipt !== null && typeof receipt === 'object' && typeof receipt.id === 'string' && Boolean(receipt.id);
  }
  const channelLabels = { phone: '电话', wecom: '企业微信', text: '文字沟通' };
  const dateAt = instant => new Date(instant).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const today = () => new Date(Date.now() + 28800000).toISOString().slice(0, 10);
  const localParts = instant => new Date(new Date(instant).getTime() + 28800000).toISOString().slice(0, 16).split('T');
  function attendanceCorrectionDeadline(student) {
    if (!student?.attendanceAt || !Number.isFinite(Date.parse(student.attendanceAt))) return null;
    try {
      const [date] = localParts(student.attendanceAt);
      const deadline = new Date(instant(`${date}T00:00`)); deadline.setUTCDate(deadline.getUTCDate() + 1);
      return Number.isFinite(deadline.getTime()) ? deadline.getTime() : null;
    } catch { return null; }
  }
  function attendanceCorrectionOpen(student, now = Date.now()) {
    const deadline = attendanceCorrectionDeadline(student);
    return deadline !== null && Number.isSafeInteger(student.attendanceVersion) && now < deadline;
  }
  const instant = value => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) throw Error('请填写完整日期和时间。');
    const parsed = new Date(`${value}:00+08:00`);
    if (!Number.isFinite(parsed.getTime()) || localParts(parsed.toISOString()).join('T') !== value) throw Error('日期或时间无效。');
    return parsed.toISOString();
  };
  function csvCell(value) {
    const text=String(value ?? '');
    return '"'+(/^[\s=+\-@]/.test(text) ? "'"+text : text).replace(/"/g,'""')+'"';
  }
  function downloadCsv(filename,content) {
    const url=root.URL.createObjectURL(new root.Blob([content],{type:'text/csv;charset=utf-8'}));
    const anchor=root.document.createElement('a');anchor.href=url;anchor.download=filename;
    root.document.body.appendChild(anchor);
    try { anchor.click(); } finally { anchor.remove();root.setTimeout(()=>root.URL.revokeObjectURL(url),1000); }
  }
  function create({ api, identity, render, download=downloadCsv }) {
    const academic = api.academic || api;
    const allowed = permission => (identity.permissions || []).includes(permission);
    const courseWritable = row => allowed('course.write') && (identity.scope === 'all' || row.campusId && (identity.campusIds || []).includes(row.campusId));
    const state = { page: '', loading: false, error: '', notice: '', data: null, options: null, optionsError: '', optionCampusId: '',
      campusOptions: (identity.campusIds || []).map(id => ({ id, name: id })),
      number: 1, query: {}, mode: 'time', edit: null, review: null, picker: null, roster: null,
      resourceSchedule:null,classExport:null,classDetail:null, student: null, communication: null, classes: null, classPage: 1, lookup: null, lookupPage: 1, studentExport:null, selectedStudents:new Map(), transferDraft:null, closed: false };
    let epoch = 0, optionsEpoch = 0, lessonReturnFocus = '';
    const bound = new WeakSet();
    const keys = new Map();
    const scope = () => state.page.startsWith('teacher') ? 'mine' : 'scope';
    const paint = () => { if (!state.closed) render(); };
    const fail = error => error?.message || '操作未完成，请重试。';
    const named = (kind, id) => (kind === 'campuses' ? state.campusOptions : state.options?.[kind])?.find(item => item.id === id)?.name || id || '—';
    const items = value => Array.isArray(value?.items) ? value.items : [];
    const value = (obj, key, fallback = '') => obj?.[key] ?? fallback;
    const button = (label, action, extra = '', disabled = false, primary = false) => `<button type="button" class="btn${primary ? ' primary' : ''}" data-ja-action="${action}" ${extra} ${disabled ? 'disabled' : ''}>${esc(label)}</button>`;
    const input = (label, name, val, type = 'text', attrs = '') => `<label>${esc(label)}<input class="input" name="${name}" type="${type}" value="${esc(val)}" ${attrs}></label>`;
    const select = (label, name, val, options, attrs = '') => `<label>${esc(label)}<select class="select" name="${name}" ${attrs}>${options.map(item => `<option value="${esc(item.value)}" ${String(val ?? '') === String(item.value) ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>`;
    const optionRows = (kind, blank = '') => [...(blank ? [{ value: '', label: blank }] : []), ...(kind === 'campuses' ? state.campusOptions : state.options?.[kind] || []).map(item => ({ value: item.id, label: item.name || item.id }))];
    const heading = title => `<div class="heading"><h1>${esc(title)}</h1>${button('刷新', 'refresh', '', state.loading || state.review?.busy || state.review?.uncertain)}</div>`;
    const table = (headers, rows, empty = '当前范围暂无记录') => `<div class="table-wrap"><table class="table"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}">${esc(empty)}</td></tr>`}</tbody></table></div>`;
    const td = vals => `<tr>${vals.map(v => `<td>${v}</td>`).join('')}</tr>`;
    const pager = (data, action = 'page', suffix = '条') => data ? `<div class="ja-pager"><span>共 ${Number(data.total) || 0} ${suffix} · 第 ${Number(data.page) || 1} / ${Math.max(1, Math.ceil((Number(data.total) || 0) / (Number(data.size) || 20)))} 页</span><div>${button('上一页', action, `data-page="${Math.max(1, Number(data.page) - 1)}"`, Number(data.page) <= 1)}${button('下一页', action, `data-page="${Number(data.page) + 1}"`, Number(data.page) * Number(data.size) >= Number(data.total))}</div></div>` : '';
    const formActions = () => `<div class="actions">${button('取消', 'cancel-edit')}<button class="btn primary" type="submit">核对后提交</button></div>`;
    const mayAssignTeacher = updating => allowed('class.assign') || !updating && identity.scope === 'all';
    const teacherOptions = currentId => mayAssignTeacher(Boolean(currentId)) ? optionRows('teachers', '请选择授课老师')
      : [...(currentId && currentId !== identity.principalId ? [{ value: currentId, label: named('teachers', currentId) }] : []),
        { value: identity.principalId, label: identity.displayName || named('teachers', identity.principalId) }];
    function clearPanels() { state.resourceSchedule=null; state.classExport=null; state.classDetail=null; state.edit = null; state.review = null; state.picker = null; state.roster = null; state.student = null; state.communication = null; state.classes = null; }
    async function loadOptions(campusId = state.optionCampusId) {
      const request = ++optionsEpoch;
      state.optionCampusId = campusId || ''; state.options = null;
      try {
        const result = await academic.options(campusId ? { campusId } : {});
        if (request !== optionsEpoch || state.closed) return false;
        state.options = result; state.optionsError = '';
        state.campusOptions = Array.from(new Map([...state.campusOptions, ...(result.campuses || [])].map(row => [row.id, row])).values());
        return true;
      } catch (error) {
        if (request === optionsEpoch && !state.closed) { state.options = null; state.optionsError = fail(error); }
        return false;
      }
    }
    function optionsRecovery() {
      if (state.page === 'teacherMetrics' || !state.optionsError && (!state.optionCampusId || state.edit?.type === 'class')) return '';
      return `${state.optionsError ? `<p class="notice" role="alert">校区和员工选项读取失败：${esc(state.optionsError)}</p>` : `<p class="help">教师和教室选项已缩小到校区：${esc(named('campuses', state.optionCampusId))}</p>`}<form data-ja-form="option-campus" class="filters">${input('按校区载入选项（可选择或填写校区编号）', 'campusId', state.optionCampusId, 'text', 'required maxlength="120" list="ja-option-campuses"')}<datalist id="ja-option-campuses">${state.campusOptions.map(campus => `<option value="${esc(campus.id)}">${esc(campus.name)}</option>`).join('')}</datalist><button class="btn primary">读取该校区选项</button>${button(state.edit?.type === 'class' ? '重试当前校区选项' : '重新读取全部选项', 'retry-options')}</form>`;
    }
    function canLeave() {
      if (state.closed) return true;
      let message = '';
      if (state.review?.busy) message = '教务提交正在处理中，请等待原请求完成后再切换。';
      else if (state.review?.uncertain) message = '教务提交结果尚未确认，请使用原提交重试并确认结果后再切换。';
      else if (state.transferDraft?.loading) message = '批量转班范围正在核对，请等待完成后再切换。';
      else {
        const element = root.document.getElementById('java-academic-workspace');
        for (const form of element?.querySelectorAll?.('[data-ja-form]') || []) {
          if (['course', 'class', 'class-update', 'move', 'communication', 'attendance'].includes(form.dataset.jaForm)) capture(form);
        }
        const communication = state.communication?.draft;
        const communicationChanged = communication && (communication.content !== '' || communication.nextFollowAt !== '' || communication.channel !== 'phone');
        const attendanceChanged = state.roster?.data?.students.some(student => {
          const row = state.roster.draft[student.id];
          return !student.attendanceId && row && (!row.selected || row.status !== '' || row.note !== '');
        });
        const correction = state.roster?.correction?.draft;
        const correctionChanged = correction && (correction.status !== state.roster.correction.student.attendanceStatus
          || correction.note !== (state.roster.correction.student.attendanceNote || '') || correction.reason !== '');
        if (state.review) message = '教务内容仍在提交前核对中，请先提交，或返回修改并取消当前办理后再切换。';
        else if(state.transferDraft)message='批量转班内容尚未处理，请返回学生名单后再切换。';
        else if (state.edit) message = '教务表单尚未保存，请先完成保存，或点击表单中的取消后再切换。';
        else if (communicationChanged) message = '沟通内容尚未保存，请先完成保存，或点击返回名单放弃本次填写后再切换。';
        else if (attendanceChanged) message = '考勤内容尚未保存，请先完成保存，或点击返回课表放弃本次填写后再切换。';
        else if (correctionChanged) message = '考勤更正内容尚未保存，请先完成保存，或取消更正后再切换。';
      }
      if (!message) return true;
      state.error = message;
      paint();
      return false;
    }
    async function open(page) {
      if (state.closed) return;
      const entry = pages.find(item => item.id === page);
      if (!entry || entry.permissions.some(permission => !allowed(permission))) throw Error('当前账号没有访问此模块的权限。');
      if (!canLeave()) return false;
      ++epoch; state.page = page; state.query = {}; state.number = 1; state.notice = ''; state.error = ''; state.mode = 'time'; clearPanels();
      state.selectedStudents.clear();state.transferDraft=null;state.studentExport=null;
      if (['schedule', 'teacherCourses', 'attendance'].includes(page)) state.query = { dateFrom: today(), dateUntil: today() };
      if (page === 'classes') state.query = {onlyOpen:'on',format:''};
      if(page==='attendance')state.query={...state.query,courseType:'onsite',format:'group',attendanceView:'classes'};
      if (page === 'course') state.query = { format: 'face', courseType: 'onsite' };
      if (page === 'teacherMetrics') state.query = { month: today().slice(0, 7) };
      return load();
    }
    function classReadQuery() {
      const query={view:scope()};
      for(const key of ['campusId','teacherId','room',...(['classes','attendance'].includes(state.page) ? ['search','courseType','format','year','term','subject','grade','classType','courseKind'] : [])])if(state.query[key])query[key]=state.query[key];
      if(state.page==='classes' && (state.query.phase || state.query.onlyOpen))query.phase=state.query.phase || 'open';
      if(state.query.dateFrom && state.query.dateUntil) {
        query.fromAt=instant(`${state.query.dateFrom}T00:00`);
        const end=new Date(instant(`${state.query.dateUntil}T00:00`));end.setUTCDate(end.getUTCDate()+1);query.untilAt=end.toISOString();
        if(query.fromAt>=query.untilAt)throw Error('结束日期不得早于开始日期。');
      }
      return query;
    }
    async function load() {
      const request = ++epoch; state.loading = true; state.error = ''; state.data = null; paint();
      try {
        if (!state.options && state.page !== 'teacherMetrics') await loadOptions(state.query.campusId || state.optionCampusId);
        if (request !== epoch || state.closed) return;
        const base = { page: state.number, size: 20 };
        let result;
        if (state.page === 'course') result = await academic.courses.list({ ...base, ...Object.fromEntries(['campusId','search','format','year','term','grade','subject','classType','courseKind','courseType','status'].filter(key => state.query[key]).map(key => [key, state.query[key]])) });
        else if (['students', 'teacherStudents'].includes(state.page)) result = await academic.students.list({ ...base, view: scope(), ...(state.query.classId ? { classId: state.query.classId } : {}) });
        else if (state.page === 'teacherMetrics') result = await academic.teachingMetrics({ month: state.query.month, view: 'mine' });
        else if(state.page==='attendance' && state.query.attendanceView==='students') {
          const fromAt=instant(`${state.query.dateFrom}T00:00`),end=new Date(instant(`${state.query.dateUntil}T00:00`));end.setUTCDate(end.getUTCDate()+1);const untilAt=end.toISOString();
          if(fromAt>=untilAt||Date.parse(untilAt)-Date.parse(fromAt)>31*86400000)throw Error('请选择最多31天的有效日期范围。');
          result=await academic.attendance.students({...base,...Object.fromEntries(['campusId','teacherId','attendanceStatus','search','courseType'].filter(key=>state.query[key]).map(key=>[key,state.query[key]])),fromAt,untilAt});
        }
        else {
          const query = { ...base,...classReadQuery() };
          result = await academic.classes.list(query);
        }
        if (request === epoch && !state.closed) {
          if(state.page==='attendance'&&state.query.attendanceView==='students')validateAllStudentAttendanceReceipt(result,state.number,state.query);
          state.data = result;
          const discovered = items(result).filter(row => row.campusId).map(row => ({ id: row.campusId, name: named('campuses', row.campusId) }));
          state.campusOptions = Array.from(new Map([...state.campusOptions, ...discovered].map(row => [row.id, row])).values());
        }
      } catch (error) { if (request === epoch) state.error = fail(error); }
      finally { if (request === epoch && !state.closed) { state.loading = false; paint(); } }
    }
    function validateAllStudentAttendanceReceipt(data,page,query) {
      if(!Array.isArray(data?.items)||!Number.isSafeInteger(data.total)||data.total<0||data.page!==page||data.size!==20||data.items.length>20)
        throw Error('全部学生考勤分页回执不一致。');
      const ids=new Set(),from=Date.parse(instant(`${query.dateFrom}T00:00`)),endDate=new Date(instant(`${query.dateUntil}T00:00`));endDate.setUTCDate(endDate.getUTCDate()+1);const until=Date.parse(endDate.toISOString());
      for(const row of data.items) {
        const identity=[row.classId,row.sessionId,row.studentId].join(':');
        if(!row.classId||!row.sessionId||!row.studentId||!row.campusId||!row.studentName||!Number.isFinite(Date.parse(row.startsAt))
          ||!['recorded','unrecorded'].includes(row.attendanceStatus)
          ||Date.parse(row.startsAt)<from||Date.parse(row.startsAt)>=until
          ||(row.attendanceStatus==='recorded'?!Object.hasOwn(attendanceLabels,row.attendanceOutcome):row.attendanceOutcome!=null)
          ||ids.has(identity)||(query.campusId&&row.campusId!==query.campusId)
          ||(query.teacherId&&row.teacherId!==query.teacherId)
          ||(query.attendanceStatus&&row.attendanceStatus!==query.attendanceStatus))throw Error('全部学生考勤回执与筛选范围不一致。');
        ids.add(identity);
      }
      if(data.items.length>data.total||(page-1)*20>=data.total&&data.items.length)throw Error('全部学生考勤分页总数不一致。');
    }
    function courseTabs() { return `<div class="ja-tabs" role="tablist" aria-label="课程分类">${Object.entries(courseFormatLabels(state.query.courseType)).map(([format,label]) => button(label, 'course-format', `data-format="${format}" role="tab" aria-selected="${state.query.format === format}"`, state.loading)).join('')}</div>`; }
    function classTabs() {
      return `<div class="ja-tabs" role="tablist" aria-label="班级分类">${[['','全部'],['group','班课'],['one_to_one','1 对 1'],['one_to_many','1 对 N']].map(([format,label])=>button(label,'class-format',`data-format="${format}" role="tab" aria-selected="${(state.query.format || '')===format}"`,state.loading)).join('')}</div>`;
    }
    function filters() {
      if (state.page === 'teacherMetrics') return `<form data-ja-form="filters" class="filters">${input('统计月份', 'month', state.query.month, 'month', 'required')}<button class="btn primary">查询</button></form>`;
      if (['students', 'teacherStudents'].includes(state.page)) return `<div class="ja-tabs">${button('全部在读学生', 'student-all', '', state.loading)}${button('按班筛选', 'class-picker', '', state.loading || !allowed('class.read'))}${state.query.classId ? `<span>当前班级：${esc(state.query.className || state.query.classId)}</span>` : ''}</div>`;
      let fields = select('校区', 'campusId', state.query.campusId, optionRows('campuses', '全部校区'));
      if (state.page === 'course') fields += select('状态', 'status', state.query.status || 'active', [{value:'active',label:'启用'},{value:'inactive',label:'已停用'},{value:'all',label:'全部'}]) + select('课程性质', 'courseType', state.query.courseType, [{value:'',label:'全部'},{value:'onsite',label:'面授课'},{value:'live',label:'线上课'}]) + input('课程名称', 'search', state.query.search, 'search', 'maxlength="100"') + input('年份', 'year', state.query.year, 'number', 'min="2000" max="2100"') + input('学期', 'term', state.query.term, 'text', 'maxlength="40"') + input('学科', 'subject', state.query.subject, 'text', 'maxlength="40"') + input('年级', 'grade', state.query.grade, 'text', 'maxlength="40"') + input('班型', 'classType', state.query.classType, 'text', 'maxlength="40"') + select('课程类型', 'courseKind', state.query.courseKind, [{value:'',label:'全部'},...Object.entries(courseKinds).map(([value,label])=>({value,label}))]);
      if(state.page==='classes') fields+=input('搜索班级ID、班级名称、课程名称','search',state.query.search,'search','maxlength="100"')+select('授课方式','courseType',state.query.courseType,[{value:'',label:'全部'},{value:'onsite',label:'面授'},{value:'live',label:'线上'}])+input('年份','year',state.query.year,'number','min="2000" max="2100"')+input('学科','subject',state.query.subject,'text','maxlength="40"')+input('年级','grade',state.query.grade,'text','maxlength="40"')+input('学期','term',state.query.term,'text','maxlength="40"')+input('班型','classType',state.query.classType,'text','maxlength="40"')+select('课程类型','courseKind',state.query.courseKind,[{value:'',label:'全部'},...Object.entries(courseKinds).map(([value,label])=>({value,label}))])+select('班级状态','phase',state.query.phase,[{value:'',label:'全部'},{value:'upcoming',label:'未开课'},{value:'current',label:'开课中'},{value:'finished',label:'已结课'}])+`<label><input type="checkbox" name="onlyOpen" ${state.query.onlyOpen ? 'checked' : ''}>仅未开课、开课中</label>`;
      if(state.page==='attendance' && state.query.attendanceView==='students') fields+=select('授课方式','courseType',state.query.courseType,[{value:'onsite',label:'面授（线上课不参与授课考勤）'}])+select('考勤状态','attendanceStatus',state.query.attendanceStatus,[{value:'',label:'全部'},{value:'recorded',label:'已考勤'},{value:'unrecorded',label:'未考勤'}])+input('学生姓名 / 电话 / ID','search',state.query.search,'search','maxlength="100"')+input('开始日期','dateFrom',state.query.dateFrom,'date','required')+input('结束日期','dateUntil',state.query.dateUntil,'date','required');
      else if(state.page==='attendance')fields+=input('年级','grade',state.query.grade,'text','maxlength="40"')+input('学科','subject',state.query.subject,'text','maxlength="40"')+input('学期','term',state.query.term,'text','maxlength="40"')+input('班型','classType',state.query.classType,'text','maxlength="40"');
      if (state.page !== 'course') fields += select('授课老师', 'teacherId', state.query.teacherId, state.page === 'teacherCourses' ? [{ value: '', label: '本人授课' }] : optionRows('teachers', '全部老师')) + (state.page==='attendance'&&state.query.attendanceView==='students' ? '' : input('教室', 'room', state.query.room, 'text', 'list="ja-rooms"'));
      if (['schedule', 'teacherCourses'].includes(state.page)||state.page==='attendance'&&state.query.attendanceView!=='students') fields += input('开始日期', 'dateFrom', state.query.dateFrom, 'date', 'required') + input('结束日期', 'dateUntil', state.query.dateUntil, 'date', 'required');
      return `${state.page === 'course' ? courseTabs() : state.page==='classes' ? classTabs() : state.page==='attendance' ? attendanceTabs() : ''}<form data-ja-form="filters" class="filters">${fields}<button class="btn primary">查询</button></form>`;
    }
    function directory() {
      if (!state.data) return state.loading ? '<p class="ja-loading" role="status">正在读取服务端数据…</p>' : '';
      const rows = items(state.data);
      if (state.page === 'course') return `<div class="actions">${button('查看全部课程', 'course-all', '', state.loading)}${allowed('course.write') ? button('创建面授课程', 'create-course', 'data-type="onsite"', !state.options, true) + button('创建线上课程', 'create-course', 'data-type="live"', !state.options) : ''}</div>` + table(['课程名', '课程类型', '学科', '年级', '学期', '班型', '课程性质', '价格', '讲次', '状态', '操作'], rows.map(row => td([esc(row.name), esc(courseKinds[row.metadata?.courseKind] || '—'), esc(row.subject), esc(row.grade), esc(row.metadata?.term || '—'), esc(row.metadata?.classType || '—'), row.courseType === 'live' ? '线上课' : '面授课', esc(row.price), `<details><summary>${row.lessons.length} 讲</summary><ol>${row.lessons.map(lesson => `<li>${esc(lesson.title)}</li>`).join('')}</ol></details>`, row.active === false ? '已停用' : '启用', `${allowed('class.write') && row.active !== false ? button('创建班级', 'course-class', `data-id="${esc(row.id)}"`, !state.options) : ''}${courseWritable(row) ? button('编辑', 'edit-course', `data-id="${esc(row.id)}"`, !row.version) : ''}${courseWritable(row) ? button(row.active === false ? '启用' : '停用', 'course-status', `data-id="${esc(row.id)}"`, typeof row.active !== 'boolean' || !row.version) : ''}`]))) + pager(state.data);
      if (state.page === 'classes') return classDirectory(rows);
      if(state.page==='attendance')return state.query.attendanceView==='students' ? allStudentAttendanceDirectory(rows) : attendanceDirectory(rows);
      if (['students', 'teacherStudents'].includes(state.page)) {
        const teacher=state.page==='teacherStudents';
        const canTransfer=!teacher&&allowed('student.read')&&allowed('enrollment.manage');
        const actions=`<div class="actions">${button(state.studentExport?.busy?'正在导出…':'导出','export-students','',state.studentExport?.busy||state.loading)}${canTransfer?button('批量转班','start-batch-transfer','',state.selectedStudents.size===0||!state.query.classId||state.loading):''}<span class="help">${state.query.classId?`当前班级已选 ${state.selectedStudents.size} 名学生`:'批量转班请先按班筛选'}</span></div>${state.studentExport?.error?`<p class="notice" role="alert">${esc(state.studentExport.error)}</p>`:''}${state.studentExport?.notice?`<p role="status">${esc(state.studentExport.notice)}</p>`:''}`;
        const headers=[...(canTransfer?['选择']:[]),'学生','年级','联系电话','沟通'];
        const body=rows.map(row=>td([...(canTransfer?[`<input type="checkbox" aria-label="选择${esc(row.name)}" data-ja-action="select-student" data-id="${esc(row.id)}" ${state.selectedStudents.has(row.id)?'checked':''}>`]:[]),esc(row.name),esc(row.grade),esc(row.phone),allowed('student.communication.read')||allowed('student.communicate')?button('沟通记录','student-detail',`data-id="${esc(row.id)}"`):'—']));
        return actions+table(headers,body)+pager(state.data,'page','名在读学生');
      }
      if (state.page === 'teacherMetrics') {
        const metric = state.data;
        const current = [['当前授课班级', metric.classCount], ['当前在读学生人数', metric.studentCount], ['当前满班数', metric.fullClassCount], ['当前满班率', `${metric.fullClassRate}%`], ['当前座位使用率', `${metric.seatOccupancyRate}%`]];
        const monthly = [['该月课消记录', metric.consumptionCount], ['该月课消金额', `${metric.consumptionAmount} 元`]];
        const cards = values => `<div class="ja-metrics">${values.map(([label, amount]) => `<section class="card pad"><span>${esc(label)}</span><strong>${esc(amount)}</strong></section>`).join('')}</div>`;
        return `<p>范围：本人授课</p><h2>当前在读概况</h2><p class="help">按当前有效班级和在读关系统计，不随月份切换；学生人数去重，座位使用率按各班占用座位计算。</p>${cards(current)}<h2>所选月份考勤课消</h2><p>统计月份：${esc(metric.month)} · 按北京时间课次开始日期归入月份。</p>${cards(monthly)}` + table(['考勤状态', '人次'], Object.entries(attendanceLabels).map(([key, label]) => td([label, esc(metric.attendance?.[key] ?? 0)])));
      }
      const sessions = rows.flatMap(cls => (cls.schedule || []).map(session => ({ cls, session })));
      if (state.mode === 'time') {
        sessions.sort((a, b) => a.session.startsAt.localeCompare(b.session.startsAt));
        return `<div class="ja-tabs">${(state.page==='teacherCourses' ? [['time','时间']] : [['time', '时间'], ['teacher', '教师'], ['room', '教室']]).map(([mode, label]) => button(label, 'schedule-mode', `data-mode="${mode}" aria-pressed="${state.mode === mode}"`)).join('')}</div><p class="help">按匹配班级分页；时间轴展示本页班级在所选日期内的课次，时间均为北京时间。横向可浏览全天时段。</p>${scheduleTimeline(sessions)}` + pager(state.data, 'page', '个班级');
      }
      sessions.sort((a, b) => String(state.mode === 'teacher' ? a.session.teacherId : state.mode === 'room' ? a.cls.room : a.session.startsAt).localeCompare(String(state.mode === 'teacher' ? b.session.teacherId : state.mode === 'room' ? b.cls.room : b.session.startsAt)) || a.session.startsAt.localeCompare(b.session.startsAt));
      let previousGroup;
      const scheduleRows = sessions.flatMap(({ cls, session }) => {
        const group = state.mode === 'teacher' ? named('teachers', session.teacherId || cls.teacherId)
          : state.mode === 'room' ? `${named('campuses', cls.campusId)} / ${cls.room}` : localParts(session.startsAt)[0];
        const header = group !== previousGroup ? [`<tr class="ja-schedule-group"><th colspan="5">${esc(group)}</th></tr>`] : [];
        previousGroup = group;
        return [...header, td([esc(`${dateAt(session.startsAt)} — ${dateAt(session.endsAt)}`), esc(cls.name), esc(`${named('campuses', cls.campusId)} / ${cls.room}`), esc(named('teachers', session.teacherId || cls.teacherId)), `${allowed('attendance.read') ? button('点名册', 'roster', `data-id="${esc(session.id)}" data-class="${esc(cls.id)}"`) : ''}${allowed('session.move') ? button('调整时间', 'move-session', `data-id="${esc(session.id)}" data-class="${esc(cls.id)}"`, new Date(session.startsAt).getTime() <= Date.now() || !session.version) : ''}`])];
      });
      return `<div class="ja-tabs">${(state.page==='teacherCourses' ? [['time','时间']] : [['time', '时间'], ['teacher', '教师'], ['room', '教室']]).map(([mode, label]) => button(label, 'schedule-mode', `data-mode="${mode}" aria-pressed="${state.mode === mode}"`)).join('')}</div><p class="help">按匹配班级分页；以下为本页班级在所选期间的课次，时间均为北京时间。</p>` + table(['时间', '班级', '校区 / 教室', '老师', '办理'], scheduleRows) + pager(state.data, 'page', '个班级');
    }
    function scheduleTimeline(sessions) {
      const days = new Map();
      for (const row of sessions) {
        const [date, startTime] = localParts(row.session.startsAt);
        const [, endTime] = localParts(row.session.endsAt);
        const minute = time => { const [hour, value] = time.split(':').map(Number); return hour * 60 + value; };
        const start = Math.max(0, Math.min(1439, minute(startTime)));
        const end = Math.max(start + 1, Math.min(1440, localParts(row.session.endsAt)[0] === date ? minute(endTime) : 1440));
        if (!days.has(date)) days.set(date, []);
        days.get(date).push({ ...row, date, start, end, startTime, endTime });
      }
      const hours = `<div class="ja-time-scale"><strong>日期</strong>${Array.from({length:24},(_,hour)=>`<span style="grid-column:${2+hour*4}/span 4">${String(hour).padStart(2,'0')}:00</span>`).join('')}</div>`;
      const content = [...days.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date, entries]) => {
        entries.sort((a,b)=>a.start-b.start||a.end-b.end||a.cls.name.localeCompare(b.cls.name));
        const laneEnds = [];
        for (const entry of entries) {
          let lane = laneEnds.findIndex(end => end <= entry.start);
          if (lane < 0) lane = laneEnds.length;
          laneEnds[lane] = entry.end;
          entry.lane = lane;
        }
        const events = entries.map(({cls,session,start,end,startTime,endTime,lane}) => {
          const startSlot = Math.floor(start / 15), endSlot = Math.max(startSlot + 1, Math.ceil(end / 15));
          const actions = `${allowed('attendance.read') ? button('点名册', 'roster', `data-id="${esc(session.id)}" data-class="${esc(cls.id)}"`) : ''}${allowed('session.move') ? button('调整时间', 'move-session', `data-id="${esc(session.id)}" data-class="${esc(cls.id)}"`, new Date(session.startsAt).getTime() <= Date.now() || !session.version) : ''}`;
          return `<article class="ja-time-event" style="grid-column:${2+startSlot}/${2+endSlot};grid-row:${lane+1}" title="${esc(`${cls.name} ${startTime}–${endTime}`)}"><strong>${esc(cls.name)}</strong><span>${esc(`${startTime}–${endTime}`)} · ${esc(named('teachers', session.teacherId || cls.teacherId))}</span><span>${esc(`${named('campuses',cls.campusId)} / ${cls.room}`)}</span><div>${actions}</div></article>`;
        }).join('');
        return `<section class="ja-time-day" style="--ja-time-lanes:${Math.max(1,laneEnds.length)}"><h3>${esc(date)}</h3>${events || '<p>当日没有排课</p>'}</section>`;
      }).join('');
      return `<div class="ja-time-wrap" role="region" aria-label="课表时间视图" tabindex="0">${hours}${content || '<p class="help">所选日期内暂无课次。</p>'}</div>`;
    }
    function attendanceTabs() {
      const views=[['classes','group','面授班课'],['classes','one_to_one','面授1对1'],['classes','one_to_many','面授1对N'],['students','','全部学生']];
      return `<div class="ja-tabs" role="tablist" aria-label="考勤视图">${views.map(([view,format,label])=>button(label,'attendance-view',`data-view="${view}" data-format="${format}" aria-selected="${(state.query.attendanceView||'classes')===view && (view==='students'||(state.query.format||'')===format)}"`,state.loading)).join('')}</div>`;
    }
    const attendanceColumns=['校区','课程名称','班级名称','学科','学期','年级','授课老师','班型','开课日期','开课时间','学生人数','未考勤'];
    function attendanceCells(cls,session) {
      const count=value=>Number.isSafeInteger(value) && value>=0 ? value : '—';
      const c=cls.catalog,m=c?.metadata,[date,start]=localParts(session.startsAt),[,end]=localParts(session.endsAt);
      return [named('campuses',cls.campusId),c?.courseName || '—',cls.name,c?.subject || '—',m?.term || '—',c?.grade || '—',named('teachers',session.teacherId || cls.teacherId),m?.classType || '—',date,`${start} — ${end}`,count(session.attendance?.studentCount),count(session.attendance?.unrecordedCount)];
    }
    function attendanceDirectory(rows) {
      const sessions=rows.flatMap(cls=>cls.schedule.map(session=>({cls,session}))).sort((a,b)=>a.session.startsAt.localeCompare(b.session.startsAt));
      const body=sessions.map(({cls,session})=>td([...attendanceCells(cls,session).map(esc),button('考勤','roster',`data-id="${esc(session.id)}" data-class="${esc(cls.id)}"`)]));
      return `<div class="actions">${button(state.classExport?.busy ? '正在导出…' : '导出','export-attendance','',state.classExport?.busy || state.loading)}</div>${state.classExport?.error ? `<p class="notice" role="alert">${esc(state.classExport.error)}</p>` : ''}${state.classExport?.notice ? `<p role="status">${esc(state.classExport.notice)}</p>` : ''}<p class="notice ja-attendance-lock" role="note">每日24点锁定当天已考勤学生的考勤情况，请谨慎操作。</p><p class="help">按匹配班级分页，以下为本页所选日期内的课次。未考勤人数来自当前有效名单。</p>`+table([...attendanceColumns,'操作'],body)+pager(state.data,'page','个班级');
    }
    const attendanceStateLabels={recorded:'已考勤',unrecorded:'未考勤'};
    function allStudentAttendanceDirectory(rows) {
      const valid=Array.isArray(rows)&&rows.every(row=>typeof row.classId==='string'&&typeof row.sessionId==='string'
        &&typeof row.studentId==='string'&&typeof row.studentName==='string'&&['recorded','unrecorded'].includes(row.attendanceStatus)
        &&(row.attendanceStatus==='unrecorded' ? row.attendanceOutcome==null : Object.hasOwn(attendanceLabels,row.attendanceOutcome)));
      if(!valid)return '<p class="notice" role="alert">全部学生考勤回执不一致，未显示记录。</p>';
      const body=rows.map(row=>td([esc(row.campusName), '面授',esc(row.courseName),esc(row.className),esc(dateAt(row.startsAt)),
        esc(named('teachers',row.teacherId)),'—',esc(row.studentName),esc(row.phone||'—'),attendanceStateLabels[row.attendanceStatus],
        row.attendanceOutcome ? attendanceLabels[row.attendanceOutcome] : '—',
        button('逐讲点名','roster',`data-id="${esc(row.sessionId)}" data-class="${esc(row.classId)}"`,row.attendanceStatus==='recorded'||!allowed('attendance.manage'))]));
      return `<div class="actions">${button(state.classExport?.busy?'正在导出…':'导出','export-attendance-students','',state.classExport?.busy||state.loading)}</div>${state.classExport?.error?`<p class="notice" role="alert">${esc(state.classExport.error)}</p>`:''}${state.classExport?.notice?`<p role="status">${esc(state.classExport.notice)}</p>`:''}<p class="help">每行对应授权范围内的一名在读学生与一节真实排期课次；已考勤表示存在考勤记录，出勤情况保留实际点名状态。线上课程只管理课程性质，不进入授课考勤。</p>${table(['校区','授课方式','课程名称','班级名称','开课时间','授课老师','辅导老师','学生姓名','手机号','考勤状态','出勤情况','操作'],body)}${pager(state.data,'page','条学生课次记录')}`;
    }
    const courseKinds = { long_term: '长期班', short_term: '短期班', trial: '体验课' };
    const courseFormats = { face: '面授', intention: '意向', one_to_one: '1 对 1', one_to_many: '1 对 N' };
    function courseFormatLabels(type) { return { ...courseFormats, face: type === 'live' ? '班课' : '面授' }; }
    function classDirectory(rows) {
      const count = value => Number.isSafeInteger(value) && value >= 0 ? String(value) : '—';
      const headers=['ID','名称','授课方式','课程名称','课程类型','进度','上课时间','在班人数','已报人数','预招人数','年份','学科','年级','学期','班型','老师','校区','教室','费用','状态','难度','操作'];
      const mapped=rows.map(row=>{
        const c=row.catalog, m=c?.metadata;
        const first=c?.firstStartsAt ? Date.parse(c.firstStartsAt) : NaN, last=c?.lastEndsAt ? Date.parse(c.lastEndsAt) : NaN;
        const status=!Number.isFinite(first) || !Number.isFinite(last) ? '—' : first>Date.now() ? '未开课' : last<=Date.now() ? '已结课' : '开课中';
        const period=Number.isFinite(first) && Number.isFinite(last) ? `${dateAt(c.firstStartsAt)} — ${dateAt(c.lastEndsAt)}` : '—';
        const schedule=`<details><summary>${esc(period)}</summary>${row.schedule.map(session=>`<p>${esc(dateAt(session.startsAt))} — ${esc(dateAt(session.endsAt))}</p>`).join('')}</details>`;
        const fee=row.fees ? `<details><summary>${esc(row.fees.courseFee)} 元/人/期</summary><p>教辅费 ${esc(row.fees.materialFee)} 元</p><p>${esc(refundRules[row.fees.courseRefundRule]?.replace('N',row.fees.refundLessonCount) || '—')}</p><p>教辅费：${row.fees.materialRefundRule==='after_start' ? '开课后不退' : '报名后不退'}</p></details>` : '—';
        return td([esc(row.id),button(row.name,'class-detail',`data-id="${esc(row.id)}"`),c?.courseType==='onsite' ? '面授' : c?.courseType==='live' ? '线上' : '—',esc(c?.courseName || '—'),esc(courseKinds[m?.courseKind] || '—'),c ? `${count(c.startedCount)}/${count(c.sessionCount)}` : '—',schedule,count(c?.enrolledCount),count(c?.registeredCount),esc(row.capacity),esc(m?.year || '—'),esc(c?.subject || '—'),esc(c?.grade || '—'),esc(m?.term || '—'),esc(m?.classType || '—'),esc(named('teachers',row.teacherId)),esc(named('campuses',row.campusId)),esc(row.room),fee,status,'—',button('详情','class-detail',`data-id="${esc(row.id)}"`)+(allowed('class.write') ? button('编辑','edit-class',`data-id="${esc(row.id)}"`,!state.options) : '')]);
      });
      return `<div class="actions">${allowed('class.write') && allowed('course.read') ? button('创建班级','pick-course','',!state.options,true) : ''}${button(state.classExport?.busy ? '正在导出…' : '导出班级','export-classes','',state.classExport?.busy || state.loading)}</div>${state.classExport?.error ? `<p class="notice" role="alert">${esc(state.classExport.error)}</p>` : ''}${state.classExport?.notice ? `<p role="status">${esc(state.classExport.notice)}</p>` : ''}<p>在班总人数：${count(state.data?.enrolledTotal)}</p>`+table(headers,mapped)+pager(state.data,'page','个班级');
    }
    function classExportCells(row) {
      const c=row.catalog,m=c?.metadata,f=row.fees;
      const count=value=>Number.isSafeInteger(value) && value>=0 ? String(value) : '—';
      const first=c?.firstStartsAt ? Date.parse(c.firstStartsAt) : NaN,last=c?.lastEndsAt ? Date.parse(c.lastEndsAt) : NaN;
      const phase=!Number.isFinite(first) || !Number.isFinite(last) ? '—' : first>Date.now() ? '未开课' : last<=Date.now() ? '已结课' : '开课中';
      const time=Number.isFinite(first) && Number.isFinite(last) ? `${dateAt(c.firstStartsAt)} — ${dateAt(c.lastEndsAt)}` : '—';
      const fees=f ? `课程费 ${f.courseFee} 元/人/期；教辅费 ${f.materialFee} 元；${refundRules[f.courseRefundRule]?.replace('N',f.refundLessonCount) || '—'}；教辅费${f.materialRefundRule==='after_start' ? '开课后不退' : '报名后不退'}` : '—';
      return [row.id,row.name,c?.courseType==='onsite' ? '面授' : c?.courseType==='live' ? '线上' : '—',c?.courseName || '—',courseKinds[m?.courseKind] || '—',c ? `${count(c.startedCount)}/${count(c.sessionCount)}` : '—',time,count(c?.enrolledCount),count(c?.registeredCount),row.capacity,m?.year || '—',c?.subject || '—',c?.grade || '—',m?.term || '—',m?.classType || '—',named('teachers',row.teacherId),named('campuses',row.campusId),row.room,fees,phase,'—'];
    }
    async function exportClasses(context='classes') {
      if(state.page!==context || !['classes','attendance'].includes(context) || !allowed('class.read') || state.classExport?.busy)return;
      const query=classReadQuery(),request=epoch,job={busy:true,error:'',notice:''};state.classExport=job;paint();
      try {
        const data=await academic.classes.export(query);
        if(state.classExport!==job || state.page!==context || request!==epoch || state.closed)return;
        if(!Array.isArray(data?.items) || !Number.isSafeInteger(data.total) || data.total!==data.items.length
          || new Set(data.items.map(row=>row.id)).size!==data.total
          || data.items.some(row=>typeof row.id!=='string' || !row.id || typeof row.name!=='string' || !Array.isArray(row.schedule)))throw Error('班级导出回执不一致，未生成文件。');
        const headers=['ID','名称','授课方式','课程名称','课程类型','进度','上课时间','在班人数','已报人数','预招人数','年份','学科','年级','学期','班型','老师','校区','教室','费用','状态','难度'];
        const sessions=context==='attendance' ? data.items.flatMap(cls=>cls.schedule.map(session=>({cls,session}))) : [];
        if(context==='attendance' && new Set(sessions.map(row=>row.session.id)).size!==sessions.length)throw Error('课次导出回执重复，未生成文件。');
        const columns=context==='attendance' ? attendanceColumns : headers;
        const rows=context==='attendance' ? sessions.sort((a,b)=>a.session.startsAt.localeCompare(b.session.startsAt)).map(({cls,session})=>attendanceCells(cls,session)) : data.items.map(classExportCells);
        download(context==='attendance' ? '班课考勤.csv' : '班级目录.csv','\uFEFF'+[columns,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n'));
        job.notice=context==='attendance' ? `已导出 ${sessions.length} 个课次，来自 ${data.total} 个匹配班级。` : `已导出 ${data.total} 个匹配班级。`;
      } catch(error) { if(state.classExport===job)job.error=fail(error); }
      finally { if(state.classExport===job) { job.busy=false;paint(); } }
    }
    async function loadClassDetail(id) {
      const previous=state.classDetail;
      const detail={id,tab:previous?.id===id ? previous.tab : 'lessons',membership:previous?.id===id ? previous.membership : 'active',search:previous?.id===id ? previous.search : '',studentPage:1,data:null,loading:true,error:'',students:null,studentsBusy:false,studentsError:'',studentRequest:0};
      state.classDetail=detail;paint();
      try {
        const data=await academic.classes.detail(id);
        if(state.classDetail!==detail || state.closed)return;
        if(data?.info?.id!==id || !Array.isArray(data.info.schedule) || !Array.isArray(data.lessons))throw Error('班级详情回执不一致，请重新读取。');
        detail.data=data;
      } catch(error) { if(state.classDetail===detail)detail.error=fail(error); }
      finally { if(state.classDetail===detail) { detail.loading=false;paint(); } }
      if(state.classDetail===detail && detail.data && detail.tab==='students')await loadClassStudents();
    }
    async function exportAllStudentAttendance() {
      if(state.page!=='attendance'||state.query.attendanceView!=='students'||!allowed('class.read')||!allowed('attendance.read')||state.classExport?.busy)return;
      const end=new Date(instant(`${state.query.dateUntil}T00:00`));end.setUTCDate(end.getUTCDate()+1);
      const query={courseType:'onsite',fromAt:instant(`${state.query.dateFrom}T00:00`),untilAt:end.toISOString(),
        ...Object.fromEntries(['campusId','teacherId','attendanceStatus','search'].filter(key=>state.query[key]).map(key=>[key,state.query[key]]))};
      if(query.fromAt>=query.untilAt)throw Error('结束日期不得早于开始日期。');
      const request=epoch,job={busy:true,error:'',notice:''};state.classExport=job;paint();
      try {
        const data=await academic.attendance.exportStudents(query);
        if(state.classExport!==job||state.page!=='attendance'||state.query.attendanceView!=='students'||request!==epoch||state.closed)return;
        if(!Array.isArray(data?.items)||!Number.isSafeInteger(data.total)||data.total!==data.items.length)
          throw Error('全部学生考勤导出回执不一致，未生成文件。');
        const ids=new Set();
        for(const row of data.items) {
          const identity=[row.classId,row.sessionId,row.studentId].join(':');
          if(!row.classId||!row.sessionId||!row.studentId||!row.studentName||!Number.isFinite(Date.parse(row.startsAt))
            ||Date.parse(row.startsAt)<Date.parse(query.fromAt)||Date.parse(row.startsAt)>=Date.parse(query.untilAt)
            ||!['recorded','unrecorded'].includes(row.attendanceStatus)
            ||(row.attendanceStatus==='recorded'?!Object.hasOwn(attendanceLabels,row.attendanceOutcome):row.attendanceOutcome!=null)
            ||ids.has(identity)||(query.campusId&&row.campusId!==query.campusId)||(query.teacherId&&row.teacherId!==query.teacherId)
            ||(query.attendanceStatus&&row.attendanceStatus!==query.attendanceStatus))throw Error('全部学生考勤导出范围与回执不一致，未生成文件。');
          ids.add(identity);
        }
        const columns=['校区','授课方式','课程名称','班级名称','开课时间','授课老师','辅导老师','学生姓名','手机号','考勤状态','出勤情况'];
        const values=data.items.map(row=>[row.campusName,'面授',row.courseName,row.className,dateAt(row.startsAt),named('teachers',row.teacherId),'—',row.studentName,row.phone||'—',attendanceStateLabels[row.attendanceStatus],row.attendanceOutcome?attendanceLabels[row.attendanceOutcome]:'—']);
        download('全部学生考勤.csv','\uFEFF'+[columns,...values].map(row=>row.map(csvCell).join(',')).join('\r\n'));
        job.notice=`已导出 ${data.total} 条匹配的学生课次考勤记录。`;
      } catch(error) { if(state.classExport===job)job.error=fail(error); }
      finally { if(state.classExport===job) { job.busy=false;paint(); } }
    }
    async function exportStudents() {
      if(!['students','teacherStudents'].includes(state.page)||!allowed('student.read')||state.studentExport?.busy)return;
      const page=state.page,view=scope(),classId=state.query.classId||null,job={busy:true,error:'',notice:''};
      state.studentExport=job;paint();
      try {
        const data=await academic.students.export({view,...(classId?{classId}:{})});
        if(state.studentExport!==job||state.page!==page||scope()!==view||(state.query.classId||null)!==classId||state.closed)return;
        if(!Array.isArray(data?.items)||!Number.isSafeInteger(data.total)||data.total!==data.items.length||data.view!==view||(data.classId||null)!==classId
          ||new Set(data.items.map(row=>row.id)).size!==data.total
          ||data.items.some(row=>typeof row.id!=='string'||!row.id||typeof row.name!=='string'||typeof row.phone!=='string'))
          throw Error('学生导出回执与当前筛选范围不一致，未生成文件。');
        const rows=[['学生ID','学生姓名','年级','联系电话'],...data.items.map(row=>[row.id,row.name,row.grade||'—',row.phone||'—'])];
        download(view==='mine'?'我的学生.csv':'学生名单.csv','\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'));
        job.notice=`已导出 ${data.total} 名学生；电话使用脱敏值。`;
      } catch(error) { if(state.studentExport===job)job.error=fail(error); }
      finally { if(state.studentExport===job){job.busy=false;paint();} }
    }
    async function startBatchTransfer() {
      if(state.page!=='students'||!allowed('student.read')||!allowed('enrollment.manage')||!state.query.classId||!state.selectedStudents.size)return;
      const selected=Array.from(state.selectedStudents.values());
      if(selected.length>500)throw Error('每批最多选择500名学生。');
      const draft={loading:true,error:'',selected,enrollments:[],targets:[],targetId:'',reason:''};state.transferDraft=draft;paint();
      try {
        const records=new Array(selected.length);let cursor=0;
        const worker=async()=>{while(cursor<selected.length){const index=cursor++,student=selected[index];records[index]=await (async()=>{
          const first=await academic.students.transferOptions(student.id,{page:1,size:100});
          if(first?.studentId!==student.id||!Array.isArray(first.enrollments)||!Array.isArray(first.targets)||!Number.isSafeInteger(first.targetTotal)||first.page!==1||first.size!==100)throw Error('转班选项回执不完整，请重新读取。');
          let targets=first.targets.slice();
          for(let page=2;targets.length<first.targetTotal;page++){
            const next=await academic.students.transferOptions(student.id,{page,size:100});
            if(next?.studentId!==student.id||!Array.isArray(next.targets)||next.page!==page||next.targetTotal!==first.targetTotal)throw Error('目标班级列表不完整，请重试。');
            targets.push(...next.targets);
            if(page>Math.ceil(first.targetTotal/100))throw Error('目标班级分页异常，请重试。');
          }
          const matches=first.enrollments.filter(row=>row.classId===state.query.classId&&Number.isSafeInteger(row.version)&&row.version>0&&typeof row.enrollmentId==='string');
          if(matches.length!==1)throw Error(`${student.name}在所选源班没有唯一有效学籍，不能加入本批。`);
          return {enrollment:matches[0],targets};
        })();}};
        await Promise.all(Array.from({length:Math.min(8,selected.length)},worker));
        if(state.transferDraft!==draft||state.closed)return;
        const byId=new Map(records[0]?.targets.map(row=>[row.id,row])||[]);
        for(const record of records.slice(1))for(const id of byId.keys())if(!record.targets.some(row=>row.id===id))byId.delete(id);
        draft.enrollments=records.map(row=>row.enrollment);
        draft.targets=Array.from(byId.values()).filter(row=>row.id!==state.query.classId).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
        if(!draft.targets.length)draft.error='当前授权范围内没有所有所选学生都可见的目标班级。';
      } catch(error){if(state.transferDraft===draft)draft.error=fail(error);}
      finally{if(state.transferDraft===draft){draft.loading=false;paint();}}
    }
    function transferHtml() {
      const draft=state.transferDraft;if(!draft)return'';
      if(draft.loading)return `<section class="card pad"><h2>批量转班</h2><p role="status">正在核对所选学生的学籍和可见班级…</p>${button('取消','cancel-batch-transfer')}</section>`;
      if(draft.error)return `<section class="card pad"><h2>批量转班</h2><p class="notice" role="alert">${esc(draft.error)}</p>${button('返回学生名单','cancel-batch-transfer')}</section>`;
      return `<section class="card pad ja-editor"><h2>批量转班 · 提交前检查</h2><p>源班：${esc(state.query.className||state.query.classId)} · 学生 ${draft.enrollments.length} 名</p>${table(['学生','学籍版本'],draft.selected.map((student,index)=>td([esc(student.name),esc(draft.enrollments[index]?.version)])))}<form data-ja-form="batch-transfer"><div class="form-grid">${select('目标班级','targetClassId',draft.targetId,draft.targets.map(row=>({value:row.id,label:`${row.name} · ${row.courseName} · ${row.enrolledCount}/${row.capacity}`})))}<label>转班原因<textarea class="textarea" name="reason" required maxlength="500">${esc(draft.reason)}</textarea></label></div><p class="help">服务端会再次检查目标班级容量、课程、价格、课次和时间冲突。原订单、课消与权益流水保持可追溯。</p><div class="actions">${button('取消','cancel-batch-transfer')}<button class="btn primary" ${draft.enrollments.length===draft.selected.length?'':'disabled'}>核对并提交</button></div></form></section>`;
    }
    async function loadClassStudents(page=1) {
      const d=state.classDetail;if(!d?.data || !allowed('student.read'))return;
      const request=++d.studentRequest;d.studentsBusy=true;d.studentsError='';d.studentPage=page;paint();
      try {
        const data=await academic.classes.students(d.id,{membership:d.membership,search:d.search,page,size:20});
        if(state.classDetail!==d || request!==d.studentRequest || state.closed)return;
        if(data?.classId!==d.id || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.page!==page)throw Error('学生列表回执不一致。');
        d.students=data;
      } catch(error) { if(state.classDetail===d && request===d.studentRequest)d.studentsError=fail(error); }
      finally { if(state.classDetail===d && request===d.studentRequest) { d.studentsBusy=false;paint(); } }
    }
    async function exportClassStudents() {
      const d=state.classDetail;
      if(!d?.data || d.exportBusy || !allowed('student.read') || !allowed('class.read'))return;
      const membership=d.membership,search=d.search;
      d.exportBusy=true;d.exportError='';d.exportNotice='';paint();
      try {
        const data=await academic.classes.exportStudents(d.id,{membership,search});
        if(state.classDetail!==d || state.closed || d.membership!==membership || d.search!==search)return;
        if(data?.classId!==d.id || data.membership!==membership || data.search!==search || !Array.isArray(data.items)
          || !Number.isSafeInteger(data.total) || data.total!==data.items.length
          || new Set(data.items.map(row=>row.id)).size!==data.total
          || data.items.some(row=>typeof row.id!=='string' || !row.id || typeof row.name!=='string'))throw Error('学生导出回执不一致，未生成文件。');
        const rows=[['ID','姓名','电话','当前停课日期'],...data.items.map(row=>[row.id,row.name,row.phone || '—','—'])];
        download(`班级-${d.id}-${membership==='history' ? '历史' : '在班'}学生.csv`,'\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'));
        d.exportNotice=`已导出 ${data.total} 名${membership==='history' ? '历史' : '在班'}学生，电话为脱敏值。`;
      } catch(error) { if(state.classDetail===d)d.exportError=fail(error); }
      finally { if(state.classDetail===d) { d.exportBusy=false;paint(); } }
    }
    function classDetailHtml() {
      const d=state.classDetail;
      const back=button('返回班级列表','close-class-detail');
      if(d.loading)return `<section class="card pad"><p role="status">正在读取班级详情…</p>${back}</section>`;
      if(d.error)return `<section class="card pad"><p class="notice" role="alert">${esc(d.error)}</p>${button('重试','refresh-class-detail')}${back}</section>`;
      const cls=d.data.info,c=cls.catalog,m=c?.metadata,fee=cls.fees;
      const fields=[['课程',c?.courseName],['班级名称',cls.name],['内容',c?.courseType==='live' ? '线上课程' : c?.courseType==='onsite' ? '面授课程' : null],['老师',named('teachers',cls.teacherId)],['人数上限',cls.capacity],['调课虚位',null],['校区',named('campuses',cls.campusId)],['教室',cls.room],['学期',m?.term],['入学资格',null],['学科',c?.subject],['年级',c?.grade]];
      const fees=[['收费模式',fee ? '整期' : null],['课程费',fee ? `${fee.courseFee} 元` : null],['课程费退款规则',fee ? refundRules[fee.courseRefundRule]?.replace('N',fee.refundLessonCount) : null],['教辅费',fee ? `${fee.materialFee} 元` : null],['教辅费退款规则',fee ? fee.materialRefundRule==='after_start' ? '开课后不退' : '报名后不退' : null]];
      const list=values=>`<dl>${values.map(([label,value])=>`<dt>${esc(label)}</dt><dd>${esc(value ?? '—')}</dd>`).join('')}</dl>`;
      const lessons=table(['讲次','名称','上课时间','讲次学生数','讲义下载次数','操作'],d.data.lessons.map(lesson=>td([`第 ${esc(lesson.sequence)} 讲`,esc(lesson.title),esc(`${dateAt(lesson.session.startsAt)} — ${dateAt(lesson.session.endsAt)}`),Number.isSafeInteger(lesson.session.attendance?.studentCount) ? esc(lesson.session.attendance.studentCount) : '—','—',allowed('attendance.read') ? button('考勤','roster',`data-id="${esc(lesson.session.id)}" data-class="${esc(cls.id)}"`) : '—'])));
      const students=`<div class="actions">${button(d.exportBusy ? '正在导出…' : '导出','export-class-students','',d.exportBusy)}${d.exportError ? `<p class="notice" role="alert">${esc(d.exportError)}</p>` : ''}${d.exportNotice ? `<p role="status">${esc(d.exportNotice)}</p>` : ''}</div><div class="ja-tabs">${[['active','在班学生'],['history','历史学生']].map(([membership,label])=>button(`${label}${d.students ? `（${membership==='active' ? d.students.activeCount : d.students.historyCount}）` : ''}`,'class-membership',`data-membership="${membership}" aria-pressed="${d.membership===membership}"`)).join('')}</div><form data-ja-form="class-students" class="filters">${input('姓名、电话、学生ID','search',d.search,'search','maxlength="100"')}<button class="btn primary">查询</button></form>${d.studentsBusy ? '<p role="status">正在读取学生…</p>' : d.studentsError ? `<p class="notice" role="alert">${esc(d.studentsError)}</p>${button('重试学生名单','class-student-page',`data-page="${d.studentPage}"`)}` : table(['ID','姓名','电话','当前停课日期','操作'],items(d.students).map(student=>td([esc(student.id),esc(student.name),esc(student.phone || '—'),'—','—'])))+pager(d.students,'class-student-page','名学生')}`;
      return `<section class="ja-class-detail"><div class="heading"><h2>${esc(cls.name)}</h2><div class="actions">${back}${button('刷新详情','refresh-class-detail')}${allowed('class.write') ? button('编辑','edit-class',`data-id="${esc(cls.id)}"`,!state.options) : ''}</div></div><div class="ja-class-overview"><section class="card pad"><h3>基本信息</h3>${list(fields)}</section><section class="card pad"><h3>收费标准</h3>${list(fees)}</section></div><section class="card pad"><div class="ja-tabs" role="tablist" aria-label="班级详情">${button('讲次信息','class-detail-tab','data-tab="lessons"',false,d.tab==='lessons')}${button('学生','class-detail-tab','data-tab="students"',!allowed('student.read'),d.tab==='students')}</div>${d.tab==='lessons' ? lessons : students}</section></section>`;
    }
    function classSteps(step) {
      return `<ol class="ja-course-steps" aria-label="创建班级步骤">${['基本信息','讲次信息','收费标准','完成'].map((label,i)=>`<li ${i+1===step ? 'aria-current="step"' : ''}>${i+1}. ${label}</li>`).join('')}</ol>`;
    }
    const refundRules = {unused_lessons:'根据未上讲次退费',first_n_full:'前N讲退班，全额退费',last_n_none:'后N讲退班，不退费用'};
    function courseSteps(step) {
      return `<ol class="ja-course-steps" aria-label="创建课程步骤">${['基本信息', '讲次信息', '完成'].map((label, index) => `<li ${index + 1 === step ? 'aria-current="step"' : ''}>${index + 1}. ${label}</li>`).join('')}</ol>`;
    }
    function courseEditor(edit) {
      const d = edit.draft, step = edit.step || 1;
      const options = labels => Object.entries(labels).map(([value, label]) => ({ value, label }));
      let basic = `<div class="form-grid ja-course-basic">${select('课程性质', 'courseType', d.courseType, [{ value: 'onsite', label: '面授课' }, { value: 'live', label: '线上课' }])}${select('课程分类', 'format', d.format, options(edit.row && !edit.row.metadata ? {'':'未记录',...courseFormatLabels(d.courseType)} : courseFormatLabels(d.courseType)))}${select('课程类型', 'courseKind', d.courseKind, options(edit.row && !edit.row.metadata ? {'':'未记录',...courseKinds} : courseKinds))}${input('年份', 'year', d.year, 'number', 'required min="2000" max="2100" step="1"')}${input('学期', 'term', d.term, 'text', 'required maxlength="40"')}${input('学科', 'subject', d.subject, 'text', 'required maxlength="40"')}${input('年级', 'grade', d.grade, 'text', 'required maxlength="40"')}${input('班型', 'classType', d.classType, 'text', 'maxlength="40"')}${input('课程名称', 'name', d.name, 'text', 'required maxlength="100"')}${select('适用校区', 'campusId', d.campusId, optionRows('campuses', identity.scope === 'all' ? '全机构课程' : '请选择校区'), identity.scope === 'all' ? '' : 'required')}${input('课程价格（元）', 'price', d.price, 'number', 'required min="0" step="0.01"')}</div>`;
      if (edit.row) basic = basic.replace(/<(input|select)([^>]*name="([^"]+)"[^>]*)>/g, (tag, kind, attrs, name) => name === 'name' || name === 'year' && edit.row.metadata ? tag : `<${kind}${attrs} disabled>`);
      const lessons = `<h3>讲次信息</h3><div class="table-wrap"><table class="table ja-course-lessons"><thead><tr><th>讲次</th><th>讲次名称</th><th>操作</th></tr></thead><tbody>${d.lessons.length ? d.lessons.map((lesson, index) => `<tr><td>第 ${index + 1} 讲</td><td>${esc(lesson.title)}</td><td>${button('编辑', 'edit-lesson', `data-index="${index}"`)}${!edit.row ? button('删除', 'remove-lesson', `data-index="${index}"`) : ''}</td></tr>`).join('') : '<tr><td colspan="3">暂无讲次，请添加讲次</td></tr>'}</tbody></table></div>${button('添加讲次', 'add-lesson', '', d.lessons.length >= 200)}${edit.row ? button('删除最后一讲', 'remove-lesson', `data-index="${d.lessons.length - 1}"`, d.lessons.length <= 1) : ''}`;
      return `<section class="card pad ja-editor ja-course-editor"><h2>${edit.row ? '编辑' : '创建'}${d.courseType === 'live' ? '线上' : '面授'}课程</h2>${courseSteps(step)}<form data-ja-form="course">${edit.row ? basic + lessons : step === 1 ? basic : lessons}<div class="actions">${button('取消', 'cancel-edit')}${step === 2 && !edit.row ? button('上一步', 'course-previous') : ''}<button class="btn primary" type="submit">${edit.row ? '核对修改' : step === 1 ? '下一步' : '核对课程'}</button></div></form>${lessonDialog(edit)}</section>`;
    }
    function lessonDialog(edit) {
      if (!edit.lessonDialog) return '';
      const model = edit.lessonDialog;
      return `<dialog class="ja-lesson-dialog" data-ja-dialog="lesson" aria-label="${model.index === null ? '添加讲次' : '编辑讲次'}"><h3>${model.index === null ? '添加讲次' : '编辑讲次'}</h3>${state.error ? `<p class="notice" role="alert">${esc(state.error)}</p>` : ''}<form data-ja-form="lesson">${input('讲次名称', 'title', model.title, 'text', 'required maxlength="30" autofocus')}<div class="actions">${button('取消', 'cancel-lesson')}<button class="btn primary" type="submit">确定</button></div></form></dialog>`;
    }
    function closeLessonDialog() {
      const index = state.edit?.lessonDialog?.index;
      lessonReturnFocus = index === null ? '[data-ja-action="add-lesson"]' : `[data-ja-action="edit-lesson"][data-index="${index}"]`;
      if (state.edit) state.edit.lessonDialog = null;
    }
    function courseMetadata(d) {
      const year = Number(d.year);
      if (!Number.isInteger(year) || year < 2000 || year > 2100 || !d.term.trim() || !courseKinds[d.courseKind] || !courseFormats[d.format]) throw Error('请完整填写课程类型、年份、学期和课程分类。');
      return { year, term: d.term.trim(), classType: d.classType.trim() || null, courseKind: d.courseKind, format: d.format };
    }
    function editor() {
      const edit = state.edit;
      if (!edit) return '';
      const d = edit.draft;
      if (edit.type === 'course') return courseEditor(edit);
      if (edit.type === 'class' || edit.type === 'class-update') {
        const updating = edit.type === 'class-update';
        let fields = input('班级名称', 'name', d.name, 'text', 'required maxlength="100"');
        if (!updating) fields += edit.course.campusId
          ? select('校区（课程适用校区）', 'campusId', edit.course.campusId, [{ value: edit.course.campusId, label: named('campuses', edit.course.campusId) }], 'disabled')
          : select('校区', 'campusId', d.campusId, optionRows('campuses', '请选择校区'), 'required');
        fields += select('授课老师', 'teacherId', d.teacherId, teacherOptions(updating ? edit.row.teacherId : null), 'required') + button('查看老师课表','resource-schedule','data-kind="teacher"',!allowed('class.read')) + input('教室（选填）', 'room', d.room, 'text', 'maxlength="100" list="ja-rooms" placeholder="留空由系统自动显示教室1、教室2"') + button('查看教室课表','resource-schedule','data-kind="room"',!allowed('class.read')||!d.room?.trim()) + input('班级容量', 'capacity', d.capacity, 'number', 'required min="1" max="10000"');
        if (!updating) fields += input('每讲时长（分钟）', 'durationMinutes', d.durationMinutes, 'number', 'required min="1" max="1440"');
        const schedule = updating ? '' : `<h3>逐讲排期</h3><p>课程：${esc(edit.course.name)} · ${edit.course.lessons.length} 讲。可逐行填写，或按星期生成未排课次。</p><div class="ja-repeat"><div class="filters">${input('首次排课日期', 'repeatDate', d.repeatDate, 'date')}${input('开始时间', 'repeatTime', d.repeatTime, 'time')}</div><fieldset><legend>上课星期</legend>${['日', '一', '二', '三', '四', '五', '六'].map((day, index) => `<label><input type="checkbox" name="weekday.${index}" ${d.weekdays.includes(index) ? 'checked' : ''}>星期${day}</label>`).join('')}</fieldset><div class="filters">${input('停课日期', 'holidayDate', d.holidayDate, 'date')}${button('添加停课日', 'add-holiday')}</div><div class="ja-tags">${d.holidays.map(day => button(`${day} ×`, 'remove-holiday', `data-date="${day}"`)).join('') || '<span class="muted">尚未设置停课日</span>'}</div>${button('生成尚未安排的课次', 'generate-schedule')}</div><div class="ja-schedule-rows">${d.schedule.map((row, index) => `<div><strong>第 ${index + 1} 讲 · ${esc(edit.course.lessons[index].title)}</strong>${input('日期', `date.${index}`, row.date, 'date', 'required')}${input('时间', `time.${index}`, row.time, 'time', 'required')}</div>`).join('')}</div>`;
        if (updating) return `<section class="card pad ja-editor"><h2>编辑班级</h2><form data-ja-form="${edit.type}"><div class="form-grid">${fields}</div>${formActions()}</form></section>`;
        const step = edit.step || 1;
        const feeFields = `<h3>收费标准</h3><p>收费模式：整期</p><div class="form-grid ja-course-basic">${input('课程费（元）','courseFee',d.courseFee,'number','required min="0" step="0.01"')}${select('课程费退款规则','courseRefundRule',d.courseRefundRule,Object.entries(refundRules).map(([value,label])=>({value,label})))}${d.courseRefundRule === 'unused_lessons' ? '' : input('退款规则讲次数','refundLessonCount',d.refundLessonCount,'number',`required min="1" max="${edit.course.lessons.length}" step="1"`)}${input('教辅费（元）','materialFee',d.materialFee,'number','required min="0" step="0.01"')}${select('教辅费退款规则','materialRefundRule',d.materialRefundRule,[{value:'after_enrollment',label:'报名后不退'},{value:'after_start',label:'开课后不退'}])}</div>`;
        return `<section class="card pad ja-editor ja-course-editor"><h2>创建班级</h2>${classSteps(step)}<form data-ja-form="class">${step === 1 ? `<h3>基本信息</h3><div class="form-grid ja-course-basic">${fields}</div>` : step === 2 ? schedule : feeFields}<div class="actions">${button('取消','cancel-edit')}${step > 1 ? button('上一步','class-previous') : ''}<button class="btn primary" type="submit">${step < 3 ? '下一步' : '核对班级'}</button></div></form></section>`;
      }
      if (edit.type === 'move') return `<section class="card pad ja-editor"><h2>调整课次时间</h2><p>${esc(edit.className)} · 原时间 ${esc(dateAt(edit.session.startsAt))}</p><form data-ja-form="move"><div class="form-grid">${input('新日期', 'date', d.date, 'date', 'required')}${input('新开始时间', 'time', d.time, 'time', 'required')}</div><label>调整原因<textarea class="textarea" name="reason" required maxlength="500">${esc(d.reason)}</textarea></label>${formActions()}</form></section>`;
      return '';
    }
    function closeResourceSchedule() {
      if(state.resourceSchedule)lessonReturnFocus=`[data-ja-action="resource-schedule"][data-kind="${state.resourceSchedule.kind}"]`;
      state.resourceSchedule=null;paint();
    }
    async function openResourceSchedule(kind) {
      const edit=state.edit;
      if(!edit || !['class','class-update'].includes(edit.type) || !allowed('class.read') || !['teacher','room'].includes(kind))return;
      const d=edit.draft,campusId=d.campusId || edit.row?.campusId;
      if(kind==='teacher' && !d.teacherId)throw Error('请先选择授课老师。');
      if(kind==='room' && (!campusId || !d.room?.trim()))throw Error('查看教室课表前请填写具体教室名称。');
      const dates=(d.schedule || []).map(row=>row.date).filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
      const from=dates[0] || d.repeatDate || today(),last=dates.at(-1);
      const end=new Date(instant(`${last || from}T00:00`));end.setUTCDate(end.getUTCDate()+(last ? 0 : 30));
      const until=localParts(end.toISOString())[0];
      state.resourceSchedule={kind,edit,campusId,teacherId:d.teacherId,room:d.room?.trim(),from,until,page:1,data:null,busy:false,error:'',request:0};
      await loadResourceSchedule(1);
    }
    async function loadResourceSchedule(page=1) {
      const panel=state.resourceSchedule;
      if(!panel || panel.edit!==state.edit || !allowed('class.read'))return;
      const request=++panel.request;panel.page=page;panel.busy=true;panel.error='';panel.data=null;paint();
      try {
        const fromAt=instant(`${panel.from}T00:00`),end=new Date(instant(`${panel.until}T00:00`));end.setUTCDate(end.getUTCDate()+1);
        const untilAt=end.toISOString();if(fromAt>=untilAt)throw Error('结束日期不得早于开始日期。');
        const query={view:'scope',fromAt,untilAt,page,size:20,...(panel.kind==='teacher' ? {teacherId:panel.teacherId} : {campusId:panel.campusId,room:panel.room})};
        const data=await academic.classes.list(query);
        if(state.resourceSchedule!==panel || panel.edit!==state.edit || request!==panel.request || state.closed)return;
        if(!Array.isArray(data?.items) || data.page!==page || !Number.isSafeInteger(data.total)
            || data.items.some(row=>!Array.isArray(row.schedule) || panel.kind==='room' && (row.campusId!==panel.campusId || row.room!==panel.room)
              || row.schedule.some(session=>panel.kind==='teacher' && session.teacherId!==panel.teacherId)))throw Error('课表回执与所选老师或教室不一致。');
        panel.data=data;
      } catch(error) { if(state.resourceSchedule===panel && request===panel.request)panel.error=fail(error); }
      finally { if(state.resourceSchedule===panel && request===panel.request) { panel.busy=false;paint(); } }
    }
    function resourceScheduleHtml() {
      const panel=state.resourceSchedule;if(!panel)return '';
      const title=panel.kind==='teacher' ? `老师课表 · ${named('teachers',panel.teacherId)}` : `教室课表 · ${named('campuses',panel.campusId)} / ${panel.room}`;
      const rows=items(panel.data).flatMap(cls=>cls.schedule.map(session=>({cls,session}))).sort((a,b)=>a.session.startsAt.localeCompare(b.session.startsAt));
      const body=table(['时间','班级','校区','教室','老师'],rows.map(({cls,session})=>td([esc(`${dateAt(session.startsAt)} — ${dateAt(session.endsAt)}`),esc(cls.name),esc(named('campuses',cls.campusId)),esc(cls.room),esc(named('teachers',session.teacherId))])));
      return `<dialog class="ja-resource-schedule" data-ja-dialog="resource-schedule" aria-labelledby="ja-resource-schedule-title"><div class="heading"><h2 id="ja-resource-schedule-title">${esc(title)}</h2>${button('返回建班草稿','close-resource-schedule')}</div><p class="help">展示当前授权范围内的排期；按匹配班级分页。保存班级时仍会重新核对冲突。</p><form data-ja-form="resource-schedule" class="filters">${input('开始日期','from',panel.from,'date','required')}${input('结束日期','until',panel.until,'date','required')}<button class="btn primary">查询</button></form>${panel.busy ? '<p role="status">正在读取课表…</p>' : panel.error ? `<p class="notice" role="alert">${esc(panel.error)}</p>${button('重试','resource-schedule-page',`data-page="${panel.page}"`)}` : body+pager(panel.data,'resource-schedule-page','个班级')}</dialog>`;
    }
    function pickerHtml() {
      const picker = state.picker;
      if (!picker) return '';
      const course = picker.kind === 'course';
      if (!course) return `<section class="card pad ja-editor"><h2>选择在读班级</h2>${button('取消', 'cancel-picker')}${picker.error ? `<p class="notice" role="alert">${esc(picker.error)}</p>${button('重试', 'picker-page', `data-page="${picker.page}"`)}` : ''}${picker.loading ? '<p role="status">正在读取可选记录…</p>' : picker.error ? '' : table(['班级', '校区', '选择'], items(picker.data).map(row => td([esc(row.name), esc(named('campuses', row.campusId)), button('选择', 'pick-record', `data-id="${esc(row.id)}"`)]))) + pager(picker.data, 'picker-page')}</section>`;
      const q = picker.query;
      const filters = `<form data-ja-form="course-picker-filters" class="filters">${input('课程名称','search',q.search,'search','maxlength="100"')}${select('类型','courseKind',q.courseKind,[{value:'',label:'全部'},...Object.entries(courseKinds).map(([value,label])=>({value,label}))])}${input('学期','term',q.term,'text','maxlength="40"')}${input('学科','subject',q.subject,'text','maxlength="40"')}${input('年级','grade',q.grade,'text','maxlength="40"')}${select('课程性质','courseType',q.courseType,[{value:'',label:'全部'},{value:'onsite',label:'面授课'},{value:'live',label:'线上课'}])}<button type="submit" class="btn primary" ${picker.loading ? 'disabled' : ''}>查询</button></form>`;
      const rows = items(picker.data).map(row => td([`<input type="radio" name="ja-picked-course" value="${esc(row.id)}" aria-label="选择${esc(row.name)}" data-ja-action="pick-record" data-id="${esc(row.id)}" ${picker.selectedId === row.id ? 'checked' : ''} ${row.active === false ? 'disabled' : ''}>`,esc(row.name),esc(courseKinds[row.metadata?.courseKind] || '—'),esc(row.metadata?.term || '—'),esc(row.subject),esc(row.grade),esc(row.metadata?.classType || '—')]));
      return `<dialog class="ja-course-picker" data-ja-dialog="course-picker" aria-label="选择建班课程"><h2>选择建班课程</h2>${filters}${picker.error ? `<p class="notice" role="alert">${esc(picker.error)}</p>${button('重试','picker-page',`data-page="${picker.page}"`)}` : ''}${picker.loading ? '<p role="status">正在读取可选课程…</p>' : picker.error ? '' : table(['选择','课程名称','类型','学期','学科','年级','班型'],rows) + pager(picker.data,'picker-page')}<div class="actions">${button('取消','cancel-picker')}${button('确定','confirm-picked-course','',picker.loading || !picker.selectedId,true)}</div></dialog>`;
    }
    async function loadPicker(kind, page = 1, query) {
      const selectedQuery = query || (state.picker?.kind === kind ? state.picker.query : {}) || {};
      const picker = { kind, page, query:{...selectedQuery}, selectedId:'', loading:true, data:null, error:'' }; state.picker = picker; paint();
      try {
        const result = kind === 'course' ? await academic.courses.list({ ...picker.query, status:'active', page, size:20 })
          : await academic.classes.list({ view:scope(), page, size:20 });
        if (state.picker === picker) picker.data = result;
      } catch (error) { if (state.picker === picker) picker.error = fail(error); }
      finally { if (state.picker === picker) { picker.loading = false; paint(); } }
    }
    function communicationHtml() {
      if (!state.student) return '';
      const c = state.communication;
      return `<section class="card pad ja-editor"><h2>${esc(state.student.name)} · 沟通记录</h2>${button('返回名单', 'close-student')}<p class="help">沟通记录仅保存沟通事实。</p>${state.classes?.error ? `<p class="notice" role="alert">${esc(state.classes.error)}</p>${button('重试班级', 'student-class-page', `data-page="${state.classPage}"`)}` : ''}${state.classes?.loading ? '<p role="status">正在读取在读班级…</p>' : state.classes?.error ? '' : `<div class="ja-tabs">${items(state.classes).map(cls => button(cls.name, 'communication-class', `data-id="${esc(cls.id)}" aria-pressed="${c?.classId === cls.id}"`)).join('') || '<p>当前授权范围没有可沟通的在读班级。</p>'}</div>${pager(state.classes, 'student-class-page', '个在读班级')}`}${!c ? '' : `<h3>${esc(c.className)}</h3>${c.error ? `<p class="notice" role="alert">${esc(c.error)}</p>${button('重试记录', 'communication-class', `data-id="${esc(c.classId)}"`)}` : ''}${allowed('student.communicate') ? `<form data-ja-form="communication"><div class="form-grid">${select('沟通渠道', 'channel', c.draft.channel, Object.entries(channelLabels).map(([key, label]) => ({ value: key, label })))}${input('下次回访（北京时间）', 'nextFollowAt', c.draft.nextFollowAt, 'datetime-local')}</div><label>沟通内容<textarea class="textarea" name="content" required maxlength="2000">${esc(c.draft.content)}</textarea></label><button class="btn primary">核对后保存</button></form>` : ''}${allowed('student.communication.read') ? c.loading ? '<p role="status">正在读取沟通时间线…</p>' : c.error ? '' : table(['时间', '渠道', '记录人', '内容', '下次回访'], (c.records || []).map(row => td([esc(dateAt(row.createdAt)), esc(channelLabels[row.channel] || row.channel), esc(named('teachers', row.actorId)), esc(row.content), row.nextFollowAt ? esc(dateAt(row.nextFollowAt)) : '未安排'])), '当前班级暂无沟通记录') : ''}<p class="help">时间线最多显示最近 100 条授权记录。</p>`}</section>`;
    }
    async function studentClasses(page = 1) {
      const student = state.student; if (!student) return;
      state.classPage = page; state.classes = { loading: true }; state.communication = null; const marker = state.classes; paint();
      try { const result = await academic.students.classes(student.id, { view: scope(), page, size: 20 }); if (state.student === student && state.classes === marker) state.classes = result; }
      catch (error) { if (state.student === student && state.classes === marker) state.classes = { error: fail(error) }; }
      paint();
    }
    async function communicationClass(classId) {
      const cls = items(state.classes).find(row => row.id === classId); if (!cls || !state.student) return;
      const student = state.student;
      const record = { classId, className: cls.name, loading: true, records: [], error: '', draft: { channel: 'phone', content: '', nextFollowAt: '' } };
      state.communication = record; paint();
      try { if (allowed('student.communication.read')) { const result = await academic.students.communications(student.id, { classId }); if (state.communication === record) record.records = result; } }
      catch (error) { if (state.communication === record) record.error = fail(error); }
      finally { if (state.communication === record) { record.loading = false; paint(); } }
    }
    function rosterHtml() {
      const roster = state.roster; if (!roster) return '';
      if (roster.loading) return `<section class="card pad"><p role="status">正在读取点名册…</p>${button('返回课表', 'close-roster')}</section>`;
      if (roster.error) return `<section class="card pad"><p class="notice" role="alert">${esc(roster.error)}</p>${button('重试点名册', 'roster', `data-id="${esc(roster.session.id)}" data-class="${esc(roster.cls.id)}"`)}${button('返回课表', 'close-roster')}</section>`;
      const writable = allowed('attendance.manage') && new Date(roster.data.startsAt).getTime() <= Date.now();
      return `<section class="card pad ja-editor"><h2>${esc(roster.cls.name)} · 点名册</h2><p>${esc(dateAt(roster.data.startsAt))}</p>${button('返回课表', 'close-roster')}${!writable && allowed('attendance.manage') ? '<p class="help">课程开始后可登记考勤。</p>' : ''}<p class="notice ja-attendance-lock" role="note">已登记考勤仅可在原登记日北京时间 24:00 前更正；锁定时间按考勤登记时间计算。</p><form data-ja-form="attendance">${writable ? button('将选中未登记学生标为出勤', 'mark-attended') : ''}<p class="help">出勤、迟到和早退将按报名课时权益扣减可用金额；请假、旷课不计课消。以下金额为本讲预计金额，提交时会重新核对余额及退款占用。</p>${table(['登记', '学生', '状态', '备注', '本讲课消', '操作'], roster.data.students.map(student => {
        const row = roster.draft[student.id];
        const canCorrect = allowed('attendance.manage') && student.attendanceId && attendanceCorrectionOpen(student);
      const correctionLabel = student.attendanceId && allowed('attendance.manage') ? attendanceCorrectionDeadline(student) === null ? '缺少登记时间，暂不能更正' : !Number.isSafeInteger(student.attendanceVersion) ? '缺少考勤版本，暂不能更正' : '已过北京时间 24:00 更正时限' : '—';
        return td([student.attendanceId ? '已登记' : writable ? `<input type="checkbox" name="selected.${esc(student.id)}" aria-label="登记${esc(student.name)}" ${row.selected ? 'checked' : ''}>` : '—', esc(student.name), student.attendanceId ? esc(attendanceLabels[student.attendanceStatus] || student.attendanceStatus) : writable ? select('考勤状态', `status.${student.id}`, row.status, [{ value: '', label: '请选择' }, ...Object.entries(attendanceLabels).map(([key, label]) => ({ value: key, label }))]) : '未登记', student.attendanceId ? esc(student.attendanceNote || '—') : writable ? input('考勤备注', `note.${student.id}`, row.note, 'text', 'maxlength="500"') : '—', esc(consumptionLabel(student)), canCorrect ? button('更正考勤','edit-attendance',`data-id="${esc(student.id)}"`) : correctionLabel]);
      }))}${writable ? '<button class="btn primary">核对考勤名单</button>' : ''}</form>${roster.correction ? `<section class="ja-correction"><h3>更正 ${esc(roster.correction.student.name)} 的考勤</h3><p class="help">原考勤：${esc(attendanceLabels[roster.correction.student.attendanceStatus] || '未知')} · 版本 ${roster.correction.student.attendanceVersion}。更正会保留原流水并由服务端原子冲正、重算课消；请填写原因。</p><form data-ja-form="attendance-correction">${select('更正后的状态','status',roster.correction.draft.status,Object.entries(attendanceLabels).map(([key,label])=>({value:key,label})))}<label>考勤备注<textarea class="textarea" name="note" maxlength="500">${esc(roster.correction.draft.note)}</textarea></label><label>更正原因<textarea class="textarea" name="reason" required maxlength="500">${esc(roster.correction.draft.reason)}</textarea></label><div class="actions">${button('取消更正','cancel-attendance-correction')}<button class="btn primary">核对更正</button></div></form></section>` : ''}</section>`;
    }
    async function loadRoster(sessionId, classId) {
      const cls = state.classDetail?.data?.info?.id===classId ? state.classDetail.data.info : items(state.data).find(row=>row.id===classId); const session = cls?.schedule.find(row => row.id === sessionId);
      if (!cls || !session || !allowed('attendance.read')) return;
      const roster = { cls, session, loading: true, error: '', data: null, draft: {} }; state.roster = roster; paint();
      try {
        const data = await academic.sessions.roster(sessionId);
        if (state.roster === roster) { roster.data = data; roster.correction = null; roster.draft = Object.fromEntries(data.students.map(row => [row.id, { selected: !row.attendanceId, status: '', note: '' }])); }
      } catch (error) { if (state.roster === roster) roster.error = fail(error); }
      finally { if (state.roster === roster) { roster.loading = false; paint(); } }
    }
    function reviewHtml() {
      const review = state.review; if (!review) return '';
      const guidance = review.uncertain ? '提交结果尚未确认，暂不能修改本次内容。请使用原提交重试，系统将沿用相同提交编号核对结果，请勿另建相同记录。' : '服务端已明确拒绝本次提交，可返回修改后重新核对。';
      return `<section class="card pad ja-review" aria-label="提交前核对"><h2>${esc(review.title)}</h2>${review.operation === 'course.create' ? courseSteps(2) : review.operation === 'class.create' ? classSteps(3) : ''}<dl>${review.summary.map(([label, detail]) => `<dt>${esc(label)}</dt><dd>${esc(detail)}</dd>`).join('')}</dl>${review.error ? `<p class="notice" role="alert">${esc(review.error)}</p><p class="help">${guidance}</p>` : ''}<div class="actions">${button('返回修改', 'review-back', '', review.busy || review.uncertain)}${button(review.busy ? '正在提交…' : review.uncertain ? '使用原提交重试' : '确认提交', 'commit', '', review.busy, true)}</div></section>`;
    }
    function html() {
      const entry = pages.find(item => item.id === state.page);
      if (!entry) return '';
      const rooms = (state.options?.rooms || []).filter(room => !(state.edit?.draft.campusId || state.query.campusId) || room.campusId === (state.edit?.draft.campusId || state.query.campusId));
      return `<section id="java-academic-workspace" class="java-academic">${heading(entry.title)}${state.error ? `<p class="notice" role="alert">${esc(state.error)}</p>` : ''}${state.notice ? `<p class="notice" role="status">${esc(state.notice)}</p>` : ''}${state.notice.startsWith('课程创建完成') ? courseSteps(3) : state.notice.startsWith('班级创建完成') ? classSteps(4) : ''}${optionsRecovery()}<datalist id="ja-rooms">${rooms.map(room => `<option value="${esc(room.name)}">${esc(named('campuses', room.campusId))}</option>`).join('')}</datalist>${state.review ? reviewHtml() : state.transferDraft ? transferHtml() : state.edit ? editor() : state.student ? communicationHtml() : state.roster ? rosterHtml() : state.classDetail ? classDetailHtml() : `${filters()}${pickerHtml()}<section class="card pad ${state.page === 'course' ? 'ja-course-directory' : state.page === 'classes' ? 'ja-class-directory' : ''}">${directory()}</section>`}${resourceScheduleHtml()}</section>`;
    }
    function capture(form) {
      const data = new root.FormData(form); const fields = {}; data.forEach((field, key) => { fields[key] = String(field); });
      const kind = form.dataset.jaForm;
      if (state.edit && ['course', 'class', 'class-update', 'move'].includes(kind)) {
        const draft = state.edit.draft;
        for (const [key, field] of Object.entries(fields)) if (!key.includes('.')) draft[key] = field;
        if (kind === 'course') draft.lessons = draft.lessons.map((row, index) => ({ title: fields[`lesson.${index}`] ?? row.title }));
        if (kind === 'class') {
          if (state.edit.step === 2 || !state.edit.step || Object.keys(fields).some(key=>key.startsWith('weekday.'))) draft.weekdays = [0, 1, 2, 3, 4, 5, 6].filter(day => fields[`weekday.${day}`]);
          draft.schedule = draft.schedule.map((row, index) => ({ ...row, date: fields[`date.${index}`] ?? row.date, time: fields[`time.${index}`] ?? row.time }));
        }
      }
      if (kind === 'lesson' && state.edit?.lessonDialog) state.edit.lessonDialog.title = fields.title || '';
      if(kind==='resource-schedule' && state.resourceSchedule) { state.resourceSchedule.from=fields.from || '';state.resourceSchedule.until=fields.until || ''; }
      if(kind==='class-students' && state.classDetail)state.classDetail.search=fields.search || '';
      if (kind === 'communication' && state.communication) Object.assign(state.communication.draft, fields);
      if (kind === 'batch-transfer' && state.transferDraft) Object.assign(state.transferDraft, {targetId:fields.targetClassId||'',reason:fields.reason||''});
      if (kind === 'attendance' && state.roster) for (const [id, row] of Object.entries(state.roster.draft)) Object.assign(row, { selected: Boolean(fields[`selected.${id}`]), status: fields[`status.${id}`] || '', note: fields[`note.${id}`] || '' });
      if (kind === 'attendance-correction' && state.roster?.correction) Object.assign(state.roster.correction.draft, fields);
      return fields;
    }
    async function startClass(course) {
      if (!allowed('class.write') || !state.options) return;
      const navigation = epoch;
      const campusId = course.campusId || state.optionCampusId || state.options.campuses?.[0]?.id || '';
      if (campusId && state.optionCampusId !== campusId && !await loadOptions(campusId)) { paint(); return; }
      if (navigation !== epoch || state.closed) return;
      state.picker = null; state.edit = { type: 'class', step:1, course, draft: { name: course.name, campusId, teacherId: mayAssignTeacher(false) ? '' : identity.principalId, room: '', capacity: '20', durationMinutes: '90', courseFee:'0.00', materialFee:'0.00', courseRefundRule:'unused_lessons', refundLessonCount:'1', materialRefundRule:'after_enrollment', repeatDate: today(), repeatTime: '09:00', weekdays: [], holidays: [], holidayDate: '', schedule: course.lessons.map(lesson => ({ lessonId: lesson.id, date: '', time: '' })) } }; paint();
    }
    function generateSchedule() {
      const d = state.edit.draft;
      if (!d.weekdays.length) throw Error('请至少选择一个上课星期。');
      const start = instant(`${d.repeatDate}T${d.repeatTime}`);
      let cursor = new Date(start);
      for (const row of d.schedule) {
        if (row.date && row.time) { const existing = new Date(instant(`${row.date}T${row.time}`)); if (existing >= cursor) { cursor = existing; cursor.setUTCDate(cursor.getUTCDate() + 1); } continue; }
        let found = false;
        for (let attempts = 0; attempts < 4000; attempts++) {
          const local = new Date(cursor.getTime() + 28800000);
          const day = local.toISOString().slice(0, 10);
          if (d.weekdays.includes(local.getUTCDay()) && !d.holidays.includes(day)) { row.date = day; row.time = d.repeatTime; found = true; cursor.setUTCDate(cursor.getUTCDate() + 1); break; }
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        if (!found) throw Error('无法在允许范围内生成全部课次，请检查星期和停课日期。');
      }
    }
    function prepare(title, operation, payload, summary, write, after, context = {}) {
      const input = JSON.parse(JSON.stringify(payload));
      const fingerprint = JSON.stringify([operation, input]);
      let key = keys.get(fingerprint);
      if (!key) { key = root.crypto.randomUUID(); keys.set(fingerprint, key); }
      state.review = { title, operation, input, summary, write, after, ...context, fingerprint, key, busy: false, uncertain: false, error: '' }; state.error = ''; paint();
    }
    async function commit() {
      const review = state.review; if (!review || review.busy) return;
      review.busy = true; review.error = ''; paint();
      try {
        const receipt = await review.write(review.input, review.key);
        if (!confirmedReceipt(review, receipt)) throw Error('服务端回执无法确认本次提交结果。');
        keys.delete(review.fingerprint);
        if (state.review !== review || state.closed) return;
        state.review = null; state.notice = review.operation === 'course.create' ? '课程创建完成。已保存，服务端数据已更新。' : review.operation === 'class.create' ? '班级创建完成。已保存，服务端数据已更新。' : '已保存，服务端数据已更新。';
        if (review.after) await review.after(receipt);
        else { if (review.operation === 'course.create') state.query = { ...state.query, courseType: review.input.courseType, format: review.input.metadata.format }; clearPanels(); await load(); }
      } catch (error) {
        if (state.review === review) {
          review.error = fail(error);
          review.uncertain = review.uncertain || !explicitlyRejected(error);
        }
      }
      finally { if (state.review === review) review.busy = false; paint(); }
    }
    async function submit(form) {
      if (state.review?.busy || state.review?.uncertain) return;
      if (form.reportValidity && !form.reportValidity()) return;
      const fields = capture(form), type = form.dataset.jaForm;
      state.error = '';
      try {
        if (type === 'lesson' && state.edit?.type === 'course' && state.edit.lessonDialog) {
          const dialog = state.edit.lessonDialog, title = dialog.title.trim();
          if (!title || title.length > 30) throw Error('请填写1–30字的讲次名称。');
          if (dialog.index === null) {
            if (state.edit.draft.lessons.length >= 200) throw Error('最多添加200个讲次。');
            state.edit.draft.lessons.push({ title });
          } else {
            if (!Number.isInteger(dialog.index) || !state.edit.draft.lessons[dialog.index]) throw Error('讲次已变化，请重新选择。');
            state.edit.draft.lessons[dialog.index] = { title };
          }
          closeLessonDialog(); paint(); return;
        }
        if (type === 'option-campus') {
          const campusId = fields.campusId.trim();
          if (!campusId) throw Error('请选择或填写校区编号。');
          if (state.edit?.type === 'class' && state.edit.course.campusId && campusId !== state.edit.course.campusId) throw Error('该课程只适用于固定校区，请读取课程适用校区的选项。');
          await loadOptions(campusId); paint(); return;
        }
        if (type === 'course-picker-filters' && state.picker?.kind === 'course') { await loadPicker('course',1,fields); return; }
        if(type==='resource-schedule' && state.resourceSchedule) { await loadResourceSchedule(1);return; }
        if(type==='class-students' && state.classDetail) { await loadClassStudents(1);return; }
        if (type === 'filters') {
          if(['students','teacherStudents'].includes(state.page)&&(fields.classId||'')!==(state.query.classId||''))state.selectedStudents.clear();
          state.query = ['course','classes','attendance'].includes(state.page) ? { ...fields, format:state.query.format,...(state.page==='attendance' ? {attendanceView:state.query.attendanceView,courseType:state.query.courseType||'onsite'} : {}) } : fields; state.number = 1;
          if ('campusId' in fields && fields.campusId !== state.optionCampusId) await loadOptions(fields.campusId);
          await load(); return;
        }
        if(type==='batch-transfer'&&state.transferDraft&&!state.transferDraft.loading) {
          const draft=state.transferDraft,target=draft.targets.find(row=>row.id===fields.targetClassId),reason=(fields.reason||'').trim();
          if(!target||!reason||reason.length>500||draft.enrollments.length!==draft.selected.length)throw Error('请选择有效目标班并填写不超过500字的转班原因。');
          draft.targetId=target.id;draft.reason=reason;
          const input={items:draft.enrollments.map(row=>({enrollmentId:row.enrollmentId,expectedVersion:row.version})),targetClassId:target.id,reason};
          prepare('核对批量转班','enrollment.batchTransfer',input,[['源班',state.query.className||state.query.classId],['目标班',target.name],['学生人数',input.items.length],['转班原因',reason],...draft.selected.map(row=>['学生',row.name])],(body,key)=>academic.enrollments.batchTransfer(body,key),async()=>{state.transferDraft=null;state.selectedStudents.clear();state.notice='批量转班已完成。';await load();},{transferStudents:draft.enrollments.map((row,index)=>({enrollmentId:row.enrollmentId,studentId:draft.selected[index].id,fromClassId:state.query.classId}))});
          return;
        }
        if (type === 'course' && allowed('course.write')) {
          const d = state.edit.draft;
          if (state.edit.row) {
            const row = state.edit.row;
            if (!d.name.trim()) throw Error('请填写课程名称。');
            const input = { name: d.name.trim(), year: row.metadata ? Number(d.year) : null, expectedVersion: row.version, lessons: d.lessons.map(lesson => ({title:lesson.title.trim()})) };
            if (row.metadata && (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100)) throw Error('年份必须为2000–2100的整数。');
            if (!input.lessons.length || input.lessons.some(lesson => !lesson.title || lesson.title.length > 30)) throw Error('请填写1–30字的讲次名称，至少保留一讲。');
            prepare('核对课程编辑', 'course.update:' + row.id, input, [['课程', input.name], ['年份', input.year || '未记录'], ['版本', input.expectedVersion], ...input.lessons.map((lesson,i) => [`第 ${i + 1} 讲`,lesson.title])], (body,key) => academic.courses.update(row.id,body,key));
            return;
          }
          const metadata = courseMetadata(d);
          if (!d.name.trim() || !d.grade.trim() || !d.subject.trim()) throw Error('请完整填写课程名称、年级和学科。');
          if (state.edit.step === 1) { state.edit.step = 2; paint(); return; }
          const input = { campusId: d.campusId || null, name: d.name.trim(), courseType: d.courseType, grade: d.grade.trim(), subject: d.subject.trim(), price: d.price, lessons: d.lessons.map(row => ({ title: row.title.trim() })), metadata };
          if (!input.name || !input.grade || !input.subject || !input.lessons.length || input.lessons.some(row => !row.title || row.title.length > 30)) throw Error('请完整填写课程资料和所有讲次名称。');
          prepare('核对课程', 'course.create', input, [['课程', input.name], ['课程分类', courseFormatLabels(input.courseType)[metadata.format]], ['课程类型', courseKinds[metadata.courseKind]], ['年份 / 学期', `${metadata.year} / ${metadata.term}`], ['班型', metadata.classType || '—'], ['课程性质', input.courseType === 'live' ? '线上课' : '面授课'], ['校区', input.campusId ? named('campuses', input.campusId) : '全机构'], ['年级 / 学科', `${input.grade} / ${input.subject}`], ['价格', `${input.price} 元`], ...input.lessons.map((lesson, i) => [`第 ${i + 1} 讲`, lesson.title])], (body, key) => academic.courses.create(body, key));
        } else if (['class', 'class-update'].includes(type) && allowed('class.write')) {
          const edit = state.edit, d = edit.draft;
          const input = { name: d.name.trim(), room: (d.room||'').trim(), teacherId: mayAssignTeacher(type === 'class-update') || type === 'class-update' && d.teacherId === edit.row.teacherId ? d.teacherId : identity.principalId, capacity: Number(d.capacity) };
          if (!input.name || !input.teacherId || !Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 10000) throw Error('请填写班级名称、老师及有效容量。');
          let summary = [['班级', input.name], ['老师', named('teachers', input.teacherId)], ['教室', input.room || '系统自动分配默认名称'], ['容量', `${input.capacity} 人`]];
          if (type === 'class') {
            if (edit.step === 1) { if (!d.name.trim() || !input.teacherId || !Number.isInteger(Number(d.durationMinutes)) || Number(d.durationMinutes)<1 || Number(d.durationMinutes)>1440) throw Error('请完整填写班级信息与每讲时长。'); edit.step=2; paint(); return; }
            Object.assign(input, { courseId: edit.course.id, campusId: edit.course.campusId || d.campusId, durationMinutes: Number(d.durationMinutes), schedule: d.schedule.map(row => ({ lessonId: row.lessonId, startsAt: instant(`${row.date}T${row.time}`) })) });
            if (!input.campusId || !Number.isInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 1440) throw Error('请选择校区并填写 1–1440 分钟的课次时长。');
            if (new Set(input.schedule.map(row => row.startsAt)).size !== input.schedule.length) throw Error('同一班级不能将多个讲次安排在同一开始时间。');
            if (edit.step === 2) { edit.step=3; paint(); return; }
            if (![d.courseFee,d.materialFee].every(value=>/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/.test(String(value))) || !refundRules[d.courseRefundRule] || !['after_enrollment','after_start'].includes(d.materialRefundRule)) throw Error('请填写有效金额与退款规则。');
            const count = d.courseRefundRule === 'unused_lessons' ? null : Number(d.refundLessonCount);
            if (count !== null && (!Number.isInteger(count) || count<1 || count>edit.course.lessons.length)) throw Error('退款规则讲次数超出班级讲次数。');
            input.fees = {courseFee:d.courseFee,materialFee:d.materialFee,courseRefundRule:d.courseRefundRule,refundLessonCount:count,materialRefundRule:d.materialRefundRule};
            summary = [['课程费',`${d.courseFee} 元 / 期`],['教辅费',`${d.materialFee} 元`],['课程费退款规则',refundRules[d.courseRefundRule].replace('N',count)],['教辅费退款规则',d.materialRefundRule === 'after_start' ? '开课后不退' : '报名后不退'],['课程', edit.course.name], ['校区', named('campuses', input.campusId)], ...summary, ['每讲时长', `${input.durationMinutes} 分钟`], ...input.schedule.map((session, i) => [`第 ${i + 1} 讲 · ${edit.course.lessons[i].title}`, dateAt(session.startsAt)])];
            prepare('核对班级及逐讲排期', 'class.create', input, summary, (body, key) => academic.classes.create(body, key));
          } else {
            input.expectedVersion = edit.row.version;
            prepare('核对班级修改', `class.update:${edit.row.id}`, input, summary, (body,key)=>academic.classes.update(edit.row.id,body,key),state.classDetail ? async()=>{state.edit=null;await loadClassDetail(edit.row.id);} : undefined);
          }
        } else if (type === 'move' && allowed('session.move')) {
          const edit = state.edit, d = edit.draft;
          if (!d.reason?.trim()) throw Error('请填写调整原因。');
          const input = { startsAt: instant(`${d.date}T${d.time}`), reason: d.reason.trim(), expectedVersion: edit.session.version };
          prepare('核对课次调整', `session.move:${edit.session.id}`, input, [['班级', edit.className], ['原时间', dateAt(edit.session.startsAt)], ['新时间', dateAt(input.startsAt)], ['原因', input.reason]], (body, key) => academic.sessions.move(edit.session.id, body, key));
        } else if (type === 'communication' && state.communication && allowed('student.communicate')) {
          const communication = state.communication, student = state.student;
          const input = { classId: communication.classId, channel: communication.draft.channel, content: communication.draft.content.trim(), nextFollowAt: communication.draft.nextFollowAt ? instant(communication.draft.nextFollowAt) : null };
          if (!input.content || !channelLabels[input.channel]) throw Error('请选择沟通渠道并填写沟通内容。');
          prepare('核对沟通记录', `student.communicate:${student.id}`, input, [['学生', student.name], ['班级', communication.className], ['渠道', channelLabels[input.channel]], ['内容', input.content], ['下次回访', input.nextFollowAt ? dateAt(input.nextFollowAt) : '未安排']], (body, key) => academic.students.communicate(student.id, body, key), () => communicationClass(communication.classId));
        } else if (type === 'attendance' && state.roster && allowed('attendance.manage')) {
          const roster = state.roster;
          const rows = roster.data.students.filter(student => !student.attendanceId && roster.draft[student.id].selected).map(student => ({ studentId: student.id, status: roster.draft[student.id].status, note: roster.draft[student.id].note }));
          if (!rows.length) throw Error('请至少选择一名未登记的学生。');
          if (rows.length > 100) throw Error('单次最多登记 100 人，请分批勾选。');
          if (rows.some(row => !attendanceLabels[row.status])) throw Error('请为每名选中的学生明确选择考勤状态。');
          const effects = rows.map(row => {
            const student = roster.data.students.find(item => item.id === row.studentId);
            return { student, row, cents: projectedConsumption(student, row.status) };
          });
          const totalCents = effects.reduce((sum, effect) => sum + effect.cents, 0n);
          const input = { classId: roster.data.classId, rows };
          prepare('核对考勤及课消', `session.attendance:${roster.session.id}`, input, [['班级', roster.cls.name], ['课次时间', dateAt(roster.data.startsAt)], ['本次登记', `${rows.length} 人`], ['预计课消合计', `${moneyFromCents(totalCents)} 元`], ['课消规则', '出勤、迟到和早退按本讲权益扣减；请假、旷课不扣减。提交时重新核对可用金额，不足则整批不保存。'], ...effects.map(({ student, row, cents }) => [student.name, `${attendanceLabels[row.status]} · 预计课消 ${moneyFromCents(cents)} 元${student.consumptionState === 'legacy_without_order' ? '（历史报名未关联订单）' : ''}${row.note ? ` · ${row.note}` : ''}`])], (body, key) => academic.sessions.attendance(roster.session.id, body, key), () => loadRoster(roster.session.id, roster.cls.id));
        } else if (type === 'attendance-correction' && state.roster?.correction && allowed('attendance.manage')) {
          const roster = state.roster, correction = roster.correction, student = correction.student;
          const input = { classId: roster.data.classId, expectedVersion: student.attendanceVersion, status: correction.draft.status, note: correction.draft.note.trim(), reason: correction.draft.reason.trim() };
          if (!Number.isSafeInteger(input.expectedVersion) || !attendanceLabels[input.status] || !input.reason || input.note.length > 500 || input.reason.length > 500) throw Error('请选择更正后的考勤状态，并填写不超过500字的更正原因。');
          prepare('核对考勤更正', `attendance.correction:${student.id}`, input, [['学生',student.name],['班级',roster.cls.name],['原状态',attendanceLabels[student.attendanceStatus] || '未知'],['更正后状态',attendanceLabels[input.status]],['原备注',student.attendanceNote || '无'],['更正后备注',input.note || '无'],['原因',input.reason],['课消调整','保留原记录并由服务端原子冲正、重算；以服务端回执金额为准。']], (body,key)=>academic.sessions.correctAttendance(roster.session.id,student.id,body,key), async receipt => { state.notice = `考勤更正已保存，服务端课消金额 ${receipt.consumptionAmount} 元。`; await loadRoster(roster.session.id,roster.cls.id); }, { student, sessionId:roster.session.id });
        }
      } catch (error) { state.error = fail(error); paint(); }
    }
    async function action(target) {
      const action = target.dataset.jaAction;
      if (state.review?.busy || state.review?.uncertain && action !== 'commit') return;
      if (state.edit?.lessonDialog && action !== 'cancel-lesson') return;
      state.error = '';
      try {
        if(action==='resource-schedule') { await openResourceSchedule(target.dataset.kind);return; }
        if(action==='resource-schedule-page') { await loadResourceSchedule(Number(target.dataset.page));return; }
        if(action==='close-resource-schedule') { closeResourceSchedule();return; }
        if(action==='export-attendance' && allowed('attendance.read')) { await exportClasses('attendance');return; }
        if(action==='export-attendance-students'&&allowed('class.read')&&allowed('attendance.read')){await exportAllStudentAttendance();return;}
        if(action==='export-students'&&allowed('student.read')){await exportStudents();return;}
        if(action==='export-classes') { await exportClasses();return; }
        if(action==='class-detail' && allowed('class.read')) { state.notice='';await loadClassDetail(target.dataset.id);return; }
        if(action==='refresh-class-detail' && state.classDetail) { await loadClassDetail(state.classDetail.id);return; }
        if(action==='close-class-detail') { state.classDetail=null;await load();return; }
        if(action==='class-detail-tab' && state.classDetail && ['lessons','students'].includes(target.dataset.tab)) { if(target.dataset.tab==='students' && !allowed('student.read'))return;state.classDetail.tab=target.dataset.tab;if(target.dataset.tab==='students')await loadClassStudents(1);paint();return; }
        if(action==='class-membership' && state.classDetail && ['active','history'].includes(target.dataset.membership)) { state.classDetail.membership=target.dataset.membership;await loadClassStudents(1);return; }
        if(action==='export-class-students') { await exportClassStudents();return; }
        if(action==='class-student-page' && state.classDetail) { await loadClassStudents(Number(target.dataset.page));return; }
        if (action === 'refresh') { clearPanels(); await load(); return; }
        if (action === 'retry-options') { await loadOptions(state.edit?.type === 'class' ? state.edit.draft.campusId : ''); paint(); return; }
        if(action==='attendance-view'&&state.page==='attendance'&&['classes','students'].includes(target.dataset.view)) {
          if(target.dataset.view==='students')state.query={...state.query,attendanceView:'students',courseType:'onsite'};
          else state.query={...state.query,attendanceView:'classes',format:target.dataset.format,courseType:'onsite'};
          state.number=1;await load();return;
        }
        if(action==='attendance-format' && state.page==='attendance' && ['','group','one_to_one','one_to_many'].includes(target.dataset.format)) { state.query={...state.query,attendanceView:'classes',format:target.dataset.format,courseType:target.dataset.format ? 'onsite' : ''};state.number=1;await load();return; }
        if (action === 'class-format' && state.page==='classes' && ['','group','one_to_one','one_to_many'].includes(target.dataset.format)) { state.query={...state.query,format:target.dataset.format};state.number=1;await load();return; }
        if (action === 'course-format' && courseFormats[target.dataset.format]) { state.query = { ...state.query, format: target.dataset.format }; state.number = 1; await load(); return; }
        if (action === 'course-all') { state.query = { ...state.query, format: '' }; state.number = 1; await load(); return; }
        if (action === 'page') { state.number = Number(target.dataset.page); await load(); return; }
        if (action === 'cancel-edit') state.edit = null;
        else if (action === 'review-back') state.review = null;
        else if (action === 'commit') { await commit(); return; }
        else if (action === 'class-previous' && state.edit?.type === 'class' && state.edit.step > 1) state.edit.step--;
        else if (action === 'course-previous' && state.edit?.type === 'course') state.edit.step = 1;
        else if (action === 'create-course' && allowed('course.write') && state.options) { state.notice = ''; state.edit = { type: 'course', step: 1, draft: { year: today().slice(0,4), term: '', classType: '', courseKind: 'long_term', format: state.query.format || 'face', name: '', courseType: target.dataset.type === 'live' ? 'live' : 'onsite', campusId: identity.scope === 'all' ? '' : state.options.campuses?.[0]?.id || '', grade: '', subject: '', price: '0.00', lessons: [] } }; }
        else if (action === 'edit-course' && allowed('course.write')) {
          const row = items(state.data).find(item => item.id === target.dataset.id);
          if (row && courseWritable(row) && row.version) state.edit = { type:'course', step:1, row, draft:{ ...row, ...row.metadata, year:row.metadata?.year || '', term:row.metadata?.term || '', classType:row.metadata?.classType || '', lessons:row.lessons.map(lesson=>({...lesson})) } };
        }
        else if (action === 'add-lesson'  && state.edit?.type === 'course' && state.edit.draft.lessons.length < 200) state.edit.lessonDialog = { index: null, title: '' };
        else if (action === 'edit-lesson' && state.edit?.type === 'course') {
          const index = Number(target.dataset.index);
          if (Number.isInteger(index) && state.edit.draft.lessons[index]) state.edit.lessonDialog = { index, title: state.edit.draft.lessons[index].title };
        }
        else if (action === 'cancel-lesson') closeLessonDialog();
        else if (action === 'remove-lesson' && state.edit?.type === 'course' && Number.isInteger(Number(target.dataset.index)) && state.edit.draft.lessons[Number(target.dataset.index)] && (!state.edit.row || Number(target.dataset.index) === state.edit.draft.lessons.length - 1 && state.edit.draft.lessons.length > 1)) state.edit.draft.lessons.splice(Number(target.dataset.index), 1);
        else if (action === 'course-status' && allowed('course.write')) {
          const row = items(state.data).find(item => item.id === target.dataset.id);
          if (row && courseWritable(row) && typeof row.active === 'boolean' && row.version) {
            const input = { active: !row.active, expectedVersion: row.version };
            prepare(input.active ? '启用课程' : '停用课程', 'course.status:' + row.id, input,
              [['课程', row.name], ['状态', input.active ? '启用' : '已停用'], ['版本', row.version]],
              (body,key) => academic.courses.setStatus(row.id,body,key));
          }
        }
        else if (action === 'course-class') { const course = items(state.data).find(row => row.id === target.dataset.id); if (course) await startClass(course); }
        else if (action === 'pick-course' && allowed('class.write') && allowed('course.read')) { await loadPicker('course'); return; }
        else if (action === 'class-picker' && allowed('class.read')) { await loadPicker('class'); return; }
        else if (action === 'picker-page' && state.picker) { await loadPicker(state.picker.kind, Number(target.dataset.page)); return; }
        else if (action === 'cancel-picker') { if (state.picker?.kind === 'course') lessonReturnFocus = '[data-ja-action="pick-course"]'; state.picker = null; }
        else if (action === 'confirm-picked-course' && state.picker?.kind === 'course' && !state.picker.loading) { const selected = items(state.picker.data).find(row=>row.id===state.picker.selectedId); if (selected && selected.active !== false) await startClass(selected); }
        else if (action === 'pick-record' && state.picker) {
          const selected = items(state.picker.data).find(row => row.id === target.dataset.id);
          if (state.picker.kind === 'course') { if (selected && selected.active !== false) state.picker.selectedId = selected.id; }
          else if (selected) { state.selectedStudents.clear();state.query = { classId: selected.id, className: selected.name }; state.picker = null; state.number = 1; await load(); return; }
        } else if (action === 'student-all') { state.selectedStudents.clear();state.query = {}; state.number = 1; state.picker = null; await load(); return; }
        else if(action==='start-batch-transfer'){await startBatchTransfer();return;}
        else if(action==='cancel-batch-transfer'){state.transferDraft=null;state.error='';}
        else if (action === 'edit-class' && allowed('class.write') && state.options) {
          const row = state.classDetail?.data?.info?.id===target.dataset.id ? state.classDetail.data.info : items(state.data).find(item=>item.id===target.dataset.id);
          if (row) state.edit = { type: 'class-update', row, draft: { name: row.name, room: row.room, teacherId: row.teacherId, capacity: String(row.capacity) } };
        } else if (action === 'generate-schedule' && state.edit?.type === 'class') generateSchedule();
        else if (action === 'add-holiday' && state.edit?.type === 'class') {
          const d = state.edit.draft; instant(`${d.holidayDate}T00:00`);
          if (!d.holidays.includes(d.holidayDate)) d.holidays.push(d.holidayDate); d.holidays.sort(); d.holidayDate = '';
        } else if (action === 'remove-holiday' && state.edit?.type === 'class') state.edit.draft.holidays = state.edit.draft.holidays.filter(day => day !== target.dataset.date);
        else if (action === 'schedule-mode' && (state.page==='teacherCourses' ? ['time'] : ['time', 'teacher', 'room']).includes(target.dataset.mode)) state.mode = target.dataset.mode;
        else if (action === 'student-detail') { state.student = items(state.data).find(row => row.id === target.dataset.id); await studentClasses(); return; }
        else if (action === 'close-student') { state.student = null; state.classes = null; state.communication = null; }
        else if (action === 'student-class-page') { await studentClasses(Number(target.dataset.page)); return; }
        else if (action === 'communication-class') { await communicationClass(target.dataset.id); return; }
        else if (action === 'roster') { await loadRoster(target.dataset.id, target.dataset.class); return; }
        else if (action === 'close-roster') {
          const correction=state.roster?.correction;
          if(correction && (correction.draft.status!==correction.student.attendanceStatus || correction.draft.note!==(correction.student.attendanceNote || '') || correction.draft.reason)) throw Error('请先取消或提交考勤更正，再返回课表。');
          state.roster = null;
        }
        else if (action === 'edit-attendance' && state.roster && allowed('attendance.manage')) {
          const student=state.roster.data?.students.find(row=>row.id===target.dataset.id);
          if(student?.attendanceId && attendanceCorrectionOpen(student))state.roster.correction={student,draft:{status:student.attendanceStatus,note:student.attendanceNote || '',reason:''}};
        } else if (action === 'cancel-attendance-correction' && state.roster) state.roster.correction=null;
        else if (action === 'mark-attended' && state.roster && allowed('attendance.manage')) {
          for (const [id, row] of Object.entries(state.roster.draft)) if (row.selected && !state.roster.data.students.find(student => student.id === id)?.attendanceId) row.status = 'attended';
        } else if (action === 'move-session' && allowed('session.move')) {
          const cls = items(state.data).find(row => row.id === target.dataset.class), session = cls?.schedule.find(row => row.id === target.dataset.id);
          if (session?.version && new Date(session.startsAt).getTime() > Date.now()) { const [date, time] = localParts(session.startsAt); state.edit = { type: 'move', session, className: cls.name, draft: { date, time, reason: '' } }; }
        }
      } catch (error) { state.error = fail(error); }
      paint();
    }
    function bind() {
      const element = root.document.getElementById('java-academic-workspace');
      if (!element) return;
      const dialog = element.querySelector?.('[data-ja-dialog="lesson"]') || element.querySelector?.('[data-ja-dialog="course-picker"]');
      const resourceDialog=element.querySelector?.('[data-ja-dialog="resource-schedule"]');
      if(resourceDialog && !resourceDialog.open)resourceDialog.showModal();
      if (dialog && !dialog.open) { dialog.showModal(); if (state.picker?.selectedId) dialog.querySelector?.('input[type="radio"]:checked')?.focus?.(); }
      if (!dialog && lessonReturnFocus) { element.querySelector?.(lessonReturnFocus)?.focus?.(); lessonReturnFocus = ''; }
      if (bound.has(element)) return; bound.add(element);
      element.addEventListener('cancel', event => {
        if(event.target.dataset?.jaDialog==='resource-schedule') { event.preventDefault();closeResourceSchedule();return; }
        if (event.target.dataset?.jaDialog === 'course-picker') { event.preventDefault(); state.picker = null; lessonReturnFocus = '[data-ja-action="pick-course"]'; paint(); return; }
        if (event.target.dataset?.jaDialog !== 'lesson') return;
        event.preventDefault(); closeLessonDialog(); paint();
      }, true);
      element.addEventListener('click', event => {
        const target = event.target.closest('[data-ja-action]');
        if (!target || target.disabled) return;
        if(target.matches?.('input[type="checkbox"][data-ja-action="select-student"]')||target.type==='checkbox'&&target.dataset?.jaAction==='select-student')return;
        event.preventDefault();
        const form = target.closest('form'); if (form) capture(form);
        void action(target);
      });
      element.addEventListener('submit', event => {
        const form = event.target.closest('[data-ja-form]'); if (!form) return;
        event.preventDefault(); void submit(form);
      });
      for (const type of ['input', 'change']) element.addEventListener(type, event => {
        if(type==='change'&&event.target.matches?.('input[type="checkbox"][data-ja-action="select-student"]')) {
          const row=items(state.data).find(student=>student.id===event.target.dataset.id);
          if(row&&state.page==='students'&&allowed('student.read')&&allowed('enrollment.manage')) {
            if(event.target.checked)state.selectedStudents.set(row.id,row);else state.selectedStudents.delete(row.id);
            paint();
          }
          return;
        }
        const form = event.target.closest('[data-ja-form]'); if (form && form.dataset.jaForm !== 'filters') capture(form);
        if(type==='change' && state.page==='classes' && form?.dataset.jaForm==='filters' && ['phase','onlyOpen'].includes(event.target.name)) {
          const fields=capture(form);state.query={...fields,format:state.query.format};
          if(event.target.name==='phase' && fields.phase)state.query.onlyOpen='';
          if(event.target.name==='onlyOpen' && fields.onlyOpen)state.query.phase='';
          paint();return;
        }
        if (type === 'change' && event.target.name === 'courseRefundRule' && state.edit?.type === 'class') paint();
        if (type === 'change' && event.target.name === 'courseType' && state.edit?.type === 'course') paint();
        if (type === 'change' && event.target.name === 'campusId' && state.edit?.type === 'class' && !state.edit.course.campusId) {
          const edit = state.edit;
          void loadOptions(edit.draft.campusId).then(() => {
            if (state.edit !== edit || state.closed) return;
            if (mayAssignTeacher(false) && !state.options?.teachers?.some(row => row.id === edit.draft.teacherId)) edit.draft.teacherId = '';
            paint();
          });
        }
      });
    }
    function dispose() { ++epoch; ++optionsEpoch; state.closed = true; clearPanels(); keys.clear(); }
    return Object.freeze({ open, html, bind, canLeave, dispose });
  }
  root.siyueJavaAcademic = Object.freeze({ pages, create });
})(typeof window === 'object' ? window : globalThis);
