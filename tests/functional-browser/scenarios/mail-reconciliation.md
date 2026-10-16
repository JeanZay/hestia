```json
{
  "schemaVersion": 1,
  "revision": 2,
  "status": "active",
  "theme": "À classer, résumés et versions",
  "actor": "Inbox-A destinataire et déposant",
  "rights": [
    "Consulter+Déposer sur le seul dossier prévu ; aucune autre mutation pendant l’incertitude."
  ],
  "preconditions": [
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
  "id": "mail-reconciliation",
  "title": "Vérifier un classement dont la réponse est incertaine",
  "objective": "Vérifier un classement dont la réponse est incertaine",
  "references": [
    "https://github.com/JeanZay/hestia/issues/9",
    "docs/design/mail-inbox-correspondence.md",
    "docs/browser-recipe.md",
    "tests/e2e/mail-inbox.spec.ts"
  ],
  "actions": [
    "Ouvrir la pièce synthétique réservée, choisir le dossier et confirmer le classement sous le défaut de réponse préparé.",
    "Lire Résultat incertain, relever uniquement l’identité non sensible du parcours et l’état visible.",
    "Arrêter immédiatement la campagne avec environmentState mutation-uncertain et conserver le rapport ; ne pas naviguer, vérifier ou retenter dans cette même campagne."
  ],
  "assertions": [
    "Aucune seconde mutation n’est lancée automatiquement après la réponse perdue.",
    "L’écran propose Vérifier le résultat sans réessai aveugle.",
    "La suite est suspendue : la proposition mail-reconciliation-reprise exige une nouvelle sélection et une nouvelle campagne après réconciliation autorisée."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-16T05:23:25.053Z",
    "proposalSha256": "95c9683eab6043ac7be21b48b457e10264a4538a1b3e388c5620922eacfffac9",
    "decisionSha256": "5c60f9b5ebcf62a9959363f8a094bd1252a89fd274058a3d88e6896c6bb49cd3",
    "contentSha256": "2308c311492a05903cb890dc22606a59a082f07e3902d10e8757e3e2590f7f69",
    "contractSha256": "e87501d4e0df9b14a9900bf0f10d13a3d1efce151020abec029f94f6c4942e34"
  }
}
```

# Vérifier un classement dont la réponse est incertaine

Proposition v2, non admise et non exécutée. Remplace seulement la proposition v1 du même identifiant après revue ; aucune approbation ancienne conservée.

## Actions UI

1. Ouvrir la pièce synthétique réservée, choisir le dossier et confirmer le classement sous le défaut de réponse préparé.
2. Lire Résultat incertain, relever uniquement l’identité non sensible du parcours et l’état visible.
3. Arrêter immédiatement la campagne avec environmentState mutation-uncertain et conserver le rapport ; ne pas naviguer, vérifier ou retenter dans cette même campagne.

## Résultats attendus

- Aucune seconde mutation n’est lancée automatiquement après la réponse perdue.
- L’écran propose Vérifier le résultat sans réessai aveugle.
- La suite est suspendue : la proposition mail-reconciliation-reprise exige une nouvelle sélection et une nouvelle campagne après réconciliation autorisée.

## Autorité et limites de couverture

Besoin Issue 9 ; brief v4 préservé par v5 SHA-256 `82e93f350067e7ca4d3679af5d0c20afe9cb29456f065da11af59e7b91d407eb` ; matrice v5 S01–S37 SHA-256 `e1f93efc45d9b62c26c0f205c3aeb511d8f932420e45dff6f1f98960efd5909e` ; hand-off exact `Hestia A classer.dc.html` SHA-256 `f70004df1e58c6afb684d82fd4468858e071ed85a6bcb8643ace447cbaf36aba`. Identités et correspondance conservées dans le document référencé.

Rattachement partiel à S12, S30. Les observations UI ne qualifient pas toutes les exigences techniques de ces scénarios. En particulier S16 (A/B/C et octets identiques), S19 (IA tardive après remplacement/rétablissement) et S21 (sortie malformée/coût inconnu) ne sont pas provoqués par cette seule fiche ; ils exigent des preuves techniques distinctes sur le candidat exact, ou une préparation et des gestes complémentaires explicitement sélectionnés. Aucun PASS de routefixture ou ancien test n’est transféré.
