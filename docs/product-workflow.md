# Pilotage produit agentique

Décision du 15 septembre 2026. Ce document fixe le fonctionnement, pas un backlog ni une autorisation générale de publier. La [gouvernance de livraison](delivery-governance.md) reste la référence des pouvoirs et preuves.

## Responsabilités et horizon

Amaury exprime le besoin, tranche l'usage, les priorités et les risques durables, puis essaie le résultat et décide son GO. Il n'écrit et ne relit aucun code, test, JSON ou configuration. Les agents instruisent les choix techniques, tiennent le backlog autorisé, découpent, exécutent, testent et font relire indépendamment. Un doute technique n'est pas une tâche de vérification à lui transférer.

Un seul besoin est en refinement approfondi à la fois, selon l'accord explicite d'Amaury. Les autres restent des besoins larges dans GitHub. Les agents recommandent le prochain besoin avec raisons, dépendances et risques ; un choix de priorité non exprimé revient à Amaury, sauf délégation explicite applicable. Les US indépendantes du besoin engagé peuvent être développées en parallèle, avec chemins distincts et invariants métier partagés examinés.

| Moment | Contenu utile | Ne déclenche pas |
| --- | --- | --- |
| Besoin large | Situation, personnes, résultat recherché, inconnues majeures et liens | Estimation détaillée, toutes les décisions, US futures |
| Refinement actif | Rounds courts, décisions sourcées, parcours et cas limites du périmètre retenu | Développement ou publication implicites |
| Brief validé | Référence exacte approuvée ; peut rester en attente | Engagement automatique ni découpage |
| Besoin engagé maintenant | Choix explicite du besoin/version/périmètre, démarrage crédible | Droits non exprimés dans l'accord |
| Plan juste-à-temps | Petites US verticales du seul périmètre engagé, contrôles et ordre | Exécution avant maturité et autorisation |
| Delivery | US prêtes, preuve par critère, revue et résultat intégré | Clôture du besoin parent ou GO Production automatiques |

« Engagé » signifie choisi pour préparer son développement maintenant. Ce choix peut lancer le refinement approfondi ; il ne suffit pas à autoriser l'implémentation. Découper seulement lorsque le brief est complet et validé, l'engagement toujours actuel et le démarrage crédible. Si le besoin attend encore indéfiniment une décision ou une capacité externe, conserver son niveau large. Une étude indispensable peut avoir son propre résultat borné ; ne pas détailler en anticipation toutes les US qu'elle pourrait entraîner.

## Cuisiner le besoin jusqu'à un cahier des charges exploitable

Utiliser [hestia-refinement](../.agents/skills/hestia-refinement/SKILL.md). Préserver les mots et nuances, poser quelques questions par round et adapter les suivantes. Le nombre de rounds n'est pas plafonné. Une question utile rend une conséquence compréhensible, au besoin avec un exemple contradictoire. L'agent instruit lui-même les faits vérifiables et les options techniques.

« Tout cadrer » concerne tout le périmètre réellement engagé et ses interactions, pas toutes les fonctions futures d'Hestia. Pour chaque exigence et angle pertinent, établir avant développement :

- une décision sourcée, des scénarios observables positifs et négatifs et une preuve attendue ;
- ou une question, hypothèse ou préparation bloquante à résoudre ;
- ou une exclusion explicite, sa conséquence et pourquoi elle ne compromet pas le résultat retenu.

Examiner acteurs et pouvoirs, cycle de vie, données dérivées, erreurs/reprise, concurrence, limites, révocation, disparition d'un acteur, suppressions/restaurations et impacts voisins selon leur pertinence. Ne pas inventer des fonctions pour cocher une liste. Une contradiction transversale n'est pas résolue parce que la première US l'évite. Une inconnue ne devient pas non bloquante en la renommant « risque accepté ».

Séparer produit, UX, sécurité et architecture. Une absence d'impact dans un domaine doit être justifiée, pas représentée par une rubrique vide. Les décisions nécessaires sont arrêtées et sourcées ; les recommandations restent des propositions. ADR pour un choix durable, étude technique pour une mesure, essai de parcours pour une incertitude : chacun possède une question et des critères de sortie.

