# 0011 — Photos caméra et aperçus privés

Date : 13 octobre 2026. Statut : implémentation locale, qualification en cours.

## Décision

Les nouvelles sélections caméra passent par un worker navigateur, une à la fois.
Une conversion qualifiée produit un JPEG qualité 88 %, de bord long maximal
3 200 pixels, sans agrandissement ni recadrage. Un format non qualifié, une
capacité absente ou un résultat plus lourd conserve le fichier initial. Le
fichier choisi est figé avant empreinte et réservation ; une reprise réutilise
ces mêmes octets. Les imports et les originaux archivés restent inchangés.

Les lectures de pages acceptent deux variantes privées : `thumbnail` (640 pixels)
et `settings` (1 600 pixels). Elles exigent la version de page attendue. Une
version périmée reçoit un conflit avant génération. Les requêtes historiques
sans variante conservent leur aperçu ajusté à pleine résolution ; les artefacts
finaux n'acceptent pas de variante. Le final utilise toujours la source retenue.

La migration additive 013 conserve le slot historique et ajoute deux slots
indépendants, chacun liant un objet, une version et une empreinte des entrées
réelles et du moteur. Les dimensions sont réduites après orientation EXIF,
rotation et recadrage. Les objets restent soumis aux verrous, quotas et purges
Capture existants. Chaque portion servie revalide la session et la version après
lecture du stockage. Les lectures automatiques sont passives ; les réponses
restent `private, no-store`.

Un cache navigateur temporaire partage les téléchargements d'aperçus. Il compte
les octets, les entrées et leur durée de vie, y compris les affichages encore
actifs. Un bail appartient à chaque consommateur. La purge annule les requêtes,
révoque les URL, efface les affichages et invalide les réponses tardives. Il n'y a
pas de persistance dans un service worker ou un stockage navigateur.

Le validateur isolé renvoie les dimensions orientées et le nombre d'images après
décodage complet. Capture ne relance plus un second processus pour ces seules
dimensions. Les imports multi-images demeurent admissibles selon les règles
existantes ; la caméra exige une seule image.

Un PATCH identique conserve version et artefact seulement si aucune page en
cours d'envoi ne doit être annulée. La décision reste serveur, sous verrou.
Une modification de titre produit une nouvelle identité de confirmation et de
nouvelles métadonnées, mais réutilise un objet final intact. Le changement de
pixels, de pages, d'ordre ou de format invalide le rendu. Aucune réponse incertaine
ni confirmation ancienne n'est rejouée implicitement.

L'empreinte du contenu et de la révision du moteur est enregistrée sur l'artefact
final. Un artefact historique ou produit par N-1 sans cette attestation est
reconstruit une fois à la préparation ; les préparations suivantes peuvent le
réutiliser. Cette reconstruction remplace aussi son identité de confirmation.

## Compatibilité et limites

Le retour à N-1 conserve le schéma additif. N-1 ignore les nouveaux slots ; au
retour à N, leurs entrées réelles, versions et objets doivent correspondre avant
réemploi. Le nettoyage réconcilie aussi les dérivées de pages modifiées ou retirées
par l'ancienne application. Les objets promus restent protégés.

La conversion navigateur couvre les JPEG simples qualifiés (8 bits,
monochromes ou RGB), les PNG mono-image et les WebP statiques sans orientation
EXIF à appliquer, jusqu'à 40 mégapixels. Les huit orientations JPEG et PNG sont
prises en charge. Les WebP orientés conservent leurs octets : le navigateur
testé ignore notamment le miroir EXIF, même avec `imageOrientation: from-image`.
Les HEIC/HEIF et conteneurs JPEG multi-images, notamment ceux portant
une image auxiliaire HDR, conservent aussi leurs octets initiaux. Le format réellement
fourni par la caméra du Pixel 10 reste à vérifier sur cet appareil ; les gains
du corpus JPEG simple ne lui sont pas attribués par défaut.

La réduction du poids dépend du document et du décodeur du navigateur. Les cibles
de latence et de compression sont des critères à mesurer, pas des garanties
déduites de ces choix. Les preuves identifient séparément environnement local,
Dev et appareil physique. La qualification inclut lisibilité, orientations, QR,
recadrage, reprises, révocation, expiration, imports, archives et retour N-1.
