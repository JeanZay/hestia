# ADR 0010 — Classement Capture via OpenRouter

Date : 10 octobre 2026. Complément Production : 12 octobre 2026. Complète l'ADR 0009, sans nouvelle interface.

## Un modèle pour le document et ses destinations

Le modèle retenu est `anthropic/claude-haiku-5.5`. Un appel reçoit le document préparé et les dossiers autorisés, puis propose plusieurs emplacements existants ou de nouveaux chemins. Il ne classe rien lui-même. La validation des résultats, des droits et de la confirmation reste celle du service Capture.

## Activation explicite par environnement

Le serveur démarre sans fournisseur distant. Dev exige `HESTIA_CLASSIFICATION_REMOTE=openrouter-haiku-dev` ; Production exige le token distinct `openrouter-haiku-production`. Chaque environnement charge son `HESTIA_OPENROUTER_PROFILE` (JSON sans secret) qualifié et non périmé. Un token absent, inconnu ou destiné à l'autre environnement, ou un profil absent, invalide, surdimensionné ou périmé laisse le fournisseur désactivé et le classement manuel disponible. Local ne peut jamais activer ce fournisseur distant, même avec un token et un profil valides.

Le profil indique le modèle et le fournisseur exact, la référence de qualification, les sources tarifaires et de conversion monétaire, les dates de validité et les bornes de formats, volumes, contexte et sortie. Une référence textuelle n'est pas une certification : l'opérateur doit conserver les résultats réels correspondants avant activation. L'expiration est recontrôlée avant chaque appel.

La clé est renseignée dans les réglages existants réservés au Propriétaire et aux Administrateurs. Elle reste chiffrée dans la base et n'est jamais renvoyée par GET. Le profil de déploiement ne contient pas la clé. La même clé OpenRouter peut être utilisée dans les deux environnements, chacun avec son stockage chiffré séparé. Lire ou enregistrer la configuration ne fait aucun appel ; le test et l'analyse restent des gestes explicites et budgétés. Le câblage disponible ne vaut pas activation autorisée : Production attend son GO sur le candidat exact et les preuves opératoires applicables.

## Budget et facture

Dev conserve son plafond serveur de **50 EUR par mois civil UTC**. Production impose son propre plafond serveur de **50 EUR par mois civil UTC**, y compris quand le fournisseur est désactivé. Chaque environnement utilise ses réglages, sa base et son registre de réservations séparés ; les dépenses et réserves Dev ne sont pas imputées au budget Production, et réciproquement. Ces deux plafonds ne constituent pas une limite globale du compte OpenRouter, même avec une clé partagée.

Dans chaque environnement, le plafond effectif est le minimum entre le plafond serveur et celui des réglages du foyer. Un PUT ne peut pas relever la limite serveur ; une valeur préexistante supérieure est également plafonnée lors de la réservation. Les appels d'analyse et de test partagent ce contrôle sérialisé.

La réserve couvre le contexte maximal qualifié au tarif d'entrée le plus élevé et la sortie bornée au tarif de sortie le plus élevé, avec conversion conservatrice vers l'euro et arrondi supérieur. La taille d'un PDF compressé et le nombre de fichiers importés ne sont pas une borne de tokens. Les paliers tarifaires, notamment les contextes longs, doivent être inclus dans la qualification. Les rabais de cache ne sont pas anticipés.

`usage.cost` permet de rapprocher la dépense du compte OpenRouter ; un coût absent ou ambigu conserve la réserve. Un dépassement connu reste enregistré et invalide le résultat, sans écraser le coût par la borne attendue. Aucune nouvelle tentative facturable n'est automatique. Le plafond Hestia ne couvre pas les autres applications utilisant la même clé.

## Transport et confidentialité

La destination HTTPS est fixe, les redirections sont refusées et les réponses sont bornées. Le fournisseur est explicitement sélectionné, sans fallback, avec prise en charge obligatoire des paramètres demandés et `data_collection: "deny"` pour exclure les fournisseurs utilisant les données pour l'entraînement. L'absence d'entraînement est l'exigence du foyer ; le traitement dans le contexte du modèle est accepté. La conservation technique temporaire est distincte et le routage ZDR n'est pas imposé par l'application. Une politique ZDR configurée dans le compte OpenRouter demeure applicable et n'est jamais désactivée par Hestia. Examiner les politiques du fournisseur et les options de collecte du compte avant activation ; ces paramètres ne prouvent pas un effacement physique. Références : [routage et politiques de données](https://openrouter.ai/docs/guides/routing/provider-selection#requiring-providers-to-comply-with-data-policies), [entraînement et conservation](https://openrouter.ai/docs/guides/privacy/provider-logging), [collecte OpenRouter](https://openrouter.ai/docs/guides/privacy/data-collection).

Les documents sont intégrés en base64 avec un nom générique ; aucune URL documentaire signée n'est transmise. Pour les PDF, le moteur natif est explicitement demandé, afin de ne pas déclencher un service OCR supplémentaire implicite. Aucun outil, plugin de réparation de réponse ou web search n'est autorisé. Le contenu documentaire et les libellés restent des données non fiables. Les erreurs ne restituent jamais le corps fournisseur, la clé ou les données du document.

## Qualification

Les tests synthétiques de transport, de coût et de budget SQL sont nécessaires, mais ne prouvent ni la qualité ni la latence réelles. Avant l'activation de chaque environnement, vérifier les preuves applicables au profil exact sur un corpus synthétique de PDF texte, scan multipage et images, ainsi que les suggestions multiples et le retour au classement manuel après erreur. Conserver le coût, la durée, le modèle et le fournisseur, sans secret ni document familial. La qualification Dev d'un profil ne constitue pas un GO Production ; les contrôles du candidat, migrations, sauvegarde/restauration et procédure de retour doivent être qualifiés séparément.

Les huit propositions Browser Use Capture gardent leur contrat. Les parcours exigeant une IA inactive sont exécutés dans cette configuration avant les parcours nécessitant le fournisseur actif. Chaque phase conserve sa configuration et son identité de déploiement ; aucun résultat historique n'est transféré.

Sources techniques : [PDF OpenRouter](https://openrouter.ai/docs/guides/overview/multimodal/pdfs), [routing](https://openrouter.ai/docs/guides/routing/provider-selection), [usage](https://openrouter.ai/docs/cookbook/administration/usage-accounting), [fiche Haiku](https://openrouter.ai/anthropic/claude-haiku-5.5). La disponibilité et les tarifs sont à revérifier pour chaque profil qualifié.
