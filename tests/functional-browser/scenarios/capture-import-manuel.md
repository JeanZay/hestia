```json
{
  "schemaVersion": 1,
  "revision": 2,
  "status": "active",
  "theme": "Capture et classement",
  "actor": "Membres synthétiques autorisés, désignés par alias ; aucune création de compte dans la fiche",
  "references": [
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
    "kind": "editorial",
    "actor": "haiku_candidate_review",
    "approvedAt": "2026-10-10T22:50:13.162Z",
    "proposalSha256": "d70a82e518ce1104d00ca31f8dc0fc7bc5f46e535bceb676a66c5488a97102ba",
    "decisionSha256": "4c04fc9257102e29697d6963c1d60602bdec021b2e6e3444603a327bff48f435",
    "contentSha256": "b2f38a553fda6feb72f822858a6cb05ec59ab0b39b6f0cde24f92b3ea564231f",
    "contractSha256": "bd88faa2c01b5bd7a4b2c87e84598339b2d3d782349960d4cb5264bf2599789b"
  }
}
```

# Importer un nouveau fichier intact et le classer malgré une IA indisponible

Fiche admise ; révision éditoriale des références publiques. Aucun parcours exécuté ni résultat antérieur repris (NOT_RUN).

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
