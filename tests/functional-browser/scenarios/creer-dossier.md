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
    "Un dossier synthétique vide est créé pour ce parcours."
  ],
  "cleanup": [
    "Conserver le dossier identifié dans le rapport ; aucune suppression ou réutilisation non demandée."
  ],
  "stopConditions": [
    "Cible Dev ou version non établie : bloquer.",
    "Session, données ou résultat d’une mutation incertains : arrêter et réconcilier sans nouvelle tentative automatique."
  ],
  "dependencies": [],
  "id": "creer-dossier",
  "title": "Créer un dossier et le retrouver après rechargement",
  "theme": "Dossiers",
  "preconditions": [
    "Membre synthétique connecté et autorisé à créer un dossier.",
    "Nom synthétique unique réservé à la campagne ; aucun dossier existant ne doit être réutilisé silencieusement."
  ],
  "objective": "Vérifier la création visible et la persistance d’un nouveau dossier.",
  "actions": [
    "Choisir Nouveau dossier et saisir le nom unique prévu.",
    "Choisir Créer le dossier et attendre son ouverture.",
    "Recharger la page et rouvrir ce dossier depuis la liste."
  ],
  "assertions": [
    "Le dossier porte exactement le nom demandé.",
    "Il apparaît une seule fois dans la liste après rechargement et peut être ouvert."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-08T07:04:11.402Z",
    "proposalSha256": "e2232462c6e3ee18f29dc3498c766fdeef6fbc2f463d17f5d487f475c51654f7",
    "decisionSha256": "aabba88ffedceda210c59ac6ac762dc7335940240d9746de27e02565a2d7bacd",
    "contentSha256": "530841c1f9d1d7732237870a796d916bb524cc32e3c1d7d1b787b70872c096d3",
    "contractSha256": "7a66c60713027ab8330dcbe979d91383d9676ebbb2df442a4e75751cef57f47f"
  }
}
```

# Créer un dossier et le retrouver après rechargement

Proposition non approuvée, non exécutée.

## Situation et objectif

Vérifier la création visible et la persistance d’un nouveau dossier.

## Actions dans l’interface

1. Choisir Nouveau dossier et saisir le nom unique prévu.
2. Choisir Créer le dossier et attendre son ouverture.
3. Recharger la page et rouvrir ce dossier depuis la liste.

## Résultats attendus

- Le dossier porte exactement le nom demandé.
- Il apparaît une seule fois dans la liste après rechargement et peut être ouvert.

Préparations et effets : consulter les métadonnées structurées ci-dessus. Aucun accord d’exécution n’est déduit de cette proposition.
