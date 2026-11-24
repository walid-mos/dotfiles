return {
  {
    "stevearc/oil.nvim",
    lazy = false,
    opts = {
      default_file_explorer = true,
      view_options = { show_hidden = true },
    },
    keys = {
      { "-", "<cmd>Oil<cr>", desc = "Open parent directory (oil)" },
    },
  },
  {
    "ibhagwan/fzf-lua",
    cmd = "FzfLua",
    opts = {},
    keys = {
      { "<leader>ff", "<cmd>FzfLua files<cr>", desc = "Find files" },
      { "<leader>fg", "<cmd>FzfLua live_grep<cr>", desc = "Live grep" },
      { "<leader>fb", "<cmd>FzfLua buffers<cr>", desc = "Buffers" },
      { "<leader>fr", "<cmd>FzfLua oldfiles<cr>", desc = "Recent files" },
      { "<leader>fh", "<cmd>FzfLua helptags<cr>", desc = "Help tags" },
      { "<leader>fd", "<cmd>FzfLua diagnostics_workspace<cr>", desc = "Diagnostics" },
      { "<leader>fs", "<cmd>FzfLua lsp_document_symbols<cr>", desc = "Document symbols" },
      { "<leader>fk", "<cmd>FzfLua keymaps<cr>", desc = "Keymaps" },
      { "<leader>f.", "<cmd>FzfLua resume<cr>", desc = "Resume last picker" },
      { "<leader>uc", function() require("themes").pick() end, desc = "Pick colorscheme" },
    },
  },
}
