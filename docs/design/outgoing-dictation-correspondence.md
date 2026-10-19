# Envois — dictée de l’objet et du message

Intégration du 19 octobre 2026, Issue #82. Hand-off Claude Design validé par Amaury : archive `35178a73b467255e90302969626085824512e33c7efa6e064ef7f8a943fdaebf`.

| Source exacte | SHA-256 | Correspondance produit |
| --- | --- | --- |
| Hestia Envois - dictee.dc.html | 4c9c6ecb420b658700565c48feea79540ee5cf727f82412a3469daae3b9d44d0 | `outgoing-workspace.tsx`, `outgoing-dictation.tsx`, `outgoing.css` : pile sous chaque champ, compteurs, P21, résultat séparé, information tablette/ordinateur, résumé de vérification |
| Notes - Envois dictee.md | 22f61dc6bf41dbe06b09a1520336bd555f7ececd3fbaa7304673592590cfc136 | États, erreurs, interruptions, ajout explicite et retrait conditionné |

Clé de voûte 1.6 P21/P22 réemployée depuis le parcours Commentaire et voix déjà intégré ; Envois V2 et extensions 1.9 P30–P33 conservés. Les styles de Capture déjà chargés fournissent P21/P22 ; seuls les styles de composition exacts du nouveau hand-off sont ajoutés dans `outgoing.css`. L’information de confidentialité est masquée sous 600 px conformément au design validé. La consigne utilisateur exclut les changements de navigation du prototype : aucun changement de navigation n’est repris.

Les mentions historiques « proposition candidate » des notes brutes ne remplacent pas la source de validation exacte conservée avec la réception. La simulation, React/Babel par CDN, scripts Design et polices distantes ne sont pas importés. Le vrai `DictationRecorder`, son AudioWorklet, sa limite de deux minutes et l’encodage WAV existants sont réemployés.

Adaptations techniques : compteur Unicode selon le contrat Envois serveur (200 / 20 000 points de code), normalisation monoligne de l’objet, conservation des paragraphes du message et absence de troncature. L’auto-sauvegarde ordinaire confirme seule « Enregistrée dans Hestia ». Une nouvelle préparation vide est amorcée au clic explicite ; une lecture seule ne la crée pas.

Le contrôleur éphémère lie la capture au compte, à la préparation et au champ. Changement de source, abandon, nouvelle préparation, retrait d’accès et sortie de la vue invalident tout résultat tardif. La hausse de révision due à une sauvegarde ne suffit pas à jeter le résultat : une édition du champ cible impose un résultat séparé et éditable. Le retrait de l’ajout reste possible uniquement tant que le champ correspond exactement à la valeur ajoutée. Le bouton de vérification conserve le refus et le résumé focalisé définis dans le hand-off.

Les tests unitaires isolent les courses et les limites ; les tests navigateur utilisent le vrai recorder avec microphone synthétique et transport HTTP local simulé, sans appel fournisseur ni données familiales. Ces contrôles ne qualifient ni la qualité du fournisseur ni un appareil réel. La revue indépendante et les résultats du candidat exact sont rattachés au dossier de qualification du lot.
