# ADR 0012 — Contexte de préparation et dictée optionnelle

Décision du 14 octobre 2026, issue #4 et brief commentaire/voix v1 validé.

Le commentaire aide une demande explicite de suggestions. Il reste une donnée non fiable, ne donne aucun droit et ne classe rien. Une contradiction est expliquée avec les alternatives proposées. La confirmation humaine demeure obligatoire.

Sans commentaire non vide après retrait des espaces, aucune divergence document/commentaire n'est exposée. Cette règle commune s'applique à la réponse du fournisseur et à la relecture d'un résultat ancien, avec l'instantané du commentaire de l'analyse. La forme de la réponse reste strictement validée ; destinations, coûts et gardes de péremption sont conservés, sans appel supplémentaire ni filtrage lexical du texte de l'IA.

## Identités et durée de vie

`comment_version` est indépendant de `capture.version` et des versions de pages. Le PATCH dédié modifie seulement le texte et sa révision sous le verrou du brouillon ; il ne rejoue pas un manifeste de pages. Les uploads, miniatures et artefacts inchangés restent valides. Les confirmations et analyses précédentes sont invalidées. L'analyse lie explicitement la révision et l'instantané du commentaire.

Le client distingue révision de frappe et texte : revenir au texte initial n'autorise pas une réponse ancienne à écraser une édition. Les sauvegardes sont coalescées ; une erreur conserve la saisie. Le classement manuel reste possible. La limite de 2 000 caractères compte les points de code Unicode côté serveur et navigateur, sans troncature silencieuse.

Le texte suit les échéances existantes, calculées depuis la création : caméra sept jours, import une heure. Il ne rejoint ni original, index, export ni journal. Le trigger de migration 014 efface le contexte et les résultats dérivés à la clôture, y compris si une version applicative antérieure clôt le brouillon après retour arrière. Seule la preuve financière minimisée reste conservée.

## Transcription interchangeable

La dictée est un service distinct du classement : configuration, clé chiffrée, catalogue et plafond mensuel EUR/UTC séparés. Seuls Propriétaire et Administrateur actifs configurent ; enregistrer un réglage ne contacte aucun fournisseur. Les modèles déjà intégrés et qualifiés se sélectionnent sans redéploiement. L'ajout d'un autre protocole exige un adaptateur et sa qualification, sans modifier Capture.

Le navigateur enregistre uniquement après un geste. L'AudioWorklet produit du PCM16 mono à 16 kHz ; le fichier WAV de 120 secondes tient sous 4 Mio et sous la limite de corps de requête Vercel. Arrêt, abandon, masquage et sortie libèrent microphone et buffers. Le minuteur appartient au contrôle vocal. La requête externe ne détient pas de transaction SQL ni de verrou de préparation pendant son attente.

L'audio transite en mémoire, jamais dans le stockage objet ou les reçus SQL. Le texte retourné reste éditable. En cas de frappe concurrente, dépassement ou changement d'étape, le résultat attend un ajout explicite ou son abandon. Une nouvelle dictée est désactivée tant que ce résultat attend. Aucun renvoi de l'audio, retry payant ou modèle de secours automatique.

Les réservations couvrent le maximum d'une dictée avant émission ; un coût inconnu reste réservé après changement de mois. Une nouvelle configuration concerne les prochains appels. Les droits et l'échéance sont revérifiés avant émission et restitution. Le vocabulaire est limité aux noms des dossiers consultables et déposables, dédupliqué et borné ; aucun ancêtre masqué n'est envoyé.

Correction du 15 octobre 2026 : chaque terme est limité localement à 50 octets UTF-8 après normalisation NFC et retrait des espaces périphériques. Des comparaisons synthétiques contrôlées avec le même audio ont accepté un terme ASCII de 50 caractères et rejeté ses extensions de 51 et 59 caractères. Elles ne démontrent pas une limite Unicode universelle du fournisseur ; la borne en octets constitue une précaution conservatrice. Un nom trop long est exclu entièrement, sans troncature ni modification du dossier. Les noms accentués courts restent intacts ; une liste vide n'empêche pas la dictée. Les plafonds de 64 termes et 2 048 octets au total restent appliqués. L'adaptateur vérifie aussi la borne par terme avant l'appel, et le contrat de qualification l'inclut : les anciens profils doivent être renouvelés après qualification du nouveau contrat. Ce filtre n'ajoute aucun appel, délai ou événement de succès.

Un échec STT peut produire un événement opérationnel serveur borné : identifiant de transcription existant, étape et raison choisies localement, statut HTTP fournisseur numérique éventuel et indicateur de coût connu. Aucun audio, vocabulaire, texte, corps, en-tête, identité d'acteur, clé, hash de clé ou erreur brute n'est journalisé. Les métadonnées peuvent être conservées par l'hébergeur ; ce diagnostic ne revendique pas une rétention nulle. Un succès ne produit aucun nouvel événement. La panne du journal n'affecte ni la réponse, ni la comptabilisation, ni la politique sans retry. Le payload fournisseur, sa confidentialité, ses délais et son devis restent inchangés.

## Profil réel et qualification

L'adaptateur initial vise MAI-Transcribe 2 via OpenRouter. Il impose ZDR et le refus de collecte, sans prétendre annuler un réglage de journalisation du compte. Formats, vocabulaire, français/négations, coûts, latence et conditions effectives doivent être éprouvés avant activation. Les profils portent un contrat et des références de qualification, prix, change et confidentialité ; leur validation structurelle ne prouve pas l'authenticité des preuves. Profil absent ou périmé : dictée indisponible, clavier disponible.

La modification du contrat de classement impose également sa requalification avant renouvellement de son profil ; son modèle n'est pas remplacé par le modèle vocal. Deux adaptateurs synthétiques vérifient la séparation, sans devenir des modèles du catalogue de Production.

Les justifications visibles expliquent brièvement le lien entre la destination et un fait du document ou du commentaire, en identifiant cette source. Les permissions et le guide générique restent des contraintes internes, jamais des justifications inventées. Un préfixe existant pertinent et autorisé est réemployé même si son nom diffère du guide ; une capacité de création ne suffit pas à rendre ce préfixe pertinent. Cette consigne ne remplace pas les contrôles de droits du serveur et exige une qualification réelle du contrat de classement.

## Livraison et retour arrière

Migrations 014 et 015 additives. Retour applicatif à N-1 en conservant le schéma : le trigger continue de purger le commentaire, le service STT peut rester désactivé et son registre financier est conservé. Aucun effacement de dette ni down-migration destructive. La qualification vérifie réemploi des rendus, uploads concurrents, purge et reprise N-1/N sur ressources jetables. Les mesures avant/après distinguent interaction locale et délai fournisseur ; elles ne certifient pas un téléphone physique.

Références : [limites Vercel](https://vercel.com/docs/functions/limitations), [API STT OpenRouter](https://openrouter.ai/docs/guides/overview/multimodal/stt), [MAI Microsoft](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe). Vérifiées le 14 octobre 2026 ; les preuves d'exécution restent dans le dossier de livraison du candidat exact.
