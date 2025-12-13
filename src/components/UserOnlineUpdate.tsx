'use client';

import { useEffect } from 'react';

export default function UserOnlineUpdate() {
  useEffect(() => {
    const updateOnline = async () => {
      try {
        await fetch('/api/user/online', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
          cache: 'no-store',
        });
      } catch {
      }
    };
    updateOnline();
  }, []);

  return null;
}

