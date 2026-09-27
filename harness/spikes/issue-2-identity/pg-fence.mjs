// Instrumented test boundary, not an OS sandbox. Only this run's loopback DB.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
export const deniedNetwork=[];
const port=Number(process.env.HESTIA_PG_PORT);
if(process.env.HESTIA_PG_HOST!=='127.0.0.1'||!Number.isInteger(port)||port<1024||port>65535)throw Error('PG_ENDPOINT_REQUIRED');
const deny=kind=>{deniedNetwork.push(kind);throw Error('TEST_EGRESS_DENIED');};
const original=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  const values=Array.isArray(args[0])?args[0]:args;
  const first=values[0];
  const options=typeof first==='object'?first:{port:first,host:values[1]};
  if(options?.path||options?.host!=='127.0.0.1'||Number(options?.port)!==port)return deny('socket');
  return original.apply(this,args);
};
globalThis.fetch=()=>deny('fetch');
tls.connect=()=>deny('tls');
for(const m of[http,https]){m.request=()=>deny('http');m.get=()=>deny('http');}
syncBuiltinESMExports();
process.env.NODE_ENV='test';process.env.BETTER_AUTH_TELEMETRY='false';delete process.env.BETTER_AUTH_TELEMETRY_ENDPOINT;
