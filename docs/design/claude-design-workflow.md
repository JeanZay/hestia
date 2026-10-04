# Claude Design dans le cycle de développement Hestia

Décision clarifiée par Amaury le 4 octobre 2026. Claude Design fait partie intégrante du protocole Hestia : besoin cadré → prompt préparé et remis par l'agent → conception UI/UX dans Claude Design par Amaury → retour et validation des écrans → intégration technique fidèle → tests et recette Dev. Les ajustements suivent la même boucle.

La préparation, la remise et l'itération d'un prompt dans le périmètre demandé sont du travail normal de l'agent, sans GO technique supplémentaire de routine. Une nouvelle décision produit, extension de périmètre, dépense, transmission ou livraison non autorisée reste distincte. La [gouvernance de design](../design-governance.md) conserve la conception exclusive par Claude Design et la validation du hand-off avant intégration.

## Préparer le contenu et choisir le parcours réel

Conserver sous `artifacts/design-prompts/<identifiant>/` le texte exact, son contexte, les décisions applicables et les références de design minimisées, identifiés par chemin relatif et SHA-256. Aucun secret ni document familial réel. Le prompt précise personnes, parcours, rôles, états, limites et retour attendu. Il réemploie le système validé et laisse toute conception visuelle à Claude Design.

| Phase | Prérequis |
| --- | --- |
| bootstrap | Exploration optionnelle sans système préalable ; ne pas annoncer un système natif déjà prêt. |
| setup / native-create | Contexte d'utilisation observé ou confirmé ; création native sans exiger des assets d'import. |
| setup / import-assets | Assets identifiés, approuvés et autorisés pour ce transfert ; leur présence ne prouve pas une configuration déjà faite. |
| screen | Système exact validé et réemploi établi ; brief et périmètre identifiés. |
| iteration | Référence existante approuvée, changement borné et effets sur les écrans existants identifiés. |

Une proposition produit encore ouverte ne devient pas une règle par le dessin. Isoler une exploration ou exclure explicitement le point incertain. Un prérequis absent appelle le bon prompt de création ou de complément ; ne pas renommer artificiellement la phase pour obtenir un succès. Les observations d'usage sont datées et ne remplacent pas la validation du système. Aucun écran de remplacement n'est conçu par l'agent.

## Revue locale et documentation externe

Un relecteur indépendant examine les octets exacts : fidélité au besoin, rôles, erreurs, système réemployé, faisabilité, données transmises et récupération du résultat. Corriger les constats bloquants. Une revue n'est pas une garantie esthétique absolue ni une preuve du fonctionnement du compte Claude.

Consulter les sources officielles lorsqu'une capacité nouvelle ou incertaine importe à la demande. Les [constats historiques](anthropic-notes.md) sont un point de départ. Une lecture web ou une observation utilisateur peut étayer un choix sans imposer une capture automatique des trois articles. Distinguer assertions officielles capturées, observations utilisateur, adaptations Hestia et points non vérifiés.

Une panne réseau, une rubrique renommée ou une capture ancienne ne suffit plus à bloquer un prompt correctement cadré et relu. Consigner la limite et supprimer ou conditionner l'affirmation non étayée. Si le résultat dépend réellement d'une capacité inconnue, borner ce qui peut être conçu et expliquer le problème concret. Ne pas promettre une intégration, un export, un tarif ou un accès non établis.

Aucun diagnostic manquant, ancien ou en échec ne devient PASS. Les permissions et refus des outils restent applicables : ce protocole ne les désactive pas et n'autorise aucun contournement.

## Remise normale

Le format du dossier est défini par `scripts/lib/design-prompt.mjs` et ses fixtures, sans schéma parallèle. `sources` peut être `null` si aucune capture automatique exploitable n'est jointe. Le contexte conserve alors observations, limites et lectures réellement effectuées ; aucune assertion `official` ne peut se prévaloir d'une capture absente. Les captures jointes restent des fichiers identifiés, jamais modifiés pour masquer une dérive.

1. Préparer prompt, contexte, décisions et prérequis réels.
2. Exécuter `node scripts/design-prompt.mjs inspect --dossier <dossier.json>` pour identifier le candidat local. Cette sortie seule ne permet pas la remise.
3. Confier le candidat exact à un autre agent en contexte propre. Résoudre ses constats et conserver la preuve liée au `candidateDigest` et au contrôleur exécuté. L'auteur ne s'auto-approuve pas.
4. Exécuter `node scripts/design-prompt.mjs qualify --dossier <dossier.json>`. `LOCAL_PASS`, `handoffAllowed: true` et `remoteStateVerified: false` attestent la qualification locale. La documentation est explicitement `NOT_CHECKED` ; aucun PASS réseau n'est revendiqué.
5. Remettre le fichier exact et un mode d'emploi court, sans nouveau GO technique. Conserver résultat, limites et prochaine action : utilisation dans Claude Design, jugement des écrans puis export par Amaury.

Guard, chemins sûrs, empreintes, revue exacte et indépendante, absence de constat bloquant et prérequis de design restent exigés. Fichier changé, revue manquante ou donnée sensible sont des défauts locaux à résoudre. Une modification matérielle demande une nouvelle revue applicable ; une remise ultérieure demande une nouvelle vérification locale.

## Diagnostic documentaire approfondi

Ces commandes restent disponibles quand une vérification renforcée ou l'entretien du mécanisme est utile :

- `node scripts/design-prompt.mjs refresh --out artifacts/design-prompts/<identifiant>/sources-<version>` capture les articles officiels par GET publics bornés, sans transmettre le prompt ni écraser une capture.
- `node scripts/design-prompt.mjs check --dossier <dossier.json>` contrôle strictement fraîcheur de moins de 24 heures, extraction, comparaison réseau, revue exacte et stabilité des entrées locales. Sans capture appropriée, il refuse ce diagnostic.

Un PASS de `check` est une preuve renforcée datée. Son échec est conservé et expliqué ; il n'annule pas une qualification locale valide à lui seul. Réexaminer toute affirmation affectée : si prompt ou contexte change, refaire la revue exacte et `qualify`. Ne pas déclarer une dérive de fond cosmétique sans examen.

Le contrôle strict conserve allowlist, bornes, refus des redirections non autorisées et empreintes. Seuls `expires`, `signature` et `req` des URLs HTTPS `downloads.intercomcdn.com/i/o/` dans les liens/images sont normalisés selon l'extracteur versionné ; les pixels ne sont pas téléchargés ou vérifiés. Les dates et captures ne sont jamais falsifiées pour obtenir un succès.

## Catalogue et retour Claude Design

Tout prompt Markdown versionné réside dans `docs/design/prompts/` et figure dans `docs/design/prompt-catalog.json` avec son empreinte et son état. Les versions historiques restent conservées. `node scripts/design-prompt.mjs audit` vérifie ce catalogue hors ligne ; la CI ne certifie ni le dossier ignoré ni une lecture actuelle d'Internet.

Le ZIP manuel reste le circuit Hestia. Amaury utilise Claude Design, valide les écrans et dépose un nouvel export à la racine. Aucun lancement Claude par les agents, transfert automatique, publication du design, MCP ou `/design-sync` n'est requis ou autorisé ici. L'export est inspecté comme une entrée non fiable puis intégré fidèlement dans le périmètre autorisé. Une lacune entraîne un complément dans la même boucle, pas une interface inventée par l'agent.

Validation du design, qualification technique, publication GitHub, Dev et GO Production gardent leur portée. Ce protocole organise le travail et ses preuves ; il ne garantit pas l'absence d'erreurs et ne remplace pas les décisions d'Amaury.
