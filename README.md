# Hestia

[Dépôt public](https://github.com/JeanZay/hestia) · [Issues](https://github.com/JeanZay/hestia/issues) · [Backlog officiel](https://github.com/users/JeanZay/projects/3)

**Retrouver les documents du foyer, comprendre leur contenu, garder la maîtrise de ses données.**

Hestia est un projet open source francophone sous [licence Apache-2.0](LICENSE), avec une instance privée et indépendante par foyer comme cible. Il vise une inbox simple, des originaux conservés intacts, une recherche avec provenance et une validation légère des informations incertaines.

## État de cette fondation

**Démo locale synthétique uniquement — 12 septembre 2026.** La recherche, les filtres, les liens vers cinq originaux d'exemple, la validation ou le refus d'une date ambiguë et les connecteurs simulés fonctionnent en mémoire. Recharger la page réinitialise les choix. Aucun compte, document réel, OCR, IA externe, base de données ou stockage d'objets n'est connecté.

Le [code source](https://github.com/JeanZay/hestia) et ses outils de contribution sont ouverts ; la démonstration n'est pas un coffre utilisable pour des données personnelles et ne doit pas être exposée sur Internet. La publication du code ne déploie aucun service Dev ou Production.

## Essayer en local

Prérequis : Node.js 24 LTS (version de référence dans `.node-version`) et npm 11.

```sh
npm ci --ignore-scripts
npm run dev
```

Ouvrir [la démo locale](http://127.0.0.1:3000). Aucun fichier `.env` ni mot de passe n'est nécessaire. Le serveur écoute seulement l'ordinateur local. Le mode `demo` et l'environnement `dev` sont les seuls acceptés. `NODE_ENV=production` signifie un build optimisé de la démo, pas une autorisation d'utiliser l'environnement familial Production.

Pour essayer l'artefact compilé :

```sh
npm run build
npm start
```

Le démarrage prépare les ressources statiques de l'artefact autonome. Arrêter avec `Ctrl+C`.

## Vérifier le lot

```sh
npx playwright install chromium
npm run verify
```

Sous Linux, `npx playwright install --with-deps chromium` installe aussi les dépendances système si nécessaires. Le navigateur est un outil de test local gratuit. `verify` enchaîne le guard, les tests du harnais, le lint, les types, les tests métier et d'intégrité des originaux, le build, puis les parcours navigateur desktop et mobile. Il s'arrête au premier échec. Les résultats et le manifeste SHA-256 sont conservés dans `artifacts/`, ignoré par Git.

`npm audit --audit-level=high` consulte séparément les alertes du registre public ; cette étape nécessite le réseau. La [CI GitHub](https://github.com/JeanZay/hestia/actions) est configurée pour les contrôles Windows/Linux et la démo Docker, sur les runners standards du dépôt public. Elle ne déploie rien et ne publie ni image Docker ni paquet. Consulter chaque exécution pour son résultat réel ; les preuves locales ne valent pas réussite de la CI distante.

## Voie Docker locale

```sh
docker compose up --build --detach --wait app
docker compose down
```

Le port 3000 reste limité à `127.0.0.1`. Le conteneur applicatif est sans privilèges et sans écriture persistante. Son réseau bridge permet l'accès depuis l'hôte ; il n'est pas présenté comme un pare-feu de sortie. La démo ne contient aucun appel à un service externe. Ne pas la faire tourner simultanément avec la démo Node sur le même port.

Un profil `data-sandbox` prépare un PostgreSQL 17 jetable pour les futurs tests SQL. Il n'a ni port hôte ni volume durable, et l'application ne l'utilise pas. Son authentification `trust` est réservée à ce réseau local isolé et aux données fictives ; ce n'est pas une configuration de service familial. Le stockage compatible S3 fait partie de l'architecture cible, sans serveur ou fournisseur choisi dans ce lot.

## Repères

| Document | Contenu |
| --- | --- |
| [Spécification produit](docs/product-specification.md) | Décisions du cadrage, critères et questions ouvertes, sans données familiales |
| [Architecture](docs/architecture.md) et [ADR-0001](docs/adr/0001-stack.md) | Next.js/TypeScript, PostgreSQL, objets S3, Markdown et portabilité |
| [Sécurité](docs/security.md) et [signalement](SECURITY.md) | Protection dès la conception et limites actuelles |
| [Portabilité](docs/portability.md) | Export, sauvegardes indépendantes, intégrité et restauration cible |
| [Contribution](CONTRIBUTING.md) et [gouvernance](docs/delivery-governance.md) | Contrats, contrôles, revue indépendante et GO humain |
| [Licence](docs/licensing.md) et [dépendances tierces](docs/third-party-notices.md) | Apache-2.0 pour les éléments originaux ; licences propres aux dépendances |

[GitHub Issues](https://github.com/JeanZay/hestia/issues) et GitHub Projects constituent l'unique backlog. Les propositions de la fondation sont un import ponctuel, sans suivi concurrent dans les fichiers du dépôt. Les contributions passent par une pull request. Les seuls environnements durables seront Dev et Production. La QA est une suite de contrôles et une recette sur Dev ; tout passage en Production demande un accord explicite sur la version exacte.

Le dépôt public contient le produit installable, son harnais, ses tests et sa documentation contributeur. Les outils privés d'animation ou de communication du projet relèvent d'un autre projet non public, sans accès aux données du coffre.
