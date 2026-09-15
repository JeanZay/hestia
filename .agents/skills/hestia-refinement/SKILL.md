---
name: hestia-refinement
description: Piloter les besoins Hestia avec Amaury, mener un refinement approfondi par rounds courts et cas limites, faire valider le cahier des charges puis découper en US seulement le besoin engagé pour développement maintenant. Préparer la reprise et le passage à hestia-delivery sans publier avant accord explicite.
---

# Affiner un besoin Hestia

Le responsable produit pilote les choix. L'agent organise les échanges, challenge les hypothèses et prépare des résultats vérifiables. Appliquer [la gouvernance](../../../docs/delivery-governance.md) ; cette skill prépare la livraison, elle n'accorde aucune autorisation d'exécuter le produit décrit.

## Partir des sources

Lire `AGENTS.md`, [le workflow produit](../../../docs/product-workflow.md), [le protocole de reprise](../../../docs/continuity.md), [la gouvernance de design](../../../docs/design-governance.md), [la spécification produit](../../../docs/product-specification.md), le contrat courant et les ADR pertinents. Relire sur GitHub l'Issue, ses commentaires, ses liens et le Project concernés ; dater les observations. Si GitHub est inaccessible, poursuivre l'exploration locale en signalant la limite, sans certifier la déduplication ou la préparation à la livraison.

Conserver le besoin original et ses nuances avant toute reformulation. Distinguer faits vérifiés, décisions explicites, hypothèses, recommandations et questions ouvertes. Une recommandation antérieure de l'agent ne devient pas une décision utilisateur. Citer pour chaque décision la réponse ou source et la date ; garder sa justification et les conséquences d'un changement.

Confronter spécification, Issue et demande actuelle. En cas de divergence, présenter les formulations et leur effet concret, puis faire arbitrer ce qui change ; ne pas écraser silencieusement une source. Distinguer cible, première version et exclusion. Dans Hestia, personnes concernées et comptes sont distincts ; les permissions ne se déduisent ni de l'âge ni du lien familial.

Utiliser le [modèle de dossier](../../../harness/templates/refinement.template.json) et son [schéma](../../../harness/contracts/refinement.schema.json) dans `artifacts/refinement/<identifiant>/`, répertoire temporaire ignoré. N'y conserver que des exemples synthétiques et des formulations sans données personnelles ni secrets ; reformuler les détails privés par des rôles génériques. Inspecter explicitement chaque fichier avant partage : le guard du dépôt exclut les fichiers ignorés et ne prouve pas leur innocuité. Le dossier de travail ne devient jamais un backlog Markdown maintenu en parallèle.

## Mener les rounds courts

Choisir généralement 3 à 5 questions ciblées par round, moins si une seule décision conditionne la suite. Éviter les questionnaires exhaustifs et adapter le prochain round aux réponses. Pour chaque question, expliquer l'enjeu et les compromis utiles ; une recommandation reste identifiable comme telle et l'utilisateur peut la corriger ou proposer une autre voie.

Après les réponses, restituer brièvement : besoin reformulé, nuances préservées, décisions acquises, incertitudes restantes et conséquence sur le périmètre. Demander correction lorsqu'une interprétation changerait le besoin. Une réponse partielle laisse les autres questions ouvertes ; silence, durée écoulée et « continue » ne valident pas des choix non exprimés.

L'agent pilote la progression : ne pas terminer un round par un simple accusé de réception qui oblige le responsable produit à relancer. Après chaque réponse, exploiter ce qui est acquis et enchaîner avec les questions encore nécessaires, une proposition concrète à arbitrer ou l'étape suivante déjà autorisée. Si une réponse humaine indispensable manque, poser la question précise et rendre visible ce qu'elle débloque ; attendre cette réponse est une étape de travail, pas un abandon. Respecter une demande explicite de pause.

