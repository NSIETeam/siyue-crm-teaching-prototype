/* Keep filter forms visible while retaining shared field layout. */
(() => {
  let scheduled = false;
  function scan() {
    scheduled = false;
    // Native filter groups keep their fields visible and have no disclosure control.
    for (const details of document.querySelectorAll('details[data-filter-collapse-native],details.tr-filter-more')) {
      if (!details.open) details.open = true;
      details.classList.add('filters-always-open');
      const summary = details.querySelector(':scope > summary');
      if (summary && !summary.hidden) summary.hidden = true;
    }
    for(const panel of document.querySelectorAll('.schedule-filters:not([data-layout-normalized])')){
      panel.dataset.layoutNormalized='true';
      for(const control of [...panel.children].filter(e=>e.matches('input,select'))){
        const label=document.createElement('label');label.className='schedule-filter-field';label.append(document.createTextNode(control.getAttribute('aria-label')||'筛选'));control.before(label);label.append(control);
      }
      panel.querySelector('.schedule-date-separator')?.remove();
      const actions=document.createElement('div');actions.className='schedule-filter-actions';
      for(const button of [...panel.children].filter(e=>e.matches('button')))actions.append(button);
      panel.append(actions);
    }
    // Keep presenter search and selectors in one panel.
    for (const toolbar of document.querySelectorAll('.bp-toolbar')) {
      const search=toolbar.querySelector('input.bp-search');
      const filters=toolbar.parentElement?.querySelector(':scope > .bp-filters');
      if(!search||!filters)continue;
      const holder=search.parentElement;
      const label=document.createElement('label');label.className='bp-filter';label.append(document.createTextNode('查找记录'),search);
      filters.prepend(label);
      if(holder&&!holder.children.length)holder.remove();
      const studentActions=toolbar.querySelector('[data-bp-student-export="students"]')?.closest('.bp-toolbar-actions');
      if(studentActions){
        studentActions.classList.add('bp-student-filter-actions');
        filters.classList.add('bp-student-filters');
        filters.append(studentActions);
        toolbar.remove();
      }else toolbar.classList.add('filter-actions-only');
    }
    // Only search/filter controls in known toolbars; leave refresh/create actions visible.
    for (const host of document.querySelectorAll('.employee-list-tools,.business-list-toolbar,#ea-account-search,#ea-permission-employee-search,[aria-label="统计教师"]')) {
      const parent = host.getAttribute('aria-label') === '统计教师' ? host.parentElement.parentElement : host.matches('input') ? host.parentElement : host;
      if (!parent || parent.matches('.filter-inline-fields') || parent.querySelector(':scope > .filter-inline-fields')) continue;
      const controls = [...parent.children].filter(el => el.matches('input:not([type="hidden"]),select') || el.matches('label') && !!el.querySelector('[aria-label="统计教师"],[aria-label="统计月份"]'));
      if (!controls.length) continue;
      const group = document.createElement('div'); group.className = 'filter-inline-fields';
      parent.insertBefore(group, controls[0]); controls.forEach(el => group.append(el));
    }
  }
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(scan);
  }
  scan();
  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
})();
