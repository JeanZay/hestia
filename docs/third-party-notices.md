# Dépendances et notices tierces

État du verrou npm examiné le 12 septembre 2026. La licence Apache-2.0 de Hestia couvre ses éléments originaux ; elle ne remplace pas celles des composants tiers téléchargés lors de l'installation.

La publication initiale contient les sources Hestia et [package-lock.json](../package-lock.json). Elle ne contient ni `node_modules`, ni navigateurs Playwright, ni bibliothèques natives, ni image Docker préconstruite. Construire une image localement ne publie pas cette image.

## Repères dans le verrou

Cette sélection signale des licences distinctes à prendre en compte. Les entrées du verrou, les fichiers `LICENSE`/`NOTICE` des paquets effectivement installés et leur provenance doivent être relus pour toute redistribution ; cette table n'est pas un inventaire complet des fichiers d'un futur binaire.

| Composant verrouillé | Version | Licence déclarée dans le verrou |
| --- | --- | --- |
| Next.js, React et React DOM | 16.3.5 ; 19.3.0 | MIT |
| `@img/sharp-libvips-*` | 1.3.3 | LGPL-3.0-or-later |
| `@img/sharp-win32-*` | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later |
| `@img/sharp-wasm32` | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later AND MIT |
| `caniuse-lite` | 1.0.30001810 | CC-BY-4.0 |
| `axe-core` | 4.13.0 | MPL-2.0 |
| `lightningcss` et ses paquets de plateforme | 1.33.0 | MPL-2.0 |
| `argparse` | 2.0.1 | Python-2.0 |

Les paquets natifs sélectionnés dépendent de la plateforme. Leurs fichiers et notices peuvent couvrir d'autres bibliothèques embarquées ; la déclaration du verrou ne suffit pas à les inventorier. Sharp documente les modalités de ses installations et binaires dans sa [documentation officielle](https://sharp.pixelplumbing.com/install/).

## Avant de publier un artefact contenant des dépendances

Pour chaque image Docker, paquet ou archive réellement destiné à être redistribué :

1. Inventorier les composants et fichiers du résultat final, y compris les bibliothèques natives, le système de base et les données embarquées.
2. Conserver les licences, attributions et notices requises par ces composants, avec leurs versions et origines vérifiées.
3. Vérifier les obligations propres à la redistribution envisagée, notamment celles des composants LGPL, MPL et CC-BY, et les satisfaire avant diffusion.
4. Faire relire cet inventaire et les pièces jointes avec le candidat exact de la distribution.

Aucun composant tiers n'est présenté comme distribué exclusivement sous Apache-2.0. La qualification d'une future distribution binaire reste à réaliser dans son lot de livraison ; aucune release binaire n'est incluse dans la publication initiale des sources.
