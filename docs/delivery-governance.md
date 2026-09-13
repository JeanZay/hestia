# Gouvernance de développement et de livraison

Statut : gouvernance actualisée pour la publication autorisée du 12 septembre 2026. Ce document est la source unique des règles de livraison pour Codex, Claude Code et les contributeurs. Les autres fichiers y renvoient ; aucune règle documentaire ne vaut mécanisme technique déjà déployé.

## Autorisations et périmètre

Amaury ne code pas et ne relit pas les modifications. Il décrit le besoin en français, teste une preview sur Dev et prend les décisions produit. Les agents fournissent la qualité technique, des contrôles reproductibles et une revue indépendante.

La fondation initiale autorise la conception, les fichiers locaux, une application locale et des tests sur données synthétiques. Elle autorise le travail directement dans le dépôt initial et la délégation de sous-tâches bornées. Ces actions locales réversibles ne nécessitent pas de confirmations répétées.

La fondation initiale excluait push, dépôt distant et licence appliquée. Après sa vérification, Amaury a explicitement autorisé Apache-2.0 et la publication publique sur le compte GitHub connecté. Le contrat [publication-2026-09-12](../harness/contracts/publication-2026-09-12.json) borne cette nouvelle autorisation à `JeanZay/hestia`, ses Issues, son Project, ses réglages et les contrôles gratuits associés. Aucun déploiement Dev ou Production, donnée familiale, secret, coût supplémentaire, service payant ou lancement Claude n'est autorisé par ce lot.

Pour tout lot ultérieur, le contrat consigne les actions déjà autorisées, les données utilisables, les exclusions et les critères d'acceptation. Une question n'est nécessaire que si une décision indispensable manque, si la demande franchit le périmètre autorisé ou si une protection effective refuse une opération nécessaire. Ne pas transformer une règle de prudence en interdiction universelle des actions déjà autorisées.

## Deux environnements durables

| Frontière | Usage | Preuve requise |
| --- | --- | --- |
| Local | Développement synthétique et contrôles reproductibles, sans valeur d'environnement livré | Commandes, résultats et candidat exact |
| Dev | Environnement durable authentifié et séparé, previews et recette utilisateur | Déploiement/commit, configuration sans valeurs de secrets, migrations, QA automatique et recette |
| Production | Instance familiale réellement utilisée | GO explicite d'Amaury sur ce candidat, preuves Dev, sauvegarde/restauration et procédure de retour |

QA est l'ensemble des contrôles et la recette sur Dev ; ce n'est pas un troisième environnement. Les identités, bases, stockages, sauvegardes et secrets de Dev et Production doivent être séparés. `main` est la branche publique par défaut du code ; sa mise à jour ne déploie aucune application. Le flux cible de développement utilise `develop` avant recette Dev, mais aucun environnement distant ni pipeline de déploiement n'est créé par la publication.

## Contrats, délégation et preuves

1. Inspecter le dépôt et préserver l'existant. Identifier le besoin, l'Issue GitHub lorsqu'elle existe, les chemins concernés et les risques. Chaque lot utilise une branche et un worktree isolés ; seule cette fondation initiale bénéficie de l'autorisation de travail dans le dossier local initial.
2. Décrire le lot courant avec `harness/contracts/task-template.json` ; `foundation.json` constitue l'exemple réel de la fondation. Ces contrats ne sont pas un backlog.
3. Déléguer les tâches indépendantes avec une responsabilité et des chemins explicites. Éviter deux auteurs sur les mêmes fichiers. Le coordinateur intègre les résultats et vérifie les limites entre composants.
4. Exécuter les contrôles appropriés : garde-fous, lint, types, tests de comportements, construction, puis parcours navigateur lorsque l'interface change. Ne pas écrire des tests qui recopient simplement l'implémentation. Un prérequis absent est consigné comme non exécuté ; ne pas fabriquer une réussite.
5. Figer le candidat, demander la revue indépendante, résoudre ses constats et faire vérifier les corrections. Revalider toute partie modifiée après les contrôles.
6. Produire un rapport daté et compréhensible, distinguant local, Dev et Production. Conserver les preuves minimales sans secrets ni données privées.

