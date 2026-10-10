# Capture : provenance et intégration

Intégration du hand-off Capture v1 validé par Amaury le 10 octobre 2026. Archive source conservée hors Git : `handoff-capture-classification-v1.zip`, SHA-256 `8d954309880cd090780290c8d6b3477ae5bb6ba4e7ffbe3be1e3fa92cbcf82ba`. L’archive brute, ses pages de démonstration et ses scripts ne sont pas distribués.

Références : `Hestia Capture.dc.html`, Design System Clé de voûte 1.0 et extensions 1.1–1.3, accès 1.3.1 ; propositions 1.4 P16 (icônes), P17 (PageTile), P18 (CropStepper). Les attributions figurent dans [THIRD-PARTY-NOTICES](../../THIRD-PARTY-NOTICES.md).

| Source | Intégration |
| --- | --- |
| Photo et liste des brouillons | `capture-workspace.tsx`, navigation dans `documents-app.tsx` et `family-profile.tsx` |
| Pages, vignettes, boutons de recadrage et rotation | `capture-pages.tsx`, `capture.css` ; icônes dans le Design System existant |
| Titre, format, destination et confirmation | `capture-workspace.tsx` ; RadioGroup, PickRow, StepHeader, StatusPill et dialogues existants |
| Réglages IA | `capture-settings.tsx` ; formulaires, sélecteurs et Switch existants |

Les corrections de conformité validées conservent la composition du hand-off : « Parcourir les dossiers » en premier, dossier courant autorisé en deuxième, suggestions existantes puis nouveaux chemins. Le serveur fournit les accès projetés et les pixels déjà orientés/recadrés ; le client ne répète pas le recadrage CSS du prototype. Les réglages sont réservés au Propriétaire et aux Administrateurs actifs, avec un plafond mensuel en euros sur le mois civil UTC.

L’import assisté se trouve dans Photo/Brouillons, y compris sur ordinateur via Moi. « Ajouter un document » conserve l’import multiple historique. L’entrée Photo ne propose aucune galerie ; le sélecteur système de caméra reste soumis aux capacités du navigateur et de l’appareil.

Un catalogue de fournisseurs vide est présenté désactivé. La livraison locale ne qualifie ni tarif réel, ni appel facturable, ni caméra physique. Les preuves détaillées de comparaison, captures synthétiques et essais restent dans le dossier de qualification local ; une capture Playwright ne constitue pas un essai sur appareil.
