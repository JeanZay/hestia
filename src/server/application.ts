import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { createAuth } from "./auth/options";
import type { ServerConfig } from "./config";
import { CAPABILITIES } from "./permissions/capabilities";
import { createSharing, getFolderAccess, getFolderAccessEvaluator } from "./permissions/service";
import { folderNameKey } from "./db/folder-name";

import { createAccess, HttpError, unavailable, unauthenticated, invalid, response, guarded, json, textField, isUuid, type Actor } from "./access";
import { createDocuments, type DocumentDependencies } from "./documents/service";
import { createFolderMoves } from "./documents/moves";
import { createFolderTrash } from "./documents/folder-trash";
import { createIdentity, revokeIdentityArtifacts } from "./identity";
import { createMembership } from "./membership/service";
import { createStorageBudget } from "./storage/quota";
import { createCaptureService } from "./capture";
import type { CaptureDependencies } from "./capture/types";
import { createClassificationService } from "./classification/service";
import { createClassificationCredentialCipher } from "./classification/cipher";
import { DEFAULT_CLASSIFICATION_LIMITS, type ClassificationDependencies } from "./classification/types";
const folderName = (value: unknown) => textField(value, 120);
type Folder = { id: string; name: string; version: number; capabilities: string[]; documentCount: number; docCount:number;
  visibleParentId:string|null; breadcrumbs:{id:string;name:string}[]; childCount:number; canShare:boolean; canAdminister:boolean; createdAt:string; createdByName:string };
type FolderRow = { id:string; name:string; version:number; parent_folder_id:string|null; document_count:string; created_at:Date; creator_name:string };
type FolderOperation = {kind:"create";name:string;parentId:string|null} | {kind:"rename";name:string;folderId:string;version:number};
const folderBudget = () => new HttpError(503,"RESOURCE_LIMIT","Cette opération est trop importante. Réessayez plus tard.");
const nameUnavailable = () => new HttpError(409,"NAME_UNAVAILABLE","Ce nom n’est pas disponible ici. Choisissez un autre nom.");
const operationConflict = () => new HttpError(409,"IDEMPOTENCY_CONFLICT","Cette opération correspond à une autre demande.");
const operationHash = (op:FolderOperation) => createHash("sha256").update(JSON.stringify(op.kind === "create"
  ? [op.kind,op.name,op.parentId] : [op.kind,op.name,op.folderId,op.version])).digest("hex");
function parentId(value:unknown):string|null { if (value===undefined||value===null) return null; if (!isUuid(value)) throw invalid(); return value.toLowerCase(); }
function operationKey(value:unknown):string { if (value===undefined) return randomUUID(); if (!isUuid(value)) throw invalid(); return value.toLowerCase(); }
function renameOperation(id:string,input:Record<string,unknown>):FolderOperation {
  if (!isUuid(id) || !Number.isSafeInteger(input.version) || Number(input.version)<1 || Number(input.version)>=2_147_483_647) throw invalid();
  return {kind:"rename",name:folderName(input.name),folderId:id.toLowerCase(),version:Number(input.version)};
}

