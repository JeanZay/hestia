```json
{
  "schemaVersion": 1,
  "revision": 1,
  "status": "active",
  "theme": "Capture et classement",
  "actor": "Membres synthétiques autorisés, désignés par alias ; aucune création de compte dans la fiche",
  "references": [
    "artifacts/refinement/capture-classification-2026-10-10/execution-ready-v5/refinement.json",
    "docs/adr/0009-capture-classification.md",
    "docs/browser-recipe.md"
  ],
  "preconditions": [
    "Avant toute campagne : déploiement Dev et commit réellement observés, QA technique établie, cette version admise et sélection exacte autorisée. Une proposition ne vaut ni admission ni exécution.",
    "Comptes synthétiques déjà autorisés et sessions privées disponibles ; fixtures exclusives préfixées BU-CAP-<campagne>-<fiche>, inventaire UI initial et noms attendus consignés sans secrets. Pas de données familiales, création de compte, courriel ou changement de rôle implicite.",
    "Actions et assertions métier exclusivement dans l’UI avec les API documentées de Browser Use. Aucun SQL, appel API Hestia, état interne ou interception réseau. Les étapes décrivent le comportement validé, sans concevoir une interface.",
    "Suggestions désactivées faute de fournisseur qualifié ; aucun secret à saisir et aucun appel réel autorisé. Sélecteur de fichiers et téléchargement UI supportés."
  ],
  "cleanup": [
    "Conserver les seules fixtures de cette fiche et leur état final dans le rapport ; aucune purge irréversible ni reset global. Les temporaires suivent le cycle normal du produit ; leur disparition de l’UI ne prouve pas un effacement physique."
  ],
  "stopConditions": [
    "Prérequis manquant, cible inconnue, outil incapable de réaliser un geste ou donnée non synthétique : bloquer avant ce geste ; ne pas remplacer une assertion par une preuve technique.",
    "Session invalide, dérive de déploiement, contamination ou mutation incertaine : arrêter la campagne et réconcilier avant toute nouvelle sélection. Ne jamais rejouer aveuglément une finalisation.",
    "Assertion visible contredite : constater FAIL sans affaiblir la fiche ni réparer le produit dans la tentative. Aucun résultat actuel n’est repris d’un ancien PASS."
  ],
  "dependencies": [],
  "id": "capture-import-manuel",
  "title": "Importer un nouveau fichier intact et le classer malgré une IA indisponible",
  "objective": "Importer un nouveau fichier intact et le classer malgré une IA indisponible",
  "rights": [
    "Auteur possède Consulter, Déposer et Exporter dans le dossier dédié ; aucun pouvoir Partager ni Administrer sur ce dossier."
  ],
  "syntheticData": [
    "tests/fixtures/documents/synthetic.pdf, titre unique et dossier de dépôt isolé ; empreinte locale originale calculée avant sélection."
  ],
  "actions": [
    "Ouvrir Brouillons puis Importer un fichier ; sélectionner le PDF synthétique, saisir le titre et ouvrir le choix de rangement.",
    "Observer Parcourir les dossiers avant les suggestions et l’éventuel dossier courant autorisé. Demander explicitement des suggestions pour ce seul nouvel import.",
    "Constater l’indisponibilité, poursuivre manuellement, sélectionner le dossier, vérifier les accès affichés puis confirmer une seule fois.",
    "Ouvrir le document créé, observer l’aperçu, télécharger l’original via l’UI puis recharger et rouvrir le document. Comparer localement l’empreinte du fichier réellement téléchargé à l’original synthétique."
  ],
  "assertions": [
    "L’indisponibilité IA est affichée sans fausse suggestion ni classement automatique ; le choix manuel reste possible.",
    "L’acteur voit ses capacités et une information neutre sur les accès, sans liste de personnes qu’il ne peut administrer.",
    "Un seul document est présent au bon endroit ; aperçu visible aux deux ouvertures et octets téléchargés identiques au PDF initial.",
    "L’import ne figure pas comme brouillon caméra récupérable sept jours."
  ],
  "persistentEffects": [
    "Un original PDF et ses métadonnées durables ; copie transitoire d’import traitée par le cycle normal du produit."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-10T21:25:00.000Z",
    "proposalSha256": "e6007b7783dc14f182d97b017e1509f1a26d867caec75af67bc46d47c3f7cac9",
    "decisionSha256": "35ced10bf8d4d762a1ea87f54d5dc93b81321368665ddb3f1373c169cb9e43fd",
    "contentSha256": "4dff8fc7eb3667ed1f7889c0e41e1f9f5c3e4e16f59eba93f8e0ec69d47f3248",
    "contractSha256": "940766374c90a7e0f385f32694921987259863420eb6d802d6da5a1bd1bd4310"
  }
}
```

