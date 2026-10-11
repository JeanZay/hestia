# Capture — guide de rangement et chemin confirmé

Intégration technique du complément Claude Design reçu le 11 octobre 2026,
après validation du brief v1 et du référentiel adaptable v2. Haiku reste le
modèle retenu ; le guide ne peuple pas le coffre et ne confère aucun droit.

## Référence de design

- Archive originale : `design-handoff-capture-reference-root-v1.zip.zip`.
- SHA-256 : `36a2857418c7d86adba66dd0a5c4483ae7cab1d7efba6321d0571ac5be05e328`.
- Sources retenues : `Hestia Capture - racine.dc.html`,
  `ds-ext/propositions-1.5.js` (P19 PathPlan) et les comportements du modèle
  `hestia-capture-root-model.js`, réimplémentés avec les droits du serveur.
- Clé de voûte 1.5 ajoute P19 aux composants validés 1.0–1.4. Les tokens,
  polices, logo et icônes existants sont réemployés avec leurs attributions
  antérieures ; aucun nouvel asset ni dépendance externe.
- L'archive brute, son runtime de simulation, `support.js` et sa vignette ne
  sont pas intégrés au produit. Inventaire, réception, validation contextuelle
  et revue indépendante sont conservés dans les preuves locales du lot.

## Correspondance technique

`capture-path-plan.tsx` et les styles P19 de `capture.css` reprennent les
statuts racine, départ, réutilisé, nouveau, ambigu, à déterminer et document.
Chaque niveau porte une icône et un texte. Le chemin est une liste ordonnée ;
ses libellés passent sous les noms à moins de 600 px et les noms longs peuvent
revenir à la ligne.

`capture-destinations.tsx` reprend les cartes du hand-off : édition des noms,
résolution des homonymes, aperçu des niveaux réutilisés et manquants,
changement de point de départ dans la carte, annulation sans effet et retour
au point proposé. La sélection est invalidée après une modification. Un
chemin entièrement présent devient une destination existante. Une racine
visible partagée n'est pas présentée comme une nouvelle racine privée.

La métadonnée « Créé par » et les comptes visibles proviennent de la projection
déjà autorisée des dossiers. La simulation « Partagé par » n'est pas utilisée :
elle ne doit pas exposer les concessions d'accès privées. Le marqueur de
sélection réemploie le StatusPill existant avec son icône de validation.

`capture-workspace.tsx` conserve le classement manuel en premier, puis le
dossier courant s'il est disponible, les suggestions existantes et les
créations. La confirmation affiche le chemin concret renvoyé par le serveur
et les accès autorisés. Une modification du chemin ou des accès impose un
nouveau choix et un nouvel aperçu ; le rafraîchissement des dossiers ne
déclenche pas une nouvelle analyse payante. Une réponse d'enregistrement
incertaine utilise toujours le reçu d'idempotence avant tout nouvel essai.

## Vérification attendue

Les tests Playwright locaux couvrent les cartes au clavier, le changement
annulé/rétabli, une racine privée réellement inaccessible à un autre membre,
le préfixe partiel puis complet après collision, les homonymes et un
sous-dossier partagé aux ancêtres invisibles. Seule la réponse de classement
est simulée : original, aperçu, droits, dossiers et finalisation utilisent le
serveur et les ressources synthétiques de la campagne.

Ces tests et les captures produites doivent être exécutés sur le candidat
exact avant qualification. Leur présence ne constitue ni un résultat de test,
ni une recette Browser Use, ni une qualification fournisseur ou Dev.
