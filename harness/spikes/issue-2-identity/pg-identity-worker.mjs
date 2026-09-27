import './pg-fence.mjs';
import pg from 'pg';
import {betterAuth} from 'better-auth';
import {makeOptions} from './pg-identity.mjs';
process.once('message',async m=>{
  let pool;
  try{
    pool=new pg.Pool(m.config);const auth=betterAuth(makeOptions(pool,m.secret,[]));
    const pid=(await pool.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    const session=await auth.api.getSession({headers:new Headers({cookie:m.cookie})});
    if(m.revoke&&session)await(await auth.$context).internalAdapter.deleteUserSessions(session.user.id);
    process.send({ok:true,pid,sessionPresent:!!session});
  }catch{process.send({ok:false,error:'WORKER_FAILED'});}
  finally{if(pool)await pool.end();process.disconnect();}
});
