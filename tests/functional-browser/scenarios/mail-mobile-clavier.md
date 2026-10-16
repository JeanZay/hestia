```json
{
  "schemaVersion": 1,
  "revision": 2,
  "status": "active",
  "theme": "À classer, résumés et versions",
  "actor": "Inbox-A destinataire et utilisateur des parcours voisins",
  "rights": [
    "Consulter+Déposer sur le dossier campagne ; propriété de ses seuls réglages, brouillons et pièces."
  ],
  "preconditions": [
    "Déploiement Dev exact, commit et comptes synthétiques autorisés identifiés.",
    "Inventaire de préparation par fiche figé avant campagne : comptes exacts et rôles Inbox-A/B/C, identifiants des seuls objets synthétiques, droits effectifs, dates/états et source d’autorisation de chaque préparation. Les noms de rôle ne remplacent pas cet inventaire.",
    "Téléphone 390 px ou profil mobile documenté avec Photo disponible ; clavier/zoom 200 % contrôlables ; pièces et dossiers de campagne identifiés.",
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
  "id": "mail-mobile-clavier",
  "title": "Utiliser À classer sur téléphone et au clavier",
  "objective": "Utiliser À classer sur téléphone et au clavier",
  "references": [
    "https://github.com/JeanZay/hestia/issues/9",
    "docs/design/mail-inbox-correspondence.md",
    "docs/browser-recipe.md",
    "tests/e2e/mail-inbox.spec.ts"
  ],
  "actions": [
    "Sur téléphone 390 px, ouvrir À classer depuis la barre basse puis une fiche, son aperçu et le choix du dossier.",
    "Vérifier au clavier seul la navigation, le retour de focus et la confirmation ; examiner également le zoom 200 %.",
    "Ouvrir Moi puis Envoi par mail, revenir dans Dossiers et reprendre les parcours existants Brouillons et Recherche.",
    "Depuis À classer puis depuis Moi > Envoi par mail, toucher Photo ; vérifier que le titre Photo remplace l’écran mail puis revenir."
  ],
  "assertions": [
    "Les actions et explications restent lisibles sans débordement horizontal.",
    "Le focus est visible et revient au titre approprié ; les actions sont accessibles sans souris.",
    "Les écrans existants restent accessibles et les opérations privées ne changent pas de membre par navigation.",
    "Photo ne conserve pas la vue inbox malgré l’indication de navigation active."
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-16T05:23:25.106Z",
    "proposalSha256": "9d90e65746984677df2f06d49e0268de91e913d253804e1337685c27a787288a",
    "decisionSha256": "4baffb39de4c630fcf4f1be94d5ff04729386d1fba48532be953a11337c00739",
    "contentSha256": "81fe377224a7ccbb929539aa2b25fd1931d9ee1732268fca102bd6faaa6d7b99",
    "contractSha256": "3e373d68630472e5d08440cc2eab395e143ee3f238e7cfbc109ae5060eabac4b"
  }
}
```

# Utiliser À classer sur téléphone et au clavier

Proposition v2, non admise et non exécutée. Remplace seulement la proposition v1 du même identifiant après revue ; aucune approbation ancienne conservée.

## Actions UI

1. Sur téléphone 390 px, ouvrir À classer depuis la barre basse puis une fiche, son aperçu et le choix du dossier.
2. Vérifier au clavier seul la navigation, le retour de focus et la confirmation ; examiner également le zoom 200 %.
3. Ouvrir Moi puis Envoi par mail, revenir dans Dossiers et reprendre les parcours existants Brouillons et Recherche.
4. Depuis À classer puis depuis Moi > Envoi par mail, toucher Photo ; vérifier que le titre Photo remplace l’écran mail puis revenir.

## Résultats attendus

- Les actions et explications restent lisibles sans débordement horizontal.
- Le focus est visible et revient au titre approprié ; les actions sont accessibles sans souris.
- Les écrans existants restent accessibles et les opérations privées ne changent pas de membre par navigation.
- Photo ne conserve pas la vue inbox malgré l’indication de navigation active.

## Autorité et limites de couverture

Besoin Issue 9 ; brief v4 préservé par v5 SHA-256 `82e93f350067e7ca4d3679af5d0c20afe9cb29456f065da11af59e7b91d407eb` ; matrice v5 S01–S37 SHA-256 `e1f93efc45d9b62c26c0f205c3aeb511d8f932420e45dff6f1f98960efd5909e` ; hand-off exact `Hestia A classer.dc.html` SHA-256 `f70004df1e58c6afb684d82fd4468858e071ed85a6bcb8643ace447cbaf36aba`. Identités et correspondance conservées dans le document référencé.

Rattachement partiel à S25. Les observations UI ne qualifient pas toutes les exigences techniques de ces scénarios. En particulier S16 (A/B/C et octets identiques), S19 (IA tardive après remplacement/rétablissement) et S21 (sortie malformée/coût inconnu) ne sont pas provoqués par cette seule fiche ; ils exigent des preuves techniques distinctes sur le candidat exact, ou une préparation et des gestes complémentaires explicitement sélectionnés. Aucun PASS de routefixture ou ancien test n’est transféré.
