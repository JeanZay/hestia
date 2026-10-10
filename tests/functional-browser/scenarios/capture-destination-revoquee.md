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
    "kind": "editorial",
    "actor": "haiku_candidate_review",
    "approvedAt": "2026-10-10T22:50:12.941Z",
    "proposalSha256": "68a13516e6b670086061efdbc34edfb9436c02f1cbe475e630c426ee5eeeb80d",
    "decisionSha256": "4197c3df8b7fa64dbb512d285786a5235945acf90a3a88d7696827839ea22336",
    "contentSha256": "6b096bc546d280dbd6ae7e73ad9612e9fe06fcaafdd12237c493dd05ca80a0e3",
    "contractSha256": "f2d1d3fbf894537f6ddfbe2c8bc512608988ec61e6bc95bd50b3538da631a395"
  }
}
```

# Refuser une destination révoquée après sa sélection

Fiche admise ; révision éditoriale des références publiques. Aucun parcours exécuté ni résultat antérieur repris (NOT_RUN).

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
