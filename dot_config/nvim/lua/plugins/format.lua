-- Formatage piloté par les fichiers de config du projet :
--   * à la sauvegarde : seulement si un fichier de config du formateur est trouvé
--     (en remontant depuis le fichier). Config trouvée mais échec => erreur bruyante.
--   * manuel (<leader>cf / :Format) : formateur du projet, sinon fallback par langage.
--   * :FormatToggle (<leader>uf) coupe/rétablit le format-on-save pour le buffer.
--   * :FormatInfo affiche le formateur résolu et le fichier qui l'a déclenché.

local function json_has_key(path, key)
  local f = io.open(path, "r")
  if not f then return false end
  local ok, data = pcall(vim.json.decode, f:read("*a"))
  f:close()
  return ok and type(data) == "table" and data[key] ~= nil
end

local function file_contains(path, pattern)
  local f = io.open(path, "r")
  if not f then return false end
  local content = f:read("*a")
  f:close()
  return content:find(pattern) ~= nil
end

local function set(list)
  local s = {}
  for _, v in ipairs(list) do s[v] = true end
  return s
end

-- Pour chaque formateur : fonction(name, dir) -> true si `name` dans `dir` est une config valide.
local detectors = {
  oxfmt = (function()
    local s = set({ ".oxfmtrc.json", ".oxfmtrc.jsonc", "oxfmt.config.ts" })
    return function(name) return s[name] end
  end)(),
  biome = (function()
    local s = set({ "biome.json", "biome.jsonc" })
    return function(name) return s[name] end
  end)(),
  prettier = function(name, dir)
    if name == "package.json" then return json_has_key(dir .. "/" .. name, "prettier") end
    return name:match("^%.prettierrc") ~= nil or name:match("^prettier%.config%.") ~= nil
  end,
  stylua = (function()
    local s = set({ "stylua.toml", ".stylua.toml" })
    return function(name) return s[name] end
  end)(),
  ruff_format = function(name, dir)
    if name == "pyproject.toml" then return file_contains(dir .. "/" .. name, "%[tool%.ruff") end
    return name == "ruff.toml" or name == ".ruff.toml"
  end,
  -- Exception assumée : rustfmt est le standard universel, Cargo.toml suffit.
  rustfmt = (function()
    local s = set({ "rustfmt.toml", ".rustfmt.toml", "Cargo.toml" })
    return function(name) return s[name] end
  end)(),
  shfmt = function(name, dir)
    if name ~= ".editorconfig" then return false end
    local path = dir .. "/" .. name
    return file_contains(path, "shell_variant") or file_contains(path, "%[[^%]]*sh[^%]]*%]")
  end,
  odinfmt = function(name) return name == "odinfmt.json" end,
}

local web = { "oxfmt", "biome", "prettier" } -- ordre = priorité en cas d'égalité de distance

-- Candidats par filetype (avec config projet)
local by_ft = {
  javascript = web, javascriptreact = web, typescript = web, typescriptreact = web,
  json = web, jsonc = web, css = web, scss = web, less = web, html = web,
  vue = web, svelte = web, astro = web, markdown = web, yaml = web, graphql = web,
  lua = { "stylua" },
  python = { "ruff_format" },
  rust = { "rustfmt" },
  sh = { "shfmt" }, bash = { "shfmt" },
  odin = { "odinfmt" },
}

-- Fallback manuel quand le projet n'a aucune config
local fallback = {
  javascript = "oxfmt", javascriptreact = "oxfmt", typescript = "oxfmt", typescriptreact = "oxfmt",
  json = "oxfmt", jsonc = "oxfmt", css = "oxfmt", scss = "oxfmt",
  lua = "stylua", python = "ruff_format", rust = "rustfmt",
  sh = "shfmt", bash = "shfmt", odin = "odinfmt",
}

