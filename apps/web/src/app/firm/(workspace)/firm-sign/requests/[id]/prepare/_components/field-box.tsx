'use client';

import { useEffect, useRef } from 'react';
import { FIELD_TYPE_LABELS } from '../../../../../../../../components/esign/field-labels';
import { washOf } from '../../../../../../../../components/esign/recipient-colors';
import { clamp01, type FieldDraft, MIN_SIZE } from './field-draft';

/** Read by screen readers on every field: how to move and resize it from the keyboard. */
export const FIELD_KEYS_ID = 'esign-field-keys';

type Patch = Partial<Pick<FieldDraft, 'x' | 'y' | 'w' | 'h'>>;

/**
 * One field on the page: drag it to move it, drag its corner to resize it, or use the keyboard
 * (arrows move, Shift for bigger steps, Alt and the arrows resize, Delete removes, D duplicates).
 */
export function FieldBox({
  f,
  colour,
  owner,
  text,
  active,
  focus,
  frame,
  onSelect,
  onChange,
  onRemove,
  onDuplicate,
}: {
  f: FieldDraft;
  colour: string;
  /** Whose field it is, for its label. */
  owner: string;
  /** What a sender field shows instead of its name: its value or merge field. */
  text?: string;
  active: boolean;
  /** Take the keyboard focus (a copy just made). */
  focus: boolean;
  /** The page's box on screen, to turn pixels into fractions of the page. */
  frame: () => DOMRect | undefined;
  onSelect: () => void;
  onChange: (patch: Patch) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const dragRef = useRef<{ mode: 'move' | 'resize'; px: number; py: number; f: FieldDraft } | null>(
    null,
  );
  const boxRef = useRef<HTMLDivElement>(null);
  const title = text ?? (f.label || FIELD_TYPE_LABELS[f.type]);
  useEffect(() => {
    if (focus) boxRef.current?.focus();
  }, [focus]);

  function start(mode: 'move' | 'resize', e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { mode, px: e.clientX, py: e.clientY, f };
    onSelect();
  }
  function move(e: React.PointerEvent<HTMLElement>) {
    const d = dragRef.current;
    const box = frame();
    if (!d || !box) return;
    const dx = (e.clientX - d.px) / box.width;
    const dy = (e.clientY - d.py) / box.height;
    onChange(
      d.mode === 'move'
        ? { x: clamp01(d.f.x + dx, d.f.w), y: clamp01(d.f.y + dy, d.f.h) }
        : {
            w: Math.min(Math.max(d.f.w + dx, MIN_SIZE), 1 - d.f.x),
            h: Math.min(Math.max(d.f.h + dy, MIN_SIZE), 1 - d.f.y),
          },
    );
  }
  const end = () => {
    dragRef.current = null;
  };

  function key(e: React.KeyboardEvent<HTMLElement>) {
    // Browser shortcuts (Ctrl or Cmd with a key) stay the browser's.
    if (e.ctrlKey || e.metaKey) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const by = arrows[e.key];
    if (by) {
      e.preventDefault();
      const [dx, dy] = by;
      onChange(
        e.altKey
          ? {
              w: Math.min(Math.max(f.w + dx, MIN_SIZE), 1 - f.x),
              h: Math.min(Math.max(f.h + dy, MIN_SIZE), 1 - f.y),
            }
          : { x: clamp01(f.x + dx, f.w), y: clamp01(f.y + dy, f.h) },
      );
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onRemove();
    } else if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      onDuplicate();
    }
  }

  return (
    <div
      ref={boxRef}
      role="button"
      tabIndex={0}
      data-testid="field-box"
      data-active={active || undefined}
      aria-pressed={active}
      aria-label={`${title}${f.required ? ' (required)' : ''}, ${owner}`}
      aria-describedby={FIELD_KEYS_ID}
      onFocus={onSelect}
      onKeyDown={key}
      onPointerDown={(e) => start('move', e)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      className={`absolute flex cursor-move touch-none items-start overflow-hidden rounded-control border-2 border-dashed text-xs leading-tight select-none ${
        active ? 'outline-2 outline-offset-2 outline-focus' : ''
      }`}
      // Where the field sits and whose it is: data from the request, not design values.
      style={{
        left: `${f.x * 100}%`,
        top: `${f.y * 100}%`,
        width: `${f.w * 100}%`,
        height: `${f.h * 100}%`,
        borderColor: colour,
        backgroundColor: washOf(colour),
        color: colour,
      }}
    >
      <span className="truncate px-1 font-medium">
        {title}
        {f.required && <span aria-hidden="true"> *</span>}
      </span>
      {active && (
        <span
          aria-hidden="true"
          data-testid="field-resize"
          // Its moves and release reach the field's own handlers.
          onPointerDown={(e) => start('resize', e)}
          className="absolute right-0 bottom-0 size-3 cursor-nwse-resize rounded-tl-control"
          style={{ backgroundColor: colour }}
        />
      )}
    </div>
  );
}
