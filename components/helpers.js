export function money(amount, currency) {
  if (currency === 'KHR') return `${Number(amount).toLocaleString()}៛`;
  return `$${Number(amount).toFixed(2)}`;
}

export function nameOf(room, id) {
  return room.players.find((p) => p.id === id)?.name || '?';
}

export const RANK_LABELS = { 1: '🥇 1st', 2: '🥈 2nd', 3: '🥉 3rd', 4: '4th' };
