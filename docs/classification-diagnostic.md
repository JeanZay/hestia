# Diagnostic des propositions de classement

L'outil `scripts/lib/classification-diagnostic.mjs` observe un essai synthétique explicitement autorisé. Il ne s'active pas dans l'application, ne change pas le prompt, le modèle, les droits ni le classement et ne fait aucun appel réseau.

L'opérateur transmet en mémoire le texte de l'unique réponse fournisseur, la valeur réellement retournée par l'adaptateur, les dossiers autorisés et les fonctions réelles `normalizeClassificationSuggestions` et `parseClassificationResult` du candidat examiné. Le diagnostic compare sa normalisation avec la sortie réelle de l'adaptateur ; une différence interdit une conclusion causale. La validation réelle reste l'autorité sur les résultats acceptés.

Le rapport distingue : absence de chemins dès la réponse fournisseur ; exclusions par pertinence ; parent inconnu, parent sans droit de créer ou racine interdite ; résultat invalide ; propositions conservées. Chaque étape indique ses comptes. Une erreur structurelle ne devient jamais une liste vide. Les sorties contiennent uniquement des comptes, booléens et catégories fermées : aucun document, nom, chemin, identifiant de dossier, justification, réponse brute ou erreur externe n'est copié.

Le responsable de l'essai doit borner la lecture de la réponse, employer le catalogue réellement autorisé au sujet observé, figer les sources et le corpus, vérifier les conditions fournisseur, réserver/régler le coût et empêcher toute seconde émission après une issue incertaine. L'acteur comptable du diagnostic peut être un gestionnaire synthétique ; il ne confère aucun droit supplémentaire au sujet du catalogue. Le module ne remplace pas ces contrôles. Les rapports restent des preuves locales minimisées.

Les tests hors ligne utilisent les fonctions de production et ne déclenchent aucun appel modèle :

```text
node --test tests/harness/classification-diagnostic.test.mjs
```

Un essai technique ne constitue pas une recette Browser Use et ne reconstitue pas les réponses historiques non conservées. Le résultat permet d'expliquer cette nouvelle observation, pas de certifier l'exhaustivité du modèle.
