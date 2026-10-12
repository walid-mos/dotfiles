-- Inside herdr the clipboard belongs to the viewing client: OSC 52 sends yanks
-- there, and since OSC 52 queries do not work here, paste reads the clipboard
-- of the machine viewer-host names over SSH, or this machine's when it names
-- none. Outside herdr Neovim's native macOS clipboard provider applies.
if vim.env.HERDR_ENV then
	local osc52 = require("vim.ui.clipboard.osc52")
	local function pasteFromViewer()
		local viewer = vim.system({ vim.env.HOME .. "/.config/shims/viewer-host" }, { text = true }):wait(5000)
		local host = vim.trim(viewer.stdout or "")
		local command = host == "" and { "pbpaste" }
			or {
				"ssh",
				"-o", "BatchMode=yes",
				"-o", "ConnectTimeout=2",
				"-o", "ConnectionAttempts=1",
				host, "pbpaste",
			}
		local result = vim.system(command, { text = true }):wait(3000)
		if result.code ~= 0 then
			error(host .. " clipboard unavailable over SSH; use Cmd+V (" .. (result.stderr or result.code) .. ")")
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
		name = "herdr viewer clipboard",
		copy = {
			["+"] = osc52.copy("+"),
			["*"] = osc52.copy("*"),
		},
		paste = {
			["+"] = pasteFromViewer,
			["*"] = pasteFromViewer,
		},
		cache_enabled = 0,
	}
end
vim.opt.clipboard = "unnamedplus"
