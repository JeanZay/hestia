# Agents Hestia

Hestia sert un foyer autonome. Amaury exprime le besoin, essaie Dev et donne un GO ou un non-GO ; il ne relit pas le code. Les preuves techniques et la revue sont la responsabilité des agents.

Lire [la gouvernance de livraison](docs/delivery-governance.md), source de vérité des autorisations, preuves et revues. Utiliser le skill local [hestia-delivery](harness/skills/hestia-delivery/SKILL.md) pour une modification livrable. Le skill est fourni dans le dépôt ; sa découverte automatique par un outil n'est pas supposée.

- Inspecter l'état Git avant de modifier ; conserver tout travail existant. Pour cette seule fondation initiale, le travail dans ce dossier local est explicitement autorisé. Chaque lot ultérieur utilise une branche et un worktree isolés ; séparer aussi les chemins des auteurs concurrents.
- Préparer un contrat de tâche borné à partir de `harness/contracts/task-template.json`. Une tâche locale réversible déjà autorisée ne nécessite pas une nouvelle permission.
- Séparer conception, implémentation et revue. Déléguer les sous-tâches indépendantes avec des chemins possédés explicitement. Le relecteur indépendant reçoit un contexte propre et le candidat exact ; l'auteur ne s'auto-approuve pas.
- Exécuter les contrôles pertinents ; conserver les résultats réels, leurs limites et l'identité exacte du candidat. Un contrôle en échec, absent ou non exécuté ne vaut jamais PASS.
- Données synthétiques uniquement dans le dépôt, les tests et cette fondation. Ne jamais lire, copier ou transmettre des documents familiaux réels pour enrichir des fixtures. Ne jamais conserver de mots de passe, codes PIN ou cryptogrammes de cartes dans le profil familial.
- GitHub Issues et Projects constituent l'unique backlog. Les éventuels reçus d'import sont des preuves figées, jamais un suivi parallèle.
- Le dépôt public contient le produit installable et ses outils contributeurs. Toute automatisation privée d'animation, d'analyse d'activité ou de communication du projet appartient à un projet distinct, non public et sans accès au coffre familial.
- Deux environnements durables : Dev et Production. QA désigne des contrôles et une recette sur Dev. Aucun GO local ne vaut GO Dev ou GO Production.
- La publication du dépôt public `JeanZay/hestia` et la licence Apache-2.0 ont été explicitement autorisées le 12 septembre 2026 après la fondation locale. Cette autorisation couvre le code et les outils contributeurs, les Issues, le Project et les protections GitHub ; elle n'autorise aucun déploiement Dev ou Production, secret, donnée familiale ou coût supplémentaire. Ne pas lancer Claude dans ce lot. Les contre-revues Claude futures utilisent exclusivement `claude-opus-5`, avec identité effective vérifiée ; aucune substitution ni lancement payant sans autorisation explicite.
- Terminer par les états datés « livré localement », « proposé pour GitHub », « bloqué » ou « différé », selon les preuves. Toute Production nécessite un GO explicite sur le candidat exact.

Ces consignes encadrent les agents ; elles ne constituent pas une barrière technique face à un acteur malveillant. Les hooks locaux sont volontaires ; vérifier les protections distantes effectivement configurées avant chaque intégration.
