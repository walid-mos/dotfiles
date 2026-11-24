-- LSP natif (vim.lsp.config / vim.lsp.enable). nvim-lspconfig ne fournit que les
-- configs par défaut ; les surcharges vont dans ~/.config/nvim/lsp/<server>.lua.
local servers = {
  -- web
  "vtsls", "eslint", "oxlint", "tailwindcss", "cssls", "jsonls",
  -- lua / shell
  "lua_ls", "bashls",
  -- odin / python / rust
  "ols", "basedpyright", "ruff", "rust_analyzer",
  -- infra / data
  "yamlls", "dockerls", "terraformls", "marksman",
}

-- Outils non-LSP installés via Mason (formateurs pour :Format sans config projet)
local tools = { "stylua", "shfmt", "oxfmt" }

return {
  {
    "mason-org/mason.nvim",
    cmd = "Mason",
    opts = {},
    config = function(_, opts)
      require("mason").setup(opts)
      local registry = require("mason-registry")
      registry.refresh(function()
        for _, name in ipairs(tools) do
          local ok, pkg = pcall(registry.get_package, name)
          if ok and not pkg:is_installed() then pkg:install() end
        end
      end)
    end,
  },
  {
    "mason-org/mason-lspconfig.nvim",
    event = { "BufReadPre", "BufNewFile" },
    dependencies = { "mason-org/mason.nvim", "neovim/nvim-lspconfig" },
    opts = {
      ensure_installed = servers,
      -- stylua/oxfmt existent aussi en LSP : exclus, le formatage passe par conform uniquement
      automatic_enable = { exclude = { "stylua", "oxfmt" } },
    },
  },
  {
    "folke/lazydev.nvim",
    ft = "lua",
    opts = {
      library = { { path = "${3rd}/luv/library", words = { "vim%.uv" } } },
    },
  },
}
