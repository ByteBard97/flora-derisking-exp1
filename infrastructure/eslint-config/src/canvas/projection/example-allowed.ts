// This file is in the allowlisted projection directory.
// Importing konva here must NOT trigger the boundary rule.
// Used by CI to verify the allowlist works correctly.

import Konva from 'konva';

export function createStage(container: HTMLDivElement): Konva.Stage {
  return new Konva.Stage({ container, width: 800, height: 600 });
}
