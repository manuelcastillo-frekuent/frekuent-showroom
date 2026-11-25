interface FailDeliveryToggleProps {
  armed: boolean;
  disabled: boolean;
  onToggle: () => void;
}

const RED = '#d64545';

/**
 * Staff switch on the screen itself (the kiosk URL may be out of reach on a
 * big display): the next delivery jams and the screen sends a failed dispense
 * result, which makes the backend refund. It sits in the wall space right of
 * the machine, sized in scene pixels so it reads from a step back.
 */
export function FailDeliveryToggle({ armed, disabled, onToggle }: FailDeliveryToggleProps) {
  return (
    <button
      className="abs col center"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={armed}
      style={{
        right: 22,
        bottom: 260,
        width: 340,
        padding: '40px 24px',
        gap: 12,
        borderRadius: 32,
        fontSize: 50,
        fontWeight: 600,
        lineHeight: 1.15,
        textAlign: 'center',
        color: armed ? '#fff' : RED,
        background: armed ? RED : '#fff',
        border: `6px solid ${RED}`,
        boxShadow: '0 12px 28px rgba(26,25,37,.18)',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span>{armed ? 'Next delivery will fail' : 'Fail next delivery'}</span>
      <span style={{ fontSize: 34, fontWeight: 400, opacity: 0.85 }}>
        {armed ? 'Tap to cancel' : 'Test refund'}
      </span>
    </button>
  );
}
