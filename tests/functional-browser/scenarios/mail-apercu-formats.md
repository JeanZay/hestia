```json
{
  "schemaVersion": 1,
  "revision": 2,
  "status": "active",
  "theme": "À classer, résumés et versions",
  "actor": "Inbox-A destinataire et déposant",
  "rights": [
    "Consulter+Déposer sur le dossier campagne ; Consulter+Exporter pour relire ensuite le document opaque."
  ],
  "preconditions": [
    "Déploiement Dev exact, commit et comptes synthétiques autorisés identifiés.",
    "Inventaire de préparation par fiche figé avant campagne : comptes exacts et rôles Inbox-A/B/C, identifiants des seuls objets synthétiques, droits effectifs, dates/états et source d’autorisation de chaque préparation. Les noms de rôle ne remplacent pas cet inventaire.",
    "Pièces A-PDF et A-OPAQUE admises ; une préparation technique a vérifié les formats et l’intégrité de leurs octets.",
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
  "id": "mail-apercu-formats",
  "title": "Consulter une pièce à la demande et ranger un format sans aperçu",
  "objective": "Consulter une pièce à la demande et ranger un format sans aperçu",
  "references": [
    "https://github.com/JeanZay/hestia/issues/9",
    "docs/design/mail-inbox-correspondence.md",
    "docs/browser-recipe.md",
    "tests/e2e/mail-inbox.spec.ts"
  ],
  "actions": [
    "Ouvrir une pièce synthétique PDF/image ; demander Voir l’aperçu puis le fermer.",
    "Ouvrir la pièce synthétique opaque explicitement jointe ; lire l’absence d’aperçu.",
    "Choisir un dossier de campagne autorisé, vérifier le chemin et confirmer le classement du fichier opaque."
  ],
  "assertions": [
    "L’aperçu du PDF/image correspond au fichier synthétique attendu.",
    "L’absence d’aperçu explique la possibilité de classer puis télécharger.",
    "Le format opaque est rangé sans aperçu fictif ni tentative d’ouverture HTML."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-16T05:23:24.941Z",
    "proposalSha256": "e3908adea61e606abbd87d2859d98749387339964c5cc5394b1d71c03389de3e",
    "decisionSha256": "57a97693e53ca0adb3ed2d13da9687e3eaffa7d0c6a620a809df5146adb36cc4",
    "contentSha256": "6131ac9cc3c94a01f3bd6773028a49c4866689cc0c94045150520b771ab52fc9",
    "contractSha256": "6e8a029b33bd305171ee50f627bbd1e92adc926eb84054367b53c2f1710018ed"
  }
}
```

# Consulter une pièce à la demande et ranger un format sans aperçu

Proposition v2, non admise et non exécutée. Remplace seulement la proposition v1 du même identifiant après revue ; aucune approbation ancienne conservée.

## Actions UI

1. Ouvrir une pièce synthétique PDF/image ; demander Voir l’aperçu puis le fermer.
2. Ouvrir la pièce synthétique opaque explicitement jointe ; lire l’absence d’aperçu.
3. Choisir un dossier de campagne autorisé, vérifier le chemin et confirmer le classement du fichier opaque.

## Résultats attendus

- L’aperçu du PDF/image correspond au fichier synthétique attendu.
- L’absence d’aperçu explique la possibilité de classer puis télécharger.
- Le format opaque est rangé sans aperçu fictif ni tentative d’ouverture HTML.

## Autorité et limites de couverture

Besoin Issue 9 ; brief v4 préservé par v5 SHA-256 `82e93f350067e7ca4d3679af5d0c20afe9cb29456f065da11af59e7b91d407eb` ; matrice v5 S01–S37 SHA-256 `e1f93efc45d9b62c26c0f205c3aeb511d8f932420e45dff6f1f98960efd5909e` ; hand-off exact `Hestia A classer.dc.html` SHA-256 `f70004df1e58c6afb684d82fd4468858e071ed85a6bcb8643ace447cbaf36aba`. Identités et correspondance conservées dans le document référencé.

Rattachement partiel à S06, S07. Les observations UI ne qualifient pas toutes les exigences techniques de ces scénarios. En particulier S16 (A/B/C et octets identiques), S19 (IA tardive après remplacement/rétablissement) et S21 (sortie malformée/coût inconnu) ne sont pas provoqués par cette seule fiche ; ils exigent des preuves techniques distinctes sur le candidat exact, ou une préparation et des gestes complémentaires explicitement sélectionnés. Aucun PASS de routefixture ou ancien test n’est transféré.
