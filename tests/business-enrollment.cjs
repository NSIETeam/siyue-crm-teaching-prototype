'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const academicOperations = require('../backend/src/business-academic.cjs').operations;

const source = fs.readFileSync(path.join(__dirname, '..', 'business-enrollment.js'), 'utf8');
const classes = [
  { id: 'class-a', name: '数学一班', courseId: 'course-a', campusId: 'campus-a', teacherId: 'teacher-a', capacity: 20, schedule: [{ date: '2099-01-02', time: '09:00–10:00' }] },
  { id: 'class-inactive', name: '停用班', courseId: 'course-a', active: false }
];
const data = {
  classes, courses: [{ id: 'course-a', name: '四年级数学', grade: '小学四年级', subject: '数学', priceCents: 120050 }],
  campuses: [{ id: 'campus-a', name: '东城校区' }], directory: [{ id: 'teacher-a', name: '王老师' }],
  students: [{ id: 'student-a', name: '学生甲', phone: '13800000001', grade: '小学四年级' }],
  activities: { coupon: [{ id: 'coupon-a', name: '春季优惠', published: true, status: '进行中' }] }
};

function harness(operationId = 'enrollment.create', draft = {}) {
  let state = structuredClone(draft);
  const writes = [], redraws = [], opened = [];
  const context = { operation: { id: operationId }, draft: state, data, disabled: false };
  function setPath(path, value) {
    if (!path.length) state = structuredClone(value);
    else {
      let current = state;
      for (const key of path.slice(0, -1)) current = current[key] ||= typeof path.at(-1) === 'number' ? [] : {};
      current[path.at(-1)] = structuredClone(value);
    }
    context.draft = state;
  }
  const businessAPI = {
    academicDraft() { return { ...context, draft: structuredClone(state) }; },
    academicSet(path, value) { writes.push({ path: structuredClone(path), value: structuredClone(value) }); setPath(path, value); return true; },
    input(path, value) { setPath(path, value); return true; },
    change(path, value) { setPath(path, value); redraws.push(path); return true; },
    studentMode(parent, creating) {
      const current = structuredClone(state), row = parent.length ? parent.reduce((v, key) => v?.[key], current) : current;
      if (creating) { delete row.studentId; row.studentDraft ||= { name: '', phone: '' }; }
      else delete row.studentDraft;
      setPath([], current); return true;
    },
    add(path) { const current = structuredClone(state), rows = path.reduce((v, key) => v[key], current); rows.push({}); setPath([], current); return true; },
    remove(path, index) { const rows = path.reduce((v, key) => v[key], state); rows.splice(index, 1); return true; },
    catalog() { return [{ id: 'enrollment.create', implemented: true }, { id: 'enrollment.batchCreate', implemented: true }]; },
    open(id) { opened.push(id); return true; },
    redraw() { redraws.push('redraw'); }
  };
  const window = { businessAPI, document: { querySelectorAll: () => [], querySelector: () => null } };
  window.SiyueAcademicDictionary = require('../academic-dictionary.js');
  const sandbox = { window, businessAPI, Date, Math, JSON, String, Set, Object, Array };
  vm.runInNewContext(source, sandbox);
  sandbox.SiyueBusinessEnrollment = window.SiyueBusinessEnrollment;
  return { api: window.SiyueBusinessEnrollment, businessAPI, context, writes, redraws, opened, sandbox, get draft() { return state; }, set draft(value) { state = structuredClone(value); context.draft = state; } };
}

function decode(value) {
  return String(value || '').replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g, token => ({ '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' })[token]);
}
function inputAttrs(html, path) {
  for (const match of html.matchAll(/<(?:input|select)\b([^>]*)>/g)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(row => [row[1], decode(row[2])]));
    if (attrs['data-business-path'] === JSON.stringify(path)) return attrs;
  }
  assert.fail(`input path ${JSON.stringify(path)} missing`);
}

