// Explicit operator command. Input is read from stdin, never argv/logs.
// The private link is queued encrypted; this command never prints it or sends mail.
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const sourceRoot=path.resolve('src/server');
registerHooks({
  resolve(specifier,context,nextResolve) {
    if(specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const url=new URL(specifier,context.parentURL),filename=fileURLToPath(url);
      if(filename.startsWith(sourceRoot+path.sep)) {
        for(const suffix of ['.ts','/index.ts'])if(existsSync(filename+suffix))return nextResolve(new URL(specifier+suffix,context.parentURL).href,context);
      }
    }
    return nextResolve(specifier,context);
  },
  load(url,context,nextLoad) {
    if(url.startsWith('file:')&&url.endsWith('.ts')&&fileURLToPath(url).startsWith(sourceRoot+path.sep))
      return {format:'module',source:stripTypeScriptTypes(readFileSync(fileURLToPath(url),'utf8'),{mode:'transform'}),shortCircuit:true};
    return nextLoad(url,context);
  },
});
let pool;
try {
  if(!['bootstrap','exceptional-recovery'].includes(process.argv[2])||process.argv.length!==3)throw Error('INPUT');
  let bytes=0,text='';for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>4096)throw Error('INPUT');text+=chunk;}
  const input=JSON.parse(text),kind=process.argv[2];
  const keys=kind==='bootstrap'?['email','name']:['email','memberId','humanVerificationAcknowledged'];
  if(!input||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k)))throw Error('INPUT');
  if(kind==='exceptional-recovery'&&input.humanVerificationAcknowledged!==true)throw Error('INPUT');
  const [{Pool},{readServerConfig},{createAccess},{createAuth},{createIdentity}]=await Promise.all([
    import('pg'),import('../src/server/config.ts'),import('../src/server/access.ts'),import('../src/server/auth/options.ts'),import('../src/server/identity/index.ts')]);
  const config=readServerConfig();pool=new Pool({connectionString:config.databaseUrl});
  const identity=createIdentity(pool,config,createAccess(pool,config,createAuth(pool,config)));
  const result=kind==='bootstrap'?await identity.prepareInstallation(input.email,input.name):await identity.prepareExceptionalRecovery(input.memberId,input.email);
  process.stdout.write(JSON.stringify({flowId:result.flowId,delivery:'pending',transport:'not-invoked'})+'\n');
} catch {process.stderr.write('IDENTITY_OPERATOR_FAILED\n');process.exitCode=1;}finally{await pool?.end();}
