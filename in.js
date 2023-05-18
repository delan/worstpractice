// import * as rtfToHTML from "@iarna/rtf-to-html";
const rtfToHTML = require("@iarna/rtf-to-html");
const ZIP = require("zip");

(async () => {
    const out = document.querySelector("#out");
    out.append(`fetching\n`);
    const response = await fetch(location.hash.slice(1));

    out.append(`streaming\n`);
    let raw = await response.blob();
    raw = await raw.arrayBuffer();
    raw = new DataView(raw);

    // assert ASCII only (easier than checking real <?xml?> encoding)
    out.append(`checking encoding\n`);
    if (false)
    for (let i = 0; i < raw.byteLength; i++)
        if (raw.getUint8(i) >= 0x80)
            throw new Error("assertion failed: file has non-ASCII bytes");

    out.append(`parsing xml\n`);
    // let text = await response.text();
    let text = new TextDecoder().decode(raw.buffer);
    let doc = new DOMParser().parseFromString(text, "text/xml");

    out.append(`searching for embedded files\n`);
    searchForRtfBlobs(doc.documentElement);

    out.append(`rendering xml tree\n`);
    const ul = document.createElement("ul");
    ul.className = "tree";
    out.append(ul);
    renderXmlTree(doc.documentElement, ul);

    out.append(`done!\n`);

    function searchForRtfBlobs(node) {
        if (node.nodeName == "#text") {
            if (/^[{]\\rtf/.test(node.nodeValue)) {
                out.append(`rtf `);
                addRtfDocument(getPath(node), node.nodeValue);
                node.nodeValue = "";
                return;
            }
            // note: Content with DocType is base64, CONTENT with DOCTYPE is not
            if (node.parentNode.nodeName == "DocType") {
                const content = node.parentNode.parentNode.querySelector("Content");
                const name = getPath(content);
                const data = atob(content.textContent);
                content.textContent = "";
                switch (node.nodeValue) {
                    case "RTF ":
                        out.append(`rtf.base64 `);
                        addRtfDocument(name, data);
                        break;
                    case "BMP ":
                        out.append(`bmp.zip.base64 `);
                        addImageDocument(name, data, "image/bmp", true);
                        break;
                    case "JPG ":
                        out.append(`jpg.zip.base64 `);
                        addImageDocument(name, data, "image/jpeg", true);
                        break;
                    case "PDF ":
                        out.append(`pdf.zip.base64 `);
                        addImageDocument(name, data, "application/pdf", true);
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
            searchForRtfBlobs(kid);
        }
    }

    function renderXmlTree(node, parent = out) {
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

    function addRtfDocument(name, data) {
        const iframe = document.querySelector("#viewer > iframe");
        console.log(iframe.src);
        const a = document.createElement("a");
        a.append(name);
        out.append(a, `\n`);
        a.href = "#";
        a.addEventListener("click", event => {
            event.preventDefault();
            try {
                rtfToHTML.fromString(data, (e, result) => {
                    if (e) throw e;

                    const load = () => {
                        console.log("load");
                        iframe.onload = null;
                        iframe.contentDocument.open();

                        // remove big margins for readability
                        iframe.contentDocument.write(`<style>body { margin: 0 !important; }</style>`);

                        iframe.contentDocument.write(result);
                        iframe.contentDocument.close();
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
            } catch (e) {
                console.log(data);
                throw e;
            }
        });
    }

    function addImageDocument(name, data, type, zipped) {
        const iframe = document.querySelector("#viewer > iframe");
        console.log(iframe.src);
        const a = document.createElement("a");
        a.append(name);
        out.append(a, `\n`);
        a.href = "#";
        a.addEventListener("click", event => {
            event.preventDefault();
            if (!zipped) {
                iframe.src = makeBlobUrl(Buffer.from(data, "latin1"), type);
                // URL.revokeObjectURL(iframe.src);
                return;
            }
            const buffer = Buffer.from(data, "latin1");
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
