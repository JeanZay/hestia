```json
{
  "schemaVersion": 1,
  "revision": 2,
  "status": "active",
  "theme": "À classer, résumés et versions",
  "actor": "Inbox-A destinataire, auteur de son commentaire privé",
  "rights": [
    "Admission à la pièce privée ; droit de dépôt sur au moins un dossier autorisé pour le vocabulaire."
  ],
  "preconditions": [
    "Déploiement Dev exact, commit et comptes synthétiques autorisés identifiés.",
    "Inventaire de préparation par fiche figé avant campagne : comptes exacts et rôles Inbox-A/B/C, identifiants des seuls objets synthétiques, droits effectifs, dates/états et source d’autorisation de chaque préparation. Les noms de rôle ne remplacent pas cet inventaire.",
    "Dictée réelle autorisée, fournisseur/modèle et plafond disponibles ; outil Browser Use capable d’entrée audio synthétique et d’attente observable, sinon sous-cas bloqué.",
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
  "id": "mail-commentaire-dictee",
  "title": "Dicter et préserver une saisie concurrente dans une pièce privée",
  "objective": "Dicter et préserver une saisie concurrente dans une pièce privée",
  "references": [
    "https://github.com/JeanZay/hestia/issues/9",
    "docs/design/mail-inbox-correspondence.md",
    "docs/browser-recipe.md",
    "tests/e2e/mail-inbox.spec.ts"
  ],
  "actions": [
    "Dans une pièce, saisir un préfixe synthétique, puis dicter la phrase synthétique et arrêter explicitement.",
    "Relire le texte ajouté à la fin et utiliser Retirer le texte dicté.",
    "Dicter à nouveau ; pendant Transcription en cours, taper une correction ; lire le résultat mis à part et choisir Ne pas utiliser.",
    "Ouvrir une autre pièce ou revenir à la file avant la fin d’une dernière transcription autorisée.",
    "Pendant une lecture d’analyse encore en attente, modifier le commentaire ; conserver le dossier manuel et observer le retour tardif."
  ],
  "assertions": [
    "Le clavier et le commentaire restent intacts pendant attente, erreur ou refus micro.",
    "Le texte concurrent est présenté séparément ; aucun écrasement ni troncature.",
    "Les suggestions deviennent périmées ; elles ne sont redemandées que par un geste explicite.",
    "Une navigation n’ajoute pas un résultat tardif à une autre pièce.",
    "Le retour tardif ne réactive pas de suggestions associées à l’ancien commentaire. Si aucune attente observable n’est disponible, ce sous-cas reste BLOCKED/NOT_RUN."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-16T05:23:24.977Z",
    "proposalSha256": "b3566630457cff36aa1dd7016657ede39a15251d67ef0655c9f64a826c7347f8",
    "decisionSha256": "6540b9c80b2bf34f94d39f748c6b33d3ee657ae631f42695c6d442b275a871a0",
    "contentSha256": "39793403937eed4e877984ab4d4c8067948697371c8b15f99259f9b9c65f271e",
    "contractSha256": "c67895858652796aca98ba3a71a31ba71e2915466ed14e72b79e7279e411abca"
  }
}
```

# Dicter et préserver une saisie concurrente dans une pièce privée

Proposition v2, non admise et non exécutée. Remplace seulement la proposition v1 du même identifiant après revue ; aucune approbation ancienne conservée.

## Actions UI

1. Dans une pièce, saisir un préfixe synthétique, puis dicter la phrase synthétique et arrêter explicitement.
2. Relire le texte ajouté à la fin et utiliser Retirer le texte dicté.
3. Dicter à nouveau ; pendant Transcription en cours, taper une correction ; lire le résultat mis à part et choisir Ne pas utiliser.
4. Ouvrir une autre pièce ou revenir à la file avant la fin d’une dernière transcription autorisée.
5. Pendant une lecture d’analyse encore en attente, modifier le commentaire ; conserver le dossier manuel et observer le retour tardif.

## Résultats attendus

- Le clavier et le commentaire restent intacts pendant attente, erreur ou refus micro.
- Le texte concurrent est présenté séparément ; aucun écrasement ni troncature.
- Les suggestions deviennent périmées ; elles ne sont redemandées que par un geste explicite.
- Une navigation n’ajoute pas un résultat tardif à une autre pièce.
- Le retour tardif ne réactive pas de suggestions associées à l’ancien commentaire. Si aucune attente observable n’est disponible, ce sous-cas reste BLOCKED/NOT_RUN.

## Autorité et limites de couverture

Besoin Issue 9 ; brief v4 préservé par v5 SHA-256 `82e93f350067e7ca4d3679af5d0c20afe9cb29456f065da11af59e7b91d407eb` ; matrice v5 S01–S37 SHA-256 `e1f93efc45d9b62c26c0f205c3aeb511d8f932420e45dff6f1f98960efd5909e` ; hand-off exact `Hestia A classer.dc.html` SHA-256 `f70004df1e58c6afb684d82fd4468858e071ed85a6bcb8643ace447cbaf36aba`. Identités et correspondance conservées dans le document référencé.

Rattachement partiel à S35. Les observations UI ne qualifient pas toutes les exigences techniques de ces scénarios. En particulier S16 (A/B/C et octets identiques), S19 (IA tardive après remplacement/rétablissement) et S21 (sortie malformée/coût inconnu) ne sont pas provoqués par cette seule fiche ; ils exigent des preuves techniques distinctes sur le candidat exact, ou une préparation et des gestes complémentaires explicitement sélectionnés. Aucun PASS de routefixture ou ancien test n’est transféré.
