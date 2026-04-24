import * as vscode from "vscode";
import fetch from "node-fetch";
import { convert } from "html-to-text";
import { exec } from "child_process";
import { readFileSync, lstatSync } from "fs";
import * as path from "path";
import { parse, serialize, type DefaultTreeAdapterMap, defaultTreeAdapter } from "parse5";

type HoogleEntry = {
    url: string;
    package?: {
        name: string;
        url: string;
    };
    module?: {
        name: string;
        url: string;
    };
    type: string;
    item: string;
    docs: string;
};

type HoogleSearchOptions = {
    count?: number;
};

const hoogleProcessResult = (result: any[]) =>
    result.map(
        ({ url, package: _package, module: _module, type, item, docs }) =>
            ({
                url,
                package: Object.keys(_package).length === 0 ? undefined : _package,
                module: Object.keys(_module).length === 0 ? undefined : _module,
                type,
                item,
                docs,
            }) as HoogleEntry,
    );

function localHoogleSearch(query: string, { count }: HoogleSearchOptions = {}): Promise<HoogleEntry[]> {
    const cfg = vscode.workspace.getConfiguration("hoogle-search");
    const { promise, resolve, reject } = Promise.withResolvers<HoogleEntry[]>();
    exec(
        `${cfg.get<string>("hooglePath")} --json "${query}"` + (count ? ` --count=${count}` : ""),
        (error, stdout, _) => {
            if (error) {
                reject(error);
            } else {
                if (stdout === "No results found\n") {
                    resolve([]);
                    return;
                }
                try {
                    const result = JSON.parse(stdout) as any[];
                    resolve(hoogleProcessResult(result));
                } catch (error) {
                    reject(error);
                }
            }
        },
    );
    return promise;
}

function remoteHoogleSearch(query: string, { count }: HoogleSearchOptions = {}): Promise<HoogleEntry[]> {
    const url = `https://hoogle.haskell.org?format=text&mode=json&hoogle=${encodeURIComponent(query)}${count ? `&count=${count}` : ""}`;
    return fetch(url)
        .then((res) => res.json())
        .then((result) => hoogleProcessResult(result as any[]));
}

function searchHoogle(query: string, options?: HoogleSearchOptions): Promise<HoogleEntry[]> {
    const useLocalInstance = vscode.workspace.getConfiguration("hoogle-search").get<boolean>("useLocalInstance");
    return useLocalInstance ? localHoogleSearch(query, options) : remoteHoogleSearch(query, options);
}

type ParentNode = DefaultTreeAdapterMap["parentNode"];
type ElementNode = DefaultTreeAdapterMap["element"];

function visitElements(node: ParentNode, callback: (node: ElementNode) => void) {
    if (defaultTreeAdapter.isElementNode(node)) {
        callback(node);
    }
    if (node.childNodes) {
        node.childNodes.forEach((child) => visitElements(child as ParentNode, callback));
    }
}

function findFirstElement(node: ParentNode, tagName: string): ElementNode | undefined {
    let found: ElementNode | undefined;
    visitElements(node, (element) => {
        if (!found && element.tagName === tagName) {
            found = element;
        }
    });
    return found;
}

function setAttribute(element: ElementNode, name: string, value: string) {
    const existing = element.attrs.find((attr) => attr.name === name);
    if (existing) {
        existing.value = value;
    } else {
        element.attrs.push({ name, value });
    }
}

