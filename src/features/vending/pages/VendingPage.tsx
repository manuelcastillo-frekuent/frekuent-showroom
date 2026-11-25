import { MachineCabinet } from '../components/MachineCabinet';
import { MachineDisplay } from '../components/MachineDisplay';
import { MachineHeader } from '../components/MachineHeader';
import { DispenseFlight } from '../components/DispenseFlight';
import { FailDeliveryToggle } from '../components/FailDeliveryToggle';
import { Keypad } from '../components/Keypad';
import { PickupTray } from '../components/PickupTray';
import { ProductGlass } from '../components/ProductGlass';
import { SpotBay } from '../components/SpotBay';
import { Vents } from '../components/Vents';
import { PRODUCTS } from '../domain/products';
import { useVendingMachine } from '../hooks/useVendingMachine';
import { displayLines, shownCode } from '../utils/displayLines';

/**
 * Snacks-and-drinks machine from the prototype. The visitor keys a code, the
 * machine sends the vend request and the Spot Pro in the bay takes the payment.
 * Composition only: behaviour lives in `useVendingMachine`.
 */
export function VendingPage() {
  const machine = useVendingMachine();
  const [line1, line2] = displayLines(
    machine.state,
    machine.code,
    machine.error,
    machine.refundShown,
  );

  return (
    <>
      <MachineCabinet>
        <MachineHeader />
        <ProductGlass
          products={PRODUCTS}
          selectedCode={machine.selected?.code ?? null}
          dropping={machine.dropping}
          dispensing={machine.dispensing}
          jamming={machine.jamming}
          onJamEnd={machine.onJamEnd}
        />
        <MachineDisplay code={shownCode(machine.code)} line1={line1} line2={line2} />
        <Keypad onPress={machine.press} />
        <SpotBay
          waiting={machine.waitingTap}
          canSimulateTap={machine.canSimulateTap}
          onTap={machine.simulateTap}
        />
        <Vents />
        <PickupTray
          item={machine.dropping ? machine.selected : null}
          delivered={machine.state.status === 'delivered'}
          onTake={machine.clear}
        />
        {/* Last, so the falling product passes over the glass and the tray. */}
        {machine.flying && machine.selected && (
          <DispenseFlight product={machine.selected} onLand={machine.onDropEnd} />
        )}
      </MachineCabinet>
      <FailDeliveryToggle
        armed={machine.failNextDelivery}
        disabled={!machine.canToggleFailure}
        onToggle={machine.toggleFailNextDelivery}
      />
    </>
  );
}
