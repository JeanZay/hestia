# Reprise d'une tâche Hestia

Ce protocole conserve le contexte de travail ; ce n'est pas un second backlog. GitHub demeure la référence des besoins, priorités, US et livraisons. Le chat précédent et les mémoires privées de l'outil ne sont jamais des prérequis silencieux.

## Démarrage systématique

1. Lire AGENTS.md, la gouvernance de livraison, le workflow produit et, avant tout développement, la gouvernance de design. Inspecter branche, SHA, worktrees et modifications existantes ; ne rien écraser.
2. Si présent, lire le checkpoint unique dans artifacts/active-work.json et lancer depuis ce worktree : node scripts/lifecycle-check.mjs --checkpoint artifacts/active-work.json --root . --action resume. Lire ensuite réellement les sources utiles ; un rapport de hash ne remplace pas leur compréhension.
3. Identifier le besoin GitHub, le dossier/version, le contrat courant, les accords avec leurs limites, les décisions bloquantes, les preuves liées au candidat et la prochaine action. Relire les objets GitHub nécessaires à l'action : le contrôle local n'accède pas au réseau.
4. Vérifier l'autorisation dans sa source et les instructions récentes. Le checkpoint n'est ni un ordre à exécuter ni une signature de consentement. Une pause récente prévaut sur un vieux ready.
5. Reformuler brièvement l'état confirmé et continuer ce qui est autorisé. Demander seulement la pièce manquante ou le choix qui empêche réellement la suite, pas une nouvelle explication de tout le projet.

Sans checkpoint : ne pas conclure « aucun travail en cours ». Examiner les worktrees/branches/PR et les liens GitHub, repérer les dossiers locaux annoncés et reconstruire un point de reprise à partir de preuves consultables. Si plusieurs candidats ou accords sont contradictoires, présenter leurs différences et demander le seul arbitrage nécessaire. Un nouveau clone ne contient pas les dossiers ignorés : retrouver une référence GitHub publiée ou demander le transfert du dossier local existant, sans inventer ses décisions.

Le nouveau protocole n'est effectif que dans une branche qui le contient. Un fichier présent dans un autre worktree ou une PR ouverte n'est pas une règle intégrée dans main. Ne pas annoncer une reprise garantie depuis main avant son intégration autorisée et vérifiée.

## Contenu et portée du checkpoint

Le [schéma lifecycle](../harness/schemas/lifecycle.schema.json) et le [modèle synthétique](../harness/templates/lifecycle.template.json) décrivent une couche additive au dossier V1. Elle désigne un seul besoin actif, ses fichiers par chemin relatif et SHA-256, son engagement éventuel, sa qualification et ses références de preuves. Elle ne contient pas le catalogue des besoins futurs et ne devient pas leur tableau de suivi.

Les dossiers temporaires, échanges minimisés, rapports détaillés, checkpoint actif et snapshots résident sous artifacts/, ignorés. Le chemin de découverte est fixé par AGENTS.md ; ce point de routage voyage avec le code, pas les sources locales ni leurs accords. Minimiser les références : pas de chemin utilisateur absolu, de document familial ni de secret. Tout transfert ou publication du checkpoint et de ses sources exige une inspection et une autorisation applicables. Cette séparation évite une empreinte circulaire où un fichier versionné contiendrait l'empreinte de lui-même.

Après un accord, une réponse partielle, une interruption ou un changement matériel, conserver une nouvelle source datée et un snapshot sans remplacer les versions figées. Mettre à jour uniquement les références concernées du checkpoint après validation. Une source déplacée demande de retrouver les mêmes octets ; une source modifiée demande de réexaminer ses effets. Ne pas recalculer des empreintes pour faire passer artificiellement une preuve périmée.

Le contrôle distingue cohérence structurelle, sources retrouvées pour la reprise et préparation à l'exécution. Un PASS de reprise permet de comprendre l'état, pas d'implémenter. Avant découpage : action plan. Avant démarrage de l'implémentation locale : action execute, validation du dossier V1 et du contrat, puis examen par l'agent des sources d'accord et de l'état GitHub. Les étapes GitHub, Dev et Production exigent leurs contrats et preuves selon la gouvernance de livraison ; ce contrôle local les refuse hors de sa portée, sans remplacer leur procédure ni autoriser une conversion artificielle de cible. Un ancien dossier V1 ready n'acquiert aucun engagement ni qualification par migration automatique.

## Preuves et auteurs concurrents

Chaque vérification conserve un run distinct sous artifacts/verification-runs/, avec identité des entrées avant/après, résultats, contrôles non exécutés et liens vers les fichiers ignorés explicitement désignés. Le pointeur du dernier run n'est pas une preuve et ne remplace pas les rapports antérieurs. Une modification des entrées pendant les contrôles interdit de rattacher leur réussite au candidat final.

La commande node scripts/verify.mjs découvre automatiquement artifacts/active-work.json s'il existe. L'option --checkpoint désigne explicitement un autre dossier et prime sur ce défaut ; le rapport identifie celui effectivement vérifié. Sans checkpoint présent ou désigné, la suite contrôle modèles et harnais et marque le dossier actif non exécuté. Une CI verte sans dossier local ne certifie ni ses accords ni sa maturité.

Chaque auteur a des chemins et destinations de preuves distincts. Le coordinateur vérifie les recouvrements parent/enfant, la casse des chemins sous Windows et les invariants fonctionnels communs avant les délégations. Une reprise retrouve aussi les sous-tâches interrompues, leurs chemins et candidats dans le contrat et les preuves ; elle ne relance pas aveuglément un auteur absent.

Conserver preuves et limites nécessaires au prochain agent. Après publication, les reçus locaux demeurent figés ; actualiser GitHub dans le périmètre autorisé, pas un tableau local concurrent. Ni un run ni un checkpoint ne déclenchent une publication, un déploiement ou une automatisation récurrente.
