import { afterEach, describe, expect, it, vi } from "vitest";
import { captureBlob, captureRequest, uploadCapturePage, clearCaptureClientWork, registerCaptureClientWork, type PendingPage } from "../../src/components/hestia/capture-client";
import type { CaptureDto } from "../../src/shared/capture-contract";
import { hasNativeCamera } from "../../src/components/hestia/native-capture";
import { cameraNormalizer } from "../../src/components/hestia/camera-normalize";

function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; }
const signal=()=>new AbortController().signal;
const pixels=()=>new Response(new Uint8Array([1,2,3]),{status:206,headers:{"Content-Range":"bytes 0-2/3","Content-Type":"image/jpeg"}});
const json=(body:unknown={})=>Response.json(body);
const busy=()=>Response.json({error:{code:"CAPTURE_OPERATION_BUSY",message:"Capture locked before action"}},{status:409});
afterEach(()=>{clearCaptureClientWork();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("Native camera platform entry",()=>{
  it.each([
    ["Mozilla/5.0 (Linux; Android 13)",1,true],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",1,true],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",5,true],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)",10,false],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",0,false],
  ])("uses the platform %s with %i touches",(userAgent,maxTouchPoints,expected)=>{
    vi.stubGlobal("navigator",{userAgent,maxTouchPoints});expect(hasNativeCamera()).toBe(expected);
  });
});