Garder dans le dossier une vue finie des décisions restantes, à partir des questions, risques et préparations existants : ce qui bloque le prochain lot, ce qui peut attendre, et ce que l'agent doit instruire lui-même. Ne pas produire un questionnaire nouveau à chaque détail. Regrouper les arbitrages cohérents avec une recommandation et ses compromis ; ne pas soumettre à l'utilisateur les choix d'implémentation réversibles qui n'affectent pas son usage, ses risques, ses coûts ou ses autorisations. Des détails techniques peuvent être instruits sans réponse produit, mais une préférence proposée ne devient pas validée par défaut.

Préparer la suite dès que le besoin est suffisamment borné et testable : ne pas attendre d'avoir conçu toutes les fonctions futures. Une fois les questions bloquantes traitées, produire le brief candidat et demander son accord. Le besoin peut ensuite rester large et validé : découper seulement s'il est explicitement engagé pour développement maintenant et si le démarrage est crédible, jamais du seul fait du GO brief. Ne pas demander « veux-tu continuer ? » lorsqu'une étape utile est déjà autorisée. Signaler une nouvelle question bloquante avec la contradiction ou le risque concret qui la justifie. Les idées futures restent distinctes et ne retardent pas le lot retenu. Une consigne de persistance n'autorise ni réponse inventée, ni publication GitHub, ni exécution au-delà des accords applicables ; lorsqu'un accord manque, poursuivre les préparations autorisées puis présenter exactement la décision attendue.

Séparer quatre domaines dans le dossier :

- `product` : personnes concernées, résultat utile, priorités, inclus et exclus ;
- `ux` : parcours, états d'erreur, récupération et accessibilité selon l'usage ;
- `security` : données, pouvoirs, abus plausibles, révocation et risques acceptés ;
- `architecture` : contraintes, options techniques et conséquences réversibles ou durables.

Challenger contradictions, angles morts, hypothèses non prouvées, effets de bord et hors-périmètre. Ne pas faire choisir une technologie pour résoudre une question d'usage encore ouverte. Qualifier chaque question de bloquante ou non pour le résultat envisagé, avec raison ; un risque accepté ou un sujet différé conserve sa trace, sans être présenté comme résolu.

Avant de déclarer le besoin suffisamment cadré, « tirer dans les coins » avec des situations concrètes, au-delà du parcours nominal : chaque acteur et ses limites de pouvoir ; création, modification, retrait et transfert ; partage et données dérivées ; pertes d'accès, erreurs, interruption et reprise ; abus, limites de volume ou de temps ; suppression, récupération et effets sur les autres personnes ou espaces. Adapter cette exploration au besoin réel, sans imposer de fonctions supplémentaires. Pour chaque angle pertinent, retrouver une règle sourcée et sa preuve attendue, ouvrir une question ou expliciter l'exclusion et son effet. Une règle générale ne suffit pas si deux scénarios plausibles produisent des attentes incompatibles. Les rounds restent courts, mais leur nombre n'est pas plafonné : l'agent creuse les incertitudes utiles et ne masque pas un manque de cadrage pour atteindre plus vite le brief. Les questions de contrôle éprouvent les décisions acquises sans les remettre implicitement en négociation ; seul un risque ou une contradiction concret justifie un nouvel arbitrage.


Avant l'implémentation, confronter indépendamment le cahier des charges aux sources : chaque critère et angle pertinent doit conduire à une décision sourcée, des scénarios observables et une preuve attendue, ou à une exclusion justifiée. Documenter les quatre domaines, y compris une absence d'impact motivée. Les contrôles structurels ne garantissent pas que tout a été pensé. Un blocage transversal ne disparaît pas en rétrécissant implicitement la première US. Suivre le workflow pour pause, pivot, annulation et conflits entre capacités voisines.

## Produire le brief validable

Rassembler un brief lisible : besoin et résultat attendu, acteurs, parcours inclus/exclus, décisions par domaine, hypothèses, questions, risques et critères observables positifs et négatifs. Relier les critères aux nuances et décisions qu'ils protègent. Relever les incompatibilités avec les sources avant de demander validation.

