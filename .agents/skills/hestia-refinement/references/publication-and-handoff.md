# Publication et passage à delivery

Lire cette référence à partir du plan d'Issues, pour une reprise après interruption ou pour préparer un handoff. La [gouvernance](../../../../docs/delivery-governance.md) conserve les règles d'autorisation et de livraison ; le [schéma du dossier](../../../../harness/contracts/refinement.schema.json) fixe les champs acceptés.

## Préparer un accord vérifiable

1. Vérifier le brief validé et présenter le plan exact : titres, corps, cibles, création ou réutilisation, dépendances, ordre, liens, labels et changements Project. Inclure exactement une mutation `publish-brief` avec `payload` égal au JSON `{body: renderBrief(dossier)}` : le commentaire conserve le brief complet, ses nuances, ses décisions et son empreinte. Pour `create-issue` et `update-issue`, générer ensuite le corps final avec `renderIssueBody(issue, dossier)`, exporté par `scripts/refinement-check.mjs` : `issue.body` n'est que l'introduction ; le rendu ajoute critères, périmètre contractuel, version du brief et destination du commentaire. Le `payload` contient le JSON exact `{title, body, labels}` à publier. Pour une destination à créer, son titre et sa clé la désignent dans l'aperçu ; le handoff portera ensuite l'URL exacte relue. La référence durable ne peut pas se limiter à des identifiants de critères présents uniquement dans un brouillon local.
2. Relire les cibles et le backlog depuis GitHub. Conserver date, URLs et identité des contenus observés afin de distinguer le plan de l'état distant. Une ancienne capture locale ne suffit pas pour autoriser une modification actuelle.
3. Exécuter le validateur et calculer les digests. L'empreinte du brief lie version du format, politique de données, destinations GitHub, source, nuances et brief ; celle de publication lie cette empreinte et le plan. Utiliser la sortie du calculateur, sans reconstituer manuellement ces valeurs. Présenter le contenu lisible et sa version à l'utilisateur ; ne pas lui demander de relire un fichier JSON pour choisir.
4. Obtenir l'accord explicite de publication sur ce plan exact. Conserver auteur, date, source de la réponse et digest approuvé. Vérifier la décision dans la session utilisateur ou sa source authentique, en plus du champ JSON : `explicit: true` ne prouve rien à lui seul.

Le GO de conception de la skill, l'autorisation générale antérieure du dépôt, un GO de brief ou un GO d'exécution locale ne remplacent pas cet accord sur le plan. Réutiliser un accord toujours applicable sans le redemander ; si le brief ou le plan change, montrer le delta et demander seulement les décisions et accords désormais nécessaires. Un changement du brief invalide son accord et celui du plan qui en dépend ; un changement du seul plan n'invalide pas les décisions produit inchangées.

Pour `publish-brief`, `issueKey: null` désigne un commentaire sur l'Issue existante `target` du même dépôt. Pour commenter une Issue créée ou mise à jour dans ce plan, `issueKey` porte sa clé et `target` l'URL du dépôt ; sa véritable URL sera résolue depuis le reçu. Le plan n'exécute aucune de ces opérations. Les dates du dossier sont en UTC avec suffixe `Z` et au plus trois décimales de seconde.

## Publier et reprendre sans doublonner

Juste avant la mutation, relire les cibles et vérifier l'absence de divergence avec le plan approuvé. Publier uniquement les mutations approuvées, à l'aide des outils GitHub disponibles. Aucun script de ce harnais ne publie ni ne boucle automatiquement sur le réseau.

Créer ou mettre à jour les Issues suivant `plan.order`, en tenant compte des opérations déjà vérifiées. Résoudre ensuite leurs clés locales en URLs réelles à partir des reçus relus, publier le commentaire du brief approuvé lorsque sa cible existe, puis établir les relations approuvées. Chaque dépendance interne est portée par une mutation `link-dependency` avec `relation: "blocked-by"` ; relire la relation native GitHub après son application. Les mutations décrivent le résultat autorisé ; leur ordre de stockage n'est pas une liste à exécuter aveuglément avant que les cibles existent.

Après chaque opération, relire depuis GitHub le résultat. Le reçu relie `mutationKey`, URL, `readAt` et digest calculé de cette mutation ; `evidence` décrit la concordance du résultat observé avec le contenu approuvé, avec une empreinte du contenu distant si utile. Vérifier aussi les dépendances, liens et changements Project approuvés. La réponse de création seule ne prouve pas que le plan entier est publié. Conserver les reçus partiels à l'étape `publication-authorized` ; n'annoncer `published` que lorsque toutes les mutations prévues ont leur reçu vérifié.

