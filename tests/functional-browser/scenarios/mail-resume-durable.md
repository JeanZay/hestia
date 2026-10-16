```json
{
  "schemaVersion": 1,
  "revision": 2,
  "status": "active",
  "theme": "À classer, résumés et versions",
  "actor": "Inbox-A déposant ; Inbox-B lecteur du document partagé",
  "rights": [
    "Inbox-A : Consulter+Déposer et capacité de préparer Capture.",
    "Inbox-B : Consulter sur le document final partagé, aucun accès au mail/commentaire privés."
  ],
  "preconditions": [
    "Déploiement Dev exact, commit et comptes synthétiques autorisés identifiés.",
    "Inventaire de préparation par fiche figé avant campagne : comptes exacts et rôles Inbox-A/B/C, identifiants des seuls objets synthétiques, droits effectifs, dates/états et source d’autorisation de chaque préparation. Les noms de rôle ne remplacent pas cet inventaire.",
    "PDF/document synthétique source identifié, secret fictif placé seulement dans mail/commentaire, ancien document sans résumé, dépôt et Capture isolés ; IA et coûts autorisés.",
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
  "id": "mail-resume-durable",
  "title": "Suivre le résumé documentaire au-delà du rangement",
  "objective": "Suivre le résumé documentaire au-delà du rangement",
  "references": [
    "https://github.com/JeanZay/hestia/issues/9",
    "docs/design/mail-inbox-correspondence.md",
    "docs/browser-recipe.md",
    "tests/e2e/mail-inbox.spec.ts"
  ],
  "actions": [
    "Ranger la pièce de campagne pendant Résumé en préparation puis ouvrir le document rangé.",
    "Attendre le résultat visible du résumé et le comparer au contenu du fichier synthétique.",
    "Ouvrir le document depuis un second compte ayant Consulter, puis ouvrir un ancien document sans résumé.",
    "Réaliser un dépôt et une Capture synthétiques autorisés ; observer Enregistré puis leurs fiches."
  ],
  "assertions": [
    "Le document reste utilisable pendant l’attente.",
    "Le résumé est étiqueté IA et décrit uniquement le fichier en 200 caractères au plus ; ni secret synthétique du mail ni commentaire ne sont repris.",
    "Le résumé suit les accès du document et sa révision exacte ; l’ancien document sans résumé ne reçoit pas de remplissage automatique.",
    "Dépôt, Capture et mail présentent les états disponibles ou indisponibles sans les présenter comme un échec de rangement."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-16T05:23:25.072Z",
    "proposalSha256": "cffaf6555bf0443bd912cc7abe1ea37f2c36aaad21916ac7878bfa3a2e60aa52",
    "decisionSha256": "4005b8b32b560e5e706dad6b9e313f1f5ccad06fd4dad9dd911bc4e09187b535",
    "contentSha256": "f32a8e360157a9b39ef1a78d0b08d812a04a84fc9190304373fa7510a59f9cba",
    "contractSha256": "ef7e142ab1a3034290db2d95917c31a4ba8cb266b6e0e44e76524d016ec60760"
  }
}
```

# Suivre le résumé documentaire au-delà du rangement

Proposition v2, non admise et non exécutée. Remplace seulement la proposition v1 du même identifiant après revue ; aucune approbation ancienne conservée.

## Actions UI

1. Ranger la pièce de campagne pendant Résumé en préparation puis ouvrir le document rangé.
2. Attendre le résultat visible du résumé et le comparer au contenu du fichier synthétique.
3. Ouvrir le document depuis un second compte ayant Consulter, puis ouvrir un ancien document sans résumé.
4. Réaliser un dépôt et une Capture synthétiques autorisés ; observer Enregistré puis leurs fiches.

## Résultats attendus

- Le document reste utilisable pendant l’attente.
- Le résumé est étiqueté IA et décrit uniquement le fichier en 200 caractères au plus ; ni secret synthétique du mail ni commentaire ne sont repris.
- Le résumé suit les accès du document et sa révision exacte ; l’ancien document sans résumé ne reçoit pas de remplissage automatique.
- Dépôt, Capture et mail présentent les états disponibles ou indisponibles sans les présenter comme un échec de rangement.

## Autorité et limites de couverture

Besoin Issue 9 ; brief v4 préservé par v5 SHA-256 `82e93f350067e7ca4d3679af5d0c20afe9cb29456f065da11af59e7b91d407eb` ; matrice v5 S01–S37 SHA-256 `e1f93efc45d9b62c26c0f205c3aeb511d8f932420e45dff6f1f98960efd5909e` ; hand-off exact `Hestia A classer.dc.html` SHA-256 `f70004df1e58c6afb684d82fd4468858e071ed85a6bcb8643ace447cbaf36aba`. Identités et correspondance conservées dans le document référencé.

Rattachement partiel à S18, S19, S20, S21. Les observations UI ne qualifient pas toutes les exigences techniques de ces scénarios. En particulier S16 (A/B/C et octets identiques), S19 (IA tardive après remplacement/rétablissement) et S21 (sortie malformée/coût inconnu) ne sont pas provoqués par cette seule fiche ; ils exigent des preuves techniques distinctes sur le candidat exact, ou une préparation et des gestes complémentaires explicitement sélectionnés. Aucun PASS de routefixture ou ancien test n’est transféré.
