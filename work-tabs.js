/* In-memory work tab chrome. Business adapters own drafts, authorization and navigation. */
(function (root) {
  'use strict';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
  let currentManager = null;
  let instanceNumber = 0;

  function create({ onActivate, onClose, host = root.document?.getElementById('workspace-tabs') } = {}) {
    currentManager?.dispose();
    const prefix = `work-tab-${++instanceNumber}-`;
    const tabs = new Map();
    let activeKey = null, message = '', pending = false, generation = 0, tabNumber = 0;
    const panel = root.document?.getElementById('view');
    const revealTab = key => {
      const item = tabs.get(key), track = host?.querySelector('.work-tabs-track');
      const button = item && host?.querySelector(`[id="${item.domId}"]`);
      const bounds = track?.getBoundingClientRect?.(), target = button?.parentElement?.getBoundingClientRect?.();
      if (!bounds || !target) return;
      if (target.left < bounds.left) track.scrollLeft -= bounds.left - target.left;
      else if (target.right > bounds.right) track.scrollLeft += target.right - bounds.right;
    };
    const focusTab = key => {
      const item = tabs.get(key);
      if (item) host?.querySelector(`[id="${item.domId}"]`)?.focus({ preventScroll: true });
      revealTab(key);
    };

    function render() {
      if (!host) return;
      const focused = root.document?.activeElement;
      const focusedKey = host.contains(focused) ? focused?.getAttribute?.('data-work-tab') : null;
      const oldTrack = host.querySelector('.work-tabs-track');
      const scrollLeft = oldTrack?.scrollLeft || 0;
      host.hidden = tabs.size === 0;
      host.setAttribute('aria-busy', String(pending));
      const focusKey = activeKey || tabs.keys().next().value;
      host.innerHTML = `<div class="work-tabs-track" role="tablist" aria-label="已打开的工作页面">${[...tabs.values()].map(tab =>
        `<div class="work-tab-item ${tab.key === activeKey ? 'is-active' : ''}" role="presentation"><button type="button" role="tab" class="work-tab-label" id="${tab.domId}" data-work-tab="${escapeHtml(tab.key)}" aria-controls="view" aria-selected="${tab.key === activeKey}" tabindex="${tab.key === focusKey ? 0 : -1}" title="${escapeHtml(tab.title)}${tab.dirty ? ' · 未保存' : ''}" ${pending ? 'disabled' : ''}><span class="work-tab-text">${escapeHtml(tab.title)}</span>${tab.dirty ? '<span class="work-tab-dirty" aria-label="未保存">●</span>' : ''}</button>${tab.closable ? `<button type="button" class="work-tab-close" data-work-tab-close="${escapeHtml(tab.key)}" aria-label="关闭${escapeHtml(tab.title)}" title="关闭${escapeHtml(tab.title)}" ${pending ? 'disabled' : ''}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8"/></svg></button>` : '<span class="work-tab-spacer" aria-hidden="true"></span>'}</div>`
      ).join('')}</div><p class="work-tabs-message" role="status" ${message ? '' : 'hidden'}>${escapeHtml(message)}</p>`;
      const track = host.querySelector('.work-tabs-track');
      if (track) track.scrollLeft = scrollLeft;
      const active = tabs.get(activeKey);
      if (active && panel) {
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', active.domId);
      } else if (panel) {
        panel.removeAttribute('role');
        panel.removeAttribute('aria-labelledby');
      }
      if (focusedKey && !pending) focusTab(focusedKey);
    }

    async function request(kind, key) {
      const tab = tabs.get(key);
      if (pending || !tab || (kind === 'close' && !tab.closable) || (kind === 'activate' && key === activeKey)) return;
      const callback = kind === 'close' ? onClose : onActivate;
      if (typeof callback !== 'function') return;
      const token = generation;
      pending = true;
      message = '';
      render();
      try { await callback(key); }
      catch { if (token === generation) message = '页面切换未完成，请重试。'; }
      finally {
        if (token === generation) {
          pending = false;
          render();
          const target = tabs.has(key) ? key : activeKey;
          if (target) focusTab(target);
        }
      }
    }

    function click(event) {
      const close = event.target?.closest?.('[data-work-tab-close]');
      if (close && host.contains(close)) {
        event.preventDefault();
        void request('close', close.getAttribute('data-work-tab-close'));
        return;
      }
      const tab = event.target?.closest?.('[data-work-tab]');
      if (tab && host.contains(tab)) {
        event.preventDefault();
        void request('activate', tab.getAttribute('data-work-tab'));
      }
    }

    function keydown(event) {
      const button = event.target?.closest?.('[data-work-tab]');
      if (!button || !host.contains(button) || pending) return;
      const key = button.getAttribute('data-work-tab');
      const keys = [...tabs.keys()], index = keys.indexOf(key);
      if (index < 0) return;
      if (event.key === 'Delete') {
        event.preventDefault();
        void request('close', key);
        return;
      }
      const next = event.key === 'ArrowRight' ? (index + 1) % keys.length
        : event.key === 'ArrowLeft' ? (index - 1 + keys.length) % keys.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : -1;
      if (next >= 0) {
        event.preventDefault();
        focusTab(keys[next]);
      }
    }

    host?.addEventListener('click', click);
    host?.addEventListener('keydown', keydown);
    const manager = {
      upsert(tab, { active = true } = {}) {
        if (!tab || typeof tab.key !== 'string' || !tab.key) return false;
        const old = tabs.get(tab.key);
        tabs.set(tab.key, { key: tab.key, title: String(tab.title || '工作页面'),
          closable: tab.closable !== false, dirty: tab.dirty === true, domId: old?.domId || prefix + (++tabNumber) });
        if (active) activeKey = tab.key;
        render();
        if (active) revealTab(tab.key);
        return true;
      },
      setActive(key) { activeKey = tabs.has(key) ? key : null; render(); },
      remove(key) { const removed = tabs.delete(key); if (activeKey === key) activeKey = null; render(); return removed; },
      reset() { generation++; pending = false; tabs.clear(); activeKey = null; message = ''; render(); },
      setMessage(text) { message = String(text || ''); render(); },
      snapshot() { return { activeKey, tabs: [...tabs.values()].map(({ domId, ...tab }) => ({ ...tab })) }; },
      dispose() {
        manager.reset();
        host?.removeEventListener('click', click);
        host?.removeEventListener('keydown', keydown);
      }
    };
    currentManager = manager;
    render();
    return manager;
  }
  root.SiyueWorkTabs = Object.freeze({ create });
})(window);
