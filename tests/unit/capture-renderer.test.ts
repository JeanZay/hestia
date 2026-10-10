import { describe,it,expect } from "vitest";
import sharp from "sharp";
import {createCaptureRenderer,inspectCaptureImage} from "../../src/server/capture/renderer";
import {crop,destination,finalInput,previewHash} from "../../src/server/capture/model";
import type {RenderPage} from "../../src/server/capture/types";
import {randomUUID} from "node:crypto";
const page=(id:string,extra:Partial<RenderPage>={}):RenderPage=>({id,version:1,mediaType:"image/png",size:1,sha256:"",width:100,height:80,rotation:0,crop:{t:0,r:0,b:0,l:0},...extra});
describe("bounded Capture rendering and identities",()=>{
 it("rejects noncanonical crop and destinations before authority lookup",()=>{
  expect(()=>crop({t:5,r:0,b:0,l:0,extra:1})).toThrow();expect(()=>crop({t:2,r:0,b:0,l:0})).toThrow();
  expect(()=>destination({kind:"create",parentId:null,levels:["Dossier"]})).toThrow();
  expect(()=>destination({kind:"existing",folderId:"../"})).toThrow();
  expect(destination({kind:"create",parentId:randomUUID(),levels:[" Factures "]}).kind).toBe("create");
 });
 it("binds the whole preview identity including duplicate and path decisions",()=>{
  const id=randomUUID(),input={version:1,artifactId:randomUUID(),destination:{kind:"existing" as const,folderId:randomUUID()},keepDuplicate:false};
  expect(previewHash(id,input)).not.toBe(previewHash(id,{...input,keepDuplicate:true}));
  expect(()=>finalInput({...input,previewToken:"public graph",idempotencyKey:randomUUID()})).toThrow();
 });
 it("applies rotation then crop to pixels and reports exact dimensions",async()=>{
  const pixels=Buffer.alloc(100*80*3);for(let y=0;y<80;y++)for(let x=0;x<100;x++){const i=(y*100+x)*3;pixels[i]=x<50?255:0;pixels[i+2]=x<50?0:255;}
  const bytes=await sharp(pixels,{raw:{width:100,height:80,channels:3}}).png().toBuffer();
  const result=await createCaptureRenderer()({pages:[page("one",{rotation:90,crop:{t:0,r:0,b:40,l:0}})],format:"image",readPage:async()=>bytes,signal:new AbortController().signal});
  expect(result).toMatchObject({mediaType:"image/jpeg",pageCount:1,width:80,height:60});expect(result.peakRssKiB).toBeGreaterThan(0);
  const decoded=await sharp(result.bytes).raw().toBuffer({resolveWithObject:true});expect(decoded.info.width).toBe(80);expect(decoded.info.height).toBe(60);
  expect(decoded.data[0]).toBeGreaterThan(220);
 },20000);
 it("produces a real ordered multipage PDF, readable by the existing validator",async()=>{
  const a=await sharp({create:{width:120,height:80,channels:3,background:"#fafafa"}}).png().toBuffer();
  const b=await sharp({create:{width:60,height:90,channels:3,background:"#123456"}}).png().toBuffer();
  const result=await createCaptureRenderer()({pages:[page("a"),page("b")],format:"pdf",readPage:async id=>id==="a"?a:b,signal:new AbortController().signal});
  const {validateOriginal}=await import("../../src/server/formats");expect(await validateOriginal(result.bytes,"application/pdf")).toEqual({mediaType:"application/pdf",previewSupported:true});
  const {PDFDocument}=await import("pdf-lib");const pdf=await PDFDocument.load(result.bytes);expect(pdf.getPageCount()).toBe(2);expect(pdf.getPage(0).getSize()).toEqual({width:120,height:80});expect(pdf.getPage(1).getSize()).toEqual({width:60,height:90});
 },30000);
 it("normalizes EXIF orientation before reporting dimensions",async()=>{
  const bytes=await sharp({create:{width:120,height:80,channels:3,background:"white"}}).jpeg().withMetadata({orientation:6}).toBuffer();expect(await inspectCaptureImage(bytes,"image/jpeg")).toEqual({width:80,height:120});
 },20000);
 it("rejects corrupt input, oversized pixels and already aborted requests",async()=>{
  await expect(inspectCaptureImage(new Uint8Array([1,2]),"image/png")).rejects.toThrow();
  const bytes=await sharp({create:{width:8000,height:5001,channels:3,background:"white"}}).png().toBuffer();await expect(inspectCaptureImage(bytes,"image/png")).rejects.toThrow();
  const controller=new AbortController();controller.abort();await expect(createCaptureRenderer()({pages:[page("a")],format:"image",readPage:async()=>bytes,signal:controller.signal})).rejects.toThrow();
 },30000);
 it("does not enqueue a second renderer while a page read is in flight",async()=>{
  const bytes=await sharp({create:{width:10,height:10,channels:3,background:"white"}}).png().toBuffer();let release:(value:Uint8Array)=>void=()=>{};
  const pending=new Promise<Uint8Array>(resolve=>{release=resolve;});const controller=new AbortController();
  const first=createCaptureRenderer()({pages:[page("a")],format:"image",readPage:()=>pending,signal:controller.signal});
  await expect(createCaptureRenderer()({pages:[page("b")],format:"image",readPage:async()=>bytes,signal:new AbortController().signal})).rejects.toMatchObject({code:"CAPTURE_BUSY"});
  release(bytes);await first;
  const next=await createCaptureRenderer()({pages:[page("c")],format:"image",readPage:async()=>bytes,signal:new AbortController().signal});expect(next.pageCount).toBe(1);
 },30000);
});
