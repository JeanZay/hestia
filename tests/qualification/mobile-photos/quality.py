"""Bounded offline QR/PDF witnesses for the synthetic corpus. Never opens services."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from PIL import Image, ImageOps
import pypdfium2 as pdfium

Image.MAX_IMAGE_PIXELS = 40_000_000
parser = argparse.ArgumentParser()
parser.add_argument("manifest")
parser.add_argument("--tools", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--retained")
args = parser.parse_args()
artifact_root = (Path.cwd() / "artifacts").resolve()


def owned(value):
    target = Path(value).resolve()
    if artifact_root not in target.parents:
        raise ValueError("Only owned local artifacts are accepted")
    return target


source_manifest = owned(args.manifest)
tools = owned(args.tools)
sys.path.insert(0, str(tools))
import zxingcpp  # noqa: E402 - optional pinned qualification-only tool

output = owned(args.output)
output.mkdir(parents=True, exist_ok=False)
manifest = json.loads(source_manifest.read_text(encoding="utf-8"))
retained_path = owned(args.retained) if args.retained else None
retained = json.loads(retained_path.read_text(encoding="utf-8")) if retained_path else None
if retained and (retained.get("status") != "COMPLETE" or retained.get("corpusSha256") != hashlib.sha256(source_manifest.read_bytes()).hexdigest()):
    raise ValueError("Complete retained results bound to the exact corpus are required")
results = []


def read_image(file, expected_hash=None):
    data = file.read_bytes()
    if expected_hash and hashlib.sha256(data).hexdigest() != expected_hash:
        raise ValueError("Synthetic input hash changed")
    if len(data) > 20 * 1024 * 1024:
        raise ValueError("Input exceeds20MiB")
    with Image.open(file) as image:
        if image.width * image.height > 40_000_000 or getattr(image, "n_frames", 1) != 1:
            raise ValueError("Non-single bounded image")
        image.load()
        return ImageOps.exif_transpose(image).convert("RGB")


def qr_matches(image, expected):
    codes = zxingcpp.read_barcodes(image)
    return any(code.text == expected and code.valid for code in codes)


def native_text_tiles(image, case_id, stage):
    # Native pixel crops, with no resampling. Four SVG text sizes12/16/20/24
    # are visible together. PDF uses a broader region to include page margins.
    left, right = round(image.width*.075), round(image.width*.92)
    top = round(image.height*(.12 if stage == "pdf" else 210/1400))
    bottom = round(image.height*(.34 if stage == "pdf" else 335/1400))
    rows = []
    for index, x in enumerate(range(left, right, 850)):
        box = (x, top, min(x+850, right), bottom)
        tile = image.crop(box)
        file = f"{case_id}-{stage}-text100-{index+1}.png"
        tile.save(output / file)
        rows.append({"file":file, "stage":stage, "sourceBoxPixels":list(box),
                     "dimensions":list(tile.size), "scale":1,
                     "sha256":hashlib.sha256((output / file).read_bytes()).hexdigest()})
    return rows


for case in manifest["cases"]:
    if case["group"] not in ["main", "complement"]:
        continue
    source_file = owned(source_manifest.parent / case["file"])
    source = read_image(source_file, case["sha256"])
    result = {"id": case["id"], "sourceSha256": case["sha256"], "sourceQrExact": qr_matches(source, case["qrPayload"]), "sourceDisplayDimensions": list(source.size)}
    result["nativeTextTiles"] = native_text_tiles(source, case["id"], "source")
    panels = [source.copy()]
    if retained:
        found = [row for row in retained["cases"] if row["id"] == case["id"]]
        if len(found) != 1:
            raise ValueError("Every planned image requires exactly one retained witness")
        row = found[0]
        converted = read_image(owned(Path(args.retained).resolve().parent / row["file"]), row["sha256"])
        result["retainedQrExact"] = qr_matches(converted, case["qrPayload"])
        result["retainedDimensions"] = list(converted.size)
        result["ratioPreserved"] = abs(converted.width/converted.height-source.width/source.height) < .002
        result["nativeTextTiles"] += native_text_tiles(converted, case["id"], "retained")
        panels.append(converted)
        if row.get("pdf"):
            pdf_file = owned(Path(args.retained).resolve().parent / row["pdf"])
            if pdf_file.stat().st_size > 20*1024*1024:
                raise ValueError("PDF exceeds admission")
            if hashlib.sha256(pdf_file.read_bytes()).hexdigest() != row.get("pdfSha256"):
                raise ValueError("Final PDF witness hash changed")
            doc = pdfium.PdfDocument(str(pdf_file))
            if len(doc) != 1:
                raise ValueError("Final single-page witness changed cardinality")
            page = doc[0]
            scale = min(3, math.sqrt(16_000_000/(page.get_width()*page.get_height())))
            bitmap = page.render(scale=scale)
            rendered = bitmap.to_pil().convert("RGB")
            result["croppedPdfQrExact"] = qr_matches(rendered, case["qrPayload"])
            result["pdfPageCount"] = len(doc)
            result["pdfRasterScale"] = scale
            result["nativeTextTiles"] += native_text_tiles(rendered, case["id"], "pdf")
            panels.append(rendered.copy())
            rendered.save(output / (case["id"] + "-pdf.png"))
            bitmap.close(); page.close(); doc.close()
    # Full-resolution witnesses remain in their immutable packet. These small
    # paired views aid the independent reader, not automated OCR certification.
    thumbs = []
    for panel in panels:
        panel.thumbnail((700, 1000))
        thumbs.append(panel)
    sheet = Image.new("RGB", (sum(p.width for p in thumbs), max(p.height for p in thumbs)), "white")
    x = 0
    for panel in thumbs:
        sheet.paste(panel, (x, 0)); x += panel.width
    sheet.save(output / (case["id"] + "-comparison.png"))
    results.append(result)

required = [key for row in results for key, value in row.items() if key.endswith("QrExact") and not value]
report = {"kind":"synthetic-offline-quality-witnesses", "sourceOnly":retained is None, "retainedReportSha256":hashlib.sha256(retained_path.read_bytes()).hexdigest() if retained_path else None, "sourceManifestSha256":hashlib.sha256(source_manifest.read_bytes()).hexdigest(), "qrStatus":"PASS" if results and not required else "FAIL", "cases":results,
          "smallCharactersIndependentReview":"NOT_RUN", "limits":["QR is decoded locally to the exact fixed payload; no heuristic image equality substitutes it.", "Comparison sheets and actual PDFs require independent readability/orientation/crop inspection.", "Source-only PASS does not qualify optimized bytes or application performance."]}
(output / "quality.json").write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
print(json.dumps({"cases":len(results),"qrStatus":report["qrStatus"],"sourceOnly":report["sourceOnly"],"report":str(output / "quality.json")}))
sys.exit(0 if report["qrStatus"] == "PASS" else 1)