Le schéma `harness/contracts/task-contract.schema.json` décrit le contrat. Les modèles de preuves et de revue sont dans `harness/templates/`. Ils organisent la traçabilité ; ils ne déclenchent ni ne certifient une exécution. Le contrôle local `node scripts/refinement-check.mjs --contract <contrat.json>` valide désormais sa structure ; il ne vérifie pas la réalité des autorisations ni la réussite des contrôles déclarés.

## Refinement et passage à la livraison

Le skill local [hestia-refinement](../.agents/skills/hestia-refinement/SKILL.md) prépare l'amont d'un lot. Le responsable produit pilote les choix ; l'agent conserve les formulations, reformule et challenge les hypothèses, contradictions, risques et exclusions. Les décisions produit, UX, sécurité et architecture restent distinctes. Un accord sur l'outillage ou sur une méthode ne répond pas implicitement aux questions produit du cas étudié.

Les étapes sont exploration, brief candidat, brief validé, plan d'Issues proposé, publication autorisée, publication relue et Issues prêtes pour delivery. Le brief et le plan exacts reçoivent des accords distincts et sourcés. Une modification de leur contenu impose de revoir l'accord affecté ; le silence, une recommandation d'agent, une réussite de test ou un champ JSON ne remplacent jamais la décision d'Amaury. Avant toute écriture GitHub, vérifier l'accord réel de la session et relire l'état distant pour détecter les changements et doublons. Une publication partielle exige une réconciliation avant toute reprise.

Les dossiers de refinement sont des préparations temporaires, locales, synthétiques, normalement sous `artifacts/refinement/`. Ils ne suivent pas la livraison en parallèle de GitHub. Après publication, le brief de référence et les Issues vivent sur GitHub ; seul un reçu figé des URLs, empreintes et observations est utile pour attester l'opération. Les ADR durables gardent leur place dans `docs/adr/`. Ne jamais copier d'échanges privés ni de données familiales dans les éléments publiables.

Le schéma `harness/contracts/refinement.schema.json` et `scripts/refinement-check.mjs` vérifient la structure, les empreintes, les dépendances, leur ordre et la cohérence du handoff. Le contrôle scanne explicitement les contenus des dossiers désignés, y compris ignorés par Git, avec la détection partielle du guard. Il fonctionne sans réseau et sans écriture GitHub. Il ne prouve ni la qualité des choix produit, ni le caractère véritablement vertical d'une Issue, ni la présence réelle des objets et preuves distants ; ces points demandent lecture, jugement et revue indépendante.

Une Issue est prête à exécuter lorsque son résultat et ses exclusions sont bornés, ses critères et preuves sont observables, les questions bloquantes de son périmètre sont résolues, ses dépendances ont des preuves de satisfaction, les décisions préparatoires nécessaires sont prises et ses données et actions sont autorisées. Sa publication seule ne satisfait aucune dépendance. Le handoff contient l'URL réelle relue, les références au brief et aux décisions, puis un contrat `hestia-delivery` cohérent avec le résultat, les critères, les preuves et le périmètre. Les chemins sont attribués lors de la préparation du worktree. L'autorisation d'exécuter ce lot est vérifiée séparément de celle de publier des Issues ; Dev et Production gardent leurs frontières propres.

## Revue indépendante du candidat exact

Le relecteur ne doit pas être l'auteur des changements examinés. Lui donner un contexte propre : demande initiale, critères, contraintes, fichiers du candidat et commandes de test, sans lui fournir le raisonnement défensif de l'auteur ni un verdict à confirmer. Pour un sous-agent, utiliser un contexte neuf lorsque l'outil le permet. Un autre agent est indépendant de l'implémentation ; cela ne constitue pas une garantie absolue contre les erreurs communes aux modèles.

La preuve contient :

- auteur, relecteur, outil et modèle effectivement connus, date UTC et déclaration de contexte propre ;
- commit SHA s'il existe et état du worktree ; à défaut ou en présence de modifications locales, manifeste trié `chemin + SHA-256 des octets` et SHA-256 du manifeste ;
- périmètre complet examiné, commandes exécutées par le relecteur, constats avec gravité et emplacement, verdict PASS / CHANGES_REQUIRED / BLOCKED, limites ;
- correspondance du candidat final avec le candidat relu. Un changement matériel invalide la revue de la partie modifiée. Pour les seuls rapports ajoutés après revue, décrire explicitement cette exclusion et vérifier qu'aucun autre octet n'a changé.

