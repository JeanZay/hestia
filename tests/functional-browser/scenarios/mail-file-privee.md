```json
{
  "schemaVersion": 1,
  "revision": 2,
  "status": "active",
  "theme": "À classer, résumés et versions",
  "actor": "Inbox-A destinataire ; Inbox-B autre membre actif et Inbox-C administrateur du foyer",
  "rights": [
    "Inbox-A seul propriétaire des pièces privées ; aucun partage de document encore effectué.",
    "Inbox-B et Inbox-C ne possèdent aucun accès aux pièces privées de Inbox-A."
  ],
  "preconditions": [
    "Déploiement Dev exact, commit et comptes synthétiques autorisés identifiés.",
    "Inventaire de préparation par fiche figé avant campagne : comptes exacts et rôles Inbox-A/B/C, identifiants des seuls objets synthétiques, droits effectifs, dates/états et source d’autorisation de chaque préparation. Les noms de rôle ne remplacent pas cet inventaire.",
    "Deux pièces explicites A-PDF et A-PHOTO d’un même mail, plus signature CID et lien, livrées à Inbox-A ; aucune arrivée à Inbox-B/Inbox-C.",
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
  "id": "mail-file-privee",
  "title": "Retrouver les pièces d’un mail dans une file privée",
  "objective": "Retrouver les pièces d’un mail dans une file privée",
  "references": [
    "https://github.com/JeanZay/hestia/issues/9",
    "docs/design/mail-inbox-correspondence.md",
    "docs/browser-recipe.md",
    "tests/e2e/mail-inbox.spec.ts"
  ],
  "actions": [
    "Ouvrir Dossiers puis À classer pour le membre destinataire synthétique.",
    "Observer les deux pièces explicites du même mail et leur provenance, puis ouvrir chaque fiche sans aperçu.",
    "Se déconnecter ; connecter un autre membre synthétique, y compris administrateur ; ouvrir À classer."
  ],
  "assertions": [
    "La file du destinataire regroupe les pièces par mail et compte chaque pièce active une seule fois.",
    "Les images inline/signature et liens sont absents des pièces et du compteur.",
    "Les pièces et le contexte du premier membre ne sont visibles pour aucun autre membre."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-16T05:23:24.924Z",
    "proposalSha256": "0218569534a092a52573c0dbe3cfa4362aa39bd7b1267fd08f187da0f406b8d0",
    "decisionSha256": "992d2df3724a331bd5a30456db9011925b08340f42440bedfe7be984f176a1c2",
    "contentSha256": "bbad484c425b2a09bfc1da4f80e73ba6d468e7f4e3155a42dfdc9ccfe95551e8",
    "contractSha256": "8c6a708488c44de2b7fa77d2488991b2a540adcbf33b099080b2f5aa5e2e5b6e"
  }
}
```

# Retrouver les pièces d’un mail dans une file privée

Proposition v2, non admise et non exécutée. Remplace seulement la proposition v1 du même identifiant après revue ; aucune approbation ancienne conservée.

## Actions UI

1. Ouvrir Dossiers puis À classer pour le membre destinataire synthétique.
2. Observer les deux pièces explicites du même mail et leur provenance, puis ouvrir chaque fiche sans aperçu.
3. Se déconnecter ; connecter un autre membre synthétique, y compris administrateur ; ouvrir À classer.

## Résultats attendus

- La file du destinataire regroupe les pièces par mail et compte chaque pièce active une seule fois.
- Les images inline/signature et liens sont absents des pièces et du compteur.
- Les pièces et le contexte du premier membre ne sont visibles pour aucun autre membre.

## Autorité et limites de couverture

Besoin Issue 9 ; brief v4 préservé par v5 SHA-256 `82e93f350067e7ca4d3679af5d0c20afe9cb29456f065da11af59e7b91d407eb` ; matrice v5 S01–S37 SHA-256 `e1f93efc45d9b62c26c0f205c3aeb511d8f932420e45dff6f1f98960efd5909e` ; hand-off exact `Hestia A classer.dc.html` SHA-256 `f70004df1e58c6afb684d82fd4468858e071ed85a6bcb8643ace447cbaf36aba`. Identités et correspondance conservées dans le document référencé.

Rattachement partiel à S01, S03, S10, S23. Les observations UI ne qualifient pas toutes les exigences techniques de ces scénarios. En particulier S16 (A/B/C et octets identiques), S19 (IA tardive après remplacement/rétablissement) et S21 (sortie malformée/coût inconnu) ne sont pas provoqués par cette seule fiche ; ils exigent des preuves techniques distinctes sur le candidat exact, ou une préparation et des gestes complémentaires explicitement sélectionnés. Aucun PASS de routefixture ou ancien test n’est transféré.
