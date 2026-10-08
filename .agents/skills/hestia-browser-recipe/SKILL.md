---
name: hestia-browser-recipe
description: Maintenir le catalogue de parcours Hestia et conduire une campagne Browser Use explicitement demandée, sur sélection de parcours et avec preuves par version. Ne lance aucune recette lors du développement, d'un commit ou d'un déploiement.
---

# Recettes Hestia à la demande

Lire [la procédure de recette](../../../docs/browser-recipe.md) avant toute action et les [accords de livraison](../../../docs/delivery-governance.md). Cette skill ne lance pas d'agent en arrière-plan. Son invocation seule affiche les choix ; elle ne donne ni sélection, ni accès Dev, ni accord sur une fiche.

## Choisir le mode

- **Catalogue** : lister les thèmes et parcours dérivés des fiches, proposer ou corriger un scénario. Présenter situation/action/résultat attendu, conserver l'accord exact avant promotion. Toute correction sans changement de contrat doit porter son diff, sa justification et sa revue indépendante. Ne jamais lancer un navigateur pour une simple maintenance documentaire.
- **Recette** : demander les parcours précis après affichage des thèmes et durées historiques. Une liste exacte déjà donnée suffit ; une demande par thème appelle la liste de ses parcours. Une demande explicite « tout le catalogue » sélectionne tous les parcours actuellement approuvés et non retirés : afficher et figer cette liste sans confirmation redondante. Figer la sélection et les versions, sans ajout automatique de dépendance ; tout le catalogue n'est jamais le choix par défaut.

## Conduire une recette autorisée

1. Établir la cible Dev et sa version effective, les prérequis synthétiques et les capacités du navigateur. La référence au code local n'est pas une identité de déploiement. Une identité inconnue ou un accès privé indisponible bloque.
2. Ouvrir une campagne et figer les fiches du worktree appelant dans les preuves de la racine primaire. Les commandes locales documentées dans [la référence des commandes](references/commands.md) n'ouvrent pas le navigateur et ne font aucun appel modèle.
3. Exécuter séquentiellement avec Browser Use, en suivant les API réellement documentées de l'outil disponible. Actions métier et assertions sont UI ; ne pas substituer des appels API, SQL ou lectures d'état interne. Séparer les préparations autorisées et les preuves techniques complémentaires.
4. Conserver une tentative par passage : horaires, durée, modèle/effort effectifs ou non disponibles, version, assertions, observations et limites. Protéger secrets et captures. Ne pas prétendre avoir effectué une étape non observée.
5. Après un défaut, enregistrer l'échec ; après un résultat incertain, réconcilier avant toute reprise. Arrêter la campagne si session, déploiement ou données partagées deviennent incertains. Une correction produit ou du contrat reste une action distincte.
6. Finaliser un rapport qui couvre toute la sélection : réussi, échoué, bloqué ou non exécuté. Conserver les tentatives précédentes. Afficher résultats, durées contextualisées, réserves et reste à jouer ; aucune poursuite automatique au-delà de la sélection.

Les données et comptes sont synthétiques. Une fiche proposée, une validation humaine du scénario, une réussite de contrôle structurel et une réussite UI sont quatre états distincts. Une nouvelle version ne récupère jamais silencieusement un ancien PASS. Les anciens tests API/Playwright ne deviennent pas des recettes Browser Use par import de leur résultat.

La V1 n'impose ni trois tests ni quinze minutes ; elle ne parallélise pas les navigateurs, ne choisit pas automatiquement les modèles et ne prend pas en charge la Production.
