```json
{
  "schemaVersion": 1,
  "revision": 1,
  "status": "active",
  "references": [
    "docs/family-access.md",
    "tests/e2e/documents.spec.ts"
  ],
  "actor": "Membre synthétique de recette Dev",
  "rights": [
    "Uniquement les capacités indiquées dans les prérequis de la fiche."
  ],
  "syntheticData": [
    "Compte synthétique autorisé ; aucun document familial réel."
  ],
  "persistentEffects": [
    "Création puis fin d’une session du seul compte de recette."
  ],
  "cleanup": [
    "Laisser le navigateur déconnecté ; ne conserver aucun secret dans les preuves."
  ],
  "stopConditions": [
    "Cible Dev ou version non établie : bloquer.",
    "Session, données ou résultat d’une mutation incertains : arrêter et réconcilier sans nouvelle tentative automatique."
  ],
  "dependencies": [],
  "id": "connexion-deconnexion",
  "title": "Se connecter puis se déconnecter",
  "theme": "Accès",
  "preconditions": [
    "Compte synthétique actif autorisé et moyen de saisie privée disponible.",
    "Session de navigateur de recette isolée, non connectée ; page Connexion visible."
  ],
  "objective": "Vérifier que le membre accède à son espace puis le quitte par l’interface.",
  "actions": [
    "Saisir les identifiants autorisés par un mécanisme privé et choisir Se connecter.",
    "Attendre la vue Dossiers.",
    "Ouvrir Moi si nécessaire, puis choisir Se déconnecter.",
    "Recharger la page."
  ],
  "assertions": [
    "La vue Dossiers apparaît après connexion.",
    "La page Connexion apparaît après déconnexion et reste affichée après rechargement.",
    "Aucun contenu de dossier ne reste visible sur la page déconnectée."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-08T07:04:11.198Z",
    "proposalSha256": "ff730c5673bde4edbe1bda859201e1967278b8d92660d29c5a43309122db9700",
    "decisionSha256": "eb4f7e4c0edec22ff807cec8af0028eb4ad47296134ea46c649d7e6d81b9ebda",
    "contentSha256": "f99f6c4331caaaa6d4e15a287a6e33e3eb3c445ed5d017ab6e194401d8f93e6c",
    "contractSha256": "5e2fd09f26b7359e155aa24d8fbe97617e0e6deeb30919cf2378266f05b85018"
  }
}
```

# Se connecter puis se déconnecter

Proposition non approuvée, non exécutée.

## Situation et objectif

Vérifier que le membre accède à son espace puis le quitte par l’interface.

## Actions dans l’interface

1. Saisir les identifiants autorisés par un mécanisme privé et choisir Se connecter.
2. Attendre la vue Dossiers.
3. Ouvrir Moi si nécessaire, puis choisir Se déconnecter.
4. Recharger la page.

## Résultats attendus

- La vue Dossiers apparaît après connexion.
- La page Connexion apparaît après déconnexion et reste affichée après rechargement.
- Aucun contenu de dossier ne reste visible sur la page déconnectée.

Préparations et effets : consulter les métadonnées structurées ci-dessus. Aucun accord d’exécution n’est déduit de cette proposition.
