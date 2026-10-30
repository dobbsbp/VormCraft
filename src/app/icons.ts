/** Our own toolbar icons: simple 24×24 line drawings using currentColor. */

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${body}</svg>`;

// An isometric cube; `fill` highlights one face to show which standard view a button picks.
const cube = (fill = '') => svg(`${fill}<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>`);
const face = (d: string) => `<path d="${d}" fill="currentColor" fill-opacity="0.35" stroke="none"/>`;

export const ICONS = {
  zoomExtents: svg('<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>'),
  iso: cube(),
  top: cube(face('M12 3 20 7.5 12 12 4 7.5Z')),
  front: cube(face('M4 7.5 12 12v9l-8-4.5Z')),
  right: cube(face('M20 7.5 12 12v9l8-4.5Z')),
  back: svg('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z" stroke-dasharray="2 2"/><path d="M4 7.5 12 3l8 4.5M12 3v9" />' + face('M12 3 20 7.5v9L12 12Z')),
  left: svg('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z" stroke-dasharray="2 2"/><path d="M4 7.5 12 3v9M12 12l-8 4.5"/>' + face('M4 7.5 12 3v9l-8 4.5Z')),

  lasso: svg('<path d="M8 14c-4-1-5-4-3-7s8-4 12-2 4 6 0 8-7 2-9 1"/><path d="M8 14c0 3 2 5 4 6" /><circle cx="8" cy="14" r="1.4" fill="currentColor"/>'),
  select: svg('<path d="M6 3v15l4-4 3 7 2.5-1-3-7h5.5Z" fill="currentColor" fill-opacity="0.15"/>'),
  rectangle: svg('<rect x="4" y="6" width="16" height="12"/><circle cx="4" cy="6" r="1.6" fill="currentColor"/><circle cx="20" cy="18" r="1.6" fill="currentColor"/>'),
  rectangle3: svg('<path d="M4 15 13 4l7 6-9 11Z"/><circle cx="4" cy="15" r="1.6" fill="currentColor"/><circle cx="13" cy="4" r="1.6" fill="currentColor"/><circle cx="20" cy="10" r="1.6" fill="currentColor"/>'),
  polygon: svg('<path d="M12 3.5 19.4 7.75v8.5L12 20.5l-7.4-4.25v-8.5Z"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>'),
  pie: svg('<path d="M12 12V4a8 8 0 1 1-8 8Z"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>'),
  zoomWindow: svg('<rect x="3" y="3" width="11" height="11" stroke-dasharray="2 1.5"/><circle cx="14" cy="14" r="4.5"/><path d="m17.5 17.5 3.5 3.5"/>'),
  previousView: svg('<path d="M9 6 4 11l5 5"/><path d="M4 11h9a6 6 0 0 1 6 6v2"/><rect x="14" y="3" width="7" height="5" rx="1"/>'),
  circle: svg('<circle cx="12" cy="12" r="8"/><path d="M12 12h8" stroke-dasharray="2 1.5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>'),
  pushpull: svg('<path d="M3 16 9 19l12-5-6-3Z"/><path d="M12 14V4M8.5 7.5 12 4l3.5 3.5"/>'),
  followMe: svg('<path d="M3 21V13h5v3h3" fill="currentColor" fill-opacity="0.25"/><path d="M8 16h6a5 5 0 0 0 5-5V4" stroke-dasharray="2 1.5"/><path d="m16.5 6.5 2.5-2.5 2.5 2.5"/>'),
  paint: svg('<path d="m10 3 8 8-6.5 6.5a1.5 1.5 0 0 1-2 0L3.5 11.5a1.5 1.5 0 0 1 0-2Z"/><path d="M3.5 10.5h13.5"/><path d="M19.5 14.5s1.8 2.2 1.8 3.4a1.8 1.8 0 0 1-3.6 0c0-1.2 1.8-3.4 1.8-3.4Z" fill="currentColor"/>'),
  materials: svg('<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.6-1.6-1.8-1.6-3.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-3.9-4-7-9-7Z"/><circle cx="7.5" cy="11" r="1.3" fill="currentColor"/><circle cx="10" cy="7" r="1.3" fill="currentColor"/><circle cx="15" cy="7.5" r="1.3" fill="currentColor"/>'),
  offset: svg('<rect x="3" y="3" width="18" height="18" rx="1"/><rect x="8" y="8" width="8" height="8" stroke-dasharray="2 1.5"/><path d="M3 3l5 5"/>'),
  tape: svg('<circle cx="9" cy="13" r="6"/><circle cx="9" cy="13" r="2"/><path d="M15 13h6v3h-6M18 13v1.5"/>'),
  line: svg('<path d="M4 20 20 4"/><circle cx="4" cy="20" r="1.6" fill="currentColor"/><circle cx="20" cy="4" r="1.6" fill="currentColor"/>'),
  arc2: svg('<path d="M3 18a9 9 0 0 1 18 0"/><circle cx="3" cy="18" r="1.6" fill="currentColor"/><circle cx="21" cy="18" r="1.6" fill="currentColor"/>'),
  arc3: svg('<path d="M3 18a9 9 0 0 1 18 0"/><circle cx="3" cy="18" r="1.6" fill="currentColor"/><circle cx="12" cy="9" r="1.6" fill="currentColor"/><circle cx="21" cy="18" r="1.6" fill="currentColor"/>'),
  arc: svg('<path d="M21 18a9 9 0 0 0-9-9"/><path d="M12 18h9M12 18V9" stroke-dasharray="2 1.5"/><circle cx="12" cy="18" r="1.6" fill="currentColor"/>'),
  move: svg('<path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/><rect x="9" y="9" width="6" height="6" fill="currentColor" fill-opacity="0.25"/>'),
  rotate: svg('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>'),
  scale: svg('<rect x="3" y="11" width="10" height="10"/><path d="M3 11V3h18v18h-8" stroke-dasharray="2 1.5"/><path d="M13 11l6-6M15 5h4v4"/>'),
  text: svg('<path d="M5 5h14M12 5v14M9 19h6"/>'),
  eraser: svg('<path d="m14 4 6 6-9 9H6l-3-3Z"/><path d="m9 9 6 6M6 19h14"/>'),
  orbit: svg('<ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M12 3v18" stroke-dasharray="2 2"/><path d="m17 6 3 2-3.5 1"/>'),
  pan: svg('<path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>'),
  zoom: svg('<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M10 7v6M7 10h6"/>'),
  newDoc: svg('<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4"/>'),
  open: svg('<path d="M3 6h6l2 2h10v11H3Z"/><path d="M3 10h18"/>'),
  save: svg('<path d="M4 4h13l3 3v13H4Z"/><path d="M8 4v5h8V4M8 20v-6h8v6"/>'),
  undo: svg('<path d="M9 7 4 12l5 5"/><path d="M4 12h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="m15 7 5 5-5 5"/><path d="M20 12H9a5 5 0 0 0 0 10h3"/>'),
  exportFile: svg('<path d="M12 3v11M8 10l4 4 4-4"/><path d="M4 17v4h16v-4"/>'),
  guides: svg('<path d="M2 8h20M2 16h20" stroke-dasharray="3 2"/><path d="M8 3v18" stroke-dasharray="3 2"/>'),
  guidesDelete: svg('<path d="M2 8h12M2 16h8" stroke-dasharray="3 2"/><path d="M15 13l6 6M21 13l-6 6"/>'),
} as const;
