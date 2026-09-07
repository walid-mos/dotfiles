local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.uv.fs_stat(lazypath) then
	vim.fn.system({
		"git",
		"clone",
		"--filter=blob:none",
		"https://github.com/folke/lazy.nvim.git",
		"--branch=stable",
		lazypath,
	})
end
vim.opt.rtp:prepend(lazypath)

require("core.options")
require("core.autocmd")

require("lazy").setup({
	spec = {
		{ import = "plugins" },
		{ import = "themes" },
	},
	install = { colorscheme = { "catppuccin" } },
	checker = { enabled = false },
})

require("core.keymaps")