Avant de transmettre à delivery, faire examiner indépendamment la couverture, les scénarios contradictoires, les hypothèses et les dépendances par un agent distinct. Lui donner les sources et la version exacte, sans verdict à confirmer. La revue et les contrôles de structure ne garantissent pas l'absence de tout oubli : consigner leurs limites et reprendre le cadrage dès qu'une nouvelle contradiction matérielle apparaît.

Les comportements UX se cadrent ici ; les choix visuels viennent exclusivement de [Claude Design](design-governance.md). Un Design System disponible ne remplace ni le cadrage du comportement, ni un hand-off suffisant pour les écrans concernés.

## Tenir GitHub sans demander une administration manuelle

GitHub Issues porte les besoins, les US engagées et leurs preuves ; Projects est leur vue de pilotage. Les agents relisent l'état réel, dédupliquent, proposent les priorités, gèrent les liens parent/enfant et dépendances, tiennent les statuts et attachent les preuves **dans les limites des écritures autorisées**. « Backlog autonome » signifie cette responsabilité agentique ; aucun ordonnanceur ni surveillance récurrente n'est activé par ce document.

Un besoin large peut être conservé ou actualisé sur son Issue sans créer d'US. Si son brief doit être publié avant engagement, présenter séparément le commentaire ou delta exact et obtenir l'accord applicable : ce cas n'exige pas un faux plan V1 rempli d'US. Après publication, le brief référencé par URL et empreinte devient la source durable ; le dossier local n'est pas son double éditable.

Lors de l'engagement, relire les besoins liés et les capacités partagées : séparation de fichiers ne signifie pas absence de conflit métier. Définir le résultat complet retenu, son niveau de livraison et l'ordre technique. Un sous-périmètre nécessite un choix explicite et laisse le besoin cible restant large ; aucun critère gênant n'est supprimé pour fabriquer un état prêt.

Présenter le plan exact : création/réutilisation, corps, liens, dépendances, labels et changements Project. Publier seulement ce qui est couvert par l'accord. Une permission bornée peut couvrir la tenue des statuts/preuves de ce lot ; ne pas demander un micro-GO pour chaque mise à jour déjà autorisée. Elle n'autorise pas de nouvelles US, une extension de périmètre ou une dépense non couvertes. En cas de réponse ambiguë, relire et rapprocher les reçus avant toute relance.

Utiliser les champs et vues réellement présents. Ne pas affirmer qu'un champ, lien natif, automatisme ou statut est configuré sans lecture effective. Proposer les changements nécessaires avec leur impact ; ne pas imposer un outil supplémentaire ni maintenir des colonnes équivalentes dans Markdown.

## Accords et changements

Conserver objet, portée, version, auteur, date et source consultable de chaque accord. Un accord sur le périmètre n'est pas un GO global sur le brief ; un GO du brief n'est ni engagement, ni publication, ni développement. Un seul message peut explicitement couvrir plusieurs pouvoirs : les distinguer par leurs portées, pas par le nombre d'échanges. Deux reformulations d'un GO publication ne créent jamais un GO exécution.

Pause, annulation ou pivot : arrêter les actions affectées, noter la nouvelle instruction et conserver l'historique. Un ancien ready ne permet pas de repartir malgré la pause. En cas de pivot, analyser critères, design, décisions, dépendances, contrats et preuves affectés ; requalifier ce delta et conserver les décisions réellement inchangées. La reprise exige une instruction applicable ; ne pas programmer une relance d'une pause non demandée.

## Livrer un résultat, pas une collection de tickets verts

Pour chaque US : critères reliés aux contrôles réellement exécutés, candidat exact, revue indépendante et limites. Pour le besoin : parcours intégré à travers les US et non-régression des capacités voisines. Une US achevée ne clôt pas le besoin large ; vérifier le résultat convenu au niveau local, Dev ou Production attendu et relire les preuves avant le changement GitHub autorisé.

Les agents préparent une recette courte : support/version à ouvrir, gestes à essayer, résultats attendus et points de décision. Amaury juge l'usage, pas la qualité du code par procuration. Une dépendance à Dev doit être prouvée en Dev, pas par un test local.

Avant de rendre la main, suivre [la reprise et continuité](continuity.md) et donner une prochaine action prioritaire explicite : qui agit, sur quel support/version, quel retour est attendu et ce qu'il débloque. Continuer soi-même les étapes autorisées ; attendre seulement une décision ou une autorisation réellement manquante, et respecter une pause.
