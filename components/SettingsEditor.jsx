'use client';

import { getSocket } from '@/lib/socket-client';
import { money } from './helpers';

// Host sets how much each round is worth. Payout scheme:
//   last place pays the Winner 1 prize to 1st place,
//   3rd place pays the Winner 2 prize to 2nd place.
export default function SettingsEditor({ room, isHost }) {
  const s = room.settings;
  const update = (patch) => getSocket().emit('room:updateSettings', patch);
  const disabled = !isHost || room.status !== 'waiting';

  return (
    <div className="settings">
      <h3>Stakes per round</h3>
      <label>
        Winner 1 prize
        <input
          type="number"
          min="0"
          step={s.currency === 'KHR' ? '100' : '0.25'}
          value={s.betWinner1}
          disabled={disabled}
          onChange={(e) => update({ betWinner1: e.target.value })}
        />
      </label>
      <label>
        Winner 2 prize
        <input
          type="number"
          min="0"
          step={s.currency === 'KHR' ? '100' : '0.25'}
          value={s.betWinner2}
          disabled={disabled}
          onChange={(e) => update({ betWinner2: e.target.value })}
        />
      </label>
      <label>
        Bomb bonus (chop a 2)
        <input
          type="number"
          min="0"
          step={s.currency === 'KHR' ? '100' : '0.25'}
          value={s.bombBonus}
          disabled={disabled}
          onChange={(e) => update({ bombBonus: e.target.value })}
        />
      </label>
      <label>
        Catch-the-2 price
        <input
          type="number"
          min="0"
          step={s.currency === 'KHR' ? '100' : '0.25'}
          value={s.catch2Price}
          disabled={disabled}
          onChange={(e) => update({ catch2Price: e.target.value })}
        />
      </label>
      <label>
        Currency
        <select
          value={s.currency}
          disabled={disabled}
          onChange={(e) => update({ currency: e.target.value })}
        >
          <option value="USD">USD ($)</option>
          <option value="KHR">KHR (៛)</option>
        </select>
      </label>
      <p className="hint">
        Last place pays {money(s.betWinner1, s.currency)} to 1st place.
        {s.betWinner2 > 0 && <> 3rd place pays {money(s.betWinner2, s.currency)} to 2nd place.</>}
        {s.bombBonus > 0 && <> Chopping with a bomb 💣 collects {money(s.bombBonus, s.currency)} from the chopped player — chopping a quad pays ×2, and every counter-chop doubles again.</>}
        {s.catch2Price > 0 && <> After the round, the last winner may catch the loser&apos;s 2 🐷 for {money(s.catch2Price, s.currency)} — right, the loser pays; wrong, the catcher pays. Set 0 to disable.</>}
        {!isHost && ' Only the host can change stakes.'}
      </p>
    </div>
  );
}
