# Originaux synthétiques de qualification

Créés pour Hestia le 3 octobre 2026. Aucune photographie, donnée familiale ni fixture téléchargée. Fichiers et générateurs propres au projet sous Apache-2.0.

- `synthetic.pdf` : PDF vectoriel d'une page avec rectangle bleu, généré par `generate.mjs` (structure, table xref et flux explicites).
- `synthetic.png`, `synthetic.jpg`, `synthetic.webp` : rectangle uni 32 × 24 créé avec sharp 0.35.5. `node tests/fixtures/documents/generate.mjs` les régénère.
- `synthetic.heic` : même rectangle créé avec Pillow 11.3.0 et pillow-heif 1.1.1 dans Python 3.12.14, via `generate-heic.py`. Le générateur encode en HEVC ; le validateur utilise un décodeur distinct libheif-js 1.23.2. Déclarer également cet original `image/heif` éprouve l'alias du format.
- `corrupt.pdf`, `corrupt.png` : fichiers volontairement incomplets générés localement. Les tests tronquent également les corps compressés de chaque image valide.
- Le test limite crée en mémoire un PDF valide d'exactement 20 Mio depuis `synthetic.pdf` ; aucun blob de 20 Mio redondant n'est versionné.

Les bibliothèques de génération sont des outils distincts : sharp Apache-2.0, Pillow HPND, pillow-heif BSD-3-Clause et ses bibliothèques natives sous leurs licences. Leurs licences ne transfèrent pas de contenu tiers dans les images constituées ici de couleurs unies.

Sources primaires relues pour les décodeurs et le transport :

- https://sharp.pixelplumbing.com/api-constructor/ — échec strict et pixels bornés, https://sharp.pixelplumbing.com/api-output/ — décodage raw.
- https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html — stopAtErrors, maxImageSize ; https://github.com/mozilla/pdf.js — Apache-2.0. Le commit https://github.com/mozilla/pdf.js/commit/f6bac014ea397bcabee7d42d07fbd9f67c2322c6 supprime le dernier usage d'eval et l'ancienne option isEvalSupported ; aucune couche scripting/viewer n'est chargée par notre validateur.
- https://github.com/catdad-experiments/libheif-js — décodeur, API display et LGPL-3.0. Dépendance distincte remplaçable chargée par Node, sans copie ni modification de ses sources ; sa notice et sa licence restent dans le package installé.
- https://neon.com/docs/storage/s3-compatibility.md — client path-style, Range, absence de garantie WORM/versioning effectif.
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html — réponse Range.

Limites : validation syntaxique/décodage, pas antivirus. Le processus a une durée maximale de 15 secondes, un heap V8 de 256 Mio, des images limitées à 40 millions de pixels au total et une concurrence maximale de deux. Le heap V8 n'est pas une limite RSS du processus : les allocations natives et ArrayBuffer s'ajoutent. Les limites mémoire de l'hôte et la qualification de charge réelle restent à vérifier avant Dev ; aucun PASS local ne vaut qualification du runtime Vercel.
