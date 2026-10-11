import { describe, expect, it } from "vitest";
import { destination, destinationJson } from "../../src/server/capture/model";
import { planCaptureDestination, type DestinationFolder } from "../../src/server/capture/destination-plan";
const a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222";
const full=()=>["consulter","déposer","modifier"];
describe("Capture server destination planning",()=>{
 it("reads maximum-depth Unicode destinations, including escaped surrogate pairs, within a bounded body",async()=>{
  const value={destination:{kind:"create",parentId:null,levels:Array.from({length:20},(_,i)=>`${i}`.padStart(2,"0")+"😀".repeat(118))}};
  const encoded=JSON.stringify(value).replace(/[^\x20-\x7e]/g,c=>"\\u"+c.charCodeAt(0).toString(16).padStart(4,"0"));
  expect(Buffer.byteLength(encoded)).toBeGreaterThan(4096);expect(Buffer.byteLength(encoded)).toBeLessThan(32*1024);
  const request=new Request("http://localhost/preview",{method:"POST",headers:{"content-type":"application/json"},body:encoded});
  expect(destination((await destinationJson(request,["destination"])).destination)).toEqual(value.destination);
 });
 it("rejects excessive streamed bodies, extra fields, nonobjects and wrong content types",async()=>{
  for(const [body,type] of [[JSON.stringify({destination:"x".repeat(32*1024)}),"application/json"],["{\"extra\":1}","application/json"],["[]","application/json"],["{}","text/plain"]]) {
   const request=new Request("http://localhost/preview",{method:"POST",headers:{"content-type":type},body});
   await expect(destinationJson(request,["destination"])).rejects.toMatchObject({code:"INVALID_INPUT"});
  }
 });
 it("accepts only explicit null root and normalized safe levels",()=>{
  expect(destination({kind:"create",parentId:null,levels:[" e\u0301 "]})).toEqual({kind:"create",parentId:null,levels:["é"]});
  for(const value of [{kind:"create",levels:["ok"]},{kind:"create",parentId:null,levels:["../x"]},{kind:"create",parentId:null,levels:["ok"],picks:{}}])expect(()=>destination(value)).toThrow();
 });
 it("projects visible ancestry only but binds physical ancestry versions privately",()=>{
  const rows:DestinationFolder[]=[{id:a,name:"Hidden",parent_folder_id:null,version:2},{id:b,name:"Shared",parent_folder_id:a,version:3}];
  const plan=planCaptureDestination({kind:"create",parentId:null,levels:["Shared","Child"]},rows,id=>id===a?[]:full());
  expect(plan.path).toEqual([{id:b,name:"Shared",isNew:false},{name:"Child",isNew:true}]);
  expect(plan.identity).toEqual([{id:a,name:"Hidden",version:2,parentId:null},{id:b,name:"Shared",version:3,parentId:a}]);
  rows[1].version=5;
  expect(planCaptureDestination({kind:"create",parentId:b,levels:["Child"]},rows,id=>id===a?[]:full()).identity).not.toEqual(plan.identity);
 });
 it("refuses ambiguous unanchored input but accepts an explicit existing choice",()=>{
  const rows:DestinationFolder[]=[{id:a,name:"Same",parent_folder_id:null,version:1},{id:b,name:"Same",parent_folder_id:null,version:1}];
  expect(()=>planCaptureDestination({kind:"create",parentId:null,levels:["Same","Child"]},rows,full)).toThrowError(expect.objectContaining({code:"AMBIGUOUS_PATH"}));
  expect(planCaptureDestination({kind:"create",parentId:b,levels:["Child"]},rows,full).baseId).toBe(b);
 });
 it("requires deposit on existing destinations and modify only for new suffixes",()=>{
  const rows=[{id:a,name:"Same",parent_folder_id:null,version:1}];
  expect(planCaptureDestination({kind:"create",parentId:null,levels:["Same"]},rows,()=>["consulter","déposer"])).toMatchObject({allExist:true,missing:[],baseId:a});
  expect(()=>planCaptureDestination({kind:"create",parentId:a,levels:["New"]},rows,()=>["consulter","déposer"])).toThrow();
  expect(()=>planCaptureDestination({kind:"existing",folderId:a},rows,()=>["consulter"])).toThrow();
 });
});
