const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'business-form-builder.js'), 'utf8');

function harness(initial = {}) {
  let draft = structuredClone(initial);
  const calls = [];
  const context = {
    operation: { id: 'form.create' }, draft,
    data: { campuses: [{ id: 'campus-a', name: '东城校区' }], forms: [] },
    disabled: false
  };
  const businessAPI = {
    academicDraft() { return { ...context, draft: structuredClone(draft) }; },
    input(path, value) { write(path, value); return true; },
    change(path, value) { write(path, value); return true; },
    academicSet(path, value) {
      calls.push({ path: structuredClone(path), value: structuredClone(value) });
      if (!path.length) draft = structuredClone(value);
      else {
        let target = draft;
        for (const key of path.slice(0, -1)) target = target[key] ||= {};
        target[path.at(-1)] = structuredClone(value);
      }
      context.draft = draft;
      return true;
    }
  };
  function write(path, value) {
    let target = draft;
    for (const key of path.slice(0, -1)) target = target[key] ||= {};
    target[path.at(-1)] = value;
    context.draft = draft;
  }
  const window = { businessAPI, document: { querySelector: () => null, querySelectorAll: () => [] } };
  const sandbox = { window, businessAPI, Date, Math, JSON, String, Set, Object, Array };
  vm.runInNewContext(source, sandbox);
  sandbox.SiyueBusinessFormBuilder = window.SiyueBusinessFormBuilder;
  return { api: window.SiyueBusinessFormBuilder, businessAPI, context, calls, window, run: code => vm.runInNewContext(code, sandbox), sandbox, get draft() { return draft; }, set draft(value) { draft = structuredClone(value); context.draft = draft; } };
}

function decode(value) {
  return String(value || '').replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g, token => ({ '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' })[token]);
}

function renderedInput(html, path) {
  for (const match of html.matchAll(/<input\b([^>]*)>/g)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(row => [row[1], decode(row[2]) ]));
    if (attrs['data-business-path'] === JSON.stringify(path)) return attrs;
  }
  assert.fail(`rendered input path ${JSON.stringify(path)}`);
}

test('only create/update render and create initializes schema-safe lead defaults', () => {
  const h = harness();
  const beforeRender = h.calls.length;
  h.api.render({ operation: h.context.operation, draft: h.draft, data: h.context.data });
  assert.equal(h.calls.length, beforeRender);
  assert.equal(h.api.render({ operation: { id: 'lead.create' }, draft: {}, data: {} }), null);
  h.api.initialize({ operation: h.context.operation, draft: h.draft, data: h.context.data });
  const html = h.api.render({ operation: h.context.operation, draft: h.draft, data: h.context.data });
  assert.match(html, /sfb-palette/);
  assert.match(html, /公开填写预览/);
  assert.match(html, /字段设置|基本信息/);
  assert.equal(h.draft.kind, 'custom');
  assert.equal(h.draft.collectLead, false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.draft.fields.map(f => [f.type, f.required]))), [['name', true], ['phone', true], ['textarea', false]]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.draft.settings)), { quantity: 1000, maxPerIdentity: 1, source: '表单获客' });
  assert.equal(Object.hasOwn(h.draft, 'description'), false);
});

test('survey never collects leads and lead kind restores each missing identity field', () => {
  const h = harness({ kind: 'survey', collectLead: true, fields: [{ id: 'x', type: 'text', title: '称呼' }] });
  h.api.initialize({ operation: h.context.operation, draft: h.draft, data: h.context.data });
  h.api.render({ operation: h.context.operation, draft: h.draft, data: h.context.data });
  assert.equal(h.draft.collectLead, false); // Survey never collects sales leads.
  h.api.setMeta('collectLead', true);
  assert.equal(h.draft.collectLead, false);
  h.api.setKind('lead');
  const types = h.draft.fields.map(field => field.type);
  assert.ok(types.includes('name'));
  assert.ok(types.includes('phone'));
  h.api.setKind('survey');
  assert.equal(h.draft.collectLead, false);
});

test('update is seeded from the authorized form row with version and preserves stable field ids', () => {
  const h = harness({ formId: 'form-1' });
  h.context.operation = { id: 'form.update' };
  h.context.data.forms = [{ id: 'form-1', version: 7, title: '家长登记', kind: 'lead', collectLead: true, campusId: 'campus-a', fields: [{ id: 'keep-id', type: 'name', title: '姓名', required: true }], settings: { quantity: 40, maxPerIdentity: 2, source: '线下活动' } }];
  h.api.initialize({ operation: h.context.operation, draft: h.draft, data: h.context.data });
  h.api.render({ operation: h.context.operation, draft: h.draft, data: h.context.data });
  assert.equal(h.draft.expectedVersion, 7);
  assert.equal(h.draft.patch.title, '家长登记');
  assert.equal(h.draft.patch.fields[0].id, 'keep-id');
  assert.ok(h.calls.some(call => call.path.length === 0 && call.value.patch.fields[0].id === 'keep-id'));
  h.api.select('keep-id');
  const rendered = h.api.render({ operation: h.context.operation, draft: h.draft, data: h.context.data });
  assert.equal(renderedInput(rendered, ['patch', 'fields', 0, 'title']).value, '姓名');
});

