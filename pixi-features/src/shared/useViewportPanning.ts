import { Viewport } from 'pixi-viewport';

export function enableControlScrollPanning(viewport: Viewport, canvas: HTMLCanvasElement) {
  let controlHeld = false;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey) {
      console.log('[Panning] Control key DOWN');
      controlHeld = true;
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (!e.ctrlKey) {
      console.log('[Panning] Control key UP');
      controlHeld = false;
    }
  };

  const handleWheel = (e: WheelEvent) => {
    console.log('[Panning] wheel event:', { deltaX: e.deltaX, deltaY: e.deltaY, controlHeld });
    if (controlHeld) {
      console.log('[Panning] Control held — panning canvas');
      e.preventDefault();
      viewport.moveCenter(viewport.center.x - e.deltaX * 0.5, viewport.center.y - e.deltaY * 0.5);
    } else {
      console.log('[Panning] Control not held — normal zoom behavior');
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  canvas.addEventListener('wheel', handleWheel, { passive: false });

  // Cleanup function
  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    canvas.removeEventListener('wheel', handleWheel);
  };
}
