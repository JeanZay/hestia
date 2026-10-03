// Synthetic fixtures, authored for Hestia; no downloaded/user photographs.
import { writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
const directory = new URL("./", import.meta.url);
function pdf(padding = 0) {
  let result = "%PDF-1.7\n";
  const offsets = [0];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>",
    "<< /Length 22 >>\nstream\n0 0 1 rg 0 0 20 20 re f\nendstream",
  ];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(result));
    result += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  if (padding) result += `%${" ".repeat(padding - 2)}\n`;
  const xref = Buffer.byteLength(result);
  result += "xref\n0 5\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) result += `${String(offset).padStart(10, "0")} 00000 n \n`;
  return Buffer.from(`${result}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
// Build a real valid PDF exactly at the size limit without committing a 20 MiB blob.
export function limitPdf(target = 20 * 1024 * 1024) {
  let padding = target - pdf().length;
  for (let attempt = 0; attempt < 4; attempt++) {
    const bytes = pdf(padding);
    if (bytes.length === target) return bytes;
    padding += target - bytes.length;
  }
  throw new Error("could not construct exact PDF limit fixture");
}

// Importing limitPdf is read-only; regeneration is an explicit standalone action.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await mkdir(directory, { recursive: true });
  for (const [name, format] of [["synthetic.png", "png"], ["synthetic.jpg", "jpeg"], ["synthetic.webp", "webp"]]) {
    const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 34, g: 76, b: 123 } } }).toFormat(format).toBuffer();
    await writeFile(new URL(name, directory), bytes);
  }
  await writeFile(new URL("synthetic.pdf", directory), pdf());
  await writeFile(new URL("corrupt.pdf", directory), "%PDF-1.7\n1 0 obj\n<<>>\n%%EOF\n");
  await writeFile(new URL("corrupt.png", directory), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]));
}
