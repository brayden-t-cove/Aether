export default function ModulePlaceholder({ module }) {
  return (
    <div className="page">
      <header className="page-header">
        <h1>{module.label}</h1>
        <p className="muted">{module.summary}</p>
      </header>
      <div className="card empty">
        <span className="phase-badge">Phase {module.phase}</span>
        <p>This module is planned for phase {module.phase} of the roadmap.</p>
      </div>
    </div>
  );
}
