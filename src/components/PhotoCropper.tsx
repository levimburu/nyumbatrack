import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import Cropper, { type Area } from "react-easy-crop";
import { X } from "lucide-react";

/** Wide frame — matches the property card header and works for the dashboard banner. */
const ASPECT = 3 / 1;
const MAX_WIDTH = 1600;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that image"));
    img.src = src;
  });
}

async function cropToBlob(src: string, area: Area): Promise<Blob> {
  const img = await loadImage(src);
  const scale = Math.min(1, MAX_WIDTH / area.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(area.width * scale);
  canvas.height = Math.round(area.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process image");
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process image"))), "image/jpeg", 0.88),
  );
}

export function PhotoCropper({
  src, onCancel, onApply,
}: {
  src: string;
  onCancel: () => void;
  onApply: (blob: Blob) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onComplete = useCallback((_: Area, pixels: Area) => setArea(pixels), []);

  const apply = async () => {
    if (!area) return;
    setBusy(true);
    setError(null);
    try {
      onApply(await cropToBlob(src, area));
    } catch (e: any) {
      setError(e?.message ?? "Couldn't crop image");
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Crop photo</h2>
          <button type="button" onClick={onCancel} aria-label="Close"><X className="h-5 w-5 text-muted-foreground" /></button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">Drag to move the photo and use the slider to zoom. The framed area is what will show.</p>
        <div className="relative h-64 w-full overflow-hidden rounded-xl bg-black">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={ASPECT}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onComplete}
          />
        </div>
        <input
          type="range" min={1} max={4} step={0.01} value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="mt-4 w-full" aria-label="Zoom"
          style={{ accentColor: "#166534" }}
        />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium">Cancel</button>
          <button
            type="button" onClick={apply} disabled={busy || !area}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "#166534" }}
          >
            {busy ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
