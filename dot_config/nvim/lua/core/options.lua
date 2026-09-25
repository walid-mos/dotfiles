-- Leader keys — must be set before plugins
vim.g.mapleader = " "
vim.g.maplocalleader = "//"

-- Disable netrw (using oil.nvim)
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1

-- Clipboard over OSC 52 inside herdr panes: the sequence is intercepted by
-- herdr and applied on the machine running the client, so yanks reach the
-- MacBook when attached with `herdr --remote` to the Studio. Outside herdr,
-- the default native providers (pbcopy) are used.
-- OSC 52 clipboard reads can time out in herdr. Keep plain y/p on Neovim's
-- registers there; use "+y to copy to the client and Cmd+V to paste from it.
if vim.env.HERDR_ENV then
	vim.g.clipboard = {
		name = "OSC 52",
		copy = {
			["+"] = require("vim.ui.clipboard.osc52").copy("+"),
			["*"] = require("vim.ui.clipboard.osc52").copy("*"),
		},
		paste = {
			["+"] = require("vim.ui.clipboard.osc52").paste("+"),
			["*"] = require("vim.ui.clipboard.osc52").paste("*"),
		},
	}
end
vim.opt.clipboard = vim.env.HERDR_ENV and "" or "unnamedplus"

vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.cursorline = true
vim.opt.ruler = false

vim.opt.mouse = "a"

vim.opt.tabstop = 4
vim.opt.shiftwidth = 4
vim.opt.softtabstop = 4
vim.opt.expandtab = true
vim.opt.smartindent = true
vim.opt.wrap = false

vim.opt.scrolloff = 4
vim.opt.sidescrolloff = 8
vim.opt.pumheight = 10
vim.opt.pumblend = 0

vim.opt.splitbelow = true
vim.opt.splitright = true

vim.opt.backup = false
vim.opt.swapfile = false
vim.opt.writebackup = false
vim.opt.hidden = true
vim.opt.autoread = true
vim.opt.undofile = true

vim.opt.ignorecase = true
vim.opt.smartcase = true

vim.wo.signcolumn = "yes"
vim.opt.updatetime = 250
vim.opt.timeoutlen = 300
vim.opt.numberwidth = 4
vim.opt.completeopt = { "menuone", "noselect" }
vim.opt.cmdheight = 1
vim.opt.termguicolors = true
vim.opt.showcmd = false
vim.opt.title = false
vim.opt.conceallevel = 0
vim.opt.laststatus = 3
vim.opt.shortmess:append("c")

vim.cmd("set whichwrap+=<,>,[,],h,l")
vim.cmd([[set iskeyword+=-]])

vim.opt.fillchars = vim.opt.fillchars + "eob: "
vim.opt.fillchars:append({ stl = " " })
vim.opt.showtabline = 0