Proposer un ADR lorsqu'une décision durable mérite une justification, un essai lorsqu'un parcours doit être éprouvé, ou un spike lorsqu'une incertitude technique doit être mesurée. Tout prototype UI passe exclusivement par un prompt pour Claude Design remis à Amaury ; ne concevoir aucun écran ni variante provisoire. Le Design System validé et versionné précède les nouveaux écrans ; intégrer seulement un hand-off suffisant, inspecté et autorisé. Chaque proposition nomme la question, le périmètre, la preuve et les critères de sortie, ainsi que son caractère bloquant ou différable. Ne pas imposer toutes les études avant tout découpage ; une étude bloquante peut former le premier lot borné si son résultat conditionne les suivants.

Les étapes du dossier sont : `exploration` → `brief-candidate` → `brief-validated` → `plan-proposed` → `publication-authorized` → `published` → `ready`. Elles décrivent les preuves disponibles, pas un champ Project automatiquement modifié. Présenter le brief candidat et identifier sa version avant de solliciter son GO explicite. Un GO sur le brief ne vaut ni publication GitHub ni exécution, Dev ou Production.

Depuis la racine du worktree, exécuter `node scripts/refinement-check.mjs <dossier.json>` pour vérifier le dossier et `node scripts/refinement-check.mjs --digests <dossier.json>` pour identifier ses contenus. Consigner uniquement les validations réellement obtenues. Les détails de format sont dans le schéma ; le modèle d'exploration n'est pas un exemple d'accord humain. Le validateur contrôle la structure et certaines cohérences, pas la qualité produit, la véracité des preuves ou l'identité de la personne qui a approuvé.

## Découper juste-à-temps, après engagement

Vérifier le checkpoint avec `node scripts/lifecycle-check.mjs --checkpoint <checkpoint.json> --action plan` et relire l'engagement et ses portées dans leur source. Sans engagement applicable, conserver le besoin large ; aucune US future n'est exigée. Un besoin large ou son brief peut être publié seul par un delta exact approuvé, sans fabriquer un plan V1 d'US. Le contrôle local ne vérifie ni la pertinence du choix de démarrage ni le consentement humain.

Transformer le seul brief validé et engagé en petites Issues verticales : chacune produit un résultat observable de bout en bout, avec critères testables et preuves attendues. Préférer un parcours étroit utilisable à des tâches séparées « frontend », « backend » et « tests ». Si un lot préparatoire ne fournit pas de parcours utilisateur, expliquer son résultat vérifiable et pourquoi il est nécessaire.

Chaque proposition précise objectif, limites, critères positifs/négatifs, contrôles et preuves, risques, dépendances et ordre. Distinguer lien parent/enfant et dépendance bloquante. Vérifier les dépendances internes et les références externes ; proposer un ordre sans cycle. Chaque dépendance à une clé interne prévoit une mutation `link-dependency` de relation `blocked-by`, soumise au GO, pour que le graphe soit porté par GitHub. Une Issue dépendante peut être planifiée alors que ses prérequis ne sont pas encore satisfaits.

Relire le backlog vivant pour détecter doublons et recouvrements avant de proposer création, réutilisation ou modification. Présenter les corps exacts et toutes les mutations prévues, y compris Issue parente, liens, labels et Project. Le plan comprend une mutation `publish-brief` pour conserver le brief complet et son empreinte dans un commentaire GitHub de référence, sur l'Issue parente ou une Issue du plan. Ce commentaire fait partie du contenu à approuver. Aucun commentaire, brouillon distant ou sous-ticket n'est une exception au GO de publication.

Avant de rendre la main, conserver le checkpoint et ses sources exactes selon le protocole de reprise. Énoncer la prochaine action prioritaire : qui agit, sur quel support/version, quel retour est attendu et ce qu'il débloque. Ne jamais conclure seulement « c'est noté » ou « la suite est prête ». Les choix réversibles d'implémentation, les tests et la revue reviennent aux agents ; Amaury ne relit pas les artefacts techniques. Respecter une pause et ne pas inventer une demande après une tâche réellement terminée.

Lire [publication et passage à delivery](references/publication-and-handoff.md) dès la préparation du GO GitHub, lors d'une reprise de publication ou pour transmettre une Issue prête. Les questions ou prérequis encore bloquants restent visibles ; ne pas inventer des réponses pour obtenir l'état `ready`.
