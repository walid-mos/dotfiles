-- Keymaps sans plugin. Les keymaps de plugins vivent dans leur spec (lua/plugins/).
local map = vim.keymap.set

map("n", "<Esc>", "<cmd>nohlsearch<cr>", { desc = "Clear search highlight" })

map("n", "<C-h>", "<C-w>h", { desc = "Window left" })
map("n", "<C-j>", "<C-w>j", { desc = "Window down" })
map("n", "<C-k>", "<C-w>k", { desc = "Window up" })
map("n", "<C-l>", "<C-w>l", { desc = "Window right" })

map("v", "<", "<gv", { desc = "Indent left (keep selection)" })
map("v", ">", ">gv", { desc = "Indent right (keep selection)" })

map("n", "<leader>ub", function()
  vim.o.background = vim.o.background == "dark" and "light" or "dark"
end, { desc = "Toggle light/dark background" })
