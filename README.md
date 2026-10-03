# Hestia

[Dépôt public](https://github.com/JeanZay/hestia) · [Issues](https://github.com/JeanZay/hestia/issues) · [Backlog officiel](https://github.com/users/JeanZay/projects/3)

**Retrouver les documents du foyer, comprendre leur contenu, garder la maîtrise de ses données.**

Hestia est un projet open source francophone sous [licence Apache-2.0](LICENSE), avec une instance privée et indépendante par foyer comme cible. Il vise une inbox simple, des originaux conservés intacts, une recherche avec provenance et une validation légère des informations incertaines.

## État du développement

**Connexion et dossiers persistants — tranche #17, 3 octobre 2026.** Un membre déjà admis peut se connecter, créer un dossier privé, le retrouver et le renommer. Les autorisations sont relues côté serveur ; le rôle d'administrateur global ne donne pas accès aux dossiers d'autrui. Le design reprend le hand-off Claude Design validé.

La tranche #18 ajoute les factures et photos : import séquentiel, contrôle du format et de l'intégrité, recherche par titre/nom, aperçu et téléchargement sous droits courants. Sur mobile, la prise de photo propose une confirmation avant enregistrement. Les fichiers acceptés sont PDF, JPEG, PNG, WebP et HEIC/HEIF, jusqu'à 20 Mio ; HEIC/HEIF sont conservés et téléchargeables mais sans aperçu intégré.

Le partage et la corbeille restent la tranche suivante. Le composant de démonstration historique est conservé dans le code, mais n'est plus la page d'accueil. Les contrôles utilisent des données synthétiques locales ; la publication du code ne déploie aucun service Dev ou Production. La caméra native nécessite encore une recette sur téléphone réel en Dev.

## Vérifier en local

Prérequis : Node.js 24, npm 11, Docker avec moteur Linux amd64 et images PostgreSQL/RustFS figées. Le pilote crée une base et un stockage S3 privés temporaires propres à chaque exécution ; il ne réutilise aucune configuration SQL/S3 ambiante.

```sh
npm ci --ignore-scripts
npx playwright install chromium
docker pull postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73
docker pull rustfs/rustfs@sha256:7465b31993156ca5cc0eb4b3c59a01ff69651961be62bcfeb6ce569f22034a56
npm run verify
```

Sous Linux, utiliser `npx playwright install --with-deps chromium` si les bibliothèques système manquent. `verify` exécute les contrôles du harnais, le lint, les types, les tests métier, le build, l'intégration PostgreSQL puis les parcours navigateur desktop/mobile. Il s'arrête au premier échec. Le banc est supprimé après usage ; les preuves minimisées restent sous `artifacts/`, ignoré par Git.

Pour relancer seulement la partie applicative après un build : `npm run test:e2e`. Les comptes synthétiques et leurs secrets temporaires sont provisionnés automatiquement, sans fichier de configuration privé. Aucun document familial ne doit être ajouté aux fixtures.

La [CI GitHub](https://github.com/JeanZay/hestia/actions) configure la qualification complète sous Linux. Windows contrôle le harnais, le lint, les types, les tests métier et le build ; ce job ne revendique pas les tests SQL/navigateur. Un job distinct construit l'image Docker sans la publier. Les résultats distants doivent être consultés sur chaque exécution ; une preuve locale ne vaut pas PASS distant.

Le contrôle `dependency-policy` conserve l'audit complet et refuse les alertes élevées/critiques inconnues ou présentes dans les dépendances livrées. Une [proposition de dérogation temporaire limitée à l'outil de lint](docs/adr/0003-development-audit-exception.md) reste soumise au GO d'intégration : son admissibilité technique n'est ni un audit sans vulnérabilité, ni une acceptation humaine.

## Configuration de l'application

Le lancement persistant via `npm run dev` ou `npm run build` puis `npm start` requiert une base migrée, un bucket S3 privé et les variables serveur décrites dans [.env.example](.env.example), [ADR-0002](docs/adr/0002-persistent-document-foundation.md) et [ADR-0004](docs/adr/0004-private-document-files.md). Les valeurs privées restent hors Git. `NODE_ENV=production` désigne un build optimisé et n'accorde aucune autorisation pour l'environnement Production.

Le fichier Compose fournit uniquement un PostgreSQL local jetable, au port loopback 5435, avec mot de passe éphémère obligatoire. Le pilote automatisé n'utilise pas ce service : il réserve ses propres ports, conteneur et réseau. L'image Docker applicative reste construisible ; son déploiement et son raccordement à une base hébergée sont qualifiés séparément.

## Repères

Le [workflow produit](docs/product-workflow.md) décrit les besoins larges, le refinement approfondi et les US juste-à-temps ; [la reprise inter-tâches](docs/continuity.md) indique comment retrouver sources, décisions et preuves depuis un nouveau chat. Les agents prennent en charge code et revues ; Amaury décide l'usage. `verify` découvre `artifacts/active-work.json` s'il existe ; `--checkpoint <chemin>` permet une sélection explicite. Sans checkpoint présent ou désigné, le rapport ne certifie aucun dossier local ignoré.

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
