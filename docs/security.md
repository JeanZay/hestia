# Sécurité et protection des données

Cadre du 12 septembre 2026. Hestia prend le RGPD et les recommandations de la CNIL comme repères de conception. Ce document ne constitue ni une certification juridique ni une preuve de sécurité de l'instance future. Les obligations exactes dépendent des usages, de l'hébergement et des traitements activés.

La CNIL recommande d'intégrer la protection et les paramètres protecteurs dès la conception, de séparer développement et exploitation et de tester avant mise à disposition. Hestia traduit ce repère en exigences vérifiables ci-dessous. [CNIL : encadrer les développements informatiques](https://www.cnil.fr/fr/securite-encadrer-les-developpements-informatiques).

## Limite du lot initial

La fondation est une démonstration locale à données synthétiques. Elle ne propose pas d'authentification, d'autorisation familiale, d'ingestion de fichiers privés, de stockage SQL/S3 ou de sauvegarde réelle. L'affichage de compartiments et de connecteurs est une représentation produit, sans garantie de protection de données réelles. Elle doit rester accessible localement et ne doit recevoir aucun document privé.

Les règles de contribution excluent secrets, configurations de foyer, documents réels, identifiants familiaux et jeux dérivés de données privées. Un exemple fictif doit être créé de toutes pièces. Les outils et agents ne reçoivent que ce qui est nécessaire à leur contrat de tâche ; aucun transfert de code privé à un autre service n'est présumé autorisé par la présence de son nom dans la documentation.

## Actifs et limites de confiance

Les principaux actifs cibles sont les originaux, faits familiaux validés, droits d'accès, fiches Markdown, index de recherche, sauvegardes et clés. Les résumés et empreintes peuvent eux aussi révéler des informations et restent protégés. Le navigateur, les fichiers importés, le texte OCR, les réponses de modèles et les événements des connecteurs sont des entrées non fiables.

| Risque concret | Exigence de conception cible | Preuve attendue avant usage réel |
| --- | --- | --- |
| Lecture d'un document personnel par un autre membre | Autorisation serveur sur document, fiche, extrait, recherche, téléchargement et export ; refus par défaut. | Tests négatifs entre membres et compartiments, accès direct par identifiant et accès après révocation. |
| Fuite d'un original par un lien partagé | Stockage privé et lien de durée limitée produit après autorisation ; absence de lien permanent public. | Requête sans session refusée, expiration et révocation vérifiées. |
| Fuite vers un fournisseur IA ou un connecteur | Permission minimale, contexte filtré, destination contrôlée et accord explicite pour le document sensible. | Test du contenu sortant, refus en absence d'autorisation et absence d'appel lorsque coupure active. |
| Instruction malveillante dans un PDF ou un OCR | Traiter le texte comme une donnée ; ne lui donner aucun pouvoir de modifier les droits, outils ou destinataires. | Corpus synthétique d'injections documentaires ; aucune exécution d'action externe à partir du seul contenu. |
| Fichier piégé, archive abusive ou consommation excessive | Validation du format réel, limites de taille et de traitement, quarantaine, worker isolé et sortie rendue sûre. | Rejet de formats interdits, limites de ressources et essais de fichiers malformés sans accès aux secrets. |
| Original écrasé ou classement corrompu | Écriture sans écrasement, empreinte vérifiée, versions et traçabilité. | Tentative de remplacement refusée, reprise sans doublon et restauration avec empreintes identiques. |
| Injection dans une fiche Markdown ou un export | Échapper les contenus, filtrer liens et HTML, contrôler les chemins ; protéger l'export CSV contre l'interprétation de formules. | Tests de scripts, URLs dangereuses, traversée de répertoires et formules synthétiques. |
| Secret révélé par un log, une issue ou un build | Messages expurgés, journalisation minimale, configurations privées hors Git, aucun secret côté client. | Inspection des sorties et artefacts, contrôles de secrets et tests ciblés sur les erreurs. |
| Compromission de l'hébergeur ou rançongiciel | Cloisonnement des droits, mises à jour, sauvegarde chiffrée indépendante et copie hors ligne. | Restauration dans un environnement propre sans dépendre du compte compromis. |
| Désactivation d'un connecteur contournée par une reprise | Vérifier permissions et arrêt global avant chaque appel et chaque nouvelle tentative ; préserver les désactivations individuelles. | Tests de course, file déjà remplie et relance après coupure. |

Cette table est un modèle de risques et de preuves, pas une attestation de contrôles déjà exécutés ni un backlog de tâches.

## Collecter et exposer le minimum nécessaire

Chaque champ du profil familial doit avoir une finalité, un niveau d'accès et une règle de conservation. Une date exacte peut être nécessaire au coffre, tandis qu'une tranche d'âge suffit à une réponse ; le contexte transmis applique cette réduction. Les faits issus d'un document restent des propositions tant qu'ils n'ont pas atteint le niveau de validation demandé.

Aucun code secret de carte, cryptogramme, mot de passe ou secret d'utilisation n'entre dans le coffre ou le contexte d'un modèle. Le produit cible devra expliquer cette limite à l'entrée et traiter un dépôt suspect avant indexation ou envoi externe. Un filtre automatique ne pourra pas être présenté comme une garantie de détection exhaustive. Un RIB relève d'un compartiment financier très restreint, avec accord spécifique avant toute communication externe.