Un auteur peut exécuter ses tests ; il ne peut pas produire lui-même le verdict indépendant. Une revue planifiée, non exécutée, interrompue ou sans identité de candidat reste `NOT_PERFORMED` ou `BLOCKED` et ne vaut jamais PASS.

Pour ce lot local, une revue Codex indépendante est requise. La contre-revue Claude n'est pas effectuée ni exigée pour conclure ce seul lot local autorisé. Tout lancement Claude ultérieur nécessite une autorisation explicite portant sur l'usage externe et son coût éventuel ; utiliser exclusivement `claude-opus-5` et vérifier le modèle effectif sans substitution. Une CLI installée ou un modèle demandé n'est pas une preuve du modèle effectivement utilisé.

## Contrôles techniques réellement présents

Le guard Node et les hooks Git fournis détectent certains chemins privés, formats de clés et motifs de jetons dans le contenu texte. Le hook de commit lit les octets indexés, et non une copie modifiée ensuite dans le worktree. Il refuse les liens symboliques, y compris dans les répertoires parents, pour que des fichiers extérieurs ne soient pas lus à travers eux. Le scan rapporte les chemins, lignes et catégories sans les valeurs suspectes détectées ; les motifs reconnus dans les noms de fichiers sont aussi masqués. Les fichiers binaires sont signalés comme non inspectés.

Ces hooks sont volontaires et contournables par un propriétaire du clone. Le guard est une détection partielle ; il ne fournit ni DLP exhaustive, ni preuve d'absence de données personnelles, ni audit de l'historique. Les fichiers ignorés ne sont pas inspectés. La minimisation, la revue et le secret scanning distant futur restent nécessaires.

Après l'autorisation explicite de publication, le hook `pre-push` contrôle les commits sortants, y compris les contenus introduits puis supprimés dans cette plage. Un premier push examine leur historique accessible. Les erreurs ou limites de scan empêchent un PASS ; le hook ne décide pas de l'autorisation humaine et reste une détection partielle. Aucun mécanisme local ne saurait authentifier à lui seul une décision humaine.

La CI utilise uniquement des runners GitHub standard dans le dépôt public. Les caches Actions et l'upload d'artifacts persistants sont désactivés pour éviter un coût de stockage ; les résultats restent dans les logs et résumés des jobs. Aucun secret ou workflow de déploiement n'est nécessaire. Une réussite distante n'est annoncée qu'après lecture des résultats du SHA concerné.

La contribution passe par une PR, des contrôles requis et la résolution des conversations. Le nombre minimal d'approbations GitHub humaines est zéro tant que le projet n'a qu'un mainteneur : GitHub n'autorise pas son auteur à s'auto-approuver et cette contrainte ne doit pas bloquer toute évolution. La revue indépendante du harnais reste obligatoire et doit être liée au candidat ; elle n'est pas présentée comme une approbation GitHub humaine. Les protections doivent interdire force push et suppression de main, s'appliquer au mainteneur et être vérifiées par l'API. Consigner leur état effectif dans les preuves de publication ; le texte présent ne constitue pas leur activation.

## Backlog, livraison et décisions

GitHub Issues est l'unique registre du travail ; GitHub Projects en présente les vues. Les douze propositions de la fondation sont importées une fois après autorisation puis retirées des fichiers de travail. Un reçu d'import conserve seulement leurs clés et liens, sans état, priorité ou critères à maintenir en parallèle. Aucun backlog Markdown n'est créé.

Présenter le bilan avec une date et des preuves : **livré localement** pour les fichiers et comportements vérifiés ; **proposé pour GitHub** pour les éléments non publiés ; **bloqué** seulement pour un obstacle avéré ; **différé** pour les capacités hors lot. Ne pas présenter une limitation prévue comme une panne ni un test local comme une réussite de Production.

Le GO Production est distinct et explicite. Il identifie le commit, le déploiement Dev essayé, les migrations, les contrôles automatisés, la recette, les risques acceptés et le retour arrière. Toute modification du candidat requiert une nouvelle vérification proportionnée avant de solliciter le GO sur sa version actualisée.
