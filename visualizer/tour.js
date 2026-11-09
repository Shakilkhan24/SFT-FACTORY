/* ============================================================
   Guided tour — step content lives here; the shell renders it.
   ============================================================ */

let tourSteps = [];

export function setTour(steps) { tourSteps = steps; }
export function getTour() { return tourSteps; }
export function setTourIndex(i) { return i; }
