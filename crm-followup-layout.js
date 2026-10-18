/* Shared presentation for the v1 and Java CRM workflows. Adapters own data and mutations. */
(function (root) {
  'use strict';
  const bindings = new WeakMap();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  // html slots accept only markup already rendered by the application adapter.
  function render({ title = '线索办理', recordId = '', status = '', summary = [],
    tabs = [], activeTab = '', footerHtml = '', notice = '', actionsHtml = '',
    eyebrow = '客户跟进', actionsLabel = '客户操作' } = {}) {
    const active = tabs.some(tab => tab.id === activeTab) ? activeTab : tabs[0]?.id;
    return `<section class="crm-followup-workspace" data-crm-followup-workspace>
      <header class="crm-followup-heading"><div class="crm-followup-identity"><p class="crm-followup-eyebrow">${escape(eyebrow)}</p>
        <h2>${escape(title)}</h2>${recordId ? `<p class="crm-followup-id">${escape(recordId)}</p>` : ''}</div>
        ${(status || actionsHtml) ? `<div class="crm-followup-heading-tools">
          ${status ? `<span class="crm-followup-status">${escape(status)}</span>` : ''}
          ${actionsHtml ? `<div class="crm-followup-actions" role="group" aria-label="${escape(actionsLabel)}">${actionsHtml}</div>` : ''}
        </div>` : ''}</header>
      <dl class="crm-followup-summary">${summary.map(item => `<div><dt>${escape(item.label)}</dt>
        <dd>${escape(item.value === null || item.value === undefined || item.value === '' ? '—' : item.value)}</dd></div>`).join('')}</dl>
      ${notice ? `<p class="crm-followup-notice">${escape(notice)}</p>` : ''}
      ${tabs.length ? `<nav class="crm-followup-tabs" aria-label="办理详情">${tabs.map(tab =>
        `<button type="button" data-crm-followup-tab="${escape(tab.id)}" aria-pressed="${tab.id === active}">${escape(tab.label)}</button>`).join('')}</nav>` : ''}
      ${tabs.map(tab => `<section class="crm-followup-panel" data-crm-followup-panel="${escape(tab.id)}" aria-label="${escape(tab.label)}"${tab.id === active ? '' : ' hidden'}>${tab.html || ''}</section>`).join('')}
      ${footerHtml ? `<footer class="crm-followup-footer">${footerHtml}</footer>` : ''}
    </section>`;
  }

  function workspace(container) {
    return container?.matches?.('[data-crm-followup-workspace]') ? container
      : container?.querySelector?.('[data-crm-followup-workspace]');
  }

  // Switching panels leaves form elements in place, preserving unsaved input and focus state.
  function activate(container, id) {
    const area = workspace(container);
    if (!area) return false;
    const buttons = [...area.querySelectorAll('[data-crm-followup-tab]')];
    if (!buttons.some(button => button.dataset.crmFollowupTab === id)) return false;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.crmFollowupTab === id)));
    area.querySelectorAll('[data-crm-followup-panel]').forEach(panel => {
      panel.hidden = panel.dataset.crmFollowupPanel !== id;
    });
    return true;
  }

  function bind(container, onSelect) {
    const area = workspace(container);
    if (!area) return () => {};
    bindings.get(area)?.();
    const select = button => {
      const id = button.dataset.crmFollowupTab;
      if (activate(area, id)) onSelect?.(id);
    };
    const click = event => {
      const button = event.target.closest?.('[data-crm-followup-tab]');
      if (button && area.contains(button)) select(button);
    };
    const keydown = event => {
      const button = event.target.closest?.('[data-crm-followup-tab]');
      const buttons = [...area.querySelectorAll('[data-crm-followup-tab]')];
      const index = buttons.indexOf(button);
      if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length;
      select(buttons[target]);
      buttons[target].focus();
    };
    const invalid = event => {
      const panel = event.target.closest?.('[data-crm-followup-panel]');
      if (panel && area.contains(panel) && activate(area, panel.dataset.crmFollowupPanel)) {
        onSelect?.(panel.dataset.crmFollowupPanel);
      }
    };
    area.addEventListener('click', click);
    area.addEventListener('keydown', keydown);
    area.addEventListener('invalid', invalid, true);
    const dispose = () => {
      area.removeEventListener('click', click);
      area.removeEventListener('keydown', keydown);
      area.removeEventListener('invalid', invalid, true);
      if (bindings.get(area) === dispose) bindings.delete(area);
    };
    bindings.set(area, dispose);
    return dispose;
  }

  root.SiyueCrmFollowup = Object.freeze({ render, activate, bind });
})(window);
