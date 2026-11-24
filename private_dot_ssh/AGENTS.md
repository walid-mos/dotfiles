# Rules for ~/.ssh

## Key naming

- Never keep default names (`id_ed25519`, `id_rsa`, etc.).
- Name each key after the service or host it is used for, in lowercase:
  - `github` / `github.pub`
  - examples: `gitlab`, `bitbucket`, `vps-ovh`, `prod-server`
- If a service needs several keys (e.g. several accounts), add a dash suffix: `github-personal`, `github-work`.
- The public key has the same name plus `.pub`.

## Creating a key

- Type: ED25519.
- Comment: `<name>@<machine>`, where `<machine>` is resolved dynamically with `hostname -s` (never hardcode the machine name).
  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/<name> -C "<name>@$(hostname -s)"
  ```

## `config` file

Each key must have its own `Host` block in `~/.ssh/config`, since non-default names are not picked up automatically:

```
Host <host>
  HostName <host>
  User <user>
  IdentityFile ~/.ssh/<name>
  IdentitiesOnly yes
  AddKeysToAgent yes
  UseKeychain yes
```

- `UseKeychain` only exists on macOS. On Linux, add `IgnoreUnknown UseKeychain` at the very top of `config`, otherwise SSH rejects the file.

## `known_hosts` file

- Every host used non-interactively (agents, scripts, `BatchMode=yes`) must already be in `~/.ssh/known_hosts`, otherwise SSH fails with `Host key verification failed` because nobody can answer the "continue connecting?" prompt.
- Add a host with `ssh-keyscan`, but **always check the fingerprints against the official source before writing them**. Never blindly accept the keys.
  ```bash
  ssh-keyscan -t ed25519,ecdsa,rsa <host> > /tmp/keys
  ssh-keygen -lf /tmp/keys        # compare with the official fingerprints
  cat /tmp/keys >> ~/.ssh/known_hosts
  ```
- GitHub official fingerprints: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
- Never disable the check (`StrictHostKeyChecking no`, `UserKnownHostsFile /dev/null`).
- If `known_hosts` already exists, append to it (`>>`). Never overwrite it.

## Permissions

- `~/.ssh` directory: `700`
- Private keys and `config`: `600`
- Public keys and `known_hosts`: `644`

## For AI agents

- Never read, print or copy the contents of a private key.
- After renaming a key, update `IdentityFile` in `config`.
- Check that no file already exists before creating or renaming a key.
