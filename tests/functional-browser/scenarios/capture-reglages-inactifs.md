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
    "La cible Dev a explicitement les fournisseurs réels désactivés ; aucune configuration secrète n’est lue ou saisie. L’absence de fournisseur qualifié est une précondition, pas un succès d’analyse."
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
  "id": "capture-reglages-inactifs",
  "title": "Observer les réglages IA inactifs et la séparation des pouvoirs",
  "objective": "Observer les réglages IA inactifs et la séparation des pouvoirs",
  "rights": [
    "Propriétaire, Administrateur actif et Membre simple synthétiques avec rôles préexistants ; chacun conserve seulement ses droits documentaires habituels."
  ],
  "syntheticData": [
    "Configuration IA sans fournisseur qualifié ni clé ; dossier privé Membre inaccessible aux deux autres acteurs, avec document synthétique témoin."
  ],
  "actions": [
    "Comme Propriétaire puis Administrateur, ouvrir les réglages Suggestions de rangement depuis Moi ; observer le plafond mensuel et l’état de fournisseur indisponible, puis sortir sans saisir de clé.",
    "Comme Membre simple, examiner les commandes proposées dans Moi sans manipuler d’URL ni utiliser une API.",
    "Comme Propriétaire puis Administrateur, consulter leurs dossiers et brouillons visibles ; comme Membre, vérifier son document témoin privé."
  ],
  "assertions": [
    "Propriétaire et Administrateur ont accès aux réglages ; fournisseur/modèle non qualifiés empêchent l’activation et aucune analyse réussie n’est annoncée.",
    "Le plafond est explicitement mensuel et configurable dans le parcours prévu ; son absence ne peut pas être remplacée par un montant supposé.",
    "Membre simple ne dispose pas de la gestion IA ; les acteurs de gestion ne découvrent ni le dossier privé Membre ni ses brouillons.",
    "Aucune valeur de clé enregistrée n’est présentée par la vue ; cette inspection ne démontre pas à elle seule le chiffrement serveur."
  ],
  "persistentEffects": [
    "Aucune modification de configuration, aucun appel fournisseur ni coût demandé par cette fiche."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-10T21:25:00.000Z",
    "proposalSha256": "fb481ee495b00e8bf0eac2f51692463451bac31e2387a81983152318d47fa849",
    "decisionSha256": "45659e36767d191ea8537832fc550b920e05d6bc5b9c14e22dd14b4c52c480cf",
    "contentSha256": "9e6f78ac69443c96b028d4f1c5da8369f3e990531d39af00ad22ea0c06b5ba82",
    "contractSha256": "f95d920724187158e6cd900fb83eacb6e3ad982ee766a47128e56173f9b771d1"
  }
}
```

# Observer les réglages IA inactifs et la séparation des pouvoirs

Proposition v1 non approuvée, non admise et non exécutée (NOT_RUN).

Critères : CONFIG, RIGHTS, ANALYZE.

## Acteurs et droits

- Propriétaire, Administrateur actif et Membre simple synthétiques avec rôles préexistants ; chacun conserve seulement ses droits documentaires habituels.

## Préconditions et préparation séparée

- Avant toute campagne : déploiement Dev et commit réellement observés, QA technique établie, cette version admise et sélection exacte autorisée. Une proposition ne vaut ni admission ni exécution.
- Comptes synthétiques déjà autorisés et sessions privées disponibles ; fixtures exclusives préfixées BU-CAP-<campagne>-<fiche>, inventaire UI initial et noms attendus consignés sans secrets. Pas de données familiales, création de compte, courriel ou changement de rôle implicite.
- Actions et assertions métier exclusivement dans l’UI avec les API documentées de Browser Use. Aucun SQL, appel API Hestia, état interne ou interception réseau. Les étapes décrivent le comportement validé, sans concevoir une interface.
- La cible Dev a explicitement les fournisseurs réels désactivés ; aucune configuration secrète n’est lue ou saisie. L’absence de fournisseur qualifié est une précondition, pas un succès d’analyse.

## Données synthétiques

- Configuration IA sans fournisseur qualifié ni clé ; dossier privé Membre inaccessible aux deux autres acteurs, avec document synthétique témoin.

## Actions UI

- Comme Propriétaire puis Administrateur, ouvrir les réglages Suggestions de rangement depuis Moi ; observer le plafond mensuel et l’état de fournisseur indisponible, puis sortir sans saisir de clé.
- Comme Membre simple, examiner les commandes proposées dans Moi sans manipuler d’URL ni utiliser une API.
- Comme Propriétaire puis Administrateur, consulter leurs dossiers et brouillons visibles ; comme Membre, vérifier son document témoin privé.

## Assertions attendues

- Propriétaire et Administrateur ont accès aux réglages ; fournisseur/modèle non qualifiés empêchent l’activation et aucune analyse réussie n’est annoncée.
- Le plafond est explicitement mensuel et configurable dans le parcours prévu ; son absence ne peut pas être remplacée par un montant supposé.
- Membre simple ne dispose pas de la gestion IA ; les acteurs de gestion ne découvrent ni le dossier privé Membre ni ses brouillons.
- Aucune valeur de clé enregistrée n’est présentée par la vue ; cette inspection ne démontre pas à elle seule le chiffrement serveur.

## Effets persistants

- Aucune modification de configuration, aucun appel fournisseur ni coût demandé par cette fiche.

## Remise en état

- Conserver les seules fixtures de cette fiche et leur état final dans le rapport ; aucune purge irréversible ni reset global. Les temporaires suivent le cycle normal du produit ; leur disparition de l’UI ne prouve pas un effacement physique.

## Arrêt

- Prérequis manquant, cible inconnue, outil incapable de réaliser un geste ou donnée non synthétique : bloquer avant ce geste ; ne pas remplacer une assertion par une preuve technique.
- Session invalide, dérive de déploiement, contamination ou mutation incertaine : arrêter la campagne et réconcilier avant toute nouvelle sélection. Ne jamais rejouer aveuglément une finalisation.
- Assertion visible contredite : constater FAIL sans affaiblir la fiche ni réparer le produit dans la tentative. Aucun résultat actuel n’est repris d’un ancien PASS.

## Limites de preuve

- Sauvegarde effective, clé write-only serveur, budgets concurrents et refus API relèvent des tests techniques ; cette fiche ne les certifie pas.
