/* The hosted employee portal uses same-origin authentication. GitHub Pages and file previews remain demos. */
(function(){
  'use strict';
  const currentUrl = new URL(location.href);
  const host = currentUrl.hostname;
  function pendingJavaCallback() {
    if (currentUrl.protocol !== 'https:' || !['/crm/', '/crm/index.html'].includes(currentUrl.pathname)) return false;
    const params = currentUrl.searchParams;
    const code = params.get('code'), error = params.get('error');
    if ((!code && !error) || (code && error) || params.getAll('state').length !== 1
        || params.getAll('code').length > 1 || params.getAll('error').length > 1) return false;
    try {
      const raw = window.sessionStorage?.getItem('siyue-java-oidc-transaction');
      if (!raw || raw.length > 4096) return false;
      const pending = JSON.parse(raw);
      if (!pending || !/^[A-Za-z0-9_-]{43}$/.test(pending.state)
          || !/^[A-Za-z0-9_-]{43}$/.test(pending.nonce)
          || !/^[A-Za-z0-9_-]{64}$/.test(pending.verifier)
          || pending.state !== params.get('state') || typeof pending.returnTo !== 'string') return false;
      const target = new URL(pending.returnTo, currentUrl.origin);
      return target.origin === currentUrl.origin && ['/crm/', '/crm/index.html'].includes(target.pathname)
        && target.searchParams.get('java-crm') === '1';
    } catch { return false; }
  }
  if (host === 'www.siyuejn.com' || host === 'siyuejn.com') {
    window.SIYUE_AUTH_API = '/crm-api/';
    const params = currentUrl.searchParams;
    // Routing only. The OIDC client still consumes the transaction and validates state, nonce and PKCE.
    window.SIYUE_JAVA_AUTH_MODE = params.get('java-crm') === '1' || pendingJavaCallback();
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
