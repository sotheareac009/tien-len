'use client';

import { getSocket } from '@/lib/socket-client';
import { formatBoth } from '@/lib/points';

// Host sets how much each round is worth, in points. Payout scheme:
//   last place pays the Winner 1 prize to 1st place,
//   3rd place pays the Winner 2 prize to 2nd place.
export default function SettingsEditor({ room, isHost }) {
  const s = room.settings;
  const update = (patch) => getSocket().emit('room:updateSettings', patch);
  const disabled = !isHost || room.status !== 'waiting';

  const field = (key, label) => (
    <label>
      {label}
      <input
        type="number"
        min="0"
        step="1"
        value={s[key]}
        disabled={disabled}
        onChange={(e) => update({ [key]: e.target.value })}
      />
    </label>
  );

  return (
    <div className="settings">
      <h3>Stakes per round (points)</h3>
      {field('betWinner1', 'Winner 1 prize')}
      {field('betWinner2', 'Winner 2 prize')}
      {field('bombBonus', 'Bomb bonus (chop a 2)')}
      {field('catch2Price', 'Catch-the-2 price')}
      <p className="hint">
        Last place pays {formatBoth(s.betWinner1)} to 1st place.
        {s.betWinner2 > 0 && <> 3rd place pays {formatBoth(s.betWinner2)} to 2nd place.</>}
        {s.bombBonus > 0 && <> Chopping with a bomb 💣 collects {formatBoth(s.bombBonus)} from the chopped player — chopping a quad pays ×2, and every counter-chop doubles again.</>}
        {s.catch2Price > 0 && <> After the round, the last winner may catch the loser&apos;s 2 🐷 for {formatBoth(s.catch2Price)} — right, the loser pays; wrong, the catcher pays. Set 0 to disable.</>}
        {!isHost && ' Only the host can change stakes.'}
      </p>
    </div>
  );
}