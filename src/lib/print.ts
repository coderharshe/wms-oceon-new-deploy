"use client";

/**
 * Silently prints a same-origin URL without a popup (avoids popup-blocker
 * issues entirely, unlike window.open + print): loads it into a hidden
 * iframe and calls print() once it's loaded.
 */
export function printUrl(url: string) {
  void printInFrame((iframe) => (iframe.src = url));
}

/**
 * Same, for a document built on this PC (the provisional slip, see
 * offline-bills.ts) — srcdoc, so printing it never touches the network.
 * Resolves once print() has been called: a caller that clears the screen
 * straight after must not take the slip down with it.
 */
export function printHtml(html: string): Promise<void> {
  return printInFrame((iframe) => (iframe.srcdoc = html));
}

function printInFrame(load: (iframe: HTMLIFrameElement) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    // A frame that never loads must not hang the caller (and the till) forever.
    const timer = setTimeout(() => reject(new Error("the print frame did not load")), 10_000);
    iframe.onload = () => {
      clearTimeout(timer);
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        // Hand focus back to the page. The frame stays in the DOM for a minute
        // (below), and while it holds focus every keystroke goes to it — F2 and
        // the rest of the counter's keys stopped working after every print.
        iframe.blur();
        window.focus();
      }
      // ponytail: fixed delay instead of listening for print-dialog close
      // (no reliable cross-browser event for that) — long enough for the
      // print dialog to have been dismissed either way.
      setTimeout(() => iframe.remove(), 60_000);
    };
    load(iframe);
    document.body.appendChild(iframe);
  });
}
