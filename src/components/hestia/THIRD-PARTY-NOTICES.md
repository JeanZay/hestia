# Sources et licences — interface Hestia Documents

Intégration technique du hand-off Claude Design « Hestia Documents » reçu le 3 octobre 2026 : Clé de voûte 1.0, avec les compléments approuvés de `ds-ext/propositions-1.1.js`. Le prototype brut, son moteur, sa simulation et ses fixtures ne sont pas embarqués.

- `tokens/*.css` : octets repris de `ds/tokens` (colors, typography, spacing, base).
- `design-system.tsx` : adaptation typée de Logo, Icon, Button, TextField/Field, Banner, EmptyState, ScopeBadge, PageHeader, Avatar, Breadcrumb et Skeleton. SVG convertis en éléments JSX statiques ; `useId` remplace le compteur global de Field.
- `documents-app.tsx` et les classes de `globals.css` : compositions Connexion, Dossiers, Dossier et Nouveau dossier de `Hestia Documents.dc.html`, styles de TopBar/SideNav/DocumentRow/DocumentList/FileThumb/CapabilityLine. Les données et écritures sont obtenues du serveur. Les fonctions des étapes suivantes sont indisponibles.
- Logo « L’arche » : géométrie originale fournie dans `ds/components/core/Logo.jsx` et `ds/assets/logo`, provenance déclarée Claude Design dans le hand-off validé.
- Icônes : tracés Lucide repris du hand-off et de son extension (ISC), avec les tracés issus de Feather (MIT). Notices intégrales dans `LUCIDE-LICENSE.txt`, récupérées le 3 octobre 2026 depuis https://github.com/lucide-icons/lucide/blob/main/LICENSE .
- Bricolage Grotesque : Copyright 2022 The Bricolage Grotesque Project Authors, SIL OFL 1.1. Police variable TTF originale, sans modification, issue de https://github.com/google/fonts/tree/main/ofl/bricolagegrotesque . Fichier et licence dans `src/app/fonts/`.
- Atkinson Hyperlegible : Copyright 2020 Braille Institute of America, Inc., SIL OFL 1.1. Polices TTF Regular et Bold originales, sans modification, issues de https://github.com/google/fonts/tree/main/ofl/atkinsonhyperlegible . Fichiers et licence dans `src/app/fonts/`.

Les polices sont servies localement avec `next/font/local` ; aucune requête Google Fonts au chargement de l’application. Les licences tierces restent applicables aux assets et ne sont pas remplacées par Apache-2.0.

