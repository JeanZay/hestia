# Spécification produit Hestia

Version de cadrage : 13 septembre 2026, actualisée pour les droits indépendants de l'âge et le circuit Claude Design, après les décisions Apache-2.0 et publication GitHub du 12 septembre. Ce document exprime les besoins et décisions ; il ne constitue pas un backlog. Les travaux, priorités et états de livraison sont suivis uniquement dans GitHub Issues et GitHub Projects.

## Origine et portée

Cette spécification transpose intégralement les éléments utiles du carnet d'exploration du 12 septembre 2026 sur l'automatisation de la vie privée. Les personnes et références privées ont été remplacées par des rôles génériques. Le carnet original n'est pas copié dans le dépôt. Les identifiants ci-dessous rendent les décisions citables dans les contrats de tâche, tests et futures issues.

Un besoin **validé** engage la conception cible, sans signifier qu'il est implémenté. Une idée **à l'étude** demeure une option. Une **question ouverte** ne reçoit pas de réponse implicite dans ce lot. Les décisions techniques locales figurent dans les [ADR](adr/0001-stack.md).

## Finalité et utilisateurs

Hestia est un socle numérique familial privé, francophone et open source sous Apache-2.0. Chaque foyer installe et contrôle sa propre instance indépendante. Il retrouve ses documents, comprend les informations qui en sont extraites et garde la maîtrise de leur utilisation. Le logiciel doit être reconstructible ; les données familiales sont l'actif à préserver.

| ID | Décision validée |
| --- | --- |
| VIS-01 | Une instance indépendante par foyer ; aucune plateforme SaaS centralisant plusieurs familles n'est décidée. |
| VIS-02 | Les personnes décrites par le foyer et les comptes autorisés sont distincts. Les droits reposent sur les rôles et permissions explicitement attribués, sans profils adulte/enfant ni droit accordé selon l'âge ou le lien familial. Les documents peuvent concerner un enfant ou un proche très âgé sans lui créer un compte ni un accès. Une personne aidante agit avec son propre compte et ses seuls droits ; le rôle d'aide ne donne aucun accès automatique aux documents de la personne aidée. |
| VIS-03 | Le responsable produit exprime ses besoins en langage naturel, teste l'application et décide ajustement, non-GO ou GO. Il n'écrit ni ne relit de code. |
| VIS-04 | Le projet vise aussi à démontrer une pratique professionnelle du développement agentique : orchestration, contrôle, preuves et livraison supervisée. Cette finalité n'intègre pas l'animation ou la communication privée au produit public ; la frontière PUB-01 à PUB-06 s'applique. |
| VIS-05 | Les échanges et décisions restent courts, compréhensibles et orientés vers l'usage. Les incertitudes utiles de l'exploration sont conservées, même sans décision finale. |

## Accès et expérience

| ID | Décision validée |
| --- | --- |
| UX-01 | L'instance cible est accessible par Internet en déplacement, y compris lorsque l'ordinateur familial est éteint. Elle nécessite donc un hébergement disponible indépendamment de cet ordinateur. |
| UX-02 | L'accès distant est authentifié et réservé aux membres autorisés du foyer ; un lien de document seul ne donne aucun droit. |
| UX-03 | L'expérience est conçue d'abord pour le téléphone Android ou iPhone et demeure confortable sur tablette et ordinateur. |
| UX-04 | L'interface et la documentation utilisateur sont d'abord en français. Les textes, dates et formats doivent pouvoir être traduits sans modifier la logique métier. La terminologie technique et certaines instructions contributeur pourront être en anglais. |
| UX-05 | Retrouver un document et poser une question sont les usages centraux. Le contrôle des connecteurs reste simple, sans plateforme d'administration complexe dans la première version. |

La première conception doit permettre une navigation au clavier, des champs nommés, des états compréhensibles sans dépendre de la couleur et une lecture sur petit écran. Ces critères de qualité d'interface précisent UX-03 ; ils ne promettent aucune certification d'accessibilité.

