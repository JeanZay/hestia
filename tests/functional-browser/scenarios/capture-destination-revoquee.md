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
    "Le retrait borné du droit Déposer sur la seule fixture et sa conservation finale sont explicitement inclus dans la future sélection autorisée. Aucun rôle modifié ni pouvoir ajouté. Sessions distinctes ; l’UI autorise réellement la modification de partage, sinon bloquer."
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
  "id": "capture-destination-revoquee",
  "title": "Refuser une destination révoquée après sa sélection",
  "objective": "Refuser une destination révoquée après sa sélection",
  "rights": [
    "Auteur dispose initialement de Consulter et Déposer sur Destination ; Gestionnaire possède déjà Partager ou Administrer sur cette seule fixture et peut retirer le droit Déposer de l’Auteur ; Contrôleur peut constater son contenu."
  ],
  "syntheticData": [
    "Import PDF synthétique, Destination isolée vide, dossier témoin indépendant ; aucune donnée d’autrui."
  ],
  "actions": [
    "Comme Auteur, importer le PDF, choisir Destination et ouvrir la vérification avant enregistrement ; ne pas confirmer.",
    "Comme Gestionnaire, retirer seulement Déposer à Auteur sur Destination dans l’UI et constater l’état enregistré.",
    "Comme Auteur, revenir à la confirmation et tenter d’enregistrer avec la commande encore disponible ; si elle a disparu, constater son indisponibilité.",
    "Comme Contrôleur, recharger Destination et vérifier l’absence du titre attendu ; comme Auteur, observer le refus et les possibilités de revenir à un choix autorisé sans finaliser ailleurs."
  ],
  "assertions": [
    "L’ancienne confirmation ne permet pas de déposer après retrait du droit ; refus ou action indisponible visible.",
    "Aucun document n’apparaît dans Destination et aucun nouveau chemin n’est créé.",
    "Aucune information de dossier devenu invisible n’est révélée à Auteur ; aucun pouvoir supplémentaire ne lui est accordé."
  ],
  "persistentEffects": [
    "Droit Déposer retiré uniquement sur Destination synthétique ; aucun document durable attendu ; import transitoire abandonné à la fermeture."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-10T21:25:00.000Z",
    "proposalSha256": "4d85311c547898423f094ec8cffc5747fe79d36cea622eb25286076139940d7f",
    "decisionSha256": "d3ef341d691f643b5a5405284d4542a526dbb9c7924f4648edecc0c0d9ca0e2e",
    "contentSha256": "1264958819e28aea9118490188e0dbee69c52a20b137bd4cb99cff24629dee28",
    "contractSha256": "c5891b9a8ccd9d5056b8a12e01f13a3625ff0ee2ac76ed280d2c4fdd3e7f75aa"
  }
}
```

# Refuser une destination révoquée après sa sélection

Proposition v1 non approuvée, non admise et non exécutée (NOT_RUN).

Critères : RIGHTS, RETRY, DESTINATION.

## Acteurs et droits

- Auteur dispose initialement de Consulter et Déposer sur Destination ; Gestionnaire possède déjà Partager ou Administrer sur cette seule fixture et peut retirer le droit Déposer de l’Auteur ; Contrôleur peut constater son contenu.

## Préconditions et préparation séparée

- Avant toute campagne : déploiement Dev et commit réellement observés, QA technique établie, cette version admise et sélection exacte autorisée. Une proposition ne vaut ni admission ni exécution.
- Comptes synthétiques déjà autorisés et sessions privées disponibles ; fixtures exclusives préfixées BU-CAP-<campagne>-<fiche>, inventaire UI initial et noms attendus consignés sans secrets. Pas de données familiales, création de compte, courriel ou changement de rôle implicite.
- Actions et assertions métier exclusivement dans l’UI avec les API documentées de Browser Use. Aucun SQL, appel API Hestia, état interne ou interception réseau. Les étapes décrivent le comportement validé, sans concevoir une interface.
- Le retrait borné du droit Déposer sur la seule fixture et sa conservation finale sont explicitement inclus dans la future sélection autorisée. Aucun rôle modifié ni pouvoir ajouté. Sessions distinctes ; l’UI autorise réellement la modification de partage, sinon bloquer.

## Données synthétiques

- Import PDF synthétique, Destination isolée vide, dossier témoin indépendant ; aucune donnée d’autrui.

## Actions UI

- Comme Auteur, importer le PDF, choisir Destination et ouvrir la vérification avant enregistrement ; ne pas confirmer.
- Comme Gestionnaire, retirer seulement Déposer à Auteur sur Destination dans l’UI et constater l’état enregistré.
- Comme Auteur, revenir à la confirmation et tenter d’enregistrer avec la commande encore disponible ; si elle a disparu, constater son indisponibilité.
- Comme Contrôleur, recharger Destination et vérifier l’absence du titre attendu ; comme Auteur, observer le refus et les possibilités de revenir à un choix autorisé sans finaliser ailleurs.

## Assertions attendues

- L’ancienne confirmation ne permet pas de déposer après retrait du droit ; refus ou action indisponible visible.
- Aucun document n’apparaît dans Destination et aucun nouveau chemin n’est créé.
- Aucune information de dossier devenu invisible n’est révélée à Auteur ; aucun pouvoir supplémentaire ne lui est accordé.

## Effets persistants

- Droit Déposer retiré uniquement sur Destination synthétique ; aucun document durable attendu ; import transitoire abandonné à la fermeture.

## Remise en état

- Conserver les seules fixtures de cette fiche et leur état final dans le rapport ; aucune purge irréversible ni reset global. Les temporaires suivent le cycle normal du produit ; leur disparition de l’UI ne prouve pas un effacement physique.

## Arrêt

- Prérequis manquant, cible inconnue, outil incapable de réaliser un geste ou donnée non synthétique : bloquer avant ce geste ; ne pas remplacer une assertion par une preuve technique.
- Session invalide, dérive de déploiement, contamination ou mutation incertaine : arrêter la campagne et réconcilier avant toute nouvelle sélection. Ne jamais rejouer aveuglément une finalisation.
- Assertion visible contredite : constater FAIL sans affaiblir la fiche ni réparer le produit dans la tentative. Aucun résultat actuel n’est repris d’un ancien PASS.

## Limites de preuve

- La capacité UI de gérer ce partage doit être vérifiée avant sélection ; aucune préparation API ne remplace l’étape de révocation.
