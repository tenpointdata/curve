# Curve 2 formatter language server

`curve2-fmt-lsp` is a formatting-only language server for Curve 2. It supports
full-document formatting over stdio and intentionally exposes no diagnostics,
completion, hover, range-formatting, or on-type-formatting features.

## Install and run

Node.js 22 or newer is required. From the repository root:

```sh
cd tools/curve-fmt-lsp
npm ci
npm run build
```

To run the server directly from this checkout, use `node dist/server.js --stdio`.
To use the editor configurations below, install the built package as a command:

```sh
npm install -g .
```

Run this from `tools/curve-fmt-lsp` after building. Without the global install,
configure your editor to run `node` with the absolute path to `dist/server.js`
and `--stdio` instead.

The server handles documents whose language ID is `curve` or `curve2`. It
preserves line breaks, blank lines, comments, literal spelling, each line ending
(including mixed LF/CRLF), and the final-newline state. Formatting normalizes
indentation and safe token spacing without wrapping code. Nested match arms
stay with their match even when an arm body dedents. When a document cannot
be tokenized safely, the server returns no edits.

## Editor setup

Neovim with `nvim-lspconfig`:

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = "curve",
  callback = function()
    vim.lsp.start({
      name = "curve2-fmt-lsp",
      cmd = { "curve2-fmt-lsp", "--stdio" },
      root_dir = vim.fs.root(0, { ".git" }),
    })
  end,
})
```

Helix (`languages.toml`):

```toml
[language-server.curve2-fmt-lsp]
command = "curve2-fmt-lsp"
args = ["--stdio"]

[[language]]
name = "curve"
scope = "source.curve"
file-types = ["curve"]
language-servers = ["curve2-fmt-lsp"]
auto-format = true
```

Emacs with Eglot:

```elisp
(add-to-list 'eglot-server-programs
             '(curve-mode . ("curve2-fmt-lsp" "--stdio")))
```
