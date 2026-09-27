import './pg-fence.mjs';
import pg from 'pg';
import {randomBytes} from 'node:crypto';
export function baseConfig(){
  const run=process.env.HESTIA_PG_RUN_ID;
  if(!/^hestia-q-[a-f0-9]{16}$/.test(run??'')||!process.env.HESTIA_PG_PASSWORD)throw Error('DEDICATED_RUN_REQUIRED');
  return{host:'127.0.0.1',port:Number(process.env.HESTIA_PG_PORT),user:'hestia_bench',password:process.env.HESTIA_PG_PASSWORD,database:'hestia_bench',ssl:false,application_name:run,connectionTimeoutMillis:5000,idleTimeoutMillis:1000,max:8};
}
export async function createTestDatabase(){
  const base=baseConfig(),admin=new pg.Pool(base),name='q_'+randomBytes(12).toString('hex');
  try{
    // Marker is installed once by the driver. Never create tests in an unknown DB.
    const marker=await admin.query('SELECT run_id FROM hestia_bench_marker');
    if(marker.rows.length!==1||marker.rows[0].run_id!==process.env.HESTIA_PG_RUN_ID)throw Error('WRONG_DATABASE');
    await admin.query('CREATE DATABASE '+name);
  }finally{await admin.end();}
  const config={...base,database:name},pool=new pg.Pool(config);
  return{pool,config,close:()=>pool.end()};
}
