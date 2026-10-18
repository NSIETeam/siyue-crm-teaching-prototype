/* Shared page and component registry for the employee workspace. */
(function (root) {
  'use strict';

  const tokens = Object.freeze({
    colorBrand: '#315deb',
    colorBrandHover: '#244ed5',
    colorText: '#243149',
    colorMuted: '#71839c',
    colorBorder: '#e2e8f2',
    colorSurface: '#ffffff',
    colorCanvas: '#f4f7fb',
    colorFocus: '#315deb',
    radiusControl: '8px',
    radiusCard: '12px',
    buttonHeight: '40px',
    controlHeight: '40px',
    buttonGap: '12px',
    fieldGap: '14px',
    rowGap: '18px',
    sectionGap: '16px',
    contentMax: '1600px'
  });
  const pages = new Map();
  const components = new Map();
  const designs = new Map([
    ['crmReports', { profile: 'wide', width: 'wide' }],
    ['salesMetrics', { profile: 'wide', width: 'wide' }],
    ['teacherMetrics', { profile: 'wide', width: 'wide' }]
  ]);
  const aliases = Object.freeze({
    leadManage: ['myLeads', '我的线索'],
    leadTodo: ['myLeads', '我的线索'],
    courseForm: ['course', '课程管理'],
    classForm: ['classes', '班级管理'],
    studentDetail: ['students', '学生档案'],
    rescheduleRequests: ['teacherCourses', '调课申请'],
    learningActive: ['teacherStudents', '在读学生'],
    learningHistory: ['studentArchives', '历史学生'],
    crmCustomerDetail: ['crmCustomers', '客户档案'],
    marketingFormBuilder: ['marketingForms', '表单管理'],
    marketingFormSubmissions: ['marketingForms', '提交审核'],
    marketingFormPreview: ['marketingForms', '表单预览'],
    productDetail: ['mallShelf', '课程上架'],
    leadDetail: ['myLeads', '我的线索'],
    opportunityDetail: ['crmOpportunities', '商机管理'],
    taskDetail: ['crmTasks', '任务与服务']
  });

  function registerPage(input) {
    if (!input || typeof input.id !== 'string' || !input.id.trim()) {
      throw new TypeError('页面注册需要有效的 id');
    }
    const requestedId = input.id.trim();
    const legacyLead = ['leadManage', 'leadTodo'].includes(requestedId);
    const id = legacyLead ? 'myLeads' : requestedId;
    const previous = pages.get(id) || {};
    const design = designs.get(id) || {};
    const next = Object.freeze({
      id,
      title: String(legacyLead ? '我的线索' : input.title || previous.title || id),
      category: String(input.category || previous.category || '工作区'),
      profile: String(design.profile || input.profile || previous.profile || 'standard'),
      width: String(design.width || input.width || previous.width || 'normal'),
      aliases: Object.freeze([...new Set([...(previous.aliases || []), ...(input.aliases || []), ...(legacyLead ? [requestedId] : [])])]),
      source: String(input.source || previous.source || 'runtime'),
      visible: input.visible ?? previous.visible ?? true
    });
    pages.set(id, next);
    return next;
  }

  function registerComponent(input) {
    if (!input || typeof input.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(input.id)) {
      throw new TypeError('组件注册需要小写字母、数字或连字符组成的 id');
    }
    if (typeof input.selector !== 'string' || !input.selector.trim()) {
      throw new TypeError('组件注册需要有效的 selector');
    }
    const previous = components.get(input.id) || {};
    const entry = Object.freeze({
      id: input.id,
      selector: input.selector.trim(),
      className: input.className || previous.className || `sy-component-${input.id}`
    });
    if (!/^sy-component-[a-z0-9-]+$/.test(entry.className)) {
      throw new TypeError('组件 className 必须使用 sy-component- 前缀');
    }
    components.set(entry.id, entry);
    decorateComponents(document);
    return entry;
  }

  function textOf(element) {
    return (element?.querySelector?.('[data-label]')?.textContent || element?.textContent || '')
      .replace(/\s+/g, ' ').trim();
  }

  function categoryOf(item) {
    const menu = item?.closest?.('.sidebar-menu');
    for (let node = item?.parentElement; node && node !== menu; node = node.parentElement) {
      if (!node.classList?.contains('nav-children')) continue;
      const parent = [...(menu?.querySelectorAll?.('[data-nav-toggle]') || [])]
        .find(button => button.getAttribute('aria-controls') === node.id);
      if (parent) return textOf(parent) || '工作区';
    }
    return '工作区';
  }

  function collectPages() {
    for (const item of document.querySelectorAll('.sidebar-menu .menu-item[data-page]')) {
      registerPage({
        id: item.dataset.page,
        title: textOf(item),
        category: categoryOf(item),
        source: 'navigation',
        visible: !item.hidden
      });
    }
    const providers = [root.siyueJavaAcademic, root.SiyueCrmNeeds, root.SiyueCrmTaskRouting];
    for (const provider of providers) {
      for (const page of provider?.pages || []) {
        if (Array.isArray(page)) registerPage({ id: page[0], title: page[1], source: 'page-module' });
        else if (page && typeof page.id === 'string') registerPage({ id: page.id, title: page.title, source: 'page-module' });
      }
    }
  }

  function decorateComponents(scope) {
    if (!scope?.querySelectorAll) return;
    for (const component of components.values()) {
      for (const element of scope.querySelectorAll(component.selector)) {
        element.classList.add(component.className);
        element.dataset.syComponent = component.id;
      }
    }
  }

  function currentId() {
    const active = document.querySelector('.sidebar-menu .menu-item.active[data-page]');
    const page = typeof state !== 'undefined' ? String(state.page || '') : '';
    const candidate = active?.dataset.page || page || 'home';
    return aliases[candidate]?.[0] || candidate;
  }

  function decorate() {
    collectPages();
    decorateComponents(document);
    const id = currentId();
    const alias = aliases[id];
    const item = document.querySelector(`.sidebar-menu .menu-item[data-page="${CSS.escape(id)}"]`);
    const entry = pages.get(id) || registerPage({
      id,
      title: alias?.[1] || textOf(document.querySelector('#crumb')) || id,
      category: categoryOf(item),
      source: 'runtime'
    });
    const view = document.getElementById('view');
    if (view) {
      view.classList.add('sy-page');
      view.dataset.pageId = entry.id;
      view.dataset.pageCategory = entry.category;
      view.dataset.pageProfile = entry.profile;
      view.dataset.pageWidth = entry.width;
    }
    document.documentElement.dataset.currentPage = entry.id;
    document.documentElement.dataset.currentPageCategory = entry.category;
    if (root.CustomEvent && document.dispatchEvent) {
      document.dispatchEvent(new root.CustomEvent('siyue:page-change', { detail: entry }));
    }
  }

  function setPageDesign(id, design = {}) {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('页面样式配置需要有效的 id');
    const key = id.trim();
    const prior = designs.get(key) || {};
    const profile = design.profile || prior.profile || 'standard';
    const width = design.width || prior.width || 'normal';
    if (!['compact', 'standard', 'wide'].includes(profile)) throw new RangeError('页面密度只支持 compact、standard 或 wide');
    if (!['narrow', 'normal', 'wide'].includes(width)) throw new RangeError('页面宽度只支持 narrow、normal 或 wide');
    designs.set(key, { profile, width });
    collectPages();
    const previous = pages.get(key);
    if (previous) registerPage({ ...previous, profile, width });
    decorate();
    return pages.get(key) || null;
  }

  function list() {
    collectPages();
    return [...pages.values()];
  }

  function componentList() {
    return [...components.values()];
  }

  for (const [key, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(`--sy-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value);
  }
  registerComponent({
    id: 'button-group',
    selector: '.toolbar-left, .toolbar-right, .actions, .form-actions, .business-submit-actions, .crm-followup-footer, .jn-toolbar, .java-crm-actions'
  });
  registerComponent({
    id: 'form-grid',
    selector: '.form-grid, .business-form-grid, .business-fieldset, .business-array-fields, .scrm-followup-fields'
  });
  registerComponent({ id: 'table-wrap', selector: '.table-wrap, .jn-table-wrap, .bp-table-wrap' });
  collectPages();

  if (typeof root.render === 'function') {
    const previousRender = root.render;
    root.render = function (...args) {
      const result = previousRender.apply(this, args);
      decorate();
      return result;
    };
  }
  if (typeof root.nav === 'function') {
    const previousNav = root.nav;
    root.nav = function (...args) {
      const result = previousNav.apply(this, args);
      decorate();
      return result;
    };
  }
  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => queueMicrotask(decorate));
    observer.observe(document.getElementById('view') || document.body, { subtree: true, childList: true });
    const menu = document.querySelector('.sidebar-menu');
    if (menu) observer.observe(menu, { subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  }

  root.SiyuePageRegistry = Object.freeze({
    registerPage,
    registerComponent,
    setPageDesign,
    get: id => pages.get(['leadManage', 'leadTodo'].includes(id) ? 'myLeads' : id) || null,
    list,
    componentList,
    current: () => pages.get(document.documentElement.dataset.currentPage) || null,
    refresh: decorate,
    tokens
  });
  decorate();
})(window);