Selon la décision EXP-07 du 13 septembre 2026, Claude Design réalise la conception UI, avec un Design System initial validé puis réemployé à chaque écran. La [gouvernance de design](design-governance.md) définit les prompts remis à Amaury, l'import manuel des hand-offs et leur intégration technique fidèle par les agents ; elle s'applique aux nouveaux travaux et encadre la reprise de la démonstration antérieure.

## Coffre documentaire

| ID | Décision validée |
| --- | --- |
| DOC-01 | Une inbox accepte les documents en vrac. Les canaux cibles sont le dépôt de fichier, la photo ou le scan mobile, puis les pièces jointes reçues par une adresse e-mail dédiée. |
| DOC-02 | L'original est conservé intact. L'OCR, la lecture et l'extraction portent sur une copie. Le classement organise des références et métadonnées ; il ne réécrit jamais les octets de l'original. |
| DOC-03 | Chaque document conserve un identifiant, sa provenance, sa date d'ajout, son type, son intégrité et le lien vers son original. Une nouvelle version est un nouvel objet relié à l'ancien. |
| DOC-04 | Le classement propose une arborescence logique. L'extraction produit les informations importantes, un résumé et une fiche Markdown contenant un lien vers l'original. Les faits précis sont structurés dans SQL selon DATA-02. |
| DOC-05 | Si un classement ou une valeur est incertain, une file légère présente la proposition, l'extrait source et l'action de validation ou correction. Une proposition non validée ne devient pas un fait confirmé. |
| DOC-06 | Les doublons sont détectés avant archivage définitif. Un doublon possible est signalé sans suppression silencieuse d'un original. |
| DOC-07 | La recherche classique par mots-clés reste utilisable indépendamment de toute IA. La recherche sémantique et les questions conversationnelles viennent en complément. |
| DOC-08 | Toute réponse documentaire produite par l'IA expose les documents qui la justifient et permet de retrouver l'original. En l'absence de source suffisante, le système doit le dire. |
| DOC-09 | Les échéances importantes détectées dans les documents donnent lieu à des propositions de rappel. Une échéance incertaine doit être validée ; elle ne déclenche pas automatiquement un engagement externe. |
| DOC-10 | Les documents communs, personnels et partagés ponctuellement sont distingués. Le détail des droits et la durée des partages restent à préciser dans EXP-03. |

Parcours cible d'un document : réception → contrôle de format et d'intégrité → recherche de doublon → conservation de l'original → traitement de la copie → propositions d'extraction et classement → validation si nécessaire → disponibilité dans le coffre et la recherche. Un échec conserve un état lisible, permet une reprise contrôlée et ne fait pas disparaître la provenance.

L'immuabilité décrit l'absence de modification de l'original. Elle n'interdit pas une suppression explicitement autorisée et documentée : les règles d'effacement, d'expiration des sauvegardes et de restauration doivent rester cohérentes avec PRIV-02.

## Profil familial et informations sensibles

| ID | Décision validée |
| --- | --- |
| FAM-01 | Un compartiment distinct stocke les faits familiaux stables : membres, liens, dates de naissance, animaux, adresse, école et autres faits utiles. Chaque champ doit avoir une finalité explicite. |
| FAM-02 | Le profil est structuré, validé et modifiable manuellement. Les valeurs exactes peuvent rester dans le coffre privé ; seule la précision nécessaire est communiquée à chaque traitement. |
| FAM-03 | Les données les plus sensibles disposent de droits plus stricts. Un RIB peut être conservé dans un compartiment financier très restreint. |
| FAM-04 | Les codes secrets de carte, cryptogrammes, mots de passe et autres secrets d'utilisation ne sont jamais stockés comme données familiales ni transmis à une IA. Les secrets techniques nécessaires au service relèvent d'un gestionnaire distinct, hors dépôt, hors profil et hors contexte des modèles. |
| FAM-05 | L'IA reçoit uniquement le contexte nécessaire à la tâche, avec une attention particulière aux services externes. Aucun document sensible n'est envoyé à un service externe sans accord explicite. |

## Sources de vérité et tableaux de bord

