# Qualifier chaque prompt Claude Design avant remise

Règle Hestia du 15 septembre 2026. Ce circuit s'applique aux premiers prompts, variantes, corrections et demandes complémentaires, y compris dans les dossiers locaux ignorés. La [gouvernance de design](../design-governance.md) conserve les autorisations ; les [constats Anthropic](anthropic-notes.md) donnent les références de départ, jamais une certification permanente.

## Résultat attendu et portée du mécanisme

Avant de remettre un prompt, l'agent doit établir que les fonctions demandées correspondent aux sources officielles actuelles et au contexte connu d'Amaury. Le script vérifie les octets, les prérequis déclarés et les preuves. Un relecteur indépendant juge leur pertinence et les affirmations du prompt. Aucun de ces contrôles ne garantit une esthétique « SOTA », une vérité complète ou le fonctionnement du compte sans essai.

Une demande ne doit pas être improvisée directement dans le chat pour éviter ce circuit. Rédiger le texte dans un fichier identifié, faire contrôler sa version exacte, puis remettre ce fichier et le mode d'emploi. Ne pas modifier son texte dans la réponse après le contrôle : toute modification demande une nouvelle qualification.

Le mécanisme ne peut intercepter tous les messages d'un agent ni empêcher un propriétaire du dépôt de le désactiver. Il rend les omissions détectables et bloque la commande encadrée de remise. Les règles ne deviennent systématiques depuis main qu'après leur intégration autorisée et vérifiée.

## Choisir le parcours réel, pas un prérequis imaginaire

| Phase du dossier | Condition de remise |
| --- | --- |
| `bootstrap` | Exploration optionnelle sans système préalable ; ne pas affirmer un système natif déjà prêt. Ce n'est pas un passage obligatoire. |
| `setup`, `native-create` | Création d'un système réutilisable dans Claude Design. Consigner le contexte d'utilisation observé/confirmé, sans imposer des assets préexistants. Ne pas déclarer le résultat validé avant qu'il existe. |
| `setup`, `import-assets` | Import/extraction depuis des assets identifiés, approuvés et autorisés pour ce transfert. Leur présence ne prouve pas que le système a déjà été configuré. |
| `screen` | Design System exact, validation et réemploi/rattachement établis ; brief du parcours qualifié et périmètre autorisé. |
| `iteration` | Référence existante, périmètre du changement et état de validation identifiés. Une extension ne doit pas être présentée comme déjà approuvée ; réexaminer les écrans affectés. |

La création native est explicitement confirmée par l'expérience d'Amaury. Le guide d'import ne l'interdit pas. Si les pages officielles, l'interface observée ou leurs dates divergent, relever la contradiction, expliquer la voie retenue et refuser seulement l'affirmation non étayée. Ne pas inventer une limitation puis l'imposer au responsable produit.

Les corrections du système initial encore en construction restent en phase `setup` avec le mode réel et les références de travail dans le contexte. La phase `iteration` désigne l'évolution d'une référence de base déjà approuvée, pas toute relance de conversation. Une observation d'usage datée peut être jointe à n'importe quelle phase ; elle ne remplace jamais la validation du système requise pour un écran.

Les propositions produit encore ouvertes ne peuvent être fixées par le dessin. Une exploration peut les écarter explicitement ; un écran dont le comportement en dépend attend leur arbitrage. Le relecteur doit vérifier cette frontière, qui ne se réduit pas à un booléen technique.

## Préparer les entrées

Dans `artifacts/design-prompts/<identifiant>/`, conserver le dossier JSON et les références minimisées : prompt, brief/contexte, décisions applicables, observations d'usage, éventuel système/assets et leurs validations. Chaque référence porte chemin relatif et SHA-256. Ne pas utiliser de chemins liés, secrets ou données réelles. Les noms d'auteur/relecteur sont des traces déclaratives : l'agent coordinateur vérifie réellement leur séparation.

Le dossier distingue chaque assertion de capacité : source officielle, observation d'usage datée, adaptation Hestia ou point non vérifié. Une incertitude est expliquée ou exclue de la demande, jamais cachée sous un lien générique. Les droits et tarifs d'un compte, une intégration native ou un format d'export ne se déduisent pas d'un exemple d'un autre produit Claude.

Le format exécuté est défini par `scripts/lib/design-prompt.mjs` et ses fixtures dans `tests/harness/fixtures/design-prompt/`. Pas de second schéma parallèle à maintenir. Les champs principaux sont phase/mode, prompt, contexte, décisions, demandes, assertions, prérequis, sources et revue. `nativeDesignSystemReady` reste faux tant qu'aucune preuve de système approuvé n'est fournie.

## Lire, examiner, contrôler

