import { describe, expect, it } from "vitest";
import { normalizeCaptureLevel, resolveCapturePath, type CapturePathFolder } from "../../src/shared/capture-path";
const row = (id:string,name:string,visibleParentId:string|null=null,capabilities=["consulter","déposer","modifier"]):CapturePathFolder => ({id,name,visibleParentId,capabilities});
describe("Capture authorized path resolution",()=>{
 it("reuses only input levels and creates the missing suffix",()=>{
  const plan=resolveCapturePath([row("a","Maison"),row("b","Équipement","a")],"a",["e\u0301QUIPEMENT"," Garantie "]);
  expect(plan).toMatchObject({status:"ready",reused:[{id:"b",name:"Équipement"}],missing:["Garantie"],baseId:"b",finalId:null,allExist:false});
 });
 it("requires only deposit for an existing complete path, modify only at the creation base",()=>{
  const rows=[row("a","Maison",null,["consulter"]),row("b","Factures","a",["consulter","déposer"])];
  expect(resolveCapturePath(rows,"a",["Factures"])).toMatchObject({status:"ready",allExist:true,finalId:"b"});
  expect(resolveCapturePath(rows,"a",["Factures","2026"]).status).toBe("unavailable");
  rows[1].capabilities=["consulter","déposer","modifier"];
  expect(resolveCapturePath(rows,"a",["Factures","2026"]).status).toBe("ready");
 });
 it("supports a private root and an isolated shared entry without synthesizing ancestors",()=>{
  expect(resolveCapturePath([],null,["Animaux","Nori"])).toMatchObject({status:"ready",baseId:null,missing:["Animaux","Nori"]});
  expect(resolveCapturePath([row("shared","Soins")],null,["Soins","2026"])).toMatchObject({status:"ready",baseId:"shared",reused:[{id:"shared",name:"Soins"}],missing:["2026"]});
 });
 it("requires an explicit candidate for homonyms and keeps original input indexes",()=>{
  const rows=[row("root","Maison"),row("a","Factures","root"),row("b","FACTURES","root")];
  expect(resolveCapturePath(rows,null,["Maison","Factures","2026"])).toMatchObject({status:"ambiguous",ambiguity:{levelIndex:1,candidates:[{id:"a",name:"Factures"},{id:"b",name:"FACTURES"}]}});
  expect(resolveCapturePath(rows,null,["Maison","Factures","2026"],{1:"b"})).toMatchObject({status:"ready",baseId:"b",missing:["2026"]});
  expect(resolveCapturePath(rows,null,["Maison","Factures"],{1:"hidden"}).status).toBe("ambiguous");
 });
 it("does not infer hidden folders or equate accents and internal spaces",()=>{
  const rows=[row("hidden","Été",null,[]),row("visible","Ete")];
  expect(resolveCapturePath(rows,null,["Été"])).toMatchObject({status:"ready",reused:[],missing:["Été"]});
  expect(resolveCapturePath(rows,"hidden",["child"]).status).toBe("unavailable");
  expect(resolveCapturePath([row("a","A  B")],null,["A B"]).missing).toEqual(["A B"]);
 });
 it("rejects malformed names, cycles and oversized input without partial ready",()=>{
  for(const name of ["", ".", "..", "a/b", "a\\b", "x\u0000", "x\u202e", "<name>", "x".repeat(121)])expect(normalizeCaptureLevel(name)).toBeNull();
  expect(normalizeCaptureLevel(" é ")).toBe("é");
  expect(normalizeCaptureLevel("😀".repeat(120))).not.toBeNull();
  expect(resolveCapturePath([],null,Array(21).fill("a")).status).toBe("invalid");
  expect(resolveCapturePath([row("a","A","a")],"a",["A"]).status).toBe("invalid");
  expect(resolveCapturePath(Array.from({length:10001},(_,i)=>row(String(i),"a")),null,["a"]).status).toBe("resource-limit");
 });
});
