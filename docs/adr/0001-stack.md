# ADR-0001 — Socle TypeScript portable

- Date : 12 septembre 2026.
- Statut : retenu pour la fondation locale, révisable par une nouvelle ADR.
- Portée : code local et conception cible ; aucun abonnement, hébergement ou déploiement autorisé.
- Exigences : UX-03, DATA-01 à DATA-05, PORT-01, PORT-07 et GOV-01 à GOV-06 de la [spécification](../product-specification.md).

## Problème

Hestia doit proposer une interface française confortable sur téléphone, être développable par des agents avec des contrôles reproductibles et rester exploitable indépendamment d'un fournisseur. Le premier lot doit démarrer rapidement sans créer de faux coffre ni activer de services permanents.

## Décision

| Élément | Choix et portée |
| --- | --- |
| Langage | TypeScript avec vérification stricte, partagé entre interface et logique métier. |
| Application | Next.js App Router et React ; application web avec rendu serveur possible, sans dépendance à une API spécifique Vercel. |
| Présentation | CSS simple et composants locaux ; aucune bibliothèque d'interface supplémentaire tant qu'un besoin concret ne la justifie. |
| Exécution | Node.js 24 LTS. La ligne LTS est vérifiée au jour de l'ADR ; les versions correctives et mises à jour de sécurité seront contrôlées régulièrement. [Calendrier officiel Node.js](https://nodejs.org/en/about/previous-releases). |
| Dépendances | npm et package-lock.json versionné ; installation reproductible par npm ci. Les versions exactes installées sont celles du verrou, sans prétendre qu'un numéro majeur fige les correctifs. |
| Faits persistants cibles | PostgreSQL 17, version majeure encore maintenue au jour du choix ; appliquer les correctifs et qualifier toute migration. Un profil Compose synthétique optionnel prépare son exécution locale, sans schéma ni connexion de l'application au lot initial. [Politique officielle PostgreSQL](https://www.postgresql.org/support/versioning/). |
| Originaux cibles | Stockage d'objets privé compatible S3, derrière un adaptateur ; fournisseur et moteur portable restent à qualifier. Aucun SDK, compte ou service S3 n'est nécessaire à la démo. |
| Contexte et échanges | Markdown lisible, données structurées exportables en JSON et SQL ; CSV uniquement à l'import/export. |
| Exécution portable | Image Docker et Docker Compose pour la voie locale ; ajouter les services persistants lors de leur qualification. Aucun script de déploiement Production dans la fondation. |
| Contrôles | Lint, types, tests métier et interface utiles, build, contrôles de gouvernance et CI compatible GitHub ; preuves liées au contenu exact du lot. |

Next.js sait être auto-hébergé sur Node.js ; Docker fournit une voie de conteneurisation documentée. Le choix du framework n'impose donc pas Vercel. Ces possibilités ne remplacent pas un test réel de l'image et de la procédure d'exploitation. [Next.js : auto-hébergement](https://nextjs.org/docs/app/guides/self-hosting), [Docker : application Next.js](https://docs.docker.com/guides/nextjs/).

## Options comparées

| Option | Intérêt | Motif de choix ou de réserve |
| --- | --- | --- |
| Next.js + TypeScript | Interface et serveur dans un socle cohérent, outillage partagé, voies Vercel et Docker | Retenu. Demande de maîtriser la séparation client/serveur, les caches et la configuration de build. |
| React/Vite + API séparée | Frontend léger et frontière API explicite | Viable ; ajoute dès le départ un second service, son routage et sa livraison alors que le domaine n'est pas encore stabilisé. |
| Framework serveur dans un autre langage | Bon choix possible pour OCR et traitements | Pas de raison démontrée de doubler les langages du socle maintenant ; un worker spécialisé pourra être ajouté derrière un contrat si mesuré nécessaire. |
| Supabase comme ensemble géré | PostgreSQL et services intégrés peuvent simplifier une installation | À évaluer ultérieurement. Les identités, le stockage et la logique métier ne doivent pas dépendre d'un seul hébergeur. Aucun projet Supabase créé. |
| SQLite comme base principale | Installation locale plus courte | Ne suit pas la préférence PostgreSQL et prépare moins directement les faits structurés, droits et accès concurrents distants. Une démo en mémoire suffit sans prétendre être une base de production. |
| Système de fichiers comme coffre principal | Compréhensible localement | Ne constitue pas à lui seul un contrat portable pour l'accès distant, la concurrence et les garanties d'objet ; conservé comme destination d'export possible. |

Ces réserves ne rejettent pas définitivement les options. Une nouvelle ADR pourra réviser le choix sur la base d'une mesure de coût, simplicité, sécurité, portabilité ou qualité d'usage.

## Conséquences et réversibilité

Le socle garde une seule chaîne TypeScript et limite les dépendances. La logique métier doit rester testable sans Next.js, fournisseur S3 ou service d'IA. Les données de démonstration ne doivent jamais devenir la base d'une migration contenant des informations personnelles réelles.

Limite d'outillage constatée le 12 septembre 2026 : ESLint est figé à 9.39.5 pour rester compatible avec les plugins de `eslint-config-next` 16.3.5. npm signale cette ligne ESLint comme non maintenue. L'essai de la version 10.10.0 produit des dépendances peer invalides et une erreur de chargement de règle React ; elle n'est donc pas forcée. Ce composant sert uniquement aux contrôles de développement, pas au serveur livré. Sa migration doit être requalifiée avec les plugins compatibles avant de présenter la chaîne comme entièrement maintenue ; un audit npm sans alerte ne supprime pas cette limite.

La contrepartie est une discipline sur les composants client/serveur et les particularités d'hébergement. Les tâches OCR longues iront dans un worker ; le stockage durable n'utilisera pas le disque éphémère d'une fonction. La compatibilité S3 sera testée sur les opérations réellement utilisées, sans prétendre que toutes les extensions des fournisseurs sont interchangeables.

Changer de framework reste possible en conservant contrats métier, schémas ouverts et formats d'export. Changer de base ou de fournisseur nécessitera une migration vérifiée. Avant toute donnée réelle, il faudra prouver authentification, autorisation, intégrité, sauvegarde et restauration. L'ADR décide uniquement du point de départ technique, sans accorder une licence ni autoriser une publication.
