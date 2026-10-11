'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createCaptchaService}=require('../src/auth-captcha.cjs');
test('captcha exposes only raster PNG pixels, checks an exact six-digit answer and consumes every attempt',()=>{
 const captcha=createCaptchaService({randomInt:()=>7});const first=captcha.issue();assert.match(first.id,/^[A-Za-z0-9_-]{32}$/);assert.match(first.binding,/^[A-Za-z0-9_-]{43}$/);
 assert.match(first.image,/^data:image\/png;base64,/);const png=Buffer.from(first.image.split(',')[1],'base64');assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(png.readUInt32BE(16),400);assert.equal(png.readUInt32BE(20),128);const types=[];for(let p=8;p<png.length;){const length=png.readUInt32BE(p);types.push(png.subarray(p+4,p+8).toString());p+=length+12;}assert.deepEqual(types,['IHDR','IDAT','IEND']);assert.ok(!png.includes(Buffer.from('<path')));
 assert.equal(captcha.consume(first.id,'777777',first.binding),true);assert.equal(captcha.consume(first.id,'777777',first.binding),false);
 const incorrect=captcha.issue();assert.equal(captcha.consume(incorrect.id,'123456',incorrect.binding),false);assert.equal(captcha.consume(incorrect.id,'777777',incorrect.binding),false);
 const missing=captcha.issue();assert.equal(captcha.consume(missing.id,undefined,missing.binding),false);assert.equal(captcha.consume(missing.id,'777777',missing.binding),false);
});
test('captcha is cookie-bound, refresh retires the old challenge, and expiry and capacity are enforced',()=>{
 let now=Date.now();const captcha=createCaptchaService({randomInt:()=>0,now:()=>now,maxEntries:1});const first=captcha.issue();assert.throws(()=>captcha.issue(),error=>error.code==='RATE_LIMITED');
 const refreshed=captcha.issue(first.binding);assert.equal(captcha.consume(first.id,'000000',first.binding),false);assert.equal(captcha.consume(refreshed.id,'000000',refreshed.binding),true);
 const stolen=captcha.issue();assert.equal(captcha.consume(stolen.id,'000000','x'.repeat(43)),false);assert.equal(captcha.consume(stolen.id,'000000',stolen.binding),false);
 const expired=captcha.issue();now+=120000;assert.equal(captcha.consume(expired.id,'000000',expired.binding),false);assert.ok(captcha.issue().id);
});