test('field editing, choices, reorder and deletion use business draft mutations', () => {
  const h = harness({ kind: 'lead', collectLead: true, fields: [{ id: 'a', type: 'single', title: '年级', required: true, options: ['一', '二'] }, { id: 'b', type: 'text', title: '备注', required: false }], settings: { quantity: 20, maxPerIdentity: 1, source: '表单获客' } });
  h.api.setField('a', 'title', '年级选择');
  h.api.setOption('a', 0, '三年级');
  h.api.addOption('a');
  h.api.moveField('b', -1);
  assert.deepEqual(h.draft.fields.map(field => field.id), ['b', 'a']);
  assert.equal(h.draft.fields[1].title, '年级选择');
  assert.deepEqual(h.draft.fields[1].options, ['三年级', '二', '新选项']);
  const added = h.api.addField('date');
  assert.equal(added, true);
  const newField = h.draft.fields.at(-1);
  assert.match(newField.id, /^field-/);
  assert.equal(newField.type, 'date');
  h.api.removeOption('a', 1);
  h.api.removeField(newField.id);
  assert.equal(h.draft.fields.some(field => field.id === newField.id), false);
  assert.ok(h.calls.every(call => call.path.length === 0 || call.path[0] === 'fields'));
});

test('selecting preview fields replaces the right properties panel with the selected field editor', () => {
  const h = harness({ kind: 'lead', collectLead: true, fields: [
    { id: 'name-field', type: 'name', title: '学生姓名', required: true },
    { id: 'need-field', type: 'textarea', title: '课程诉求', required: false }
  ], settings: { quantity: 20, maxPerIdentity: 1, source: '表单获客' } });
  const buttons = ['name-field', 'need-field'].map(id => ({
    id,
    selected: false,
    getAttribute(name) { return name === 'data-field' ? id : null; },
    classList: { toggle(_name, selected) { this.owner.selected = selected; }, owner: null }
  }));
  for (const button of buttons) button.classList.owner = button;
  const panel = { outerHTML: '<section class="sfb-panel sfb-properties">表单设置</section>' };
  h.window.document = {
    querySelectorAll(selector) { return selector === '.sfb-preview-field' ? buttons : []; },
    querySelector(selector) { return selector === '.sfb-properties' ? panel : null; }
  };

  assert.equal(h.api.select('name-field'), true);
  assert.match(panel.outerHTML, /学生姓名/);
  assert.match(panel.outerHTML, /\[&quot;fields&quot;,0,&quot;title&quot;\]/);
  assert.equal(buttons[0].selected, true);
  assert.equal(buttons[1].selected, false);

  assert.equal(h.api.select('need-field'), true);
  assert.match(panel.outerHTML, /课程诉求/);
  assert.match(panel.outerHTML, /\[&quot;fields&quot;,1,&quot;title&quot;\]/);
  assert.equal(buttons[0].selected, false);
  assert.equal(buttons[1].selected, true);
});

test('text controls use businessAPI input paths so typing before blur updates draft without redrawing', () => {
  const h = harness({ kind: 'lead', collectLead: true, fields: [{ id: 'stable-field', type: 'text', title: '初始标题', required: false }], settings: { quantity: 20, maxPerIdentity: 1, source: '表单获客' } });
  h.api.select('stable-field');
  const html = h.api.render({ operation: h.context.operation, draft: h.draft, data: h.context.data });
  const attr = renderedInput(html, ['fields', 0, 'title']);
  assert.match(attr.oninput, /businessAPI\.input/);
  h.api.reset();
  const baseHtml = h.api.render({ operation: h.context.operation, draft: h.draft, data: h.context.data });
  assert.match(baseHtml, /data-business-path="\[&quot;settings&quot;,&quot;quantity&quot;\]"/);
  const previewHtml = html;
  const callsBefore = h.calls.length;
  const control = { value: '未失焦的新标题' };
  const previewLabel = { textContent: '初始标题' };
  const previewField = { querySelector: selector => selector === '.sfb-preview-label' ? previewLabel : null };
  h.window.document = {
    querySelector: selector => selector === '.sfb-preview-field[data-field-index="0"]' ? previewField : null,
    querySelectorAll: () => [], createElement: () => ({})
  };
  h.sandbox.inputControl = control;
  h.run(`(function(){${attr.oninput}}).call(inputControl)`);
  assert.equal(h.draft.fields[0].title, '未失焦的新标题');
  assert.equal(previewLabel.textContent, '未失焦的新标题');
  assert.equal(h.calls.length, callsBefore);
  assert.equal(previewHtml.includes('检查并预览'), false); // Builder leaves the host preview controls outside its returned HTML.
  assert.equal(h.api.render({ operation: h.context.operation, draft: h.draft, data: h.context.data }).includes('未失焦的新标题'), true);
});

test('markup escapes untrusted content, disabled mode blocks edits, reset only clears selection', () => {
  const h = harness({ kind: 'survey', collectLead: false, title: '<img src=x>', fields: [{ id: 'f1', type: 'dropdown', title: '年级 <script>', required: true, options: ['<b>坏选项</b>', '正常'] }], settings: {} });
  let html = h.api.render({ operation: h.context.operation, draft: h.draft, data: h.context.data });
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;b&gt;坏选项&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /问卷审核通过后仅发布答案/);
  const before = h.calls.length;
  h.context.disabled = true;
  html = h.api.render({ operation: h.context.operation, draft: h.draft, data: h.context.data, disabled: true });
  assert.match(html, /disabled/);
  assert.equal(h.api.setField('f1', 'title', '修改'), false);
  assert.equal(h.calls.length, before);
  h.context.disabled = false;
  h.api.select('f1');
  h.api.reset();
  assert.equal(h.calls.length, before);
  assert.doesNotMatch(h.api.render({ operation: h.context.operation, draft: h.draft, data: h.context.data }), /删除字段/);
  assert.doesNotMatch(source, /localStorage|offline/i);
});
