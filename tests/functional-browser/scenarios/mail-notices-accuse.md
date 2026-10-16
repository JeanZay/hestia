```json
{
  "schemaVersion": 1,
  "revision": 2,
  "status": "active",
  "theme": "À classer, résumés et versions",
  "actor": "Inbox-A destinataire de mails techniques synthétiques",
  "rights": [
    "Propriété de ses seules notices privées ; aucun droit de mail/boîte personnelle."
  ],
  "preconditions": [
    "Déploiement Dev exact, commit et comptes synthétiques autorisés identifiés.",
    "Inventaire de préparation par fiche figé avant campagne : comptes exacts et rôles Inbox-A/B/C, identifiants des seuls objets synthétiques, droits effectifs, dates/états et source d’autorisation de chaque préparation. Les noms de rôle ne remplacent pas cet inventaire.",
    "Envois zéro PJ, inline seules, toutes refusées, accusés connus et inconnus préexistants ; un mail garde une pièce active pour le témoin de masquage interdit.",
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
  "id": "mail-notices-accuse",
  "title": "Comprendre un envoi sans pièce admise et son accusé",
  "objective": "Comprendre un envoi sans pièce admise et son accusé",
  "references": [
    "https://github.com/JeanZay/hestia/issues/9",
    "docs/design/mail-inbox-correspondence.md",
    "docs/browser-recipe.md",
    "tests/e2e/mail-inbox.spec.ts"
  ],
  "actions": [
    "Ouvrir À classer après les mails synthétiques de campagne zéro PJ, inline seules et toutes PJ refusées.",
    "Lire chaque motif connu et état d’accusé, puis masquer le mail sans pièce en attente ni récupérable.",
    "Ouvrir le mail de campagne contenant encore une pièce en attente et vérifier ses informations."
  ],
  "assertions": [
    "Aucun document ni compteur positif n’est inventé pour les envois sans pièce admise.",
    "Les causes inconnues ne sont pas remplacées par une explication inventée.",
    "L’accusé envoyé, en préparation, non envoyé ou inconnu est distinct de l’état IA.",
    "Masquer ne retire jamais une pièce active ou récupérable ni le contexte dont elle dépend."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-16T05:23:25.088Z",
    "proposalSha256": "a77e616ebb7903f23737a7803b951aea8a92e9c8270932cf4f59a2105d553575",
    "decisionSha256": "05c1e81e9be8dd16b25f353d3daf119670ac044d7a5a535bf1e6e5718a689131",
    "contentSha256": "2a791c87fa8548dff6a547293d3b2cfefb9a0cc5c40b8aee459a21807c4d7dee",
    "contractSha256": "dd70a4d935779ef11ad848fbc415f430a08afcba474f78358d26c43e92bf23ca"
  }
}
```

# Comprendre un envoi sans pièce admise et son accusé

Proposition v2, non admise et non exécutée. Remplace seulement la proposition v1 du même identifiant après revue ; aucune approbation ancienne conservée.

## Actions UI

1. Ouvrir À classer après les mails synthétiques de campagne zéro PJ, inline seules et toutes PJ refusées.
2. Lire chaque motif connu et état d’accusé, puis masquer le mail sans pièce en attente ni récupérable.
3. Ouvrir le mail de campagne contenant encore une pièce en attente et vérifier ses informations.

## Résultats attendus

- Aucun document ni compteur positif n’est inventé pour les envois sans pièce admise.
- Les causes inconnues ne sont pas remplacées par une explication inventée.
- L’accusé envoyé, en préparation, non envoyé ou inconnu est distinct de l’état IA.
- Masquer ne retire jamais une pièce active ou récupérable ni le contexte dont elle dépend.

## Autorité et limites de couverture

Besoin Issue 9 ; brief v4 préservé par v5 SHA-256 `82e93f350067e7ca4d3679af5d0c20afe9cb29456f065da11af59e7b91d407eb` ; matrice v5 S01–S37 SHA-256 `e1f93efc45d9b62c26c0f205c3aeb511d8f932420e45dff6f1f98960efd5909e` ; hand-off exact `Hestia A classer.dc.html` SHA-256 `f70004df1e58c6afb684d82fd4468858e071ed85a6bcb8643ace447cbaf36aba`. Identités et correspondance conservées dans le document référencé.

Rattachement partiel à S22, S29, S33. Les observations UI ne qualifient pas toutes les exigences techniques de ces scénarios. En particulier S16 (A/B/C et octets identiques), S19 (IA tardive après remplacement/rétablissement) et S21 (sortie malformée/coût inconnu) ne sont pas provoqués par cette seule fiche ; ils exigent des preuves techniques distinctes sur le candidat exact, ou une préparation et des gestes complémentaires explicitement sélectionnés. Aucun PASS de routefixture ou ancien test n’est transféré.
