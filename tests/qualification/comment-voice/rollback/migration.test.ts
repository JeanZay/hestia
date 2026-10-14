import {expect,it} from "vitest";
import {Pool} from "pg";
import {readServerConfig} from "../../../../src/server/config";
import {migrateDatabase} from "../../../../src/server/db/migrate";

it("upgrades the real N-1 schema additively or reapplies N without losing records",async()=>{
  const config=readServerConfig(),runId=process.env.HESTIA_TEST_RUN_ID,expected=process.env.HESTIA_ROLLBACK_EXPECT_MIGRATIONS;
  if(config.environment!=="local"||!/^hestia-app-[a-f0-9]{16}$/.test(runId??"")||!/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)||!["13","15"].includes(expected??""))throw Error("Owned rollback database and explicit starting version required");
  const pool=new Pool({connectionString:config.databaseUrl,max:1});
  try{
    expect((await pool.query("SELECT run_id FROM hestia_bench_marker")).rows).toEqual([{run_id:runId}]);
    const before=(await pool.query("SELECT id,checksum FROM hestia_migration ORDER BY id")).rows;
    expect(before).toHaveLength(Number(expected));
    const members=(await pool.query("SELECT user_id,epoch,role,active FROM hestia_member ORDER BY user_id")).rows;
    expect(members).toHaveLength(2);
    const capture=(await pool.query("SELECT * FROM hestia_capture ORDER BY id")).rows;
    const costs=expected==="15"?(await pool.query("SELECT * FROM hestia_transcription_request ORDER BY id")).rows:[];
    await migrateDatabase(pool,config);
    const after=(await pool.query("SELECT id,checksum FROM hestia_migration ORDER BY id")).rows;
    expect(after).toHaveLength(15);expect(after.slice(0,before.length)).toEqual(before);
    expect((await pool.query("SELECT user_id,epoch,role,active FROM hestia_member ORDER BY user_id")).rows).toEqual(members);
    if(expected==="15")expect((await pool.query("SELECT * FROM hestia_capture ORDER BY id")).rows).toEqual(capture);
    else expect(capture).toEqual([]);
    expect((await pool.query("SELECT * FROM hestia_transcription_request ORDER BY id")).rows).toEqual(costs);
    expect((await pool.query("SELECT enabled,credential_sealed FROM hestia_transcription_config WHERE id=1")).rows).toEqual([{enabled:false,credential_sealed:null}]);
  }finally{await pool.end();}
});
