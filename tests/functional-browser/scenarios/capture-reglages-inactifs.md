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
    "kind": "editorial",
    "actor": "haiku_candidate_review",
    "approvedAt": "2026-10-10T22:50:14.063Z",
    "proposalSha256": "34d9966c4315b77e5f9676339bd2939c1e289ae1598d25e28e4212f7b302b707",
    "decisionSha256": "b6ba0cb9be73be7dbcaa5c8606edd5796e3a3671e395039c8cd3557ef6a6b06c",
    "contentSha256": "d23ee5259c99a467808018f131f4f06f2868b8217eb6e36b0865d5b92f8ea4bc",
    "contractSha256": "fcc216f9766bb613def31bbdaa3bd639f153e86ee99d6f9e355547d7a207b520"
  }
}
```

# Observer les réglages IA inactifs et la séparation des pouvoirs

Fiche admise ; révision éditoriale des références publiques. Aucun parcours exécuté ni résultat antérieur repris (NOT_RUN).

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
