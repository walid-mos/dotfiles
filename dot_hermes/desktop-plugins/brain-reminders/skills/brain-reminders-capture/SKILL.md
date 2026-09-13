# Tâches / Rappels (Brain/Tasks)

## Capture en chat (usage quotidien)

Quand Walid mentionne une tâche à faire plus tard, utiliser la skill `brain-reminders` :
importer `taskdb` depuis `/Users/walid-mos/.hermes/plugins/brain-reminders`, puis
`add(text, domain=...)` — déduire le domaine du contexte (projet en cours > domaine
existant > Inbox), ne jamais poser de question, confirmer en une ligne où c'est rangé.

## Clôture

« c'est fait / task faite X » → `taskdb.set_status(ref, "done")` (ref = ^id ou sous-chaîne).

## Widget

Le pane « Rappels » du desktop Hermes lit `/api/plugins/brain-reminders` (backend
`plugin_api.py` du plugin `brain-reminders`, activé dans `plugins.enabled`).
