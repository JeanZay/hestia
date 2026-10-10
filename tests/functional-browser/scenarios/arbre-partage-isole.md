```json
{
  "schemaVersion": 1,
  "revision": 2,
  "status": "active",
  "theme": "Arborescence et récupération",
  "actor": "Membres synthétiques de la campagne Dev, désignés par leurs seuls alias dans chaque fiche",
  "preconditions": [
    "À préparer séparément avant toute campagne : déploiement Dev et commit observés, comptes synthétiques déjà autorisés et sessions privées disponibles, sélection exacte autorisée et cette version admise au catalogue.",
    "À préparer séparément : fixtures exclusives à cette fiche, préfixées par un identifiant de campagne ; noms, droits initiaux et contenu attendus consignés sans secrets. Aucun envoi de courriel ni création de compte n’est autorisé par la fiche.",
    "Design et interface du besoin implémentés et validés depuis le hand-off Claude Design. Les verbes ci-dessous décrivent des intentions UI ; ils ne prescrivent ni écran, ni composant, ni libellé inventé.",
    "Préparer AncetreSecret/ParentSecret/Enfant/temoin.pdf et ParentSecret/Frere/autre.pdf ; le partage vise un compte déjà existant, sans invitation ni courriel à envoyer."
  ],
  "cleanup": [
    "Conserver les seules fixtures de cette fiche avec leurs identifiants et leur état final dans le rapport. Une suppression ou réinitialisation ultérieure exige une préparation bornée et autorisée ; aucun reset global et aucune purge irréversible pendant ce parcours."
  ],
  "stopConditions": [
    "Prérequis absent, version Dev inconnue, session privée indisponible ou données non synthétiques : bloquer avant les gestes.",
    "Dérive du déploiement, contamination, session invalide ou mutation incertaine : arrêter et réconcilier ; aucune relance aveugle.",
    "Résultat visible contraire à une assertion : constater l’échec, sans changer la fiche ni réparer le produit dans cette tentative."
  ],
  "dependencies": [],
  "id": "arbre-partage-isole",
  "title": "Accéder à un sous-dossier partagé sans découvrir ses ancêtres privés",
  "rights": [
    "Gestionnaire peut partager Enfant ; Destinataire est un membre synthétique existant sans Voir sur les deux ancêtres privés ni sur Frere."
  ],
  "syntheticData": [
    "Noms synthétiques reconnaissables AncetreSecret, ParentSecret, Frere ; Gestionnaire et Destinataire."
  ],
  "objective": "Partager uniquement Enfant tout en conservant la confidentialité des noms, du chemin et du contenu des ancêtres.",
  "actions": [
    "Comme Gestionnaire, donner Voir sur Enfant uniquement au Destinataire au moyen du partage séparé prévu.",
    "Dans la session Destinataire, retrouver le partage par le parcours UI prévu et ouvrir Enfant puis temoin.pdf.",
    "Examiner les informations de localisation et de navigation affichées ; parcourir les emplacements accessibles de l’interface puis recharger Enfant."
  ],
  "assertions": [
    "Enfant et temoin.pdf sont accessibles au Destinataire, y compris après rechargement.",
    "Aucun nom ni chemin privé AncetreSecret/ParentSecret, ni contenu ou nom de Frere/autre.pdf, n’est révélé dans ce parcours.",
    "Le partage seul n’accorde aucun accès de navigation au contenu des ancêtres."
  ],
  "persistentEffects": [
    "Partage Voir explicite d’Enfant au Destinataire ; ancêtres et frère restent privés."
  ],
  "references": [
    "docs/adr/0006-folder-tree-base.md"
  ],
  "approval": {
    "kind": "editorial",
    "actor": "recipe_completion_review",
    "approvedAt": "2026-10-10T09:42:42.939Z",
    "proposalSha256": "7d3e5b7f8035261d81b3e55821f123aa9a7dcd6a41a7934e413cbbf08b85de2d",
    "decisionSha256": "2915e88d91608648af0414b7d3104a8ce1e714dd52d2c1dfd7f10c267ae11145",
    "contentSha256": "e9c82d17fb4d1d7435f638fc0d7641d254b0f90bd8af7feb831560199ec22023",
    "contractSha256": "d4b7d61b33b24b0696b9cdc9c0f54d35f1cc3014d1df3c1b480213eb031d727e"
  }
}
```

