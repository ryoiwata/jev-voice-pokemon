// Furniture and scenery, by tileset and tile id.
//
// The game has no idea that a bed is a bed: it is just floor you cannot walk on. So "go to the bed" needs
// a table saying which tiles are which. Each entry here was checked against the screen it appears on.
// Tilesets not listed simply have no named scenery yet; adding one is a matter of adding its tile ids.
export const LANDMARKS: Record<number, Record<number, string>> = {
  // REDS_HOUSE_1 (downstairs)
  1: { 0x16: 'TV', 0x36: 'table', 0x38: 'table', 0x3c: 'table', 0x3a: 'table', 0x30: 'bookshelf', 0x32: 'bookshelf' },
  // REDS_HOUSE_2 (the bedroom)
  4: { 0x3d: 'bed', 0x3f: 'bed', 0x16: 'TV', 0x08: 'plant', 0x18: 'plant' },
  // DOJO / Oak's lab
  5: { 0x0d: 'bookshelf', 0x1d: 'bookshelf', 0x4e: 'table', 0x39: 'table' },
};
