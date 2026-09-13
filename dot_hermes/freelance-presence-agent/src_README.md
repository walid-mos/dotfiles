# Freelance Presence Agent (cron quotidien 09:00)

Agent Hermes qui maintient la visibilité de Walid sur les 5 plateformes freelance.

## Plateformes et mécanisme d'actualisation
| Site | URL de travail | Mécanisme |
|---|---|---|
| Free-Work | free-work.com/fr/resume | Bouton « Confirmer dispo » → toast « Votre disponibilité a bien été confirmée » |
| Freelance.com | plateforme.freelance.com | Popover avatar (header droite, span.cw-popover #2) → « Actualiser » ; optionnel : profil/modifier → widget dispo → DISPONIBLE → 5 jours/semaine → ENREGISTRER. ⚠️ NE PAS cliquer le bouton « Valider » de la section « Mandat de facturation » (document juridique !) |
| FreelanceRepublik | app.freelancerepublik.com/situation | Onglet « Je suis à l'écoute » + radio « immédiatement » → Enregistrer. Le login passe par login.freelancerepublik.com (Auth0) — erreurs transitoires fréquentes, utiliser app.freelancerepublik.com directement |
| Malt | malt.fr/dashboard/freelancer/ | Carte dashboard « Disponibilité confirmée » — bouton CTA visible seulement si pas encore confirmé aujourd'hui. Si « Vous avez confirmé votre disponibilité aujourd'hui » → rien à faire |
| Collective | app.collective.work/talent/profile | Bouton statut « En recherche active (N jours restants) » → choisir « Disponible pour rencontrer un client » → Sauvegarder → le compteur repasse à 30 jours |

## Sessions (Keychain)
Services : `hermes-freelance-presence-{free-work,freelance-com,freelancerepublik,malt,collective}`
- Cookies JSON complets par domaine (voir skill keychain-session-auth).
- Restauration via CDP Network.setCookie si redirection vers login.

## Identifiants (Keychain) — reconnexion automatique
Services : `hermes-freelance-presence-creds-{site}` — JSON {url, login_url?, user, password}.
Les tokens de session sont courts (Free-Work refresh_token ~2j, Malt cookies de session pure, etc.).
Procédure de reconnexion auto quand la session est morte :
1. Lire les creds dans le Keychain (`security find-generic-password -s hermes-freelance-presence-creds-<site> -w`).
2. Naviguer vers l'URL de login du JSON, remplir email + mot de passe, soumettre.
3. Si CAPTCHA/2FA/email-de-vérification apparaît → STOP pour ce site + rapport (pas de bypass).
4. Après login réussi : recapturer les cookies via Network.getCookies et mettre à jour le service `hermes-freelance-presence-<site>` du Keychain.
5. Ne JAMAIS écrire les identifiants en clair sur disque ni dans un log/rapport.

## Navigateur
Session browser-use isolée nommée `freelance-presence` (ne PAS partager avec l'agent bookmarks/Twitter : collision d'onglets).

## Run quotidien (09:00)
1. Pour chaque site : naviguer → vérifier session → déclencher le mécanisme ci-dessus.
2. Vérifier le succès (texte de confirmation / compteur / état).
3. Rapport uniquement en cas d'échec ou d'anomalie (watchdog silencieux sinon).
4. Mettre à jour state/state.json (date du dernier succès par site).
