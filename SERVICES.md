# Services et coûts de Hestia

Inventaire du **4 octobre 2026**, établi à partir du code et des reçus d'exploitation des 3–4 octobre. Les états observés sont datés ; ils ne constituent pas un relevé de facturation. Une offre gratuite comporte des quotas. Les tarifs et conditions peuvent évoluer.

## Vue d'ensemble

| Service | Utilisation dans Hestia | État observé | Coût et limites |
| --- | --- | --- | --- |
| **Vercel** | Hébergement Next.js, builds, fonctions serveur et HTTPS | Projet Dev distinct, offre Hobby constatée le 3 octobre. Projet destiné à Production et domaine préparés le 4 octobre, sans application Production déployée au relevé | Offre gratuite observée ; aucun passage payant dans ce lot. [Tarifs](https://vercel.com/pricing) |
| **Neon PostgreSQL** | Métadonnées, comptes et droits applicatifs | Projet Dev Free, PostgreSQL 17 à Francfort ; parcours documentaire accepté sur Dev le 4 octobre | Offre gratuite constatée le 3 octobre ; consommation et factures non auditées. [Tarifs fournisseur](https://neon.com/pricing) |
| **Neon Object Storage** | Originaux documentaires dans un bucket privé compatible S3 | Stockage Dev privé raccordé au parcours documentaire | Service du projet Neon ; quotas et facturation effective à suivre dans ce compte. Aucun abonnement AWS direct distinct établi |
| **Better Auth** | Authentification exécutée dans l'application, avec PostgreSQL | Bibliothèque utilisée par Hestia ; distincte du service géré Neon Auth | Logiciel libre sous [licence MIT](https://github.com/better-auth/better-auth/blob/main/LICENSE.md), sans abonnement requis pour la bibliothèque. Hébergement et courriels restent des coûts distincts |
| **Resend** | Courriels transactionnels des accès familiaux | Domaine d'envoi Dev vérifié en Irlande, clé d'envoi restreinte installée dans Vercel Dev ; un test fournisseur marqué livré le 4 octobre. Transport applicatif encore à intégrer | Offre Free constatée : 3 000 courriels/mois, 100/jour, quotas partagés au niveau du compte. Dépassement payant désactivé ; aucune configuration Production. [Tarifs](https://resend.com/pricing) |
| **GitHub** | Dépôt public, Issues, Project, pull requests et CI | Dépôt et contrôles utilisés ; GitHub constitue l'unique backlog | Actions gratuit sur les runners standard des dépôts publics ; offre globale du compte non auditée. [Conditions Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| **GoDaddy / domaine existant** | Gestion du domaine et de ses enregistrements DNS | Raccordement du domaine applicatif établi le 4 octobre | Renouvellement du domaine existant non inventorié ; coût non déclaré nul ni entièrement imputé à Hestia |

## Adresses utiles

| Ressource | Adresse |
| --- | --- |
| Code et documentation | [JeanZay/hestia](https://github.com/JeanZay/hestia) |
| Besoins et suivi | [Issues](https://github.com/JeanZay/hestia/issues) · [Project](https://github.com/users/JeanZay/projects/3) |
| Contrôles distants | [GitHub Actions](https://github.com/JeanZay/hestia/actions) |
| Hébergement | [Console Vercel](https://vercel.com) |
| Base et stockage | [Console Neon](https://console.neon.tech) |
| Courriels | [Resend](https://resend.com) |
| Domaine et DNS | [GoDaddy](https://www.godaddy.com) |

Les consoles nécessitent leur authentification habituelle. Les identifiants d'infrastructure privée, adresses personnelles, secrets, URL signées et moyens de paiement sont exclus de ce document public. Les références exactes des déploiements et projets restent dans les preuves d'exploitation locales.

## Environnements et courriels

Dev et Production sont deux environnements durables distincts. QA désigne les contrôles et la recette sur Dev. L'acceptation du parcours documentaire Dev du 4 octobre ne qualifie pas automatiquement les nouveaux parcours d'accès familial. Le raccordement du domaine destiné à Production ne constitue pas un déploiement du produit.

Le raccordement Resend Dev utilise un sous-domaine dédié, une région européenne et TLS obligatoire. Le domaine et ses trois enregistrements DNS sont vérifiés le 4 octobre ; le MX racine et le CNAME applicatif existant sont préservés. La réception de courriels est désactivée ; aucun sous-domaine de suivi n'est configuré.

La clé est limitée à l'envoi depuis ce domaine Dev et enregistrée comme secret `RESEND_API_KEY` dans le projet Vercel Dev, cible Preview uniquement. Un unique message non sensible a été accepté par l'API puis marqué `delivered` dans Resend ; le destinataire a confirmé sa réception dans la boîte principale le 4 octobre. Ce test direct du fournisseur ne qualifie pas le transport applicatif ni son déclencheur, qui restent à implémenter et tester séparément. Le prestataire reçoit le destinataire et le contenu transactionnel ; aucun document du coffre, mot de passe ou code de secours ne doit lui être transmis. Aucun déploiement applicatif n'a été effectué pour ce raccordement.

Le nettoyage quotidien durable des documents restait différé dans le relevé de recette Dev du 4 octobre. Le déclencheur de reprise des courriels demande sa propre qualification : la présence de code ou d'une configuration cron ne prouve pas une exécution distante.

## Outils de développement et de qualification

| Outil | Utilisation | Gratuit ou payant |
| --- | --- | --- |
| Codex / ChatGPT | Développement, contrôles et revues indépendantes | Outil du contributeur ; abonnement et part imputable à Hestia non audités |
| Claude Design | Conception UI/UX utilisée manuellement par Amaury | Coût du compte non audité ; aucun abonnement ou appel API du produit établi par cet usage |
| Docker / Docker Desktop | Exécution locale de PostgreSQL et RustFS jetables, construction de l'image applicative | Docker Desktop est gratuit notamment pour l'usage personnel et les projets open source non commerciaux ; d'autres usages exigent un abonnement. [Conditions](https://docs.docker.com/subscription-billing/desktop-license/) |
| Playwright | Tests navigateur locaux et en CI | Logiciel libre sous [licence Apache-2.0](https://github.com/microsoft/playwright/blob/main/LICENSE), sans abonnement requis pour le lancer localement ; ressources d'exécution distinctes |
| [Node.js](https://nodejs.org), [npm CLI](https://github.com/npm/cli), [PostgreSQL](https://www.postgresql.org) et [RustFS](https://github.com/rustfs/rustfs) | Application et banc de qualification synthétique | Outils et dépendances locaux ; licences propres et coûts de machine/hébergement distincts. [Notices du dépôt](docs/third-party-notices.md) |
| [Next.js](https://nextjs.org) et [React / React DOM](https://react.dev) | Framework applicatif, rendu et composants de l'interface | Bibliothèques sous MIT selon le verrou npm ; aucun abonnement requis pour les bibliothèques, hébergement distinct |
| [TypeScript](https://www.typescriptlang.org), [ESLint](https://eslint.org) et [Vitest](https://vitest.dev) | Typage, analyse du code et tests automatisés ; configuration Next.js et types associés | Logiciels libres, respectivement Apache-2.0, MIT et MIT selon le verrou npm ; ressources locales ou CI distinctes |
| [Sharp](https://sharp.pixelplumbing.com), [libheif-js](https://github.com/catdad-experiments/libheif-js) et [PDF.js](https://mozilla.github.io/pdf.js/) | Validation et traitement des images, décodage HEIF et lecture des PDF dans Hestia | Dépendances locales sans abonnement ; Sharp/PDF.js sous Apache-2.0, libheif-js sous LGPL-3.0, avec licences supplémentaires pour certains binaires. [Notices](docs/third-party-notices.md) |
| [node-postgres](https://node-postgres.com) et [AWS SDK S3](https://github.com/aws/aws-sdk-js-v3) | Connexions PostgreSQL et accès au stockage compatible S3 | Bibliothèques sous MIT et Apache-2.0 selon le verrou npm ; ne créent aucun abonnement fournisseur |
| [Git](https://git-scm.com), [GitHub CLI](https://cli.github.com), [Neon CLI](https://github.com/neondatabase/neonctl) et [Vercel CLI](https://vercel.com/docs/cli) | Versionnement, suivi GitHub et administration des projets autorisés | Outils en ligne de commande ; aucun abonnement distinct établi pour leur installation. Les opérations distantes restent soumises aux offres des services concernés |

Ces groupes couvrent les dépendances directes et les principaux outils du dépôt. Le [verrou npm](package-lock.json) conserve les dépendances transitives et leurs licences déclarées. Les polices et icônes embarquées sont inventoriées dans les [notices de l'interface](src/components/hestia/THIRD-PARTY-NOTICES.md) ; elles sont servies localement, sans abonnement ni appel à Google Fonts.

## Services non activés ou non établis

- Neon Auth, Neon Functions et Neon AI Gateway n'ont pas été activés par l'installation Dev du 3 octobre. Installer leurs skills n'active pas ces services.
- Aucun contrat AWS direct n'est établi du seul fait du SDK S3 ou de la région d'hébergement Neon. Ne pas compter deux fois ces fournisseurs sous-jacents.
- Aucun service IA/OCR externe du produit n'est établi par cet inventaire. Les outils des contributeurs restent distincts des services de l'application.
- Les bases, stockages et courriels de Production restent à qualifier séparément, avec leurs propres autorisations.

## Budget et sources

Les offres gratuites constatées ne permettent pas de conclure à un coût total nul. Les abonnements des outils de développement, le renouvellement du domaine, les consommations et les factures restent à distinguer. Aucun plafond fournisseur global ni budget mensuel total n'est établi ici.

Sources versionnées : [README](README.md), [dépendances](package.json), [noms des paramètres](.env.example), [fondation persistante](docs/adr/0002-persistent-document-foundation.md), [fichiers privés](docs/adr/0004-private-document-files.md) et [gouvernance](docs/delivery-governance.md).

Sources d'exploitation hors Git : reçus de préparation Dev du 3 octobre, raccordement du domaine et recette documentaire du 4 octobre, puis preuves du lot Resend. Les états ci-dessus proviennent de ces relevés ; les anciens documents de fondation ne décrivent pas à eux seuls l'état distant actuel.

Les sources officielles Docker, Playwright, Better Auth et GitHub Actions ont été relues le 4 octobre. Le lien des tarifs Neon est fourni comme repère ; sa consultation n'a pas abouti lors de cette rédaction, sans remettre en cause le relevé antérieur de l'offre Free du compte.

Cet inventaire ne modifie aucune configuration, autorisation, limite fournisseur ou procédure de déploiement.