export type ApplicationDependencies = DocumentDependencies & {
  capture?: Omit<CaptureDependencies, "store" | "budget">;
  classification?: Partial<Omit<ClassificationDependencies, "capture">>;
};
export function createApplication(pool: Pool, config: ServerConfig, dependencies?: ApplicationDependencies) {
  const auth = createAuth(pool, config);
  const access = createAccess(pool, config, auth);
  const { origin, transaction, withActor } = access;
  async function foldersFor(client: PoolClient, actor: Actor, id?: string): Promise<Folder[]> {
    const found = await client.query<FolderRow>(`SELECT f.id,f.name,f.version,f.parent_folder_id,f.created_at,u.name AS creator_name,(SELECT count(*) FROM hestia_document d WHERE d.folder_id=f.id AND d.trashed_at IS NULL AND d.purged_at IS NULL) AS document_count
      FROM hestia_folder f JOIN "user" u ON u.id=f.created_by WHERE f.trashed_at IS NULL ORDER BY f.created_at,f.id LIMIT 10001`);
    if (found.rows.length>10000) throw folderBudget();
    const evaluate=await getFolderAccessEvaluator(client,actor.id);
    const folders:Folder[]=[];
    for (const row of found.rows) {
      const rights=evaluate(row.id);
      if (!rights.capabilities.includes('consulter')) continue;
      folders.push({id:row.id,name:row.name,version:row.version,capabilities:rights.capabilities,
        documentCount:Number(row.document_count),docCount:Number(row.document_count),visibleParentId:null,breadcrumbs:[],childCount:0,
        canShare:rights.canShare,canAdminister:rights.canAdminister,createdAt:row.created_at.toISOString(),createdByName:row.creator_name});
    }
    const visible=new Map(folders.map(folder=>[folder.id,folder]));
    const parents=new Map(found.rows.map(row=>[row.id,row.parent_folder_id]));
    let breadcrumbWork=0;
    for (const folder of folders) {
      const parent=parents.get(folder.id);
      folder.visibleParentId=parent && visible.has(parent) ? parent : null;
      if (folder.visibleParentId) visible.get(folder.visibleParentId)!.childCount++;
      const chain:Folder[]=[];const seen=new Set<string>();let current:Folder|undefined=folder;
      while (current) {
        if (++breadcrumbWork>1_000_000) throw folderBudget();
        if (seen.has(current.id)) throw folderBudget();
        seen.add(current.id);chain.push(current);
        const next=parents.get(current.id);current=next ? visible.get(next) : undefined;
      }
      folder.breadcrumbs=chain.reverse().map(({id,name})=>({id,name}));
    }
    return id ? folders.filter(folder=>folder.id===id) : folders;
  }
  async function currentEpoch(client:PoolClient,actor:Actor) {
    return Number((await client.query("SELECT epoch FROM hestia_member WHERE user_id=$1",[actor.id])).rows[0]?.epoch);
  }
  async function receipt(client:PoolClient,actor:Actor,key:string,operation:FolderOperation):Promise<Folder|null> {
    const previous=(await client.query("SELECT request_sha256,actor_epoch,folder_id,kind FROM hestia_folder_receipt WHERE actor_id=$1 AND idempotency_key=$2",[actor.id,key])).rows[0];
    if (!previous) return null;
    if (Number(previous.actor_epoch)!==await currentEpoch(client,actor)) throw unavailable();
    if (previous.request_sha256!==operationHash(operation)||previous.kind!==operation.kind) throw operationConflict();
    const folder=(await foldersFor(client,actor,previous.folder_id))[0];
    if (!folder) throw unavailable();
    return folder;
  }
  async function saveReceipt(client:PoolClient,actor:Actor,key:string,operation:FolderOperation,id:string) {
    await client.query(`INSERT INTO hestia_folder_receipt(actor_id,idempotency_key,request_sha256,actor_epoch,folder_id,kind)
      VALUES($1,$2,$3,$4,$5,$6)`,[actor.id,key,operationHash(operation),await currentEpoch(client,actor),id,operation.kind]);
  }
  async function checkName(client:PoolClient,name:string,parent:string|null,creator:string,except?:string) {
    const collision=await client.query(`SELECT 1 FROM hestia_folder WHERE trashed_at IS NULL AND name_key=$1
      AND parent_folder_id IS NOT DISTINCT FROM $2::uuid AND ($2::uuid IS NOT NULL OR created_by=$3)
      AND ($4::uuid IS NULL OR id<>$4::uuid) LIMIT 1`,[folderNameKey(name),parent,creator,except??null]);
    if (collision.rowCount) throw nameUnavailable();
  }
  function handleAuth(request: Request) {
    return guarded(async () => {
      const url = new URL(request.url);
      const login = url.pathname === "/api/auth/sign-in/email";
      const logout = url.pathname === "/api/auth/sign-out";
      if (url.search || request.method !== "POST" || (!login && !logout)) throw new HttpError(404, "NOT_FOUND", "Action indisponible.");
      origin(request);
      const input = await json(request, login ? ["email", "password"] : []);
      if (login && (typeof input.email !== "string" || typeof input.password !== "string"
        || input.email.length > 254 || input.password.length > 128)) throw invalid();
      const email = login ? (input.email as string).trim().toLowerCase() : "";
      const before = login ? (await pool.query(`SELECT m.user_id,m.active,m.epoch,m.recovering FROM hestia_member m
        JOIN "user" u ON u.id=m.user_id WHERE u.email=$1`, [email])).rows[0] : null;
      if (login && before?.recovering) throw new HttpError(401, "INVALID_CREDENTIALS", "Adresse ou mot de passe incorrect.");
      const next = new Request(request.url, { method: "POST", headers: request.headers,
        body: JSON.stringify(login ? { email, password: input.password, rememberMe: false } : {}) });
      const result = await auth.handler(next);
      if (!result.ok) {
        if (result.status === 429) throw new HttpError(429, "RATE_LIMITED", "Trop de tentatives. Réessayez plus tard.");
        throw new HttpError(401, "INVALID_CREDENTIALS", "Adresse ou mot de passe incorrect.");
      }
      if (logout) return response({ success: true }, 200, result.headers);
      const cookie = result.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
      const session = await auth.api.getSession({ headers: new Headers({ cookie }), query: { disableCookieCache: true } });
      if (!session) throw unauthenticated();
      const admitted = await transaction(async client => {
        const current = (await client.query("SELECT active,epoch,recovering FROM hestia_member WHERE user_id=$1 FOR UPDATE", [session.user.id])).rows[0];
        if (!before?.active || before.recovering || before.user_id !== session.user.id || !current?.active || current.recovering || before.epoch !== current.epoch) {
          await client.query("DELETE FROM session WHERE id=$1", [session.session.id]);
          return false;
        }
        await client.query("INSERT INTO hestia_session_policy(session_id,member_epoch) VALUES($1,$2)", [session.session.id,current.epoch]);
        return true;
      });
      if (!admitted) throw new HttpError(401, "INVALID_CREDENTIALS", "Adresse ou mot de passe incorrect.");
      return response({ user: { id: session.user.id, name: session.user.name, email: session.user.email } }, 200, result.headers);
    });
  }
  function handleSession(request: Request) {
    // Background admission polling must not keep an idle browser signed in.
    return guarded(async () => response({ user: await withActor(request, async (client, actor) => {
      const member = (await client.query("SELECT role FROM hestia_member WHERE user_id=$1", [actor.id])).rows[0];
      return { ...actor, role: member.role as "owner" | "admin" | "member" };
    }, false) }));
  }
  function handleFolders(request: Request) {
    return guarded(async () => {
      if (request.method === "GET") return response({ folders: await withActor(request, foldersFor, false) });
      if (request.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Action indisponible.");
      origin(request);
      const input=await json(request,["name","parentId","idempotencyKey"]);
      const operation:FolderOperation={kind:"create",name:folderName(input.name),parentId:parentId(input.parentId)};
      const key=operationKey(input.idempotencyKey);
      const folder = await withActor(request, async (client, actor) => {
        const previous=await receipt(client,actor,key,operation);
        if (previous) return previous;
        if (operation.parentId) {
          const rights=await getFolderAccess(client,actor.id,operation.parentId);
          if (!rights.capabilities.includes("consulter")||!rights.capabilities.includes("modifier")) throw unavailable();
        }
        await checkName(client,operation.name,operation.parentId,actor.id);
        const id = randomUUID();
        await client.query("INSERT INTO hestia_folder(id,name,name_key,created_by,parent_folder_id) VALUES($1,$2,$3,$4,$5)", [id,operation.name,folderNameKey(operation.name),actor.id,operation.parentId]);
        // A child receives no creator grant: placement supplies its living rights.
        if (!operation.parentId) for (const capability of CAPABILITIES) {
          await client.query(`INSERT INTO hestia_grant(id,folder_id,user_id,capability,kind,transmit,author_id,subject_epoch,batch_id)
            VALUES($1,$2,$3,$4,$5,$6,$3,(SELECT departure_epoch FROM hestia_member WHERE user_id=$3),$2)`,
            [randomUUID(),id,actor.id,capability,capability === "administrer" ? "reference" : "direct",
              capability==='administrer' ? [...CAPABILITIES] : capability==='partager' ? CAPABILITIES.filter(c=>c!=='administrer') : []]);
        }
        if (!operation.parentId) await client.query("UPDATE hestia_folder SET reference_grant_id=(SELECT id FROM hestia_grant WHERE folder_id=$1 AND kind='reference' AND revoked_at IS NULL) WHERE id=$1", [id]);
        await saveReceipt(client,actor,key,operation,id);
        const created=(await foldersFor(client,actor,id))[0];
        if (!created) throw unavailable();
        return created;
      });
      return response({ folder }, 201);
    });
  }
  function handleFolder(request: Request, id: string) {
    return guarded(async () => {
      if (!isUuid(id)) throw unavailable();
      id=id.toLowerCase();
      if (request.method==="GET") return response({folder:await withActor(request,async(client,actor)=>{
        const folder=(await foldersFor(client,actor,id))[0];if(!folder)throw unavailable();return folder;
      },false)});
      if (request.method!=="PATCH") throw new HttpError(405,"METHOD_NOT_ALLOWED","Action indisponible.");
      origin(request);
      const input = await json(request, ["name", "version", "idempotencyKey"]);
      const operation=renameOperation(id,input),key=operationKey(input.idempotencyKey);
      const folder = await withActor(request, async (client, actor) => {
        const previous=await receipt(client,actor,key,operation);if(previous)return previous;
        const row=(await client.query("SELECT parent_folder_id,created_by FROM hestia_folder WHERE id=$1 AND trashed_at IS NULL FOR UPDATE",[id])).rows[0];
        if (!row)throw unavailable();
        const current = (await foldersFor(client, actor, id))[0];
        if (!current || !current.capabilities.includes("modifier")) throw unavailable();
        if (current.version!==input.version) throw new HttpError(409,"VERSION_CONFLICT","Ce dossier a changé. Actualisez-le avant de réessayer.");
        await checkName(client,operation.name,row.parent_folder_id,row.created_by,id);
        const updated = await client.query("UPDATE hestia_folder SET name=$1,name_key=$4,version=version+1,updated_at=clock_timestamp() WHERE id=$2 AND version=$3 RETURNING version", [operation.name,id,input.version,folderNameKey(operation.name)]);
        if (!updated.rowCount) throw new HttpError(409, "VERSION_CONFLICT", "Ce dossier a changé. Actualisez-le avant de réessayer.");
        await saveReceipt(client,actor,key,operation,id);
        return (await foldersFor(client,actor,id))[0];
      });
      return response({ folder });
    });
  }
  function handleFolderOperation(request:Request,key:string) {
    return guarded(async()=>{
      if(request.method!=="POST")throw new HttpError(405,"METHOD_NOT_ALLOWED","Action indisponible.");
      origin(request);if(!isUuid(key))throw invalid();
      const input=await json(request,["kind","name","parentId","folderId","version"]);
      let operation:FolderOperation;
      if(input.kind==="create"){
        if(input.folderId!==undefined||input.version!==undefined)throw invalid();
        operation={kind:"create",name:folderName(input.name),parentId:parentId(input.parentId)};
      }else if(input.kind==="rename"){
        if(input.parentId!==undefined||!isUuid(input.folderId))throw invalid();
        operation=renameOperation(input.folderId,input);
      }else throw invalid();
      return response(await withActor(request,async(client,actor)=>{
        const folder=await receipt(client,actor,key.toLowerCase(),operation);
        return folder?{status:"committed",folder}:{status:"not-recorded"};
      }));
    });
  }
  const budget=dependencies?.budget ?? createStorageBudget(dependencies?.limits?.memberBytes, dependencies?.limits?.globalBytes);
  const documents=createDocuments(pool, access, dependencies ? {...dependencies,budget} : undefined);
  const missingStorage=async ():Promise<never> => { throw new Error("Object storage is not configured"); };
  const clock=async (client:PoolClient) => dependencies?.now?.() ?? (await client.query<{now:Date}>("SELECT clock_timestamp() AS now")).rows[0].now;
  const capture=createCaptureService(pool,access,{
    store:dependencies?.store ?? {put:missingStorage,getRange:missingStorage,delete:missingStorage},
    budget,clock,validateOriginal:dependencies?.validateOriginal,
    ...dependencies?.capture,
  });
  const {analysis,...captureHandlers}=capture;
  const classification=createClassificationService(pool,access,{
    clock,capture:analysis,
    readAuthorizedFolders:async(client,actor)=>(await foldersFor(client,actor))
      .filter(folder=>folder.capabilities.includes("déposer"))
      .map(folder=>({id:folder.id,name:folder.name,path:folder.breadcrumbs,canCreate:folder.capabilities.includes("modifier")})),
    credentialCipher:createClassificationCredentialCipher(config.secret),
    providers:[],allowRemote:false,...DEFAULT_CLASSIFICATION_LIMITS,...dependencies?.classification,
  });
  const folderTrash=createFolderTrash(access, { now: dependencies?.now });
  return { handleAuth, handleSession, handleFolders, handleFolder, handleFolderOperation, ...createSharing(access),
    ...createFolderMoves(access, { now: dependencies?.now }),
    ...documents, ...folderTrash, ...captureHandlers, ...classification,
    async cleanupTrash(limit:number) {
      const result=await documents.cleanupTrash(limit);
      await folderTrash.cleanupFolderTrash(limit);
      return result;
    }, ...createIdentity(pool, config, access),
    ...createMembership(access, { revokeIdentityArtifacts }) };
}


