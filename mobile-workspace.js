/* Mobile presentation only: keep the original controls, handlers and authorization. */
(() => {
  'use strict';
  const viewport = matchMedia('(max-width:760px)');
  const panel = document.getElementById('view');
  const tabs = document.getElementById('workspace-tabs');
  const sidebar = document.querySelector('.sidebar');
  const toggle = sidebar?.querySelector('.sidebar-fold');
  const globalSearch = document.querySelector('.topbar .global-action input');
  const searchPlaceholder = globalSearch?.getAttribute('placeholder') || '';
  const labels = new Set(['选择','学生 / 联系方式','姓名 / 名称','姓名','学生姓名','名称','标题','课程名称','班级名称','联系电话','联系方式','手机号','年级','学科','校区','所属校区','在读课程','状态','来源','负责人','阶段','意向度','下次跟进','下次回访','最近更新','创建时间','操作','类型','获客活动','开始日期','结束日期','目标人数','实际人数','任务名称','任务类型','截止时间','优先级','客户','客户姓名','沟通方式','服务类型','处理状态','价格','课程价格','讲次数','关联班级','ID','授课方式','课程类型','进度','上课时间','在班人数','已报人数','预招人数','年份','学期','班型','老师','教室','费用','难度','地址','教室数','班级数','订单编号','应收金额','实收金额','待收金额','家长姓名','金额','跟进状态']);
  const primary = new Set(['学生 / 联系方式','姓名 / 名称','姓名','学生姓名','名称','标题','课程名称','班级名称','任务名称']);
  let scheduled = false;
  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'mobile-nav-backdrop';
  backdrop.setAttribute('aria-label', '关闭功能菜单');
  backdrop.hidden = true;
  document.body.append(backdrop);
  function closeMenu() {
    if (viewport.matches && sidebar && !sidebar.classList.contains('is-collapsed')) toggle?.click();
  }
  function syncMenu() {
    const open = viewport.matches && sidebar && !sidebar.classList.contains('is-collapsed');
    if (backdrop.hidden === !!open) backdrop.hidden = !open;
    document.body.classList.toggle('mobile-nav-open', !!open);
  }
  backdrop.addEventListener('click', () => { closeMenu(); toggle?.focus(); });
  document.addEventListener('keydown', event => {
    if (!viewport.matches || sidebar?.classList.contains('is-collapsed')) return;
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(); toggle?.focus(); }
  });
  // Existing sidebar handlers close the menu only after a real navigation item is chosen.
  sidebar?.addEventListener('click', event => {
    queueMicrotask(syncMenu);
  });
  if (sidebar) new MutationObserver(syncMenu).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  function markTables() {
    for (const table of panel?.querySelectorAll('table.scrm-table,table.bp-table') || []) {
      if (table.closest('.business-form,.employee-auth-page,.business-attendance,.schedule-grid')) continue;
      const heading = table.tHead?.rows[0];
      if (!heading || table.tHead.rows.length !== 1) continue;
      const headings = [...heading.cells];
      // Only fixed, explicitly allowed field names become labels. Never copy record text into labels.
      const fields = headings.map(cell => {
        if (cell.querySelector('input[type="checkbox"]')) { cell.classList.add('sy-mobile-selection-heading'); return '选择'; }
        const text = cell.textContent.trim();
        return labels.has(text) ? text : null;
      });
      if (fields.some(label => label === null)) continue;
      table.classList.add('sy-mobile-cards');
      for (const row of [...table.tBodies].flatMap(body => [...body.rows])) {
        if (row.cells.length !== fields.length || [...row.cells].some(cell => cell.colSpan > 1)) continue;
        row.classList.add('sy-mobile-record');
        [...row.cells].forEach((cell, index) => {
          const label = fields[index];
          if (cell.dataset.mobileLabel !== label) cell.dataset.mobileLabel = label;
          cell.classList.toggle('sy-mobile-primary', primary.has(label));
          cell.classList.toggle('sy-mobile-selection', label === '选择');
        });
      }
    }
  }
  function revealActiveTab() {
    if (!viewport.matches) return;
    const track = tabs?.querySelector('.work-tabs-track');
    const active = tabs?.querySelector('.work-tab-item.is-active');
    if (!track || !active) return;
    const item = active.getBoundingClientRect(), box = track.getBoundingClientRect();
    if (item.left < box.left) track.scrollLeft -= box.left - item.left;
    else if (item.right > box.right) track.scrollLeft += item.right - box.right;
  }
  function scan() {
    scheduled = false;
    if (globalSearch) { const hint = viewport.matches ? '搜索功能' : searchPlaceholder; if (globalSearch.placeholder !== hint) globalSearch.placeholder = hint; }
    markTables(); revealActiveTab(); syncMenu();
  }
  function schedule() { if (!scheduled) { scheduled = true; queueMicrotask(scan); } }
  if (panel) new MutationObserver(schedule).observe(panel, { childList: true, subtree: true });
  if (tabs) new MutationObserver(schedule).observe(tabs, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','aria-selected'] });
  viewport.addEventListener('change', schedule);
  scan();
})();
