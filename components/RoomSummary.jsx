'use client';

import { formatRiel, toRiel } from '@/lib/points';

const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString()}`;
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

// Where everyone at this table stands. Points only move between players, so
// the net column always sums to zero — "profit" here is one player's win being
// another's loss, converted to riel at 1 pt = 1000៛.
export default function RoomSummary({ room }) {
  const rows = room.players
    .map((p) => ({ id: p.id, name: p.name, net: p.tally || 0, points: p.points }))
    .sort((a, b) => b.net - a.net);

  const won = rows.filter((r) => r.net > 0).reduce((s, r) => s + r.net, 0);
  const wallets = rows.filter((r) => typeof r.points === 'number');
  const onTable = wallets.reduce((s, r) => s + r.points, 0);

  return (
    <div className="summary">
      <h3>Room summary</h3>
      <p className="muted">
        {room.roundsPlayed} round{room.roundsPlayed === 1 ? '' : 's'} played
      </p>

      <table className="summary-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Net</th>
            <th>In riel</th>
            <th>Wallet</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.name}
                {r.id === room.you && <span className="chip you">you</span>}
              </td>
              <td className={cls(r.net)}>{signed(r.net)} pt</td>
              <td className={cls(r.net)}>
                {r.net === 0 ? '—' : `${r.net > 0 ? '+' : '−'}${formatRiel(Math.abs(toRiel(r.net)))}`}
              </td>
              <td>{typeof r.points === 'number' ? `${r.points.toLocaleString()} pt` : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Changed hands</td>
            <td>{won.toLocaleString()} pt</td>
            <td>{formatRiel(toRiel(won))}</td>
            <td>{wallets.length === rows.length ? `${onTable.toLocaleString()} pt` : '—'}</td>
          </tr>
        </tfoot>
      </table>

      <p className="hint">
        1 pt = {formatRiel(1000)}. Winnings come straight out of the losers&apos; wallets —
        the game takes no cut, so the net column adds up to zero.
      </p>
    </div>
  );
}