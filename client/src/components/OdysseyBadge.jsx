/** Marks a record that comes from (or is linked to) Odyssey. */
export default function OdysseyBadge({ linked = false }) {
  return (
    <span className="tag odyssey-tag" title={linked ? 'Linked to the same record in Odyssey' : 'Synced from Odyssey. Core fields are edited there.'}>
      {linked ? 'In Odyssey' : 'From Odyssey'}
    </span>
  );
}
