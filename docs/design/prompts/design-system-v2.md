# Prompt Claude Design — Design System Hestia réutilisable, v2

Ce fichier est un candidat à qualifier avant remise par le contrôle décrit dans `docs/design/claude-design-workflow.md`. Il remplace v1/v1.1 ; ce n'est ni un système configuré ni un design validé. Il vise directement un Design System réutilisable dans Claude Design, avec validations intermédiaires. Aucun passage par un projet d'amorçage distinct n'est imposé.

## Mode d'emploi pour Amaury

Dans Claude Design, utilise ton parcours habituel de création d'un Design System réutilisable, puis copie la section ci-dessous. Ne pas importer la démo Hestia comme référence graphique : elle n'a pas été validée. Aucun branchement du dépôt, connecteur ou `/design-sync` n'est demandé. Si ton interface diffère du parcours attendu, indique-moi le point rencontré ; les commandes disponibles dans ton compte priment sur un chemin d'interface supposé. Aucun achat ou usage supplémentaire payant n'est demandé.

## Texte à copier dans Claude Design

Crée avec moi le Design System réutilisable de Hestia dans Claude Design, destiné à être réemployé dans tous ses futurs projets d'interface. Travaille par étapes dans ce système ; ne livre pas toute l'application en une seule réponse. Pour commencer, aide-moi à choisir sa direction visuelle.

Hestia est un coffre numérique familial privé, francophone et open source. Chaque foyer possède sa propre instance indépendante. Sa promesse : s'entraider sans devoir tout partager. Un étudiant peut partager un dossier de location avec ses parents ; chacun peut garder des documents personnels confidentiels. Un proche peut aider une personne de n'importe quel âge avec ses propres accès.

Nous n'avons pas encore de marque, de logo ou de système Hestia validé : c'est l'objet de ce travail. Ne prends pas une référence par défaut pour notre identité validée. Distingue la proposition en cours, mon approbation et l'état réellement disponible pour réemploi dans Claude Design. Il n'est pas nécessaire d'importer des assets antérieurs pour répondre à cette demande de création native ; si un élément concret manque dans notre contexte, signale-le sans inventer sa présence.

Propose deux directions visuelles réellement différentes, chacune cohérente avec une expérience familiale accueillante, sobre et lisible. Les couleurs, typographies, formes et compositions sont tes choix : je veux pouvoir les juger visuellement et comprendre brièvement leurs compromis.

Présente une comparaison compacte sur le canvas, avec un aperçu représentatif sur téléphone et sur ordinateur. Pour chaque direction, montre quelques éléments réutilisables en situation : action, champ, fiche de document fictif et retour d'état. Organise librement cette planche pour rendre les différences faciles à comparer ; ce ne sont pas des écrans fonctionnels à développer. Privilégie la lisibilité, l'accès tactile et clavier, le focus visible et des états compréhensibles sans dépendre de la couleur seule.

Le public comprend plusieurs générations. Un compte suppose l'autonomie Internet et une adresse e-mail personnelle ; cela ne dispense pas d'une interface accessible. Une personne mentionnée dans un document peut ne pas avoir de compte. Ni l'âge, ni le lien familial, ni le fait d'aider ne donnent de permissions.

La gestion du foyer et l'accès aux documents sont distincts. Un administrateur ne lit pas automatiquement les espaces personnels et ne peut pas s'en ouvrir la lecture. Les capacités consulter, déposer, modifier, supprimer, partager, exporter et administrer restent distinctes ; une matrice de droits ne doit pas être inventée pour l'illustration. N'affiche pas de contenu privé dans une démonstration d'administration. Les détails produit encore ouverts ne doivent pas devenir des règles par le dessin.

Tous les exemples sont fictifs. Ne crée ni backend, authentification opérationnelle, service externe, intégration, partage public ou déploiement. N'inclus aucun document réel. Ne promets pas une sécurité absolue ou une fonction déjà disponible.

Le futur produit utilise React, TypeScript et Next.js ; c'est une contrainte d'intégration ultérieure, pas une demande de code maintenant. N'engage aucune dépense additionnelle.

Arrête-toi d'abord après la comparaison et demande-moi quelle direction retenir ou combiner, et quels éléments modifier. Après mon choix, complète progressivement les fondations, composants, variantes, états et règles adaptatives ; demande une validation aux moments où une décision structurante m'appartient. Des corrections ciblées peuvent se faire sur le canvas ou dans le chat.

Le système final devra être identifié par un nom et une version, avec ses règles de réemploi. Prévois un petit projet d'essai pour vérifier qu'il réutilise réellement cette référence. Distingue les éventuelles actions qui rendent le système disponible, le rattachent à un projet ou le définissent comme référence par défaut ; explique leur portée avant de me demander de les effectuer. Ne partage ni ne publie publiquement le résultat sans mon accord.

Quand nous aurons validé le résultat, nous préparerons un export ZIP pour remise manuelle aux agents Codex. Ce n'est pas un handoff natif vers Claude Code. Indique ce que contient réellement l'export, son index de lecture, les composants/états couverts, les assets avec leur provenance et leurs droits connus, et les limites. N'affirme pas que le ZIP suffit à configurer automatiquement le système dans un autre compte ni qu'il fournit nécessairement du code Next.js prêt à intégrer. Le nom de dossier local `claude-design-handoff/` est notre convention de réception, pas un format natif exigé de l'outil. Aucun export ou handoff complet n'est attendu avant notre première décision de direction.
