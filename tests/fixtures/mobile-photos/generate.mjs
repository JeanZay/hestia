// Authored synthetic scenes only. Sequential bounded generation, never on import.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const here = path.dirname(fileURLToPath(import.meta.url));
export const plan = JSON.parse(await readFile(path.join(here, 'corpus-plan.json'), 'utf8'));
const qr = JSON.parse(await readFile(path.join(here, 'qr-reference.json'), 'utf8'));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function mainCase(index) {
  if (!Number.isInteger(index) || index < 0 || index >= plan.mainCount) throw Error('Unknown corpus case');
  const [width,height] = plan.dimensions[index % 3];
  return { id:`main-${String(index + 1).padStart(2,'0')}`, group:'main', index, width, height,
    quality:plan.sourceJpegQuality[Math.floor(index/3)%3], noise:plan.noiseAmplitude[Math.floor(index/9)%3],
    orientation:plan.orientations[index%8], lowContrast:index%5===0, color:index%2===0 };
}
function documentSvg(spec) {
  const ink = spec.lowContrast ? '#787878' : '#171717';
  const rows = Array.from({length:29},(_,i)=>`<text x="90" y="${230+i*27}" font-size="${[12,16,20,24][i%4]}">${xml(plan.textTruth[i%4])} / ${String(spec.index+1).padStart(2,'0')}-${i+1}</text>`).join('');
  const grid = Array.from({length:29},(_,i)=>`<path d="M80 ${238+i*27} H920" stroke="${ink}" stroke-width="${i%2 ? .5 : 1.5}"/>`).join('');
  const modules = qr.modules.flatMap((row,y)=>[...row].map((v,x)=>v==='1'?`<rect x="${760+(x+4)*5}" y="${1140+(y+4)*5}" width="5" height="5"/>`:'' )).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 1000 1400" preserveAspectRatio="none"><g fill="${ink}" font-family="sans-serif"><rect x="60" y="55" width="880" height="1290" fill="none" stroke="${ink}" stroke-width="3"/><text x="80" y="100" font-size="28">HESTIA — DOCUMENT ${spec.index+1}</text><text x="80" y="148" font-size="18">${plan.textTruth[0]}</text>${grid}${rows}<text x="80" y="1100" font-size="22">${plan.textTruth[2]}</text><path d="M85 1180 Q120 1120 155 1170 T235 1165 T315 1180" fill="none" stroke="${ink}" stroke-width="2"/><text x="80" y="1260" font-size="13">Signature graphique fictive. Cadre et QR temoins.</text><rect x="760" y="1140" width="145" height="145" fill="white"/><g fill="black">${modules}</g><text x="70" y="1330" font-size="24">BAS ←</text><text x="780" y="80" font-size="24">HAUT ↑</text>${Array.from({length:10},(_,i)=>`<rect x="${80+i*60}" y="1290" width="50" height="20" fill="${spec.color?['#ff0000','#00a000','#0000ff','#00ffff','#ff00ff','#ffff00','#999999','#555555','#222222','#ffffff'][i]:`rgb(${i*25},${i*25},${i*25})`}"/>`).join('')}</g></svg>`);
}
export async function generateImage(spec) {
  if (spec.width*spec.height>40_000_000) throw Error('Bounded generator refuses >40MP');
  // A bounded deterministic sensor-like variation makes JPEG load meaningful.
  // It is fixed by the plan, not adjusted to the observed optimizer result.
  const raw=Buffer.alloc(spec.width*spec.height*3); let state=(plan.seed+spec.index)>>>0;
  for(let pixel=0;pixel<raw.length;pixel+=3){state=(Math.imul(state,1664525)+1013904223)>>>0;const value=Math.min(255,246+(state%(2*spec.noise+1))-spec.noise);raw[pixel]=value;raw[pixel+1]=value;raw[pixel+2]=spec.color?Math.max(0,value-3):value;}
  const inverse=[0,1,2,3,4,5,8,7,6][spec.orientation];
  const canonical=await sharp(raw,{raw:{width:spec.width,height:spec.height,channels:3},limitInputPixels:40_000_000})
    .composite([{input:documentSvg(spec)}]).png().withMetadata({orientation:inverse}).toBuffer();
  // Encode the inverse transform, then tag the source orientation. Every case
  // displays upright after EXIF, including mirrored cases5/7, without a JPEG
  // recompression pass hidden in fixture construction.
  return sharp(canonical,{limitInputPixels:40_000_000}).rotate()
    .jpeg({quality:spec.quality,chromaSubsampling:'4:4:4'}).withMetadata({orientation:spec.orientation}).toBuffer();
}
export async function vectorPdf(pages) {
  if(![1,10,50].includes(pages))throw Error('Unsupported page count');
  const pdf=await PDFDocument.create(); pdf.setCreationDate(new Date('2026-10-13T00:00:00Z'));pdf.setModificationDate(new Date('2026-10-13T00:00:00Z'));
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let n=0;n<pages;n++){const p=pdf.addPage([595,842]);p.drawText(`SYNTHETIC HESTIA ARCHIVE ${n+1}/${pages}`,{x:35,y:800,size:15,font});for(let r=0;r<65;r++)p.drawText(`Reference ${n+1}-${r}  TOTAL 1 234,56 EUR  0O 1Il 5S 8B`,{x:35,y:770-r*10,size:7,font,color:rgb(.1,.1,.1)});}
  return Buffer.from(await pdf.save({useObjectStreams:false}));
}
export async function generateCorpus(output, { quick = false } = {}) {
  const root=path.resolve(output);try{await stat(root);throw Error('Output already exists; keep previous corpus immutable');}catch(error){if(error.code!=='ENOENT')throw error;}
  await mkdir(root,{recursive:true});sharp.concurrency(1);sharp.cache(false);
  const manifest={version:1,createdAtUtc:new Date().toISOString(),seed:plan.seed,planSha256:hash(await readFile(path.join(here,'corpus-plan.json'))),generatorSha256:hash(await readFile(fileURLToPath(import.meta.url))),qrSha256:hash(await readFile(path.join(here,'qr-reference.json'))),runtime:{node:process.version,platform:process.platform,sharp:sharp.versions},font:{family:'sans-serif',source:'Host font resolution by librsvg/Pango; record environment and reuse the frozen generated bytes for both candidates. No font binary redistributed.'},quick,plannedMainCases:plan.mainCount,cases:[],limitations:plan.limits};
  const specs=quick?[mainCase(0)]:[...Array.from({length:plan.mainCount},(_,i)=>mainCase(i)),...plan.complements.map(([width,height],i)=>({...mainCase(i),id:`compact-${i+1}`,group:'complement',width,height,quality:65,noise:1}))];
  for(const spec of specs){const bytes=await generateImage(spec);if(bytes.length>20*1024*1024)throw Error(`Planned source exceeds admission: ${spec.id}`);const encoded=await sharp(bytes).metadata();const name=spec.id+'.jpg';await writeFile(path.join(root,name),bytes,{flag:'wx'});manifest.cases.push({...spec,encodedWidth:encoded.width,encodedHeight:encoded.height,encodedOrientation:encoded.orientation,file:name,bytes:bytes.length,sha256:hash(bytes),qrPayload:qr.payload,textTruth:plan.textTruth});}
  if(!quick)for(const pages of plan.archivePdfPages){const bytes=await vectorPdf(pages),file=`archive-vector-${pages}.pdf`;await writeFile(path.join(root,file),bytes,{flag:'wx'});manifest.cases.push({id:`archive-vector-${pages}`,group:'archive',file,bytes:bytes.length,sha256:hash(bytes),pages,kind:'vector'});}
  await writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});return manifest;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){const args=process.argv.slice(2);if(!args[0]||args.some(a=>a.startsWith('--')&&a!=='--quick'))throw Error('Usage: generate.mjs <new-output-directory> [--quick]');const m=await generateCorpus(args[0],{quick:args.includes('--quick')});console.log(JSON.stringify({output:path.resolve(args[0]),cases:m.cases.length,quick:m.quick,plan:m.planSha256,performance:'NOT_RUN'}));}
