# Prompt initial — Design System Hestia

Préparé le 13 septembre 2026. Ce fichier est un prompt à remettre à Claude Design par Amaury ; il ne constitue ni un Design System, ni sa validation. Aucun hand-off n'est réputé disponible.

Copier le texte ci-dessous dans Claude Design. La convention de dossier proposée pour le résultat est `claude-design-handoff/`, à importer manuellement à la racine du projet Hestia.

---

Tu es Claude Design. Conçois le premier Design System de **Hestia**, un socle numérique familial privé, francophone et open source. Ce système sera la référence commune de toutes les futures interfaces. Amaury, responsable produit, examinera ta proposition et décidera de sa validation ; les agents de développement intégreront ensuite les éléments autorisés. Ils ne conçoivent pas l'interface et ne doivent pas inventer un Design System préexistant ou compléter eux-mêmes ses lacunes graphiques.

## Mission et liberté de conception

Crée un système cohérent, identifiable, sobre et accueillant, au service de la confidentialité et de l'entraide entre générations. Recherche une lecture facile, des actions compréhensibles et une confiance fondée sur ce que l'interface explique réellement. Évite les promesses absolues de sécurité et tout effet qui ferait paraître une capacité non disponible comme opérationnelle.

Les choix visuels t'appartiennent : direction graphique, palette, typographies, iconographie, valeurs des tokens, compositions et comportement adaptatif. Explique brièvement les choix structurants et leurs compromis. Aucun choix graphique n'est imposé par ce prompt. En revanche, les règles métier non tranchées restent des questions produit : une maquette ou une variante ne doit pas les transformer en décisions acquises.

## Contexte d'usage à respecter

Chaque foyer contrôle sa propre instance indépendante. Hestia n'est pas une plateforme SaaS réunissant plusieurs familles. Les usages centraux sont retrouver un document et poser une question dont la réponse renvoie aux documents sources. Le coffre conserve les originaux intacts ; classement, résumés et informations extraites les accompagnent. Les propositions incertaines doivent pouvoir être comprises, validées ou corrigées. Une information proposée ne se confond pas avec un fait confirmé.

L'expérience est d'abord pensée pour téléphone Android ou iPhone, puis pour tablette et ordinateur. Les textes sont en français clair, avec des formats de dates et de nombres cohérents et une possibilité de traduction future. Prévois des contenus longs et des noms de documents variables.

Le foyer peut réunir plusieurs générations et niveaux d'aisance numérique. Un proche âgé peut avoir son propre compte et recevoir de l'aide d'une autre personne utilisant son propre compte, avec des droits explicitement bornés. Une personne mentionnée dans le profil familial ou dans un document peut aussi ne pas avoir de compte. Ne déduis aucun accès de cette mention.

Les profils d'autorisation « adulte » et « enfant » sont supprimés. L'âge, le lien familial et le fait d'aider quelqu'un ne déterminent pas les permissions. Distingue le rôle global de gestion des capacités concrètes sur les ressources : consulter, déposer, modifier, supprimer, partager ou exporter, par exemple. N'invente pas de matrice de droits. Les exemples devront rendre les droits applicables compréhensibles sans suggérer qu'un rôle ou un lien familial donne automatiquement accès à tout.

## Système attendu

Propose une première version identifiée, avec un nom, une version et une date. Documente :

- Les fondations et tokens sémantiques : usages, valeurs proposées, relations et règles de réemploi. Les décisions graphiques doivent rester centralisées et compréhensibles pour l'implémentation.
- Un inventaire proportionné de composants réutilisables couvrant actions, navigation, saisie, recherche, présentation de documents, références aux sources, retours et statuts. Précise leur rôle, leurs variantes utiles et leurs limites, sans transformer cette mission en conception de toutes les fonctionnalités.
- Les états pertinents de chaque composant : repos, interaction, focus, sélection, indisponibilité, chargement, absence de contenu, réussite, erreur et récupération. Précise quand un état ne s'applique pas. Distingue une erreur technique, un accès non autorisé et une proposition attendant validation.
- Les règles d'interaction et de composition : adaptation aux tailles d'écran, hiérarchie de l'information, textes longs, densité, usage tactile et clavier, cohérence entre variantes et réutilisation dans de futurs parcours.
- Les attentes d'accessibilité de base : contrastes lisibles, focus visible, navigation clavier, noms accessibles, erreurs associées aux champs, états compréhensibles sans la couleur seule, agrandissement du texte et confort des cibles tactiles. Documente les vérifications réalisées et les limites ; aucune certification n'est demandée ni supposée.

Fournis quelques exemples minimaux illustratifs pour vérifier le système : retrouver un document, lire une information avec sa source et comprendre une action indisponible selon les droits. Ils servent à éprouver les composants et leur cohérence. Le périmètre n'inclut pas la conception exhaustive des écrans, l'authentification, un backend ou des traitements documentaires opérationnels.

## Hand-off à remettre

Prépare un ensemble documenté qu'Amaury pourra récupérer puis importer manuellement à la racine du dépôt, idéalement sous `claude-design-handoff/`. Ce nom est une convention recommandée, pas un dossier supposé déjà existant. Le résultat doit contenir :

- Un README ou index : point d'entrée, version du Design System, inventaire des fichiers, mode de lecture et correspondance entre exemples, composants et spécifications.
- Les fondations, tokens, spécifications des composants, variantes, états, interactions et règles de composition ; des références stables pour que chaque futur écran indique la version du système qu'il réutilise.
- Les assets nécessaires, leur provenance et leurs licences ou restrictions connues. Signale les droits inconnus et les dépendances manquantes, sans supposer leur réutilisation autorisée.
- Des consignes d'implémentation et d'évolution : comment utiliser les éléments existants, identifier un manque et proposer une extension versionnée avant de concevoir un nouvel écran hors système.
- Les décisions ouvertes, hypothèses, limites, vérifications effectuées et éléments nécessitant l'arbitrage d'Amaury.

Utilise les formats réellement disponibles dans ton environnement. Privilégie des fichiers exploitables et documentés ; indique exactement ce qui est exporté, ce qui reste une spécification et ce qui doit être recréé. Ne promets pas d'export natif ou de format indisponible. Le socle existant est Next.js, React et TypeScript : traite-le comme une contrainte d'intégration. Tout code éventuellement fourni reste un exemple isolé à examiner, sans remplacer le dépôt ni demander son exécution automatique.

Utilise uniquement des contenus fictifs. Aucun document familial, secret, nouveau service externe, achat ou coût supplémentaire ne fait partie de cette mission. L'import du hand-off ne vaut ni validation du design ni autorisation d'exécuter son contenu.

Le résultat réussit si Amaury peut juger la direction proposée sans lire du code et si les développeurs peuvent retrouver chaque règle nécessaire, réutiliser les composants et identifier les lacunes sans concevoir eux-mêmes les éléments manquants. Termine par les quelques arbitrages réellement nécessaires à la validation de cette première version.
