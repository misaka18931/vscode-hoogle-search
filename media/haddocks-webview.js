(() => {
    const vscode = acquireVsCodeApi();

    const focusElement = (id) => {
        if (!id) {
            return;
        }

        const element = document.getElementById(id);
        if (element) {
            element.scrollIntoView();
        }
    };

    const focusFromDocumentBody = () => {
        const id = document.body?.dataset.focusId;
        if (id) {
            focusElement(id);
        }
    };

    window.foo = focusElement;

    window.addEventListener("DOMContentLoaded", focusFromDocumentBody);
    if (document.readyState !== "loading") {
        focusFromDocumentBody();
    }

    document.addEventListener("click", (event) => {
        const link = event.target.closest("a");

        if (link && link.href) {
            event.preventDefault();
            event.stopPropagation();

            vscode.postMessage({
                command: "navigate",
                href: link.href,
            });
        }
    });

    document.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "b") {
                vscode.postMessage({
                    command: "back",
                });
            }
            if (event.key === "Enter") {
                const elm = document.querySelector(".active-link");
                if (elm) {
                    event.preventDefault();
                    event.stopPropagation();

                    vscode.postMessage({
                        command: "navigate",
                        href: elm.href,
                    });
                }
            }
        },
        true,
    );
})();
