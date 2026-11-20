import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root='C:/LumenResourceHub/private-template-archive';
const data=JSON.parse(await fs.readFile(path.join(root,'catalog.json'),'utf8'));
if(data.items.length!==45||data.items.some(item=>!/^windx-\d+$/.test(item.id)))throw new Error('Unexpected catalog scope');
await fs.mkdir(path.join(root,'previews'),{recursive:true});
const images={},errors=[];let cursor=0;
async function work(){
  while(cursor<data.items.length){
    const item=data.items[cursor++];
    try{
      const url=new URL(item.previewUrl);if(url.protocol!=='https:'||url.hostname!=='cnd.windx.co.uk')throw new Error('Unexpected preview source');
      let response;
      for(let attempt=0;attempt<2;attempt++){response=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:'error'});if(response.ok)break;}
      if(!response?.ok)throw new Error('Preview download failed');
      const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length<200||bytes.length>5*1024*1024)throw new Error('Unexpected preview size');
      let extension,contentType;
      if(bytes[0]===0xff&&bytes[1]===0xd8){extension='jpg';contentType='image/jpeg';}
      else if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){extension='png';contentType='image/png';}
      else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){extension='webp';contentType='image/webp';}
      else throw new Error('Unsupported preview image');
      const file=item.id+'.'+extension;await fs.writeFile(path.join(root,'previews',file),bytes);
      images[item.id]={file,contentType,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    }catch(error){errors.push({id:item.id,error:error.message});}
  }
}
await Promise.all([work(),work(),work()]);
if(errors.length){console.log(JSON.stringify({cached:Object.keys(images).length,errors}));process.exitCode=1;}
else{await fs.writeFile(path.join(root,'previews.json'),JSON.stringify({cachedAt:new Date().toISOString(),images},null,2));console.log(JSON.stringify({cached:Object.keys(images).length,bytes:Object.values(images).reduce((sum,item)=>sum+item.bytes,0),errors:[]}));}
