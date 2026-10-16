import { createHash } from 'node:crypto';
import { decodeHTML } from 'entities';

export const MAX_RAW = 32 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20 * 1024 * 1024;
export class MimeRejection extends Error { constructor(readonly reason: string) { super(reason); } }
function fail(reason = 'ambiguous_mime'): never { throw new MimeRejection(reason); }
export type MimePart = { position: string; headers: Map<string, string>; type: string; disposition: string; parameters: Map<string, string>; body: string; related: boolean };
export type MimeInventory = { headers: Map<string, string>; headerRows: { name: string; value: string }[]; parts: MimePart[] };
const repeatable = /^(received|dkim-signature|arc-seal|arc-message-signature|arc-authentication-results|x-[a-z0-9-]+)$/;
export function parseHeaders(text: string, top = false) {
  if (Buffer.byteLength(text) > 65536 || !text || /\r(?!\n)|(?<!\r)\n/.test(text)) fail();
  const rows: { name: string; value: string }[] = [];
  for (const line of text.split('\r\n')) {
    if (/^[ \t]/.test(line)) { if (!rows.length) fail(); rows[rows.length - 1].value += ' ' + line.trim(); continue; }
    const match = /^([A-Za-z0-9!#$%&'*+.^_`|~-]+):[ \t]*(.*)$/.exec(line);
    if (!match || rows.length >= 200) fail(); rows.push({ name: match[1].toLowerCase(), value: match[2] });
  }
  const headers = new Map<string, string>();
  for (const row of rows) { if (headers.has(row.name) && (!top || !repeatable.test(row.name))) fail('duplicate_header'); headers.set(row.name, row.value); }
  return { headers, rows };
}
const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
function structured(value: string, fallback: string) {
  if (!value) return { value: fallback, parameters: new Map<string, string>() };
  // Quoted strings are parsed explicitly; semicolons inside a quoted filename are legal.
  const pieces: string[] = []; let current = '', quote = false, escape = false;
  for (const char of value) { if (escape) { current += char; escape = false; continue; } if (quote && char === '\\') { current += char; escape = true; continue; } if (char === '"') quote = !quote; if (char === ';' && !quote) { pieces.push(current.trim()); current = ''; } else current += char; }
  if (quote || escape) fail(); pieces.push(current.trim()); const main = pieces.shift()!.toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+(?:\/[a-z0-9!#$&^_.+-]+)?$/.test(main)) fail();
  const parameters = new Map<string, string>();
  for (const item of pieces) {
    const match = /^([^=\s]+)=(.*)$/.exec(item); if (!match || !token.test(match[1])) fail();
    const name = match[1].toLowerCase(); if (parameters.has(name) || /\*\d/.test(name)) fail('duplicate_parameter');
    let content = match[2]; if (/^"(?:[^"\\]|\\[\x20-\x7e])*"$/.test(content)) content = content.slice(1, -1).replace(/\\(.)/g, '$1'); else if (!token.test(content)) fail();
    parameters.set(name, content);
  }
  for (const name of parameters.keys()) if (name.endsWith('*') && parameters.has(name.slice(0, -1))) fail('ambiguous_parameter');
  return { value: main, parameters };
}
export function strictBase64(body: string): Buffer {
  let length = 0, lineLength = 0, padding = 0;
  // Repeated-group regular expressions overflow V8's stack on a qualified20MiB original.
  // One bounded linear pass validates the alphabet, CRLF, line width and terminal padding.
  for (let index = 0; index < body.length; index++) {
    const code = body.charCodeAt(index);
    if (code === 13) { if (body.charCodeAt(++index) !== 10) fail('invalid_base64'); lineLength = 0; continue; }
    if (++lineLength > 998) fail('invalid_base64');
    if (code === 61) { if (++padding > 2) fail('invalid_base64'); }
    else if (padding || !(code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 43 || code === 47)) fail('invalid_base64');
    length++;
  }
  if (!length || length % 4) fail('invalid_base64');
  const value = body.replace(/\r\n/g, '');
  const decoded = Buffer.from(value, 'base64'); if (decoded.toString('base64') !== value) fail('invalid_base64'); return decoded;
}
export function scanMime(bytes: Uint8Array): MimeInventory {
  if (!bytes.byteLength || bytes.byteLength > MAX_RAW) fail('raw_too_large');
  for (const byte of bytes) if (byte > 126 || byte < 32 && ![9, 10, 13].includes(byte)) fail('unsupported_raw_encoding');
  const raw = Buffer.from(bytes).toString('ascii'); if (/\r(?!\n)|(?<!\r)\n/.test(raw)) fail();
  let count = 0; const boundaries: string[] = [], parts: MimePart[] = [];
  const first = raw.indexOf('\r\n\r\n'); if (first < 0) fail();
  const top = parseHeaders(raw.slice(0, first), true);
  function visit(text: string, position: string, depth: number, related: boolean, root = false) {
    if (++count > 200 || depth > 20) fail('mime_limit'); const offset = text.indexOf('\r\n\r\n'); if (offset < 0) fail();
    const headers = root ? top.headers : parseHeaders(text.slice(0, offset)).headers, body = text.slice(offset + 4);
    const type = structured(headers.get('content-type') ?? '', 'text/plain'), disposition = structured(headers.get('content-disposition') ?? '', '');
    for (const name of ['boundary', 'name', 'filename']) if (type.parameters.has(name) && disposition.parameters.has(name)) fail();
    const cte = headers.get('content-transfer-encoding')?.toLowerCase() ?? '7bit'; if (!/^(7bit|8bit|binary|base64|quoted-printable)$/.test(cte)) fail();
    if (type.value.startsWith('multipart/')) {
      if (disposition.value || !['7bit', '8bit', 'binary'].includes(cte)) fail();
      const boundary = type.parameters.get('boundary');
      if (!boundary || boundary.length > 70 || !token.test(boundary) || boundaries.some(other => other.includes(boundary) || boundary.includes(other))) fail('ambiguous_boundary');
      boundaries.push(boundary); const lines = body.split('\r\n'); let active: string[] | null = null, closed = false, children = 0;
      for (const line of lines) {
        if (line === `--${boundary}` || line === `--${boundary}--`) {
          if (closed) fail();
          if (active) { visit(active.join('\r\n'), `${position}.${children++}`, depth + 1, related || type.value === 'multipart/related'); active = null; }
          if (line.endsWith('--')) { closed = true; } else active = [];
        } else {
          if (line.startsWith(`--${boundary}`)) fail('ambiguous_boundary');
          if (active) active.push(line); else if (line.trim()) fail('mime_residue');
        }
      }
      if (!closed || !children || active) fail('unclosed_multipart'); return;
    }
    if (type.parameters.has('boundary')) fail();
    const parameters = new Map([...type.parameters, ...disposition.parameters]);
    parts.push({ position, headers, type: type.value, disposition: disposition.value, parameters, body, related });
  }
  visit(raw, '0', 0, false, true); return { headers: top.headers, headerRows: top.rows, parts };
}
export function safeFileName(value: string, position: string) {
  let decoded = value;
  if (/^UTF-8''/i.test(value)) { try { decoded = decodeURIComponent(value.slice(7)); } catch { fail('invalid_filename'); } }
  // Encoded words and RFC2231 filenames are presentation only, never paths.
  decoded = decoded.replace(/=\?utf-8\?b\?([A-Za-z0-9+/=]+)\?=/gi, (_all, part) => Buffer.from(part, 'base64').toString('utf8'));
  return decoded.normalize('NFC').replace(/[\x00-\x1f\x7f\\/<>:"|?*]/g, '_').slice(0, 200).trim() || `piece-${position}`;
}
function contextText(part: MimePart) {
  let bytes: Buffer;
  try { bytes = part.headers.get('content-transfer-encoding')?.toLowerCase() === 'base64' ? strictBase64(part.body) : Buffer.from(part.body.replace(/=\r\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_all, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1'); } catch { return ''; }
  return bytes.subarray(0, 65536).toString('utf8');
}
function htmlBody(part: MimePart) {
 const encoding = part.headers.get('content-transfer-encoding')?.toLowerCase() ?? '7bit'; let bytes: Buffer;
 if (encoding === 'base64') bytes = strictBase64(part.body);
 else if (encoding === 'quoted-printable') {
  const output = Buffer.allocUnsafe(part.body.length); let offset = 0;
  for (let index = 0; index < part.body.length; index++) {
   const code = part.body.charCodeAt(index);
   if (code !== 61) { output[offset++] = code; continue; }
   if (part.body[index + 1] === '\r' && part.body[index + 2] === '\n') { index += 2; continue; }
   const pair = part.body.slice(index + 1, index + 3); if (!/^[0-9a-f]{2}$/i.test(pair)) fail('invalid_html_encoding'); output[offset++] = parseInt(pair, 16); index += 2;
  }
  bytes = output.subarray(0, offset);
 } else if (['7bit', '8bit', 'binary'].includes(encoding)) bytes = Buffer.from(part.body, 'ascii');
 else fail('invalid_html_encoding');
 if (bytes.length > MAX_RAW) fail('html_reference_limit');
 const charset = (part.parameters.get('charset') ?? 'utf-8').toLowerCase();
 if (!['utf-8', 'utf8', 'us-ascii', 'ascii'].includes(charset)) fail('unsupported_html_charset');
 if (['ascii', 'us-ascii'].includes(charset) && bytes.some(byte => byte > 127)) fail('invalid_html_encoding');
 try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)) fail('invalid_html_encoding'); return { text, bytes: bytes.length }; }
 catch { return fail('invalid_html_encoding'); }
}
function cssEscapes(text: string) {
 return text.replace(/\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\r\n\f])?|\r\n|[\r\n\f]|([^\r\n\f]))/gi, (_all, hex: string | undefined, literal: string | undefined) => {
  if (!hex) return literal ?? ''; const point = parseInt(hex, 16); if (!point || point > 0x10ffff || point >= 0xd800 && point <= 0xdfff) fail('invalid_html_encoding'); return String.fromCodePoint(point);
 });
}
function normalizedReferences(text: string) {
 for (let round = 0; round < 4; round++) {
  const normalized = cssEscapes(decodeHTML(text)).replace(/%[0-9a-f]{2}/gi, value => String.fromCharCode(parseInt(value.slice(1), 16)));
  if (normalized === text) return normalized; text = normalized;
 }
 // More nested encodings have competing interpretations; never treat them as an unused CID.
 if (cssEscapes(decodeHTML(text)).replace(/%[0-9a-f]{2}/gi, value => String.fromCharCode(parseInt(value.slice(1), 16))) !== text) fail('html_reference_ambiguity');
 return text;
}
function usedContentIds(inventory: MimeInventory) {
 const used = new Set<string>(); let references = 0, bytes = 0;
 for (const part of inventory.parts) {
  if (part.type !== 'text/html' || part.disposition === 'attachment') continue;
  const decoded = htmlBody(part); if ((bytes += decoded.bytes) > MAX_RAW) fail('html_reference_limit');
  // URL parsers discard ASCII tab/newline characters, including their entity/URI forms.
  const html = normalizedReferences(decoded.text).replace(/[\t\r\n]/g, ''), pattern = /cid:([^\s"'<>(),;]+)/gi; let match: RegExpExecArray | null;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(html)) fail('invalid_html_encoding');
  while ((match = pattern.exec(html))) { if (++references > 512) fail('html_reference_limit'); const id = match[1]; if (/%(?![0-9a-f]{2})/i.test(id) || /[^\x21-\x7e]/.test(id)) fail('invalid_html_encoding'); used.add(id.toLowerCase()); }
 }
 return used;
}
export function selectAttachments(inventory: MimeInventory) {
  const usedCids = usedContentIds(inventory);
  const attachments: { position: string; fileName: string; mediaType: string; bytes: Buffer; sha256: string }[] = [], rejected: { fileName: string; reason: string }[] = [];
  let excludedInline = 0, candidateCount = 0, total = 0;
  for (const part of inventory.parts) {
    const contentId = part.headers.get('content-id');
    if (contentId && !/^<[^\s<>"'(),;\\]+>$/.test(contentId)) fail('ambiguous_content_id');
    const cid = contentId?.slice(1, -1).toLowerCase();
    if (part.related || part.disposition === 'inline' || part.headers.has('content-location') || cid && usedCids.has(cid)) { excludedInline++; continue; }
    if (part.disposition !== 'attachment') continue;
    const fileName = safeFileName(part.parameters.get('filename*') ?? part.parameters.get('filename') ?? part.parameters.get('name') ?? '', part.position); candidateCount++;
    try {
      if (candidateCount > 20) fail('attachment_count');
      if (part.headers.get('content-transfer-encoding')?.toLowerCase() !== 'base64') fail('attachment_requires_base64');
      const bytes = strictBase64(part.body); if (bytes.length > MAX_ATTACHMENTS || total + bytes.length > MAX_ATTACHMENTS) fail('attachment_bytes');
      total += bytes.length; attachments.push({ position: part.position, fileName, mediaType: part.type, bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
    } catch (error) { if (!(error instanceof MimeRejection)) throw error; rejected.push({ fileName, reason: error.reason }); }
  }
  const context = inventory.parts.filter(part => part.type === 'text/plain' && !part.disposition && !part.related).map(contextText).join('\n');
  return { attachments, rejected, excludedInline, context: context.slice(0, 8000), contextPartial: context.length > 8000 };
}
