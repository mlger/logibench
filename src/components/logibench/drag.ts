'use client';

import { useDnd, type DragInit } from '@/store/dnd';

/**
 * Shared pointer-based drag tracking used by both the palette (drag a part
 * onto the board) and placed parts on the canvas (drag to move).
 *
 * A drag only activates after the pointer moves past DRAG_THRESHOLD px, so a
 * plain click still flows through to the normal click handlers. Once active,
 * the very next `click` event is suppressed (capture-phase, once) so dropping
 * does not also select/place via the click path.
 */
const DRAG_THRESHOLD = 6;

function suppressClick(ev: MouseEvent) {
  ev.stopPropagation();
  ev.preventDefault();
}

export function beginDragTracking(payload: DragInit, e: { clientX: number; clientY: number }) {
  const sx = e.clientX;
  const sy = e.clientY;
  let active = false;

  const onMove = (ev: PointerEvent) => {
    if (!active) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > DRAG_THRESHOLD) {
        active = true;
        useDnd.getState().start(payload, ev.clientX, ev.clientY);
        window.addEventListener('click', suppressClick, { capture: true, once: true });
      }
    } else {
      useDnd.getState().moveTo(ev.clientX, ev.clientY);
    }
  };

  const onUp = () => {
    stop();
  };

  const onCancel = () => {
    if (active) useDnd.getState().cancel();
    stop();
  };

  function stop() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}
