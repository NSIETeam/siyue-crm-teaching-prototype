/* The hosted employee portal uses same-origin authentication. GitHub Pages and file previews remain demos. */
(function(){
  'use strict';
  const host = new URL(location.href).hostname;
  if (host === 'www.siyuejn.com' || host === 'siyuejn.com') {
    window.SIYUE_AUTH_API = '/crm-api/';
    document.documentElement.classList.add('employee-auth-locked');
  } else {
    window.addEventListener?.('DOMContentLoaded', function(){
      if (document.getElementById('employee-demo-access')) return;
      const note=document.createElement('div');
      note.id='employee-demo-access';
      note.className='employee-prototype-notice';
      note.innerHTML='当前为演示版本 · <a href="https://www.siyuejn.com/crm/">员工账号登录</a>';
      document.querySelector('.main')?.append(note);
    });
  }
})();
