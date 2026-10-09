# ADR-0008 — Corbeille de dossiers et restauration exacte

9 octobre 2026. Issue #40, à partir des règles validées et du hand-off Claude Design V2. Cette décision décrit le fonctionnement local ; les rapports du candidat attestent séparément les contrôles exécutés.

## Membres, droits et placement

La suppression crée un groupe contenant exactement les dossiers et documents actifs du sous-arbre au moment de la confirmation. Les anciennes suppressions restent indépendantes : aucun membre ajouté, aucune échéance prolongée. Le serveur exige Consulter et Supprimer sur tout l’ensemble ; un manque provoque un refus entier et neutre. Une seule transaction de politique écrit l’ensemble, son heure de suppression et son reçu.

La corbeille ne montre que les racines encore récupérables sur lesquelles l’acteur dispose de Consulter et Supprimer, sans compteur de membres. La restauration recontrôle tout le groupe avec les droits actuels. Une projection de politique neutralise uniquement le masquage de la corbeille, sans modifier grants, restrictions, epochs ou échéances. Cette projection reste réservée à ces contrôles : navigation, lecture, aperçu et téléchargement ordinaires restent fermés.

La restauration remet exactement les membres du groupe. Un ancien document ou groupe supprimé n’est jamais restauré avec son parent. La destination initiale doit rester disponible ; une autre destination réemploie la politique de déplacement ADR-0007, y compris les effets sur les anciens groupes récupérables et les dépendances extérieures. Aucun grant ni gestionnaire n’est créé implicitement. Un conflit de nom exige un nouveau nom explicite, sans fusion ou écrasement. Un document membre d’un groupe ne peut pas être restauré séparément.

## Temps, interruptions et purge

La fenêtre est de 168 heures écoulées, selon l’horloge serveur après acquisition du verrou commun de politique. À égalité avec l’échéance, la lecture des métadonnées et la restauration sont refusées même si la purge physique attend. Les aperçus lient l’acteur, son epoch, l’intention et l’état courant ; les échéances affectant leur résultat les périment. La transaction recontrôle l’heure avant de valider ses effets.

Un reçu durable lié à l’acteur, à son epoch et au corps exact permet de vérifier une réponse perdue. Il ne retourne que le statut historique ; il n’applique jamais une seconde fois une suppression ou restauration, même après un autre cycle ou une purge. Les aperçus et reçus ne conservent aucun nom ni projection d’accès.

Le registre de suppression d’objets existant assure la reprise après panne. Les octets restent imputés jusqu’à confirmation de leur effacement. La purge retire les noms et métadonnées affichables des dossiers échus ; des lignes techniques opaques préservent les parentés, références de gestion, reçus et autres groupes qui en dépendent. Elles ne sont pas des dossiers navigables. Les sauvegardes ne sont pas présentées comme immédiatement effacées.

## Interface et qualification

L’interface réemploie la Corbeille, les confirmations et le panneau de restauration du hand-off V2, ainsi que le sélecteur et AccessImpact existants. Une révocation connue retire les informations du panneau et de la liste. Les résultats incertains restent en mémoire et se vérifient via les reçus avant toute reprise.

La qualification distingue politique pure, sessions HTTP et transactions SQL, objets S3, sauvegarde synthétique et parcours locaux sur ordinateur et téléphone. La sauvegarde vérifie aussi les membres exacts, échéances, reçus, parentés, droits courants et imputations après restauration dans une cible vide. Aucun résultat local ne vaut recette Dev ou Production.
