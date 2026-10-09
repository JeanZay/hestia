# Recettes fonctionnelles Browser Use

La recette est une exécution par un agent dans l'interface, comme un utilisateur. Elle complète les tests automatisés locaux/CI existants, sans les remplacer. Son catalogue est préparé et maintenu pendant le développement ; son exécution exige une demande explicite d'Amaury. Aucun commit, push, déploiement, hook, CI ou appel sans sélection ne lance une recette.

## Catalogue, propositions et décisions

Les fiches de référence vivent dans `tests/functional-browser/scenarios/`. Une fiche décrit ce qu'il faut vérifier ; elle ne porte pas de dernier résultat éditable. Son identifiant reste stable, sa révision augmente lors d'une modification, et ses octets sont identifiés dans chaque campagne. Les thèmes et les listes sont dérivés des fiches, sans index métier maintenu à la main.

Les propositions, sources minimisées des décisions et campagnes vivent dans `artifacts/functional-browser/` **de la racine primaire du clone**, ignorée par Git. Ce répertoire est commun aux worktrees. Un autre clone ne récupère pas ces preuves par un simple clone Git. Conserver les preuves utiles avant tout nettoyage ou transfert autorisé ; ne pas publier les dossiers privés pour satisfaire la CI.

Une proposition comporte l'objectif, l'acteur et ses droits, l'état de départ, les données synthétiques, les étapes UI, les assertions visibles, les effets persistants, la remise en état, les conditions d'arrêt et les dépendances. Les références relient les critères attendus aux sources produit applicables. Le code ou un ancien test automatisé peut aider à trouver les écrans ; il ne décide pas du comportement métier attendu.

Présenter à Amaury une liste courte de propositions avec situation, action et résultat attendu. Une validation doit désigner les versions exactes retenues. Réutiliser un accord déjà acquis uniquement s'il couvre ces mêmes contenus. Enregistrer la décision et promouvoir seulement les propositions approuvées. La fiche devient utilisable en recette mais reste **à qualifier** : valider un scénario ne prouve pas son exécution.

La promotion conserve une provenance publique minimale et les empreintes ; les sources d'accord détaillées restent locales. La structure d'une décision et son empreinte ne prouvent pas l'authenticité d'un consentement : l'agent relit effectivement sa source utilisateur. La CI vérifie la cohérence publique sans prétendre relire des sources privées absentes.

## Correction sans changement du contrat de test

Une correction ne nécessite pas un nouvel accord uniquement si **acteur, droits, prérequis, action métier, résultat attendu, vérifications et effets sur les données restent identiques**. Conserver le diff, sa justification et une revue indépendante liée aux contenus avant/après. La mise à jour d'une aide de navigation peut convenir ; supprimer une assertion, changer de rôle ou contourner une étape par API ne convient pas. Le nombre de lignes ne décide pas. En cas de doute, présenter une nouvelle proposition à Amaury.

Chaque nouvelle révision garde sa propre identité, y compris pour une correction éditoriale. Aucun PASS historique n'est transféré vers les nouveaux octets. Pour retirer un parcours, conserver sa fiche marquée retirée et ses preuves ; les sélections futures l'excluent.

## Choisir une campagne

