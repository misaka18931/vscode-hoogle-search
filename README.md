# hoogle-search

A Visual Studio Code extension for searching [Hoogle](https://hoogle.haskell.org/) the Haskell API search engine, without leaving the editor.

## Features
- Search with local Hoogle instance.
- Hackage tab history (press `b` to go back, for local Hoogle instance only).
- Support Quick Jump for local Hoogle instance (press `s` to search).
- Preview search results as you type.

## Extension Settings
- `hoogle-search.useLocalInstance`: Search with local `hoogle` command.
- `hoogle-search.hooglePath`: Path to the Hoogle executable when local instance is used.

## TODO
- [ ] Better rendering of the QuickPickItems
- [ ] Support history for remote Hoogle
- [ ] Dark Theme for Hackage in webview