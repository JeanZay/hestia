# Qualification locale des photos

Ce banc emploie uniquement des documents synthétiques et les vraies API du runtime jetable Hestia. Son exécution appartient au coordinateur du runtime, dans une fenêtre exclusive. Ni une préparation du banc, ni un test unitaire, ni un résultat local ne valent recette Dev, Pixel10 ou Browser Use.

## Corpus figé

`tests/fixtures/mobile-photos/corpus-plan.json` fixe 30 JPEG principaux de 12, 24 et 40 mégapixels, trois petits compléments, les orientations EXIF 1–8, les textes témoins et un QR à contenu connu. Le générateur produit des pages documentaires et une variation déterministe de luminance. Cette variation synthétique rend le poids mesurable ; elle ne représente pas statistiquement des photos de foyer. Le moteur de police dépend du poste. Les octets générés, leurs SHA et l'environnement sont donc archivés et réutilisés tels quels pour les deux applications.

Le corpus qualifié pour les premières mesures est `artifacts/mobile-photos-corpus/main-r2/manifest.json`. Ses 30 fichiers principaux ne doivent plus être régénérés ou sélectionnés après observation des gains. Le premier essai `main-r1` a dépassé la limite d'admission sur le cas 27 ; son échec est conservé. Le plan a été corrigé avant toute mesure du produit. `quick-r1` est un essai du générateur, hors dénominateur.

`archive-r1/manifest.json` conserve 23 originaux valides : cinq JPEG de 91 669 à 16 209 636 octets, leurs PDF raster de 1/10/50 pages et trois PDF vectoriels. Les bandes de volume sont approximatives ; les rapports donnent les octets exacts. Les PDF raster partagent une véritable image entre leurs pages, avec un titre de page distinct. Aucun bourrage n'est présenté comme un gros document. Tous les fichiers restent sous 20 Mio. Le corpus principal est inchangé par ce complément. Le paquet courant `archive-r2/manifest.json` recopie exactement ces23cas et ajoute trois PNG de267416/3467189/3790913octets, avec leurs pixels réels. Ces26cas constituent la sélection figée ; r1 est conservé.

```text
node tests/fixtures/mobile-photos/generate.mjs artifacts/mobile-photos-corpus/main-r2
node tests/fixtures/mobile-photos/generate-archives.mjs artifacts/mobile-photos-corpus/main-r2 artifacts/mobile-photos-corpus/archive-r1
node tests/fixtures/mobile-photos/extend-archives.mjs artifacts/mobile-photos-corpus/main-r2 artifacts/mobile-photos-corpus/archive-r1 artifacts/mobile-photos-corpus/archive-r2
```

Ces commandes refusent une destination existante. Les chemins ci-dessus sont déjà générés : les consommer, sans relancer leur création.

## Mesures et attribution

Le témoin d'octets du test qualité copie uniquement les Blobs d'envoi synthétiques
en mémoire dans la page (limite20Mio), puis les compare à la réservation. La
collecte passive CDP ne fournit pas ces corps Blob et n'est pas utilisée. Cette
copie ne bloque pas `fetch`, mais son coût interdit d'utiliser les temps du test
qualité comme preuve de latence. La campagne5+30 conserve `fetch` natif sans
copie de corps ; elle vérifie les tailles du DTO sauvegardé et de la réservation,
et conserve le SHA déclaré sans prétendre auditer les octets transportés.
Elle mesure séparément `thumbnailReadyMs`, du fichier disponible à la vignette
visible et décodée, après avoir figé le temps de sauvegarde.

Avec les variables du runtime synthétique en mémoire et `HESTIA_PHOTO_PHASE=before` ou `after`, le coordinateur lance :

```text
npx playwright test --config tests/qualification/mobile-photos/playwright.config.ts
```

Les erreurs Playwright API brutes peuvent contenir des en-têtes ; les catches ne les réémettent jamais. Le rapport retient uniquement phase/type bornés et l’exception visible est neuve, à texte fixe, sans cause. Le banc et la répétition refusent DEBUG, PWDEBUG, NODE_DEBUG et NODE_DEBUG_NATIVE ; traces désactivées. Le nettoyage du contexte rollback est également borné.

La configuration sélectionne trois scénarios, un seul worker, aucun retry automatique. Elle est exclue des projets E2E habituels. Le runtime, l'application, la DB/S3, le build réellement lancé et le candidat exact doivent être liés dans une preuve séparée de l'opérateur. Les champs `harnessCandidate` décrivent le checkout du banc uniquement : il peut piloter une application N-1 issue d'une autre archive. Aucune identité du processus serveur n'est déduite de ce checkout. Ses sources doivent rester figées pendant chaque scénario ; une divergence produit `SOURCE_CHANGED` et un échec.

