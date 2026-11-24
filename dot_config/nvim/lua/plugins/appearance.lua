-- Fond clair/sombre qui suit macOS en direct (comme Herdr). Changer 'background'
-- recharge le thème correspondant de la paire (voir lua/themes/init.lua).
return {
  "f-person/auto-dark-mode.nvim",
  lazy = false,
  opts = {
    update_interval = 3000,
    fallback = "light",
    set_dark_mode = function() vim.o.background = "dark" end,
    set_light_mode = function() vim.o.background = "light" end,
  },
}
