import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import sharp from "sharp";
import { createApplication } from "../../src/server/application";
import { readServerConfig } from "../../src/server/config";
import { migrateDatabase } from "../../src/server/db/migrate";
import { provisionSyntheticMember } from "../../src/server/db/synthetic";
import { createObjectStore, storageConfigFromEnv } from "../../src/server/storage";
import { getFolderAccess } from "../../src/server/permissions/service";
import { createStorageBudget } from "../../src/server/storage/quota";
import type { CaptureDto, CaptureArtifactDto, CaptureDocumentDto } from "../../src/shared/capture-contract";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
describe("Capture interoperates with the existing document ledger", () => {
  const config = readServerConfig();
  if (config.environment !== "local" || !/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)
    || !/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID ?? "")) throw new Error("Owned synthetic bench required");
  const pool = new Pool({ connectionString: config.databaseUrl, max: 8 });
  const store = createObjectStore();
  const app = createApplication(pool, config, { store });
  let cookie: string, actorId: string, folderId: string, image: Buffer;
  function request(route: string, body?: unknown, method?: string) {
    const headers = new Headers({ origin: config.origin, cookie });
    if (body !== undefined) headers.set("content-type", body instanceof Uint8Array ? "application/octet-stream" : "application/json");
    return new Request(config.origin + "/api/hestia/" + route, { headers, method: method ?? (body === undefined ? "GET" : "POST"),
      ...(body === undefined ? {} : { body: body instanceof Uint8Array ? new Uint8Array(body) : JSON.stringify(body) }) });
  }
  async function data(response: Response, status = 200) { const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(status); return body; }
  beforeAll(async () => {
    expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();
    await migrateDatabase(pool, config);
    image = await sharp({ create: { width: 80, height: 120, channels: 3, background: "#d0e5ef" } }).png().toBuffer();
  });
  beforeEach(async () => {
    const email = `capture-bridge-${randomUUID()}@example.invalid`, password = "Synthetic capture bridge phrase only!";
    actorId = await provisionSyntheticMember(pool, { email, password, name: "Auteur synthétique Capture" });
    await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');
    const login = await app.handleAuth(new Request(config.origin + "/api/auth/sign-in/email", { method: "POST",
      headers: { origin: config.origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    expect(login.status).toBe(200); cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    folderId = (await data(await app.handleFolders(request("folders", { name: `Capture ${randomUUID()}` })), 201)).folder.id;
  });
  afterAll(async () => { await pool.end(); });
  async function savedPage(instance = app, kind: "camera" | "import" = "camera") {
    let capture: CaptureDto = (await data(await instance.handleCaptures(request("capture", {
      kind, idempotencyKey: randomUUID(), currentFolderId: folderId,
    })), 201)).capture;
    const reserved = await data(await instance.handleCapturePages(request(`capture/${capture.id}/pages`, {
      version: capture.version, idempotencyKey: randomUUID(), fileName: "synthetic.png", mediaType: "image/png", size: image.length, sha256: hash(image),
    }), capture.id));
    const pageId = reserved.upload.id;
    await data(await instance.handleCapturePageChunk(request(`capture/${capture.id}/pages/${pageId}/chunks/0`, image, "PUT"), capture.id, pageId, "0"));
    capture = (await data(await instance.handleCapturePageComplete(request(`capture/${capture.id}/pages/${pageId}/complete`, {
      version: reserved.captureVersion,
    }), capture.id, pageId))).capture;
    return capture;
  }
  async function finalize(capture: CaptureDto) {
    const prepared = await data(await app.handleCapturePrepare(request(`capture/${capture.id}/prepare`, { version: capture.version }), capture.id));
    const artifact: CaptureArtifactDto = prepared.artifact;
    const input = { version: prepared.capture.version, artifactId: artifact.id, destination: { kind: "existing", folderId }, keepDuplicate: false };
    const preview = (await data(await app.handleCapturePreview(request(`capture/${capture.id}/preview`, input), capture.id))).preview;
    const body = { ...input, previewToken: preview.previewToken, idempotencyKey: randomUUID() };
    const committed = await data(await app.handleCaptureFinalize(request(`capture/${capture.id}/finalize`, body), capture.id));
    expect(committed.status).toBe("recorded"); return committed.document as CaptureDocumentDto;
  }
  it("counts temporary Capture storage against the legacy upload budget", async () => {
    const limited = createApplication(pool, config, { store, limits: { memberBytes: image.length * 2 } });
    await savedPage(limited);
    const response = await limited.handleUploads(request("uploads", { folderId, idempotencyKey: randomUUID(),
      title: "Dépassement synthétique", fileName: "synthetic.png", size: image.length * 2, mediaType: "image/png", sha256: hash(image), source: "import" }));
    expect(response.status).toBe(413); expect((await response.json()).error.code).toBe("QUOTA_EXCEEDED");
    const client = await pool.connect();
    try { expect((await createStorageBudget().usage(client, actorId)).memberBytes).toBeGreaterThanOrEqual(image.length); }
    finally { client.release(); }
  });
  it("publishes an intact import through the durable ledger and exports only published originals", async () => {
    const temporary = await savedPage();
    const document = await finalize(await savedPage(app, "import"));
    expect(document.sha256).toBe(hash(image));
    const row = (await pool.query(`SELECT d.*,u.id AS upload_id FROM hestia_document d
      JOIN hestia_upload u ON u.document_id=d.id JOIN hestia_upload_object o ON o.object_key=d.object_key
      WHERE d.id=$1 AND u.status='completed' AND o.kind='original' AND o.ready AND o.deleted_at IS NULL`, [document.id])).rows[0];
    expect(row).toBeTruthy();
    // The export selects published records, not a bucket prefix containing drafts.
    const exported = (await pool.query("SELECT id,object_key,size,sha256 FROM hestia_document WHERE uploaded_by=$1 AND trashed_at IS NULL AND purged_at IS NULL", [actorId])).rows;
    expect(exported.map(entry => entry.id)).toEqual([document.id]);
    const temporaryKeys = (await pool.query("SELECT object_key FROM hestia_capture_object WHERE capture_id=$1 AND NOT promoted", [temporary.id])).rows.map(entry => entry.object_key);
    expect(exported.some(entry => temporaryKeys.includes(entry.object_key))).toBe(false);
    const download = await app.handleDocumentContent(request(`documents/${document.id}/content?intent=download&offset=0&length=${image.length}`), document.id);
    expect(download.status).toBe(206); expect(hash(new Uint8Array(await download.arrayBuffer()))).toBe(hash(image));
    await app.cleanupCaptures(100, 1000);
    const restarted = createApplication(pool, config, { store });
    const afterCleanup = await restarted.handleDocumentContent(request(`documents/${document.id}/content?intent=download&offset=0&length=${image.length}`), document.id);
    expect(afterCleanup.status).toBe(206); expect(hash(new Uint8Array(await afterCleanup.arrayBuffer()))).toBe(hash(image));
  });
  it("restores only published Capture finals into an empty schema and private bucket", async () => {
    const temporary=await savedPage(), document=await finalize(await savedPage());
    // Export a deliberately bounded synthetic document archive, never auth,
    // credentials, provider settings, drafts or an unfiltered bucket prefix.
    const specs=[
      ["hestia_member","user_id=$1",actorId], ["hestia_folder","id=$1",folderId],
      ["hestia_grant","folder_id=$1",folderId], ["hestia_upload","document_id=$1",document.id],
      ["hestia_upload_object","object_key=(SELECT object_key FROM hestia_document WHERE id=$1)",document.id],
      ["hestia_document","id=$1",document.id],
    ];
    const archive:Record<string,Record<string,unknown>[]>={};
    for(const [table,where,value] of specs)archive[table]=(await pool.query(`SELECT row_to_json(t) AS data FROM ${table} t WHERE ${where}`,[value])).rows.map(r=>r.data);
    const original=archive.hestia_document[0], key=String(original.object_key), size=Number(original.size);
    const bytes=await store.getRange(key,0,size-1);expect(hash(bytes)).toBe(original.sha256);
    const draftKeys=(await pool.query("SELECT object_key FROM hestia_capture_object WHERE capture_id=$1 AND NOT promoted",[temporary.id])).rows.map(r=>r.object_key);
    expect(draftKeys).not.toContain(key);
    const schema=`capture_restore_${randomUUID().replaceAll('-','')}`,client=await pool.connect();
    const storage=storageConfigFromEnv(),bucket=`hestia-test-${process.env.HESTIA_TEST_RUN_ID!.slice('hestia-app-'.length)}-capture-restore`;
    const transport=new S3Client({endpoint:storage.endpoint,region:storage.region,credentials:{accessKeyId:storage.accessKeyId,secretAccessKey:storage.secretAccessKey},forcePathStyle:true,maxAttempts:1});
    const target=createObjectStore({...storage,bucket});let created=false;
    try{
      await client.query("BEGIN");await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET LOCAL search_path TO ${schema}`);
      await client.query('CREATE TABLE "user"(id text PRIMARY KEY,name text NOT NULL); CREATE TABLE session(id text PRIMARY KEY)');
      for(const id of ["001-folders","002-documents","003-access","004-trash","005-family-members","006-family-identity","007-mail-delivery","008-folder-tree","009-folder-move","010-folder-trash","011-capture","012-classification"]){
        await client.query(await readFile(new URL(`../../src/server/db/migrations/${id}.sql`,import.meta.url),"utf8"));
        if(id==="008-folder-tree")await client.query("ALTER TABLE hestia_folder ALTER COLUMN name_key SET NOT NULL");
      }
      await client.query('INSERT INTO "user" VALUES($1,$2)',[actorId,"Auteur synthétique restauré"]);
      // Break the upload/document insertion cycle without changing archived bytes.
      for(const [table] of specs)for(const row of archive[table]){
        const data=table==="hestia_upload"?{...row,document_id:null}:row;
        await client.query(`INSERT INTO ${table} OVERRIDING SYSTEM VALUE SELECT * FROM json_populate_record(NULL::${table},$1::json)`,[JSON.stringify(data)]);
      }
      await client.query("UPDATE hestia_upload SET document_id=$1 WHERE id=$2",[document.id,archive.hestia_upload[0].id]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      expect((await getFolderAccess(client,actorId,folderId)).capabilities).toContain("consulter");
      expect(await createStorageBudget().usage(client,actorId)).toEqual({totalBytes:size,memberBytes:size});
      expect((await client.query("SELECT count(*) FROM hestia_capture_object")).rows[0].count).toBe("0");
      expect((await client.query("SELECT count(*) FROM hestia_capture")).rows[0].count).toBe("0");
      await transport.send(new CreateBucketCommand({Bucket:bucket}));created=true;await target.put(key,bytes,String(original.media_type));
      expect(hash(await target.getRange(key,0,size-1))).toBe(original.sha256);
      for(const draftKey of draftKeys)await expect(target.getRange(draftKey,0,1)).rejects.toThrow();
      await client.query("COMMIT");
    }finally{
      await client.query("ROLLBACK");
      if(!/^capture_restore_[a-f0-9]{32}$/.test(schema))throw new Error("Invalid owned schema");
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);client.release();
      if(created){await target.delete(key);await transport.send(new DeleteBucketCommand({Bucket:bucket}));}transport.destroy();
    }
  });
});
