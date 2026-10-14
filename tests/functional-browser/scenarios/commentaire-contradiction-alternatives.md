```json
{
  "schemaVersion": 1,
  "revision": 1,
  "status": "active",
  "theme": "Commentaire et dictée",
  "references": [
    "docs/adr/0012-comment-transcription.md",
    "docs/design/comment-voice-integration.md",
    "tests/e2e/comment-voice.spec.ts"
  ],
  "actor": "Membre synthétique actif de recette Dev",
  "rights": [
    "Consultation et dépôt sur le seul dossier synthétique dédié."
  ],
  "preconditions": [
    "Déploiement Dev exact identifié et compte synthétique autorisé connecté.",
    "Fichier synthetic.png du dépôt disponible via le sélecteur Browser Use ; dossier de campagne dédié déjà accessible.",
    "Fournisseur de classement configuré et appels synthétiques explicitement autorisés avec plafond applicable.",
    "Document synthétique lisible indiquant véhicule bleu ; commentaire préparé indiquant véhicule rouge ; destinations fictives correspondantes accessibles."
  ],
  "syntheticData": [
    "Image ou PDF synthétique du dépôt ; titres et texte explicitement fictifs."
  ],
  "persistentEffects": [
    "Un appel de classement facturable autorisé et un document synthétique finalisé ; coûts conservés dans le suivi de qualification."
  ],
  "cleanup": [
    "Abandonner dans l’interface uniquement les brouillons de ce parcours si leur identité et état sont certains.",
    "Les documents synthétiques finalisés restent identifiés dans le rapport ; leur éventuel nettoyage suit la procédure dédiée."
  ],
  "stopConditions": [
    "Identité Dev, compte, autorisation ou données inconnus : bloquer.",
    "Résultat de mutation incertain : arrêter et réconcilier avant répétition.",
    "Une action ou assertion impossible dans Browser Use reste BLOCKED/NOT_RUN ; aucun résultat API/Playwright ne la remplace.",
    "Si le fournisseur ne signale pas la contradiction attendue, consigner FAIL ; ne pas substituer une réponse simulée ni relancer silencieusement."
  ],
  "dependencies": [],
  "id": "commentaire-contradiction-alternatives",
  "title": "Observer une contradiction et choisir une alternative",
  "objective": "Une contradiction document/commentaire est signalée ; elle ne déclenche jamais de rangement automatique.",
  "actions": [
    "Importer le document synthétique et saisir le commentaire contradictoire.",
    "Demander explicitement les suggestions une seule fois.",
    "Lire le signalement de divergence et les alternatives effectivement rendues.",
    "Corriger le commentaire puis constater que les anciennes suggestions ne sont plus utilisables.",
    "Choisir un dossier manuellement, vérifier puis enregistrer après confirmation humaine."
  ],
  "assertions": [
    "La divergence est explicite et distincte d’une erreur technique ou de l’absence de suggestions.",
    "Les alternatives proposées sont lisibles et aucune n’est appliquée automatiquement.",
    "La correction périme les anciennes propositions ; aucune nouvelle analyse ne se lance seule.",
    "Le dossier final correspond au choix confirmé dans l’interface."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-14T20:02:51.000Z",
    "proposalSha256": "7547be9c95246d8d4018e1552e76fb9098ebff9cc0cf91b7e06eba434473e249",
    "decisionSha256": "6a4c80ec3f2798464481c65069868ee0fd1987584590e829651cc022df6e0ef9",
    "contentSha256": "f8b31d568975b7e0fa29a473fc4f83a4a48c074d7f4249d4438e01f85d0231b5",
    "contractSha256": "095f4cd10ab7c70f1e008ac471b0a7fe465cb34d4c4f937466ed398adbd281db"
  }
}
```

# Observer une contradiction et choisir une alternative

Proposition v1 non admise, non exécutée.

Une contradiction document/commentaire est signalée ; elle ne déclenche jamais de rangement automatique.

## Actions UI

1. Importer le document synthétique et saisir le commentaire contradictoire.
2. Demander explicitement les suggestions une seule fois.
3. Lire le signalement de divergence et les alternatives effectivement rendues.
4. Corriger le commentaire puis constater que les anciennes suggestions ne sont plus utilisables.
5. Choisir un dossier manuellement, vérifier puis enregistrer après confirmation humaine.

## Résultats attendus

- La divergence est explicite et distincte d’une erreur technique ou de l’absence de suggestions.
- Les alternatives proposées sont lisibles et aucune n’est appliquée automatiquement.
- La correction périme les anciennes propositions ; aucune nouvelle analyse ne se lance seule.
- Le dossier final correspond au choix confirmé dans l’interface.

Préconditions, effets, remise en état et arrêts : métadonnées ci-dessus. Aucun appel API, interception ni preuve Playwright ne remplace une assertion Browser Use.
