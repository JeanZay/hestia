```json
{
  "schemaVersion": 1,
  "revision": 1,
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
    "artifacts/refinement/folder-tree-2026-10-08/dossier.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-2-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-3-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/brief-v1.md"
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-09T17:03:56.559Z",
    "proposalSha256": "0227277a57bc635071877863f6116281a0e530968ea698b9a1662ed7c8eed178",
    "decisionSha256": "35e1885f5df11735ec46274789f8e29dc98873d4307d996fc07db2003f320ba0",
    "contentSha256": "09bdd335882c1f77e9d610e734793cf1f6ab2e323b555fba9215c9abc257932b",
    "contractSha256": "701ff7646fd2ad0dd7ae21a3480bcdb0f62cc538fe7dc07ce2296a5aab36cad2"
  }
}
```

# Accéder à un sous-dossier partagé sans découvrir ses ancêtres privés

Proposition non approuvée et non exécutée. La valeur technique status=active indique une fiche non retirée ; elle ne vaut pas admission au catalogue.

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

- artifacts/refinement/folder-tree-2026-10-08/dossier.json
- artifacts/refinement/folder-tree-2026-10-08/round-2-answer.json
- artifacts/refinement/folder-tree-2026-10-08/round-3-answer.json

Brief candidat v1 : artifacts/refinement/folder-tree-2026-10-08/brief-v1.md ; non approuvé. Les précisions nouvelles proposées dans le brief restent à valider ; cette fiche candidate ne les transforme pas en décisions.
