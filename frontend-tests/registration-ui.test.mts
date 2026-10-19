import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import crmContract from '../backend/src/business-crm.cjs';
import businessStore from '../backend/src/business-store.cjs';

const source = (file: string) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const decode = (text: string) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const clone = (value: any) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));
const operation = (id: string, permission: string, properties: any, required: string[]) => ({ id, label: id, permission, execution: 'server', inputSchema: { type: 'object', properties, required, additionalProperties: false } });
const string = { type: 'string' };
const leadOperation = operation('lead.followup', 'lead.follow', { leadId: string, note: string, nextFollowAt: string, channel: { type: 'string', enum: ['电话', '线上会议', '现场沟通'] } }, ['leadId', 'note', 'channel']);
const opportunityOperation = operation('opportunity.create', 'opportunity.write', { customerId: string, leadId: string, subject: string, term: string, note: string }, ['customerId']);
const customerOperation = operation('customer.fromLead', 'customer.write', { leadId: string }, ['leadId']);
const opportunityFollowupOperation = operation('opportunity.followup', 'lead.follow', { opportunityId: string, note: string, nextFollowAt: string, expectedVersion: { type: 'integer' }, channel: { type: 'string', enum: ['phone', 'wechat', 'visit', 'online', 'other'] } }, ['opportunityId', 'note', 'channel']);
const opportunityAdvanceOperation = operation('opportunity.advance', 'lead.follow', { opportunityId: string, stage: { type: 'string', enum: ['qualified', 'appointment', 'trial', 'negotiation', 'closed'] }, reason: string, nextFollowAt: string, expectedVersion: { type: 'integer' } }, ['opportunityId', 'stage']);
const opportunity = (id: string, extra: any = {}) => ({ id, title: '商机' + id, customerId: 'CUSTOMER_' + id, leadId: 'LEAD_' + id, subject: '数学', term: '秋季', ownerId: 'sales-1', campusId: 'campus-1', stage: 'qualified', status: 'active', nextFollowAt: '2026-11-02T01:00:37.926Z', version: 7, allowedOperationIds: ['opportunity.followup', 'opportunity.advance'], history: [{ kind: '商机跟进', at: '2026-10-14T00:00:00Z', actor: '陈顾问', detail: { note: '商机历史沟通', channel: 'phone' } }], ...extra });
const lead = (id: string, extra: any = {}) => ({ id, name: '客户' + id, phone: '13800000000', customerId: 'CUSTOMER_' + id, subject: '数学', term: '秋季', grade: '六年级', source: '秋季咨询', ownerId: 'sales-1', stage: '跟进中', nextFollowAt: '2026-10-20T01:00:00Z', version: 1, allowedOperationIds: ['lead.followup'], history: [{ kind: '跟进', at: '2026-10-13T01:00:00Z', actor: '陈顾问', detail: { note: '原有沟通记录', channel: '现场沟通', nextFollowAt: '2026-10-20T01:00:00Z' } }], ...extra });