test('single enrollment keeps the three server-backed steps, existing/new choice, and valid schema fields', () => {
  const h = harness('enrollment.create', { classId: 'class-a', studentId: 'student-a', couponId: 'coupon-a' });
  const html = h.api.renderForm({ ...h.context, draft: h.draft });
  assert.match(html, /^<div class="enrollment-form/);
  assert.doesNotMatch(html, /^<div class="card pad/);
  assert.match(html, /学生信息/);
  assert.match(html, /报名信息/);
  assert.match(html, /费用结算/);
  assert.match(html, /选择已有学生/);
  assert.match(html, /登记新学生/);
  assert.match(html, /data-business-path="\[&quot;studentId&quot;\]"/);
  assert.match(html, /data-business-path="\[&quot;classId&quot;\]"/);
  assert.match(html, /四年级数学/);
  assert.match(html, /¥1200\.50/);
  assert.match(html, /待预览金额/);
  assert.match(html, /class="steps"/);
  assert.match(html, /class="step active"/);
  assert.match(html, /class="field"/);
  assert.match(html, /class="form-grid"/);
  assert.match(html, /class="table enrollment-student-table"/);
  assert.match(html, /搜索姓名、手机号或年级/);
  assert.doesNotMatch(html, /class="[^"]*be-/);
  assert.doesNotMatch(html, /服务端|外层|支付方式|实收金额|finishEnroll|workflowPersist/);
  assert.equal(h.writes.length, 0, 'renderForm must not mutate drafts');
});

test('new-student text input writes directly to standard business input path before blur', () => {
  const h = harness('enrollment.create', { classId: 'class-a', studentDraft: { name: '', phone: '' } });
  const html = h.api.renderForm({ ...h.context, draft: h.draft });
  const name = inputAttrs(html, ['studentDraft', 'name']);
  const phone = inputAttrs(html, ['studentDraft', 'phone']);
  assert.match(name.oninput, /businessAPI\.input/);
  assert.match(phone.oninput, /businessAPI\.input/);
  h.sandbox.inputControl = { value: '新生乙' };
  h.sandbox.phoneControl = { value: '13900000002' };
  vm.runInNewContext(`(function(){${name.oninput}}).call(inputControl)`, h.sandbox);
  vm.runInNewContext(`(function(){${phone.oninput}}).call(phoneControl)`, h.sandbox);
  assert.equal(h.draft.studentDraft.name, '新生乙');
  assert.equal(h.draft.studentDraft.phone, '13900000002');
  assert.deepEqual(Array.from(h.api.singleIssues(h.draft, h.context)), []);
});

test('batch enrollment reuses editable correction-row layout and allows only one shared target class', () => {
  const h = harness('enrollment.batchCreate', { classId: 'class-a', rows: [
    { studentId: 'student-a' }, { studentDraft: { name: '新生丙', phone: 'bad' } }
  ] });
  const html = h.api.renderForm({ ...h.context, draft: h.draft });
  assert.match(html, /enrollment-batch-row/);
  assert.match(html, /学生 1/);
  assert.match(html, /学生 2/);
  assert.match(html, /本批重复|手机号/);
  assert.match(html, /移出本批/);
  assert.match(html, /添加学生/);
  assert.match(html, /data-business-path="\[&quot;classId&quot;\]"/);
  assert.equal((html.match(/data-business-path="\[&quot;classId&quot;\]"/g) || []).length, 1);
  assert.match(html, /data-business-path="\[&quot;rows&quot;,0,&quot;studentId&quot;\]"/);
  assert.match(html, /data-business-path="\[&quot;rows&quot;,1,&quot;studentDraft&quot;,&quot;phone&quot;\]"/);
  assert.doesNotMatch(html, /targetClassId|rows",0,"classId|batchCommit|batchEnrollmentPlan/);
  assert.ok(h.api.rowIssues(h.draft.rows[1], h.context, 1).some(issue => issue.includes('有效手机号')));
});

test('batch duplicate validation normalizes full-width numbers, country codes, spacing and duplicate student IDs', () => {
  const h = harness('enrollment.batchCreate', { classId: 'class-a', rows: [
    { studentDraft: { name: ' 张同学 ', phone: '+86 １３９-００００-０００１' } },
    { studentDraft: { name: '张同学', phone: '139 0000 0001' } },
    { studentId: 'student-a' }, { studentId: 'student-a' }
  ] });
  assert.ok(h.api.rowIssues(h.draft.rows[0], h.context, 0).some(issue => issue.includes('本批重复')));
  assert.ok(h.api.rowIssues(h.draft.rows[1], h.context, 1).some(issue => issue.includes('本批重复')));
  assert.ok(h.api.rowIssues(h.draft.rows[2], h.context, 2).some(issue => issue.includes('本批重复')));
  assert.ok(h.api.rowIssues(h.draft.rows[3], h.context, 3).some(issue => issue.includes('本批重复')));
  assert.ok(h.api.rowIssues({ studentDraft: { name: '学生甲', phone: '+86 １３８ ００００ ０００１' } }, h.context, -1).some(issue => issue.includes('档案已存在')));
});

test('new-student form exposes only schema-supported grade and campus choices while preserving hidden lead attribution', () => {
  const h = harness('enrollment.create', { classId: 'class-a', studentDraft: { name: '新生', phone: '13900000002', originLeadId: 'lead-1' } });
  h.context.data = { ...data, campuses: [...data.campuses, { id: 'campus-b', name: '西城校区', active: false }] };
  const html = h.api.renderForm({ ...h.context, draft: h.draft });
  assert.match(html, /<option value="小学一年级"/);
  assert.match(html, /<option value="小学六年级"/);
  assert.match(html, /所属校区/);
  assert.match(html, /value="campus-a"/);
  assert.doesNotMatch(html, /value="campus-b"/);
  const schema = academicOperations.find(op => op.id === 'enrollment.create').inputSchema.properties.studentDraft.properties;
  for (const key of Object.keys(schema)) {
    if (key === 'originLeadId') assert.match(html, new RegExp(`data-business-path=".*${key}`));
    else assert.match(html, new RegExp(`data-business-path=".*${key}`));
  }
  assert.match(html, /data-business-path="\[&quot;studentDraft&quot;,&quot;originLeadId&quot;\]"/);
  assert.doesNotMatch(html, /data-business-path=".*guardian/);
});

test('existing student search filters rows while keeping the selected student visible', () => {
  const h = harness('enrollment.create', { classId: 'class-a', studentId: 'student-a' });
  const matching = { hidden: false, getAttribute: () => '王同学 13900000003 小学二年级', hasAttribute: () => false };
  const selected = { hidden: false, getAttribute: () => '学生甲 13800000001 小学四年级', hasAttribute: () => true };
  const picker = { querySelectorAll: () => [matching, selected] };
  const control = { value: '王同学', closest: () => picker, getAttribute: () => "SiyueBusinessEnrollment.filterStudents(this,'single')" };
  assert.equal(h.api.filterStudents(control), true);
  assert.equal(matching.hidden, false);
  assert.equal(selected.hidden, false);
});

test('batch initialization seeds one correctable new-student row and row edits stay in business draft', () => {
  const h = harness('enrollment.batchCreate', { classId: '' });
  h.api.initialize({ ...h.context, draft: h.draft });
  assert.deepEqual(JSON.parse(JSON.stringify(h.draft.rows)), [{ studentDraft: { name: '', phone: '' } }]);
  assert.equal(h.writes.length, 1);
  h.api.addRow();
  assert.equal(h.draft.rows.length, 2);
  h.api.removeRow(0);
  assert.equal(h.draft.rows.length, 1);
  assert.equal(h.api.removeRow(8), false);
  assert.ok(!/localStorage|finishEnroll|workflowPersist|batchCommit|batchExecute/.test(source));
});

test('batch initialization converts existing studentIds into editable rows without losing selections', () => {
  const h = harness('enrollment.batchCreate', { classId: 'class-a', studentIds: ['student-a', 'student-b'], couponId: 'coupon-a' });
  h.context.data = { ...data, students: [...data.students, { id: 'student-b', name: '学生乙', phone: '13900000003', grade: '小学二年级' }] };
  h.api.initialize({ ...h.context, draft: h.draft });
  assert.deepEqual(JSON.parse(JSON.stringify(h.draft.rows)), [{ studentId: 'student-a' }, { studentId: 'student-b' }]);
  assert.equal(h.draft.studentIds, undefined);
  assert.equal(h.draft.couponId, 'coupon-a');
  const html = h.api.renderForm({ ...h.context, draft: h.draft });
  assert.match(html, /value="student-a"[^>]*checked/);
  assert.match(html, /value="student-b"[^>]*checked/);
});

test('entry page uses the same underline tabs and hides operations absent from authorized catalog', () => {
  const h = harness();
  const html = h.api.renderPage({ page: 'enroll', data });
  assert.match(html, /class="tabs"/);
  assert.match(html, /class="tab active"/);
  assert.match(html, /单个报名/);
  assert.match(html, /批量报名/);
  h.api.renderPage({ page: 'enroll', data });
  h.businessAPI.catalog = () => [{ id: 'enrollment.create', implemented: true }];
  const restricted = h.api.renderPage({ page: 'enroll', data });
  assert.match(restricted, /单个报名/);
  assert.doesNotMatch(restricted, /批量报名/);
  const byPermission = h.api.renderPage({ page: 'enroll', data, permitted: id => id === 'enrollment.create' });
  assert.match(byPermission, /单个报名/);
  assert.doesNotMatch(byPermission, /批量报名/);
  h.businessAPI.catalog = () => [{ id: 'enrollment.create', implemented: true }, { id: 'enrollment.batchCreate', implemented: true }];
  const tabs = h.api.renderTabs({ operation: { id: 'enrollment.batchCreate' }, permitted: id => id === 'enrollment.batchCreate' });
  assert.match(tabs, /class="tabs enrollment-entry-tabs"/);
  assert.match(tabs, /class="tab active"/);
  assert.match(tabs, /批量报名/);
  assert.doesNotMatch(tabs, /单个报名/);
  assert.equal(h.api.renderTabs({ permitted: () => false }), '');
  assert.equal(h.api.renderPage({ page: 'students', data }), null);
});

test('disabled contexts disable changes and module reset clears only step navigation', () => {
  const h = harness('enrollment.create', { studentDraft: { name: '', phone: '' } });
  let html = h.api.renderForm({ ...h.context, disabled: true, draft: h.draft });
  assert.match(html, /disabled/);
  assert.equal(h.api.goTo(3), true);
  h.api.reset();
  assert.equal(h.api.goTo(4), false);
  html = h.api.renderForm({ ...h.context, draft: h.draft });
  assert.match(html, /费用结算/);
});
