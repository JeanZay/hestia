# Portabilité, export et restauration

Contrat cible du 12 septembre 2026, issu de PORT-01 à PORT-07. Le lot initial ne réalise ni export familial persistant, ni sauvegarde distante, ni restauration réelle. Cette distinction évite de confondre fichiers de démonstration et conservation de données précieuses.

## Principe

Le foyer doit pouvoir reconstruire son service ailleurs et lire ses documents même sans Hestia. Les originaux gardent leur format, les fiches sont en Markdown UTF-8, les faits et métadonnées disposent de schémas ouverts et versionnés. Les relations utilisent des identifiants stables, jamais un chemin local privé ou une URL d'hébergeur comme seule clé.

## Contrat de l'export complet

Une seule opération autorisée crée une archive cohérente et un compte rendu. Les chemins suivants décrivent le format cible proposé, qui devra être versionné et testé avant d'être annoncé comme disponible.

| Élément | Contenu cible |
| --- | --- |
| `manifest.json` | Version de format, identifiant d'export, instant UTC, version du schéma et du logiciel, nombres d'objets, fichiers avec tailles et empreintes SHA-256, état d'achèvement. |
| `originals/` | Octets exacts des originaux sous identifiants stables et noms de fichiers sûrs ; liens entre versions préservés. |
| `notes/` | Fiches Markdown, provenance et références résolubles dans l'export. |
| `data/` | JSON ou NDJSON documenté pour les faits, profils, propositions, droits et relations ; aucune dépendance obligatoire à une interface propriétaire. |
| `database/` | Sauvegarde PostgreSQL et version d'outil, schéma et migrations nécessaires à la reconstruction fidèle du service. |
| `metadata/` | Provenance, événements utiles expurgés, définitions des permissions et états nécessaires à une reprise maîtrisée. |
| `RESTORE.md` | Instructions en français, versions requises, vérifications et explication de la récupération des clés sans inclure les clés. |

L'export lisible des données complète la sauvegarde SQL : un dump seul ne suffit pas à une lecture indépendante de PostgreSQL. CSV peut être produit en complément pour une analyse ponctuelle ; il n'est pas l'archive de référence. Les index de recherche peuvent être reconstruits et leur présence n'est pas requise pour récupérer les originaux et faits.

Les secrets de connecteurs, mots de passe, clés de session et clés privées ne sont pas placés en clair dans l'export documentaire. Les informations nécessaires à la continuité font l'objet d'une récupération chiffrée distincte. La restauration de droits ne réactive aucun jeton ni échange externe sans contrôle explicite. Les données privées exportées restent privées : aucun export réel ne rejoint le dépôt, les artefacts publics de CI ou une pièce jointe d'issue.

## Cohérence et intégrité

Un export n'est complet que si la base, les originaux et les fiches correspondent à un même état logique. La future implémentation doit fixer un point de cohérence : snapshot SQL, références d'objets versionnés et gel approprié des mutations ou journal permettant de rejoindre exactement ce point. Copier les trois espaces à des instants quelconques est insuffisant.

Le manifeste énumère chaque fichier attendu et vérifie taille, empreinte, unicité des identifiants et résolution des relations. Un fichier manquant ou un lien brisé produit un échec explicite. Un calcul d'empreinte détecte une altération par rapport au manifeste ; protéger le manifeste et l'archive par un chiffrement authentifié ou une signature sera nécessaire pour résister à une modification malveillante des deux. Un message de succès doit distinguer création, transfert et vérification.

## Politique de sauvegarde cible

| Dimension | Décision acquise | À préciser avant données réelles |
| --- | --- | --- |
| Fréquence | Sauvegarde automatique quotidienne. | Horaire, durée maximale, surveillance et stratégie complète/incrémentale. |
| Indépendance | Fournisseur distinct de l'hébergeur principal, accès et clés séparés. | Fournisseurs, pays, conditions et coût explicitement autorisé. |
| Contenu | Ensemble cohérent originaux, SQL, Markdown, liens et restauration. | Méthode de snapshot et règles d'expiration des dérivés. |
| Protection | Chiffrement des copies et récupération compréhensible des clés. | Outil, garde des clés et exercice de récupération par le foyer. |
| Versions | Plusieurs points de retour avant corruption ou suppression. | Durée et nombre, articulation avec les demandes d'effacement. |
| Hors ligne | Copie chiffrée périodique, déconnectée du service. | Support, fréquence et lieu de garde. |
| Intégrité | Contrôle automatique de chaque sauvegarde. | Indicateurs et traitement d'un échec ou d'un retard. |
| Restauration | Exercice complet tous les trois mois. | Temps maximal de remise en service et perte de données acceptable. |

Ces choix de fréquence sont ceux du cadrage Hestia. La CNIL fournit le repère général de sauvegardes régulières, testées, protégées, distinctes et hors ligne. [CNIL : sauvegarder](https://www.cnil.fr/fr/securite-sauvegarder).

Une sauvegarde quotidienne ne garantit pas automatiquement une perte maximale de 24 heures : un échec, un retard ou une corruption peut allonger la période. La cible de perte de données et le délai de remise en service doivent être chiffrés, instrumentés et démontrés avant engagement auprès d'un foyer.

## Procédure de restauration cible

1. Choisir un point de retour et lire son manifeste ; obtenir les clés par la procédure indépendante, sans les copier dans un journal.
2. Créer une instance isolée, sans connecteurs actifs, avec les versions compatibles documentées.
3. Vérifier l'archive, déchiffrer dans un espace protégé et contrôler chaque empreinte avant import.
4. Restaurer PostgreSQL, les originaux et les fiches ; appliquer les migrations prévues et réconcilier les références.
5. Réappliquer les décisions d'effacement postérieures selon la politique définie, pour éviter de ressusciter des données retirées volontairement.
6. Reconstruire les index ; tester recherche, lecture d'originaux, profil, validation et isolation des droits.
7. Mesurer durée, pertes éventuelles et anomalies. Vérifier un échantillon de bout en bout et l'ensemble des relations automatiquement.
8. Obtenir le verdict de recette avant remise en service. Réautoriser séparément les connecteurs et leurs secrets, puis contrôler les premières exécutions.

Un exercice trimestriel conserve une preuve datée : version restaurée, sauvegarde utilisée, résultats de vérification, temps mesuré et verdict. Pour le développement, tout exercice utilise des données synthétiques. L'exercice d'une vraie instance devra rester dans son périmètre privé, avec accord et accès adaptés.

## Changer d'hébergeur

L'export, les migrations et l'image portable doivent permettre une reconstruction chez un autre prestataire sans importer de logique propriétaire. La compatibilité S3 se vérifie sur les lectures, écritures sans écrasement, versions et contrôles d'intégrité réellement employés. Les fonctions avancées d'un fournisseur ne deviennent pas indispensables sans alternative documentée.

Une voie Vercel pourra simplifier l'application web, mais originaux, base, sauvegardes et workers nécessiteront leurs propres contrats de disponibilité. Docker Compose constitue la voie portable proposée ; la seule présence de fichiers Compose ne prouve pas l'installation complète du service cible. Une installation recommandée sera retenue après une démonstration de reconstruction et une décision sur les coûts et l'exploitation.
