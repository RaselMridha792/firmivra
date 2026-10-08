'use client';

import { Button, Input, Tabs } from '@firmivra/ui';
import { type PointerEvent, useEffect, useEffectEvent, useRef, useState } from 'react';

type Mode = 'type' | 'draw' | 'upload';

/** The drawing surface in CSS pixels; the PNG is drawn at twice this for sharp printing. */
const WIDTH = 600;
const HEIGHT = 200;
const RATIO = 2;
/** Uploaded images above this size are refused before they are read. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** A design token's value, for drawing on a canvas (which cannot use CSS classes). */
function token(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function blankCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * RATIO;
  canvas.height = HEIGHT * RATIO;
  const ctx = canvas.getContext('2d');
  ctx?.scale(RATIO, RATIO);
  return { canvas, ctx };
}

/** The name in the display font, as a PNG, or null for an empty name. */
export function typedSignature(name: string, initials: boolean): string | null {
  const text = name.trim();
  if (!text) return null;
  const { canvas, ctx } = blankCanvas();
  if (!ctx) return null;
  const family = token('--font-display') || 'serif';
  let size = initials ? 96 : 72;
  ctx.font = `italic ${size}px ${family}`;
  // Shrink long names until they fit the line.
  while (size > 24 && ctx.measureText(text).width > WIDTH - 40) {
    size -= 4;
    ctx.font = `italic ${size}px ${family}`;
  }
  ctx.fillStyle = token('--color-heading');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, WIDTH / 2, HEIGHT / 2);
  return canvas.toDataURL('image/png');
}

/** An uploaded image fitted into the signature box, as a PNG (never the original file). */
async function uploadedSignature(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const { canvas, ctx } = blankCanvas();
  if (!ctx) throw new Error('No canvas');
  const fit = Math.min(WIDTH / bitmap.width, HEIGHT / bitmap.height, 1);
  const w = bitmap.width * fit;
  const h = bitmap.height * fit;
  ctx.drawImage(bitmap, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
  bitmap.close();
  return canvas.toDataURL('image/png');
}

interface SignaturePadProps {
  /** Initials get a shorter default text and a larger typed font. */
  kind: 'signature' | 'initials';
  /** Pre-fills the Type tab: the signer's name or initials. */
  defaultText?: string;
  /** The adopted image as a PNG data URL, or null while there is nothing to adopt. */
  onChange: (png: string | null) => void;
}

/**
 * Adopt a signature or initials: type it, draw it (mouse, finger or pen) or upload a picture of
 * it. Every way ends as a PNG data URL. No extra package: a plain canvas.
 */
export function SignaturePad({ kind, defaultText = '', onChange }: SignaturePadProps) {
  const [mode, setMode] = useState<Mode>('type');
  const label = kind === 'initials' ? 'initials' : 'signature';
  return (
    <div data-testid={`signature-pad-${kind}`} className="flex flex-col gap-3">
      <Tabs
        label={`How to add your ${label}`}
        value={mode}
        onChange={(id) => {
          setMode(id as Mode);
          onChange(null);
        }}
        items={[
          {
            id: 'type',
            label: 'Type',
            content: <TypePanel kind={kind} defaultText={defaultText} onChange={onChange} />,
          },
          { id: 'draw', label: 'Draw', content: <DrawPanel label={label} onChange={onChange} /> },
          {
            id: 'upload',
            label: 'Upload',
            content: <UploadPanel label={label} onChange={onChange} />,
          },
        ]}
      />
    </div>
  );
}

function TypePanel({
  kind,
  defaultText,
  onChange,
}: Pick<SignaturePadProps, 'kind' | 'onChange'> & { defaultText: string }) {
  const [text, setText] = useState(defaultText);
  const initials = kind === 'initials';
  // The pre-filled name counts as typed: hand its PNG up once, after the first render.
  const adoptDefault = useEffectEvent(() => onChange(typedSignature(defaultText, initials)));
  useEffect(() => adoptDefault(), []);

  return (
    <div className="flex flex-col gap-3 pt-3">
      <Input
        label={initials ? 'Your initials' : 'Your full name'}
        value={text}
        maxLength={initials ? 6 : 80}
        onChange={(e) => {
          setText(e.target.value);
          onChange(typedSignature(e.target.value, initials));
        }}
        autoComplete={initials ? 'off' : 'name'}
      />
      <div className="flex aspect-3/1 w-full items-center justify-center overflow-hidden rounded-card border border-border bg-surface px-4">
        {text.trim() ? (
          <p
            data-testid="signature-preview"
            className="truncate font-display text-4xl text-heading italic"
          >
            {text}
          </p>
        ) : (
          <p className="text-sm text-muted">Type to see your {kind}.</p>
        )}
      </div>
    </div>
  );
}

function DrawPanel({ label, onChange }: { label: string; onChange: (png: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const el = canvasRef.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    el.width = WIDTH * RATIO;
    el.height = HEIGHT * RATIO;
    ctx.scale(RATIO, RATIO);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = token('--color-heading');
  }, []);

  /** The pointer's position in drawing units, whatever size the canvas is shown at. */
  function point(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function start(e: PointerEvent<HTMLCanvasElement>) {
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A tap leaves a dot.
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  }

  function move(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    setEmpty(false);
    onChange(e.currentTarget.toDataURL('image/png'));
  }

  function clear() {
    const el = canvasRef.current;
    el?.getContext('2d')?.clearRect(0, 0, WIDTH, HEIGHT);
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      <p className="text-sm text-muted">
        Draw your {label} in the box with your mouse, finger or pen.
      </p>
      <canvas
        ref={canvasRef}
        data-testid="signature-canvas"
        aria-label={`Draw your ${label} here`}
        role="img"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="aspect-3/1 w-full touch-none rounded-card border border-control-border bg-surface"
      />
      <div>
        <Button variant="secondary" onClick={clear} disabled={empty}>
          Clear
        </Button>
      </div>
    </div>
  );
}

function UploadPanel({
  label,
  onChange,
}: {
  label: string;
  onChange: (png: string | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    setError(null);
    setPreview(null);
    onChange(null);
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('Choose a PNG or JPEG image.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('Choose an image under 2 MB.');
      return;
    }
    try {
      const png = await uploadedSignature(file);
      setPreview(png);
      onChange(png);
    } catch {
      setError("We couldn't read that image. Try another one.");
    }
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      <label className="flex flex-col gap-1 text-sm font-medium text-text">
        Picture of your {label} (PNG or JPEG, up to 2 MB)
        <input
          type="file"
          accept="image/png,image/jpeg"
          data-testid="signature-upload"
          onChange={(e) => void pick(e.target.files?.[0])}
          className="text-sm text-muted"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {preview && (
        <div className="aspect-3/1 w-full rounded-card border border-border bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="h-full w-full object-contain" />
        </div>
      )}
    </div>
  );
}
