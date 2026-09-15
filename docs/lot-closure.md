# Clôture des lots et intégration pilotée par les agents

Décision d'Amaury du 15 septembre 2026. Ce protocole complète la [gouvernance de livraison](delivery-governance.md) ; il ne donne aucun GO de publication, merge ou Production. Amaury décide du résultat et des autorisations, jamais des commandes Git à effectuer.

## Obligation de résultat

Un lot développé doit aboutir à une intégration vérifiée, à une demande d'accord précise sur le candidat, ou à un blocage/report explicitement justifié. « Tests verts » et « livré localement » ne signifient pas « intégré ». Dès qu'un accord applicable couvre l'intégration, l'agent poursuit lui-même PR, contrôles, résolution des conflits, revue des changements nécessaires, merge et vérification du résultat. Si l'accord manque, il le demande sans attendre une relance d'Amaury. Une modification matérielle du candidat exige de revoir les preuves et l'accord affectés.

Avant de lancer un autre lot, traiter les intégrations en attente ou leur disposition explicite. Ne pas contourner cette priorité en renommant le lot ni en déclarant tous les travaux « en cours ». Le parallélisme au sein d'un lot autorisé reste possible avec des réservations de chemins disjointes ; il ne dispense pas de son intégration commune.

## Contrôleur partagé au clone

Le contrôleur `scripts/closure.mjs` lit les branches et worktrees réels depuis Git et retrouve la racine primaire par le répertoire Git commun. Le registre fixe `artifacts/closure/registry.json` de cette racine est partagé par les worktrees, y compris quand le point de reprise produit est ailleurs. Il ne doit pas être dupliqué par worktree. Il décrit seulement les branches techniques présentes, leur lot, cible, candidat, preuves, accords et disposition. Ce n'est ni un catalogue de besoins ni une copie des statuts du Project : GitHub reste le seul backlog.

Les sources et preuves référencées sont des fichiers minimisés, bornés, identifiés par SHA-256 et conservés sous la racine primaire. Conserver les versions antérieures avant tout changement ; une empreinte mise à jour ne renouvelle pas un accord. Un registre absent, un chemin lié, une source illisible, une branche inconnue ou une preuve incohérente doit produire un refus exploitable, pas un registre vide ni une réussite par défaut. Un nouvel agent reprend la réparation de cet état sans créer de branche supplémentaire pour contourner le refus.

| Porte | Ce qu'elle doit établir |
| --- | --- |
| Vérification/reprise | Inventaire réel couvert, état et références cohérents ; peut afficher une attente sans la faire disparaître. |
| Démarrage | Aucun lot oublié ou prioritaire sans disposition ; réservation explicite de la nouvelle branche et de ses chemins. |
| Fin de tour de delivery | Candidat et preuves identifiés, disposition et prochaine action ; un état working n'est pas une fin de lot. |
| Merge | Accord correspondant au dépôt, à la PR, à la cible et au candidat ; preuves/revue applicables, puis relecture distante avant mutation. |
| Nettoyage | Sort du travail établi, absence de travail à perdre et préservation vérifiée des sources nécessaires. |

Commencer par `node scripts/closure.mjs status`, puis le contrôle de l'action concernée. Lire les diagnostics et poursuivre les corrections autorisées. Un contrôle structurel de l'accord ne prouve jamais l'identité de son auteur ni sa portée réelle : l'agent relit la réponse d'Amaury. Les schémas et commandes détaillées sont les sources du format ; Amaury ne les remplit et ne les relit pas.

## Commandes encadrées et preuve de mutation

Le démarrage d'une nouvelle branche passe par la commande `start`, avec une réservation sourcée et `--apply`. La destination est un nouveau sous-dossier borné de `artifacts/worktrees` de la racine primaire ; aucun chemin existant ni worktree voisin ne doit être écrasé. Le contrôleur prend un verrou partagé, recontrôle les prérequis, conserve une intention et inscrit le résultat. Un échec partiel doit rester explicite et bloquer une relance automatique ; ne pas supprimer son verrou ou sa trace pour tenter à nouveau sans réconciliation.

Le merge passe par la commande `merge --apply` sur le lot et la branche identifiés. Elle n'accorde pas la permission de publier le code ni ne crée une PR implicite. L'agent prépare auparavant le delta GitHub autorisé, relit la PR et son SHA, et conserve les preuves minimisées. L'exécution exige une précondition sur le SHA de tête et n'emploie ni contournement administrateur ni suppression automatique de branche. Les protections et contrôles doivent être satisfaits, pas seulement annoncés dans un fichier. La [commande GitHub de merge](https://cli.github.com/manual/gh_pr_merge) fournit cette précondition ; le harnais conserve ses propres frontières d'accord et de preuve.

Après la mutation, relire la PR fusionnée, le commit résultant et sa présence dans la cible distante. Un retour ambigu est une opération à réconcilier, pas un échec à rejouer aveuglément. Une PR seulement fermée, un SHA différent ou une ancienne capture ne prouvent pas cette intégration. Un reçu local relate l'observation distante datée ; sa relecture hors ligne ne devient pas une nouvelle vérification réseau.

Le merge distant ne réécrit pas silencieusement le checkout local principal. L'agent le synchronise ensuite sans écraser de travail existant, puis requalifie le point de reprise et les références affectées. Les Issues et le Project sont mis à jour dans le périmètre autorisé ; une PR fusionnée ne clôt pas automatiquement le besoin parent ni ne livre Dev ou Production.

## Préservation et nettoyage

Le contrôle de nettoyage est distinct d'une suppression. Avant tout retrait, inventorier modifications, fichiers non suivis et ignorés, auteurs encore actifs et dépendances entre worktrees. Un répertoire Git propre peut contenir les seuls exemplaires d'un brief, d'un accord, d'une preuve ou d'un hand-off ignoré. Les préserver hors du worktree, vérifier les octets et la reprise depuis la destination, puis seulement retirer les cibles exactes et devenues inutiles dans le périmètre autorisé. Le checkout principal, les travaux inconnus et les liens restent protégés.

Une réussite du contrôle ne prouve pas qu'une suppression a eu lieu. Ne pas employer de suppression forcée globale ni déduire que tout contenu ignoré est reproductible. Si le nettoyage n'est pas réalisé, le dire avec les chemins conservés et la raison ; conserver un worktree utile n'est pas un défaut, l'oublier sans disposition en est un.

## Raccordement et limites

`verify` exécute le contrôle local de clôture et fige son état partagé avant/après les tests. Le résumé refuse un ancien PASS si le registre, une référence ou l'inventaire a changé. En CI sans registre local, l'état de ce clone est explicitement non vérifié ; les tests synthétiques des mécanismes restent exécutés. Les sources ignorées ne sont jamais publiées pour satisfaire une CI.

Les hooks fournis appellent aussi le contrôleur. Ils ne sont effectifs que lorsqu'ils sont configurés : vérifier `core.hooksPath` et l'emplacement résolu. Après intégration autorisée, utiliser un chemin stable du checkout principal, jamais un chemin vers un worktree destiné au nettoyage, et tester les refus avant d'annoncer l'activation. Ne pas écraser un hook tiers sans examen. Durant un candidat local non intégré, distinguer exécution directe des portes, essai des hooks et installation permanente.

Ces mécanismes rendent les omissions détectables et bloquent les commandes encadrées. Ils ne sont ni un ordonnanceur permanent, ni une signature de consentement, ni une barrière contre un propriétaire qui modifie le registre, désactive les hooks ou utilise Git directement. Ne jamais annoncer une garantie plus large que les chemins effectivement contrôlés.