function openUrl(uri: vscode.Uri, context: vscode.ExtensionContext) {
    const view = vscode.window.createWebviewPanel(
        "HaskellDocumentation",
        path.basename(uri.fsPath, path.extname(uri.fsPath)).replace(/-/g, "."),
        vscode.ViewColumn.Two,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        },
    );

    context.subscriptions.push(view);

    const mediaPath = vscode.Uri.joinPath(context.extensionUri, "media");

    const haddocksWebviewScriptUri = view.webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, "haddocks-webview.js"));

    const processUriContent = (uri: vscode.Uri) => {
        const htmlDir = path.dirname(uri.fsPath);
        const html = lstatSync(uri.fsPath).isDirectory()
            ? readFileSync(path.join(uri.fsPath, "index.html"), "utf-8")
            : readFileSync(uri.fsPath, "utf-8");
        const focusId = decodeURIComponent(uri.fragment);
        let document = parse(html);
        const htmlElement = findFirstElement(document, "html");
        const head = findFirstElement(document, "head");
        const body = findFirstElement(document, "body");
        if (body && focusId) {
            setAttribute(body, "data-focus-id", focusId);
        }

        if (!htmlElement || !head || !body) {
            throw new Error("Expected a complete HTML document with html, head, and body elements");
        }
        head.childNodes.unshift(
            {
                nodeName: "script",
                tagName: "script",
                attrs: [
                    {
                        name: "src",
                        value: haddocksWebviewScriptUri.toString(),
                    },
                ],
                namespaceURI: "http://www.w3.org/1999/xhtml",
                childNodes: [],
                parentNode: head,
            } as unknown as ElementNode,
            {
                nodeName: "base",
                tagName: "base",
                attrs: [
                    {
                        name: "href",
                        value: view.webview.asWebviewUri(uri).toString(),
                    },
                ],
                namespaceURI: "http://www.w3.org/1999/xhtml",
                childNodes: [],
                parentNode: head,
            } as unknown as ElementNode,
        );
        return {
            resourceRoot: vscode.Uri.file(htmlDir),
            document: serialize(document),
        };
    };

    if (uri.scheme === "http" || uri.scheme === "https") {
        view.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <body style="margin:0;padding:0;overflow:hidden;">
                <iframe id="browser" src="${uri.toString()}" style="width:100vw;height:100vh;border:none;"></iframe>
            </body>
            </html>
        `;
    } else if (uri.scheme === "file") {
        const history = [uri];
        const { resourceRoot, document } = processUriContent(uri);

        view.webview.options = {
            ...view.webview.options,
            localResourceRoots: [resourceRoot, mediaPath],
        };
        view.webview.html = document;

        view.webview.onDidReceiveMessage((message) => {
            switch (message.command) {
                case "navigate":
                    if (message.href.startsWith("https://file+.vscode-resource.vscode-cdn.net")) {
                        // open in place
                        const target = vscode.Uri.parse(
                            message.href.replace("https://file+.vscode-resource.vscode-cdn.net/", ""),
                        );
                        const { resourceRoot, document } = processUriContent(target);

                        history.push(target);
                        view.webview.options = {
                            ...view.webview.options,
                            localResourceRoots: [resourceRoot, mediaPath],
                        };
                        view.webview.html = document;
                        view.reveal();
                    } else {
                        openUrl(vscode.Uri.parse(message.href), context);
                    }
                    break;
                case "back":
                    if (history.length > 1) {
                        history.pop();
                        const previous = history[history.length - 1];
                        const { resourceRoot, document } = processUriContent(previous);

                        view.webview.options = {
                            ...view.webview.options,
                            localResourceRoots: [resourceRoot, mediaPath],
                        };
                        view.webview.html = document;
                    }
                    break;
                default:
                    throw new Error(`Unknown command from webview: ${message.command}`);
            }
        });
    }
}

function searchHoogleCommand(context: vscode.ExtensionContext) {
    const picker: vscode.QuickPick<vscode.QuickPickItem & { url: string }> = vscode.window.createQuickPick();
    let candidUpdateTimer: NodeJS.Timeout;

    const renderEntry = (
        userInput: string,
        { item, docs, module, package: _package, url }: HoogleEntry,
    ): vscode.QuickPickItem & {
        url: string;
        buttions?: (vscode.QuickInputButton & { url: string })[];
    } => {
        return {
            label: [...item].join("\u200b"),
            description: [_package?.name, module?.name].filter((v): v is string => !!v).join("\u00a0┃\u00a0"),
            detail: convert(docs, { wordwrap: false }),
            url,
            alwaysShow: true,
        };
    };

    picker.placeholder = "Search Hoogle";

    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const pos = editor.selection.active;
        const document = editor.document;
        const wordRange = document.getWordRangeAtPosition(pos);
        if (wordRange) {
            const word = document.getText(wordRange);
            picker.value = word;
        }
    }

    const cfg = vscode.workspace.getConfiguration("hoogle-search");

    picker.onDidChangeValue((_) => {
        candidUpdateTimer && clearTimeout(candidUpdateTimer);
        picker.busy = true;

        candidUpdateTimer = setTimeout(
            () => {
                const input = picker.value;
                searchHoogle(input, {
                    count: 100,
                })
                    .then((entries) => {
                        picker.items = entries.map((entry) => renderEntry(input, entry));
                    })
                    .catch((reason) => {
                        picker.items = [];
                        vscode.window.showErrorMessage(`Error searching Hoogle: ${reason}`);
                    })
                    .finally(() => {
                        picker.busy = false;
                    });
            },
            cfg.get<boolean>("useLocalInstance") ? 50 : 200,
        );
    });

    picker.onDidAccept(() => {
        const selection = picker.selectedItems[0];
        openUrl(vscode.Uri.parse(selection.url), context);
        picker.hide();
    });

    picker.show();
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("hoogle-search.searchHoogle", () => searchHoogleCommand(context)),
    );
}

// This method is called when your extension is deactivated
export function deactivate() {}
