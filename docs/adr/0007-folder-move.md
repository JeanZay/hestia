# ADR-0007 — Déplacements atomiques et confirmation des accès

9 octobre 2026. Implémentation locale de l’Issue #39 sur la politique commune ADR-0006. La corbeille de dossiers (#40), la publication et les déploiements restent des étapes distinctes.

## Politique et gestion

Un déplacement de dossier change le parent de sa racine ; ses descendants, originaux, propriétaires, délégations et références de gestion conservent leur identité. Un déplacement documentaire change uniquement son dossier et sa version. Aucun appel au stockage d’originaux n’est nécessaire. Les droits Consulter et Modifier sont requis aux deux extrémités, avec Déposer à destination pour un document. Aucun pouvoir de partage supplémentaire n’est requis lorsque tous les accès effectifs restent identiques.

Le plan serveur compare les capacités et les enveloppes effectives de chaque membre sur chaque élément affecté, y compris les documents supprimés individuellement encore récupérables pendant 168 heures. Il conserve les dépendances immuables, restrictions, epochs et échéances. Un gain exige une autorité réellement détenue qui couvre tout le gain, sans union artificielle de mandats ; une perte exige une autorité d’administration avant déplacement. Une extension de durée ou d’enveloppe est également un gain. Une provenance différente avec des pouvoirs équivalents ne constitue pas à elle seule un changement d’accès.

Toute partie inconnaissable ou non autorisée fait refuser l’ensemble avant de projeter les effets. Le refus ne contient aucun nom, chemin ou compteur privé issu des changements. La référence de gestion d’origine doit survivre : une destination ayant son propre gestionnaire ne remplace pas implicitement le cadre hérité de la source. Sortir de ce cadre demande d’abord une transmission explicite par le mécanisme existant. Les cadres autonomes imbriqués restent autonomes.

Les dépendances de délégations peuvent traverser la limite du sous-arbre. Le calcul vérifie donc aussi les effets extérieurs ; s’ils changent, ce déplacement est refusé intégralement plutôt que de confirmer une projection incomplète. Une dépendance traversante inchangée ne suffit pas à refuser. Les budgets de graphe et de calcul produisent un refus entier, jamais une liste tronquée.

## Transaction, échéances et reprise

Les aperçus sont des jetons opaques stockant des empreintes, liés à l’acteur, à son epoch, à l’intention exacte et à l’état exhaustif. La migration additive 009 ajoute ces aperçus et les reçus de déplacement. La confirmation recharge les droits, les versions, le contenu et l’heure réelle après acquisition du verrou de politique. Une échéance atteinte suffit à périmer l’aperçu sans modification SQL de la règle. Cycles, collisions normalisées et destinations invalides sont recontrôlés dans cette transaction.

Le placement et le reçu durable sont validés ensemble. Le reçu est lié à l’acteur, à son epoch, à une clé UUID et au corps exact incluant le jeton d’aperçu. Après une réponse incertaine, le navigateur consulte ce reçu avant toute reprise. Une répétition ne réapplique jamais l’ancien placement, même après un autre mouvement. Le résultat historique autorisé se limite à `committed` : aucune ancienne métadonnée ou droit n’est restitué, y compris après perte légitime de lecture. Les sessions, l’admission et l’epoch restent contrôlés. L’absence de clé étrangère vers la ressource évite qu’une purge rende une ancienne opération rejouable.

## Interface et preuves

L’interface reprend le hand-off Claude Design V2 validé, le sélecteur de destination et AccessImpact 1.3.1. Les changements connus d’inventaire ou de session invalident les projections privées et les réponses tardives. Le corps d’une opération incertaine reste uniquement en mémoire et ne devient pas une nouvelle autorisation à la reconnexion.

Les tests couvrent séparément la politique pure, les sessions et transactions PostgreSQL, les octets S3 et les parcours navigateur locaux. La restauration synthétique complète les tests HTTP : elle vérifie la fidélité des parentés, versions, grants, références, reçus, imputations et originaux dans une cible vide, avec droits recalculés à l’heure courante. Elle ne constitue pas une sauvegarde de foyer réel. Les rapports datés du candidat exact donnent les résultats exécutés ; ce document ne certifie pas leur réussite et ne vaut pas recette Dev.
