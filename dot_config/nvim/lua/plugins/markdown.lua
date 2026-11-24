return {
  -- Preview navigateur (tables GFM, mermaid, KaTeX), live + scroll sync. 100% Lua.
  {
    "brianhuster/live-preview.nvim",
    cmd = "LivePreview",
    keys = {
      { "<leader>mp", "<cmd>LivePreview start<cr>", ft = "markdown", desc = "Markdown preview (browser)" },
      { "<leader>mP", "<cmd>LivePreview close<cr>", ft = "markdown", desc = "Stop markdown preview" },
    },
  },
}
