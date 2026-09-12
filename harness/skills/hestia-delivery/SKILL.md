---
name: hestia-delivery
description: Préparer et vérifier un lot Hestia avec contrat borné, preuves du candidat exact et revue indépendante, puis distinguer livraison locale, Dev et Production.
---

# Livrer un lot Hestia

Lire [la gouvernance](../../../docs/delivery-governance.md). Elle fixe les autorisations et la portée des preuves.

À l'entrée, vérifier l'Issue et ses prérequis dans le backlog vivant. Si le besoin reste ambigu, renvoyer les questions qui affectent le lot à [hestia-refinement](../hestia-refinement/SKILL.md) ; ne pas résoudre implicitement un choix produit. Un handoff contient une Issue réelle relue, le brief validé, ses critères et preuves, les dépendances satisfaites et l'autorisation d'exécution applicable. Contrôler son dossier avec `node scripts/refinement-check.mjs <dossier.json>`, puis le contrat avec `node scripts/refinement-check.mjs --contract <contrat.json>`. Ces résultats attestent seulement la cohérence locale, pas la réalité d'un accord humain ni une livraison distante.

- Préserver le besoin et les autorisations de la session ; ne pas redemander une permission pour le local réversible déjà autorisé. Ne pas étendre le lot à une publication, une donnée réelle, un service ou une dépense.
- Borner la tâche avec [le modèle de contrat](../../contracts/task-template.json), sans créer de backlog parallèle à GitHub. Séparer les chemins des auteurs concurrents.
- Rassembler des résultats effectivement exécutés et l'identité du candidat. Utiliser [le modèle de preuve](../../templates/run-evidence.template.json) quand un enregistrement structuré aide à vérifier le lot.
- Pour une livraison, confier le candidat exact à un relecteur distinct en contexte propre avec [le modèle de revue](../../templates/review-result.template.json). Ne pas qualifier une revue de PASS sans exécution ni identité du candidat.
- Rapporter les écarts et limites en français. Une preuve locale ne vaut pas preuve Dev et un GO Dev n'autorise pas la Production.

Ce skill n'installe aucun hook et ne garantit pas sa propre découverte automatique. Les règles et les frontières techniques restent décrites une seule fois dans la gouvernance.
