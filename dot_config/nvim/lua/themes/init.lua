-- Thèmes : un fichier par thème (spec lazy), une PAIRE clair/sombre persistée hors config.
--   Le fond (clair/sombre) suit macOS et le terminal Herdr : nvim le détecte au démarrage,
--   auto-dark-mode.nvim le met à jour en direct (lua/plugins/appearance.lua).
--   <leader>uc : picker avec preview live (fzf-lua) ; le thème choisi remplace celui
--                de son fond (un thème clair va dans l'emplacement « light »).
--   <leader>ub : bascule manuelle clair/sombre (charge l'autre thème de la paire).
local M = {}

M.themes = {
  "catppuccin", "tokyonight", "rose-pine", "kanagawa", "nightfox",
  "github", "everforest", "gruvbox", "flexoki", "onedarkpro",
}

-- Même palette que Herdr (themes/rose-pine-dawn.json, themes/kanagawa-wave.json).
M.default = { light = "rose-pine-dawn", dark = "kanagawa-wave" }

local state_file = vim.fn.stdpath("state") .. "/colorscheme.json"
local state = { light = M.default.light, dark = M.default.dark }
local loading = false   -- vrai pendant le chargement d'un colorscheme (il peut changer 'background')
local from_pair = false -- vrai quand c'est la paire elle-même qui charge le thème

function M.specs()
  return vim.tbl_map(function(name) return require("themes." .. name) end, M.themes)
end

local function read_state()
  local f = io.open(state_file, "r")
  if not f then return end
  local ok, data = pcall(vim.json.decode, f:read("*a"))
  f:close()
  if not ok or type(data) ~= "table" then return end
  if data.light or data.dark then
    state.light = data.light or state.light
    state.dark = data.dark or state.dark
  end
  -- L'ancien format ({ name, background }) est ignoré : la paire par défaut s'applique.
end

local function write_state()
  local f = io.open(state_file, "w")
  if not f then return end
  f:write(vim.json.encode(state))
  f:close()
end

--- Charge le thème de la paire qui correspond au fond demandé.
local function apply_for(bg)
  local name = state[bg] or M.default[bg]
  from_pair, loading = true, true
  vim.o.background = bg
  if not pcall(vim.cmd.colorscheme, name) then
    vim.notify(("Thème '%s' introuvable, retour à %s"):format(name, M.default[bg]), vim.log.levels.WARN)
    name = M.default[bg]
    vim.cmd.colorscheme(name)
  end
  vim.o.background = bg   -- certains thèmes imposent leur fond : on garde celui demandé
  from_pair, loading = false, false
  vim.g.user_colorscheme = name
end

-- Changement de fond (macOS, terminal, <leader>ub) → thème de la paire.
-- Attention : quand 'background' change, nvim recharge lui-même le thème courant sous son
-- nom générique (kanagawa-wave → « kanagawa » → variante lotus en clair). Ce rechargement
-- réflexe n'est pas un choix : il n'est pas mémorisé (voir ColorScheme), et la paire est
-- réappliquée juste après (vim.schedule) pour avoir le dernier mot.
local ready = false
vim.api.nvim_create_autocmd("OptionSet", {
  group = vim.api.nvim_create_augroup("user.themes.background", { clear = true }),
  pattern = "background",
  callback = function()
    if not ready or loading then return end
    vim.schedule(function()
      local bg = vim.o.background
      if state[bg] ~= vim.g.user_colorscheme then apply_for(bg) end
    end)
  end,
})

--- Colorschemes fournis par les plugins de thème (exclut ceux livrés avec Neovim).
function M.available()
  local runtime = vim.env.VIMRUNTIME
  local seen, list = {}, {}
  for _, path in ipairs(vim.api.nvim_get_runtime_file("colors/*.{vim,lua}", true)) do
    if not vim.startswith(path, runtime) then
      local name = vim.fn.fnamemodify(path, ":t:r")
      if not seen[name] then
        seen[name] = true
        table.insert(list, name)
      end
    end
  end
  table.sort(list)
  return list
end

function M.pick()
  require("fzf-lua").colorschemes({ colors = M.available() })
end

function M.apply()
  read_state()
  local group = vim.api.nvim_create_augroup("user.themes", { clear = true })
  ready = true

  -- Avant la réponse du terminal, on part sur le clair (cas le plus fréquent) ;
  -- nvim corrige 'background' dès que le terminal a répondu, ce qui recharge la paire.
  apply_for(vim.o.background == "dark" and "dark" or "light")

  local previous   -- thème chargé juste avant (vim.g.colors_name)
  vim.api.nvim_create_autocmd("ColorSchemePre", {
    group = group,
    callback = function() loading, previous = true, vim.g.colors_name end,
  })
  vim.api.nvim_create_autocmd("ColorScheme", {
    group = group,
    -- args.match = nom passé à :colorscheme (kanagawa-dragon), pas vim.g.colors_name (kanagawa)
    callback = function(args)
      -- Réflexe = la paire qui se charge, ou nvim qui recharge le même thème après un
      -- changement de fond (même nom que le thème courant).
      local reflex = from_pair or args.match == previous
      loading = false
      if reflex then return end
      -- Choix explicite (picker, :colorscheme) : il remplace le thème de son fond.
      vim.g.user_colorscheme = args.match
      state[vim.o.background == "dark" and "dark" or "light"] = args.match
      write_state()
    end,
  })
end

return M