| ID | Décision validée |
| --- | --- |
| DATA-01 | L'architecture est hybride avec une source de vérité désignée pour chaque information : l'original est la preuve documentaire immuable. |
| DATA-02 | PostgreSQL porte les faits précis, personnes, relations, dates, montants, autorisations et données destinées aux calculs et tableaux de bord. Chaque fait extrait référence sa preuve et son état de validation. |
| DATA-03 | Les fiches Markdown portent les résumés et le contexte documentaire utiles aux recherches lexicale et sémantique. Elles ne constituent pas une seconde autorité éditable sur un montant ou une date déjà validés dans SQL. |
| DATA-04 | CSV sert uniquement à l'import, l'export et l'analyse ponctuelle. Il n'est pas le stockage principal. |
| DATA-05 | Les tableaux de bord lisent les données structurées et conservent les liens vers les documents sources. Les index lexicaux et sémantiques sont dérivés et reconstructibles. |

## Portabilité, sauvegarde et continuité

| ID | Décision validée |
| --- | --- |
| PORT-01 | Le foyer peut télécharger en une seule opération l'ensemble des originaux, fiches Markdown, données structurées et métadonnées nécessaires à leur compréhension. Les formats sont standards, ouverts et documentés. |
| PORT-02 | La migration vers un autre hébergeur ne doit pas nécessiter une reconstruction manuelle des relations entre données. Le service doit pouvoir être reconstruit à partir du code, d'une sauvegarde et d'instructions vérifiées. |
| PORT-03 | Une sauvegarde automatique quotidienne et chiffrée est conservée chez un fournisseur indépendant de l'hébergeur principal. Elle forme un ensemble cohérent : originaux, SQL, Markdown, relations et informations de restauration. |
| PORT-04 | Plusieurs versions sont conservées pour remonter avant une suppression accidentelle, une corruption ou une attaque. Une copie chiffrée périodique hors ligne complète les sauvegardes. |
| PORT-05 | L'intégrité des sauvegardes est vérifiée automatiquement ; une restauration complète est réellement testée tous les trois mois. L'existence d'une archive n'est pas une preuve de restauration. |
| PORT-06 | Le mécanisme de récupération des clés doit être compréhensible par le foyer et indépendant de la seule instance à restaurer. La durée de conservation, la périodicité hors ligne et le délai maximal de remise en service restent ouverts. |
| PORT-07 | Une installation recommandée simple doit être proposée ; Vercel est une option, sans obligation. Une voie portable Docker Compose doit être maintenue, sans multiplier prématurément les hébergeurs supportés. |

Les contrats d'export et la procédure cible sont détaillés dans [Portabilité](portability.md). Aucune sauvegarde familiale ni infrastructure distante n'est créée par le premier lot.

## Connecteurs et extensibilité

| ID | Décision validée |
| --- | --- |
| MOD-01 | Les connecteurs sont modulaires. Chaque connecteur expose ses permissions, son état, sa dernière synchronisation et ses erreurs. |
| MOD-02 | Chaque connecteur peut être désactivé individuellement. Un coupe-circuit global permet d'arrêter les échanges externes ; une reprise demande une action explicite. |
| MOD-03 | Un calendrier familial est envisagé comme premier module permettant de vérifier l'extensibilité. Son intégration effective et le prestataire restent à décider. |

Pour la cible, la désactivation doit être vérifiée avant toute nouvelle tentative réseau, y compris depuis un traitement asynchrone. Les opérations déjà acceptées par un tiers ne peuvent être annulées par un simple bouton ; leur état doit rester visible. Le lot initial ne simule que le contrôle local de connecteurs fictifs et n'émet aucun échange externe.

## Protection et développement agentique

