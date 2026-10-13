// Add true PNG archives without touching the frozen JPEG or archive-r1 bytes.
import {readFile,writeFile,mkdir,stat,copyFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {hash} from './generate.mjs';
const [mainDirectory,archiveDirectory,output,...extra]=process.argv.slice(2);
if(!mainDirectory||!archiveDirectory||!output||extra.length)throw Error('Use extend-archives.mjs <main> <archive-r1> <new-output>');
const root=path.resolve(output);try{await stat(root);throw Error('Output exists');}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(root,{recursive:true});sharp.concurrency(1);sharp.cache(false);
const mainBytes=await readFile(path.join(mainDirectory,'manifest.json')),main=JSON.parse(mainBytes);
const previousBytes=await readFile(path.join(archiveDirectory,'manifest.json')),previous=JSON.parse(previousBytes);
if(main.quick||main.cases.filter(c=>c.group==='main').length!==30||previous.cases.length!==23||previous.sourceManifestSha256!==hash(mainBytes))throw Error('Frozen corpus identity mismatch');
const cases=[];
for(const row of previous.cases){const bytes=await readFile(path.join(archiveDirectory,row.file));if(hash(bytes)!==row.sha256)throw Error('Archive drift');await copyFile(path.join(archiveDirectory,row.file),path.join(root,row.file));cases.push(row);}
for(const [index,id]of ['compact-1','main-01','main-14'].entries()){
  const source=main.cases.find(c=>c.id===id);const bytes=await readFile(path.join(mainDirectory,source.file));if(hash(bytes)!==source.sha256)throw Error('Source drift');
  let image=sharp(bytes,{limitInputPixels:40_000_000}).rotate();if(index===2)image=image.resize({width:3200,height:3200,fit:'inside',withoutEnlargement:true});
  const png=await image.png({compressionLevel:9}).toBuffer();if(png.length>20*1024*1024)throw Error('PNG exceeds20MiB');const meta=await sharp(png).metadata();const file=`archive-png-${index+1}.png`;
  await writeFile(path.join(root,file),png,{flag:'wx'});cases.push({id:`png-${index+1}`,group:'archive',mediaType:'image/png',file,bytes:png.length,sha256:hash(png),width:meta.width,height:meta.height,sourceId:id,construction:'Synthetic decoded raster stored losslessly as PNG; this is a new fixture, never a transformed archived product document.'});
}
const manifest={...previous,createdAtUtc:new Date().toISOString(),generatorSha256:hash(await readFile(new URL(import.meta.url))),previousManifestSha256:hash(previousBytes),cases};
await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output:root,cases:cases.length,png:cases.filter(c=>c.mediaType==='image/png').map(c=>({id:c.id,bytes:c.bytes,width:c.width,height:c.height}))}));
