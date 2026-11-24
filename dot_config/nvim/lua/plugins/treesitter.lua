local parsers = {
  "bash", "css", "diff", "dockerfile", "gitcommit", "html", "javascript", "json",
  "lua", "luadoc", "markdown", "markdown_inline", "odin", "python", "query", "regex",
  "rust", "scss", "sql", "terraform", "toml", "tsx", "typescript", "vim", "vimdoc", "yaml",
}

return {
  {
    "nvim-treesitter/nvim-treesitter",
    branch = "main",
    lazy = false,
    build = ":TSUpdate",
    config = function()
      require("nvim-treesitter").install(parsers)
      vim.api.nvim_create_autocmd("FileType", {
        group = vim.api.nvim_create_augroup("user.treesitter", { clear = true }),
        callback = function(args)
          if pcall(vim.treesitter.start, args.buf) then
            vim.bo[args.buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
          end
        end,
      })
    end,
  },
}
