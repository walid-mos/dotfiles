-- Catppuccin Colorscheme
-- https://github.com/catppuccin/nvim

return {
	-- Follow macOS light/dark appearance and switch flavours accordingly
	{
		"cormacrelf/dark-notify",
		priority = 999,
		config = function()
			require("dark_notify").run({
				onchange = function(light)
					vim.o.background = light and "light" or "dark"
					vim.cmd.colorscheme("catppuccin")
				end,
			})
		end,
	},

	{
	"catppuccin/nvim",
	name = "catppuccin",
	priority = 1000,

	opts = {
		-- "auto" follows vim.o.background (switched by dark-notify)
		flavour = "auto",
		transparent_background = false,
		dim_inactive = {
			enabled = false,
			shade = "dark",
			percentage = 0.15,
		},
		no_italic = false,
		no_bold = false,
		no_underline = false,

		styles = {
			comments = { "italic" },
			conditionals = { "italic" },
			loops = {},
			functions = {},
			keywords = {},
			strings = {},
			variables = {},
			numbers = {},
			booleans = {},
			properties = {},
			types = {},
			operators = {},
		},

		integrations = {
			mason = true,
			telescope = { enabled = true },
			treesitter = true,
			which_key = true,
		},

		custom_highlights = function(colors)
			return {
				CursorLineNr = { fg = colors.yellow, style = { "bold" } },
				WinSeparator = { fg = colors.overlay0, bg = "NONE" },
			}
		end,
	},

	config = function(_, opts)
		require("catppuccin").setup(opts)
		vim.cmd.colorscheme("catppuccin")
	end,
	},
}
