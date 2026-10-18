/* Shared column sizing for Node workspace lists. No business data is changed. */
(function () {
  'use strict';
  const selector = '#view table, .modal table, .drawer table';
  const pendingResize = new Set();
  let resizeFrame = null;
  function updateOverflow(wrap) {
    const value = String(wrap.scrollWidth > wrap.clientWidth + 1);
    if (wrap.dataset.syOverflow !== value) wrap.dataset.syOverflow = value;
  }
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
    for (const { target } of entries) pendingResize.add(target);
    if (resizeFrame !== null) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      for (const wrap of pendingResize) if (wrap.isConnected) updateOverflow(wrap);
      pendingResize.clear();
    });
  }) : null;
  const observed = new Set();
  function compactLongText(cell) {
    if (cell.tagName !== 'TD' || !['text', 'identifier'].includes(cell.dataset.syColumn) || cell.querySelector('.sy-cell-copy,button,a,input,select,textarea,details,table') || cell.textContent.trim().length <= 120) return;
    const content = document.createElement('div'); content.className = 'sy-cell-copy';
    content.append(...Array.from(cell.childNodes));
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'sy-text-toggle'; toggle.textContent = '展开全文'; toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('keydown', event => event.stopPropagation());
    toggle.addEventListener('click', event => {
      event.stopPropagation();
      const expanded = cell.classList.toggle('sy-cell-expanded');
      toggle.setAttribute('aria-expanded', String(expanded)); toggle.textContent = expanded ? '收起全文' : '展开全文';
    });
    cell.append(content, toggle);
  }
  function column(header, table, index) {
    const label = (header.textContent || '').replace(/\s+/g, ' ').trim();
    if (table.classList.contains('schedule-week-table')) return { kind: 'text', width: index ? 190 : 220 };
    if (header.querySelector('input[type="checkbox"]') || /^(选择|勾选)$/.test(label)) return { kind: 'check', width: 56 };
    if (table.classList.contains('employee-audit-table')) return { kind: index === 0 ? 'date' : 'text', width: [170, 110, 150, 210, 85][index] || 180 };
    if (/^(学科|难度|年份)$/.test(label)) return { kind: 'text', width: 100 };
    if (/^(年级|学期|班型|进度|课程类型)$/.test(label)) return { kind: 'text', width: 120 };
    if (/^(授课方式|教室)$/.test(label)) return { kind: 'text', width: 140 };
    if (/^(操作|办理)$/.test(label)) {
      const count = Math.max(1, ...Array.from(table.tBodies).flatMap(body => Array.from(body.rows)).filter(row => row.cells.length === header.parentElement.cells.length).map(row => row.cells[index]?.querySelectorAll('button,a').length || 0));
      return { kind: 'actions', width: Math.min(280, Math.max(124, count * 74 + 24)) };
    }
    if (/地址|备注|原因|内容|摘要|说明|答卷|标注|业务对象/.test(label)) return { kind: 'text', width: 300 };
    if (/^(课程价格|单价|课时单价|应收|应付|实收|已收|已付|已退|退款|退款金额|净实收|金额|价格|优惠|费用|合计)$/.test(label)) return { kind: 'amount', width: 135 };
    if (/日期|时间|最近更新|下次跟进|截止|首课|排课/.test(label)) return { kind: 'date', width: 175 };
    if (/班级.*课程|课程.*讲次|原课次|目标课次|关联订单|订单/.test(label)) return { kind: 'text', width: 300 };
    if (/课程|班级|讲次|课次|名称|标题|活动|表单/.test(label) && !/数$/.test(label)) return { kind: 'text', width: 260 };
    if (/ID|编号|账号|工号/i.test(label)) return { kind: 'identifier', width: 200 };
    if (/校区|范围/.test(label)) return { kind: 'text', width: 200 };
    if (/姓名|学生|客户|员工|联系人/.test(label)) return { kind: 'text', width: 200 };
    if (/角色|岗位/.test(label)) return { kind: 'text', width: 200 };
    if (/电话|手机/.test(label)) return { kind: 'phone', width: 150 };
    if (/日期|时间|登记|更新|跟进$|截止|开始|结束|首课|排课/.test(label)) return { kind: 'date', width: 175 };
    if (/金额|应收|实收|已收|退款|净实收|价格|单价|优惠|费用/.test(label)) return { kind: 'amount', width: 135 };
    if (/老师|教师|负责人|申请人|创建人|操作人|销售/.test(label)) return { kind: 'text', width: 170 };
    if (/状态|阶段|结果|启用/.test(label)) return { kind: 'status', width: 130 };
    if (/五态|统计/.test(label)) return { kind: 'text', width: 230 };
    if (/来源|渠道/.test(label)) return { kind: 'text', width: 190 };
    if (/数$|人数|课时|容量|时长|优先级/.test(label)) return { kind: 'number', width: 110 };
    if (/年级|学科|学期|类型|方式/.test(label)) return { kind: 'text', width: 130 };
    return { kind: 'text', width: 180 };
  }
  function decorate(table) {
    // Java workspaces and complex header matrices keep their own layout contract.
    if (window.SIYUE_JAVA_AUTH_MODE || table.closest('.jn-page, #java-academic-workspace, .java-academic, .java-crm-workspace, .java-commerce-workspace') || table.className.includes('java-')) return;
    const head = table.tHead?.rows;
    if (head?.length > 1) return;
    const first = head?.[0] || Array.from(table.rows).find(row => Array.from(row.cells).every(cell => cell.colSpan === 1));
    if (!first || !first.cells.length || Array.from(first.cells).some(cell => cell.colSpan > 1 || cell.rowSpan > 1)) return;
    const headers = Array.from(first.cells);
    const specs = headers.map((cell, i) => head?.length ? column(cell, table, i) : { kind: 'text', width: i ? 180 : 260 });
    if (table.closest('.bp-student-roster, .bp-student-directory') && specs.length === 7) {
      [200, 120, 180, 280, 120, 140, 230].forEach((width, i) => { specs[i].width = width; });
    }
    const signature = JSON.stringify(specs);
    let group = table.querySelector(':scope > colgroup');
    if (table.dataset.syLayout !== signature) {
      if (!group) { group = document.createElement('colgroup'); table.insertBefore(group, table.tHead || table.firstChild); }
      group.replaceChildren(...specs.map(spec => { const col = document.createElement('col'); col.style.width = `${spec.width}px`; return col; }));
      table.style.setProperty('--sy-table-min', `${specs.reduce((sum, spec) => sum + spec.width, 0)}px`);
      table.dataset.syLayout = signature;
    }
    table.classList.add('sy-data-table');
    for (const row of table.rows) {
      let index = 0;
      for (const cell of row.cells) {
        cell.dataset.syColumn = cell.colSpan === 1 ? specs[index]?.kind || 'text' : 'expanded';
        compactLongText(cell);
        index += cell.colSpan;
      }
    }
    let wrap = table.parentElement;
    if (!wrap.matches('.table-wrap, .bp-table-wrap, .sy-table-scroll')) {
      wrap = document.createElement('div'); wrap.className = 'sy-table-scroll'; table.before(wrap); wrap.append(table);
    }
    wrap.classList.add('sy-table-scroll');
    if (!wrap.hasAttribute('tabindex')) wrap.tabIndex = 0;
    if (!wrap.hasAttribute('role')) wrap.setAttribute('role', 'region');
    if (!wrap.hasAttribute('aria-label')) wrap.setAttribute('aria-label', '数据表格');
    if (!observed.has(wrap)) { resize?.observe(wrap); observed.add(wrap); }
    updateOverflow(wrap);
  }
  let scheduled = false;
  function refresh() {
    scheduled = false;
    for (const wrap of observed) if (!wrap.isConnected) { resize?.unobserve(wrap); observed.delete(wrap); }
    document.querySelectorAll(selector).forEach(decorate);
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(refresh);
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('siyue:page-change', schedule);
  refresh();
})();