// Runs the real authenticated v1 adapter and CRM module. Only transport and native DOM are fixtures.
async function app(options: any = {}) {
  const calls: { endpoint: string; options?: any }[] = [], toasts: string[] = [];
  const rows = options.rows || [lead('A'), lead('B')];
  let revision = 1, subscriber: any, html = '', controls: any[] = [], area: any = null, previewResult: any = null;
  const extraElements = new Map<string, any>();
  const state: any = { page: options.page || 'myLeads' };
  const workListeners = new Map<string, any>(); let workManager: any = null;
  const track = { scrollLeft: 0 }, scroller = { scrollTop: 0, scrollLeft: 0 };
  const workHost: any = { innerHTML: '', hidden: true, setAttribute() {}, contains: (node: any) => !!node?.inside, querySelector: (selector: string) => selector === '.work-tabs-track' ? track : { focus() {} }, addEventListener: (event: string, fn: any) => workListeners.set(event, fn), removeEventListener: (event: string) => workListeners.delete(event) };
  const view: any = {
    scrollTop: 0, scrollLeft: 0, setAttribute() {}, removeAttribute() {},
    get innerHTML() { return html; },
    set innerHTML(value: string) {
      html = value; controls = []; extraElements.clear();
      const attr = (attrs: string, name: string) => decode(attrs.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'))?.[1] || '');
      for (const match of value.matchAll(/<(input|select|textarea)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)) {
        const [, tag, attrs, body = ''] = match;
        if (!attrs.includes('data-business-path=')) continue;
        const selected = tag === 'select' ? [...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].find(item => /\bselected\b/.test(item[1])) : null;
        controls.push({ id: attr(attrs, 'id'), type: attr(attrs, 'type') || tag, disabled: /\bdisabled\b/.test(attrs), dataset: { businessPath: attr(attrs, 'data-business-path'), businessType: attr(attrs, 'data-business-type') }, value: tag === 'textarea' ? decode(body) : tag === 'select' ? selected ? attr(selected[1], 'value') : '' : attr(attrs, 'value') });
      }
      for (const match of value.matchAll(/<button\b([^>]*)>/g)) {
        const attrs = match[1], id = attr(attrs, 'id');
        if (id || attrs.includes('data-business-followup-confirm')) extraElements.set(id || 'alternate-' + extraElements.size, { disabled: /\bdisabled\b/.test(attrs), alternate: attrs.includes('data-business-followup-confirm') });
      }
      const listeners = new Map<string, any>();
      const buttons = [...value.matchAll(/data-crm-followup-tab="([^"]+)"/g)].map(match => ({ dataset: { crmFollowupTab: match[1] }, setAttribute() {}, focus() {} }));
      const panels = [...value.matchAll(/data-crm-followup-panel="([^"]+)"([^>]*)>/g)].map(match => ({ dataset: { crmFollowupPanel: match[1] }, hidden: /\bhidden\b/.test(match[2]) }));
      area = value.includes('data-crm-followup-workspace') ? { matches: () => true, contains: () => true, querySelectorAll: (selector: string) => selector.includes('-tab]') ? buttons : panels, addEventListener: (event: string, callback: any) => listeners.set(event, callback), removeEventListener: (event: string) => listeners.delete(event), buttons, panels, listeners } : null;
    },
    querySelector: (selector: string) => selector === '[data-crm-followup-workspace]' ? area : null,
  };
  const empty = { textContent: '', setAttribute() {} };
  const document = { addEventListener() {}, removeEventListener() {},
    scrollingElement: scroller, activeElement: null,
    querySelector(selector: string) { if (selector === '#view') return view; if (selector === '#crumb') return empty; return controls.find(control => '#' + control.id === selector) || extraElements.get(selector.slice(1)) || null; },
    querySelectorAll(selector: string) { if (selector === '#business-form [data-business-path]') return controls; if (selector === '[data-business-followup-confirm]') return [...extraElements.values()].filter(item => item.alternate); return []; },
    getElementById(id: string) { return id === 'workspace-tabs' ? workHost : id === 'view' ? view : null; },
  };
  const data = () => ({ leads: [], opportunities: [], directory: [{ id: 'sales-1', name: '陈顾问' }], campuses: [], customers: [], courses: [], classes: [], students: [], forms: [], orders: [] });
  const user = { id: 'sales-1', version: 1, permissions: options.permissions || ['lead.read', 'lead.follow', 'customer.read', 'opportunity.write', 'customer.write'], scope: options.scope || { type: 'own' }, roleIds: options.roleIds || ['sales'] };
  const sandbox: any = {
    SIYUE_AUTH_API: true, URLSearchParams, document, state, a: {}, leadState: {}, mallState: {}, mfState: {}, workflowState: {}, sysRules: {},
    permissionCanVisit: (page: string) => options.canVisit ? options.canVisit(page) : true, confirm: () => options.confirm?.() ?? true, render() {}, nav() {}, accountOpen() {}, workspaceBack() {}, workflowSearchEntries() {}, toast: (message: string) => toasts.push(message),
    crypto: { randomUUID: (() => { let counter = 0; return () => 'followup-key-' + ++counter; })() },
    employeeAuth: {
      subscribe(callback: any) { subscriber = callback; }, openAccounts() { state.page = 'staff'; return true; }, open() { state.page = 'accountSettings'; return true; }, has: (permission: string) => user.permissions.includes(permission), current: () => user,
      async request(endpoint: string, init?: any) {
        calls.push({ endpoint, options: clone(init || {}) });
        if (endpoint === 'v1/state?crm=compact') { const payload = { state: data(), revision, capabilities: { businessReady: true } }; return options.state ? await options.state(payload) : payload; }
        if (endpoint === 'v1/catalog') return { operations: [options.leadOperation || leadOperation, opportunityOperation, customerOperation, opportunityFollowupOperation, opportunityAdvanceOperation, ...(options.extraOperations || [])] };
        if (endpoint.startsWith('v1/crm/query?')) {
          const query = Object.fromEntries(new URLSearchParams(endpoint.split('?')[1]));
          let items: any[] = [];
          if (query.resource === 'customers' && query.id) items = options.customers ? await options.customers(query) : [{ id: query.id, name: '关联客户', status: 'active', allowedOperationIds: ['opportunity.create'] }];
          if (query.resource === 'leads') items = options.query ? await options.query(query) : query.id ? rows.filter((row: any) => row.id === query.id) : rows;
          if (query.resource === 'opportunities') items = options.opportunityQuery ? await options.opportunityQuery(query) : (options.opportunities || []).filter((row: any) => !query.id || row.id === query.id);
          if (options.related && ['touchpoints', 'orders'].includes(query.resource)) return await options.related(query);
          return { items, total: items.length, filters: query, page: Number(query.page), pageSize: Number(query.pageSize), updatedAt: '2026-10-14T00:00:00Z' };
        }
        if (endpoint.endsWith('/preview')) { previewResult = options.preview ? options.preview(init.body.input, endpoint) : { record: { id: init.body.input.opportunityId || init.body.input.leadId, ...init.body.input } }; return { previewToken: 'PREVIEW_' + revision, revision, result: previewResult }; }
        if (endpoint.endsWith('/execute')) {
          const attempt = calls.filter(call => call.endpoint.endsWith('/execute')).length;
          if (options.commitResponse) return await options.commitResponse(init, attempt);
          let result = options.execute ? await options.execute(init, attempt) : {};
          if (Object.keys(result).length === 0 && /(?:lead|opportunity)\.followup\/execute$/.test(endpoint)) {
            const input = init.body.input;
            const detail = previewResult?.record?.history?.at(-1)?.detail || { note: input.note, channel: input.channel, nextFollowAt: input.nextFollowAt || null };
            result = { record: { ...clone(previewResult?.record || {}), id: input.opportunityId || input.leadId, version: previewResult?.record?.version ?? (input.expectedVersion ?? 1) + 1, nextFollowAt: detail.nextFollowAt || null, history: [{ kind: input.opportunityId ? '商机跟进' : '跟进', detail }] } };
          }
          return { result, state: data(), revision: ++revision };
        }
        throw Error('Unexpected endpoint ' + endpoint);
      },
    },
  };
  sandbox.window = sandbox;
  if(options.trialOpen)sandbox.SiyueTrialWorkflow={open:options.trialOpen};
  if (options.workTabs) { runInNewContext(source('work-tabs.js'), sandbox); const factory = sandbox.SiyueWorkTabs.create; sandbox.SiyueWorkTabs = { create(callbacks: any) { workManager = factory(callbacks); return workManager; } }; }
  if (options.layout !== false) runInNewContext(source('crm-followup-layout.js'), sandbox);
  runInNewContext(source('business-scrm.js'), sandbox);
  runInNewContext(source('business-api.js'), sandbox);
  subscriber(user); await settle(); await settle();
  return {
    api: sandbox.businessAPI, work: { snapshot: () => clone(workManager?.snapshot()), click(key: string, close = false) { const button = { inside: true, getAttribute: () => key }; workListeners.get('click')({ target: { closest: (selector: string) => selector === (close ? '[data-work-tab-close]' : '[data-work-tab]') ? button : null }, preventDefault() {} }); }, get html() { return workHost.innerHTML; } }, scroller, view, user, login(next: any = user) { subscriber(next); }, openAccounts() { return sandbox.employeeAuth.openAccounts(); }, directAccountOpen() { return sandbox.employeeAuth.open(); }, crm: sandbox.SiyueBusinessCRM, state, calls, toasts, accountOpen() { return sandbox.accountOpen(); }, logout() { subscriber(null); }, get html() { return html; }, get area() { return area; },
    field(name: string) { const control = controls.find(item => JSON.parse(item.dataset.businessPath)[0] === name); assert(control, 'Missing form field ' + name); return control; },
    async open(id = 'A') { assert.equal(sandbox.businessAPI.open('lead.followup', { leadId: id, channel: '电话' }), true); },
    async openOpportunity(id = 'O1') { assert.equal(sandbox.businessAPI.open('opportunity.followup', { opportunityId: id, channel: 'phone' }), true); },
    async prepare() { this.field('note').value = '客户明确数学需求，预约下次回访'; this.field('nextFollowAt').value = '2026-10-25T10:30'; assert.equal(await sandbox.businessAPI.preview(), true); },
    tab(id: string) { const button = area.buttons.find((item: any) => item.dataset.crmFollowupTab === id); assert(button); area.listeners.get('click')({ target: { closest: () => button } }); },
  };
}

const registration=operation('lead.create','lead.create',{name:string,phone:string,source:string,ownerId:string,campusId:string,guardian:string,grade:string,subject:string,note:string,followChoice:{type:'string',enum:['self','public']}},['name','phone','source']);
const baseSeed={name:'微信昵称',phone:'13900001241',source:'合成测试',subject:'初一数学、英语阅读'};
test('registration uses a single name field, free course text and defaults to the current follower without a follow-choice control',async()=>{
 const ui=await app({permissions:['lead.create','lead.follow'],extraOperations:[registration]});
 ui.api.open('lead.create',{...baseSeed,guardian:'不应提交',followChoice:'public'});
 assert.match(ui.html,/aria-label="名称"/);assert.match(ui.html,/昵称或微信名/);assert.match(ui.html,/aria-label="负责人归属"/);assert.equal(ui.field('ownerId').value,'sales-1');
 assert.doesNotMatch(ui.html,/家长姓名|登记后的跟进方式|data-business-path="\[&quot;followChoice|data-business-path="\[&quot;guardian/);
 assert.equal(ui.field('subject').type,'text');assert.equal(ui.field('subject').value,baseSeed.subject);
 assert.equal(await ui.api.preview(),true);const input=ui.calls.find(c=>c.endpoint.endsWith('/preview'))!.options.body.input;
 assert.equal(input.ownerId,'sales-1');assert.equal(input.name,'微信昵称');assert.equal(input.followChoice,undefined);assert.equal(input.guardian,undefined);
});
test('clearing owner sends an explicit public-pool selection, including for non-following registrars',async()=>{
 for(const permissions of [['lead.create','lead.follow'],['lead.create']]){const ui=await app({permissions,extraOperations:[registration]});ui.api.open('lead.create',baseSeed);assert.equal(ui.api.setLeadOwnerMode('public'),true);assert.equal(await ui.api.preview(),true);const input=ui.calls.find(c=>c.endpoint.endsWith('/preview'))!.options.body.input;assert.equal(input.ownerId,'');assert.equal(input.followChoice,undefined);}
});
test('operations registration can select only vetted eligible owners for the chosen campus',async()=>{
 const ui=await app({permissions:['lead.create'],roleIds:['operations'],scope:{type:'campus',campusIds:['a']},extraOperations:[registration],state:(payload:any)=>{payload.state.campuses=[{id:'a',name:'甲校区'},{id:'b',name:'乙校区'}];payload.state.directory=[{id:'invalid',name:'无资格员工'}];payload.state.leadOwnerOptions=[{id:'sales-eligible',name:'合成合格销售',campusIds:['a']},{id:'sales-other-campus',name:'异校区员工',campusIds:['b']}];return payload;}});
 ui.api.open('lead.create',{...baseSeed,campusId:'a'});assert.doesNotMatch(ui.html,/搜索销售姓名或工号/);assert.equal(ui.api.setLeadOwnerMode('assigned'),true);assert.match(ui.html,/合成合格销售/);assert.equal(await ui.api.preview(),false);assert.match(ui.html,/请选择招生负责人/);assert.doesNotMatch(ui.html,/无资格员工|异校区员工/);
 ui.field('ownerId').value='sales-eligible';assert.equal(await ui.api.preview(),true);assert.equal(ui.calls.find(c=>c.endpoint.endsWith('/preview'))!.options.body.input.ownerId,'sales-eligible');
 ui.api.change(['campusId'],'b','string');assert.equal(ui.field('ownerId').value,'');assert.equal(await ui.api.preview(),false);assert.equal(ui.api.setLeadOwnerMode('public'),true);assert.equal(await ui.api.preview(),true);
});
test('registration confirmation does not ask the registrar to judge intent or sales decisions',async()=>{
 const ui=await app({permissions:['lead.create','lead.follow'],extraOperations:[registration],preview:()=>({record:{id:'preview',name:'合成',ownerId:'sales-1',stage:'跟进中',intent:'未标记',decisionStatus:'retained',decisionByName:'合成登记人',decisionHistory:[{kind:'created',decision:'public'}]}})});ui.api.open('lead.create',baseSeed);await ui.api.preview();assert.match(ui.html,/跟进中/);assert.doesNotMatch(ui.html,/销售决策|意向度|decisionHistory|decisionByName/);
});

test('public registration confirmation separates unassigned ownership from new callback stage without exposing bookkeeping',async()=>{const ui=await app({permissions:['lead.create'],extraOperations:[registration],preview:()=>({record:{id:'preview',name:'合成公海',ownerId:null,stage:'新线索',status:'new',intent:'未标记',decisionStatus:'public'}})});ui.api.open('lead.create',baseSeed);assert.equal(await ui.api.preview(),true);assert.match(ui.html,/<dt>线索阶段<\/dt><dd>新线索<\/dd>/);assert.match(ui.html,/未分配，进入公海/);assert.doesNotMatch(ui.html,/销售决策|decisionStatus|decisionHistory|<dt>状态<\/dt>/);});

for(const matched of [false,true])test('academic trial intake reuses registration fields and opens calendar after '+(matched?'match':'creation'),async()=>{
 const opened:any[]=[];const intake={...registration,id:'lead.trialIntake',label:'预约试听 · 登记或匹配线索'};
 const record={id:'lead-result',name:baseSeed.name,phone:baseSeed.phone,ownerId:'eligible',stage:'跟进中'};
 const ui=await app({permissions:['lead.create','class.create'],roleIds:['academic'],scope:{type:'campus',campusIds:['a']},extraOperations:[intake],trialOpen:(...args:any[])=>opened.push(args),preview:()=>({matched,record}),execute:()=>({matched,record}),state:(payload:any)=>{payload.state.campuses=[{id:'a',name:'甲校区'}];payload.state.leadOwnerOptions=[{id:'eligible',name:'跟进销售',campusIds:['a']}];return payload;}});
 assert(ui.api.open('lead.trialIntake',{...baseSeed,ownerId:'eligible'}));assert.equal(ui.field('campusId').value,'a');assert.match(ui.html,/跟进销售/);assert.match(ui.html,/按名称和联系电话匹配/);assert.match(ui.html,/保留原负责人/);assert.match(ui.html,/新线索或公海线索须选择有效负责人/);assert.match(ui.html,/确认后进入预约课表/);
 assert.equal(await ui.api.preview(),true);assert.match(ui.html,matched?/已命中现有线索/:/未发现同名同电话线索/);assert.equal(opened.length,0);
 assert.equal(await ui.api.execute(),true);assert.deepEqual(opened,[['lead-result',true]]);
});

const profileUpdate={...clone(crmContract.operations.find((op:any)=>op.id==='lead.update')),execution:'server'};
test('full lead edit uses registration identity fields and never resubmits hidden historical guardian data',async()=>{
 for(const entry of ['profile','more-actions']){
  const row=lead('A',{name:'合成昵称',guardian:'历史家长资料',campusId:'campus-1',intent:'未标记',nextFollowAt:'2020-01-01T00:00:00Z',allowedOperationIds:['lead.update']});
  const ui=await app({rows:[row],permissions:['lead.read','lead.create','lead.follow'],extraOperations:[profileUpdate]});
  if(entry==='profile')assert.equal(await ui.api.showLead('A','edit'),true);
  else ui.crm.operate('lead.update','leads','A');
  assert.match(ui.html,/aria-label="名称"/);assert.match(ui.html,/aria-label="意向课程"/);
  assert.doesNotMatch(ui.html,/家长姓名|历史家长资料|data-business-path="\[&quot;patch&quot;,&quot;guardian/);
  assert.equal(await ui.api.preview(),true);
  const preview=ui.calls.find(c=>c.endpoint==='v1/operations/lead.update/preview')!.options.body.input;
  assert.equal(preview.patch.name,row.name);assert.equal(preview.patch.subject,row.subject);assert.equal(Object.hasOwn(preview.patch,'guardian'),false);
  assert.deepEqual(Object.keys(preview.patch).sort(),['grade','name','note','phone','subject']);businessStore.validate(profileUpdate.inputSchema,preview);
  assert.doesNotMatch(ui.html,/家长姓名|历史家长资料/);assert.equal(Object.hasOwn(profileUpdate.inputSchema.properties.patch.properties,'guardian'),true);
  assert.equal(await ui.api.execute(),true);
  const submitted=ui.calls.find(c=>c.endpoint==='v1/operations/lead.update/execute')!.options.body.input;
  assert.equal(Object.hasOwn(submitted.patch,'guardian'),false);assert.equal(row.guardian,'历史家长资料');
 }
});

test('explicit single-field lead edit still supports intent without resubmitting other profile data',async()=>{
 const row=lead('A',{intent:'高意向',guardian:'历史家长资料',allowedOperationIds:['lead.update']});
 const ui=await app({rows:[row],permissions:['lead.read','lead.create','lead.follow'],extraOperations:[profileUpdate]});
 assert.equal(await ui.api.showLead('A','edit','intent'),true);assert.equal(await ui.api.preview(),true);
 const input=ui.calls.find(c=>c.endpoint==='v1/operations/lead.update/preview')!.options.body.input;
 assert.deepEqual(input.patch,{intent:'高意向'});businessStore.validate(profileUpdate.inputSchema,input);
});
