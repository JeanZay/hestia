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
  "actor": "Administrateur synthétique puis membre synthétique ordinaire",
  "rights": [
    "Administration active pour modifier les réglages dictée ; aucun droit de configuration pour le membre."
  ],
  "preconditions": [
    "Déploiement Dev exact identifié et compte synthétique autorisé connecté.",
    "Fichier synthetic.png du dépôt disponible via le sélecteur Browser Use ; dossier de campagne dédié déjà accessible.",
    "Deux comptes synthétiques autorisés, administrateur et membre, avec mécanisme de saisie privée des identifiants.",
    "État initial des réglages connu et restauration exacte autorisée ; au moins le modèle MAI qualifié visible.",
    "Aucune nouvelle clé réelle créée ; clé déjà configurée seulement si nécessaire et autorisée."
  ],
  "syntheticData": [
    "Image ou PDF synthétique du dépôt ; titres et texte explicitement fictifs."
  ],
  "persistentEffects": [
    "Réglage Dev temporairement modifié puis rétabli ; aucune clé créée ni appel STT voulu."
  ],
  "cleanup": [
    "Restaurer exactement les réglages dictée observés au début et vérifier leur état visible ; arrêter en cas de conflit de version."
  ],
  "stopConditions": [
    "Identité Dev, compte, autorisation ou données inconnus : bloquer.",
    "Résultat de mutation incertain : arrêter et réconcilier avant répétition.",
    "Une action ou assertion impossible dans Browser Use reste BLOCKED/NOT_RUN ; aucun résultat API/Playwright ne la remplace."
  ],
  "dependencies": [],
  "id": "dictee-reglages-separes",
  "title": "Régler la dictée sans modifier les suggestions de rangement",
  "objective": "Le réglage STT et son plafond sont distincts du classement et réservés aux rôles autorisés.",
  "actions": [
    "Avec l’administrateur, ouvrir Moi puis les réglages Dictée ; relever modèle, état et plafond sans révéler de clé.",
    "Vérifier la liste des seuls modèles qualifiés, l’indication du vocabulaire et la séparation du plafond mensuel UTC.",
    "Modifier uniquement le plafond ou l’activation selon la préparation autorisée puis enregistrer.",
    "Ouvrir les réglages Suggestions de rangement et vérifier leur modèle/plafond inchangés. Restaurer les réglages dictée initiaux.",
    "Avec le membre ordinaire, ouvrir Moi et vérifier l’absence d’accès aux réglages administratifs."
  ],
  "assertions": [
    "Le formulaire dictée est distinct et ne restitue aucune clé existante.",
    "Enregistrer ne déclenche ni enregistrement audio ni transcription ; le modèle de classement reste inchangé.",
    "Le réglage explique son application aux prochaines dictées et la conservation des dépenses/réservations antérieures.",
    "Le membre ne dispose pas de commande permettant de modifier ces réglages.",
    "Si un seul modèle réel est qualifié, aucun changement vers un second modèle n’est déclaré testé ; la permutation est prouvée séparément avec deux adaptateurs synthétiques."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-14T20:02:51.000Z",
    "proposalSha256": "e37654aa9c59cd637b836afc0324233a7a5b978034f29ec5d64b2ffb5a7e6746",
    "decisionSha256": "d179546e6ea6fc5f7d6e5a939c72acc9125dbb1564a0dee0f9f2fd19766c7d65",
    "contentSha256": "80aa0cbb892f5333eeb4033f870e0feaeb0cb1a78027e4c6565430b2da7452d1",
    "contractSha256": "49c1839fad582b98490703f0d3890a9e036a6c2c89977c022b2f3aeb03336fe6"
  }
}
```

# Régler la dictée sans modifier les suggestions de rangement

Proposition v1 non admise, non exécutée.

Le réglage STT et son plafond sont distincts du classement et réservés aux rôles autorisés.

## Actions UI

1. Avec l’administrateur, ouvrir Moi puis les réglages Dictée ; relever modèle, état et plafond sans révéler de clé.
2. Vérifier la liste des seuls modèles qualifiés, l’indication du vocabulaire et la séparation du plafond mensuel UTC.
3. Modifier uniquement le plafond ou l’activation selon la préparation autorisée puis enregistrer.
4. Ouvrir les réglages Suggestions de rangement et vérifier leur modèle/plafond inchangés. Restaurer les réglages dictée initiaux.
5. Avec le membre ordinaire, ouvrir Moi et vérifier l’absence d’accès aux réglages administratifs.

## Résultats attendus

- Le formulaire dictée est distinct et ne restitue aucune clé existante.
- Enregistrer ne déclenche ni enregistrement audio ni transcription ; le modèle de classement reste inchangé.
- Le réglage explique son application aux prochaines dictées et la conservation des dépenses/réservations antérieures.
- Le membre ne dispose pas de commande permettant de modifier ces réglages.
- Si un seul modèle réel est qualifié, aucun changement vers un second modèle n’est déclaré testé ; la permutation est prouvée séparément avec deux adaptateurs synthétiques.

Préconditions, effets, remise en état et arrêts : métadonnées ci-dessus. Aucun appel API, interception ni preuve Playwright ne remplace une assertion Browser Use.
