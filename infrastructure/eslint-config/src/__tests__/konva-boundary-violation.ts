// This file exists to verify the ESLint Konva boundary rule fires.
// It intentionally imports konva from a non-allowlisted directory.
// `eslint src/__tests__/konva-boundary-violation.ts` MUST exit non-zero.
// If the CI job passes after running this file, the rule is broken.

import Konva from 'konva'; // eslint should flag this line

export const stage = new Konva.Stage({ container: 'div', width: 100, height: 100 });