# Accéder à un sous-dossier partagé sans découvrir ses ancêtres privés

L’admission au catalogue est attestée par les métadonnées d’approbation. Elle ne prouve aucune exécution ; chaque nouvelle révision doit être qualifiée sur son déploiement exact.

## Situation et objectif

Partager uniquement Enfant tout en conservant la confidentialité des noms, du chemin et du contenu des ancêtres.

Critères : RIGHTS.

## Acteurs et pouvoirs

- Gestionnaire peut partager Enfant ; Destinataire est un membre synthétique existant sans Voir sur les deux ancêtres privés ni sur Frere.

## Préparations séparées et données synthétiques

- À préparer séparément avant toute campagne : déploiement Dev et commit observés, comptes synthétiques déjà autorisés et sessions privées disponibles, sélection exacte autorisée et cette version admise au catalogue.
- À préparer séparément : fixtures exclusives à cette fiche, préfixées par un identifiant de campagne ; noms, droits initiaux et contenu attendus consignés sans secrets. Aucun envoi de courriel ni création de compte n’est autorisé par la fiche.
- Design et interface du besoin implémentés et validés depuis le hand-off Claude Design. Les verbes ci-dessous décrivent des intentions UI ; ils ne prescrivent ni écran, ni composant, ni libellé inventé.
- Préparer AncetreSecret/ParentSecret/Enfant/temoin.pdf et ParentSecret/Frere/autre.pdf ; le partage vise un compte déjà existant, sans invitation ni courriel à envoyer.

- Noms synthétiques reconnaissables AncetreSecret, ParentSecret, Frere ; Gestionnaire et Destinataire.

## Actions dans l’interface

1. Comme Gestionnaire, donner Voir sur Enfant uniquement au Destinataire au moyen du partage séparé prévu.
2. Dans la session Destinataire, retrouver le partage par le parcours UI prévu et ouvrir Enfant puis temoin.pdf.
3. Examiner les informations de localisation et de navigation affichées ; parcourir les emplacements accessibles de l’interface puis recharger Enfant.

## Résultats visibles attendus

- Enfant et temoin.pdf sont accessibles au Destinataire, y compris après rechargement.
- Aucun nom ni chemin privé AncetreSecret/ParentSecret, ni contenu ou nom de Frere/autre.pdf, n’est révélé dans ce parcours.
- Le partage seul n’accorde aucun accès de navigation au contenu des ancêtres.

## Effets persistants et remise en état

- Partage Voir explicite d’Enfant au Destinataire ; ancêtres et frère restent privés.

- Conserver les seules fixtures de cette fiche avec leurs identifiants et leur état final dans le rapport. Une suppression ou réinitialisation ultérieure exige une préparation bornée et autorisée ; aucun reset global et aucune purge irréversible pendant ce parcours.

## Arrêt et limites

- Prérequis absent, version Dev inconnue, session privée indisponible ou données non synthétiques : bloquer avant les gestes.
- Dérive du déploiement, contamination, session invalide ou mutation incertaine : arrêter et réconcilier ; aucune relance aveugle.
- Résultat visible contraire à une assertion : constater l’échec, sans changer la fiche ni réparer le produit dans cette tentative.

La rétention exacte et les bornes serveur de sept jours sont à contrôler par tests automatiques distincts. Sans attente réelle et observation UI appropriée, cette fiche ne prouve pas l’expiration à sept jours ni une échéance non affichée. Aucun état interne ne remplace une assertion UI. Les fixtures indépendantes n’imposent aucun autre parcours du catalogue.

## Sources

- docs/adr/0006-folder-tree-base.md

Ces références publiques documentent les règles attendues. Les sources détaillées des accords restent privées ; cette correction ne change ni le parcours approuvé ni ses assertions et ne transfère aucun résultat historique.