Les secrets techniques indispensables au fonctionnement futur — identités de service, clés de chiffrement ou de connecteurs — doivent être gérés à part, avec accès limités, rotation et récupération. Ils ne font jamais partie du profil familial, d'une fixture, d'un ticket, d'un export documentaire ordinaire ou d'un prompt.

## Authentification et partage

Avant ouverture distante, choisir et qualifier une solution d'identité maintenue, avec récupération de compte compréhensible, sessions protégées, expiration et révocation. Une authentification renforcée doit être proposée pour les actions et compartiments les plus sensibles. Les clés d'accès aux services sont distinctes par environnement et limitées à leur rôle.

Les droits de lecture, correction, partage, export et suppression ne sont pas automatiquement équivalents. Tout partage ponctuel doit être révocable et limité en portée et en durée. Les recherches et réponses IA ne doivent pas révéler le nom, le contenu ou l'existence d'un document hors droits. Le journal d'audit conserve le minimum nécessaire pour expliquer les accès et décisions, sans recopier les documents.

## Chiffrement et exploitation

Les échanges du service cible utilisent TLS. Les originaux et sauvegardes disposent d'une protection au repos adaptée à l'hébergeur, et les clés de sauvegarde sont récupérables hors du service principal. Ce choix ne prétend pas fournir un chiffrement de bout en bout : le traitement OCR ou IA qui lit un document accède nécessairement au contenu dans son périmètre d'exécution.

Les images, bibliothèques et moteurs doivent être inventoriés et mis à jour ; les versions et permissions nécessaires sont explicites. Les traitements longs sont isolés du serveur web et bornés en ressources. Les sauvegardes sont considérées comme des copies sensibles, avec leurs propres droits. La CNIL recommande des copies régulières, testées, protégées et conservées aussi sur un site distinct et hors ligne ; Hestia précise ses propres fréquences dans [Portabilité](portability.md). [CNIL : sauvegarder](https://www.cnil.fr/fr/securite-sauvegarder).

## Rectifier, supprimer et restaurer

La correction crée un événement traçable et met à jour les faits ainsi que leurs dérivés. Elle ne réécrit pas l'original. La suppression autorisée retire les copies actives, fiches, faits et index concernés, avec une explication de son effet sur les sauvegardes. L'immuabilité ne doit pas devenir une conservation forcée et illimitée.

Les durées de conservation et les exceptions doivent être définies avant utilisation réelle. Les sauvegardes expirent selon cette politique ; un registre d'effacement séparé du contenu aide à ne pas réintroduire des données supprimées lors d'une restauration. Une sauvegarde conservée pour restauration doit rester inaccessible pour les usages ordinaires. Les exigences légales précises seront évaluées selon l'instance, sans inventer de délai universel.

## Développement et livraison

Dev et Production ont des données, comptes, bases, stockages et clés distincts. Les previews et tests n'utilisent que des données synthétiques. Les revues indépendantes reçoivent le diff et le contrat nécessaires, dans un contexte propre, et consignent leur résultat sur la version réellement examinée. Un contrôle local ne prouve pas qu'une protection de branche ou une CI distante est activée.

Avant chaque livraison Production : preuves exactes des contrôles, recette Dev, sauvegarde vérifiée, migration et retour arrière préparés, puis accord explicite du responsable produit. L'utilisation de fichiers AGENTS.md, de hooks ou d'une CI ne constitue pas à elle seule une barrière de sécurité ; les mécanismes effectifs doivent être testés et les réglages distants vérifiés après création autorisée du dépôt.

## Signalement d'un problème

Le canal privé de signalement du dépôt public est décrit dans [SECURITY.md](../SECURITY.md). Son activation doit être vérifiée sur GitHub lors de la publication ; ne pas remplacer son absence ou une erreur d'accès par une issue publique contenant une vulnérabilité sensible. Ne transmettre que des reproductions synthétiques, sans document familial ni secret.

En cas d'incident futur : stopper les échanges externes, limiter l'accès concerné, conserver des traces expurgées, qualifier l'étendue, révoquer les accès compromis si nécessaire et restaurer dans un environnement contrôlé. Les démarches réglementaires dépendent de l'incident et du rôle de l'opérateur ; elles doivent être évaluées sans présumer qu'une procédure technique suffit.

## Références vérifiées le 12 septembre 2026

- [CNIL : guide de la sécurité des données personnelles](https://www.cnil.fr/fr/guide-de-la-securite-des-donnees-personnelles), cadre général de mesures adaptées au risque.
- [CNIL : encadrer les développements informatiques](https://www.cnil.fr/fr/securite-encadrer-les-developpements-informatiques), conception, environnements de test et contrôles.
- [CNIL : sauvegarder](https://www.cnil.fr/fr/securite-sauvegarder), copies protégées et restauration vérifiée.

Les exigences Hestia précèdent la mise en œuvre ; seule une preuve datée de contrôle permet de déclarer l'une d'elles acquise.
