# Correspondance du hand-off « Résumés visibles avant ouverture »

Intégration locale du 18 octobre 2026. La validation d’Amaury et les accords du lot sont conservés dans son dossier de qualification ignoré ; ce document ne les remplace pas. Aucune conception visuelle nouvelle.

## Sources retenues

Le hand-off inspecté provient de `document-summaries-v1-20261018/recovered-text`. Ses mentions « proposé » sont historiques ; la validation exacte du lot est conservée séparément. Le produit réemploie Clé de voûte 1.6 et les extensions 1.7 déjà intégrées, puis porte les composants P28/P29 de 1.8.

L’archive a été reconstruite localement à partir de 159 fichiers antérieurs et de trois textes récupérés dans le DOM ; un téléchargement natif n’est pas confirmé. Les empreintes ci-dessous identifient les sources locales figées effectivement reprises. Elles ne prouvent pas l’identité des octets originaux distants ni leur empreinte.

| Source | SHA-256 |
| --- | --- |
| `Notes - Resumes visibles.md` | `2d31b166c3eb55968ebabfdf4a03a744f5d25d4ff252875e9eb8403c62005913` |
| `Hestia Resumes.dc.html` | `8b8afbf47d0575d157a4b32dd0df31a91de9be056ffc2b9470cd2afa2d2dd6c1` |
| `ds-ext/propositions-1.8.js` | `e650b070abe2febf414dcab72a5bb9278a17f0b11dabd09986219ab2a192de7e` |

## Port et correspondances

| Référence Claude Design | Port technique |
| --- | --- |
| P28 DocumentRowS | `document-summary-row.tsx`, styles `h-summary-*` dans `globals.css` ; titre bouton 16 px gras, résumé 15 px complet, métadonnées 14 px, même ordre mobile/ordinateur |
| P29 SummaryNote | Une mention IA avant les documents du dossier ou de la recherche ; une mention dans À classer qui exclut objet et texte du mail |
| Fiche D / P26 SummaryLine | `document-summary.tsx` et `inbox-design.tsx` ; explications exactes des états, aucune relance ; avertissement sur la version actuelle dans la fiche du document |
| Dossier A / Recherche B | `file-workspace.tsx`, chemin dans les métadonnées de recherche ; recherche limitée aux titres, noms de fichiers et dossiers, explicitement sans les résumés |
| À classer C | `inbox-workspace.tsx` ; même ligne, objet privé distinct, classement possible sans attendre |
| Versions et accès | Le snapshot workspace pilote le résumé de la version courante. Retrait d’accès : contenu retiré et fiche « Document indisponible ». Le résumé d’une ancienne version reste réservé à l’historique existant |

Le port garde le nom serveur `pending` pour l’état Claude `queued` (« Résumé prévu »). `none` reste silencieux dans les lignes et expliqué dans la fiche. Une cause est affichée seulement lorsqu’elle accompagne l’état serveur `unavailable` ; `unknown` reste générique. Aucun état n’est déduit du type de fichier, du temps écoulé ou du commentaire.

Le titre seul nomme le bouton ; `aria-describedby` relie résumé puis métadonnées. Le préfixe « Résumé IA : » est masqué visuellement pour chaque phrase. La ligne entière reste activable au toucher sans bouton imbriqué. Les menus P28 sont optionnels dans la source : aucun menu nouveau n’est créé dans les listes dépourvues de gestionnaires existants ; les actions de fiche et leurs contrôles de capacités sont conservés.

Le conteneur de ligne est inséré dans les listes natives `ul > li` existantes ; leur sémantique fournit `list` et `listitem` sans ajouter un second `role=listitem` imbriqué sur le `div` porté depuis la source.

## Adaptations techniques

La lecture globale workspace visible toutes les 15 secondes actualise aussi les documents anciens non programmés et les accès d’un résumé prêt. Elle évite un appel par ligne ; elle ne remplace pas une lecture en cours, ne déplace pas le focus et ne lance aucune analyse. Les gardes de révision et d’acteur de `WorkspaceReader` sont conservées. Une lecture silencieuse ne remplace pas la liste par un squelette. La fiche consomme ce même snapshot au lieu de publier un polling de résumé indépendant. L’aperçu d’une empreinte précédente n’est jamais affiché sous la nouvelle version.

À classer conserve ses lectures de file et d’analyse ; la lecture de file ne met à jour que le résumé de la pièce ouverte, sans écraser commentaire, destination ou suggestions concurrentes. Les lectures sont suspendues quand l’onglet est masqué. Affichage et actualisation utilisent uniquement GET.

Les dépendances de démonstration (unpkg, Babel, polices distantes) ne sont pas reprises. Les icônes et tokens proviennent du Design System déjà intégré ; le hand-off associe Lucide à sa licence ISC. Aucun original brut n’est publié.

## Vérification et limites

`document-summary-client.test.ts` couvre les états, causes, conservation de 200 caractères Unicode, description accessible et explications de fiche. `document-summaries.spec.ts` prépare les contrôles navigateur mobile/ordinateur : ordre et tailles, texte complet, actualisation sans réouverture/focus, version remplacée, accès retirés, périmètre de recherche et absence de mutation. Les assertions historiques de la file sont adaptées au titre comme seul nom accessible et à « Résumé prévu ».

L’exécution et les résultats du candidat exact sont consignés dans les preuves de livraison. La présence d’un test ne signifie pas qu’il a été exécuté. Le navigateur émulé ne prouve ni une validation sur téléphone physique, ni une recette Dev, ni un GO Production.
