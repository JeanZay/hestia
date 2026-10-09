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
    "Préparer Source/Mobilier/Enfant/temoin.pdf et Destination/Mobilier/existant.pdf. Exception de refus Voir pour Alex sur Source/Mobilier ; accès exclusifs Ancien/Source et Nouveau/Destination."
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
  "id": "arbre-deplacer-dossier",
  "title": "Déplacer un dossier : conflit de nom, accès annoncés et exceptions conservées",
  "rights": [
    "Gestionnaire peut modifier source et destination et gérer tous les changements d’accès ; Ancien et Nouveau ont respectivement Voir hérité de Source et Destination ; Alex a Voir sur les deux parents mais une exception de refus sur Mobilier."
  ],
  "syntheticData": [
    "Source, Destination, deux Mobilier, Enfant, temoin.pdf, existant.pdf ; nom de résolution Mobilier-deplace."
  ],
  "objective": "Résoudre une collision sans fusion, annuler sans effet puis confirmer un déplacement dont les accès hérités changent et les exceptions survivent.",
  "actions": [
    "Comme Gestionnaire, demander le déplacement de Source/Mobilier vers Destination. À la collision, constater la demande d’un autre nom ; choisir Mobilier-deplace.",
    "Lire les changements d’accès annoncés avant validation, puis annuler. Recharger et vérifier source et destination.",
    "Recommencer vers Destination sous Mobilier-deplace, relire les changements d’accès et confirmer.",
    "Recharger et ouvrir Destination/Mobilier-deplace/Enfant/temoin.pdf puis Destination/Mobilier/existant.pdf ; dans les sessions Ancien, Nouveau et Alex, vérifier l’accès au dossier déplacé."
  ],
  "assertions": [
    "La collision ne fusionne ni n’écrase les Mobilier ; la résolution par autre nom est proposée.",
    "Avant confirmation, la perte de l’accès hérité d’Ancien et le gain de Nouveau sont annoncés ; l’annulation laisse noms, emplacement, contenu et droits initiaux.",
    "Après confirmation, le dossier et son sous-arbre sont uniquement à Destination/Mobilier-deplace ; le Mobilier déjà présent et son témoin sont intacts.",
    "Nouveau peut ouvrir le témoin déplacé, Ancien ne le peut plus ; Alex reste exclu par son exception malgré ses droits sur Destination."
  ],
  "persistentEffects": [
    "Dossier et sous-arbre déplacés sous Mobilier-deplace ; accès hérités de Destination et exception d’Alex conservée."
  ],
  "references": [
    "artifacts/refinement/folder-tree-2026-10-08/dossier.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-1-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-2-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-3-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/round-4-answer.json",
    "artifacts/refinement/folder-tree-2026-10-08/brief-v1.md"
  ],
  "approval": {
    "kind": "human",
    "actor": "Amaury",
    "approvedAt": "2026-10-09T17:03:55.619Z",
    "proposalSha256": "dc27966d64732f459850292b7969e9ac0d41489938b61299ea8551440a5e6aed",
    "decisionSha256": "a4e6914c9984de2c363f7891530dc30033461e51a95b9a6ba24275a175b8482f",
    "contentSha256": "f28331e7137277ca544a3e7c25d58e581a2ffa9d156ba71bd8e902385292b03e",
    "contractSha256": "3489f15df03b57f8fe1cb060a7e641882adb0f12ede9b69779a5522fd13a1830"
  }
}
```

# Déplacer un dossier : conflit de nom, accès annoncés et exceptions conservées

Proposition non approuvée et non exécutée. La valeur technique status=active indique une fiche non retirée ; elle ne vaut pas admission au catalogue.

## Situation et objectif

Résoudre une collision sans fusion, annuler sans effet puis confirmer un déplacement dont les accès hérités changent et les exceptions survivent.

Critères : MOVE, NAMES, RIGHTS, RECOVERY.

## Acteurs et pouvoirs

- Gestionnaire peut modifier source et destination et gérer tous les changements d’accès ; Ancien et Nouveau ont respectivement Voir hérité de Source et Destination ; Alex a Voir sur les deux parents mais une exception de refus sur Mobilier.

## Préparations séparées et données synthétiques

- À préparer séparément avant toute campagne : déploiement Dev et commit observés, comptes synthétiques déjà autorisés et sessions privées disponibles, sélection exacte autorisée et cette version admise au catalogue.
- À préparer séparément : fixtures exclusives à cette fiche, préfixées par un identifiant de campagne ; noms, droits initiaux et contenu attendus consignés sans secrets. Aucun envoi de courriel ni création de compte n’est autorisé par la fiche.
- Design et interface du besoin implémentés et validés depuis le hand-off Claude Design. Les verbes ci-dessous décrivent des intentions UI ; ils ne prescrivent ni écran, ni composant, ni libellé inventé.
- Préparer Source/Mobilier/Enfant/temoin.pdf et Destination/Mobilier/existant.pdf. Exception de refus Voir pour Alex sur Source/Mobilier ; accès exclusifs Ancien/Source et Nouveau/Destination.

- Source, Destination, deux Mobilier, Enfant, temoin.pdf, existant.pdf ; nom de résolution Mobilier-deplace.

## Actions dans l’interface

1. Comme Gestionnaire, demander le déplacement de Source/Mobilier vers Destination. À la collision, constater la demande d’un autre nom ; choisir Mobilier-deplace.
2. Lire les changements d’accès annoncés avant validation, puis annuler. Recharger et vérifier source et destination.
3. Recommencer vers Destination sous Mobilier-deplace, relire les changements d’accès et confirmer.
4. Recharger et ouvrir Destination/Mobilier-deplace/Enfant/temoin.pdf puis Destination/Mobilier/existant.pdf ; dans les sessions Ancien, Nouveau et Alex, vérifier l’accès au dossier déplacé.

## Résultats visibles attendus

- La collision ne fusionne ni n’écrase les Mobilier ; la résolution par autre nom est proposée.
- Avant confirmation, la perte de l’accès hérité d’Ancien et le gain de Nouveau sont annoncés ; l’annulation laisse noms, emplacement, contenu et droits initiaux.
- Après confirmation, le dossier et son sous-arbre sont uniquement à Destination/Mobilier-deplace ; le Mobilier déjà présent et son témoin sont intacts.
- Nouveau peut ouvrir le témoin déplacé, Ancien ne le peut plus ; Alex reste exclu par son exception malgré ses droits sur Destination.

## Effets persistants et remise en état

- Dossier et sous-arbre déplacés sous Mobilier-deplace ; accès hérités de Destination et exception d’Alex conservée.

- Conserver les seules fixtures de cette fiche avec leurs identifiants et leur état final dans le rapport. Une suppression ou réinitialisation ultérieure exige une préparation bornée et autorisée ; aucun reset global et aucune purge irréversible pendant ce parcours.

## Arrêt et limites

- Prérequis absent, version Dev inconnue, session privée indisponible ou données non synthétiques : bloquer avant les gestes.
- Dérive du déploiement, contamination, session invalide ou mutation incertaine : arrêter et réconcilier ; aucune relance aveugle.
- Résultat visible contraire à une assertion : constater l’échec, sans changer la fiche ni réparer le produit dans cette tentative.

La rétention exacte et les bornes serveur de sept jours sont à contrôler par tests automatiques distincts. Sans attente réelle et observation UI appropriée, cette fiche ne prouve pas l’expiration à sept jours ni une échéance non affichée. Aucun état interne ne remplace une assertion UI. Les fixtures indépendantes n’imposent aucun autre parcours du catalogue.

## Sources

- artifacts/refinement/folder-tree-2026-10-08/dossier.json
- artifacts/refinement/folder-tree-2026-10-08/round-1-answer.json
- artifacts/refinement/folder-tree-2026-10-08/round-2-answer.json
- artifacts/refinement/folder-tree-2026-10-08/round-3-answer.json
- artifacts/refinement/folder-tree-2026-10-08/round-4-answer.json

Brief candidat v1 : artifacts/refinement/folder-tree-2026-10-08/brief-v1.md ; non approuvé. Les précisions nouvelles proposées dans le brief restent à valider ; cette fiche candidate ne les transforme pas en décisions.