--- Résout le formateur du projet pour un buffer : la config la plus proche gagne.
---@return string? formatter, string? config_path
local function resolve(buf)
  local candidates = by_ft[vim.bo[buf].filetype]
  local file = vim.api.nvim_buf_get_name(buf)
  if not candidates or file == "" then return nil end

  local home = vim.uv.os_homedir()
  local best, best_path, best_depth
  for _, name in ipairs(candidates) do
    local found = vim.fs.find(detectors[name], {
      upward = true,
      path = vim.fs.dirname(file),
      stop = home,
      limit = 1,
    })[1]
    if found then
      local depth = #vim.split(vim.fs.dirname(found), "/")
      if not best_depth or depth > best_depth then
        best, best_path, best_depth = name, found, depth
      end
    end
  end
  return best, best_path
end

local function run(buf, formatter, opts)
  local conform = require("conform")
  local info = conform.get_formatter_info(formatter, buf)
  if not info.available then
    vim.notify(
      ("Format: '%s' requis (%s) mais indisponible : %s"):format(formatter, opts.reason, info.available_msg or "?"),
      vim.log.levels.ERROR
    )
    return
  end
  conform.format({ bufnr = buf, formatters = { formatter }, async = false, timeout_ms = 3000 }, function(err)
    if err then
      vim.notify(("Format: '%s' a échoué (%s)\n%s"):format(formatter, opts.reason, err), vim.log.levels.ERROR)
    end
  end)
end

local function format_manual(buf)
  local formatter, cfg = resolve(buf)
  if formatter then return run(buf, formatter, { reason = cfg }) end
  local fb = fallback[vim.bo[buf].filetype]
  if fb then return run(buf, fb, { reason = "fallback manuel" }) end
  require("conform").format({ bufnr = buf, lsp_format = "fallback" })
end

return {
  {
    "stevearc/conform.nvim",
    event = "BufWritePre",
    cmd = { "Format", "FormatToggle", "FormatInfo", "ConformInfo" },
    keys = {
      { "<leader>cf", function() format_manual(0) end, desc = "Format buffer" },
      { "<leader>uf", "<cmd>FormatToggle<cr>", desc = "Toggle format on save (buffer)" },
    },
    opts = {
      notify_on_error = false, -- géré par nous, en ERROR
      formatters = {
        -- odinfmt est livré avec le paquet Mason d'ols, sous un nom suffixé par la plateforme
        odinfmt = {
          command = function()
            local bin = vim.fn.glob(vim.fn.stdpath("data") .. "/mason/packages/ols/odinfmt-*", false, true)[1]
            return bin or "odinfmt"
          end,
        },
      },
    },
    config = function(_, opts)
      require("conform").setup(opts)

      vim.api.nvim_create_autocmd("BufWritePre", {
        group = vim.api.nvim_create_augroup("user.format", { clear = true }),
        callback = function(args)
          if vim.b[args.buf].format_on_save_disabled then return end
          local formatter, cfg = resolve(args.buf)
          if formatter then run(args.buf, formatter, { reason = cfg }) end
        end,
      })

      vim.api.nvim_create_user_command("Format", function() format_manual(0) end, { desc = "Format buffer" })

      vim.api.nvim_create_user_command("FormatToggle", function()
        vim.b.format_on_save_disabled = not vim.b.format_on_save_disabled
        vim.notify("Format on save " .. (vim.b.format_on_save_disabled and "désactivé" or "activé") .. " (buffer)")
      end, { desc = "Toggle format on save for buffer" })

      vim.api.nvim_create_user_command("FormatInfo", function()
        local formatter, cfg = resolve(0)
        local disabled = vim.b.format_on_save_disabled and " [désactivé pour ce buffer]" or ""
        if formatter then
          vim.notify(("On save : %s (via %s)%s"):format(formatter, cfg, disabled))
        else
          local fb = fallback[vim.bo.filetype]
          vim.notify(("On save : aucun (pas de config projet). Manuel : %s"):format(fb or "LSP"))
        end
      end, { desc = "Show resolved formatter" })
    end,
  },
}
