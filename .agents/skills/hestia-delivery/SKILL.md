---
name: hestia-delivery
description: Préparer et vérifier un lot Hestia avec contrat borné, preuves du candidat exact et revue indépendante, puis distinguer livraison locale, Dev et Production.
---

# Livrer un lot Hestia

Lire `AGENTS.md`, [la gouvernance](../../../docs/delivery-governance.md), [le workflow produit](../../../docs/product-workflow.md), [la reprise](../../../docs/continuity.md) et [la gouvernance de design](../../../docs/design-governance.md), avant tout développement même sans UI. Rappeler ces lectures aux développeurs délégués. Elles fixent les autorisations et la portée des preuves.

Pour commencer l'implémentation produit locale, retrouver le checkpoint courant et vérifier `node scripts/lifecycle-check.mjs --checkpoint <checkpoint.json> --action execute`. Relire l'engagement du besoin/version/périmètre, la qualification indépendante du cahier des charges, les scénarios et les sources d'autorisation. Un ancien V1 `ready` non qualifié ne suffit plus ; une pause ou un pivot interdit de rejouer son ancien GO. Pour une maintenance du harnais explicitement autorisée sans US produit, le contrat et la revue du besoin technique borné restent applicables : ne pas fabriquer un engagement de fonctionnalité.

Le gate `execute` couvre ce démarrage local, pas une opération GitHub, Dev ou Production. Pour ces étapes distinctes, relire les preuves de qualification initiale, les changements depuis, le contrat de l'étape et les autorisations/preuves exigées par la gouvernance de livraison. Ne jamais changer artificiellement `deliveryTarget` en `local` pour faire passer un contrat distant ; aucun succès lifecycle ne certifie un déploiement.

Vérifier l'Issue et ses prérequis dans le backlog vivant. Si le besoin reste ambigu, renvoyer les questions qui affectent le lot à [hestia-refinement](../hestia-refinement/SKILL.md) ; ne pas résoudre implicitement un choix produit. Un handoff contient une Issue réelle relue, le brief validé, ses critères et preuves, les dépendances satisfaites et l'autorisation d'exécution applicable. Contrôler son dossier avec `node scripts/refinement-check.mjs <dossier.json>`, puis le contrat avec `node scripts/refinement-check.mjs --contract <contrat.json>`. Ces résultats attestent seulement la cohérence locale, pas la réalité d'un accord humain ni une livraison distante.

- Préserver le besoin et les autorisations de la session ; ne pas redemander une permission pour le local réversible déjà autorisé. Ne pas étendre le lot à une publication, une donnée réelle, un service ou une dépense.
- Pour une UI, vérifier le Design System validé/versionné et le hand-off suffisant. Concevoir seulement le prompt Claude Design via Amaury, jamais une UI de remplacement ; continuer les seules tâches non-UI indépendantes et autorisées si le design manque.
- Borner la tâche avec [le modèle de contrat](../../../harness/contracts/task-template.json), sans créer de backlog parallèle à GitHub. Séparer les chemins des auteurs concurrents.
- Relier les critères aux tests réels, contrôler les parcours intégrés et la non-régression des capacités voisines. L'achèvement d'une US n'est pas la livraison du besoin parent. Préparer pour Amaury une recette courte de l'usage, pas une lecture du code ou des logs.
- Rassembler des résultats effectivement exécutés et l'identité du candidat. Avec un checkpoint produit applicable, lancer `node scripts/verify.mjs --checkpoint <checkpoint.json>` afin de vérifier aussi le dossier ignoré et conserver ses octets dans les preuves. Utiliser [le modèle de preuve](../../../harness/templates/run-evidence.template.json) quand un enregistrement structuré aide à vérifier le lot.
- Pour une livraison, confier le candidat exact à un relecteur distinct en contexte propre avec [le modèle de revue](../../../harness/templates/review-result.template.json). Ne pas qualifier une revue de PASS sans exécution ni identité du candidat.
- Rapporter les écarts et limites en français. Une preuve locale ne vaut pas preuve Dev et un GO Dev n'autorise pas la Production.

Avant de rendre la main, préserver les sources et preuves de reprise. Dire exactement l'action prioritaire, le support/version, le retour attendu et la suite débloquée. Continuer les étapes déjà autorisées sans demander un micro-GO ; respecter une pause ou une fin réelle sans question artificielle.

Ce skill est placé sous `.agents/skills` pour que Codex découvre son nom, sa description et son chemin au démarrage, puis charge ce fichier complet lorsqu'il l'active. Il n'installe aucun hook. Les règles et les frontières techniques restent décrites une seule fois dans la gouvernance.
