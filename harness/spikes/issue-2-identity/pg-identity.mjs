// Library qualification fixture, not an Hestia authentication implementation.
import './pg-fence.mjs';
import pg from 'pg';
import {randomBytes,randomUUID} from 'node:crypto';
import {betterAuth} from 'better-auth';
import {getMigrations} from 'better-auth/db/migration';
import {createTestDatabase} from './pg-support.mjs';
export const origin='https://hestia.invalid',password='Phrase synthétique pour le banc PostgreSQL!';
export function makeOptions(pool,secret,mail,{hookFails=false}={}){
  return{database:pool,baseURL:origin,secret,trustedOrigins:[origin],telemetry:{enabled:false},logger:{disabled:true},
    emailAndPassword:{enabled:true,disableSignUp:true,requireEmailVerification:true,autoSignIn:false,minPasswordLength:15,maxPasswordLength:128,revokeSessionsOnPasswordReset:true,
      sendResetPassword:async x=>mail.push(x),...(hookFails?{onPasswordReset:async()=>{throw Error('SYNTHETIC_HOOK_FAILURE');}}:{})},
    verification:{storeIdentifier:'hashed'},session:{cookieCache:{enabled:false},disableSessionRefresh:true,expiresIn:604800},
    rateLimit:{enabled:true,storage:'database',window:60,max:100},advanced:{useSecureCookies:true}};
}
export async function createPgIdentity(options={}){
  const db=await createTestDatabase(),poolB=new pg.Pool(db.config),secret=randomBytes(48).toString('base64url'),mail=[];
  await(await getMigrations(makeOptions(db.pool,secret,mail,options))).runMigrations();
  const authA=betterAuth(makeOptions(db.pool,secret,mail,options)),authB=betterAuth(makeOptions(poolB,secret,mail,options));
  const ctxA=await authA.$context,ctxB=await authB.$context;
  async function seed(email,{verified=true}={}){
    const id=randomUUID(),hash=await ctxA.password.hash(password),client=await db.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,$4,now(),now())',[id,'Synthetic member',email,verified]);
      await client.query('INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,$3,$2,$4,now(),now())',[randomUUID(),id,'credential',hash]);
      await client.query('COMMIT');return id;
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  const call=(auth,route,{body,cookie,method=body?'POST':'GET'}={})=>{
    const headers=new Headers({origin});if(body)headers.set('content-type','application/json');if(cookie)headers.set('cookie',cookie);
    return auth.handler(new Request(origin+'/api/auth'+route,{method,headers,...(body?{body:JSON.stringify(body)}:{})}));
  };
  const login=async(auth=authA,email='member@example.invalid',pw=password)=>{
    const response=await call(auth,'/sign-in/email',{body:{email,password:pw}});
    return{response,cookie:response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};
  };
  return{...db,poolB,secret,mail,authA,authB,ctxA,ctxB,seed,call,login,close:async()=>{await poolB.end();await db.close();}};
}
