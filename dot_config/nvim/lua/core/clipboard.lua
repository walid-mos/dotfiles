-- Remote herdr: OSC 52 sends yanks to the MacBook client. OSC 52 clipboard
-- queries do not work here, so read the MacBook clipboard over SSH instead.
-- Local sessions use Neovim's native macOS clipboard provider.
if vim.env.HERDR_ENV and vim.env.SSH_CONNECTION then
	local osc52 = require("vim.ui.clipboard.osc52")
	local function pasteFromMacBook()
		local result = vim.system({
			"ssh",
			"-o", "BatchMode=yes",
			"-o", "ConnectTimeout=2",
			"-o", "ConnectionAttempts=1",
			"macbook-pro", "pbpaste",
		}, { text = true }):wait(3000)
		if result.code ~= 0 then
			error("MacBook clipboard unavailable over SSH; use Cmd+V (" .. (result.stderr or result.code) .. ")")
		end

		local text = result.stdout or ""
		local lines = vim.split(text, "\n", { plain = true })
		if vim.endswith(text, "\n") then
			table.remove(lines)
			return { lines, "V" }
		end
		return { lines, "v" }
	end

	vim.g.clipboard = {
		name = "MacBook clipboard over SSH",
		copy = {
			["+"] = osc52.copy("+"),
			["*"] = osc52.copy("*"),
		},
		paste = {
			["+"] = pasteFromMacBook,
			["*"] = pasteFromMacBook,
		},
		cache_enabled = 0,
	}
end
vim.opt.clipboard = "unnamedplus"
