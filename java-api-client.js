/* Stateless same-origin bearer client for the Java API. Access tokens are supplied in memory. */
(function(root){
 'use strict';
 const allowedLeadFilters=new Set(['status','customerId','activityId','campusId','ownerId','source','subject',
  'unassignedOnly','activeOnly','nextFollowFrom','nextFollowUntil','page','size']);
 const filters={
  customers:new Set(['searchType','query','page','size']),activities:new Set(['campusId','view','activityType','status','query','page','size']),
  leads:allowedLeadFilters,opportunities:new Set(['customerId','stage','page','size']),
  tasks:new Set(['status','taskType','batchId','activityId','page','size']),taskBatches:new Set(['status','taskType','activityId','page','size']),
  orders:new Set(['opportunityId','page','size']),serviceTickets:new Set(['status','page','size']),
  ticketTypes:new Set(['campusId','includeInactive']),savedViews:new Set(['resourceType']),
  forms:new Set(['campusId','status','page','size']),formSubmissions:new Set(['status','page','size'])
 };
 const labels={customers:'customer',activities:'activity',leads:'lead',opportunities:'opportunity',
  tasks:'task',taskBatches:'task batch',orders:'order',serviceTickets:'service ticket',
  ticketTypes:'service ticket type',savedViews:'saved view',forms:'marketing form',
  formSubmissions:'form submission'};
 const safeSegment=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);
 function create(options){
  if(!options||typeof options.getAccessToken!=='function')throw new TypeError('Java API requires an in-memory access-token provider');
  const base=new URL(options.baseUrl||'/crm-api/v2/',root.location.href);
  if(base.origin!==root.location.origin||!/^https:$/.test(base.protocol)&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname))
   throw new TypeError('Java API must use same-origin HTTPS');
  if(!base.pathname.endsWith('/'))base.pathname+='/';
  const fetcher=options.fetch||root.fetch?.bind(root);
  if(typeof fetcher!=='function')throw new TypeError('Fetch is unavailable');
  async function request(method,path,{query,body,idempotencyKey,signal,readOnlyPost=false}={}){
   if(!['GET','POST','PUT'].includes(method)||typeof path!=='string'||! /^[A-Za-z0-9_/-]+$/.test(path)||path.startsWith('/')||path.includes('..'))
    throw new TypeError('Invalid Java API request');
   if(readOnlyPost&&(method!=='POST'||!path.endsWith('/preview')))throw new TypeError('Read-only POST is limited to preview endpoints');
   if(method!=='GET'&&!readOnlyPost&&(!safeSegment(idempotencyKey)||idempotencyKey.length<16||idempotencyKey.length>100))
    throw new TypeError('Java API mutations require an Idempotency-Key');
   const url=new URL(path,base);
   if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))throw new TypeError('Java API path escaped its configured base');
   if(query){for(const [key,value] of Object.entries(query)){if(value!==undefined&&value!==null&&value!=='')url.searchParams.set(key,String(value));}}
   const token=await options.getAccessToken();
   if(typeof token!=='string'||!token.trim()||token.length>16384)throw new TypeError('A valid in-memory bearer token is required');
   const headers={Accept:'application/json',Authorization:`Bearer ${token}`};
   if(body!==undefined)headers['Content-Type']='application/json';
   if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
   const response=await fetcher(url.href,{method,headers,credentials:'omit',redirect:'error',cache:'no-store',
    ...(body!==undefined?{body:JSON.stringify(body)}:{}),...(signal?{signal}:{})});
   let envelope;
   try{envelope=await response.json();}catch{throw Object.assign(new Error('Java API returned an invalid response'),{status:response.status});}
   if(!response.ok||envelope?.code!=='OK')throw Object.assign(new Error(envelope?.message||'Java API request failed'),
    {code:envelope?.code||'HTTP_ERROR',status:response.status,traceId:envelope?.traceId||null});
   return envelope.data;
  }
  function list(resource,path,values={}){
   const query={};for(const [key,value] of Object.entries(values)){if(!filters[resource]?.has(key))throw new TypeError(`Unsupported ${labels[resource]||resource} filter`);query[key]=value;}
   return request('GET',path,{query});
  }
  function resourcePath(resource,id,suffix=''){
   if(!safeSegment(id))throw new TypeError(`Invalid ${labels[resource]||resource} identifier`);
   return `crm/${resource}/${encodeURIComponent(id)}${suffix}`;
  }
  function academicPath(resource,id,suffix=''){
   if(!safeSegment(id))throw new TypeError(`Invalid academic ${resource} identifier`);
   return `academic/${resource}/${encodeURIComponent(id)}${suffix}`;
  }
  function studentIdentityPath(customerId,studentId,identifierId){
   if(!safeSegment(studentId)||identifierId!==undefined&&!safeSegment(identifierId))throw new TypeError('Invalid student identity identifier');
   return `${resourcePath('customers',customerId)}/students/${encodeURIComponent(studentId)}/identifiers${identifierId===undefined?'':`/${encodeURIComponent(identifierId)}/deactivate`}`;
  }
  const write=(method,path,body,key)=>request(method,path,{body,idempotencyKey:key});
  const collection=(path,body,key)=>write('POST',path,body,key);
  const preview=(path,body)=>request('POST',path,{body,readOnlyPost:true});
  return Object.freeze({
   identity:Object.freeze({me:()=>request('GET','identity/me')}),
   academic:Object.freeze({
    options:(query={})=>request('GET','academic/options',{query:allowed(query,new Set(['campusId']))}),
    students:Object.freeze({
     list:(query={})=>request('GET','academic/students',{query:allowed(query,new Set(['view','classId','page','size']))}),
     export:(query={})=>request('GET','academic/students/export',{query:allowed(query,new Set(['view','classId']))}),
     create:(input,key)=>collection('academic/students',input,key),
     classes:(id,query={})=>request('GET',academicPath('students',id,'/classes'),{
      query:allowed(query,new Set(['view','page','size']))}),
     transferOptions:(id,query={})=>request('GET',academicPath('students',id,'/transfer-options'),{
      query:allowed(query,new Set(['page','size']))}),
     communications:(id,query={})=>request('GET',academicPath('students',id,'/communications'),{
      query:allowed(query,new Set(['classId']))}),
     communicate:(id,input,key)=>collection(academicPath('students',id,'/communications'),input,key)
    }),
    courses:Object.freeze({
     list:(query={})=>request('GET','academic/courses',{query:allowed(query,new Set(['campusId','search','format','year','term','grade','subject','classType','courseKind','courseType','status','page','size']))}),
     create:(input,key)=>collection('academic/courses',input,key),
     update:(id,input,key)=>write('PUT',academicPath('courses',id),input,key),
     setStatus:(id,input,key)=>write('PUT',academicPath('courses',id,'/status'),input,key)
    }),
    classes:Object.freeze({
     export:(query={})=>request('GET','academic/classes/export',{query:allowed(query,new Set(['view','campusId','teacherId','room','fromAt','untilAt','search','courseType','format','year','term','subject','grade','classType','courseKind','phase']))}),
     detail:id=>request('GET',academicPath('classes',id)),
     students:(id,query={})=>request('GET',academicPath('classes',id,'/students'),{query:allowed(query,new Set(['membership','search','page','size']))}),
     exportStudents:(id,query={})=>request('GET',academicPath('classes',id,'/students/export'),{query:allowed(query,new Set(['membership','search']))}),
     list:(query={})=>request('GET','academic/classes',{
      query:allowed(query,new Set(['view','campusId','teacherId','room','fromAt','untilAt','page','size','search','courseType','format','year','term','subject','grade','classType','courseKind','phase']))}),
     create:(input,key)=>collection('academic/classes',input,key),
     createBatch:(input,key)=>collection('academic/classes/batch',input,key),
     update:(id,input,key)=>write('PUT',academicPath('classes',id),input,key),
     enroll:(id,input,key)=>collection(academicPath('classes',id,'/enrollments'),input,key)
    }),
    enrollments:Object.freeze({batchTransfer:(input,key)=>collection('academic/enrollments/batch-transfer',input,key)}),
    sessions:Object.freeze({
     roster:id=>request('GET',academicPath('sessions',id,'/roster')),
     attendance:(id,input,key)=>collection(academicPath('sessions',id,'/attendance'),input,key),
     correctAttendance:(sessionId,studentId,input,key)=>{
      if(!safeSegment(studentId))throw new TypeError('Invalid academic student identifier');
      return collection(academicPath('sessions',sessionId,`/students/${encodeURIComponent(studentId)}/attendance/corrections`),input,key);
     },
     move:(id,input,key)=>write('PUT',academicPath('sessions',id,'/schedule'),input,key)
    }),
    attendance:Object.freeze({
     students:(query={})=>request('GET','academic/attendance/students',{query:allowed(query,new Set(['campusId','teacherId','courseType','attendanceStatus','search','fromAt','untilAt','page','size']))}),
     exportStudents:(query={})=>request('GET','academic/attendance/students/export',{query:allowed(query,new Set(['campusId','teacherId','courseType','attendanceStatus','search','fromAt','untilAt']))})
    }),
   teachingMetrics:(query={})=>request('GET','academic/teaching-metrics',{
     query:allowed(query,new Set(['month','view']))})
   }),
   commerce:Object.freeze({
    courses:Object.freeze({classes:(id,query={})=>request('GET',commercePath('courses',id,'/classes'),{
     query:allowed(query,new Set(['page','pageSize']))})}),
    products:Object.freeze({
     list:(query={})=>request('GET','commerce/products',{query:allowed(query,new Set(['page','pageSize']))}),
     create:(input,key)=>collection('commerce/products',input,key),
     update:(id,input,key)=>write('PUT',commercePath('products',id),input,key)
    }),
    promotions:Object.freeze({
     list:(query={})=>request('GET','commerce/promotions',{query:allowed(query,new Set(['page','pageSize','type']))}),
     create:(input,key)=>collection('commerce/promotions',input,key),
     update:(id,input,key)=>write('PUT',commercePath('promotions',id),input,key)
    })
   }),
   system:Object.freeze({access:Object.freeze({
    principals:(query={})=>request('GET','system/access/principals',{
     query:allowed({page:query.page??1,size:query.size??50,...query},new Set(['page','size']))}),
    createPrincipal:(input,key)=>collection('system/access/principals',input,key),
    updatePrincipal:(id,input,key)=>{
     if(!safeSegment(id))throw new TypeError('Invalid employee identifier');
     return write('PUT',`system/access/principals/${encodeURIComponent(id)}`,input,key);
    }
   })}),
   crm:Object.freeze({
   workbench:({view='mine',date}={})=>request('GET','crm/workbench',{query:{view,date}}),
    reports:Object.freeze({
     receipts:(query={})=>request('GET','crm/reports/receipts',{query:allowed(query,new Set(['fromAt','untilAt','page','size']))}),
     cashFlow:(query={})=>request('GET','crm/reports/cash-flow',{query:allowed(query,new Set(['fromAt','untilAt','page','size']))})
    }),
    customers:Object.freeze({
     list:(query={})=>list('customers','crm/customers',query),
     get:id=>request('GET',resourcePath('customers',id)),
     create:(input,key)=>collection('crm/customers',input,key),
     addContact:(customerId,input,key)=>collection(`${resourcePath('customers',customerId)}/contacts`,input,key),
     addStudent:(customerId,input,key)=>collection(`${resourcePath('customers',customerId)}/students`,input,key),
     createAndLinkStudent:(customerId,input,key)=>collection(`${resourcePath('customers',customerId)}/students/intake`,input,key),
     identifiers:Object.freeze({
      list:(customerId,studentId,query={})=>request('GET',studentIdentityPath(customerId,studentId),{query:allowed(query,new Set(['status','page','size']))}),
      create:(customerId,studentId,input,key)=>collection(studentIdentityPath(customerId,studentId),input,key),
      deactivate:(customerId,studentId,identifierId,input,key)=>write('PUT',studentIdentityPath(customerId,studentId,identifierId),input,key)
     }),
     touchpoints:Object.freeze({
      list:customerId=>request('GET',resourcePath('customers',customerId,'/touchpoints')),
      create:(customerId,input,key)=>collection(`${resourcePath('customers',customerId)}/touchpoints`,input,key)
     })
    }),
    customerSearch:Object.freeze({
     nameIndexStatus:()=>request('GET','crm/customer-search/student-name-index/status'),
     rebuildNameIndex:(input,key)=>collection('crm/customer-search/student-name-index/rebuild',input,key),
     numberIndexStatus:()=>request('GET','crm/customer-search/student-number-index/status'),
     rebuildNumberIndex:(input,key)=>collection('crm/customer-search/student-number-index/rebuild',input,key)
    }),
    activities:Object.freeze({
     list:(query={})=>list('activities','crm/activities',query),
     audience:(id,query={})=>request('GET',resourcePath('activities',id,'/audience'),{query:allowed(query,new Set(['sourceType','customerId','fromAt','untilAt','taskState','page','size']))}),
     create:(input,key)=>collection('crm/activities',input,key),
     updateMembers:(id,input,key)=>write('PUT',resourcePath('activities',id,'/members'),input,key),
     close:(id,input,key)=>write('PUT',resourcePath('activities',id,'/close'),input,key)
    }),
    imports:Object.freeze({
     preview:input=>preview('crm/imports/preview',input),
     apply:(input,key)=>collection('crm/imports',input,key)
    }),
    leads:Object.freeze({
     list:(query={})=>list('leads','crm/leads',query),
     create:(input,key)=>collection('crm/leads',input,key),
     assign:(id,input,key)=>collection(`${resourcePath('leads',id)}/assign`,input,key),
     release:(id,input,key)=>collection(`${resourcePath('leads',id)}/release`,input,key),
     updateStatus:(id,input,key)=>write('PUT',resourcePath('leads',id,'/status'),input,key),
     followup:(id,input,key)=>collection(`${resourcePath('leads',id)}/followups`,input,key),
     events:id=>request('GET',resourcePath('leads',id,'/events'))
    }),
    leadRouting:Object.freeze({
     rules:(query={})=>request('GET','crm/lead-routing/rules',{query:allowed(query,new Set(['campusId','page','size']))}),
     createRule:(input,key)=>collection('crm/lead-routing/rules',input,key),
     updateRule:(id,input,key)=>write('PUT',resourcePath('lead-routing/rules',id),input,key),
     simulate:id=>request('GET',resourcePath('lead-routing/leads',id,'/simulate')),
     preview:input=>preview('crm/lead-routing/preview',input),
     apply:(input,key)=>collection('crm/lead-routing/apply',input,key),
     queue:(page=1,size=50)=>request('GET','crm/lead-routing/queue',{query:{page,size}})
    }),
    leadPolicy:Object.freeze({
     get:()=>request('GET','crm/lead-policy'),
     update:(input,key)=>write('PUT','crm/lead-policy',input,key),
     preview:(page=1,size=50)=>request('GET','crm/lead-policy/preview',{query:{page,size}}),
     apply:(input,key)=>collection('crm/lead-policy/apply',input,key)
    }),
    opportunities:Object.freeze({
     list:(query={})=>list('opportunities','crm/opportunities',query),
     create:(input,key)=>collection('crm/opportunities',input,key),
     followup:(id,input,key)=>collection(`${resourcePath('opportunities',id)}/followups`,input,key),
     updateStage:(id,input,key)=>write('PUT',resourcePath('opportunities',id,'/stage'),input,key),
     events:id=>request('GET',resourcePath('opportunities',id,'/events'))
    }),
    needs:Object.freeze({
     context:id=>request('GET',resourcePath('opportunity-needs/customers',id,'/context')),
     students:(id,query={})=>request('GET',resourcePath('opportunity-needs/customers',id,'/students'),{query:allowed(query,new Set(['page','size']))}),
     existing:(id,query={})=>request('GET',resourcePath('opportunity-needs/customers',id,'/existing'),{query:allowed(query,new Set(['page','size']))}),
     options:(query={})=>request('GET','crm/opportunity-needs/options',{query:allowed(query,new Set(['customerId']))}),
     optionsFor:id=>request('GET',resourcePath('opportunity-needs',id,'/options')),
     preview:input=>preview('crm/opportunity-needs/preview',input),
     commitPreview:(input,key)=>collection('crm/opportunity-needs/commit-preview',input,key),
     get:id=>request('GET',resourcePath('opportunity-needs',id)),
     updateProfile:(id,input,key)=>write('PUT',resourcePath('opportunity-needs',id,'/profile'),input,key),
     judge:(id,input,key)=>collection(resourcePath('opportunity-needs',id,'/judgments'),input,key),
     assignees:(query={})=>request('GET','crm/opportunity-needs/assignees',{query:allowed(query,new Set(['customerId','opportunityId','page','size']))}),
     assign:(id,input,key)=>write('PUT',resourcePath('opportunity-needs',id,'/assignment'),input,key),
     consultations:(id,query={})=>request('GET',resourcePath('opportunity-needs',id,'/consultations'),{query:allowed(query,new Set(['page','size']))})
    }),
    needConfig:Object.freeze({
     list:(query={})=>request('GET','crm/opportunity-config',{query:allowed(query,new Set(['kind','status','campusId','page','size']))}),
     create:(input,key)=>collection('crm/opportunity-config',input,key),
     update:(id,input,key)=>write('PUT',resourcePath('opportunity-config',id),input,key)
    }),
    needNotifications:Object.freeze({
     list:(query={})=>request('GET','crm/opportunity-notifications',{query:allowed(query,new Set(['status','page','size']))}),
     markRead:(id,input,key)=>write('PUT',resourcePath('opportunity-notifications',id,'/read'),input,key)
    }),
    taskRouting:Object.freeze({
     supervisors:(query={})=>request('GET','crm/task-routing/supervisors',{query:allowed(query,new Set(['campusId','batchId','query','page','size']))}),
     batches:(query={})=>request('GET','crm/task-routing/batches',{query:allowed(query,new Set(['view','campusId','supervisorId','activityId','query','distributionStatus','executionStatus','fromAt','untilAt','page','size']))}),
     globalTasks:(query={})=>request('GET','crm/task-routing/tasks',{query:allowed(query,new Set(['view','campusId','supervisorId','activityId','query','distributionStatus','executionStatus','fromAt','untilAt','page','size','batchId','ownerId','status']))}),
     globalEmployees:(query={})=>request('GET','crm/task-routing/employees',{query:allowed(query,new Set(['view','campusId','supervisorId','activityId','query','distributionStatus','executionStatus','fromAt','untilAt','page','size','batchId','ownerId','status']))}),
     get:id=>request('GET',resourcePath('task-routing/batches',id)),
     tasks:(id,query={})=>request('GET',resourcePath('task-routing/batches',id,'/tasks'),{query:allowed(query,new Set(['status','ownerId','page','size']))}),
     employees:(id,query={})=>request('GET',resourcePath('task-routing/batches',id,'/employees'),{query:allowed(query,new Set(['page','size']))}),
     assignees:(id,query={})=>request('GET',resourcePath('task-routing/batches',id,'/assignees'),{query:allowed(query,new Set(['query','page','size']))}),
     events:(id,query={})=>request('GET',resourcePath('task-routing/batches',id,'/events'),{query:allowed(query,new Set(['page','size']))}),
     previewCreate:input=>preview('crm/task-routing/batches/preview',input),
     commitCreate:(input,key)=>collection('crm/task-routing/batches/commit',input,key),
     previewAllocation:(id,input)=>preview(resourcePath('task-routing/batches',id,'/allocation/preview'),input),
     commitAllocation:(id,input,key)=>collection(resourcePath('task-routing/batches',id,'/allocation/commit'),input,key),
     previewRecall:(id,input)=>preview(resourcePath('task-routing/batches',id,'/recall/preview'),input),
     commitRecall:(id,input,key)=>collection(resourcePath('task-routing/batches',id,'/recall/commit'),input,key),
     previewTransfer:(id,input)=>preview(resourcePath('task-routing/batches',id,'/transfer/preview'),input),
     commitTransfer:(id,input,key)=>collection(resourcePath('task-routing/batches',id,'/transfer/commit'),input,key),
     previewSchedule:(id,input)=>preview(resourcePath('task-routing/batches',id,'/schedule/preview'),input),
     commitSchedule:(id,input,key)=>collection(resourcePath('task-routing/batches',id,'/schedule/commit'),input,key),
     previewCancel:(id,input)=>preview(resourcePath('task-routing/batches',id,'/cancel/preview'),input),
     commitCancel:(id,input,key)=>collection(resourcePath('task-routing/batches',id,'/cancel/commit'),input,key)
    }),
    tasks:Object.freeze({
     list:(query={})=>list('tasks','crm/tasks',query),
     assignees:(query={})=>request('GET','crm/tasks/assignees',{query:allowed(query,new Set(['campusId','taskType','query','page','size']))}),
     context:id=>request('GET',resourcePath('tasks',id,'/context')),
     opportunities:(id,query={})=>request('GET',resourcePath('tasks',id,'/opportunities'),{query:allowed(query,new Set(['page','size']))}),
     customerStudents:(customerId,query={})=>{
      if(!safeSegment(customerId))throw new TypeError('Invalid customer identifier');
      return request('GET','crm/tasks/targets',{query:{customerId,...allowed(query,new Set(['page','size']))}});
     },
     batches:(query={})=>list('taskBatches','crm/tasks/batches',query),
     previewBatch:input=>preview('crm/tasks/batches/preview',input),
     createBatch:(input,key)=>collection('crm/tasks/batches',input,key),
     createBatchChecked:(input,expectedPreview,key)=>collection('crm/tasks/batches/commit-preview',{
      input,expectedPreview
     },key),
     update:(id,input,key)=>write('PUT',resourcePath('tasks',id),input,key),
     complete:(id,input,key)=>collection(`${resourcePath('tasks',id)}/complete`,input,key)
    }),
    savedViews:Object.freeze({
     list:(resourceType='leads')=>list('savedViews','crm/saved-views',{resourceType}),
     create:(input,key)=>collection('crm/saved-views',input,key),
     update:(id,input,key)=>write('PUT',resourcePath('saved-views',id),input,key),
     remove:(id,input,key)=>collection(`${resourcePath('saved-views',id)}/delete`,input,key)
    }),
  orders:Object.freeze({
     classQuotes:(query={})=>request('GET','crm/orders/class-quotes',{query:allowed(query,new Set(['opportunityId','page','size']))}),
     list:(query={})=>list('orders','crm/orders',query),
     forCustomer:(customerId,query={})=>{if(!safeSegment(customerId))throw new TypeError('Invalid customer identifier');return list('orders',`crm/orders/customer/${encodeURIComponent(customerId)}`,query);},
     create:(input,key)=>collection('crm/orders',input,key),
     receipts:(id)=>request('GET',resourcePath('orders',id,'/receipts')),
     recordReceipt:(id,input,key)=>collection(`${resourcePath('orders',id)}/receipts`,input,key)
    }),
    serviceTickets:Object.freeze({
     list:(query={})=>list('serviceTickets','crm/service-tickets',query),
     types:(query={})=>list('ticketTypes','crm/service-ticket-types',query),
     createType:(input,key)=>collection('crm/service-ticket-types',input,key),
     updateType:(id,input,key)=>{
      if(!safeSegment(id))throw new TypeError('Invalid service ticket type identifier');
      return write('PUT',`crm/service-ticket-types/${encodeURIComponent(id)}`,input,key);
     },
     create:(input,key)=>collection('crm/service-tickets',input,key),
     assign:(id,input,key)=>write('PUT',resourcePath('service-tickets',id,'/assign'),input,key),
     followup:(id,input,key)=>collection(`${resourcePath('service-tickets',id)}/followups`,input,key),
     close:(id,input,key)=>write('PUT',resourcePath('service-tickets',id,'/close'),input,key),
     events:id=>request('GET',resourcePath('service-tickets',id,'/events')),
     linkRefund:(id,input,key)=>write('PUT',resourcePath('service-tickets',id,'/refund-request'),input,key)
    }),
    forms:Object.freeze({
     list:(query={})=>list('forms','crm/forms',query),
     create:(input,key)=>collection('crm/forms',input,key),
     update:(id,input,expectedVersion,key)=>request('PUT',resourcePath('forms',id),{
      query:{expectedVersion},body:input,idempotencyKey:key
     }),
     publish:(id,input,key)=>collection(`${resourcePath('forms',id)}/publish`,input,key),
     submissions:(id,query={})=>list('formSubmissions',`${resourcePath('forms',id)}/submissions`,query),
     reviewSubmission:(id,input,key)=>{
      if(!safeSegment(id))throw new TypeError('Invalid form submission identifier');
      return collection(`crm/form-submissions/${id}/review`,input,key);
     },
     activityForms:id=>request('GET',resourcePath('activities',id,'/forms')),
     linkActivityForm:(id,input,key)=>collection(`${resourcePath('activities',id)}/forms`,input,key)
    }),
    attribution:Object.freeze({
     requestsForOrder:(id,query={})=>request('GET',`${resourcePath('orders',id)}/attribution-requests`,{
      query:allowed(query,new Set(['page','size']))}),
     adjustmentsForOrder:id=>request('GET',`${resourcePath('orders',id)}/attribution-adjustments`),
     requestCorrection:(id,input,key)=>collection(`${resourcePath('orders',id)}/attribution-requests`,input,key),
     review:(id,input,key)=>{
      if(!safeSegment(id))throw new TypeError('Invalid attribution request identifier');
      return write('PUT',`crm/attribution-requests/${id}/review`,input,key);
     },
     events:id=>{
      if(!safeSegment(id))throw new TypeError('Invalid attribution request identifier');
      return request('GET',`crm/attribution-requests/${id}/events`);
     }
    })
   })
  });
 }
 function allowed(values,allowlist){const query={};for(const [key,value] of Object.entries(values)){if(!allowlist.has(key))throw new TypeError('Unsupported query filter');query[key]=value;}return query;}
 function commercePath(resource,id,suffix=''){if(!safeSegment(id))throw new TypeError(`Invalid commerce ${resource} identifier`);return `commerce/${resource}/${encodeURIComponent(id)}${suffix}`;}
 async function createFromOidc(options={}){
  const oidcModule=root.siyueJavaOidc;
  if(!oidcModule)throw new TypeError('Java OIDC client is unavailable');
  const baseUrl=options.baseUrl||'/crm-api/v2/',config=await oidcModule.loadRuntimeConfig({
   baseUrl,fetch:options.fetch,location:options.location
  });
  const dependencies={...(options.oidcDependencies||{})};
  if(options.fetch)dependencies.fetch=options.fetch;
  if(options.location)dependencies.location=options.location;
  const auth=oidcModule.create(config,dependencies),callback=await auth.handleCallback();
  const api=create({baseUrl,fetch:options.fetch,getAccessToken:()=>auth.getAccessToken()});
  const identity=auth.isAuthenticated()?await api.identity.me():null;
  return Object.freeze({api,auth,identity,callback,signIn:settings=>auth.signIn(settings),
   signOut:()=>auth.signOut(),refreshIdentity:()=>api.identity.me()});
 }
 root.siyueJavaApiClient=Object.freeze({create,createFromOidc});
})(typeof window==='object'?window:globalThis);