- Qualité : les 30 images principales et les trois compléments passent par le véritable sélecteur caméra. Les octets PUT sont retenus et confrontés à la taille/SHA de réservation. Le PDF final après un recadrage de 5 % en haut est téléchargé par l'API et vérifié par SHA. Les dérivées640/1600 sont conservées après modification du produit. Chaque brouillon propre à ce scénario est abandonné par API après acquisition des témoins, pour ne pas dépasser la limite de brouillons. La médiane de réduction porte exclusivement sur les 30 cas principaux ; aucun fallback n'est retiré. `COMPLETE` constate la fin du protocole, pas un PASS lisibilité ou un gain acquis.
- Nouvelle photo/PDF : 5 passages d'échauffement et 30 mesures sur `main-01`, tous conservés. La sauvegarde part de l'événement natif où le fichier est disponible et finit au message visible après réponse de complétion acceptée. La préparation PDF est mesurée séparément. L'ouverture part du clic du document réellement enregistré et finit à son premier canvas rendu visible. La sélection de destination et la confirmation humaine sont hors de ces deux fenêtres et ne sont pas cachées dans un total inventé.
- Archives : import réel des 26 originaux, SHA/tailles vérifiés, puis 5 ouvertures d'échauffement et 30 mesures par document après fermeture du panneau. Une image doit être décodée ; un PDF doit avoir son premier canvas rendu visible. Le premier chargement figure parmi les échauffements. Les documents synthétiques durables restent dans ce runtime jusqu'au nettoyage normal de son propriétaire.

Les rapports gardent p50/p95/max, tous les échantillons, les cas incomplets et les volumes. Chaque tentative est préinscrite `NOT_RUN`, persistée `RUNNING` avec sa phase avant le geste, puis `PASS` ou `FAIL`. Les échecs conservent un type borné non sensible et les observations partielles ; ils sont distingués des essais non commencés. Les originaux d’archives ont aussi une liste d’étapes de préparation séparée. Le p95 est un indicateur technique, pas une reformulation des objectifs humains de 5 et 3 secondes. L'émulation est Chromium Pixel7, sur boucle locale sans bridage CPU/réseau. Le protocole et les fichiers doivent être identiques avant/après. Le seuil de réduction reste une cible observée, jamais présumée. Une lenteur d'archives résiduelle demeure explicitement ouverte.

Les ResourceTiming rapportent seulement les ressources terminées, dont le début appartient à la fenêtre. Leur durée HTTP inclut réseau, files serveur, DB, stockage et traitement. DB et stockage sont **NON_ISOLÉS**, sans soustraction destinée à fabriquer leur coût. Le temps fichier→réservation comprend conversion, SHA et ordonnancement ; il n'isole pas le worker. La préparation PDF est un total API/affichage ; aucun appel IA n'est utilisé. Une instrumentation serveur de ces sous-étapes serait un complément à préparer/revoir séparément, pas une preuve déjà produite.

## Qualité hors ligne et régression

`quality.py` lit les octets figés, normalise EXIF pour la comparaison, décode le QR à sa valeur exacte avec `zxing-cpp==2.3.0`, puis rasterise les vrais PDF via PDFium. Il lie le résultat conservé au manifeste et aux SHA des images/PDF. Les planches réduites facilitent la comparaison mais ne certifient pas les petits caractères. Un autre agent doit inspecter aussi les témoins pleine résolution, orientations, miroirs et crop ; le champ correspondant reste `NOT_RUN` jusque-là.

Pour chaque image, `*-source-text100-*.png`, `*-retained-text100-*.png` et `*-pdf-text100-*.png` donnent des extraits natifs sans réduction, en tuiles de 850 pixels au maximum. `quality.json` conserve leur boîte exacte, leur taille, leur SHA et, pour le PDF, l'échelle de rasterisation. La zone englobe les quatre lignes SVG de corps12/16/20/24 ; leur taille physique en points dépend du placement dans le PDF et n'est pas annoncée comme6/8pt sans mesure. Le lecteur compare les8EXIF, cas à faible contraste et40MP à100%, avec les fichiers complets pour les repères HAUT/BAS, les miroirs et le recadrage. Aucune modification du corpus n'est permise pour améliorer ces témoins.

```text
python tests/qualification/mobile-photos/quality.py artifacts/mobile-photos-corpus/main-r2/manifest.json --tools artifacts/qualification/mobile-photos/tools/zxing-cpp-2.3.0 --output artifacts/quality/source-r1
python tests/qualification/mobile-photos/quality.py artifacts/mobile-photos-corpus/main-r2/manifest.json --tools artifacts/qualification/mobile-photos/tools/zxing-cpp-2.3.0 --retained artifacts/performance/EXACT-RESULT/result.json --output artifacts/quality/EXACT-RESULT
node --test tests/qualification/mobile-photos/metrics.test.mjs
```

Le Python doit être celui du runtime de qualification avec Pillow/PDFium ; la dépendance QR est locale aux artefacts ignorés, sa version et son empreinte sont conservées, sans modification du lockfile produit. Les quatre unités de métriques vérifient dénominateur fixe, échecs, repli et observations manquantes. Les E2E Capture réguliers vérifient le vrai worker/chunk, la réduction, les variantes et leur purge, ainsi que le fallback natif/import identique. Leur succès doit venir d'un vrai run après build, pas de leurs types.

La répétition N→N-1→N révision5 et ses limites sont décrites dans `rollback.md` : quatre captures synthétiques distinctes, avec ajustement, remplacement, retrait de page et abandon sous N-1. Ses reçus relient tous les IDs/SHA sources nécessaires à l'audit SQL/S3 borné de l'opérateur. Aucun résultat HTTP n'est présenté comme une preuve directe de quota ou de purge physique. Les tests unitaires de cache, du worker et les intégrations serveur couvrent d'autres critères ; ce banc seul ne prétend pas qualifier tout PH1–PH11.
