```json
{
  "schemaVersion": 1,
  "revision": 1,
  "status": "active",
  "references": [
    "tests/e2e/files.spec.ts"
  ],
  "actor": "Membre synthétique de recette Dev",
  "rights": [
    "Uniquement les capacités indiquées dans les prérequis de la fiche."
  ],
  "syntheticData": [
    "Compte synthétique autorisé ; aucun document familial réel."
  ],
  "persistentEffects": [
    "Aucune modification documentaire ; état de recherche du navigateur seulement."
  ],
  "cleanup": [
    "Effacer la recherche et quitter l’écran de détail si ouvert."
  ],
  "stopConditions": [
    "Cible Dev ou version non établie : bloquer.",
    "Session, données ou résultat d’une mutation incertains : arrêter et réconcilier sans nouvelle tentative automatique."
  ],
  "dependencies": [],
  "id": "rechercher-titre",
  "title": "Rechercher un titre présent puis un titre absent",
  "theme": "Recherche",
  "preconditions": [
    "Compte synthétique connecté et autorisé à consulter le document de recette.",
    "Document synthétique dédié préexistant avec titre connu ; titre absent unique établi pour la recette."
  ],
  "objective": "Vérifier les résultats visibles d’une recherche par titre et l’état sans résultat.",
  "actions": [
    "Ouvrir Rechercher ou le champ de recherche affiché.",
    "Rechercher le titre connu, puis ouvrir le résultat correspondant.",
    "Revenir à la recherche et saisir la valeur absente prévue.",
    "Effacer la recherche."
  ],
  "assertions": [
    "Le résultat attendu apparaît et ouvre le bon document.",
    "La recherche du titre absent affiche Aucun résultat.",
    "Un éventuel chargement impossible n’est pas interprété comme Aucun résultat."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-08T07:04:11.779Z",
    "proposalSha256": "66d8e524e7b8bb0eea8488dab12adce4cfe4c4eea26414dedc246153394c710b",
    "decisionSha256": "14eeaa8a01b0b086842b24647dd9d556d9735ac1eb054c8c9e27b925ba853255",
    "contentSha256": "adcb42605f13573ddfdc7f4b88d6c1faa60f885747d1bcee88acff85cad24a77",
    "contractSha256": "138522ede5618981f21d3043d736760255419e6a88913be63a8d3182fd2588a7"
  }
}
```

# Rechercher un titre présent puis un titre absent

Proposition non approuvée, non exécutée.

## Situation et objectif

Vérifier les résultats visibles d’une recherche par titre et l’état sans résultat.

## Actions dans l’interface

1. Ouvrir Rechercher ou le champ de recherche affiché.
2. Rechercher le titre connu, puis ouvrir le résultat correspondant.
3. Revenir à la recherche et saisir la valeur absente prévue.
4. Effacer la recherche.

## Résultats attendus

- Le résultat attendu apparaît et ouvre le bon document.
- La recherche du titre absent affiche Aucun résultat.
- Un éventuel chargement impossible n’est pas interprété comme Aucun résultat.

Préparations et effets : consulter les métadonnées structurées ci-dessus. Aucun accord d’exécution n’est déduit de cette proposition.
