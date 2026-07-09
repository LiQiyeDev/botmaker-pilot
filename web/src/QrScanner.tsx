import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

interface Props {
  onResult: (text: string) => void;
  onCancel: () => void;
}

// Native BarcodeDetector where the WebView/browser has it (fast, hardware-backed); jsQR is the fallback.
type NativeDetector = { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
function makeNativeDetector(): NativeDetector | null {
  const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => NativeDetector })
    .BarcodeDetector;
  try {
    return BD ? new BD({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

/**
 * Fullscreen camera QR scanner. Opens the rear camera, decodes each frame (native BarcodeDetector when
 * available, else jsQR), and fires {@code onResult} with the first decoded string. Always stops the camera
 * tracks on unmount / cancel.
 */
export function QrScanner({ onResult, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let done = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const native = makeNativeDetector();

    const finish = (text: string) => {
      if (done) return;
      done = true;
      onResult(text);
    };

    const scan = async () => {
      const video = videoRef.current;
      if (done || !video || video.readyState < 2 || !ctx) {
        raf = requestAnimationFrame(scan);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        if (native) {
          const codes = await native.detect(canvas);
          if (codes[0]?.rawValue) return finish(codes[0].rawValue);
        } else {
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (code?.data) return finish(code.data);
        }
      } catch {
        /* transient decode error — keep scanning */
      }
      raf = requestAnimationFrame(scan);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        raf = requestAnimationFrame(scan);
      } catch (e) {
        const name = (e as { name?: string }).name;
        setError(
          name === "NotAllowedError"
            ? "Camera permission denied. Enable it in Settings, or paste the URL instead."
            : "No camera available. Paste the URL instead."
        );
      }
    })();

    return () => {
      done = true;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div className="scanner">
      <video ref={videoRef} className="scanner-video" playsInline muted />
      <div className="scanner-frame" />
      <p className="scanner-hint">
        {error ?? "Point the camera at the LEFT QR in Studio’s Remote Pilot dialog."}
      </p>
      <button className="scanner-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
