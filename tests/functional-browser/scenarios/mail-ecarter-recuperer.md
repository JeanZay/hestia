```json
{
  "schemaVersion": 1,
  "revision": 2,
  "status": "active",
  "theme": "À classer, résumés et versions",
  "actor": "Inbox-A destinataire de deux pièces du même mail",
  "rights": [
    "Propriété de ses pièces privées ; aucun document créé par cette opération."
  ],
  "preconditions": [
    "Déploiement Dev exact, commit et comptes synthétiques autorisés identifiés.",
    "Inventaire de préparation par fiche figé avant campagne : comptes exacts et rôles Inbox-A/B/C, identifiants des seuls objets synthétiques, droits effectifs, dates/états et source d’autorisation de chaque préparation. Les noms de rôle ne remplacent pas cet inventaire.",
    "Deux pièces A-1 et A-2 actives du même mail, résumé et commentaire synthétiques connus sur A-1.",
    "Préparation synthétique propre au parcours achevée séparément et son inventaire vérifié ; aucun appel API, SQL ou interception réseau pendant les actions métier Browser Use.",
    "Les gestes nécessitant réception Google, audio synthétique, droits distincts, délai dépassé, panne de transport ou IA disposent de ces états réellement préparés et des autorisations applicables ; sinon la partie concernée est BLOCKED/NOT_RUN."
  ],
  "syntheticData": [
    "Fichiers du dépôt ou documents explicitement fictifs de campagne ; adresses hestia.invalid ; noms et dates fictifs."
  ],
  "persistentEffects": [
    "Les pièces traitées, réglages modifiés et éventuels documents/révisions créés restent identifiés dans le rapport.",
    "Tout appel de réception, transcription, IA ou accusé nécessite son autorisation et son plafond préalablement vérifiés."
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
  "id": "mail-ecarter-recuperer",
  "title": "Écarter une pièce et retrouver la même pendant sept jours",
  "objective": "Écarter une pièce et retrouver la même pendant sept jours",
  "references": [
    "https://github.com/JeanZay/hestia/issues/9",
    "docs/design/mail-inbox-correspondence.md",
    "docs/browser-recipe.md",
    "tests/e2e/mail-inbox.spec.ts"
  ],
  "actions": [
    "Dans un mail synthétique avec deux pièces, ouvrir la première et confirmer Écarter cette pièce.",
    "Lire Écartées et sa date limite ; observer que l’autre pièce reste à classer.",
    "Remettre la pièce dans À classer, la rouvrir puis vérifier son commentaire et son état de résumé."
  ],
  "assertions": [
    "Le compteur baisse puis remonte sans double comptage.",
    "La récupération retrouve la même pièce et ne crée aucun document.",
    "Les autres pièces et leur contexte restent disponibles pendant la récupération possible."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-16T05:23:25.036Z",
    "proposalSha256": "fd585e2a522b704f0e1dd365f9797a7e20007f4bff66e2b7f37b513eb24a2dd9",
    "decisionSha256": "9f869e4a7406907b0ef8a99d7e34883d08dc606aa98b4414b52f834687da8ba0",
    "contentSha256": "816721ffc7ebce684744c0554646e98993d4446e7eec7756b74cbdf8b152896d",
    "contractSha256": "b2fa3a4969653b81ce359844940081fdc1761972f057fa24e6682c77db2279b4"
  }
}
```

# Écarter une pièce et retrouver la même pendant sept jours

Proposition v2, non admise et non exécutée. Remplace seulement la proposition v1 du même identifiant après revue ; aucune approbation ancienne conservée.

## Actions UI

1. Dans un mail synthétique avec deux pièces, ouvrir la première et confirmer Écarter cette pièce.
2. Lire Écartées et sa date limite ; observer que l’autre pièce reste à classer.
3. Remettre la pièce dans À classer, la rouvrir puis vérifier son commentaire et son état de résumé.

## Résultats attendus

- Le compteur baisse puis remonte sans double comptage.
- La récupération retrouve la même pièce et ne crée aucun document.
- Les autres pièces et leur contexte restent disponibles pendant la récupération possible.

## Autorité et limites de couverture

Besoin Issue 9 ; brief v4 préservé par v5 SHA-256 `82e93f350067e7ca4d3679af5d0c20afe9cb29456f065da11af59e7b91d407eb` ; matrice v5 S01–S37 SHA-256 `e1f93efc45d9b62c26c0f205c3aeb511d8f932420e45dff6f1f98960efd5909e` ; hand-off exact `Hestia A classer.dc.html` SHA-256 `f70004df1e58c6afb684d82fd4468858e071ed85a6bcb8643ace447cbaf36aba`. Identités et correspondance conservées dans le document référencé.

Rattachement partiel à S17, S23, S33. Les observations UI ne qualifient pas toutes les exigences techniques de ces scénarios. En particulier S16 (A/B/C et octets identiques), S19 (IA tardive après remplacement/rétablissement) et S21 (sortie malformée/coût inconnu) ne sont pas provoqués par cette seule fiche ; ils exigent des preuves techniques distinctes sur le candidat exact, ou une préparation et des gestes complémentaires explicitement sélectionnés. Aucun PASS de routefixture ou ancien test n’est transféré.
