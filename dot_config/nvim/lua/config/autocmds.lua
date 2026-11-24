local group = vim.api.nvim_create_augroup("user.config", { clear = true })
local autocmd = vim.api.nvim_create_autocmd

autocmd("TextYankPost", {
  group = group,
  desc = "Highlight yanked text",
  callback = function() vim.hl.on_yank() end,
})

autocmd("BufReadPost", {
  group = group,
  desc = "Restore last cursor position",
  callback = function(args)
    local mark = vim.api.nvim_buf_get_mark(args.buf, '"')
    local lines = vim.api.nvim_buf_line_count(args.buf)
    if mark[1] > 0 and mark[1] <= lines then
      pcall(vim.api.nvim_win_set_cursor, 0, mark)
    end
  end,
})

autocmd("VimResized", {
  group = group,
  desc = "Equalize splits on resize",
  command = "tabdo wincmd =",
})
