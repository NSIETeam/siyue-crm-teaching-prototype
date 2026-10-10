'use strict';
// Quick entry prepares the same server operation as the web form. It never commits.
const fs=require('node:fs'),path=require('node:path');
const auth=require('./auth-client.cjs'),business=require('./business-client.cjs');
const prohibited=new Set(['__proto__','prototype','constructor']);
const aliases={
 '线索':'lead.create','登记线索':'lead.create','批量线索':'lead.import','建班':'class.create','批量建班':'class.batchCreate',
 '排课':'class.schedule','报名':'enrollment.create','批量报名':'enrollment.batchCreate','课程':'course.create','校区':'campus.create'
};
const flags={name:'name',phone:'phone',source:'source',grade:'grade',subject:'subject',campus:'campusId',course:'courseId',class:'classId',student:'studentId',teacher:'teacherId',owner:'ownerId',room:'room',capacity:'capacity',price:'priceYuan',reason:'reason'};
const names={'班级名称':'name','教室名称':'name','姓名':'name','学生姓名':'name','手机号':'phone','家长手机号':'phone','年级':'grade','学科':'subject','来源':'source','备注':'note','校区':'campusId','课程':'courseId','课程名称':'courseId','班级':'classId','教室':'room','老师':'teacherId','容量':'capacity','学生':'studentId','优惠':'couponId','推荐人':'referrerStudentId','讲次':'lessonId','日期':'date','时间':'time','标题':'title','时长分钟':'durationMinutes'};
const batch={
 'enrollment.batchCreate':{key:'rows',columns:['学生','姓名','手机号','年级']},
 'class.batchCreate':{key:'items',columns:['班级名称','课程','校区','教室','老师','容量']},
 'class.schedule':{key:'sessions',columns:['讲次','日期','时间']},
 'lead.import':{key:'items',columns:['姓名','手机号','来源','校区','年级','学科']},
 'course.create':{key:'lessons',columns:['标题','时长分钟']},
 'campus.create':{key:'rooms',columns:['教室名称','容量']}
};
const refs={campusId:'campuses',courseId:'courses',classId:'classes',targetClassId:'classes',studentId:'students',referrerStudentId:'students',originLeadId:'leads',leadId:'leads',teacherId:'directory',ownerId:'directory',staffId:'directory',employeeId:'directory',orderId:'orders',enrollmentId:'enrollments',refundId:'refunds',formId:'forms',couponId:'coupon'};
function parseArguments(args){
 const result={set:[]};
 for(let i=0;i<args.length;i++){
  const flag=args[i],key=flag?.slice(2),value=args[i+1];
  if(!flag?.startsWith('--')||value===undefined||value.startsWith('--')||!['input','rows','out','format','set',...Object.keys(flags)].includes(key))throw auth.failure('INVALID_ARGUMENT','参数无效；使用 --set 字段=值，或运行 help 查看快填用法');
  if(key==='set')result.set.push(value);else{if(Object.hasOwn(result,key))throw auth.failure('INVALID_ARGUMENT','重复参数 '+flag);result[key]=value;}i++;
 }
 return result;
}
function fieldPath(value){
 const parts=value.split('.');
 if(!parts.length||parts.some(p=>!p||prohibited.has(p)||!/^([A-Za-z_][A-Za-z0-9_]*|0|[1-9][0-9]{0,2})$/.test(p)))throw auth.failure('INVALID_FIELD','字段路径无效：'+value);
 return parts;
}
function assign(object,key,value){
 const parts=fieldPath(key);let cursor=object;
 for(let i=0;i<parts.length-1;i++){
  const part=parts[i],array=/^\d+$/.test(parts[i+1]);
  if(cursor[part]===undefined)cursor[part]=array?[]:{};
  if(!cursor[part]||typeof cursor[part]!=='object'||Array.isArray(cursor[part])!==array)throw auth.failure('INVALID_FIELD','字段路径与已有内容冲突：'+key);
  cursor=cursor[part];
 }
 cursor[parts.at(-1)]=value;
}
function guard(value){
 if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){if(prohibited.has(key))throw auth.failure('INVALID_FIELD','不允许的字段名');guard(child);}
}
function readText(file){let fd;try{fd=fs.openSync(path.resolve(file),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const st=fs.fstatSync(fd);if(!st.isFile()||st.size>1048576)throw auth.failure('INVALID_INPUT_FILE','填写文件必须小于 1 MB');return new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(fd));}finally{if(fd!==undefined)fs.closeSync(fd);}}
function writeText(file,text){const fd=fs.openSync(path.resolve(file),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function csv(text){
 text=text.replace(/^\uFEFF/,'');let rows=[],cells=[],cell='',quoted=false,closed=false,line=1,start=1;
 const pushCell=()=>{cells.push(cell);cell='';closed=false;};
 const pushRow=()=>{pushCell();if(cells.some(v=>v.trim()))rows.push({line:start,cells});cells=[];start=line+1;};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else{cell+=c;if(c==='\n')line++;}continue;}
  if(c==='"'){if(cell||closed)throw auth.failure('INVALID_CSV',`CSV 第 ${line} 行引号位置无效`);quoted=true;continue;}
  if(c===','){pushCell();continue;}
  if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;pushRow();line++;continue;}
  if(closed)throw auth.failure('INVALID_CSV',`CSV 第 ${line} 行引号后须为逗号或换行`);cell+=c;
 }
 if(quoted)throw auth.failure('INVALID_CSV',`CSV 第 ${start} 行引号未闭合`);
 if(cell||cells.length||closed)pushRow();
 if(rows.length<2)throw auth.failure('INVALID_CSV','CSV 需要表头和至少一行填写数据');
 const header=rows.shift().cells.map(v=>v.trim());
 if(header.some(x=>!x)||new Set(header).size!==header.length)throw auth.failure('INVALID_CSV','CSV 表头不能空白或重复');
 for(const row of rows)if(row.cells.length!==header.length)throw auth.failure('INVALID_CSV',`CSV 第 ${row.line} 行有 ${row.cells.length} 列，表头为 ${header.length} 列；含逗号的内容须加双引号`);
 return {header,rows};
}
function cents(value){
 const text=String(value).normalize('NFKC').trim();
 if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw auth.failure('INVALID_MONEY','金额须为非负数，最多两位小数，不接受科学计数法');
 const [whole,fraction='']=text.split('.'),number=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(number))throw auth.failure('INVALID_MONEY','金额超出安全整数范围');return number;
}
function displayCandidate(row){return {id:row.id||row.leadId,name:row.name||row.title||row.student||row.id,...(row.campus?{campus:row.campus}:{}),...(row.grade?{grade:row.grade}:{}),...(row.subject?{subject:row.subject}:{}),...(row.employeeNo?{employeeNo:row.employeeNo}:{})};}
function resolve(value,rows,at,errors,corrections){
 const idMatches=rows.filter(r=>(r.id||r.leadId)===value);if(idMatches.length===1)return value;
 const matches=rows.filter(r=>(r.name||r.title)===value||r.employeeNo===value);
 if(matches.length===1){const id=matches[0].id||matches[0].leadId;const selected=displayCandidate(matches[0]),detail=[selected.campus,selected.grade,selected.subject,selected.employeeNo].filter(Boolean).join(' · ');corrections.push({path:at,kind:'reference',message:'已关联：'+selected.name+(detail?'（'+detail+'）':''),reference:selected});return id;}
 errors.push({path:at,code:matches.length?'AMBIGUOUS_REFERENCE':'REFERENCE_NOT_FOUND',message:matches.length?'存在同名记录，请用下列 ID 明确选择':'当前授权范围内找不到此名称或 ID，请核对拼写或用 get state 查询',...(matches.length?{candidates:matches.slice(0,20).map(displayCandidate),candidateCount:matches.length}:{})});return value;
}
function schemaForInput(schema,input){
 const section=typeof input?.section==='string'?input.section.trim():input?.section;
 function select(rule={}){
  if(rule['x-fieldsBySection'])rule=Object.hasOwn(rule['x-fieldsBySection'],section)?rule['x-fieldsBySection'][section]:{type:'object',properties:{},additionalProperties:false};
  const result={...rule};
  if(rule.properties)result.properties=Object.fromEntries(Object.entries(rule.properties).map(([key,child])=>[key,select(child)]));
  if(rule.items)result.items=select(rule.items);
  if(rule.additionalProperties&&typeof rule.additionalProperties==='object')result.additionalProperties=select(rule.additionalProperties);
  return result;
 }
 return select(schema);
}
function normalize(input,schema,state){
 schema=schemaForInput(schema,input);
 const errors=[],corrections=[];
 function visit(value,rule={},at='',context={},key=''){
  if(rule.type==='object'&&value&&typeof value==='object'&&!Array.isArray(value)){
   const result={};
   // Resolve parent references first; lesson titles belong to the selected course/class only.
   for(const name of ['campusId','courseId','classId','targetClassId'])if(Object.hasOwn(value,name))result[name]=visit(value[name],rule.properties?.[name],at?at+'.'+name:name,context,name);
   const local={...context,...result};
   for(const [name,child]of Object.entries(value)){
    if(Object.hasOwn(result,name)||name.endsWith('Cents')&&Object.hasOwn(value,name.slice(0,-5)+'Yuan')&&(child===null||child===''))continue;
    if(name.endsWith('Yuan')&&rule.properties?.[name.slice(0,-4)+'Cents']){
     const target=name.slice(0,-4)+'Cents',field=at?at+'.'+name:name;
     if(Object.hasOwn(value,target)&&value[target]!==null&&value[target]!==''){errors.push({path:field,code:'DUPLICATE_MONEY',message:'元与分只能填写一种'});continue;}
     try{result[target]=cents(child);corrections.push({path:field,kind:'money',message:`按元转为分：${result[target]}`});}catch(e){errors.push({path:field,code:e.code,message:e.message});}continue;
    }
    result[name]=visit(child,rule.properties?.[name]||(typeof rule.additionalProperties==='object'?rule.additionalProperties:{}),at?at+'.'+name:name,local,name);
   }
   return result;
  }
  if(rule.type==='array'&&Array.isArray(value))return Array.from(value,(x,i)=>visit(x,rule.items,`${at}.${i}`,context,key.endsWith('Ids')?key.slice(0,-1):key));
  const before=value;
  if(typeof value==='string'){
   value=value.trim();
   if(key.toLowerCase().includes('phone'))value=value.normalize('NFKC').replace(/[\s()\-]/g,'').replace(/^(?:\+86|0086)(?=1\d{10}$)/,'');
   if(['integer','number'].includes(rule.type)){const numeric=value.normalize('NFKC');if(numeric!==''&&/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(numeric))value=Number(numeric);}
   if(rule.type==='boolean'){if(['true','是'].includes(value))value=true;else if(['false','否'].includes(value))value=false;}
   if(before!==value)corrections.push({path:at,kind:'format',message:'已规范空白、数字、手机号或布尔格式'});
  }
  if(typeof value==='string'&&value){
   const resource=refs[key];let rows;
   if(resource)rows=resource==='coupon'?state.activities?.coupon||[]:state[resource]||[];
   if(key==='teacherId')rows=rows.filter(r=>r.roleIds?.includes('teacher')&&!r.disabled);
   if(key==='lessonId'){
    const classId=context.classId,courseId=context.courseId||(state.classes||[]).find(c=>c.id===classId)?.courseId;
    rows=(state.courses||[]).find(c=>c.id===courseId)?.lessons||[];
   }
   if(rows)value=resolve(value,rows,at,errors,corrections);
  }
  return value;
 }
 const value=visit(input,schema);validate(value,schema,'',errors);
 return {input:value,errors,corrections};
}
function validate(value,rule,at,errors){
 const error=(code,message)=>errors.push({path:at||'input',code,message});
 if(rule.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value))return error('OBJECT_REQUIRED','须填写对象');
  for(const key of rule.required||[])if(value[key]===undefined||value[key]===null||value[key]==='')errors.push({path:at?at+'.'+key:key,code:'REQUIRED',message:'请填写 '+(rule.properties?.[key]?.title||key)});
  for(const [key,child]of Object.entries(value)){const next=rule.properties?.[key]||(typeof rule.additionalProperties==='object'?rule.additionalProperties:null),field=at?at+'.'+key:key;if(next)validate(child,next,field,errors);else if(rule.additionalProperties===false)errors.push({path:field,code:'UNKNOWN_FIELD',message:'当前服务器不支持此字段，请用 describe 查看字段'});}return;
 }
 if(rule.type==='array'){
  if(!Array.isArray(value))return error('ARRAY_REQUIRED','须填写数组；批量填写可使用 --rows CSV文件');
  if(value.length<(rule.minItems||0)||value.length>(rule.maxItems??500))error('ARRAY_LENGTH',`条数应在 ${rule.minItems||0} 至 ${rule.maxItems??500} 之间`);
  if(rule.uniqueItems&&new Set(value.map(v=>JSON.stringify(v))).size!==value.length)error('DUPLICATE_VALUE','列表存在重复值，请删除重复行');
  value.forEach((v,i)=>validate(v,rule.items||{},`${at}.${i}`,errors));return;
 }
 if(rule.type==='string'&&(typeof value!=='string'||value.length<(rule.minLength||0)||value.length>(rule.maxLength??10000)||value.includes('\0')))error('INVALID_TEXT','文字长度或格式无效');
 else if(rule.type==='string'&&rule.pattern&&!new RegExp(rule.pattern).test(value))error('INVALID_FORMAT','格式不符合要求'+(at.toLowerCase().includes('phone')?'，请填写 11 位有效手机号':''));
 if(rule.type==='integer'&&!Number.isSafeInteger(value))error('INTEGER_REQUIRED','请填写整数');
 if(rule.type==='number'&&(typeof value!=='number'||!Number.isFinite(value)))error('NUMBER_REQUIRED','请填写有限数字');
 if(rule.type==='boolean'&&typeof value!=='boolean')error('BOOLEAN_REQUIRED','请填写 true / false（或是 / 否）');
 if(typeof value==='number'&&(value<(rule.minimum??-Infinity)||value>(rule.maximum??Infinity)))error('OUT_OF_RANGE',`应在 ${rule.minimum??'-∞'} 至 ${rule.maximum??'∞'} 之间`);
 if(rule.enum&&!rule.enum.includes(value))error('INVALID_OPTION','可选值：'+rule.enum.join('、'));
 if(Object.hasOwn(rule,'const')&&value!==rule.const)error('INVALID_CONSTANT','此规则必须为 '+JSON.stringify(rule.const));
}
function enrollmentChecks(input,id,errors){
 if(!['enrollment.create','enrollment.batchCreate'].includes(id))return;
 const rows=id==='enrollment.create'?[input]:input.rows;
 if(id==='enrollment.batchCreate'&&(input.rows!==undefined)===(input.studentIds!==undefined))errors.push({path:'rows',code:'CHOOSE_ONE',message:'rows 与 studentIds 必须且只能选择一种'});
 const seen=new Map();
 if(!Array.isArray(rows))return;
 for(const [index,row]of rows.entries()){
  if(!row||typeof row!=='object')continue;
  const at=id==='enrollment.create'?'input':`rows.${index}`;
  if((row.studentId!==undefined)===(row.studentDraft!==undefined))errors.push({path:at,code:'CHOOSE_ONE',message:'已有学生填 studentId（名称或 ID）；新生填 studentDraft，二者只能选一个'});
  const key=row.studentId||row.studentDraft&&`${row.studentDraft.name}|${row.studentDraft.phone}`;
  if(key&&seen.has(key))errors.push({path:at,code:'DUPLICATE_STUDENT',message:`与第 ${seen.get(key)+1} 条学生重复，请保留一条`});else if(key)seen.set(key,index);
 }
}
function leadChecks(input,id,errors){
 if(!['lead.create','lead.import'].includes(id))return;
 const rows=id==='lead.create'?[input]:input.items,seen=new Set();
 if(!Array.isArray(rows))return;
 for(const [index,row]of rows.entries()){
  if(!row||typeof row!=='object')continue;
  const at=id==='lead.create'?'':`items.${index}.`;
  if(row.phone!==undefined&&!/^1[3-9][0-9]{9}$/.test(row.phone))errors.push({path:at+'phone',code:'INVALID_PHONE',message:'请填写 11 位有效手机号'});
  if(row.name&&row.phone){const key=row.name+'|'+row.phone;if(seen.has(key))errors.push({path:at+'name',code:'DUPLICATE_LEAD',message:'同一姓名和手机号重复，请保留一条'});seen.add(key);}
 }
}
function example(rule){
 if(rule.type==='object')return Object.fromEntries((rule.required||[]).map(key=>[key,example(rule.properties[key])]));
 if(rule.type==='array')return [example(rule.items||{})];
 return rule.type==='integer'||rule.type==='number'||rule.type==='boolean'?null:'';
}
async function context(id,needsState=true){
 const session=auth.readSession(),me=await auth.authenticated('v1/auth/me');
 if(me.user.mustChangePassword)throw auth.failure('PASSWORD_CHANGE_REQUIRED','请先运行 siyue-cli passwd 修改初始密码');
 const catalog=await auth.authenticated('v1/catalog'),operationId=aliases[id]||id,ops=catalog.operations||[];
 const matches=ops.filter(o=>o.id===operationId);const op=matches[0];
 if(!op||!op.implemented)throw auth.failure('FORBIDDEN','操作不存在、尚未实现或当前账号无此权限；使用 list 查找可用指令');
 return {session,me,op,snapshot:needsState?await auth.authenticated('v1/state'):null};
}
async function template(id,options){
 if(!options.out||Object.keys(options).some(k=>!['out','format','set'].includes(k))||options.set.length)throw auth.failure('INVALID_ARGUMENT','用法：template <操作> --out <新文件> [--format json|csv]');
 const {op}=await context(id,false),format=options.format||'json';let content;
 if(format==='csv'){if(!batch[op.id])throw auth.failure('UNSUPPORTED_CSV','此操作没有批量 CSV 模板，请使用 JSON 模板');const columns=batch[op.id].columns;content='\uFEFF'+columns.join(',')+'\n'+columns.map(()=> '').join(',')+'\n';}
 else if(format==='json'){
  content=example(op.inputSchema);
  if(op.id==='enrollment.create')content.studentDraft={name:'',phone:''};
  if(op.id==='enrollment.batchCreate')content.rows=[{studentDraft:{name:'',phone:''}}];
  content=JSON.stringify(content,null,2)+'\n';
 }else throw auth.failure('INVALID_ARGUMENT','模板格式仅支持 json 或 csv');
 writeText(options.out,content);
 return {operationId:op.id,templateFile:path.resolve(options.out),format,commit:false,next:format==='csv'?'填写 CSV，使用 check/fill --rows；班级排课和批量报名同时传 --class，课程讲次同时填写课程字段':'填写文件后使用 check/fill --input；可用 --set 字段=值覆盖填写字段',notes:'空值须填写；名称只作唯一精确匹配。数字字段使用阿拉伯数字，手机号保持文本。模板不包含真实业务资料。'};
}
function prepare(op,options,state){
 let input=options.input?business.read(options.input):{};guard(input);
 if(!input||typeof input!=='object'||Array.isArray(input))throw auth.failure('INVALID_INPUT','JSON 顶层须为对象');
 const changes=[],seen=new Set();
 for(const [key,target]of Object.entries(flags))if(options[key]!==undefined){let field=target;if(op.id==='enrollment.create'&&['name','phone','grade'].includes(field))field='studentDraft.'+field;changes.push([field,options[key]]);}
 for(const item of options.set){const mark=item.indexOf('=');if(mark<1)throw auth.failure('INVALID_ARGUMENT','--set 须为 字段=值');changes.push([item.slice(0,mark),item.slice(mark+1)]);}
 for(const [field,value]of changes){if(seen.has(field))throw auth.failure('INVALID_FIELD','同一字段不能重复指定：'+field);seen.add(field);assign(input,field,value);}
 let rowLines={};
 if(options.rows){
  const spec=batch[op.id];if(!spec)throw auth.failure('UNSUPPORTED_CSV','此操作暂不支持 --rows；可用 JSON 或 --set 填写');
  if(input[spec.key]!==undefined)throw auth.failure('INVALID_ARGUMENT',`JSON/参数与 CSV 不能同时填写 ${spec.key}`);
  const parsed=csv(readText(options.rows));
  const headers=parsed.header.map(h=>Object.hasOwn(names,h)?names[h]:h).map(h=>op.id==='enrollment.batchCreate'&&['name','phone','grade'].includes(h)?'studentDraft.'+h:h);
  if(new Set(headers).size!==headers.length)throw auth.failure('INVALID_CSV','CSV 表头对应同一字段，请删除重复列');
  headers.forEach(fieldPath);
  input[spec.key]=parsed.rows.map((row,index)=>{
   rowLines[`${spec.key}.${index}`]=row.line;const item={};
   row.cells.forEach((value,column)=>{
    if(value.trim()==='')return;let key=headers[column];
    if(op.id==='enrollment.batchCreate'&&['name','phone','grade'].includes(key))key='studentDraft.'+key;
    assign(item,key,value);
   });return item;
  });
 }
 const result=normalize(input,op.inputSchema,state);enrollmentChecks(result.input,op.id,result.errors);leadChecks(result.input,op.id,result.errors);
 result.warnings=op.id==='class.schedule'&&(state.classes||[]).some(c=>c.id===result.input.classId&&c.schedule?.length)?['排课保存的是完整排期；未列出的可调整课次会被移除。修改已有课次时须保留其 id，提交前核对预览中的完整课表。']:[];
 for(const row of [...result.errors,...result.corrections]){const prefix=Object.keys(rowLines).find(p=>row.path===p||row.path.startsWith(p+'.'));if(prefix)row.line=rowLines[prefix];}
 return result;
}
async function run(command,id,options){
 if(command==='template')return template(id,options);
 if(options.format)throw auth.failure('INVALID_ARGUMENT','--format 仅用于 template');
 if(command==='fill'&&!options.out)throw auth.failure('INVALID_ARGUMENT','fill 需要 --out 新计划文件；只检查可使用 check');
 if(command==='check'&&options.out)throw auth.failure('INVALID_ARGUMENT','check 不写文件；需要计划文件请使用 fill --out');
 const ctx=await context(id),result=prepare(ctx.op,options,ctx.snapshot.state);
 if(result.errors.length)return {valid:false,commit:false,operationId:ctx.op.id,errors:result.errors,corrections:result.corrections,warnings:result.warnings,next:'根据 path / CSV line 修改原填写文件或字段，再运行同一条 check/fill；没有提交任何业务'};
 try{
  if(command==='check'){
   const preview=await auth.authenticated('v1/operations/'+ctx.op.id+'/preview',{method:'POST',body:{input:result.input,expectedRevision:ctx.snapshot.revision}});
   return {valid:true,commit:false,operationId:ctx.op.id,corrections:result.corrections,warnings:result.warnings,input:result.input,preview:preview.result,next:'校验通过；使用相同填写参数运行 fill --out 新计划文件，然后 execute 提交'};
  }
  const planned=await business.planInput(ctx.op.id,result.input,options.out,ctx);
  return {valid:true,...planned,corrections:result.corrections,warnings:result.warnings,input:result.input};
 }catch(e){
  if(e.status>=400&&e.status<500&&![401,403,429].includes(e.status))return {valid:false,commit:false,operationId:ctx.op.id,errors:[{path:'input',code:e.code,message:e.message}],corrections:result.corrections,warnings:result.warnings,next:'服务器业务校验未通过，请修正后重新预览；没有提交任何业务'};
  throw e;
 }
}
module.exports={run,parseArguments,prepare,normalize,validate,csv,cents,assign,example};
