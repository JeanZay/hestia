// Real image/PDF bytes at several volumes; no padding-only pseudo-documents.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {generateImage,mainCase,hash} from './generate.mjs';
const [sourceDirectory,output]=process.argv.slice(2);
if(!sourceDirectory||!output)throw Error('Usage: generate-archives.mjs <frozen-main-corpus> <new-output>');
const root=path.resolve(output);try{await stat(root);throw Error('Output exists');}catch(e){if(e.code!=='ENOENT')throw e;}await mkdir(root,{recursive:true});
const bytes=await readFile(path.join(sourceDirectory,'manifest.json')),source=JSON.parse(bytes);
if(source.quick||source.cases.filter(c=>c.group==='main').length!==30)throw Error('Complete main corpus required');
const selected=['compact-1','main-01','main-14','main-24'];
const cases=[];const images=[];
for(const id of selected){const item=source.cases.find(c=>c.id===id);if(!item)throw Error('Missing source');const image=await readFile(path.join(sourceDirectory,item.file));if(hash(image)!==item.sha256)throw Error('Source changed');images.push({id,bytes:image});}
images.push({id:'near-limit',bytes:await generateImage({...mainCase(0),index:100,width:4600,height:6900,quality:98,noise:8,orientation:1,lowContrast:false})});
for(const [index,image]of images.entries()){
  if(image.bytes.length>20*1024*1024)throw Error('Archive source exceeds20MiB');
  const file=`archive-photo-${index+1}.jpg`;await writeFile(path.join(root,file),image.bytes,{flag:'wx'});cases.push({id:`photo-${index+1}`,group:'archive',mediaType:'image/jpeg',file,bytes:image.bytes.length,sha256:hash(image.bytes),sourceId:image.id});
  for(const pages of [1,10,50]){
    const pdf=await PDFDocument.create();pdf.setCreationDate(new Date('2026-10-13T00:00:00Z'));pdf.setModificationDate(new Date('2026-10-13T00:00:00Z'));
    const embedded=await pdf.embedJpg(image.bytes),font=await pdf.embedFont(StandardFonts.Helvetica);
    for(let page=0;page<pages;page++){const p=pdf.addPage([595,842]);p.drawText(`SYNTHETIC ARCHIVE ${index+1} / PAGE ${page+1}`,{x:25,y:812,font,size:11});const box=embedded.scaleToFit(545,760);p.drawImage(embedded,{x:25,y:30,width:box.width,height:box.height});}
    const data=Buffer.from(await pdf.save({useObjectStreams:false}));if(data.length>20*1024*1024)throw Error('PDF archive exceeds20MiB');const name=`archive-raster-${index+1}-${pages}.pdf`;await writeFile(path.join(root,name),data,{flag:'wx'});cases.push({id:`raster-${index+1}-${pages}`,group:'archive',mediaType:'application/pdf',file:name,bytes:data.length,sha256:hash(data),pages,sourceId:image.id});
  }
}
for(const item of source.cases.filter(c=>c.group==='archive')){const data=await readFile(path.join(sourceDirectory,item.file));if(hash(data)!==item.sha256)throw Error('Vector source changed');await writeFile(path.join(root,item.file),data,{flag:'wx'});cases.push({...item,mediaType:'application/pdf'});}
const manifest={version:1,createdAtUtc:new Date().toISOString(),dataPolicy:'synthetic-only',sourceManifestSha256:hash(bytes),generatorSha256:hash(await readFile(new URL(import.meta.url))),cases,limits:['Approximate volume bands only; report actual byte sizes, never nominal equality.','Raster PDFs reuse one real image object across1/10/50pages with distinct visible page labels; no padding masquerading as content.','Every original remains byte-identical across before/after candidates. Synthetic corpus does not claim real household representativeness.']};
await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({cases:cases.length,output:root,volumes:cases.filter(c=>c.mediaType==='image/jpeg').map(c=>c.bytes)}));
