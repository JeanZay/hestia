# Claude Design — constats officiels et limites

Vérification du 15 septembre 2026. Cette note sert d'orientation ; elle n'est jamais une preuve de fraîcheur pour un prochain prompt. Relire les sources selon le [contrôle de remise](claude-design-workflow.md).

## Sources primaires

| Source | Constat utile | Conséquence Hestia |
| --- | --- | --- |
| [Démarrage, 6 août 2026](https://support.claude.com/en/articles/14604416-get-started-with-claude-design) | Création conversationnelle, itération et export ZIP ; transfert synchronisé décrit vers Claude Code. | Procéder par étapes ; remise manuelle du ZIP à Codex, sans prétendre à un connecteur natif ou à un export Next.js garanti. |
| [Configuration du système, 6 août 2026](https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design) | Le parcours décrit part de ressources visuelles, produit un système, le fait éprouver puis rend son usage disponible. | Une planche ou un ZIP n'établit pas qu'un système est configuré et réemployé dans Claude Design. |
| [Administration, 23 juillet 2026](https://support.claude.com/en/articles/14604406-claude-design-admin-guide-for-team-and-enterprise-plans) | Sans système, la sortie reste générique ; rendre un système disponible et le choisir par défaut sont distincts. | Ne pas appliquer les réglages d'une organisation sans vérifier leur portée et la situation d'Amaury. |

La page de démarrage mentionne web et Desktop ; la page d'administration plus ancienne indique encore web uniquement. Retenir la source la plus récente pour cette différence, sans présumer les commandes visibles dans le compte. Aucun essai connecté n'a été réalisé.

## Adaptations propres à Hestia

Hestia n'a pas encore de référence visuelle validée. Amaury confirme le 15 septembre 2026 qu'il a déjà créé à plusieurs reprises des Design Systems réutilisables dans Claude Design. Ne pas transformer le guide d'import depuis des ressources en interdiction de création native. Le parcours retenu crée directement le système dans Claude Design et fait valider ses étapes. L'import depuis des assets est une autre voie ; ses prérequis ne sont pas imposés à la création native. Les détails d'interface non vérifiés restent conditionnels.

Le dossier local `claude-design-handoff/`, la nomenclature de versions et la remise à Codex sont nos conventions. Une exportation peut contenir des spécifications ou du code à adapter : l'inspection réelle décide de ce qui est intégrable. Ne jamais convertir un nom de dossier demandé en capacité native de l'outil.

Le prompt v1/v1.1 mêlait direction, système complet et export sans validation intermédiaire, et ne demandait pas de preuve de réemploi dans Claude Design. Il n'est plus remis tel quel. Le [prompt v2](prompts/design-system-v2.md) vise le système réutilisable avec un premier choix de direction ; les précisions suivantes dépendront du retour réel. Une correction temporaire imposant un amorçage séparé a été retirée après le retour d'Amaury, sans lui avoir remis cette version comme prompt à exécuter.

## Limite de la qualification

« À jour » signifie compatible avec les sources officielles relues et les prérequis connus au moment du contrôle. Aucune lecture documentaire, revue ou commande ne garantit un résultat esthétique optimal ni l'absence de toute erreur. Consigner les écarts observés dans le prochain dossier ; ne pas ajouter un conseil universel sans preuve d'utilité.
