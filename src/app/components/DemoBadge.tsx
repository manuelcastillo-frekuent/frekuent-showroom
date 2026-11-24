/** Discreet corner mark so staff can tell the screen is not taking real payments. */
export function DemoBadge() {
  return (
    <span
      className="abs"
      style={{ right: 40, bottom: 32, fontSize: 28, color: 'rgba(118,118,118,.6)' }}
    >
      demo
    </span>
  );
}
