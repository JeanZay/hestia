/* Technical mailbox only. Configuration lives in private Script Properties, never this file. */
function hestiaRelayTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  var heartbeatReady = false;
  try {
    var p = PropertiesService.getScriptProperties();
    var c = { endpoint: p.getProperty('HESTIA_ENDPOINT'), environment: p.getProperty('HESTIA_ENVIRONMENT'), actor: p.getProperty('HESTIA_RELAY_ACTOR'), epoch: Number(p.getProperty('HESTIA_RELAY_EPOCH')), secret: p.getProperty('HESTIA_RELAY_SECRET') };
    if (!c.endpoint || !/^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(?::443)?\/api\/hestia\/inbox\/relay$/.test(c.endpoint) || !/^(dev|production)$/.test(c.environment) || !/^[A-Za-z0-9_-]{1,100}$/.test(c.actor) || !Number.isSafeInteger(c.epoch) || c.epoch < 1 || !c.secret || c.secret.length < 32) throw new Error('RELAY_CONFIGURATION');
    heartbeatReady = true;
    try { hestiaHeartbeat(c); } catch (_heartbeatBeforeError) { /* A lost tick never changes a message receipt or permits Trash. */ }
    var started = Date.now(), page = Gmail.Users.Messages.list('me', { q: '-in:trash -in:spam', maxResults: 10, pageToken: p.getProperty('HESTIA_PAGE_TOKEN') || undefined });
    var messages = page.messages || [];
    for (var index = 0; index < messages.length; index++) {
      if (Date.now() - started > 240000) break;
      var message = GmailApp.getMessageById(messages[index].id), raw = message.getRawContent();
      // The current qualified profile is raw ASCII. Never silently encode a lossy String conversion.
      var bytes = Utilities.newBlob(raw).getBytes();
      if (bytes.length < 1 || bytes.length > 100 * 1024 * 1024) continue;
      var base = { environment: c.environment, actor: c.actor, epoch: c.epoch, gmailId: messages[index].id, rawSha256: hestiaHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)), rawSize: bytes.length, chunks: Math.ceil(bytes.length / (720 * 1024)) };
      try {
        if (bytes.length > 32 * 1024 * 1024 || /[^\x09\x0a\x0d\x20-\x7e]/.test(raw)) { base.chunks = 0; hestiaExchange(c,base,'reject',0,[]); var rejected = hestiaExchange(c,base,'receipt',0,[]); if(rejected.terminal && rejected.outcome==='message_rejected') Gmail.Users.Messages.trash('me',messages[index].id); continue; }
        var receipt = hestiaExchange(c, base, 'receipt', 0, []);
        if (!receipt.terminal) {
          // Retransmission is safe against the durable chunk identity, including a lost response.
          for (var chunk = 0; chunk < base.chunks; chunk++) {
            if (Date.now() - started > 240000) return;
            hestiaExchange(c, base, 'chunk', chunk, bytes.slice(chunk * 720 * 1024, Math.min(bytes.length, (chunk + 1) * 720 * 1024)));
          }
          hestiaExchange(c, base, 'process', 0, []);
          // Reconcile the business receipt separately; a transport ACK never authorizes Trash.
          receipt = hestiaExchange(c, base, 'receipt', 0, []);
        }
        if (receipt.terminal && ['accepted','partial','no_attachments','all_rejected','message_rejected','sender_rejected'].indexOf(receipt.outcome) >= 0) Gmail.Users.Messages.trash('me', messages[index].id);
      } catch (_error) { /* No subjects, MIME, addresses, identifiers or secrets in logs. The message remains available. */ }
    }
    if (index === messages.length) { if (page.nextPageToken) p.setProperty('HESTIA_PAGE_TOKEN', page.nextPageToken); else p.deleteProperty('HESTIA_PAGE_TOKEN'); }
  } finally {
    if (heartbeatReady) try { hestiaHeartbeat(c); } catch (_heartbeatAfterError) { /* The next minute's poll resumes durable queued work. No private logs. */ }
    lock.releaseLock();
  }
}
function hestiaHeartbeat(c) {
  var tick = { environment: c.environment, actor: c.actor, epoch: c.epoch, timestamp: Date.now(), nonce: Utilities.getUuid().replace(/-/g,'') };
  var canonical = JSON.stringify([1,'hestia-inbox-tick',tick.environment,tick.actor,tick.epoch,tick.timestamp,tick.nonce]);
  var signature = hestiaHex(Utilities.computeHmacSha256Signature(canonical,c.secret));
  var response = UrlFetchApp.fetch(c.endpoint.replace(/\/relay$/,'/tick'), { method: 'post', contentType: 'application/json', payload: JSON.stringify(tick), headers: {'x-hestia-signature':signature}, followRedirects: false, muteHttpExceptions: true });
  if(response.getResponseCode() !== 200 || response.getContentText().length > 2048) throw new Error('RELAY_TICK_RESPONSE');
  var reply = JSON.parse(response.getContentText());
  var expected = hestiaHex(Utilities.computeHmacSha256Signature(JSON.stringify([1,'hestia-inbox-tick-response',reply.requestSha256,reply.nonce,reply.result]),c.secret));
  if(reply.requestSha256 !== hestiaHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,canonical)) || reply.nonce !== tick.nonce || !hestiaEqual(reply.signature,expected) || !reply.result || reply.result.accepted !== true) throw new Error('RELAY_TICK_AUTHENTICATION');
  return reply.result;
}
function hestiaExchange(c, base, operation, index, bytes) {
  var envelope = { environment: base.environment, actor: base.actor, epoch: base.epoch, gmailId: base.gmailId, rawSha256: base.rawSha256, rawSize: base.rawSize, chunks: base.chunks, operation: operation, index: index, chunkSha256: hestiaHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)), timestamp: Date.now(), nonce: Utilities.getUuid().replace(/-/g,''), payload: bytes.length ? Utilities.base64Encode(bytes) : '' };
  var canonical = JSON.stringify([1,envelope.environment,envelope.actor,envelope.epoch,envelope.gmailId,envelope.rawSha256,envelope.rawSize,envelope.chunks,envelope.operation,envelope.index,envelope.chunkSha256,envelope.timestamp,envelope.nonce,envelope.payload]);
  var signature = hestiaHex(Utilities.computeHmacSha256Signature(canonical, c.secret));
  var response = UrlFetchApp.fetch(c.endpoint, { method: 'post', contentType: 'application/json', payload: JSON.stringify(envelope), headers: {'x-hestia-signature':signature}, followRedirects: false, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200 || response.getContentText().length > 8192) throw new Error('RELAY_RESPONSE');
  var reply = JSON.parse(response.getContentText()), signed = { requestSha256: reply.requestSha256, nonce: reply.nonce, result: reply.result };
  var expected = hestiaHex(Utilities.computeHmacSha256Signature(JSON.stringify(signed), c.secret));
  if (reply.requestSha256 !== hestiaHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical)) || reply.nonce !== envelope.nonce || !hestiaEqual(reply.signature, expected)) throw new Error('RELAY_RESPONSE_AUTHENTICATION');
  return reply.result;
}
function hestiaHex(bytes) { return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }
function hestiaEqual(a,b) { if(typeof a !== 'string' || a.length !== b.length)return false;var d=0;for(var i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0; }
