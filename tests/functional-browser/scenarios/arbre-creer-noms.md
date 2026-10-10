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
    "Préparer une branche synthétique de dix niveaux N01 à N10 et une branche parallèle Autre, sans limite métier supposée ; dix est une fixture pour franchir dix niveaux, jamais un plafond du produit. Conserver un dossier existant Repere avec un document témoin dans N10."
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
  "id": "arbre-creer-noms",
  "title": "Créer une branche profonde et traiter les homonymes",
  "rights": [
    "Éditeur dispose de Modifier sur les parents testés, sans pouvoir de gestion des accès ; Lecteur dispose seulement de Voir."
  ],
  "syntheticData": [
    "Branche N01/…/N10, Autre, Repere/temoin.pdf ; nouveaux dossiers N11, N12 et Notes."
  ],
  "objective": "Créer et retrouver des sous-dossiers au-delà de dix niveaux, préserver les existants et vérifier que seul le parent définit le périmètre d’un homonyme.",
  "actions": [
    "Comme Éditeur, ouvrir N10 par la navigation UI et créer N11 puis N12 à l’intérieur.",
    "Créer Notes dans N12, puis demander un deuxième Notes dans ce même parent et abandonner après le refus.",
    "Créer Notes dans Autre, puis recharger et rouvrir les deux Notes, N11/N12 et Repere/temoin.pdf.",
    "Consulter les droits visibles des nouveaux sous-dossiers puis, dans la session Lecteur, tenter leur modification par les commandes disponibles."
  ],
  "assertions": [
    "N11 et N12 sont créés et retrouvés à leur bon emplacement ; aucun plafond métier à dix niveaux ne bloque ce cas fini.",
    "Un seul Notes existe sous N12 ; le conflit n’altère rien et l’autre Notes sous Autre existe séparément.",
    "Repere et son témoin restent inchangés et accessibles.",
    "Éditeur ne reçoit aucun pouvoir de gestion des accès du seul fait de la création ; Lecteur conserve Voir sans acquérir Modifier."
  ],
  "persistentEffects": [
    "N11, N12 et deux Notes sont créés uniquement dans les branches de la fiche ; aucun doublon ni changement des accès demandé."
  ],
  "references": [
    "docs/adr/0006-folder-tree-base.md"
  ],
  "approval": {
    "kind": "editorial",
    "actor": "recipe_completion_review",
    "approvedAt": "2026-10-10T09:42:41.403Z",
    "proposalSha256": "739fbc5442f7a3fa92812fcd23fd13ce6e5b331b0f28d78b7b9df630ccdc4933",
    "decisionSha256": "6a52946abe0ab04d20d3153452201121ce80051ddd05d056b04a659ca220b3b2",
    "contentSha256": "a81154d6c67153fbaf959d422135f6cc7e60149e5288abac6aaf3f32837e5107",
    "contractSha256": "8957a640d85245a1385f0bb0fe04a9fb502e025ecd49d3cdd860816367b39840"
  }
}
```

# Créer une branche profonde et traiter les homonymes

L’admission au catalogue est attestée par les métadonnées d’approbation. Elle ne prouve aucune exécution ; chaque nouvelle révision doit être qualifiée sur son déploiement exact.

## Situation et objectif

Créer et retrouver des sous-dossiers au-delà de dix niveaux, préserver les existants et vérifier que seul le parent définit le périmètre d’un homonyme.

Critères : TREE, NAMES, RIGHTS.

## Acteurs et pouvoirs

- Éditeur dispose de Modifier sur les parents testés, sans pouvoir de gestion des accès ; Lecteur dispose seulement de Voir.

## Préparations séparées et données synthétiques

- À préparer séparément avant toute campagne : déploiement Dev et commit observés, comptes synthétiques déjà autorisés et sessions privées disponibles, sélection exacte autorisée et cette version admise au catalogue.
- À préparer séparément : fixtures exclusives à cette fiche, préfixées par un identifiant de campagne ; noms, droits initiaux et contenu attendus consignés sans secrets. Aucun envoi de courriel ni création de compte n’est autorisé par la fiche.
- Design et interface du besoin implémentés et validés depuis le hand-off Claude Design. Les verbes ci-dessous décrivent des intentions UI ; ils ne prescrivent ni écran, ni composant, ni libellé inventé.
- Préparer une branche synthétique de dix niveaux N01 à N10 et une branche parallèle Autre, sans limite métier supposée ; dix est une fixture pour franchir dix niveaux, jamais un plafond du produit. Conserver un dossier existant Repere avec un document témoin dans N10.

- Branche N01/…/N10, Autre, Repere/temoin.pdf ; nouveaux dossiers N11, N12 et Notes.

## Actions dans l’interface

1. Comme Éditeur, ouvrir N10 par la navigation UI et créer N11 puis N12 à l’intérieur.
2. Créer Notes dans N12, puis demander un deuxième Notes dans ce même parent et abandonner après le refus.
3. Créer Notes dans Autre, puis recharger et rouvrir les deux Notes, N11/N12 et Repere/temoin.pdf.
4. Consulter les droits visibles des nouveaux sous-dossiers puis, dans la session Lecteur, tenter leur modification par les commandes disponibles.

## Résultats visibles attendus

- N11 et N12 sont créés et retrouvés à leur bon emplacement ; aucun plafond métier à dix niveaux ne bloque ce cas fini.
- Un seul Notes existe sous N12 ; le conflit n’altère rien et l’autre Notes sous Autre existe séparément.
- Repere et son témoin restent inchangés et accessibles.
- Éditeur ne reçoit aucun pouvoir de gestion des accès du seul fait de la création ; Lecteur conserve Voir sans acquérir Modifier.

## Effets persistants et remise en état

- N11, N12 et deux Notes sont créés uniquement dans les branches de la fiche ; aucun doublon ni changement des accès demandé.

- Conserver les seules fixtures de cette fiche avec leurs identifiants et leur état final dans le rapport. Une suppression ou réinitialisation ultérieure exige une préparation bornée et autorisée ; aucun reset global et aucune purge irréversible pendant ce parcours.

## Arrêt et limites

- Prérequis absent, version Dev inconnue, session privée indisponible ou données non synthétiques : bloquer avant les gestes.
- Dérive du déploiement, contamination, session invalide ou mutation incertaine : arrêter et réconcilier ; aucune relance aveugle.
- Résultat visible contraire à une assertion : constater l’échec, sans changer la fiche ni réparer le produit dans cette tentative.

La rétention exacte et les bornes serveur de sept jours sont à contrôler par tests automatiques distincts. Sans attente réelle et observation UI appropriée, cette fiche ne prouve pas l’expiration à sept jours ni une échéance non affichée. Aucun état interne ne remplace une assertion UI. Les fixtures indépendantes n’imposent aucun autre parcours du catalogue.

## Sources

- docs/adr/0006-folder-tree-base.md

Ces références publiques documentent les règles attendues. Les sources détaillées des accords restent privées ; cette correction ne change ni le parcours approuvé ni ses assertions et ne transfère aucun résultat historique.
