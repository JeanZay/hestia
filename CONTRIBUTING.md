# Contribuer à Hestia

Hestia est ouvert aux contributions sous [licence Apache-2.0](LICENSE). Contribuer uniquement des éléments dont vous pouvez accorder les droits nécessaires ; identifier l'origine et la licence des ressources tierces ajoutées. Ne fournir aucun document familial réel, secret ou code provenant du projet privé d'animation.

## Préparer une modification

Lire [AGENTS.md](AGENTS.md) et [la gouvernance](docs/delivery-governance.md). Rattacher le travail à une [GitHub Issue](https://github.com/JeanZay/hestia/issues) et au GitHub Project du dépôt. Ils constituent l'unique backlog ; le contrat de tâche décrit seulement le lot courant et ses critères. Ne pas créer de backlog Markdown ou réactiver le fichier d'import ponctuel.

Inspecter l'état Git, préserver les changements existants et travailler dans une branche et un worktree isolés. Les auteurs en parallèle se répartissent explicitement les chemins. Préparer le contrat à partir de `harness/contracts/task-template.json` avec l'autorisation applicable et les critères vérifiables.

Installer les dépendances avec `npm ci --ignore-scripts`, puis suivre les commandes du [README](README.md). Le contrôle complet est `npm run verify`. Les preuves indiquent chaque commande réellement exécutée, son résultat, sa date et le candidat concerné. Les contrôles absents de l'environnement restent « non exécutés ».

## Activer les hooks locaux

Depuis la racine du dépôt :

```sh
git config core.hooksPath .githooks
```

Cette configuration est volontaire, locale à ce clone et n'est pas appliquée automatiquement. Git doit pouvoir exécuter les hooks ; sous Unix, conserver leur bit exécutable (`chmod +x .githooks/pre-commit .githooks/pre-push`). Git for Windows utilise son interpréteur shell. Node doit être disponible sur le PATH.

- `pre-commit` inspecte le contenu indexé pour détecter certains secrets et chemins privés.
- `pre-push` inspecte les commits sortants selon les règles du guard ; un contrôle réussi ne constitue pas une autorisation de livraison.

Le scan peut aussi être exécuté sans installer les hooks : `node scripts/guard.mjs` pour les fichiers suivis et nouveaux non ignorés, ou `node scripts/guard.mjs --staged` pour l'index. Ces deux modes n'inspectent pas tout l'historique. Le contrôle ne prouve pas l'absence de secrets ou de données personnelles et ne vérifie pas le contenu binaire. Les hooks peuvent être désactivés par celui qui possède le clone ; voir la gouvernance pour leur périmètre exact et celui des protections GitHub.

## Ouvrir une pull request

Proposer les changements vers `main` par une [pull request](https://github.com/JeanZay/hestia/pulls), en utilisant le modèle fourni. Relier l'Issue, expliquer le comportement obtenu et joindre les résultats, le candidat exact ainsi que les limites. La CI fournit ses propres résultats dans GitHub ; ne pas les déduire d'un contrôle local.

Avant intégration, une personne ou un agent distinct de l'auteur effectue une revue indépendante en contexte propre sur ce candidat. Le relecteur reçoit le besoin, les contraintes, les fichiers et les commandes de contrôle, examine le diff et consigne ses constats, vérifications et verdict. Une modification matérielle après revue exige une relecture proportionnée. Une revue non exécutée ou sans identification du candidat ne vaut jamais PASS.

Amaury ne relit pas le code : les preuves techniques restent à la charge des contributeurs et relecteurs. Une revue et une CI réussies ne constituent pas une recette sur Dev. Tout déploiement demande l'autorisation applicable et aucune Production ne part sans le GO explicite d'Amaury sur le candidat exact.

Pour signaler une vulnérabilité, suivre [SECURITY.md](SECURITY.md) et ne joindre aucun secret ni document familial.
