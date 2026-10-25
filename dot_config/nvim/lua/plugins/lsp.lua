local function on_attach(ev)
	local map = function(mode, lhs, rhs, desc)
		vim.keymap.set(mode, lhs, rhs, { buffer = ev.buf, desc = desc })
	end

	local telescope = require("telescope.builtin")

	map("n", "gd", telescope.lsp_definitions, "Go to definition")
	map("n", "gD", vim.lsp.buf.declaration, "Go to declaration")
	map("n", "gr", telescope.lsp_references, "References")
	map("n", "gI", telescope.lsp_implementations, "Go to implementation")
	map("n", "gy", telescope.lsp_type_definitions, "Go to type definition")

	map("n", "<leader>cd", telescope.lsp_definitions, "Go to definition")
	map("n", "<leader>cD", vim.lsp.buf.declaration, "Go to declaration")
	map("n", "<leader>cr", telescope.lsp_references, "Find references")
	map("n", "<leader>ci", telescope.lsp_implementations, "Go to implementation")
	map("n", "<leader>ct", telescope.lsp_type_definitions, "Go to type definition")
	map("n", "<leader>ca", vim.lsp.buf.code_action, "Code actions")
	map("n", "<leader>cn", vim.lsp.buf.rename, "Rename symbol")
	-- Format via conform.nvim, not the LSP
	map("n", "<leader>cf", function() require("conform").format({ async = true, lsp_format = "never" }) end, "Format buffer")
	map("n", "K", vim.lsp.buf.hover, "Hover documentation")
	map("n", "gl", vim.diagnostic.open_float, "Diagnostic details")
	map("i", "<C-Space>", vim.lsp.completion.get, "Trigger completion")

	local client = ev.data.client or vim.lsp.get_client_by_id(ev.data.client_id)
	if client and client:supports_method("textDocument/completion") then
		local provider = client.server_capabilities.completionProvider
		if provider then
			local chars = vim.list_extend(vim.deepcopy(provider.triggerCharacters or {}), { "_" })
			for i = 65, 90 do
				chars[#chars + 1] = string.char(i)
			end
			for i = 97, 122 do
				chars[#chars + 1] = string.char(i)
			end
			provider.triggerCharacters = chars
		end
		vim.lsp.completion.enable(true, client.id, ev.buf, { autotrigger = true })
	end
end

local function setup_diagnostics()
	vim.diagnostic.config({
		virtual_text = { prefix = "●", spacing = 2, format = function() return "" end },
		virtual_lines = { current_line = true },
		severity_sort = true,
		underline = true,
		float = { border = "rounded", source = true },
	})

	local signs = { Error = "●", Warn = "●", Hint = "●", Info = "●" }
	for type, icon in pairs(signs) do
		local hl = "DiagnosticSign" .. type
		vim.fn.sign_define(hl, { text = icon, texthl = hl, numhl = hl })
	end
end

return {
	{ "williamboman/mason.nvim", opts = { ui = { border = "rounded" } } },

	{
		"williamboman/mason-lspconfig.nvim",
		dependencies = { "williamboman/mason.nvim" },
		opts = {
			ensure_installed = { "lua_ls", "vtsls", "pyright", "clangd", "marksman", "rust_analyzer" },
		},
	},

	{
		"neovim/nvim-lspconfig",
		dependencies = { "williamboman/mason-lspconfig.nvim" },
		config = function()
			vim.api.nvim_create_autocmd("LspAttach", {
				group = vim.api.nvim_create_augroup("UserLspConfig", {}),
				callback = on_attach,
			})

			setup_diagnostics()

			vim.lsp.config("lua_ls", {
				settings = {
					Lua = {
						runtime = { version = "LuaJIT" },
						diagnostics = { globals = { "vim" } },
						workspace = { library = vim.api.nvim_get_runtime_file("", true), checkThirdParty = false },
						telemetry = { enable = false },
					},
				},
			})

			-- mason-lspconfig auto-enables installed servers via vim.lsp.enable()

			-- ols is not in Mason, installed manually (brew install ols)
			vim.lsp.config("ols", {})
			vim.lsp.enable("ols")
		end,
	},
}
