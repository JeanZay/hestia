```json
{
  "schemaVersion": 1,
  "revision": 1,
  "status": "active",
  "references": [
    "tests/e2e/documents.spec.ts",
    "docs/adr/0002-persistent-document-foundation.md"
  ],
  "actor": "Membre synthétique de recette Dev",
  "rights": [
    "Uniquement les capacités indiquées dans les prérequis de la fiche."
  ],
  "syntheticData": [
    "Compte synthétique autorisé ; aucun document familial réel."
  ],
  "persistentEffects": [
    "Le nom du seul dossier désigné est modifié."
  ],
  "cleanup": [
    "Conserver le nouveau nom dans le rapport ; aucune restauration ou suppression implicite."
  ],
  "stopConditions": [
    "Cible Dev ou version non établie : bloquer.",
    "Session, données ou résultat d’une mutation incertains : arrêter et réconcilier sans nouvelle tentative automatique."
  ],
  "dependencies": [],
  "id": "renommer-dossier",
  "title": "Renommer un dossier et vérifier la persistance",
  "theme": "Dossiers",
  "preconditions": [
    "Compte synthétique connecté avec la capacité de renommer le dossier désigné.",
    "Dossier synthétique dédié préexistant, nom initial et nouveau nom connus ; sa création n’est pas incluse dans cette sélection."
  ],
  "objective": "Vérifier qu’un renommage est conservé après rechargement.",
  "actions": [
    "Ouvrir le dossier désigné puis choisir Renommer.",
    "Saisir le nouveau nom et enregistrer.",
    "Recharger et rouvrir le dossier avec son nouveau nom."
  ],
  "assertions": [
    "Le titre et l’entrée de liste portent le nouveau nom.",
    "Le changement persiste après rechargement ; l’ancien nom ne subsiste pas comme deuxième dossier."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-08T07:04:11.955Z",
    "proposalSha256": "6c4da68b147f3ad2bad4af13625f19328243579496640a6526123fd44d98d98e",
    "decisionSha256": "e9c6294dc4cf30b95d8eb00108a6a0ec37eb5b144106be27861b57c3ad6304a7",
    "contentSha256": "73ac15d7ff09ad11b941538bcec92770b0c85c15f9f1353010ff7ff1ad1439bd",
    "contractSha256": "da4ed448e6434000f2d0f7c8784b53ffdb35f32cd1283b73751a50f1264bea4a"
  }
}
```

# Renommer un dossier et vérifier la persistance

Proposition non approuvée, non exécutée.

## Situation et objectif

Vérifier qu’un renommage est conservé après rechargement.

## Actions dans l’interface

1. Ouvrir le dossier désigné puis choisir Renommer.
2. Saisir le nouveau nom et enregistrer.
3. Recharger et rouvrir le dossier avec son nouveau nom.

## Résultats attendus

- Le titre et l’entrée de liste portent le nouveau nom.
- Le changement persiste après rechargement ; l’ancien nom ne subsiste pas comme deuxième dossier.

Préparations et effets : consulter les métadonnées structurées ci-dessus. Aucun accord d’exécution n’est déduit de cette proposition.
