import { spawn } from "node:child_process";
import path from "node:path";
import { HttpError } from "../access";
import type { CaptureMediaType } from "../../shared/capture-contract";
import type { CaptureRenderer, RenderRequest, RenderResult } from "./types";
const MAX_BYTES = 20 * 1024 * 1024;
let workers = 0;
const failure = () => new HttpError(422,"CAPTURE_RENDER_FAILED","Le document n’a pas pu être préparé. Les pages enregistrées sont conservées.");
async function run(input: RenderRequest, inspect: boolean, timeoutMs: number): Promise<RenderResult> {
  if(workers>=1)throw new HttpError(409,"CAPTURE_BUSY","Une préparation est en cours. Réessayez dans un instant.");
  if(input.signal.aborted)throw failure();
  workers++;
  try {
    return await new Promise<RenderResult>((resolve,reject)=>{
      const worker=spawn(process.execPath,["--max-old-space-size=256",path.join(process.cwd(),"src/server/capture/render-worker.mjs")],{
        windowsHide:true,serialization:"advanced",stdio:["ignore","ignore","ignore","ipc"],
        env:{NODE_ENV:"production",PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP},
      });
      let finished=false, stopping=false, reading=false, cursor=0, outcome:RenderResult|undefined;
      const finish=()=>{
        if(finished)return;finished=true;clearTimeout(timer);input.signal.removeEventListener("abort",abort);
        if(outcome)resolve(outcome);else reject(failure());
      };
      const stop=(result?:RenderResult)=>{
        if(stopping)return;stopping=true;outcome=result;worker.kill();
        // Do not release the global slot until the process has actually exited.
      };
      const abort=()=>stop();const timer=setTimeout(abort,timeoutMs);
      input.signal.addEventListener("abort",abort,{once:true});
      worker.on("error",()=>{outcome=undefined;stop();});
      worker.on("close",finish);
      worker.on("message",(message:unknown)=>{
        if(stopping||!message||typeof message!=="object")return;
        if("read" in message){
          const id=message.read;
          if(reading||typeof id!=="string"||id!==input.pages[cursor]?.id){stop();return;}
          reading=true;cursor++;
          void input.readPage(id).then(bytes=>{
            if(!bytes.length||bytes.length>MAX_BYTES)throw failure();
            reading=false;if(!stopping)worker.send({bytes},error=>{if(error)stop();});
          }).catch(()=>stop());
        }else if("result" in message){
          const result=message.result as Partial<RenderResult>;
          if(!(result.bytes instanceof Uint8Array)||result.bytes.length>MAX_BYTES||(!inspect&&!result.bytes.length)||
            result.mediaType!==(input.format==="pdf"?"application/pdf":"image/jpeg")||
            !Number.isSafeInteger(result.width)||Number(result.width)<1||!Number.isSafeInteger(result.height)||Number(result.height)<1||
            result.pageCount!==input.pages.length||!Number.isFinite(result.peakRssKiB)||cursor!==input.pages.length){stop();return;}
          stop(result as RenderResult);
        }else stop();
      });
      worker.send({pages:input.pages,format:input.format,inspect},error=>{if(error)stop();});
    });
  }finally{workers--;}
}
export function createCaptureRenderer(timeoutMs=90_000):CaptureRenderer {
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>90_000)throw new Error("Invalid render timeout");
  return input=>run(input,false,timeoutMs);
}
export async function inspectCaptureImage(bytes:Uint8Array,mediaType:CaptureMediaType):Promise<{width:number;height:number}> {
  const result=await run({pages:[{id:"inspect",version:1,mediaType,size:bytes.length,sha256:"",width:0,height:0,rotation:0,crop:{t:0,r:0,b:0,l:0}}],format:"image",readPage:async()=>bytes,signal:new AbortController().signal},true,15_000);
  return {width:result.width,height:result.height};
}
