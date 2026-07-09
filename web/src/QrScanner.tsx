import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";

interface Props {
  onResult: (text: string) => void;
  onCancel: () => void;
}

/**
 * Fullscreen camera QR scanner backed by ZXing (@zxing/browser). ZXing owns a robust continuous-decode loop
 * (far more tolerant of angle/lighting/motion than the old hand-rolled jsQR pass), driving our own <video>
 * element so we keep the overlay UI. We ask for the rear camera with continuous autofocus so moving the phone
 * toward the code doesn't stall on a focus hunt. Camera tracks + the decode loop are always torn down on
 * unmount / cancel via the returned scanner controls.
 */
export function QrScanner({ onResult, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let controls: IScannerControls | null = null;
    let done = false;

    const finish = (text: string) => {
      if (done) return;
      done = true;
      onResult(text);
    };

    (async () => {
      try {
        const video = videoRef.current;
        if (!video) return;
        const reader = new BrowserQRCodeReader();
        controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
              // @ts-expect-error focusMode is a valid MediaTrackConstraint on mobile, not yet in the TS lib DOM types
              focusMode: "continuous",
            },
            audio: false,
          },
          video,
          (result) => {
            if (result) finish(result.getText());
          }
        );
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
      controls?.stop();
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