Après une livraison Dev et ses contrôles QA techniques, delivery propose systématiquement le choix entre les **nouvelles fiches du périmètre livré** et les tests manuels directs, selon la [gouvernance](delivery-governance.md#choix-avant-les-tests-manuels-sur-dev). Le GO Dev ne lance rien. Sans réponse, attendre le choix ; une décision déjà sourcée reste utilisable uniquement pour le même déploiement et les mêmes fiches/versions. Les anciennes fiches, y compris leurs nouvelles révisions, restent exclues de cette proposition.

Le manuel direct conserve `NOT_RUN` et les réserves, sans imposer validation ou admission des propositions. Le choix Browser Use fige les nouvelles fiches sélectionnées, fait valider celles qui le nécessitent, puis conduit la campagne et présente ses résultats avant le manuel. Après échec, blocage ou interruption, demander le choix entre traitement et poursuite manuelle explicite avec réserves. La porte interne `delivery check` contrôle ce passage en lecture seule ; elle n'exécute pas la campagne et n'intercepte pas tous les messages.

L'appel simple du skill présente les modes **Catalogue** et **Recette**. Une demande de recette sans liste exacte affiche les thèmes puis les parcours actuels, leur statut et les durées historiques disponibles, et demande lesquels jouer. Une demande par thème n'inclut pas automatiquement tous ses parcours. Si Amaury a déjà fourni la liste exacte, ne pas redemander la même décision.

Une demande explicite « tout le catalogue » sélectionne tous les parcours actuellement approuvés et non retirés. Afficher et figer cette liste sans demander une confirmation de sélection redondante ; les autorisations et prérequis restent à vérifier. Cette sélection globale n'est jamais le choix par défaut.

Figer l'ordre et les versions de cette sélection. Aucun élargissement automatique ni ajout silencieux de dépendance n'est permis. Présenter les prérequis manquants et les effets persistants avant de préparer autre chose. Une sélection longue peut être signalée ; aucun plafond arbitraire de trois tests ou de quinze minutes n'est imposé. La V1 est séquentielle. La campagne se termine par les résultats du lot choisi, pas par le lancement du lot suivant.

Les modèles ne sont pas choisis automatiquement selon les parcours. L'agent exécutant utilise son contexte courant ; enregistrer le modèle et le niveau d'effort effectifs lorsqu'une source fiable les donne, sinon indiquer leur indisponibilité. Un réglage demandé ou par défaut n'est pas une preuve du modèle réellement utilisé.

## Avant les gestes UI

Vérifier l'autorisation de la sélection, la cible **Dev**, le déploiement effectif et le commit associé, les comptes synthétiques autorisés, les prérequis et les capacités de l'outil navigateur. La version du checkout local ne remplace jamais l'identité distante. Consigner la source datée de l'observation de déploiement séparément des assertions UI. Une identité absente ou incohérente bloque ; aucune identité n'est inventée.

Une sélection de parcours ne donne aucun droit implicite de créer un compte, d'envoyer un courriel ou de toucher des données extérieures. Les éventuelles préparations techniques autorisées sont décrites séparément de l'exécution fonctionnelle. Les données du parcours sont synthétiques, nommées pour la campagne et isolées des essais d'autrui. La remise en état ne concerne que les ressources créées et autorisées pour ce parcours ; aucun reset global.

Toutes les actions métier et assertions de la recette se font dans l'interface, par l'outil Browser Use disponible et ses API documentées. Aucun SQL, appel direct à une API Hestia, interception réseau ou lecture d'état interne ne remplace une étape UI. Un contrôle d'intégrité d'un fichier synthétique réellement téléchargé peut être une preuve complémentaire déclarée ; il ne remplace pas le geste de téléchargement et son observation.

Ne jamais afficher ou enregistrer mot de passe, OTP, cookie, lien d'activation, URL signée ou secret dans une fiche, un rapport, une capture ou un log. Utiliser les mécanismes autorisés de saisie privée ; s'ils sont indisponibles, déclarer le blocage. Les captures sont facultatives et réservées aux écrans vérifiés sans informations sensibles. Les protections automatiques de contenu restent partielles.

## Pendant et après l'exécution

Avant chaque tentative, conserver son démarrage, sa fiche figée, l'identité du déploiement, le contexte navigateur et l'exécutant. Mesurer la durée murale entre début et fin, préparation et remise en état incluses ; isoler les attentes lorsque mesurables. Une tentative interrompue ne reçoit pas de durée complète inventée. Elle reste visible et ne contribue pas à une estimation de durée de parcours réussi.

Pour un défaut visible, noter **échoué**. Pour un prérequis absent, une identité inconnue ou un outil indisponible, noter **bloqué**. Les parcours non commencés restent **non exécutés**. **Réussi** exige toutes les assertions attendues et les preuves applicables à la fiche et au déploiement. Les observations rapportées sont celles de l'agent, pas une certification automatique de l'outil de stockage.

Après un résultat incertain d'une mutation, arrêter ce parcours et réconcilier l'état avant de retenter. Un échec isolé peut laisser continuer les parcours indépendants dont les prérequis sont toujours établis. Une session invalide, une contamination, une dérive de déploiement ou un état partagé incertain arrête la campagne. Ne pas réparer silencieusement le produit ou affaiblir la fiche au milieu de la recette.

Une reprise a une nouvelle tentative reliée à la précédente. Une campagne rend compte de toute sa sélection, y compris ce qui n'a pas commencé. Les rapports finalisés ne sont jamais écrasés. La vue de couverture est reconstruite depuis les rapports : dernier résultat, historique, et couverture de **ce déploiement et de cette révision**. Un ancien PASS ne devient pas un PASS actuel et un échec récent n'est pas caché par un succès plus ancien. Les durées sont contextualisées par modèle, effort et résultat, sans moyenne trompeuse de versions ou contextes inconnus.

L'outillage V1 arrête conservativement toute la campagne lorsqu'une mutation est incertaine, même si certains parcours paraissent indépendants. Après rapprochement de l'état, leur exécution nécessite une nouvelle campagne explicitement sélectionnée ; le rapport précédent conserve ceux qui n'ont pas été joués.

## Raccordement à la livraison

Pour les futurs besoins produit, Refinement prépare les propositions avec les critères et les accords concernés. Delivery examine l'impact du changement avec son relecteur indépendant : inchangé, nouveau, modifié, retiré ou sans impact justifié. Il garde les propositions en attente visibles, même lorsque Dev est livré avec cette réserve. Un critère bloquant du lot ne devient pas facultatif grâce à cette réserve.

Les nouveaux lots portent la politique d'analyse d'impact ; les lots historiques ne sont pas modifiés rétroactivement. Le contrôle du catalogue est ajouté à la suite locale et à la CI, sans démarrer Browser Use. L'analyse d'impact locale identifie ses entrées et sa revue ; la vérification et la clôture contrôlent ces pièces. Les sources ignorées absentes d'une CI restent non vérifiées. Le contrôle de forme ne prouve ni couverture métier complète, ni consentement, ni réussite UI.

Une évolution de ce dispositif est une maintenance du harnais : contrat technique et revue directe, sans imposer un passage par Refinement produit. Les accords GitHub, Dev et Production conservent leurs limites. La V1 de cette méthode ne comporte aucune recette Production.
