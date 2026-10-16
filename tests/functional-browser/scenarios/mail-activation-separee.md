```json
{
  "schemaVersion": 1,
  "revision": 2,
  "status": "active",
  "theme": "À classer, résumés et versions",
  "actor": "Inbox-A, membre actif destinataire et propriétaire de ses seuls réglages mail",
  "rights": [
    "Gestion de ses réglages personnels ; aucun droit de dossier nécessaire."
  ],
  "preconditions": [
    "Déploiement Dev exact, commit et comptes synthétiques autorisés identifiés.",
    "Inventaire de préparation par fiche figé avant campagne : comptes exacts et rôles Inbox-A/B/C, identifiants des seuls objets synthétiques, droits effectifs, dates/états et source d’autorisation de chaque préparation. Les noms de rôle ne remplacent pas cet inventaire.",
    "Réception technique Dev raccordée et adresse de connexion Inbox-A authentifiée ; état initial des deux interrupteurs relevé.",
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
  "id": "mail-activation-separee",
  "title": "Activer la réception et choisir séparément l’analyse",
  "objective": "Activer la réception et choisir séparément l’analyse",
  "references": [
    "https://github.com/JeanZay/hestia/issues/9",
    "docs/design/mail-inbox-correspondence.md",
    "docs/browser-recipe.md",
    "tests/e2e/mail-inbox.spec.ts"
  ],
  "actions": [
    "Ouvrir Moi puis Envoi par mail ; lire la notice Google et déplier le texte d’accusé.",
    "Activer seulement Recevoir mes pièces jointes par mail ; quitter puis rouvrir le réglage.",
    "Activer ensuite explicitement Analyser automatiquement les pièces reçues, puis désactiver cette analyse."
  ],
  "assertions": [
    "La notice décrit la boîte technique, le résultat durable puis la corbeille Google et ses 30 jours habituels.",
    "Aucune connexion personnelle ni garantie antivirus Hestia n’est promise.",
    "La réception seule n’active jamais l’analyse ; les deux choix persistent indépendamment."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-16T05:23:24.906Z",
    "proposalSha256": "86adc6b4636214885f0672680050cd72f498db3957e07494e90be0dc3b48b14b",
    "decisionSha256": "79069bd5ea8476f834b3fb00db09d2f770d39f6308ed5a645f03ef8393682e37",
    "contentSha256": "93571c6c4ee12cf1ffd32adf2da5adac5db37a2123444eb4abe5f1d92b083688",
    "contractSha256": "7721467cd0693880c61f50ace560634ea2564f14ef827bddf9e00b982ab88cf6"
  }
}
```

# Activer la réception et choisir séparément l’analyse

Proposition v2, non admise et non exécutée. Remplace seulement la proposition v1 du même identifiant après revue ; aucune approbation ancienne conservée.

## Actions UI

1. Ouvrir Moi puis Envoi par mail ; lire la notice Google et déplier le texte d’accusé.
2. Activer seulement Recevoir mes pièces jointes par mail ; quitter puis rouvrir le réglage.
3. Activer ensuite explicitement Analyser automatiquement les pièces reçues, puis désactiver cette analyse.

## Résultats attendus

- La notice décrit la boîte technique, le résultat durable puis la corbeille Google et ses 30 jours habituels.
- Aucune connexion personnelle ni garantie antivirus Hestia n’est promise.
- La réception seule n’active jamais l’analyse ; les deux choix persistent indépendamment.

## Autorité et limites de couverture

Besoin Issue 9 ; brief v4 préservé par v5 SHA-256 `82e93f350067e7ca4d3679af5d0c20afe9cb29456f065da11af59e7b91d407eb` ; matrice v5 S01–S37 SHA-256 `e1f93efc45d9b62c26c0f205c3aeb511d8f932420e45dff6f1f98960efd5909e` ; hand-off exact `Hestia A classer.dc.html` SHA-256 `f70004df1e58c6afb684d82fd4468858e071ed85a6bcb8643ace447cbaf36aba`. Identités et correspondance conservées dans le document référencé.

Rattachement partiel à S36. Les observations UI ne qualifient pas toutes les exigences techniques de ces scénarios. En particulier S16 (A/B/C et octets identiques), S19 (IA tardive après remplacement/rétablissement) et S21 (sortie malformée/coût inconnu) ne sont pas provoqués par cette seule fiche ; ils exigent des preuves techniques distinctes sur le candidat exact, ou une préparation et des gestes complémentaires explicitement sélectionnés. Aucun PASS de routefixture ou ancien test n’est transféré.
