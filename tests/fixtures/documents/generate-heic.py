"""Synthetic 32x24 solid rectangle; no input photograph or external asset."""
from PIL import Image
from pillow_heif import register_heif_opener
register_heif_opener()
Image.new("RGB", (32, 24), (34, 76, 123)).save("/fixtures/synthetic.heic", quality=80)
