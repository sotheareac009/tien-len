'use client';

import { useCallback, useEffect, useState } from 'react';

const GUEST = { points: 0, topups: [], khqrUrl: null, admin: false, guest: true };

// The signed-in player's points wallet. Guests get the GUEST shape (a 401 from
// the API) rather than an error — they simply cannot play online.
// Returns [wallet, refresh]; wallet is null until the first load finishes.
export function useWallet(enabled = true) {
  const [wallet, setWallet] = useState(null);

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    try {
      const res = await fetch('/api/wallet');
      if (!res.ok) {
        setWallet(GUEST);
        return GUEST;
      }
      const data = await res.json();
      setWallet(data);
      return data;
    } catch {
      setWallet(GUEST);
      return GUEST;
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return [wallet, refresh];
}