"use client";

import { useEffect, useRef, useState } from "react";

// Formats worth scanning in an Indian general store: EAN-13/EAN-8 and UPC on
// branded retail goods, CODE128 for the codes this app generates itself.
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"];

type BarcodeDetectorLike = {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
};
type BarcodeDetectorCtor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

/**
 * The platform's own BarcodeDetector where it exists, otherwise a ZXing/wasm
 * ponyfill with the same shape.
 *
 * Chrome only ships Shape Detection on Android, ChromeOS and macOS — on
 * *Windows* `window.BarcodeDetector` is undefined, which is where the warehouse
 * tills run. The ponyfill is dynamically imported so its ~800KB of wasm is
 * fetched the first time somebody actually presses Scan, not on page load.
 */
async function loadDetectorCtor(): Promise<BarcodeDetectorCtor> {
  if (typeof window !== "undefined") {
    const native = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (native) return native;
  }
  const { BarcodeDetector, setZXingModuleOverrides } = await import("barcode-detector/ponyfill");
  // By default the library fetches its wasm from fastly.jsdelivr.net. That
  // would put a third-party CDN in the path of a warehouse tool and break
  // scanning entirely when the shop's internet is down — which is exactly
  // when the offline PWA is supposed to keep working. public/zxing_reader.wasm
  // is the same file, copied from the package at install time, served from
  // our own origin and cached by the service worker like any other asset.
  setZXingModuleOverrides({ locateFile: (path: string) => (path.endsWith(".wasm") ? "/zxing_reader.wasm" : path) });
  return BarcodeDetector as unknown as BarcodeDetectorCtor;
}

/**
 * Camera-based barcode capture, using the browser's built-in BarcodeDetector.
 *
 * Renders nothing at all where that API is missing (Safari, Firefox, and any
 * non-HTTPS origin — it's a secure-context-only API). That's deliberate rather
 * than a gap: every place this button appears sits next to a plain text input,
 * and a handheld USB/Bluetooth barcode gun just types into that input, so the
 * scan path still works on those browsers without shipping a second decoder
 * library to emulate what the platform already does elsewhere.
 */
export function BarcodeScanButton({ onDetected, label = "Scan" }: { onDetected: (code: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)} title="Scan with camera">
        📷 {label}
      </button>
      {open && (
        <ScannerModal
          onClose={() => setOpen(false)}
          onDetected={(code) => {
            setOpen(false);
            onDetected(code);
          }}
        />
      )}
    </>
  );
}

function ScannerModal({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // The parent passes a fresh arrow every render; depending on it restarted
  // the camera each time anything above re-rendered. Ref keeps the effect
  // mount-only so the stream is acquired once and released once.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    let fired = false;

    async function start() {
      try {
        const Ctor = await loadDetectorCtor();
        if (stopped) return; // closed while the wasm was still downloading
        // `environment` = rear camera on a phone/tablet; desktops ignore it
        // and hand back whatever webcam they have.
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) return; // unmounted while the permission prompt was open
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const detector = new Ctor({ formats: FORMATS });
        timer = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const hits = await detector.detect(videoRef.current);
            const code = hits[0]?.rawValue?.trim();
            if (code && !fired) {
              fired = true; // one scan = one result, even if a frame lands before unmount
              if (timer) clearInterval(timer);
              stream?.getTracks().forEach((t) => t.stop()); // camera off the instant we have the code
              onDetectedRef.current(code);
            }
          } catch {
            // A failed frame is normal (blur, no barcode in view) — keep polling.
          }
        }, 300);
      } catch (err) {
        setError(
          err instanceof Error && err.name === "NotAllowedError"
            ? "Camera permission denied — allow camera access, or type/scan the code into the box instead."
            : "Could not open the camera — type or scan the code into the box instead."
        );
      }
    }
    start();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop()); // release the camera light
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">Scan barcode</h2>
        {error ? (
          <p className="text-sm text-bad">{error}</p>
        ) : (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} className="w-full rounded bg-black" playsInline muted />
            <p className="text-xs text-muted">Hold the barcode steady in front of the camera.</p>
          </>
        )}
        <div className="flex justify-end">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
