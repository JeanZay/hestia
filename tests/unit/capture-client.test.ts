import { afterEach, describe, expect, it, vi } from "vitest";
import { captureBlob, captureRequest, uploadCapturePage, type PendingPage } from "../../src/components/hestia/capture-client";
import type { CaptureDto } from "../../src/shared/capture-contract";
import { hasNativeCamera } from "../../src/components/hestia/native-capture";

function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; }
const signal=()=>new AbortController().signal;
const pixels=()=>new Response(new Uint8Array([1,2,3]),{status:206,headers:{"Content-Range":"bytes 0-2/3","Content-Type":"image/jpeg"}});
const json=(body:unknown={})=>Response.json(body);
afterEach(()=>vi.unstubAllGlobals());

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
    const capture:CaptureDto={id:"queue-complete",kind:"import",version:1,state:"open",createdAt:"2026-10-10T00:00:00Z",expiresAt:"2026-10-10T01:00:00Z",currentFolderId:null,title:"Synthetic",format:"original",pages:[]};
    const saved={...capture,version:2};const fetcher=vi.fn().mockResolvedValue(json({capture:saved}));vi.stubGlobal("fetch",fetcher);
    const pending:PendingPage={file:new File([new Uint8Array([1,2,3])],"synthetic.png",{type:"image/png"}),key:"synthetic-key",hash:"f".repeat(64),reservation:{upload:{id:"synthetic-upload",chunkSize:1024},captureVersion:1}};
    await expect(uploadCapturePage(capture,pending,signal(),()=>{})).resolves.toEqual(saved);expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).toBe("/api/hestia/capture/queue-complete/pages/synthetic-upload/complete");
  });
});
