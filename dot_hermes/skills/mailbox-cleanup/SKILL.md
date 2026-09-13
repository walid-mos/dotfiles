---
name: mail-account-hygiene
description: "Use when auditing, deduplicating or cleaning mailboxes."
version: 1.0.0
author: Walid + Hermes
license: MIT
platforms: [macos]
metadata:
  hermes:
    tags: [Email, IMAP, Cleanup, himalaya]
---

# Hygiène et nettoyage de boîtes mail

## When to Use

- Audit/clean des boîtes de Walid (doublons, indésirables, archives)
- Avant toute suppression : la politique sécurité (skill email-accounts) exige
  une confirmation explicite de Walid dans la conversation ; ensuite seulement
  appeler `himalaya` en direct pour ces opérations précises.

## Compter les mails d'un dossier

`envelope list --page-size 1` ne donne PAS le total. Utiliser :
```bash
himalaya imap status --account <NAME> "<MAILBOX>"   # ligne "Messages"
```
Lister les dossiers : `himalaya mailbox list --account <NAME>`.

## Doublons : vérifier avant d'affirmer

Des sujets identiques ≠ doublons. Vérifier les Message-ID :
```bash
himalaya imap fetch --account <NAME> --mailbox "<M>" "<id1>,<id2>" | grep -i message-id
```
Cas réel (Gmail) : deux notifications GitHub du même PR = 2 Message-ID distincts.
Et Gmail ne duplique jamais : All Mail = 1 copie, les labels sont des vues.

## Inventaire relevé 2026-08-24 (à re-mesurer avant usage)

| Compte | Gros volumes | Indésirables |
|---|---|---|
| gmail | All Mail 6 596 | Spam 20, Trash 15 |
| zoho | Archive 7 197 | Poubelle 44 + Deleted Messages 40 + Spam 2 |
| outlook1 | Archive 10 372 | Junk 82, Deleted 20 |
| outlook2 | Archive 9 878 | Junk 210, Deleted 29 |

Particularités : Zoho a DEUX corbeilles (Poubelle + Deleted Messages), normal.
Outlook a un dossier "Problèmes de synchronisation" à ignorer.

## Procédure de nettoyage type

1. Auditer (lecture seule via `~/.config/himalaya/email-guard.py`)
2. Presenter comptes/volumes + ce qui est supprimable sans risque
3. Confirmation explicite pour CHAQUE catégorie (indésirables, corbeilles)
4. Archives : proposer un critère (par âge ? rapport par année d'abord ?) —
   ne JAMAIS purger massivement sans critère validé
5. Après confirmation : `himalaya` en direct pour ces opérations précises
