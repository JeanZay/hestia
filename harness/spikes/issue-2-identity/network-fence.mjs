// Test-only process fence: no outbound sockets, HTTP or telemetry are permitted.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
export const networkAttempts = [];
const deny = (kind) => () => { networkAttempts.push(kind); throw new Error('TEST_EGRESS_DENIED'); };
globalThis.fetch = deny('fetch');
net.Socket.prototype.connect = deny('socket');
net.connect = deny('net');
net.createConnection = deny('net');
tls.connect = deny('tls');
for (const module of [http, https]) { module.request = deny('http'); module.get = deny('http'); }
process.env.BETTER_AUTH_TELEMETRY = 'false';
delete process.env.BETTER_AUTH_TELEMETRY_ENDPOINT;
process.env.NODE_ENV = 'test';