| ID | Décision validée |
| --- | --- |
| PRIV-01 | La protection des données est intégrée dès la conception, avec le RGPD et les recommandations CNIL comme boussole. Hestia ne se présente pas comme juridiquement certifié ; l'hébergement et la configuration de chaque instance comptent. |
| PRIV-02 | Les réglages par défaut limitent la collecte et les accès, expliquent les traitements et permettent export, rectification et suppression. |
| PRIV-03 | Développement, tests et previews utilisent uniquement des données synthétiques. Le dépôt public ne contient jamais de données familiales, secrets ou configurations privées. |
| PRIV-04 | Le stockage cible est privé, les accès limités aux personnes et applications nécessaires, les échanges et sauvegardes chiffrés. La sécurité reste pragmatique et proportionnée ; elle ne fait pas de promesse de niveau bancaire. |
| GOV-01 | Codex et Claude Code sont les outils principaux, en utilisant prioritairement les abonnements existants. Les API payantes récurrentes sont évitées autant que possible. Une dépense IA additionnelle ne peut être envisagée que pour un bénéfice explicité, justifié et autorisé ; ce lot n'en autorise aucune. |
| GOV-02 | Skills, hooks et contrats de tâche encadrent les agents. Conception, implémentation et revue ont des responsabilités distinctes. Les lots futurs utilisent une branche et un worktree isolés ; la fondation initiale bénéficie de l'autorisation explicite de travailler dans le projet local. |
| GOV-03 | Les contrôles déterministes sont adaptés au changement. Une revue indépendante du diff est effectuée dans un contexte propre. Les preuves portent sur la version exacte : tests, revue, migrations, preview et verdict QA. Une revue indisponible ou échouée n'est jamais déclarée effective. |
| GOV-04 | Deux environnements et bases durables seulement : Dev et Production, strictement séparés. Local, previews de PR et bases jetables de migrations sont isolés et éphémères. La QA est un ensemble de contrôles et une recette sur Dev, sans troisième base permanente. |
| GOV-05 | Flux cible : issue prête → worktree → développement → tests → revue indépendante → PR → preview → intégration sur develop → recette Dev liée à la version → GO explicite du responsable produit → promotion de l'artefact approuvé en Production. |
| GOV-06 | La branche de Production est protégée. Toute livraison exige les contrôles requis, une sauvegarde vérifiée, des migrations contrôlées, un retour arrière préparé et des tests après déploiement. Aucun GO implicite, aucune publication ni livraison distante dans le lot initial. |
| GOV-07 | GitHub Issues et GitHub Projects sont l'unique backlog, tenu par les agents dans les autorisations applicables. Les besoins futurs restent larges. Un seul besoin est approfondi à la fois par rounds de refinement jusqu'au cahier des charges complet du périmètre retenu ; les US verticales n'apparaissent que pour le besoin engagé maintenant après validation, pas dès qu'une idée est comprise. Les agents dédupliquent, proposent les priorités et gèrent critères, dépendances, ordre technique et preuves. Amaury pilote les choix sans coder, relire le code ni administrer les détails. Voir le [workflow produit](product-workflow.md), acté le 15 septembre 2026. |
| GOV-08 | Les statuts reflètent des preuves réelles : développé, testé, revu, disponible en Dev ou livré en Production. Une issue n'est fermée comme livrée qu'après vérification indépendante de la version effectivement déployée. L'interface de pilotage expose un backlog lisible, une preview et un verdict clair. |
| OSS-01 | Le projet est open source sous Apache-2.0 après décision explicite du 12 septembre 2026 : code du produit installable, harnais de développement du produit, tests, données synthétiques, documentation de contribution autorisée et backlog GitHub sont publiables sur JeanZay/hestia. Ce périmètre exclut l'usine privée décrite par PUB-01 à PUB-06 et n'autorise aucune publication des données d'un foyer. |
| OSS-02 | Les utilisateurs doivent recevoir des versions stables, une installation guidée, des migrations et des outils de sauvegarde/restauration. Le harnais et le backlog servent surtout aux contributeurs. |
| OSS-03 | Le code partageable reste strictement séparé des données, configurations et secrets de chaque foyer. |

La traduction opérationnelle de ces règles est donnée par [AGENTS.md](../AGENTS.md), la [gouvernance de livraison](delivery-governance.md), la [gouvernance de design](design-governance.md) et la [sécurité](security.md).

## Frontière entre produit public et animation privée

Cette décision ajoutée au carnet le 12 septembre 2026 borne le dépôt Hestia. Les contraintes ci-dessous préservent le périmètre et les accès ; elles ne décrivent pas les procédures internes d'un autre projet et n'autorisent pas sa création dans ce lot.

