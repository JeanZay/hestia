# Gouvernance de développement et de livraison

Statut : fondation locale du 12 septembre 2026. Ce document est la source unique des règles de livraison pour Codex, Claude Code et les contributeurs. Les autres fichiers y renvoient ; aucune règle documentaire ne vaut mécanisme technique déjà déployé.

## Autorisations et périmètre

Amaury ne code pas et ne relit pas les modifications. Il décrit le besoin en français, teste une preview sur Dev et prend les décisions produit. Les agents fournissent la qualité technique, des contrôles reproductibles et une revue indépendante.

La fondation initiale autorise la conception, les fichiers locaux, une application locale et des tests sur données synthétiques. Elle autorise le travail directement dans le dépôt initial et la délégation de sous-tâches bornées. Ces actions locales réversibles ne nécessitent pas de confirmations répétées.

Elle exclut explicitement : push, création de dépôt distant, publication, déploiement Dev ou Production, données familiales réelles, secrets, coûts supplémentaires, services payants et lancement de Claude Code. La publication et la licence seront des décisions finales sur un résultat concret. Une autorisation future n'étend pas implicitement son périmètre à d'autres environnements, destinataires ou dépenses.

Pour tout lot ultérieur, le contrat consigne les actions déjà autorisées, les données utilisables, les exclusions et les critères d'acceptation. Une question n'est nécessaire que si une décision indispensable manque, si la demande franchit le périmètre autorisé ou si une protection effective refuse une opération nécessaire. Ne pas transformer une règle de prudence en interdiction universelle des actions déjà autorisées.

## Deux environnements durables

| Frontière | Usage | Preuve requise |
| --- | --- | --- |
| Local | Développement synthétique et contrôles reproductibles, sans valeur d'environnement livré | Commandes, résultats et candidat exact |
| Dev | Environnement durable authentifié et séparé, previews et recette utilisateur | Déploiement/commit, configuration sans valeurs de secrets, migrations, QA automatique et recette |
| Production | Instance familiale réellement utilisée | GO explicite d'Amaury sur ce candidat, preuves Dev, sauvegarde/restauration et procédure de retour |

QA est l'ensemble des contrôles et la recette sur Dev ; ce n'est pas un troisième environnement. Les identités, bases, stockages, sauvegardes et secrets de Dev et Production doivent être séparés. Les noms de branches, hébergeurs, protections distantes et pipelines de déploiement seront configurés dans un lot autorisé. Leur simple mention dans ce dépôt ne les rend pas actifs.

## Contrats, délégation et preuves

1. Inspecter le dépôt et préserver l'existant. Identifier le besoin, l'Issue GitHub lorsqu'elle existe, les chemins concernés et les risques. Chaque lot utilise une branche et un worktree isolés ; seule cette fondation initiale bénéficie de l'autorisation de travail dans le dossier local initial.
2. Décrire le lot courant avec `harness/contracts/task-template.json` ; `foundation.json` constitue l'exemple réel de la fondation. Ces contrats ne sont pas un backlog.
3. Déléguer les tâches indépendantes avec une responsabilité et des chemins explicites. Éviter deux auteurs sur les mêmes fichiers. Le coordinateur intègre les résultats et vérifie les limites entre composants.
4. Exécuter les contrôles appropriés : garde-fous, lint, types, tests de comportements, construction, puis parcours navigateur lorsque l'interface change. Ne pas écrire des tests qui recopient simplement l'implémentation. Un prérequis absent est consigné comme non exécuté ; ne pas fabriquer une réussite.
5. Figer le candidat, demander la revue indépendante, résoudre ses constats et faire vérifier les corrections. Revalider toute partie modifiée après les contrôles.
6. Produire un rapport daté et compréhensible, distinguant local, Dev et Production. Conserver les preuves minimales sans secrets ni données privées.

Le schéma `harness/contracts/task-contract.schema.json` décrit le contrat. Les modèles de preuves et de revue sont dans `harness/templates/`. Ils organisent la traçabilité ; ils ne déclenchent ni ne certifient une exécution. Aucun moteur automatique de validation des contrats ou d'approbation de livraison n'est implémenté dans ce premier lot.

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

Le hook `pre-push` refuse tous les pushes dans cette fondation. Il n'existe pas d'interrupteur d'environnement censé transformer ce refus en approbation. Après décision de publication, l'évolution de ce hook et l'installation des protections distantes feront partie d'un changement explicite et relu. Aucun mécanisme local ne saurait authentifier à lui seul une décision humaine.

La CI versionnée est préparée pour un futur dépôt distant. Tant qu'aucun service distant ne l'a exécutée, annoncer seulement les contrôles locaux réellement passés. Après autorisation, configurer des contrôles requis, des règles de branche, la revue exigée et les permissions minimales. Un fichier YAML ne prouve pas que ces protections sont actives.

## Backlog, livraison et décisions

GitHub Issues est l'unique registre du travail ; GitHub Projects en présente les vues. `harness/github-issue-proposals.json` est une proposition ponctuelle d'import, sans statut vivant, assignation ni synchronisation. Aucun script ne la publie. Après publication autorisée, la supprimer ou l'archiver comme preuve d'import et conserver les numéros/liens dans GitHub. Aucun backlog Markdown n'est créé.

Présenter le bilan avec une date et des preuves : **livré localement** pour les fichiers et comportements vérifiés ; **proposé pour GitHub** pour les éléments non publiés ; **bloqué** seulement pour un obstacle avéré ; **différé** pour les capacités hors lot. Ne pas présenter une limitation prévue comme une panne ni un test local comme une réussite de Production.

Le GO Production est distinct et explicite. Il identifie le commit, le déploiement Dev essayé, les migrations, les contrôles automatisés, la recette, les risques acceptés et le retour arrière. Toute modification du candidat requiert une nouvelle vérification proportionnée avant de solliciter le GO sur sa version actualisée.
