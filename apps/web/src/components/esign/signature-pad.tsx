'use client';

import { ESIGN_SIGNATURE_PNG_MAX_BYTES } from '@firmivra/types';
import { Button, Input, Tabs } from '@firmivra/ui';
import {
  type PointerEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';

type Mode = 'type' | 'draw' | 'upload';

/** The drawing surface in CSS pixels; the PNG is drawn at twice this for sharp printing. */
const WIDTH = 600;
const HEIGHT = 200;
const RATIO = 2;
/** Uploaded images above this size are refused before they are read. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/**
 * The longest adopted image as a data URL. The contract allows a 200 KB PNG
 * (ESIGN_SIGNATURE_PNG_MAX_BYTES), but one adopt carries the signature and the initials and the
 * API's JSON body limit is still 100 KB: keep both well inside it. An ink-only photo or a drawing
 * is a few KB.
 */
export const MAX_SIGNATURE_CHARS = Math.min(
  45_000,
  'data:image/png;base64,'.length + Math.floor(ESIGN_SIGNATURE_PNG_MAX_BYTES / 3) * 4,
);
/** In an uploaded picture, pixels lighter than this are paper; darker ones are ink. */
const PAPER = 0.75;
/** Pixels between this and PAPER fade from ink to paper, so the strokes keep smooth edges. */
const INK = 0.55;

/**
 * A design token's value as `from` sees it (the portal theme overrides some), for drawing on a
 * canvas, which cannot use CSS classes.
 */
function token(name: string, from: Element) {
  return getComputedStyle(from).getPropertyValue(name).trim();
}

function blankCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * RATIO;
  canvas.height = HEIGHT * RATIO;
  const ctx = canvas.getContext('2d');
  ctx?.scale(RATIO, RATIO);
  return { canvas, ctx };
}

/**
 * An uploaded picture fitted into the signature box as a PNG (never the original file): the paper
 * becomes transparent and the strokes take the ink colour `from` sees, which keeps a photo of a
 * signature small and lets it sit on the document like the typed and drawn ones.
 */
async function uploadedSignature(file: File, from: Element): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const { canvas, ctx } = blankCanvas();
  if (!ctx) throw new Error('No canvas');
  const fit = Math.min(WIDTH / bitmap.width, HEIGHT / bitmap.height, 1);
  const w = bitmap.width * fit;
  const h = bitmap.height * fit;
  ctx.drawImage(bitmap, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
  bitmap.close();
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const light = (0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!) / 255;
    const ink = Math.min(1, Math.max(0, (PAPER - light) / (PAPER - INK)));
    px[i + 3] = Math.round(ink * px[i + 3]!);
  }
  ctx.putImageData(image, 0, 0);
  // Keep each pixel's coverage, paint it in the ink colour.
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = token('--color-heading', from);
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return canvas.toDataURL('image/png');
}

/**
 * What the signer adopts: typed text (the API sets it in the signature font, and a typed
 * signature must match the printed name), or a drawn or uploaded PNG data URL.
 */
export type AdoptedMark =
  { method: 'TYPED'; text: string } | { method: 'DRAWN' | 'UPLOADED'; png: string };

interface SignaturePadProps {
  /** Initials get a shorter default text and a larger typed font. */
  kind: 'signature' | 'initials';
  /** Pre-fills the Type tab: the signer's name or initials. */
  defaultText?: string;
  /** What the open tab holds, or null while there is nothing to adopt. */
  onChange: (mark: AdoptedMark | null) => void;
}

/**
 * Adopt a signature or initials: type it, draw it (mouse, finger or pen) or upload a picture of
 * it. Drawn and uploaded ones end as a PNG data URL. No extra package: a plain canvas.
 */