| ID | Décision validée de périmètre |
| --- | --- |
| PUB-01 | Hestia est le produit public installable et contrôlable par chaque foyer, avec son harnais, ses tests et sa documentation contributeur autorisée. L'automatisation privée d'animation, communication et analyse de l'activité open source constitue un projet distinct, non public, réservé au responsable du projet. Elle ne devient pas un module Hestia, même lorsqu'elle illustre la démarche agentique. |
| PUB-02 | Aucun code, configuration, secret ou procédure interne de cette usine privée ne figure dans le dépôt public Hestia. Les workflows privés de communication, d'analyse d'adoption et de publication LinkedIn sont hors du périmètre du produit et de son harnais public. |
| PUB-03 | Le seul périmètre d'information Hestia accessible à ce projet privé est public : changements validés, versions, documentation, issues, retours et statistiques publiques utiles. Les documents, profils familiaux, secrets et la Production privée de toute instance Hestia lui sont interdits. |
| PUB-04 | Les usages envisagés de ce projet distinct sont la préparation de notes de version, démonstrations, articles, publications LinkedIn, réponses communautaires et analyses d'adoption, uniquement à partir de preuves vérifiées. Cette mention n'ajoute aucune de ces fonctions à l'application Hestia. |
| PUB-05 | Toute publication au nom du responsable du projet nécessite son accord explicite, au moins pendant la phase initiale. Un brouillon et un aperçu doivent précéder la diffusion ; aucun mécanisme de publication n'est créé ou activé par la fondation Hestia. |
| PUB-06 | Un éventuel accès LinkedIn appartient au projet privé et exige une autorisation officielle, limitée et révocable. Le mot de passe du compte n'est jamais communiqué ni stocké. Aucun accès LinkedIn n'est configuré ou demandé dans ce lot. |

## Idées à l'étude

Cette table conserve les options du carnet et les décisions qui les ont tranchées. EXP-01 à EXP-06 reprennent sa rubrique « Idées à l'étude » ; EXP-07 et EXP-08 proviennent de possibilités évoquées ailleurs dans le cadrage. EXP-05 et EXP-07 sont désormais des choix actés. Cette table n'est ni une liste de tâches planifiées ni un second système de suivi. L'animation privée constitue une frontière validée selon PUB-01 à PUB-06, pas une option de module Hestia.

| ID | Option conservée ou décision actée |
| --- | --- |
| EXP-01 | Inbox locale synchronisée vers le service distant ou dépôt directement hébergé. Comparer disponibilité, confidentialité, doublons, capacité mobile et reprise après panne. |
| EXP-02 | Forme des rappels : dans l'application, e-mail, calendrier ou notification mobile. Définir permissions, consentement, fréquence et erreurs visibles avant activation. |
| EXP-03 | Niveau exact de séparation des documents communs, personnels, financiers et partagés temporairement ; préciser droits de lecture, modification, export et révocation. |
| EXP-04 | Hébergement principal et fournisseur indépendant de sauvegarde ; vérifier coûts, localisation, conditions de traitement, export et restauration. |
| EXP-05 | Option tranchée après cadrage : Apache-2.0 adoptée explicitement le 12 septembre 2026. Le choix initial et son application sont documentés dans [Licence](licensing.md). |
| EXP-06 | Périmètre initial de documentation anglaise destinée aux contributeurs. Le français utilisateur demeure prioritaire. |
| EXP-07 | Choix acté par Amaury le 13 septembre 2026 : conception UI exclusivement dans Claude Design utilisé manuellement par Amaury, à partir de prompts préparés par les agents ; Design System initial validé et réemployé, puis hand-offs déposés à la racine pour intégration technique autorisée. Les agents ne conçoivent aucune UI de remplacement. Voir la [gouvernance de design](design-governance.md). Ce choix n'autorise aucun lancement Claude par les agents, transfert externe de données, abonnement ou coût supplémentaire. |
| EXP-08 | SQL, Supabase, sites web, IA et combinaisons pertinentes restent des solutions envisageables si elles respectent les exigences. L'ADR choisit un socle de départ sans engagement d'hébergement. |

## Questions ouvertes

