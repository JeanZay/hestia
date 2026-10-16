```json
{
  "schemaVersion": 1,
  "revision": 2,
  "status": "active",
  "theme": "À classer, résumés et versions",
  "actor": "Inbox-A destinataire et modificateur ; Inbox-B lecteur de la cible",
  "rights": [
    "Consulter+Déposer sur le dossier d’ajout ; Consulter+Modifier sur la cible remplacée.",
    "Inbox-B peut Consulter la cible ; une cible témoin reste sans Modifier pour Inbox-A."
  ],
  "preconditions": [
    "Déploiement Dev exact, commit et comptes synthétiques autorisés identifiés.",
    "Inventaire de préparation par fiche figé avant campagne : comptes exacts et rôles Inbox-A/B/C, identifiants des seuls objets synthétiques, droits effectifs, dates/états et source d’autorisation de chaque préparation. Les noms de rôle ne remplacent pas cet inventaire.",
    "Un document identique consultable, une cible homonyme à contenu différent partagée et une cible sans Modifier sont identifiés ; anciennes versions distinguables.",
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
  "id": "mail-doublon-remplacer",
  "title": "Choisir Ajouter ou Remplacer sans changer les accès",
  "objective": "Choisir Ajouter ou Remplacer sans changer les accès",
  "references": [
    "https://github.com/JeanZay/hestia/issues/9",
    "docs/design/mail-inbox-correspondence.md",
    "docs/browser-recipe.md",
    "tests/e2e/mail-inbox.spec.ts"
  ],
  "actions": [
    "Ouvrir une pièce dont un contenu identique est déjà consultable ; demander la vérification du classement.",
    "Lire le doublon et choisir explicitement Ajouter un autre document ; vérifier puis confirmer.",
    "Pour une autre pièce synthétique homonyme à contenu différent, choisir Remplacer la cible prévue et confirmer son chemin et ses accès.",
    "Ouvrir la confirmation Remplacer la cible, relire que les lecteurs verront le nouveau contenu et que nom/emplacement/accès restent inchangés ; Annuler une première fois, puis confirmer explicitement seulement après nouvelle vérification."
  ],
  "assertions": [
    "Aucun remplacement n’est implicite.",
    "Le document ajouté possède sa propre identité.",
    "Le remplacement conserve le document cible et ses accès ; l’ancienne version devient récupérable 7 jours.",
    "Une cible sans Consulter+Modifier ne propose pas de remplacement utilisable.",
    "Aucun remplacement ne se produit avant le Dialog final ; Annuler conserve la cible et la pièce."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-16T05:23:24.997Z",
    "proposalSha256": "4da533c4becd21c3656a29e0ebf3d10520a72cb84478ad88ab1686a615f9c7d9",
    "decisionSha256": "1277321073ed7a38d973c8095eb351f45f90c4cfd45bdea496fb8e578e00e554",
    "contentSha256": "d5396336dd984b63b29f1638fbbbb715134edff1bc112b568841f9d505a1ad30",
    "contractSha256": "638f62b0c41046a9c01809e8dc2ae3ad4348a1a1886cacf3d5530aa11704d457"
  }
}
```

# Choisir Ajouter ou Remplacer sans changer les accès

Proposition v2, non admise et non exécutée. Remplace seulement la proposition v1 du même identifiant après revue ; aucune approbation ancienne conservée.

## Actions UI

1. Ouvrir une pièce dont un contenu identique est déjà consultable ; demander la vérification du classement.
2. Lire le doublon et choisir explicitement Ajouter un autre document ; vérifier puis confirmer.
3. Pour une autre pièce synthétique homonyme à contenu différent, choisir Remplacer la cible prévue et confirmer son chemin et ses accès.
4. Ouvrir la confirmation Remplacer la cible, relire que les lecteurs verront le nouveau contenu et que nom/emplacement/accès restent inchangés ; Annuler une première fois, puis confirmer explicitement seulement après nouvelle vérification.

## Résultats attendus

- Aucun remplacement n’est implicite.
- Le document ajouté possède sa propre identité.
- Le remplacement conserve le document cible et ses accès ; l’ancienne version devient récupérable 7 jours.
- Une cible sans Consulter+Modifier ne propose pas de remplacement utilisable.
- Aucun remplacement ne se produit avant le Dialog final ; Annuler conserve la cible et la pièce.

## Autorité et limites de couverture

Besoin Issue 9 ; brief v4 préservé par v5 SHA-256 `82e93f350067e7ca4d3679af5d0c20afe9cb29456f065da11af59e7b91d407eb` ; matrice v5 S01–S37 SHA-256 `e1f93efc45d9b62c26c0f205c3aeb511d8f932420e45dff6f1f98960efd5909e` ; hand-off exact `Hestia A classer.dc.html` SHA-256 `f70004df1e58c6afb684d82fd4468858e071ed85a6bcb8643ace447cbaf36aba`. Identités et correspondance conservées dans le document référencé.

Rattachement partiel à S11, S14, S34. Les observations UI ne qualifient pas toutes les exigences techniques de ces scénarios. En particulier S16 (A/B/C et octets identiques), S19 (IA tardive après remplacement/rétablissement) et S21 (sortie malformée/coût inconnu) ne sont pas provoqués par cette seule fiche ; ils exigent des preuves techniques distinctes sur le candidat exact, ou une préparation et des gestes complémentaires explicitement sélectionnés. Aucun PASS de routefixture ou ancien test n’est transféré.
