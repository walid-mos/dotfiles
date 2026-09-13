# Freelance Presence Agent — mécanismes par plateforme (validés le 24/08/2026)

Source de vérité vivante : `/Users/walid-mos/.hermes/freelance-presence-agent/README.md` (mis à jour par l'agent lui-même). Ce fichier capture les mécanismes à date pour référence.

| Site | URL de travail | Mécanisme quotidien |
|---|---|---|
| Free-Work | `free-work.com/fr/resume` | Bouton « Confirmer dispo » → toast « Votre disponibilité a bien été confirmée » |
| Freelance.com | `plateforme.freelance.com` | Popover avatar (2e `span.cw-popover`, ~(1526,32)) → « Actualiser ». ⚠️ NE JAMAIS cliquer le « Valider » de la section « Mandat de facturation » = document juridique Coworkées |
| FreelanceRepublik | `app.freelancerepublik.com/situation` | Onglet « Je suis à l'écoute » + radio « immédiatement » → Enregistrer. Login via Auth0 (`login.freelancerepublik.com`) : erreurs transitoires fréquentes, passer directement par app. |
| Malt | `malt.fr/dashboard/freelancer/` | Carte dashboard « Disponibilité confirmée », CTA visible seulement si pas encore confirmé aujourd'hui. « Vous avez confirmé votre disponibilité aujourd'hui » = succès |
| Collective | `app.collective.work/talent/profile` | Bouton statut « En recherche active (N jours restants) » (Chakra) → option « Disponible pour rencontrer un client » → Sauvegarder → compteur repasse à 30 jours |

## Durées de vie des tokens observées
- Free-Work : refresh_token ~2 jours
- Malt : SESSION/JSESSIONID = session-cookies purs (meurent à la fermeture navigateur)
- FreelanceRepublik : rl_session cookie long mais invalidable côté serveur (Auth0)
- Credentials stockés Keychain : `hermes-freelance-presence-creds-{site}` (JSON {url, login_url?, user, password}) — reconnexion auto autorisée par l'utilisateur ; CAPTCHA/2FA = STOP.
