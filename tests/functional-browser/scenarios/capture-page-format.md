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
    "kind": "editorial",
    "actor": "haiku_candidate_review",
    "approvedAt": "2026-10-10T22:50:13.616Z",
    "proposalSha256": "29d8b40e347d7076e1350286681b7ad3fe5c3fc872fee274444ff3602d6e10ca",
    "decisionSha256": "1476f5d077c8ca48f79c9ee98a071b6d10701088ed74a4cd4d5c36a637f199d0",
    "contentSha256": "f13ff414d054b4066388c86ee7a6458eb5e6bc5a7989392cada508a39a5a4ccc",
    "contractSha256": "eb0d723bdf55411bf3c60adad40cd4e89f20f135ab37a7eef8e60076d94a186a"
  }
}
```

# Finaliser une page sauvegardée en image puis en PDF

Fiche admise ; révision éditoriale des références publiques. Aucun parcours exécuté ni résultat antérieur repris (NOT_RUN).

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
