# ADR 0010 — Classement Capture via OpenRouter

Date : 10 octobre 2026. Complète l'ADR 0009, sans nouvelle interface.

## Un modèle pour le document et ses destinations

Le modèle retenu est `anthropic/claude-haiku-5.5`. Un appel reçoit le document préparé et les dossiers autorisés, puis propose plusieurs emplacements existants ou de nouveaux chemins. Il ne classe rien lui-même. La validation des résultats, des droits et de la confirmation reste celle du service Capture.

## Activation explicite en Dev

Le serveur démarre sans fournisseur distant. Pour Dev seulement, `HESTIA_CLASSIFICATION_REMOTE=openrouter-haiku-dev` et `HESTIA_OPENROUTER_PROFILE` (JSON sans secret) permettent de charger un profil qualifié et non périmé. Ces variables ne configurent pas la Production. Un profil invalide ou absent laisse le classement manuel disponible.

Le profil indique le modèle et le fournisseur exact, la référence de qualification, les sources tarifaires et de conversion monétaire, les dates de validité et les bornes de formats, volumes, contexte et sortie. Une référence textuelle n'est pas une certification : l'opérateur doit conserver les résultats réels correspondants avant activation. L'expiration est recontrôlée avant chaque appel.

La clé est renseignée dans les réglages existants réservés au Propriétaire et aux Administrateurs. Elle reste chiffrée dans la base et n'est jamais renvoyée par GET. Le profil de déploiement ne contient pas la clé. Enregistrer les réglages ne fait aucun appel ; le test et l'analyse restent des gestes explicites et budgétés.

## Budget et facture

Dev impose un plafond serveur de **50 EUR par mois civil UTC**. Le plafond effectif est le minimum entre celui-ci et le plafond des réglages du foyer. Un PUT ne peut pas relever la limite serveur ; une valeur préexistante supérieure est également plafonnée lors de la réservation. Les appels d'analyse et de test partagent ce contrôle sérialisé.

La réserve couvre le contexte maximal qualifié au tarif d'entrée le plus élevé et la sortie bornée au tarif de sortie le plus élevé, avec conversion conservatrice vers l'euro et arrondi supérieur. La taille d'un PDF compressé et le nombre de fichiers importés ne sont pas une borne de tokens. Les paliers tarifaires, notamment les contextes longs, doivent être inclus dans la qualification. Les rabais de cache ne sont pas anticipés.

`usage.cost` permet de rapprocher la dépense du compte OpenRouter ; un coût absent ou ambigu conserve la réserve. Un dépassement connu reste enregistré et invalide le résultat, sans écraser le coût par la borne attendue. Aucune nouvelle tentative facturable n'est automatique. Le plafond Hestia ne couvre pas les autres applications utilisant la même clé.

## Transport et confidentialité

La destination HTTPS est fixe, les redirections sont refusées et les réponses sont bornées. Le fournisseur est explicitement sélectionné, sans fallback, avec prise en charge obligatoire des paramètres demandés, collecte de données refusée et routage ZDR exigé. Ces options ne prouvent pas un effacement physique et ne dispensent pas d'examiner les politiques du fournisseur.

Les documents sont intégrés en base64 avec un nom générique ; aucune URL documentaire signée n'est transmise. Pour les PDF, le moteur natif est explicitement demandé, afin de ne pas déclencher un service OCR supplémentaire implicite. Aucun outil, plugin de réparation de réponse ou web search n'est autorisé. Le contenu documentaire et les libellés restent des données non fiables. Les erreurs ne restituent jamais le corps fournisseur, la clé ou les données du document.

## Qualification

Les tests synthétiques de transport, de coût et de budget SQL sont nécessaires, mais ne prouvent ni la qualité ni la latence réelles. Avant l'activation Dev, vérifier le profil exact sur un corpus synthétique de PDF texte, scan multipage et images, ainsi que les suggestions multiples et le retour au classement manuel après erreur. Conserver le coût, la durée, le modèle et le fournisseur, sans secret ni document familial.

Les huit propositions Browser Use Capture gardent leur contrat. Les parcours exigeant une IA inactive sont exécutés dans cette configuration avant les parcours nécessitant le fournisseur actif. Chaque phase conserve sa configuration et son identité de déploiement ; aucun résultat historique n'est transféré.

Sources techniques : [PDF OpenRouter](https://openrouter.ai/docs/guides/overview/multimodal/pdfs), [routing](https://openrouter.ai/docs/guides/routing/provider-selection), [usage](https://openrouter.ai/docs/cookbook/administration/usage-accounting), [fiche Haiku](https://openrouter.ai/anthropic/claude-haiku-5.5). La disponibilité et les tarifs sont à revérifier pour chaque profil qualifié.
