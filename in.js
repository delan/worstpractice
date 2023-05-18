// import * as rtfToHTML from "@iarna/rtf-to-html";
const rtfToHTML = require("@iarna/rtf-to-html");

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

    out.append(`<${doc.documentElement.nodeName}>\n\t`);
    for (const kid of doc.documentElement.children)
        out.append(`${kid.nodeName} `);
    out.append(`\n`);

    out.append(`searching for rtf blobs\n`);
    searchForRtfBlobs(doc.documentElement);

    function searchForRtfBlobs(node) {
        if (node.nodeName == "#text") {
            if (!/^[{]\\rtf/.test(node.nodeValue)) return;
            const expand = document.createElement("div");
            const details = document.createElement("details");
            const summary = document.createElement("summary");
            expand.className = "expand";
            summary.append(getPath(node));
            details.append(summary);
            expand.append(details);
            out.append(expand);

            // lazy load iframes to avoid perf problems
            details.addEventListener("toggle", event => {
                const details = event.target;
                const expand = details.parentNode;
                if (!details.open) {
                    expand.classList.remove("open");
                    const div = expand.querySelector("div");
                    if (div) div.remove();
                    return;
                }

                expand.classList.add("open");

                // scroll into view
                expand.scrollIntoView({ behavior: "instant" });

                const div = document.createElement("div");
                const iframe = document.createElement("iframe");
                div.append(iframe);
                expand.append(div);

                try {
                    rtfToHTML.fromString(node.nodeValue, (e, result) => {
                        if (e) throw e;

                        iframe.contentDocument.open();

                        // remove big margins for readability
                        iframe.contentDocument.write(`<style>body { margin: 0 !important; }</style>`);

                        iframe.contentDocument.write(result);
                        iframe.contentDocument.close();
                    });
                } catch (e) {
                    console.log(node.nodeValue);
                    throw e;
                }
            });
            return;
        }
        for (const kid of node.childNodes) {
            searchForRtfBlobs(kid);
        }
    }

    function getPath(node) {
        let result = ``;
        while (node.nodeName != "#document") {
            const name = node.nodeName;
            let nthOfType = 1;
            let sibling = node.previousElementSibling;
            while (sibling) {
                if (sibling.nodeName == name)
                    nthOfType++;
                sibling = sibling.previousElementSibling;
            }
            result = `/${name}[${nthOfType}]` + result;
            node = node.parentNode;
        }
        return result;
    }
})();
