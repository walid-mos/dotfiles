local opt = vim.opt

-- ui2 : nouvelle UI messages + cmdline (expérimental en 0.12)
pcall(function() require("vim._core.ui2").enable({}) end)

opt.number = true
opt.relativenumber = true
opt.signcolumn = "yes"
opt.cursorline = true
opt.scrolloff = 8
opt.sidescrolloff = 8
-- Wrap long lines at word boundaries, keeping the indent of the wrapped line
opt.wrap = true
opt.linebreak = true
opt.breakindent = true
opt.showbreak = "↪ "
opt.winborder = "rounded"
opt.list = true
opt.listchars = { tab = "» ", trail = "·", nbsp = "␣" }

opt.mouse = "a"
opt.confirm = true
opt.undofile = true
opt.swapfile = false
opt.updatetime = 250
opt.timeoutlen = 400

opt.ignorecase = true
opt.smartcase = true
opt.inccommand = "split"

opt.expandtab = true
opt.shiftwidth = 2
opt.tabstop = 2
opt.smartindent = true

opt.splitright = true
opt.splitbelow = true

-- Clipboard système, chargé après le démarrage (évite de ralentir l'ouverture)
vim.schedule(function() opt.clipboard = "unnamedplus" end)

vim.diagnostic.config({
  severity_sort = true,
  virtual_text = { spacing = 2, source = "if_many" },
  float = { source = "if_many" },
})
