import { createServer } from 'node:net';

/** Never reuse a pre-existing server as evidence for this candidate. */
export async function assertPortAvailable(host, port) {
  await new Promise((resolveProbe, rejectProbe) => {
    const probe = createServer();
    probe.once('error', () => rejectProbe(new Error(`Port de test ${port} indisponible ; aucun serveur existant ne sera utilisé.`)));
    probe.listen({ host, port, exclusive: true }, () => {
      probe.close(error => error ? rejectProbe(error) : resolveProbe());
    });
  });
}

/** Unexpected server death invalidates the run even if another server answers. */
export async function completeWithOwnedServer(tests, server) {
  let testsFinished = false;
  return Promise.race([
    tests.completion.then(code => { testsFinished = true; return code; }),
    server.completion.then(() => {
      if (!testsFinished) tests.processChild.kill();
      return 1;
    })
  ]);
}
