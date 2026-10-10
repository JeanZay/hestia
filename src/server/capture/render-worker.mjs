// Disposable decoder/generator. IPC contains bounded page bytes, never credentials.
import sharp from 'sharp';
import {PDFDocument} from 'pdf-lib';
sharp.cache(false);sharp.concurrency(1);
const MAX=20*1024*1024, MP=40_000_000;
let receiver;
function read(id){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{reject(new Error('page timeout'));process.exitCode=1;process.disconnect();},15000);receiver=bytes=>{clearTimeout(timer);resolve(bytes);};process.send({read:id});});}
function check(value){if(!value)throw new Error('invalid capture');}
async function pipeline(bytes,type){
  check(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=MAX);
  if(type==='image/heic'||type==='image/heif'){
    const {default:libheif}=await import('libheif-js');const images=new libheif.HeifDecoder().decode(Buffer.from(bytes));
    check(images.length===1);const image=images[0],width=image.get_width(),height=image.get_height();
    check(width>0&&height>0&&width*height<=MP);const data=new Uint8ClampedArray(width*height*4);
    const decoded=await new Promise(resolve=>image.display({data,width,height},resolve));image.free();check(decoded);
    return {image:sharp(Buffer.from(data.buffer),{raw:{width,height,channels:4},limitInputPixels:MP}),width,height};
  }
  const image=sharp(bytes,{failOn:'warning',limitInputPixels:MP,animated:false});const meta=await image.metadata();
  check(['jpeg','png','webp'].includes(meta.format)&&meta.width>0&&meta.height>0&&meta.width*meta.height<=MP&&(!meta.pages||meta.pages===1));
  const swapped=meta.orientation>=5&&meta.orientation<=8;
  return {image:image.autoOrient(),width:swapped?meta.height:meta.width,height:swapped?meta.width:meta.height};
}
async function execute({pages,format,inspect}){
  check(Array.isArray(pages)&&pages.length>0&&pages.length<=20&&['image','pdf'].includes(format)&&(format==='pdf'||pages.length===1));
  const pdf=format==='pdf'?await PDFDocument.create():null;let totalPixels=0,totalJpeg=0,output,width=0,height=0;
  for(const page of pages){
    const bytes=await read(page.id);const timer=setTimeout(()=>{process.exit(1);},15000);
    try{
      const decoded=await pipeline(bytes,page.mediaType);width=decoded.width;height=decoded.height;totalPixels+=width*height;check(totalPixels<=200_000_000);
      if(inspect){await decoded.image.raw().toBuffer();break;}
      check([0,90,180,270].includes(page.rotation));if(page.rotation===90||page.rotation===270)[width,height]=[height,width];
      const c=page.crop;check(c&&['t','r','b','l'].every(k=>Number.isInteger(c[k])&&c[k]>=0&&c[k]<=40&&c[k]%5===0));
      const left=Math.floor(width*c.l/100),top=Math.floor(height*c.t/100);
      width=width-left-Math.floor(width*c.r/100);height=height-top-Math.floor(height*c.b/100);check(width>0&&height>0);
      const jpeg=await decoded.image.rotate(page.rotation).extract({left,top,width,height}).flatten({background:'#ffffff'}).jpeg({quality:92,chromaSubsampling:'4:4:4'}).toBuffer();
      totalJpeg+=jpeg.length;check(totalJpeg<=MAX);
      if(pdf){const asset=await pdf.embedJpg(jpeg);const sheet=pdf.addPage([width,height]);sheet.drawImage(asset,{x:0,y:0,width,height});}else output=jpeg;
    }finally{clearTimeout(timer);}
  }
  if(inspect)output=new Uint8Array();else if(pdf)output=await pdf.save({useObjectStreams:true});
  check(output.length<=MAX);
  process.send({result:{bytes:new Uint8Array(output),mediaType:format==='pdf'?'application/pdf':'image/jpeg',width,height,pageCount:pages.length,peakRssKiB:process.resourceUsage().maxRSS}},()=>process.disconnect());
}
let started=false;
process.on('message',message=>{
  if(message&&message.bytes&&receiver){const receive=receiver;receiver=null;receive(message.bytes);return;}
  if(started){process.exit(1);return;}started=true;execute(message).catch(()=>{
    // Fixed diagnostic only: never return parser messages or document contents.
    process.exitCode=1;
    if(process.connected)process.send({error:'render_rejected',peakRssKiB:process.resourceUsage().maxRSS},()=>process.disconnect());
  });
});
