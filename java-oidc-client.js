/* PKCE OIDC client for the Java API. Access and ID tokens remain memory-only. */
(function(root){
 'use strict';
 function secureUrl(url){return url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);}
 function create(config,dependencies={}){
  const issuer=typeof config?.issuer==='string'?config.issuer:'';
  const clientId=config?.clientId,apiAudience=config?.apiAudience;
  if(!issuer||!clientId||!apiAudience)throw new TypeError('OIDC issuer, client ID, and API audience are required');
  const issuerUrl=new URL(issuer);
  if(!secureUrl(issuerUrl)||issuerUrl.username||issuerUrl.password||issuerUrl.search||issuerUrl.hash)
   throw new TypeError('OIDC issuer must use HTTPS and cannot contain credentials or query parameters');
  const location=dependencies.location||root.location,storage=dependencies.sessionStorage||root.sessionStorage;
  const history=dependencies.history||root.history,cryptoApi=dependencies.crypto||root.crypto;
  const fetcher=dependencies.fetch||root.fetch?.bind(root);
  const callbackUrl=new URL(config.redirectUri||location.href,location.origin);
  if(callbackUrl.origin!==location.origin||!secureUrl(callbackUrl))throw new TypeError('OIDC redirect URI must be same-origin HTTPS');
  if(typeof fetcher!=='function'||!storage||!cryptoApi?.subtle||!cryptoApi?.getRandomValues)
   throw new TypeError('OIDC requires Fetch, session storage, and Web Crypto');
  const transactionKey='siyue-java-oidc-transaction';
  let metadataPromise=null,accessToken=null,idToken=null,expiresAt=0,returnPath='';

  async function metadata(){
   if(!metadataPromise)metadataPromise=(async()=>{
    const discoveryUrl=`${issuer.replace(/\/$/,'')}/.well-known/openid-configuration`;
    const response=await fetcher(discoveryUrl,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',
     headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error('OIDC 服务发现失败');
    const doc=await response.json();
    if(doc.issuer!==issuer||!secureEndpoint(doc.authorization_endpoint)||!secureEndpoint(doc.token_endpoint))
     throw new Error('OIDC 服务发现信息与配置不匹配');
    return doc;
   })();
   return metadataPromise;
  }

  async function signIn(options={}){
   const doc=await metadata(),state=random(32),nonce=random(32),verifier=random(48);
   const target=new URL(options.returnTo||`${location.pathname}${location.search}${location.hash}`,location.origin);
   if(target.origin!==location.origin)throw new TypeError('OIDC return path must stay on this site');
   accessToken=null;idToken=null;expiresAt=0;returnPath='';
   const transaction={state,nonce,verifier,returnTo:`${target.pathname}${target.search}${target.hash}`};
   storage.setItem(transactionKey,JSON.stringify(transaction));
   const challenge=base64url(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
   const auth=new URL(doc.authorization_endpoint);
   auth.searchParams.set('client_id',clientId);
   auth.searchParams.set('redirect_uri',callbackUrl.href);
   auth.searchParams.set('response_type','code');
   auth.searchParams.set('response_mode','query');
   auth.searchParams.set('scope',config.scope||'openid profile');
   auth.searchParams.set('state',state);
   auth.searchParams.set('nonce',nonce);
   auth.searchParams.set('code_challenge',challenge);
   auth.searchParams.set('code_challenge_method','S256');
   location.assign(auth.href);
   return true;
  }

  async function handleCallback(href=location.href){
   const url=new URL(href,location.origin),code=url.searchParams.get('code'),error=url.searchParams.get('error');
   if(!code&&!error)return null;
   if(url.origin!==location.origin)throw new Error('OIDC 回调必须来自本网站');
   accessToken=null;idToken=null;expiresAt=0;returnPath='';
   const state=url.searchParams.get('state'),errorDescription=url.searchParams.get('error_description');
   const raw=storage.getItem(transactionKey);
   storage.removeItem(transactionKey);
   cleanCallback(url);
   if(!raw)throw new Error('OIDC 登录状态已失效，请重新登录');
   let transaction;
   try{transaction=JSON.parse(raw)}catch{throw new Error('OIDC 登录状态无效，请重新登录')}
   if(!state||state!==transaction.state)throw new Error('OIDC 登录校验失败，请重新登录');
   if(error)throw new Error('OIDC 登录未完成：'+safeError(errorDescription||error));
   if(!code||code.length>4096)throw new Error('OIDC 授权码无效');
   const doc=await metadata();
   const form=new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,
    redirect_uri:callbackUrl.href,code_verifier:transaction.verifier});
   const response=await fetcher(doc.token_endpoint,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',
    headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:form.toString()});
   if(!response.ok)throw new Error('OIDC 令牌交换失败');
   const result=await response.json();
   const expires=Number(result.expires_in),now=Math.floor(Date.now()/1000);
   if(result.token_type?.toLowerCase()!=='bearer'||typeof result.access_token!=='string'
     ||result.access_token.length>16384||typeof result.id_token!=='string'||!Number.isFinite(expires)
     ||expires<=0||expires>86400)throw new Error('OIDC 返回的令牌无效');
   const access=jwtClaims(result.access_token),identity=jwtClaims(result.id_token);
   if(access.iss!==issuer||!hasAudience(access.aud,apiAudience)||!validExpiry(access.exp,now)
     ||identity.iss!==issuer||!hasAudience(identity.aud,clientId)||identity.nonce!==transaction.nonce
     ||!validExpiry(identity.exp,now)||typeof identity.sub!=='string'||!identity.sub)
    throw new Error('OIDC 令牌的签发者、受众或登录状态不匹配');
   accessToken=result.access_token;idToken=result.id_token;expiresAt=Math.min(now+expires,Number(access.exp));
   returnPath=transaction.returnTo;
   return Object.freeze({expiresAt,returnTo:returnPath,subject:identity.sub});
  }

  function getAccessToken(){
   if(!accessToken||expiresAt<=Math.floor(Date.now()/1000)+30)throw new Error('OIDC 登录已过期，请重新登录');
   return accessToken;
  }
  function isAuthenticated(){return !!accessToken&&expiresAt>Math.floor(Date.now()/1000)+30;}
  function signOut(){accessToken=null;idToken=null;expiresAt=0;returnPath='';storage.removeItem(transactionKey);}
  function cleanCallback(url){
   for(const name of ['code','state','error','error_description','iss','session_state'])url.searchParams.delete(name);
   history?.replaceState?.(history.state,'',`${url.pathname}${url.search}${url.hash}`);
  }
  function random(size){
   const bytes=cryptoApi.getRandomValues(new Uint8Array(size));
   return base64url(bytes);
  }
  function base64url(bytes){
   let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
   return root.btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function jwtClaims(token){
   const parts=token.split('.');if(parts.length!==3)throw new Error('OIDC 服务必须返回 JWT 令牌');
   try{
    const payload=parts[1].replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(root.atob(payload+'='.repeat((4-payload.length%4)%4)));
   }catch{throw new Error('OIDC JWT 内容无效')}
  }
  function hasAudience(audience,expected){return Array.isArray(audience)?audience.includes(expected):audience===expected;}
  function validExpiry(exp,now){return Number.isFinite(Number(exp))&&Number(exp)>now;}
  function secureEndpoint(value){try{return secureUrl(new URL(value))}catch{return false}}
  function safeError(value){return String(value).replace(/[\r\n\u0000-\u001f]/g,' ').slice(0,120);}
  return Object.freeze({signIn,handleCallback,getAccessToken,isAuthenticated,signOut});
 }
 async function loadRuntimeConfig(options={}){
  const location=options.location||root.location,base=new URL(options.baseUrl||'/crm-api/v2/',location.href);
  if(base.origin!==location.origin||!secureUrl(base))throw new TypeError('OIDC configuration must load from this site');
  if(!base.pathname.endsWith('/'))base.pathname+='/';
  const fetcher=options.fetch||root.fetch?.bind(root);
  if(typeof fetcher!=='function')throw new TypeError('Fetch is unavailable');
  const response=await fetcher(new URL('public/oidc-config',base).href,{method:'GET',credentials:'omit',
   redirect:'error',cache:'no-store',headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error('OIDC 公共配置读取失败');
  const envelope=await response.json(),config=envelope?.data;
  if(envelope?.code!=='OK'||!config||typeof config.issuer!=='string'||typeof config.clientId!=='string'
    ||typeof config.apiAudience!=='string'||typeof config.redirectUri!=='string')
   throw new Error('OIDC 公共配置无效');
  return Object.freeze(config);
 }
 root.siyueJavaOidc=Object.freeze({create,loadRuntimeConfig});
})(typeof window==='object'?window:globalThis);
