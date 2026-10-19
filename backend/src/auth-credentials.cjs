'use strict';
const crypto=require('node:crypto');
const params={N:32768,r:8,p:1,maxmem:64*1024*1024};
function hashPassword(password){const salt=crypto.randomBytes(32).toString('hex');return {algorithm:'scrypt',salt,hash:crypto.scryptSync(password,salt,64,params).toString('hex')};}
const dummy=hashPassword(crypto.randomBytes(32).toString('hex'));
function verifyPassword(password,stored=dummy){const valid=stored&&stored.algorithm==='scrypt'&&/^[0-9a-f]{64}$/.test(stored.salt)&&/^[0-9a-f]{128}$/.test(stored.hash);const target=valid?stored:dummy;const derived=crypto.scryptSync(password,target.salt,64,params);return crypto.timingSafeEqual(derived,Buffer.from(target.hash,'hex'))&&!!valid;}
function initialPassword(){return crypto.randomBytes(24).toString('base64url')+'Aa1!';}
function strongPassword(value,username=''){return typeof value==='string'&&value.trim().length>=10&&Buffer.byteLength(value)<=256&&!/[\u0000-\u001f\u007f]/.test(value)&&(!username||!value.toLowerCase().includes(username.toLowerCase()));}
function tokenHash(token){return crypto.createHash('sha256').update(token).digest('hex');}
function generateUsername(name,employeeNo,users){let stem=employeeNo?'sy-'+employeeNo.normalize('NFKC').toLowerCase().replace(/[^a-z0-9_-]/g,''):name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');if(!stem||stem==='sy-')stem='sy-'+[...name].slice(0,5).map(c=>c.codePointAt(0).toString(16)).join('');if(stem.length<3)stem='sy-'+stem;stem=stem.slice(0,44);let result=stem;for(let suffix=2;users.some(x=>x.username===result);suffix++)result=stem+'-'+suffix;return result;}
module.exports={hashPassword,verifyPassword,initialPassword,strongPassword,tokenHash,generateUsername};
