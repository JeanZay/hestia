# Audit du paradigme agentique — 15 septembre 2026

Constat daté et choix de conception du harnais, pas un backlog à maintenir. Le contrat est [agentic-lifecycle-2026-09-15](../../harness/contracts/agentic-lifecycle-2026-09-15.json). Les résultats effectivement exécutés et revues du candidat sont conservés séparément, sans transformer ce document en preuve de PASS.

## État constaté

- Main local et distant : 8aa3eb01e21f561dc099d0cf9ca50afa73b1906e. Fondation synthétique ; les dernières règles locales ne sont pas toutes intégrées.
- Branche refinement-driving : 374bbda88e6717696fa1c4469ffa8142f2aa9549. [PR #13](https://github.com/JeanZay/hestia/pull/13) ouverte et non fusionnée ; contrôles Windows, Ubuntu et Docker réussis sur ce SHA, lus le 15 septembre. Cela ne prouve rien sur le nouveau candidat.
- Branche locale design-governance : 4336ba0300873827674a84fb8babb7cfe922e7ca, divergente ; règles Claude Design, droits indépendants de l'âge et prochaine action explicite non réunies avec la découverte des skills.
- [Project Hestia — Développement](https://github.com/users/JeanZay/projects/3) : 12 Issues ; #1 Done, #2–12 Todo, aucune In Progress lors de la lecture. Pas de champ de priorité ni d'itération dans les champs lus. Les automatisations internes du Project n'ont pas été inspectées.
- [Issue #2](https://github.com/JeanZay/hestia/issues/2) : pas de sous-Issue, de commentaire ou de dépendance native au moment de l'audit. Sa formulation distante ne reflète pas le brief v2 et conserve les anciens profils adulte/enfant facultatifs.
- Le dossier v2 et les revues locales existent dans des répertoires ignorés, mais aucun point d'entrée systématique ne les retrouvait. Le seul accord reçu le 15 septembre sur le brief porte explicitement sur son périmètre.

## Écarts et réponse locale

| Écart démontré | Réponse du candidat |
| --- | --- |
| GO brief suivi automatiquement du découpage | Engagement distinct, besoin large conservé, contrôle plan juste-à-temps |
| Une recommandation ou rubrique vide pouvait survivre jusqu'à ready V1 | Qualification additive : scénarios, décisions, risques, préparations et revue du cahier des charges |
| Source différente imposée entre publication et exécution | Portées distinctes vérifiées ; une même réponse explicite peut couvrir les deux |
| Dossier ignoré non retrouvé / non contrôlé par la suite normale | Chemin actif fixé dans AGENTS, références bornées et empreintes, découverte par verify |
| Rapports et manifestes écrasés / ancien manifeste associé à un nouvel échec | Runs séparés, création exclusive, identité avant/après, résumé cohérent du même run |
| Contexte dispersé entre branches | Réunion locale des règles, skills découvrables, design et protocole de reprise |
| Travail technique reporté implicitement sur Amaury | Responsabilités agents, revue des exigences et du code, recette d'usage explicite |

Les contrôles conservent le format et les digests historiques V1. Le checkpoint ajoute une qualification ; il ne convertit aucun accord ancien en engagement ou en permission d'implémenter. Les copies locales du brief v2, de son annexe et du dossier gardent les octets d'origine.

## Frontières résiduelles

Le harnais organise le travail des agents ; il ne contient pas d'ordonnanceur autonome ni de robot de publication GitHub. La tenue du backlog exige des lectures effectives, des écritures autorisées et une tâche agent en cours. Aucun changement Project ou Issue n'est réalisé par cet audit.

Un contrôle local ne certifie ni authenticité du consentement, ni exhaustivité du besoin, ni état GitHub en direct. Les modèles synthétiques testent la mécanique, pas le produit. Les hashes avant/après ne détectent pas une modification transitoire restaurée entre ces observations.

Le checkpoint actif et ses sources sont ignorés par Git. Une nouvelle tâche du même worktree peut les relire ; un autre clone doit recevoir les sources inspectées ou utiliser leurs références GitHub une fois la publication autorisée. La reprise depuis main ne bénéficie des nouvelles règles qu'après intégration explicite et vérifiée.

Aucune authentification, UI, sous-Issue réelle, publication, fusion, dépense, donnée familiale, opération Dev ou Production ne fait partie du candidat. Les décisions futures se prennent au moment utile sur GitHub et dans les échanges produit, pas dans une liste d'actions parallèle ici.
