import { describe, expect, it } from 'vitest';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { scanMime, selectAttachments, strictBase64 } from '../../src/server/inbox/mime';
import { authenticateGoogle } from '../../src/server/inbox/authentication';
const require = createRequire(import.meta.url);
const { dkimSign } = require('mailauth/lib/dkim/sign') as { dkimSign(bytes: Buffer, options: object): Promise<{ signatures: string }> };
const headers = 'From: sender@gmail.com\r\nTo: technical@gmail.com\r\nSubject: Synthetic\r\nMessage-ID: <synthetic@example.invalid>\r\nDate: Thu, 15 Oct 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=outer';
function part(extra = '', body = 'YWJj', type = 'application/octet-stream') { return `Content-Type: ${type}\r\nContent-Disposition: attachment; filename="synthetic.bin"\r\nContent-Transfer-Encoding: base64${extra}\r\n\r\n${body}`; }
function mail(parts = [part()], outer = headers) { return Buffer.from(`${outer}\r\n\r\n--outer\r\n${parts.join('\r\n--outer\r\n')}\r\n--outer--\r\n`); }
describe('closed Google MIME inventory', () => {
 it('validates a full synthetic20MiB base64 original without recursive regular-expression stack growth', () => {
  const bytes = Buffer.alloc(20 * 1024 * 1024, 171), encoded = bytes.toString('base64'), lines = [];
  for (let offset = 0; offset < encoded.length; offset += 76) lines.push(encoded.slice(offset, offset + 76));
  const decoded = strictBase64(lines.join('\r\n')); expect(decoded.length).toBe(bytes.length); expect(decoded.equals(bytes)).toBe(true);
 });
 it('selects an explicit base64 attachment with an unused Gmail CID and exact bytes', () => { const value = selectAttachments(scanMime(mail([part('\r\nContent-ID: <synthetic-cid>')]))); expect(value.attachments).toHaveLength(1); expect(value.attachments[0].bytes).toEqual(Buffer.from('abc')); });
 it('excludes inline, related resources, referenced CID and Content-Location', () => {
  const inline = part().replace('attachment;', 'inline;'), html = 'Content-Type: text/html\r\n\r\n<img src="cid:used">', cid = part('\r\nContent-ID: <used>');
  const related = 'Content-Type: multipart/related; boundary=resource\r\n\r\n--resource\r\n' + part() + '\r\n--resource--';
  const result = selectAttachments(scanMime(mail([inline, html, cid, related, part('\r\nContent-Location: https://example.invalid/logo')]))); expect(result.attachments).toHaveLength(0); expect(result.excludedInline).toBe(4);
 });
 it.each([
  '<img src="cid:used">',
  'x'.repeat(65537) + '<img src="cid:used">',
  '<img src="cid:&#x75;sed">',
  '<img src="c&#105;d:used">',
  '<img src="c%69d:%75sed">',
  '<img src="c&#9;id:us&#10;ed">',
  '<img src="c%09id:us%0aed">',
  '<style>.signature {background:url(cid:used)}</style>',
  '<style>.signature {background:url(\\63 id:\\75 sed)}</style>',
  '<img srcset="cid:used,cid:other 2x">',
  '<img src=cid:used;>',
 ])('excludes body references across the complete HTML and entity/URI/CSS forms (%#)', html => {
  const value = selectAttachments(scanMime(mail(['Content-Type: text/html; charset=utf-8\r\n\r\n' + html, part('\r\nContent-ID: <used>')]))); expect(value.attachments).toHaveLength(0); expect(value.excludedInline).toBe(1);
 });
 it.each([
  'Content-Type: text/html\r\nContent-Transfer-Encoding: base64\r\n\r\ninvalid!',
  'Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=FF',
  'Content-Type: text/html; charset=unknown-charset\r\n\r\n<img src="cid:used">',
  'Content-Type: text/html\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=ZZ',
  'Content-Type: text/html; charset=utf-16le\r\nContent-Transfer-Encoding: base64\r\n\r\n' + Buffer.from('<img src="cid:used">', 'utf16le').toString('base64'),
  'Content-Type: text/html\r\nContent-Transfer-Encoding: base64\r\n\r\n' + Buffer.from('<img src="cid:used">', 'utf16le').toString('base64'),
  'Content-Type: text/html\r\n\r\n<img src="c%00id:used">',
  'Content-Type: text/html\r\n\r\n' + '<img src="cid:used">'.repeat(513),
 ])('refuses HTML authority that cannot be decoded or completely inventoried (%#)', html => { expect(() => selectAttachments(scanMime(mail([html, part('\r\nContent-ID: <used>')])))).toThrow(); });
 it('keeps a genuine unused-CID20MiB attachment while excluding the used body resource', () => {
  const bytes = Buffer.alloc(20 * 1024 * 1024, 171), encoded = bytes.toString('base64'), lines = [];
  for (let offset = 0; offset < encoded.length; offset += 76) lines.push(encoded.slice(offset, offset + 76));
  const selected = selectAttachments(scanMime(mail(['Content-Type: text/html\r\n\r\n<img src="cid:used">', part('\r\nContent-ID: <used>'), part('\r\nContent-ID: <unused-gmail-real-attachment>', lines.join('\r\n'))])));
  expect(selected.attachments).toHaveLength(1); expect(selected.attachments[0].bytes.length).toBe(bytes.length); expect(selected.attachments[0].bytes.equals(bytes)).toBe(true); expect(selected.excludedInline).toBe(1);
 });
 it.each(['YWJj!', 'YW Jj', 'YQ=', 'YR==', 'YWJj\t', 'YQ==\n'])('rejects permissive base64 ambiguity %j', value => { expect(() => strictBase64(value)).toThrow(); });
 it('refuses QP attachments individually, retaining the stable inventory and safe pieces', () => { const qp = part('', '=61=62=63').replace('base64', 'quoted-printable'); const value = selectAttachments(scanMime(mail([qp, part()]))); expect(value.attachments).toHaveLength(1); expect(value.rejected[0].reason).toBe('attachment_requires_base64'); });
 it.each([
  () => mail([part().replace('Content-Transfer-Encoding: base64', 'Content-Transfer-Encoding: base64\r\nContent-Transfer-Encoding: binary')]),
  () => mail([part().replace('filename="synthetic.bin"', 'filename="synthetic.bin"; filename="other.bin"')]),
  () => mail([part()], headers.replace('boundary=outer', 'boundary="outer "')),
  () => mail([part()], headers.replace('boundary=outer', 'boundary=outer; boundary=other')),
  () => Buffer.from(mail().toString().replace('--outer--', '--outer--x')),
  () => Buffer.from(mail().toString().replace('--outer--\r\n', '--outer--\r\nresidue')),
  () => Buffer.from(mail().toString().replace('--outer\r\n', 'preamble\r\n--outer\r\n')),
  () => mail(['Content-Type: multipart/mixed; boundary=outerChild\r\n\r\n--outerChild\r\n' + part() + '\r\n--outerChild--']),
  () => mail([part()], headers.replace('Subject: Synthetic', 'Subject: Synthetic\r\nSubject: Forged')),
 ])('rejects a structural ambiguity before selecting any attachment', build => { expect(() => scanMime(build())).toThrow(); });
 it('never extracts an archive or nested attached message', () => { const nested = part('', Buffer.from('From: other@example.invalid\r\n\r\nbody').toString('base64'), 'message/rfc822'); const selected = selectAttachments(scanMime(mail([nested]))); expect(selected.attachments[0].mediaType).toBe('message/rfc822'); expect(selected.attachments).toHaveLength(1); });
 it('bounds count, depth and cumulative attachment bytes', () => { const selected = selectAttachments(scanMime(mail(Array.from({ length: 21 }, () => part())))); expect(selected.attachments).toHaveLength(20); expect(selected.rejected[0].reason).toBe('attachment_count'); expect(() => scanMime(mail(Array.from({ length: 201 }, () => part())))).toThrow(); });
 it('authenticates real cryptography over the synthetic MIME and rejects spoofed identity and body changes', async () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = createPrivateKey(pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const key = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
  const now = new Date('2026-10-15T10:00:00Z');
  const signed = await dkimSign(mail(), { headerList: 'From:To:Subject:Message-ID:Date:MIME-Version:Content-Type', signTime: now, canonicalization: 'relaxed/relaxed', signatureData: [{ signingDomain: 'gmail.com', selector: 'synthetic', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) }] });
  const bytes = Buffer.concat([Buffer.from(signed.signatures), mail()]);
  const resolver = async () => [[`v=DKIM1; k=rsa; p=${key}`]];
  await expect(authenticateGoogle(bytes, scanMime(bytes), 'technical@gmail.com', now, resolver)).resolves.toEqual({ sender: 'sender@gmail.com', recipient: 'technical@gmail.com' });
  const changed = Buffer.from(bytes.toString().replace('YWJj', 'eHl6'));
  await expect(authenticateGoogle(changed, scanMime(changed), 'technical@gmail.com', now, resolver)).rejects.toThrow();
  const from = Buffer.from(bytes.toString().replace('sender@gmail.com', 'forged@gmail.com'));
  await expect(authenticateGoogle(from, scanMime(from), 'technical@gmail.com', now, resolver)).rejects.toThrow();
 });
});
