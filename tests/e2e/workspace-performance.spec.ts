import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { provisionSyntheticMember } from "../../src/server/db/synthetic";

const SHAPE = { folders: 100, documents: 1000, documentsPerFolder: 10, rights: "seven explicit creator grants", warmup: 5, samples: 30, seed: "mobile-workspace-v1" };
const digest = createHash("sha256").update(JSON.stringify(SHAPE)).digest("hex");
const percentile = (values: number[], rank: number) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*rank)-1];

test("workspace real API navigation benchmark, 100 folders and 1000 documents", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("performance-"), "Dedicated real-API performance campaign; regular browser checks do not claim timings.");
  test.setTimeout(180000);
  const url = new URL(process.env.DATABASE_URL || "about:blank"), runId = process.env.HESTIA_TEST_RUN_ID, password = process.env.HESTIA_TEST_PASSWORD;
  if (process.env.HESTIA_ENVIRONMENT !== "local" || url.hostname !== "127.0.0.1" || !/^hestia-app-[0-9a-f]{16}$/.test(runId || "")
      || url.pathname !== `/hestia_test_${runId!.slice("hestia-app-".length)}_browser` || !password) throw Error("Owned local browser bench required");
  const pool = new Pool({ connectionString: url.href, max: 1 });
  const email = `benchmark-${randomUUID()}@example.invalid`;
  const folders: {id:string;name:string}[] = [];
  const headers = { origin: new URL(testInfo.project.use.baseURL as string).origin };
  try {
    expect((await pool.query("SELECT run_id FROM hestia_bench_marker")).rows).toEqual([{run_id:runId}]);
    const actor = await provisionSyntheticMember(pool, { email, name: "Benchmark synthétique", password });
    await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');
    const login = await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password } });
    expect(login.ok()).toBe(true);
    for (let index = 0; index < SHAPE.folders; index++) {
      const result = await page.request.post("/api/hestia/folders", { headers, data: { name: `Mesure ${String(index).padStart(3,"0")}`, idempotencyKey: randomUUID() } });
      expect(result.status()).toBe(201); folders.push((await result.json()).folder);
    }
    // Synthetic metadata originals remain confined to the owned disposable DB.
    // No object bytes are needed: navigation must never read object storage.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let index = 0; index < SHAPE.documents; index++) {
        const folder = folders[Math.floor(index / SHAPE.documentsPerFolder)], upload = randomUUID(), document = randomUUID(), key = `synthetic-benchmark/${upload}`;
        const title = `${folder.name} document ${index % SHAPE.documentsPerFolder}`, sha = "0".repeat(64);
        await client.query(`INSERT INTO hestia_upload(id,actor_id,folder_id,owner_id,idempotency_key,identity_sha,title,file_name,media_type,size,sha256,source,status,reservation_released)
          VALUES($1,$2,$3,$2,$1,$4,$5,'synthetic.pdf','application/pdf',1024,$4,'import','completed',true)`, [upload,actor,folder.id,sha,title]);
        await client.query("INSERT INTO hestia_upload_object(object_key,upload_id,kind,size,sha256,ready) VALUES($1,$2,'original',1024,$3,true)",[key,upload,sha]);
        await client.query(`INSERT INTO hestia_document(id,folder_id,owner_id,uploaded_by,uploaded_by_name,title,file_name,media_type,size,sha256,source,object_key,preview_supported)
          VALUES($1,$2,$3,$3,'Benchmark synthétique',$4,'synthetic.pdf','application/pdf',1024,$5,'import',$6,true)`,[document,folder.id,actor,title,sha,key]);
        await client.query("UPDATE hestia_upload SET document_id=$2 WHERE id=$1",[upload,document]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    const actual = (await pool.query("SELECT (SELECT count(*)::int FROM hestia_folder WHERE created_by=$1) AS folders,(SELECT count(*)::int FROM hestia_document WHERE owner_id=$1) AS documents,(SELECT count(*)::int FROM hestia_folder) AS total_graph_folders",[actor])).rows[0];
    expect(actual.folders).toBe(100); expect(actual.documents).toBe(1000);
    await page.goto("/");
    await expect(page.getByRole("heading",{name:"Dossiers",exact:true})).toBeVisible();
    const samples: {visibleMs:number;requests:string[];httpMs:number[];bodyBytes:number}[] = [];
    for (let index=0;index<SHAPE.warmup+SHAPE.samples;index++) {
      if (index) {
        await page.getByRole("button",{name:"Dossiers",exact:true}).filter({visible:true}).first().click();
        await expect(page.getByRole("heading",{name:"Dossiers",exact:true})).toBeVisible();
      }
      const target = folders[(index*7)%folders.length];
      await page.evaluate(() => performance.clearResourceTimings());
      const started = await page.evaluate(() => performance.now());
      await page.locator("button.h-document-row").filter({has:page.getByText(target.name,{exact:true})}).click();
      await expect(page.getByRole("heading",{name:target.name,exact:true})).toBeVisible();
      await expect(page.getByText(`${target.name} document 0`,{exact:true})).toBeVisible();
      const measured = await page.evaluate(startTime => ({visibleMs:performance.now()-startTime,resources:performance.getEntriesByType("resource").filter(entry=>entry.name.includes("/api/hestia/")).map(entry=>{
        const resource=entry as PerformanceResourceTiming;
        return {path:new URL(resource.name).pathname,duration:resource.duration,body:resource.encodedBodySize};
      })}),started);
      expect(measured.resources.some(resource=>/\/content|\/chunks/.test(resource.path))).toBe(false);
      if(index>=SHAPE.warmup)samples.push({visibleMs:measured.visibleMs,requests:measured.resources.map(r=>r.path.replace(/\/[0-9a-f-]{36}/g,"/:id")),httpMs:measured.resources.map(r=>r.duration),bodyBytes:measured.resources.reduce((sum,r)=>sum+r.body,0)});
    }
    const durations=samples.map(row=>row.visibleMs);
    const report={recordedAtUtc:new Date().toISOString(),kind:"real-local-http-browser-navigation",candidate:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8",windowsHide:true}).trim(),project:testInfo.project.name,protocol:SHAPE,datasetShapeDigest:digest,actual,
      p50Ms:percentile(durations,.5),p95Ms:percentile(durations,.95),requestCounts:[...new Set(samples.map(s=>s.requests.length))],samples,
      limitations:["Local loopback network, disposable PostgreSQL/S3; not Dev, Vercel, Neon or Pixel 10.","No CPU/network throttling; active profile belongs to the synthetic bench.","HTTP durations include local application and database work; independent SQL instrumentation is in workspace integration tests.","Metadata navigation reads neither image/PDF bytes nor AI; storage/image/AI time is outside this measured path."]};
    const out="artifacts/performance";mkdirSync(out,{recursive:true});const file=`${out}/workspace-${testInfo.project.name}-${Date.now()}.json`;writeFileSync(file,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
    console.log(JSON.stringify({benchmark:report.kind,project:report.project,p50Ms:report.p50Ms,p95Ms:report.p95Ms,requestCounts:report.requestCounts,report:file}));
  } finally { await pool.end(); }
});
