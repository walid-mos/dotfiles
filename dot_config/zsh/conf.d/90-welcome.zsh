# fastfetch (logo Apple) dans un terminal neuf : un shell de login (onglet Herdr, `szsh`),
# attaché à un terminal, qui n'exécute pas de commande et n'est pas en ssh.
# Exclus d'office : agents (`zsh -lic claude`), `hc run`, shells imbriqués (pas de login).
if [[ -o login && -t 1 && -z $ZSH_EXECUTION_STRING && -z $SSH_CONNECTION ]]; then
  fastfetch
fi
