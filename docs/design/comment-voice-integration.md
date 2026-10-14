# Commentaire et voix — Clé de voûte 1.6

Hand-off `claude-design-handoff-comment-voice-v1.zip`, validé par Amaury le 14 octobre 2026, SHA-256 `f99ebc7f0910493e8b4af4b4854a5ac3b6e180e92f345c15040b11b5f8380930`.

Sources retenues :

| Source du hand-off | SHA-256 | Intégration |
| --- | --- | --- |
| Hestia Capture - commentaire.dc.html | a7b3eed972f17fd0a4d962cb5049e3ce61399ba1c5a943c5df5f4b52ba0703b3 | Bloc commentaire, résultat en attente, contradictions et réglages |
| ds-ext/propositions-1.6.js | 3870391a8f3aac9946f4851e592dba04efbd3dca63d9eb06f63e336700851ca2 | P20 icônes, P21 DictationControl, P22 LengthMeter |
| hestia-voice-model.js | 362f39c51ecb4a9278747adf5fc19bc60e1880f0cafc7e4bed6f63e6489ed06b | Référence comportementale uniquement ; aucune simulation importée |

La réception exacte et la revue sont conservées dans les artifacts privés du lot. Les mentions historiques « proposé » du package sont rapprochées de la validation explicite de cette archive. Les versions 1.0 à 1.5 du système restent réemployées.

Adaptations techniques : minuteur isolé ; révision de commentaire indépendante des pixels ; autosauvegarde coalescée ; protection des réponses anciennes ; bouton Dicter désactivé avec la variante existante tant qu'un résultat attend ajout/abandon. Ces adaptations corrigent les courses de la simulation sans inventer d'écran.

Les dépendances React/Babel CDN, données de simulation, modèle B fictif, police distante et HTML exécutable ne sont pas importés. Le produit conserve ses bibliothèques et polices locales. Les trois tracés Lucide sont attribués dans THIRD-PARTY-NOTICES.md. Les images de téléphone et les résultats de simulation ne constituent aucune preuve de performance ou de transcription réelle.
