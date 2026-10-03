# ADR 0003 — Exception locale bornée pour l'audit des outils de développement

Date : 3 octobre 2026. Statut : **EXCEPTION_PENDING_APPROVAL**.
Cette proposition technique permet les contrôles locaux du candidat. Elle exige
un GO explicite avant publication GitHub et n'autorise ni merge, ni déploiement.
La revue indépendante conserve son pouvoir de demander des corrections ou de bloquer.

## Constat et exposition

[GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
relu le 3 octobre 2026, concerne `braces <= 3.0.3`. La fiche annonce une sévérité
haute et aucune version corrigée. Des motifs d'accolades très profondément imbriqués
peuvent épuiser la pile du processus Node. Cette exception ne nie pas le défaut.

Le lockfile et l'installation de ce candidat contiennent une seule chaîne concernée :

`eslint-config-next@16.3.8 → @next/eslint-plugin-next@16.3.8 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3`.

Ces cinq entrées sont exclusivement `dev: true`. Les cinq alertes hautes du rapport
npm sont les effets d'un même avis, pas cinq failles indépendantes. Leur nombre
reste néanmoins **5** dans la sortie brute : il n'est jamais réécrit à zéro.

L'appel à `fast-glob` dans le plugin Next sert à résoudre les chemins racine des
projets, à partir de la configuration ESLint du dépôt. L'application Hestia ne reçoit
pas de motifs glob d'un utilisateur pour les transmettre à cet outil. La configuration
du dépôt demeure une entrée de confiance à relire ; exécuter un lint depuis une
configuration tierce hostile n'est pas couvert par cette analyse. Une contribution
modifiant les motifs, les outils ou la chaîne impose une nouvelle évaluation.

Ces dépendances de lint ne font pas partie des dépendances Production ni de la
sortie standalone attendue. Leur absence effective du paquet standalone doit être
contrôlée sur le build qualifié ; le seul drapeau `dev` du lockfile ne prouve pas le
contenu d'un artefact de déploiement. Aucune qualification distante n'est déduite ici.

## Porte automatisée et limites de l'exception

`node scripts/dependency-audit.mjs` exécute les audits npm complets et `--omit=dev`,
en lecture seule, sans `audit fix` ni installation. Toute alerte Production bloque.
La chaîne ci-dessus est la seule exception haute admise : avis unique exact,
versions installées et verrouillées exactes, chemins `nodes` exacts, `via` et
`effects` exacts, dépendances et consommateurs uniques, marqueurs de développement.
Une autre faille haute/critique, un changement du graphe ou des informations de
correction, une réponse malformée, une erreur réseau, un timeout ou un code de sortie
inattendu produisent un échec. Les compteurs du rapport sont recoupés avec ses lignes.

L'exception expire le **3 novembre 2026 à 00:00 UTC**. Elle n'est pas reconduite
automatiquement. Une correction amont ou un nouvel avis demande une réévaluation,
une mise à jour adaptée et les contrôles du candidat. Le script renvoie un code zéro
lorsque le périmètre technique exact est reconnu, avec l'état explicite
`EXCEPTION_PENDING_APPROVAL`, `publicationAuthorized: false` et les compteurs bruts.
Ce résultat ne constitue donc pas un accord de publication ni un « zéro vulnérabilité ».

L'alternative proposée par npm est le retour d'`eslint-config-next` à `14.2.35`,
signalé comme changement majeur. Elle n'est pas appliquée : décaler la configuration
de lint de Next 16 vers Next 14 introduirait une incompatibilité de versions dans le
but de faire disparaître un compteur. Aucun downgrade silencieux ni patch de
`node_modules` n'est retenu.