1. Lire réellement les sources officielles pertinentes, dont les guides de démarrage et de Design System. La simple disponibilité HTTP n'est pas une compréhension. Vérifier également les nouveautés pertinentes si la demande invoque une fonction récente ; tout fait supplémentaire doit être sourcé et examiné. Ne pas employer la documentation API, Artifacts ou Claude Code comme preuve d'une fonction Claude Design.
2. Capturer les sources de référence avec `node scripts/design-prompt.mjs refresh --out artifacts/design-prompts/<identifiant>/sources-<version>`. La commande n'envoie aucun prompt : uniquement des GET publics vers les articles autorisés, avec taille/durée bornées et refus des redirections non autorisées. Conserver le reçu et les contenus sans écraser une capture existante.
3. Rédiger le dossier avec les empreintes réelles ; lancer `node scripts/design-prompt.mjs inspect --dossier <dossier.json>`. Le résultat identifie le candidat à relire ; il ne permet pas la remise.
4. Confier le prompt, ses sources, décisions et prérequis exacts à un autre agent en contexte propre. Faire examiner faisabilité, fidélité produit, choix du parcours, hypothèses, données transmises et mode de récupération du résultat. Produire un avis et une preuve liés au `candidateDigest`, sans que l'auteur s'attribue le verdict indépendant. Reprendre tout constat bloquant.
5. Juste avant remise, exécuter `node scripts/design-prompt.mjs check --dossier <dossier.json>`. Seul ce contrôle peut produire le PASS de remise : sources capturées depuis moins de 24 heures, pas de date future, revue applicable, inputs inchangés et GET actuels comparés aux articles capturés. Les inputs locaux sont relus après le réseau. La fenêtre de 24 heures est une règle prudente Hestia, pas une garantie Anthropic ; elle ne dispense jamais du GET au moment du contrôle.
6. Conserver le reçu, l'identité du prompt et ses limites avec la prochaine action. Donner à Amaury le fichier exact et ce qu'il doit faire/rapporter. Un reçu ancien, une capture seule ou un audit CI ne remplace pas une nouvelle commande de contrôle pour une nouvelle remise.

Le contrôle lie la revue au dossier complet et au contrôleur exécuté, pas seulement au texte du prompt. Un changement de brief, prérequis, assertion, source ou mécanisme impose de refaire examiner la partie affectée. Une récupération HTTP réussie après une dérive ne transforme pas l'ancien avis en avis actuel.

### Refus utiles

Absence réseau, page non conforme, source changée, revue absente/non indépendante, hash différent, prérequis manquant : ne pas remettre le prompt, même sous l'étiquette « non qualifié ». Continuer les recherches ou corrections autorisées et expliquer la pièce manquante. Ne pas changer une date, déplacer un fichier ou renommer la phase pour faire disparaître un refus. Les sorties `CANDIDATE` et `AUDIT_PASS` ne sont jamais un PASS de remise.

Les captures conservent le brut ; la comparaison porte sur le titre et l'article, sans retrait du contenu de fond. La version d'extraction est identifiée. Seules les valeurs `expires`, `signature` et `req` des URLs HTTPS `downloads.intercomcdn.com/i/o/` dans les liens/images sont neutralisées : leur volatilité a été constatée le 15 septembre sans autre différence entre deux captures. Leur sémantique interne complète n'est pas documentée par les sources consultées. Hôte, chemin, fragments, autres paramètres, texte et attributs restent comparés. Les pixels des images ne sont pas téléchargés ni vérifiés par ce contrôle ; examiner manuellement les illustrations si une affirmation en dépend. Toute autre différence technique provoque encore un refus conservateur, à documenter plutôt qu'ignorer silencieusement.

## Couverture durable dans le dépôt

Tout prompt Markdown versionné réside dans `docs/design/prompts/` et figure dans `docs/design/prompt-catalog.json` avec son empreinte et son état. Les versions historiques ou dépréciées restent conservées mais ne doivent pas être remises. Ne pas déplacer un prompt hors de ce chemin pour éviter son inscription.

`node scripts/design-prompt.mjs audit` vérifie ce catalogue hors ligne ; `verify` et les tests du harnais l'exécutent. La CI ne relit pas Internet et ne certifie ni le dossier ignoré ni son actualité. Les prompts ignorés sont contrôlés explicitement par `check --dossier` avec leurs propres empreintes. Le catalogue n'est ni un backlog ni une liste d'approbations visuelles.

## Réemploi et retour d'expérience

Après usage, conserver l'identité du système, sa version, les validations d'Amaury et une preuve de réemploi sur un projet d'essai. Vérifier séparément les réglages de disponibilité, de référence par défaut et de rattachement au projet selon ceux réellement présents ; ne pas activer un partage ou réglage d'organisation sous un simple GO de prompt.

Le ZIP manuel vers Codex demeure le circuit Hestia. Le handoff Claude Code, un MCP ou `/design-sync` ne sont ni nécessaires ni autorisés par cette procédure. Inspecter l'export selon la gouvernance avant exécution ou intégration. Pour toute lacune, préparer un complément à partir des artefacts réels et faire passer ce complément par le même contrôle.