Après erreur, réponse ambiguë, interruption ou constat de contenu modifié :

- arrêter les nouvelles mutations et conserver les résultats certains ;
- relire les cibles, rechercher les Issues déjà créées et rapprocher chaque mutation du plan ;
- ne jamais rejouer une création dont l'absence n'est pas établie ; ne pas écraser une modification concurrente ;
- reprendre seulement les opérations restantes dont la cible et le contenu correspondent toujours à l'accord ; sinon préparer le delta exact et obtenir l'accord requis avant de l'exécuter.

Ne pas inventer de reçu ni supprimer des résultats partiels pour simplifier la reprise. Un incident distant ne justifie pas de reproduire le backlog dans un fichier suivi.

Après publication, GitHub redevient la seule référence du travail. Le commentaire `publish-brief` relu conserve le brief approuvé ; son reçu porte l'URL exacte `#issuecomment-…` et vérifie la bonne Issue cible. Conserver localement, si utile, un reçu figé contenant URLs, digests et constats datés ; ne pas y maintenir statuts, priorités, critères ou nouvelles décisions. Les futures évolutions passent par un nouveau delta approuvé sur GitHub. Réduire les brouillons temporaires devenus inutiles selon le périmètre local autorisé, sans supprimer de preuves utiles ni de travail d'autrui.

## Definition of Ready et handoff

`ready` s'applique aux seules Issues explicitement sélectionnées pour le handoff, pas à l'ensemble du plan. Avant de les transmettre, vérifier :

- Issue publiée, URL et contenu relus ; accord de brief et publication toujours applicables au contenu concerné ;
- résultat vertical borné, inclus/exclus, critères positifs/négatifs et preuves réalisables ;
- aucune décision ou question bloquante non résolue pour ce lot ; risques et sujets différés identifiés ;
- dépendances réellement satisfaites, avec preuves datées au bon niveau, et non simplement présentes dans un ordre topologique ;
- ADR, prototype ou spike bloquant terminé et conclusion exploitable, si le brief l'exige ;
- contrat de livraison cohérent avec cette Issue et actions d'exécution effectivement autorisées.

Une Issue fermée ou un prédécesseur placé plus tôt ne prouve pas que sa capacité existe au niveau requis : lire la preuve pertinente, avec candidat et environnement. Une dépendance à une capacité Dev nécessite une preuve Dev ; une preuve locale n'y suffit pas. Pour une étude préparatoire, son résultat publié et validé peut constituer le prérequis, sans promettre une fonctionnalité implémentée.

Le format actuel porte les questions et préparations bloquantes au niveau du brief : une question bloquante non répondue empêche `brief-validated` et les étapes suivantes ; une préparation bloquante inachevée empêche tout handoff dans ce dossier. Pour livrer l'étude qui doit justement lever cette incertitude, cadrer un dossier distinct borné à cette étude, avec son propre brief et ses critères de sortie ; garder les Issues de fonctionnalité planifiées. Ne pas inventer une réponse, déclarer l'étude terminée ou retirer un blocage uniquement pour faire passer le validateur.

Préparer le [contrat de tâche](../../../../harness/contracts/task-template.json) à partir de l'Issue relue : `githubIssue`, objectif, périmètre, chemins possédés, données autorisées, critères, contrôles et revue indépendante. Relier les preuves de dépendances au handoff dans le dossier. Son champ `briefReference` porte l'URL exacte du commentaire relu et l'empreinte du brief approuvé. Transmettre cette référence à delivery pour que l'agent retrouve les décisions et nuances sans dépendre du dossier temporaire. Ne pas recopier le GO GitHub comme autorisation de développer, déployer ou dépenser ; consulter les autorisations d'exécution déjà applicables et signaler uniquement celles qui manquent réellement.

Exécuter `node scripts/refinement-check.mjs --contract <contrat.json>` et revalider le dossier contenant le handoff. Confier ensuite le lot à [hestia-delivery](../../hestia-delivery/SKILL.md) avec URL, contrat, décisions utiles, dépendances satisfaites et limites. Les autres Issues restent planifiées jusqu'à satisfaction de leurs propres prérequis.