export function SignaturePad({ kind, defaultText = '', onChange }: SignaturePadProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('type');
  // Read when a panel reports, which can be after a tab change the panel's render did not see.
  const modeRef = useRef<Mode>('type');
  // Each tab keeps what it holds; the adopted image is always the open tab's.
  const [values, setValues] = useState<Record<Mode, AdoptedMark | null>>({
    type: null,
    draw: null,
    upload: null,
  });
  const label = kind === 'initials' ? 'initials' : 'signature';
  const report = (from: Mode) => (mark: AdoptedMark | null) => {
    setValues((v) => ({ ...v, [from]: mark }));
    if (from === modeRef.current) onChange(mark);
  };
  const image = (from: 'draw' | 'upload') => (png: string | null) =>
    report(from)(png ? { method: from === 'draw' ? 'DRAWN' : 'UPLOADED', png } : null);
  return (
    <div ref={rootRef} data-testid={`signature-pad-${kind}`} className="flex flex-col gap-3">
      <Tabs
        label={`How to add your ${label}`}
        value={mode}
        onChange={(id) => {
          const next = id as Mode;
          modeRef.current = next;
          setMode(next);
          onChange(values[next]);
        }}
        items={[
          {
            id: 'type',
            label: 'Type',
            content: <TypePanel kind={kind} defaultText={defaultText} onChange={report('type')} />,
          },
          {
            id: 'draw',
            label: 'Draw',
            content: <DrawPanel label={label} inkFrom={rootRef} onChange={image('draw')} />,
          },
          {
            id: 'upload',
            label: 'Upload',
            content: <UploadPanel label={label} inkFrom={rootRef} onChange={image('upload')} />,
          },
        ]}
      />
    </div>
  );
}

/** The element whose theme sets the ink colour (the pad itself, inside the portal theme). */
type InkFrom = RefObject<HTMLElement | null>;

function TypePanel({
  kind,
  defaultText,
  onChange,
}: Pick<SignaturePadProps, 'kind' | 'onChange'> & { defaultText: string }) {
  const [text, setText] = useState(defaultText);
  const initials = kind === 'initials';
  const mark = (value: string): AdoptedMark | null =>
    value.trim() ? { method: 'TYPED', text: value.trim() } : null;
  // The pre-filled name counts as typed: hand it up once, after the first render.
  const adoptDefault = useEffectEvent(() => onChange(mark(defaultText)));
  useEffect(() => adoptDefault(), []);

  return (
    <div className="flex flex-col gap-3 pt-3">
      <Input
        label={initials ? 'Your initials' : 'Your full name'}
        value={text}
        maxLength={initials ? 10 : 200}
        onChange={(e) => {
          setText(e.target.value);
          onChange(mark(e.target.value));
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

function DrawPanel({
  label,
  inkFrom,
  onChange,
}: {
  label: string;
  inkFrom: InkFrom;
  onChange: (png: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [empty, setEmpty] = useState(true);
  const [tooBig, setTooBig] = useState(false);

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
    ctx.strokeStyle = token('--color-heading', inkFrom.current ?? el);
  }, [inkFrom]);

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
    const png = e.currentTarget.toDataURL('image/png');
    // Scribbling over the whole box can outgrow what the API takes.
    const tooBig = png.length > MAX_SIGNATURE_CHARS;
    setTooBig(tooBig);
    onChange(tooBig ? null : png);
  }

  function clear() {
    const el = canvasRef.current;
    el?.getContext('2d')?.clearRect(0, 0, WIDTH, HEIGHT);
    setEmpty(true);
    setTooBig(false);
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
      {tooBig && (
        <p role="alert" className="text-xs text-danger">
          This drawing is too detailed. Clear it and sign more simply.
        </p>
      )}
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
  inkFrom,
  onChange,
}: {
  label: string;
  inkFrom: InkFrom;
  onChange: (png: string | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  // Only the latest pick may land: an earlier, slower image read is dropped.
  const pickRef = useRef(0);

  async function pick(file: File | undefined) {
    const id = ++pickRef.current;
    setError(undefined);
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
      const el = inkFrom.current;
      if (!el) return;
      const png = await uploadedSignature(file, el);
      if (id !== pickRef.current) return;
      if (png.length > MAX_SIGNATURE_CHARS) {
        setError('This picture is too detailed. Try a closer photo on plain white paper.');
        return;
      }
      setPreview(png);
      onChange(png);
    } catch {
      if (id === pickRef.current) setError("We couldn't read that image. Try another one.");
    }
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      <Input
        type="file"
        label={`Picture of your ${label} (PNG or JPEG, up to 2 MB)`}
        accept="image/png,image/jpeg"
        data-testid="signature-upload"
        error={error}
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          // Picking the same file again after an error or a clear still counts as a pick.
          e.target.value = '';
        }}
      />
      {preview && (
        <div className="aspect-3/1 w-full rounded-card border border-border bg-surface">
          {/* A data URL drawn in the browser: next/image adds nothing here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="h-full w-full object-contain" />
        </div>
      )}
    </div>
  );
}
