'use client';

import { formatRiel, toRiel } from '@/lib/points';

const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString()}`;
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

// Where everyone at this table stands, round by round and in total. Points only
// move between players, so every column sums to zero — "profit" here is one
// player's win being another's loss, converted to riel at 1 pt = 1000៛.
export default function RoomSummary({ room }) {
  const rows = room.players
    .map((p) => ({ id: p.id, name: p.name, net: p.tally || 0, points: p.points, isBot: p.isBot }))
    .sort((a, b) => b.net - a.net);

  const won = rows.filter((r) => r.net > 0).reduce((s, r) => s + r.net, 0);
  const wallets = rows.filter((r) => typeof r.points === 'number');
  const onTable = wallets.reduce((s, r) => s + r.points, 0);

  // Newest round first, so the last result is the one you see without scrolling.
  const history = [...(room.history || [])].reverse();

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
            <th>Total</th>
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
              <td>{r.isBot ? '—' : typeof r.points === 'number' ? `${r.points.toLocaleString()} pt` : '—'}</td>
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

      {history.length > 0 && (
        <>
          <h4 className="summary-sub">Round by round</h4>
          <div className="summary-scroll">
            <table className="summary-table rounds">
              <thead>
                <tr>
                  <th>#</th>
                  {rows.map((r) => (
                    <th key={r.id}>{r.name.split(' ')[0]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.n}>
                    <td>{h.n}</td>
                    {rows.map((r) => {
                      const v = h.net?.[r.id] || 0;
                      return (
                        <td key={r.id} className={cls(v)}>
                          {v === 0 ? '—' : signed(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="hint">
        1 pt = {formatRiel(1000)}. Winnings come straight out of the losers&apos; wallets —
        the game takes no cut, so every round adds up to zero.
      </p>
    </div>
  );
}