| ID | Question conservée |
| --- | --- |
| Q-01 | Où doit vivre le stockage principal : espace familial partagé, infrastructure privée ou cloud ? Un simple ordinateur familial éteignable ne satisfait pas seul UX-01. |
| Q-02 | Quel hébergement assure l'accès distant indépendant de l'ordinateur familial avec une confidentialité et une exploitation raisonnables ? |
| Q-03 | Comment séparer les outils IA de développement, couverts d'abord par les abonnements existants, des fonctions IA permanentes du produit ? L'abonnement d'un contributeur ne doit pas devenir une dépendance de chaque foyer. |
| Q-04 | L'OCR, l'extraction et les questions documentaires peuvent-ils fonctionner sans API payante récurrente et sans perte fonctionnelle importante ? Évaluer qualité francophone, matériel requis, durée des traitements et coût total sur corpus synthétique. |
| Q-05 | Quels types de documents traiter en priorité ? Aucun corpus familial réel ni périmètre implicite santé/finance n'est accepté par le lot initial. |
| Q-06 | Quel délai maximal de remise en service viser après une panne durable ou la disparition d'un fournisseur, et quelle perte de données maximale accepter ? |
| Q-07 | Combien de versions conserver, à quelle fréquence produire la copie hors ligne, et comment organiser la garde et la récupération des clés ? |

**Idées écartées dans le carnet : aucune.** La fondation ne transforme pas les options différées en rejets.

## Contrat du premier lot

Le lot fondateur produit une application locale exécutable avec données synthétiques, les documents de conception, les contrats et contrôles du développement agentique, des tests pertinents, les modèles GitHub et une proposition d'issues à publier ultérieurement. Les identités de démonstration n'ont aucun lien avec un foyer réel.

Le lot ne crée ni projet privé d'animation ni outils de communication, d'analyse d'activité ou de publication LinkedIn. Il consigne uniquement leur séparation du produit et l'absence de tout accès au coffre familial.

La démonstration permet d'examiner les principaux parcours locaux retenus par l'implémentation. Elle ne fournit pas encore de coffre utilisable avec des documents privés : authentification, ingestion réelle, OCR, SQL, S3, recherche sémantique, e-mail, rappels distants, sauvegardes et restauration restent à implémenter et qualifier. Les limites exactes et résultats exécutés sont décrits dans le README et le rapport de fondation.

L'acceptation locale exige que le projet démarre, que les interactions annoncées fonctionnent sur données synthétiques, que lint/types/tests/build passent ou soient explicitement bloqués avec preuve, et qu'une revue indépendante examine le diff réellement livré. Un résultat local ne prouve ni Dev distant ni Production. La décision de licence et celle de publication GitHub sont demandées après préparation du résultat concret.

## Carte de transposition du carnet

| Rubrique du carnet | Identifiants de couverture |
| --- | --- |
| Cadre validé, communication et dépenses | VIS-03 à VIS-05, PRIV-04, FAM-05, GOV-01 |
| Accès distant et design | UX-01 à UX-05, EXP-07 |
| Coffre documentaire et garde-fous | DOC-01 à DOC-10 |
| Profil familial | FAM-01 à FAM-05 |
| Architecture des données | DATA-01 à DATA-05 |
| Pérennité et réversibilité | PORT-01 à PORT-07, Q-06 à Q-07 |
| Connecteurs et évolution | MOD-01 à MOD-03 |
| Open source et francophonie | VIS-01, VIS-04, UX-04, OSS-01 à OSS-03 |
| Protection dès la conception | PRIV-01 à PRIV-04 |
| Animation privée du projet open source, ajout validé au carnet | PUB-01 à PUB-06 ; frontière publique précisée dans OSS-01 et VIS-04 |
| Rôle utilisateur, harnais, environnements et livraison | VIS-03, GOV-01 à GOV-06 |
| Backlog piloté par l'IA | GOV-07 à GOV-08 |
| Idées à l'étude et solutions ouvertes | EXP-01 à EXP-08 |
| Questions ouvertes et idées écartées | Q-01 à Q-07 et mention explicite ci-dessus |
| Brief final laissé vide dans le carnet | Contrat du premier lot ci-dessus, issu de la demande de fondation |
