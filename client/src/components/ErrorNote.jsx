export default function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="alert error">{error.message || String(error)}</div>;
}
