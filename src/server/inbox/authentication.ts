import { createRequire } from 'node:module';
import { Resolver } from 'node:dns/promises';
import { MimeRejection, type MimeInventory } from './mime';
const require = createRequire(import.meta.url);
type Verdict = { signingDomain: string; algo: string; modulusLength?: number; signatureTimeValid: boolean; canonBodyLengthLimited: boolean; signature: string; status: { result: string }; signingHeaders: { keys: string[] } };
const { dkimVerify } = require('mailauth/lib/dkim/verify') as { dkimVerify(bytes: Uint8Array, options: object): Promise<{ results: Verdict[] }> };
const { simpleParser } = require('mailparser') as { simpleParser(bytes: Uint8Array, options: object): Promise<{ from?: { value: { address: string }[] }; to?: { value: { address: string }[] }; attachments: { checksum: string; content: Buffer }[] }> };
const required = ['from', 'to', 'subject', 'message-id', 'date', 'mime-version', 'content-type'];
/** Only the qualified gmail.com profile. Authentication-Results is never consulted. */
export async function authenticateGoogle(bytes: Uint8Array, inventory: MimeInventory, destination: string, now = new Date(), resolver?: (name: string, type: string) => Promise<string[][]>) {
  const { headers } = inventory;
  const reject = (): never => { throw new MimeRejection('sender_authentication'); };
  for (const field of required) if (!headers.has(field)) reject();
  if (headers.get('mime-version') !== '1.0' || headers.has('sender') || headers.has('resent-from') || headers.has('resent-to') || headers.has('reply-to') || headers.has('bcc')) reject();
  // Exactly one address; display names are harmless presentation. Groups/comments are outside this profile.
  const address = (value: string) => {
    const match = /^(?:[^<>(),;]*<)?([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com)>?$/.exec(value.trim());
    return match?.[1] ?? reject();
  };
  const sender = address(headers.get('from')!), recipient = address(headers.get('to')!); if (recipient !== destination) reject();
  const candidates = inventory.headerRows.filter(row => row.name === 'dkim-signature').map(row => {
    const tags = new Map<string, string>();
    for (const item of row.value.split(';')) { if (!item.trim()) continue; const index = item.indexOf('='); if (index < 1) reject(); const key = item.slice(0, index).trim().toLowerCase(); if (tags.has(key)) reject(); tags.set(key, item.slice(index + 1).trim()); }
    return tags;
  }).filter(tags => tags.get('d') === 'gmail.com' && tags.get('a') === 'rsa-sha256' && !tags.has('l'));
  if (!candidates.length || candidates.length > 5) reject();
  const dns = new Resolver({ timeout: 2000, tries: 1 }); let calls = 0;
  const resolve = async (name: string, type: string) => {
    if (++calls > 5 || type !== 'TXT' || !/^[a-zA-Z0-9_-]{1,63}\._domainkey\.gmail\.com\.?$/.test(name)) reject();
    const result = await (resolver ? resolver(name, type) : dns.resolveTxt(name));
    if (result.length > 10 || result.some(row => row.join('').length > 8192)) reject(); return result;
  };
  const verified = await dkimVerify(bytes, { resolver: resolve, minBitLength: 2048, strict: true, curTime: now });
  const semantic = [...required, ...['content-transfer-encoding', 'content-disposition', 'content-id', 'content-location'].filter(key => headers.has(key))];
  const valid = verified.results.some(result => {
    const tags = candidates.find(tags => tags.get('b')?.replace(/\s/g, '') === result.signature?.replace(/\s/g, ''));
    const names = tags?.get('h')?.toLowerCase().split(':').map(name => name.trim()) ?? [];
    const time = Number(tags?.get('t')), expiry = tags?.has('x') ? Number(tags.get('x')) : null;
    return tags && result.status.result === 'pass' && result.signingDomain === 'gmail.com' && result.algo === 'rsa-sha256' && (result.modulusLength ?? 0) >= 2048
      && result.signatureTimeValid && !result.canonBodyLengthLimited && Number.isSafeInteger(time) && time > 0 && time * 1000 <= now.getTime() + 300000
      && (expiry === null || Number.isSafeInteger(expiry) && expiry * 1000 > now.getTime()) && semantic.every(name => names.includes(name));
  });
  if (!valid) reject();
  // A second parser may confirm addresses, never discover attachments for import.
  const parsed = await simpleParser(Buffer.from(bytes), { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true, maxHtmlLengthToParse: 65536 });
  if (parsed.from?.value.length !== 1 || parsed.from.value[0].address !== sender || parsed.to?.value.length !== 1 || parsed.to.value[0].address !== recipient) reject();
  return { sender, recipient };
}
