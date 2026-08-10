// Online play is priced in points. Players buy them from the operator with
// riel; nothing in a room ever moves real money directly.
//
// Shared by the browser and the server, so it must stay free of secrets.

export const RIEL_PER_POINT = 1000;

// Point amounts a player can buy in one go.
export const TOPUP_PACKS = [10, 20, 50, 100, 200, 500];

export const toRiel = (points) => Math.round(Number(points) * RIEL_PER_POINT);

export const formatPoints = (points) =>
  `${Number(points).toLocaleString()} pt`;

export const formatRiel = (riel) => `${Number(riel).toLocaleString()}៛`;

// "50 pt (50,000៛)" — the form used wherever a stake or balance is shown, so
// players always see what a number is worth in real money.
export const formatBoth = (points) =>
  `${formatPoints(points)} (${formatRiel(toRiel(points))})`;

// Stakes and balances are whole points; riel amounts below 1000 have no
// representation in the game.
export const cleanPoints = (value, { max = 1_000_000 } = {}) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};