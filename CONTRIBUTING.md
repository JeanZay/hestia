# Contribuer à Hestia

Le projet prépare son ouverture ; le choix de licence et la publication GitHub attendent encore la décision d'Amaury. L'absence de licence open source accordée doit être résolue avant de solliciter des contributions publiques.

## Avant une modification

Lire [AGENTS.md](AGENTS.md) et [la gouvernance](docs/delivery-governance.md). Après publication, rattacher le travail à une GitHub Issue et à la vue GitHub Projects ; le contrat de tâche décrit seulement le lot courant et ses critères. Ne pas créer de backlog Markdown.

Installer les dépendances avec `npm ci`, puis utiliser les commandes du README. Le contrôle complet prévu est `npm run verify`. Les preuves doivent indiquer chaque commande réellement exécutée, son résultat, sa date et le candidat concerné. Les contrôles absents de l'environnement restent « non exécutés ».

## Activer les hooks locaux

Depuis la racine du dépôt :

```sh
git config core.hooksPath .githooks
```

Cette configuration est volontaire, locale à ce clone et n'est pas appliquée automatiquement. Git doit pouvoir exécuter les hooks ; sous Unix, conserver leur bit exécutable (`chmod +x .githooks/pre-commit .githooks/pre-push`). Git for Windows utilise son interpréteur shell. Node doit être disponible sur le PATH.

- `pre-commit` inspecte le contenu indexé pour détecter certains secrets et chemins privés.
- `pre-push` refuse la publication pendant cette fondation. Après GO publication explicite, son évolution sera une modification relue et les protections GitHub seront configurées.

Le scan peut être exécuté sans installer les hooks : `node scripts/guard.mjs` (fichiers suivis et nouveaux non ignorés) ou `node scripts/guard.mjs --staged` (index). Le contrôle ne parcourt pas l'historique Git, les fichiers ignorés ni le contenu binaire ; il ne prouve pas l'absence de secrets. Les hooks peuvent être désactivés par celui qui possède le clone. Aucune protection de branche distante n'est encore active.

## Proposer une livraison

Utiliser le modèle de pull request et une revue indépendante en contexte propre sur le candidat exact. Fournir les résultats des tests, les risques restants et les éléments que l'utilisateur peut vérifier sur Dev. Ne pas demander à Amaury de lire le code. Une revue et une CI locales ne constituent pas une validation de Dev ; aucune Production sans son GO explicite.

Pour signaler une vulnérabilité, suivre [SECURITY.md](SECURITY.md) et ne joindre aucun secret ni document familial.
