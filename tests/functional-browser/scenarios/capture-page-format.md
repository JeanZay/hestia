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
    "Préparer séparément les deux brouillons et consigner leur origine réelle ou simulée. Ils doivent être visibles, non expirés, et avoir une page confirmée. Cette fiche ne prend aucune photo et ne qualifie pas la caméra physique."
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
  "id": "capture-page-format",
  "title": "Finaliser une page sauvegardée en image puis en PDF",
  "objective": "Finaliser une page sauvegardée en image puis en PDF",
  "rights": [
    "Auteur possède Consulter, Déposer et Exporter dans deux dossiers dédiés ; aucune gestion des accès requise."
  ],
  "syntheticData": [
    "Deux brouillons caméra privés indépendants contenant chacun une page synthétique à repère visible, sauvegarde confirmée. Deux titres uniques et dossiers vides distincts."
  ],
  "actions": [
    "Depuis Brouillons, reprendre le premier brouillon et vérifier sa page. Continuer, choisir Image, donner le premier titre puis choisir où ranger.",
    "Parcourir les dossiers, choisir le premier dossier autorisé et ouvrir la vérification des accès. Observer les capacités propres puis confirmer une seule fois.",
    "Après confirmation visible, ouvrir le document et télécharger son original via l’UI ; examiner son rendu avec un visualiseur local autorisé.",
    "Reprendre le second brouillon indépendant et effectuer les mêmes gestes avec le format PDF, le second titre et le second dossier. Recharger et rouvrir les deux documents."
  ],
  "assertions": [
    "Une page propose Image et PDF ; chaque choix produit un seul document sous le titre et dans la destination attendus.",
    "Le téléchargement choisi Image est une image ouvrable ; celui choisi PDF est un PDF d’une page dont le repère correspond à la page validée.",
    "Les accès sont présentés avant confirmation sans personnes cachées pour cet acteur ; les documents restent présents après rechargement.",
    "Les brouillons finalisés ne restent pas proposés comme documents à finaliser. Ceci ne prouve pas la purge physique des sources."
  ],
  "persistentEffects": [
    "Deux documents synthétiques durables et leurs originaux ; brouillons finalisés et temporaires soumis au nettoyage normal."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-10T21:25:00.000Z",
    "proposalSha256": "d15654916052995d9e38b588aad3714fd881a8094fa6bdbbfddc6153b29eedfe",
    "decisionSha256": "f784d1ece55509764b8f4e1d8fc807613baf5cee4dce7d7b62677a2e8dbd73ac",
    "contentSha256": "e78c4067801afd15bf96db2c3315e13fe4587efc169d7db955bcb642f12f0bbc",
    "contractSha256": "2f835e3c53ecfbb34fb420129176572e5ca7c0a10fe5d254738c25fde629b73e"
  }
}
```

# Finaliser une page sauvegardée en image puis en PDF

Proposition v1 non approuvée, non admise et non exécutée (NOT_RUN).

Critères : CAPTURE, IMMUTABLE, DESTINATION, RIGHTS.

## Acteurs et droits

- Auteur possède Consulter, Déposer et Exporter dans deux dossiers dédiés ; aucune gestion des accès requise.

## Préconditions et préparation séparée

- Avant toute campagne : déploiement Dev et commit réellement observés, QA technique établie, cette version admise et sélection exacte autorisée. Une proposition ne vaut ni admission ni exécution.
- Comptes synthétiques déjà autorisés et sessions privées disponibles ; fixtures exclusives préfixées BU-CAP-<campagne>-<fiche>, inventaire UI initial et noms attendus consignés sans secrets. Pas de données familiales, création de compte, courriel ou changement de rôle implicite.
- Actions et assertions métier exclusivement dans l’UI avec les API documentées de Browser Use. Aucun SQL, appel API Hestia, état interne ou interception réseau. Les étapes décrivent le comportement validé, sans concevoir une interface.
- Préparer séparément les deux brouillons et consigner leur origine réelle ou simulée. Ils doivent être visibles, non expirés, et avoir une page confirmée. Cette fiche ne prend aucune photo et ne qualifie pas la caméra physique.

## Données synthétiques

- Deux brouillons caméra privés indépendants contenant chacun une page synthétique à repère visible, sauvegarde confirmée. Deux titres uniques et dossiers vides distincts.

## Actions UI

- Depuis Brouillons, reprendre le premier brouillon et vérifier sa page. Continuer, choisir Image, donner le premier titre puis choisir où ranger.
- Parcourir les dossiers, choisir le premier dossier autorisé et ouvrir la vérification des accès. Observer les capacités propres puis confirmer une seule fois.
- Après confirmation visible, ouvrir le document et télécharger son original via l’UI ; examiner son rendu avec un visualiseur local autorisé.
- Reprendre le second brouillon indépendant et effectuer les mêmes gestes avec le format PDF, le second titre et le second dossier. Recharger et rouvrir les deux documents.

## Assertions attendues

- Une page propose Image et PDF ; chaque choix produit un seul document sous le titre et dans la destination attendus.
- Le téléchargement choisi Image est une image ouvrable ; celui choisi PDF est un PDF d’une page dont le repère correspond à la page validée.
- Les accès sont présentés avant confirmation sans personnes cachées pour cet acteur ; les documents restent présents après rechargement.
- Les brouillons finalisés ne restent pas proposés comme documents à finaliser. Ceci ne prouve pas la purge physique des sources.

## Effets persistants

- Deux documents synthétiques durables et leurs originaux ; brouillons finalisés et temporaires soumis au nettoyage normal.

## Remise en état

- Conserver les seules fixtures de cette fiche et leur état final dans le rapport ; aucune purge irréversible ni reset global. Les temporaires suivent le cycle normal du produit ; leur disparition de l’UI ne prouve pas un effacement physique.

## Arrêt

- Prérequis manquant, cible inconnue, outil incapable de réaliser un geste ou donnée non synthétique : bloquer avant ce geste ; ne pas remplacer une assertion par une preuve technique.
- Session invalide, dérive de déploiement, contamination ou mutation incertaine : arrêter la campagne et réconcilier avant toute nouvelle sélection. Ne jamais rejouer aveuglément une finalisation.
- Assertion visible contredite : constater FAIL sans affaiblir la fiche ni réparer le produit dans la tentative. Aucun résultat actuel n’est repris d’un ancien PASS.

## Limites de preuve

- Téléchargements réellement effectués par UI ; examen du fichier complémentaire déclaré. Caméra, octets du stockage et purge physique hors assertions Browser Use.
