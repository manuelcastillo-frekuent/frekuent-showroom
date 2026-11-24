import { useCallback, useState } from 'react';
import { Stage } from '@/shared/stage/Stage';
import { config } from '@/shared/config/env';
import { isBusy, usePayment } from '@/features/payments';
import { VendingPage } from '@/features/vending';
import { ConnectionBadge } from './components/ConnectionBadge';
import { DemoBadge } from './components/DemoBadge';
import { useIdleReset } from './hooks/useIdleReset';

export function App() {
  // Bumped on idle so the machine remounts and drops any half-typed code.
  const [session, setSession] = useState(0);
  const { state, reset } = usePayment();

  const backToStart = useCallback(() => {
    reset();
    setSession((s) => s + 1);
  }, [reset]);

  // Never reset the screen while a visitor's payment is in flight.
  useIdleReset(config.idleResetMs, backToStart, isBusy(state));

  return (
    <Stage>
      <div key={session} className="fill fade-in">
        <VendingPage />
      </div>
      {config.paymentMode === 'demo' ? <DemoBadge /> : <ConnectionBadge />}
    </Stage>
  );
}
