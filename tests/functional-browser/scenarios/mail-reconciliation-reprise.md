```json
{
  "schemaVersion": 1,
  "revision": 1,
  "status": "active",
  "theme": "À classer, résumés et versions",
  "actor": "Inbox-A destinataire et déposant",
  "rights": [
    "Consulter+Déposer sur le seul dossier prévu ; aucune autre mutation pendant l’incertitude."
  ],
  "preconditions": [
    "Rapport de campagne interrompue et identité de l’opération conservés ; Amaury a explicitement autorisé cette nouvelle sélection après réconciliation et réserves, sur le même Dev identifié.",
    "Déploiement Dev exact, commit et comptes synthétiques autorisés identifiés.",
    "Inventaire de préparation par fiche figé avant campagne : comptes exacts et rôles Inbox-A/B/C, identifiants des seuls objets synthétiques, droits effectifs, dates/états et source d’autorisation de chaque préparation. Les noms de rôle ne remplacent pas cet inventaire.",
    "Défaut de réponse de classement préparé par un mécanisme autorisé et observable, sans API/interception Browser Use ; rapport et prochaine réconciliation prévus.",
    "Préparation synthétique propre au parcours achevée séparément et son inventaire vérifié ; aucun appel API, SQL ou interception réseau pendant les actions métier Browser Use.",
    "Les gestes nécessitant réception Google, audio synthétique, droits distincts, délai dépassé, panne de transport ou IA disposent de ces états réellement préparés et des autorisations applicables ; sinon la partie concernée est BLOCKED/NOT_RUN."
  ],
  "syntheticData": [
    "Fichiers du dépôt ou documents explicitement fictifs de campagne ; adresses hestia.invalid ; noms et dates fictifs."
  ],
  "persistentEffects": [
    "Les pièces traitées, réglages modifiés et éventuels documents/révisions créés restent identifiés dans le rapport.",
    "Tout appel de réception, transcription, IA ou accusé nécessite son autorisation et son plafond préalablement vérifiés.",
    "Le classement peut être enregistré ou non : aucune déclaration de succès/échec métier avant la phase distincte de réconciliation."
  ],
  "cleanup": [
    "Rétablir les seuls réglages du parcours si leur état initial est connu.",
    "Ne pas supprimer un document finalisé ; conserver son identité et appliquer ultérieurement le nettoyage synthétique autorisé avec provenance vérifiée."
  ],
  "stopConditions": [
    "Identité Dev, compte, données, droits, prérequis ou autorisation inconnus : bloquer la partie concernée.",
    "Résultat de mutation incertain : arrêter et réconcilier ; ne pas répéter une mutation ou un appel payant aveuglément.",
    "Une assertion non observable dans Browser Use reste BLOCKED/NOT_RUN ; aucun résultat local/API/Playwright ne la remplace."
  ],
  "dependencies": [],
  "id": "mail-reconciliation-reprise",
  "title": "Réconcilier un classement dans une nouvelle campagne autorisée",
  "objective": "Réconcilier un classement dans une nouvelle campagne autorisée",
  "references": [
    "https://github.com/JeanZay/hestia/issues/9",
    "docs/design/mail-inbox-correspondence.md",
    "docs/browser-recipe.md",
    "tests/e2e/mail-inbox.spec.ts"
  ],
  "actions": [
    "Dans la nouvelle campagne sélectionnée, reconnecter le même membre synthétique et retrouver À classer via Dossiers.",
    "Utiliser Vérifier le résultat ; lire le reçu connu. Un résultat encore en cours ou inconnu arrête cette nouvelle campagne sans répétition.",
    "Si le reçu indique Classé, ouvrir le dossier puis une autre pièce restée en attente ; si Pas classé est confirmé, un réessai utilisant la même opération est permis seulement s’il fait partie de cette nouvelle sélection."
  ],
  "assertions": [
    "La vérification reste disponible même si la pièce est déjà classée et son contenu privé n’est plus consultable dans la file.",
    "Le reçu confirmé actualise le compteur une seule fois ; une autre pièce reste accessible.",
    "Aucune répétition de mutation n’est automatique ; une nouvelle incertitude arrête de nouveau la campagne."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-16T05:23:25.122Z",
    "proposalSha256": "1c10635e040710155d029a2b83704189b74091d79677c60bf57f0ebbe89201cb",
    "decisionSha256": "8fa84478dca9e037c7164f07fda6c761bbaf57e57a848f14ffca29dad4f5fced",
    "contentSha256": "995358bc91f2cd14a1ee71d597e26ccdda8d74989d13894062c13821cba0714d",
    "contractSha256": "0f7f0c3466f4bd0558b065dfb69a4203411f7b21867b4b43e7949d3c447efd61"
  }
}
```

# Réconcilier un classement dans une nouvelle campagne autorisée

Proposition v1 non admise et non exécutée. Phase distincte de la campagne interrompue, avec nouvelle sélection explicitement autorisée.

1. Dans la nouvelle campagne sélectionnée, reconnecter le même membre synthétique et retrouver À classer via Dossiers.
2. Utiliser Vérifier le résultat ; lire le reçu connu. Un résultat encore en cours ou inconnu arrête cette nouvelle campagne sans répétition.
3. Si le reçu indique Classé, ouvrir le dossier puis une autre pièce restée en attente ; si Pas classé est confirmé, un réessai utilisant la même opération est permis seulement s’il fait partie de cette nouvelle sélection.

- La vérification reste disponible même si la pièce est déjà classée et son contenu privé n’est plus consultable dans la file.
- Le reçu confirmé actualise le compteur une seule fois ; une autre pièce reste accessible.
- Aucune répétition de mutation n’est automatique ; une nouvelle incertitude arrête de nouveau la campagne.

Autorités : brief/matrice v4/v5 et hand-off exact identifiés dans docs/design/mail-inbox-correspondence.md ; S12/S30 partiels, aucune preuve technique remplacée.