# Importer un nouveau fichier intact et le classer malgré une IA indisponible

Proposition v1 non approuvée, non admise et non exécutée (NOT_RUN).

Critères : IMMUTABLE, ANALYZE, DESTINATION, RIGHTS.

## Acteurs et droits

- Auteur possède Consulter, Déposer et Exporter dans le dossier dédié ; aucun pouvoir Partager ni Administrer sur ce dossier.

## Préconditions et préparation séparée

- Avant toute campagne : déploiement Dev et commit réellement observés, QA technique établie, cette version admise et sélection exacte autorisée. Une proposition ne vaut ni admission ni exécution.
- Comptes synthétiques déjà autorisés et sessions privées disponibles ; fixtures exclusives préfixées BU-CAP-<campagne>-<fiche>, inventaire UI initial et noms attendus consignés sans secrets. Pas de données familiales, création de compte, courriel ou changement de rôle implicite.
- Actions et assertions métier exclusivement dans l’UI avec les API documentées de Browser Use. Aucun SQL, appel API Hestia, état interne ou interception réseau. Les étapes décrivent le comportement validé, sans concevoir une interface.
- Suggestions désactivées faute de fournisseur qualifié ; aucun secret à saisir et aucun appel réel autorisé. Sélecteur de fichiers et téléchargement UI supportés.

## Données synthétiques

- tests/fixtures/documents/synthetic.pdf, titre unique et dossier de dépôt isolé ; empreinte locale originale calculée avant sélection.

## Actions UI

- Ouvrir Brouillons puis Importer un fichier ; sélectionner le PDF synthétique, saisir le titre et ouvrir le choix de rangement.
- Observer Parcourir les dossiers avant les suggestions et l’éventuel dossier courant autorisé. Demander explicitement des suggestions pour ce seul nouvel import.
- Constater l’indisponibilité, poursuivre manuellement, sélectionner le dossier, vérifier les accès affichés puis confirmer une seule fois.
- Ouvrir le document créé, observer l’aperçu, télécharger l’original via l’UI puis recharger et rouvrir le document. Comparer localement l’empreinte du fichier réellement téléchargé à l’original synthétique.

## Assertions attendues

- L’indisponibilité IA est affichée sans fausse suggestion ni classement automatique ; le choix manuel reste possible.
- L’acteur voit ses capacités et une information neutre sur les accès, sans liste de personnes qu’il ne peut administrer.
- Un seul document est présent au bon endroit ; aperçu visible aux deux ouvertures et octets téléchargés identiques au PDF initial.
- L’import ne figure pas comme brouillon caméra récupérable sept jours.

## Effets persistants

- Un original PDF et ses métadonnées durables ; copie transitoire d’import traitée par le cycle normal du produit.

## Remise en état

- Conserver les seules fixtures de cette fiche et leur état final dans le rapport ; aucune purge irréversible ni reset global. Les temporaires suivent le cycle normal du produit ; leur disparition de l’UI ne prouve pas un effacement physique.

## Arrêt

- Prérequis manquant, cible inconnue, outil incapable de réaliser un geste ou donnée non synthétique : bloquer avant ce geste ; ne pas remplacer une assertion par une preuve technique.
- Session invalide, dérive de déploiement, contamination ou mutation incertaine : arrêter la campagne et réconcilier avant toute nouvelle sélection. Ne jamais rejouer aveuglément une finalisation.
- Assertion visible contredite : constater FAIL sans affaiblir la fiche ni réparer le produit dans la tentative. Aucun résultat actuel n’est repris d’un ancien PASS.

## Limites de preuve

- La comparaison du fichier téléchargé est une preuve complémentaire déclarée ; aucun comptage réseau ou inspection de payload pendant Browser Use.
