vim.keymap.set("n", "go", "o<Esc>k", { desc = "Add blank line below" })
vim.keymap.set("n", "gO", "O<Esc>j", { desc = "Add blank line above" })

vim.keymap.set("n", "<Esc>", "<cmd>nohlsearch<CR>", { desc = "Clear search highlight" })

vim.keymap.set("n", "<leader>e", vim.diagnostic.open_float, { desc = "Show diagnostic" })
vim.keymap.set("n", "]e", function()
	vim.diagnostic.jump({ count = 1, severity = vim.diagnostic.severity.ERROR })
end, { desc = "Next error" })
vim.keymap.set("n", "[e", function()
	vim.diagnostic.jump({ count = -1, severity = vim.diagnostic.severity.ERROR })
end, { desc = "Previous error" })

vim.keymap.set("n", "<leader>sh", "<cmd>vsplit<CR>", { desc = "Split right" })
vim.keymap.set("n", "<leader>sv", "<cmd>split<CR>", { desc = "Split below" })