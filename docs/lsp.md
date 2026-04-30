# Built-in LSP

oh-my-kimichan ships a bundled TypeScript LSP launcher for open-source projects.

## Commands

```bash
omk lsp --print-config   # print the default .omk/lsp.json payload
omk lsp --check          # show the resolved bundled language-server binary
omk lsp typescript       # start typescript-language-server over stdio
```

## Default project config

`omk init` writes `.omk/lsp.json` with a TypeScript server entry:

```json
{
  "version": 1,
  "enabled": true,
  "defaultServer": "typescript",
  "servers": {
    "typescript": {
      "command": "omk",
      "args": ["lsp", "typescript"],
      "languages": ["typescript", "typescriptreact", "javascript", "javascriptreact"],
      "rootPatterns": ["tsconfig.json", "jsconfig.json", "package.json"],
      "bundled": true
    }
  }
}
```

The launcher uses the package-local `typescript-language-server` dependency, so consumers do not need maintainer-local paths or API keys.

## Security notes

- The LSP config contains no credentials.
- It starts only the bundled TypeScript LSP by default.
- Additional language servers should be added explicitly per project.
