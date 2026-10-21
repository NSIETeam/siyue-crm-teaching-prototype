'use strict';
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const digitPaths=[
 'M9 3C2 3 2 11 2 19S2 35 9 35S16 27 16 19S16 3 9 3Z',
 'M4 9L10 3V35M4 35H16',
 'M2 10C2 0 16 0 16 10C16 17 3 23 2 35H17',
 'M2 6C9 0 17 2 16 10C15 15 10 18 7 18C18 16 20 34 9 35C5 35 2 33 1 31',
 'M13 35V3L1 25H18',
 'M17 3H3L2 18C20 9 23 34 9 35C5 35 2 33 1 30',
 'M16 5C2 -3 0 18 2 28C4 39 18 36 18 26C18 15 3 14 2 25',
 'M1 3H18L5 35',
 'M9 19C-2 15 0 2 9 3C21 2 20 15 9 19C-3 22 -1 36 9 35C21 36 23 22 9 19Z',
 'M2 32C17 43 20 16 17 8C13 -2 0 3 1 12C1 23 15 24 18 14'
];
// Font paths never leave the server. Rasterization prevents copying the SVG
// glyph path string to recover the answer without looking at the challenge.
function pathStrokes(path){
 const parts=path.match(/[MLHVCSZ]|-?\d+(?:\.\d+)?/g),strokes=[];let i=0,x=0,y=0,startX=0,startY=0,cx=0,cy=0,previous='',current;
 const next=()=>Number(parts[i++]);
 while(i<parts.length){const command=parts[i++];
  if(command==='M'){x=next();y=next();startX=x;startY=y;current=[{x,y}];strokes.push(current);}
  else if(command==='L'||command==='H'||command==='V'){if(command!=='V')x=next();if(command!=='H')y=next();current.push({x,y});}
  else if(command==='C'||command==='S'){
   const x0=x,y0=y,x1=command==='C'?next():['C','S'].includes(previous)?2*x-cx:x,y1=command==='C'?next():['C','S'].includes(previous)?2*y-cy:y,x2=next(),y2=next(),x3=next(),y3=next();
   for(let step=1;step<=20;step++){const t=step/20,u=1-t;current.push({x:u*u*u*x0+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x3,y:u*u*u*y0+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y3});}
   x=x3;y=y3;cx=x2;cy=y2;
  }else if(command==='Z'){x=startX;y=startY;current.push({x,y});}else throw new Error('Invalid internal captcha font');
  previous=command;
 }
 return strokes;
}
const glyphs=digitPaths.map(pathStrokes);
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function pngChunk(type,data){const name=Buffer.from(type),body=Buffer.concat([name,data]);let crc=0xffffffff;for(const byte of body)crc=crcTable[(crc^byte)&255]^(crc>>>8);const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length,0);name.copy(out,4);data.copy(out,8);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;}
function imageFor(code){
 const width=400,height=128,pixels=Buffer.alloc(width*height*3),random=(min,max)=>crypto.randomInt(min,max);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*3;pixels[at]=243;pixels[at+1]=247;pixels[at+2]=252;}
 function dot(x,y,r,color){for(let yy=Math.max(0,Math.floor(y-r));yy<=Math.min(height-1,Math.ceil(y+r));yy++)for(let xx=Math.max(0,Math.floor(x-r));xx<=Math.min(width-1,Math.ceil(x+r));xx++)if((xx-x)**2+(yy-y)**2<=r*r){const at=(yy*width+xx)*3;pixels[at]=color[0];pixels[at+1]=color[1];pixels[at+2]=color[2];}}
 function line(a,b,r,color){const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*1.5));for(let step=0;step<=steps;step++){const t=step/steps;dot(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,r,color);}}
 for(let n=0;n<7;n++)line({x:random(0,width),y:random(0,height)},{x:random(0,width),y:random(0,height)},random(1,3),[185,201,221]);
 for(let n=0;n<90;n++)dot(random(0,width),random(0,height),random(1,3),[199,211,228]);
 [...code].forEach((digit,index)=>{
  const angle=random(-100,101)/1000,scaleX=random(185,211)/100,scaleY=random(185,211)/100,offsetX=28+index*59+random(-3,4),offsetY=random(24,31),sin=Math.sin(angle),cos=Math.cos(angle),radius=random(25,32)/10,color=[random(23,39),random(48,67),random(78,102)];
  function transform(point){const x=(point.x-9)*scaleX,y=(point.y-19)*scaleY;return{x:offsetX+18+x*cos-y*sin,y:offsetY+38+x*sin+y*cos};}
  for(const stroke of glyphs[Number(digit)])for(let n=1;n<stroke.length;n++)line(transform(stroke[n-1]),transform(stroke[n]),radius,color);
 });
 const rows=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)pixels.copy(rows,y*(width*3+1)+1,y*width*3,(y+1)*width*3);
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',zlib.deflateSync(rows)),pngChunk('IEND',Buffer.alloc(0))]);
 return 'data:image/png;base64,'+png.toString('base64');
}
function createCaptchaService({now=Date.now,randomInt=crypto.randomInt,maxEntries=512}={}){
 if(typeof now!=='function'||typeof randomInt!=='function'||!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>512)throw new Error('验证码配置无效');
 const secret=crypto.randomBytes(32),entries=new Map();
 const answerHash=(id,code)=>crypto.createHmac('sha256',secret).update(id+'\0'+code).digest('hex');
 function cleanup(){for(const [id,entry]of entries)if(entry.expiresAt<=now())entries.delete(id);}
 function validBinding(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);}
 function retire(binding){if(!validBinding(binding))return;const bindingHash=hash(binding);for(const [id,entry]of entries)if(entry.bindingHash===bindingHash)entries.delete(id);}
 function issue(previousBinding){cleanup();retire(previousBinding);if(entries.size>=maxEntries){const error=new Error('验证码请求过于频繁，请稍后重试');error.status=429;error.code='RATE_LIMITED';throw error;}
  const code=Array.from({length:6},()=>{const digit=randomInt(0,10);if(!Number.isInteger(digit)||digit<0||digit>9)throw new Error('验证码随机源无效');return String(digit);}).join('');
  const id=crypto.randomBytes(24).toString('base64url'),binding=crypto.randomBytes(32).toString('base64url'),expiresAt=now()+120000;
  entries.set(id,{answerHash:answerHash(id,code),bindingHash:hash(binding),expiresAt});
  return {id,binding,image:imageFor(code),expiresAt:new Date(expiresAt).toISOString()};
 }
 function consume(id,code,binding){cleanup();const entry=typeof id==='string'?entries.get(id):undefined;if(entry)entries.delete(id);retire(binding);
  if(!entry||!validBinding(binding)||typeof code!=='string'||!/^\d{6}$/.test(code))return false;
  return crypto.timingSafeEqual(Buffer.from(entry.bindingHash,'hex'),Buffer.from(hash(binding),'hex'))&&crypto.timingSafeEqual(Buffer.from(entry.answerHash,'hex'),Buffer.from(answerHash(id,code),'hex'));
 }
 return {issue,consume};
}
module.exports={createCaptchaService};
