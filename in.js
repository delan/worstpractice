import {EMFJS, WMFJS, RTFJS} from "rtf.js";
const ZIP = require("zip");

(async () => {
    // in case firefox tries to restore selected tab
    document.querySelector("#importTab").click();

    const status = document.querySelector("#status");

    // status.textContent = "fetching...";
    // const response = await fetch(location.hash.slice(1));

    // status.textContent = "blobbing...";
    // const blob = await response.blob();
    // run(blob);

    const file = document.querySelector("#file");
    file.addEventListener("change", change);
    change();

    function change() {
        if (file.files.length > 0)
            run(file.files[0]);
    }

    async function run(blob) {
        status.textContent = "loading...";
        let raw = await blob.arrayBuffer();
        raw = new DataView(raw);

        // assert ASCII only (easier than checking real <?xml?> encoding)
        status.textContent = "checking encoding...";
        for (let i = 0; i < raw.byteLength; i++)
            if (raw.getUint8(i) >= 0x80)
                throw new Error("assertion failed: file has non-ASCII bytes");

        status.textContent = "parsing xml...";
        // let text = await response.text();
        let text = new TextDecoder().decode(raw.buffer);
        let doc = new DOMParser().parseFromString(text, "text/xml");

        status.textContent = "searching for embedded files...";
        searchForEmbeddedFiles(doc.documentElement, document.querySelector("#files"));

        status.textContent = "rendering xml tree...";
        const ul = document.createElement("ul");
        ul.className = "tree";
        document.querySelector("#tree").append(ul);
        renderXmlTree(doc.documentElement, ul);

        status.textContent = "done!";
    }

    function searchForEmbeddedFiles(node, parent) {
        if (node.nodeName == "#text") {
            if (/^[{]\\rtf/.test(node.nodeValue)) {
                parent.append(`rtf `);
                const buffer = Buffer.from(node.nodeValue, "utf8");
                node.nodeValue = "";
                addRtfDocument(parent, getPath(node), buffer);
                return;
            }
            // note: Content with DocType is base64, CONTENT with DOCTYPE is not
            if (node.parentNode.nodeName == "DocType") {
                const content = node.parentNode.parentNode.querySelector("Content");
                const name = getPath(content);
                const buffer = Buffer.from(content.textContent, "base64");
                content.textContent = "";
                switch (node.nodeValue) {
                    case "RTF ":
                        parent.append(`rtf.base64 `);
                        addRtfDocument(parent, name, buffer);
                        break;
                    case "BMP ":
                        parent.append(`bmp.zip.base64 `);
                        addImageDocument(parent, name, buffer, "image/bmp", true);
                        break;
                    case "JPG ":
                        parent.append(`jpg.zip.base64 `);
                        addImageDocument(parent, name, buffer, "image/jpeg", true);
                        break;
                    case "PDF ":
                        parent.append(`pdf.zip.base64 `);
                        addImageDocument(parent, name, buffer, "application/pdf", true);
                        break;
                    default:
                        console.log(node.nodeValue);
                        break;
                }
                return;
            }
            return;
        }
        for (const kid of node.childNodes) {
            searchForEmbeddedFiles(kid, parent);
        }
    }

    function renderXmlTree(node, parent) {
        if (node.nodeType != Node.ELEMENT_NODE) {
            return;
        }

        const li = document.createElement("li");
        li.append(node.nodeName);
        parent.append(li);

        if (isVoid(node)) {
            // mark as verbose
            li.className = "verbose";
        } else if (isAtom(node)) {
            // mark as verbose if “NIL” or effectively empty
            if (["NIL", ""].includes(node.textContent.trim()))
                li.className = "verbose";

            // render as atom, for example, BPSVersion(1.12.0.998)
            const value = document.createElement("span");
            value.className = "value";
            value.append(node.textContent.trim());
            li.append(`(`, value, `)`);
        } else {
            const smallList = document.createElement("ul");
            smallList.className = "small";
            li.append(smallList);
            let needsBigList = false;
            for (const kid of node.childNodes) {
                if (isVoid(kid) || isAtom(kid)) {
                    renderXmlTree(kid, smallList);
                } else {
                    needsBigList = true;
                }
            }
            if (needsBigList) {
                const bigList = document.createElement("ul");
                li.append(bigList);
                for (const kid of node.childNodes) {
                    if (!isVoid(kid) && !isAtom(kid)) {
                        renderXmlTree(kid, bigList);
                    }
                }
            }
        }

        function isVoid(node) {
            return node.childNodes.length == 0;
        }
        function isAtom(node) {
            return node.childNodes.length == 1 && node.childNodes[0].nodeName == "#text";
        }
    }

    function addRtfDocument(parent, name, buffer) {
        const iframe = document.querySelector("#viewer > iframe");
        const a = document.createElement("a");
        a.append(name);
        parent.append(a, `\n`);
        a.href = "#";
        a.addEventListener("click", async event => {
            event.preventDefault();
            console.log(buffer, buffer.buffer);
            const rtf = new RTFJS.Document(buffer.buffer);
            console.log(rtf.metadata());
            const elements = await rtf.render();

            const load = () => {
                console.log("load");
                iframe.onload = null;
                iframe.contentDocument.open();

                // remove big margins for readability
                iframe.contentDocument.write(`<style>body { margin: 0 !important; }</style>`);

                iframe.contentDocument.close();

                for (const element of elements)
                    iframe.contentDocument.body.append(element);
            };

            if (iframe.contentDocument) {
                // already about:blank, so no load event
                load();
            } else {
                // not about:blank yet, so wait for load event
                iframe.onload = load;
                iframe.src = "about:blank";
            }
        });
    }

    function addImageDocument(parent, name, buffer, type, zipped) {
        const iframe = document.querySelector("#viewer > iframe");
        const a = document.createElement("a");
        a.append(name);
        parent.append(a, `\n`);
        a.href = "#";
        a.addEventListener("click", event => {
            event.preventDefault();
            if (!zipped) {
                iframe.src = makeBlobUrl(buffer, type);
                // URL.revokeObjectURL(iframe.src);
                return;
            }
            const reader = ZIP.Reader(buffer);
            reader.toObject("latin1");
            reader.forEach(entry => {
                iframe.src = makeBlobUrl(Buffer.from(entry.getData()), type);
                URL.revokeObjectURL(iframe.src);
            });
        });
    }

    function makeBlobUrl(buffer, type) {
        // use blob url, in case data url would be too long
        const blob = new Blob([buffer], {type});
        const result = URL.createObjectURL(blob);
        console.log(result);
        return result;
    }

    function getPath(node) {
        let result = ``;

        // omit text node for brevity
        if (node.nodeName == "#text")
            node = node.parentNode;

        while (node.nodeName != "#document") {
            // omit root element for brevity
            if (node.parentNode.nodeName == "#document")
                break;

            const name = node.nodeName;
            let nthOfType = 1;
            let succCount = 0;
            let pred = node.previousElementSibling;
            let succ = node.nextElementSibling;
            while (pred) {
                if (pred.nodeName == name)
                    nthOfType++;
                pred = pred.previousElementSibling;
            }
            while (succ) {
                if (succ.nodeName == name)
                    succCount++;
                succ = succ.nextElementSibling;
            }
            if (nthOfType == 1 && succCount == 0) {
                result = `/${name}` + result;
            } else {
                result = `/${name}[${nthOfType}]` + result;
            }
            node = node.parentNode;
        }
        return result;
    }
})();