describe("Capture client operation ordering",()=>{
  it("serializes a text-only comment after an upload operation without sending the page manifest",async()=>{
    const first=deferred<Response>(),fetcher=vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(json({comment:"Synthetic guidance",commentVersion:1}));vi.stubGlobal("fetch",fetcher);
    const upload=captureRequest("/capture/comment-order/pages",signal(),"POST",{version:7});
    const comment=captureRequest("/capture/comment-order/comment",signal(),"PATCH",{commentVersion:0,comment:"Synthetic guidance"});
    expect(fetcher).toHaveBeenCalledOnce();first.resolve(json());await upload;await comment;
    expect(fetcher).toHaveBeenCalledTimes(2);expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({commentVersion:0,comment:"Synthetic guidance"});
  });
  it("synchronously stops a hashing upload when privacy is cleared before React cleanup",async()=>{
    const hash=deferred<ArrayBuffer>(),digest=vi.fn(()=>hash.promise),fetcher=vi.fn();vi.stubGlobal("crypto",{subtle:{digest}});vi.stubGlobal("fetch",fetcher);
    const controller=new AbortController(),unregister=registerCaptureClientWork(controller),pending:PendingPage={file:new File([new Uint8Array([1,2,3])],"synthetic.png",{type:"image/png"}),key:"privacy-key"};
    const result=uploadCapturePage({id:"private-import",kind:"import"} as CaptureDto,pending,controller.signal,()=>{}),rejected=expect(result).rejects.toMatchObject({name:"AbortError"});
    await vi.waitFor(()=>expect(digest).toHaveBeenCalledOnce());clearCaptureClientWork();expect(controller.signal.aborted).toBe(true);hash.resolve(new ArrayBuffer(32));await rejected;unregister();expect(fetcher).not.toHaveBeenCalled();
  });
  it("binds variant reads to a page version and never marks previews or automatic lists as activity",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(pixels()).mockResolvedValueOnce(json({captures:[]}));vi.stubGlobal("fetch",fetcher);
    await captureBlob("preview-version",{pageId:"page",variant:"settings",pageVersion:7},signal());
    const query=new URL(fetcher.mock.calls[0][0],"http://synthetic.invalid").searchParams;
    expect(query.get("variant")).toBe("settings");expect(query.get("pageVersion")).toBe("7");
    expect(fetcher.mock.calls[0][1].headers["X-Hestia-Activity"]).toBe("passive");
    await captureRequest("/capture",signal());expect(fetcher.mock.calls[1][1].headers["X-Hestia-Activity"]).toBe("passive");
  });
  it("preserves the version-conflict response from a stale preview without retry",async()=>{
    const fetcher=vi.fn().mockResolvedValue(Response.json({error:{code:"VERSION_CONFLICT"}},{status:409}));vi.stubGlobal("fetch",fetcher);
    await expect(captureBlob("stale-preview",{pageId:"page",variant:"thumbnail",pageVersion:1},signal())).rejects.toMatchObject({status:409,code:"VERSION_CONFLICT"});expect(fetcher).toHaveBeenCalledOnce();
  });
  it("freezes camera bytes before hashing and preserves them through a lost completion",async()=>{
    const camera:CaptureDto={id:"normalized",kind:"camera",version:1,state:"open",createdAt:"2026-10-10T00:00:00Z",expiresAt:"2026-10-10T01:00:00Z",currentFolderId:null,comment:"",commentVersion:0,title:"Synthetic",format:"pdf",pages:[]};
    const chosen=new File([new Uint8Array([4,5,6])],"optimized.jpg",{type:"image/jpeg"}),normalizer=vi.spyOn(cameraNormalizer,"normalize").mockResolvedValue(chosen);
    const saved={...camera,version:2},fetcher=vi.fn().mockResolvedValueOnce(json({upload:{id:"page",chunkSize:1024},captureVersion:1})).mockResolvedValueOnce(json()).mockRejectedValueOnce(new TypeError("lost completion")).mockResolvedValueOnce(json({capture:saved}));vi.stubGlobal("fetch",fetcher);
    const pending:PendingPage={file:new File([new Uint8Array(10)],"original.jpeg",{type:"image/jpeg"}),key:"same-key"};
    await expect(uploadCapturePage(camera,pending,signal(),()=>{})).rejects.toThrow("lost completion");
    const reservation=JSON.parse(fetcher.mock.calls[0][1].body);expect(reservation).toMatchObject({fileName:"optimized.jpg",mediaType:"image/jpeg",size:3,idempotencyKey:"same-key"});
    const expectedHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await chosen.arrayBuffer())),b=>b.toString(16).padStart(2,"0")).join("");expect(reservation.sha256).toBe(expectedHash);
    expect([...new Uint8Array(await fetcher.mock.calls[1][1].body.arrayBuffer())]).toEqual([4,5,6]);
    await expect(uploadCapturePage(camera,pending,signal(),()=>{})).resolves.toEqual(saved);expect(normalizer).toHaveBeenCalledOnce();expect(fetcher).toHaveBeenCalledTimes(4);expect(pending.file).toBe(chosen);
  });
  it("an abort during conversion sends no reservation even if the worker resolves late",async()=>{
    const conversion=deferred<File>(),normalizer=vi.spyOn(cameraNormalizer,"normalize").mockReturnValue(conversion.promise),fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    const capture={id:"aborted-conversion",kind:"camera"} as CaptureDto,controller=new AbortController(),file=new File([new Uint8Array(10)],"original.jpg",{type:"image/jpeg"}),pending:PendingPage={file,key:"selection"};
    const result=uploadCapturePage(capture,pending,controller.signal,()=>{}),rejected=expect(result).rejects.toMatchObject({name:"AbortError"});controller.abort();conversion.resolve(new File([new Uint8Array(3)],"small.jpg",{type:"image/jpeg"}));await rejected;
    expect(normalizer).toHaveBeenCalledOnce();expect(fetcher).not.toHaveBeenCalled();expect(pending.file).toBe(file);expect(pending.reservation).toBeUndefined();
  });
  it("freezes a raw fallback through a partial upload retry with one reservation",async()=>{
    const camera={id:"raw-retry",kind:"camera",version:1} as CaptureDto,file=new File([new Uint8Array([8,7,6,5])],"source.jpeg",{type:"image/jpeg"});
    const normalizer=vi.spyOn(cameraNormalizer,"normalize").mockResolvedValue(file),pending:PendingPage={file,key:"raw-key"};
    const fetcher=vi.fn().mockResolvedValueOnce(json({upload:{id:"page",chunkSize:2},captureVersion:1})).mockResolvedValueOnce(json()).mockRejectedValueOnce(new TypeError("chunk interrupted")).mockResolvedValueOnce(Response.json({error:{code:"INCOMPLETE_UPLOAD"}},{status:409})).mockResolvedValueOnce(json()).mockResolvedValueOnce(json()).mockResolvedValueOnce(json({capture:{...camera,version:2}}));vi.stubGlobal("fetch",fetcher);
    await expect(uploadCapturePage(camera,pending,signal(),()=>{})).rejects.toThrow("chunk interrupted");
    const originalHash=pending.hash;
    await expect(uploadCapturePage(camera,pending,signal(),()=>{})).resolves.toMatchObject({version:2});
    expect(normalizer).toHaveBeenCalledOnce();expect(pending.file).toBe(file);expect(pending.hash).toBe(originalHash);expect(pending.prepared).toBe(true);
    expect(fetcher.mock.calls.filter(([url])=>url.endsWith("/pages"))).toHaveLength(1);
    expect([...new Uint8Array(await fetcher.mock.calls[1][1].body.arrayBuffer())]).toEqual([...new Uint8Array(await fetcher.mock.calls[4][1].body.arrayBuffer())]);
    expect([...new Uint8Array(await fetcher.mock.calls[2][1].body.arrayBuffer())]).toEqual([...new Uint8Array(await fetcher.mock.calls[5][1].body.arrayBuffer())]);
  });
  it("never transforms an import or a camera selection with an existing identity",async()=>{
    const normalizer=vi.spyOn(cameraNormalizer,"normalize"),file=new File([new Uint8Array(10)],"original.jpg",{type:"image/jpeg"});
    const fetcher=vi.fn().mockResolvedValue(json({capture:{id:"saved"}}));vi.stubGlobal("fetch",fetcher);
    for(const kind of ["import","camera"] as const){const pending:PendingPage={file,key:"same",hash:"a".repeat(64),reservation:{upload:{id:"page",chunkSize:1024},captureVersion:1}};await uploadCapturePage({id:kind,kind} as CaptureDto,pending,signal(),()=>{});expect(pending.file).toBe(file);}
    expect(normalizer).not.toHaveBeenCalled();
  });
  it("waits for the server lock left by an aborted preview before PATCH and prepare",async()=>{
    const abort=new AbortController();let calls=0;
    const fetcher=vi.fn().mockImplementation((_url:string,options:RequestInit)=>{
      calls++;
      if(calls===1)return new Promise<Response>((_resolve,reject)=>options.signal!.addEventListener("abort",()=>reject(options.signal!.reason),{once:true}));
      return Promise.resolve(calls===2||calls===4?busy():json({ok:true}));
    });vi.stubGlobal("fetch",fetcher);
    const preview=captureBlob("queue-server-abort",{pageId:"page"},abort.signal);
    const rejected=expect(preview).rejects.toMatchObject({name:"AbortError"});abort.abort();await rejected;
    const body={version:3,title:"Synthetic"};const update=captureRequest("/capture/queue-server-abort",signal(),"PATCH",body);
    body.title="Changed while queued";
    await expect(update).resolves.toEqual({ok:true});
    await expect(captureRequest("/capture/queue-server-abort/prepare",signal(),"POST",{version:4})).resolves.toEqual({ok:true});
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body);
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({version:3,title:"Synthetic"});
  });
  it("retries refused pixel reads without duplicating bytes",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(pixels());vi.stubGlobal("fetch",fetcher);
    const blob=await captureBlob("queue-pixel-busy",{pageId:"page"},signal());
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1,2,3]);expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe(fetcher.mock.calls[1][0]);
  });
  it.each(["CAPTURE_BUSY","VERSION_CONFLICT","ACCESS_CHANGED"])("never retries %s which may follow effects or changed input",async(code)=>{
    const fetcher=vi.fn().mockResolvedValue(Response.json({error:{code}},{status:409}));vi.stubGlobal("fetch",fetcher);
    await expect(captureRequest(`/capture/queue-no-retry-${code}/prepare`,signal(),"POST",{version:1})).rejects.toMatchObject({code});expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never retries a provider analysis even if it returns the pre-action busy code",async()=>{
    const fetcher=vi.fn().mockResolvedValue(busy());vi.stubGlobal("fetch",fetcher);
    await expect(captureRequest("/capture/queue-provider-busy/analyze",signal(),"POST",{})).rejects.toMatchObject({code:"CAPTURE_OPERATION_BUSY"});expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds persistent pre-action refusals instead of waiting indefinitely",async()=>{
    const fetcher=vi.fn().mockImplementation(async()=>busy());vi.stubGlobal("fetch",fetcher);
    await expect(captureRequest("/capture/queue-bounded-busy",signal(),"PATCH",{version:1})).rejects.toMatchObject({code:"CAPTURE_OPERATION_BUSY"});
    expect(fetcher.mock.calls.length).toBeGreaterThan(1);expect(fetcher.mock.calls.length).toBeLessThanOrEqual(8);
  },10_000);
  it("aborts a busy wait without sending another request",async()=>{
    const abort=new AbortController();const fetcher=vi.fn().mockImplementation(async()=>{queueMicrotask(()=>abort.abort());return busy();});vi.stubGlobal("fetch",fetcher);
    await expect(captureRequest("/capture/queue-busy-abort",abort.signal,"PATCH",{})).rejects.toMatchObject({name:"AbortError"});expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("waits for active pixels before emitting one mutation",async()=>{
    const active=deferred<Response>();const fetcher=vi.fn().mockReturnValueOnce(active.promise).mockResolvedValueOnce(json({capture:{version:2}}));vi.stubGlobal("fetch",fetcher);
    const preview=captureBlob("queue-active",{pageId:"page"},signal());
    const update=captureRequest("/capture/queue-active",signal(),"PATCH",{version:1});
    expect(fetcher).toHaveBeenCalledTimes(1);
    active.resolve(pixels());await preview;await update;
    expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][1].method).toBe("PATCH");
  });
  it("prioritizes queued writes over queued thumbnails",async()=>{
    const active=deferred<Response>();const fetcher=vi.fn().mockReturnValueOnce(active.promise).mockResolvedValueOnce(json()).mockResolvedValueOnce(pixels());vi.stubGlobal("fetch",fetcher);
    const first=captureBlob("queue-priority",{pageId:"first"},signal());
    const second=captureBlob("queue-priority",{pageId:"second"},signal());
    const update=captureRequest("/capture/queue-priority",signal(),"PATCH",{});
    expect(fetcher).toHaveBeenCalledTimes(1);active.resolve(pixels());await Promise.all([first,second,update]);
    expect(fetcher.mock.calls[1][1].method).toBe("PATCH");expect(fetcher.mock.calls[2][0]).toContain("pageId=second");
  });
  it("removes an aborted waiting preview before it can fetch bytes",async()=>{
    const active=deferred<Response>();const fetcher=vi.fn().mockReturnValueOnce(active.promise).mockResolvedValueOnce(json());vi.stubGlobal("fetch",fetcher);
    const first=captureBlob("queue-abort",{pageId:"first"},signal());const waiting=new AbortController();
    const second=captureBlob("queue-abort",{pageId:"second"},waiting.signal);const rejected=expect(second).rejects.toMatchObject({name:"AbortError"});waiting.abort();await rejected;
    const update=captureRequest("/capture/queue-abort",signal(),"PATCH",{});active.resolve(pixels());await Promise.all([first,update]);expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps manual mutations available while analysis waits on a provider",async()=>{
    const provider=deferred<Response>();const fetcher=vi.fn().mockReturnValueOnce(provider.promise).mockResolvedValueOnce(json({preview:{previewToken:"opaque"}}));vi.stubGlobal("fetch",fetcher);
    const analysis=captureRequest("/capture/queue-analysis/analyze",signal(),"POST",{});
    await expect(captureRequest("/capture/queue-analysis/preview",signal(),"POST",{})).resolves.toEqual({preview:{previewToken:"opaque"}});
    expect(fetcher).toHaveBeenCalledTimes(2);provider.resolve(json({status:"complete"}));await analysis;
  });
  it("does not serialize independent captures",async()=>{
    const active=deferred<Response>();const fetcher=vi.fn().mockReturnValueOnce(active.promise).mockResolvedValueOnce(json());vi.stubGlobal("fetch",fetcher);
    const first=captureBlob("queue-independent-a",{pageId:"page"},signal());await captureRequest("/capture/queue-independent-b",signal(),"PATCH",{});
    expect(fetcher).toHaveBeenCalledTimes(2);active.resolve(pixels());await first;
  });
  it("never replays a finalization whose response was lost",async()=>{
    const fetcher=vi.fn().mockRejectedValue(new TypeError("Synthetic response loss"));vi.stubGlobal("fetch",fetcher);
    await expect(captureRequest("/capture/queue-finalize/finalize",signal(),"POST",{})).rejects.toThrow("Synthetic response loss");expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reconciles a lost page completion before sending any chunks",async()=>{
    const capture:CaptureDto={id:"queue-complete",kind:"import",version:1,state:"open",createdAt:"2026-10-10T00:00:00Z",expiresAt:"2026-10-10T01:00:00Z",currentFolderId:null,comment:"",commentVersion:0,title:"Synthetic",format:"original",pages:[]};
    const saved={...capture,version:2};const fetcher=vi.fn().mockResolvedValue(json({capture:saved}));vi.stubGlobal("fetch",fetcher);
    const pending:PendingPage={file:new File([new Uint8Array([1,2,3])],"synthetic.png",{type:"image/png"}),key:"synthetic-key",hash:"f".repeat(64),reservation:{upload:{id:"synthetic-upload",chunkSize:1024},captureVersion:1}};
    await expect(uploadCapturePage(capture,pending,signal(),()=>{})).resolves.toEqual(saved);expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).toBe("/api/hestia/capture/queue-complete/pages/synthetic-upload/complete");
  });
});
