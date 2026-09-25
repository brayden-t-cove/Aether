import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PROJECT_TYPES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import ErrorNote from '../components/ErrorNote.jsx';

function suggestName({ product, market, template }) {
  if (!product) return '';
  if (template === 'us_launch') return `${product.name} — US launch`;
  if (template === 'international_launch' && market) return `${product.name} — ${market.code} launch`;
  return '';
}

export default function NewProjectPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const products = useLoad('/api/products');
  const markets = useLoad('/api/markets');
  const users = useLoad('/api/users');
  const templates = useLoad('/api/templates');

  const [form, setForm] = useState({
    template: params.get('market') ? 'international_launch' : 'us_launch',
    product_id: params.get('product') || '',
    market_id: params.get('market') || '',
    owner_id: user.id,
    target_date: '',
    // Matches the default template's project type (see server/lib/templates.js).
    type: params.get('market') ? 'launch' : 'new_product',
    description: '',
  });
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const product = products.data?.products.find((p) => p.id === form.product_id);
  const market = markets.data?.markets.find((m) => m.id === form.market_id);
  const template = templates.data?.templates.find((t) => t.key === form.template);

  // A template can come with a market (the US launch is for the US): fill it in if none is picked.
  useEffect(() => {
    const code = template?.defaultMarketCode;
    const m = code && markets.data?.markets.find((x) => x.code === code);
    if (m) setForm((f) => (f.market_id ? f : { ...f, market_id: m.id }));
  }, [template, markets.data]);

  // Keep the suggested name in step with the choices until the user types their own.
  useEffect(() => {
    if (!nameTouched) setName(suggestName({ product, market, template: form.template }));
  }, [product, market, form.template, nameTouched]);

  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === 'template') {
        const t = templates.data?.templates.find((x) => x.key === value);
        if (t) next.type = t.projectType;
        // Leaving the US launch: drop the US market it filled in, so the next template starts clean.
        const us = markets.data?.markets.find((x) => x.code === 'US');
        if (t?.key !== 'us_launch' && f.template === 'us_launch' && f.market_id === us?.id) next.market_id = '';
      }
      return next;
    });
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { project } = await api('/api/projects', {
        method: 'POST',
        body: { ...form, name, template: form.template || null },
      });
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  const loading = !products.data || !markets.data || !users.data || !templates.data;

  return (
    <div className="page narrow">
      <nav className="crumbs">
        <Link to="/projects">Projects</Link> /
      </nav>
      <header className="page-header">
        <h1>New project</h1>
        <p className="muted">Pick a starting checklist and Aether fills in the steps, with blockers already linked.</p>
      </header>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <form className="card stack" onSubmit={handleSubmit}>
          <ErrorNote error={error} />

          <fieldset className="choice-group">
            <legend>Starting checklist</legend>
            {templates.data.templates.map((t) => (
              <label key={t.key} className={`choice ${form.template === t.key ? 'selected' : ''}`}>
                <input type="radio" name="template" value={t.key} checked={form.template === t.key} onChange={set('template')} />
                <span>
                  <strong>{t.label}</strong>
                  <span className="muted small">{t.description}</span>
                </span>
              </label>
            ))}
            <label className={`choice ${form.template === '' ? 'selected' : ''}`}>
              <input type="radio" name="template" value="" checked={form.template === ''} onChange={set('template')} />
              <span>
                <strong>Blank</strong>
                <span className="muted small">Start with an empty checklist.</span>
              </span>
            </label>
          </fieldset>

          <div className="form-row">
            <label>
              Product
              <select value={form.product_id} onChange={set('product_id')}>
                <option value="">— None —</option>
                {products.data.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.model ? ` (${p.model})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>
                Market {template?.needsMarket && <span className="muted small">(required)</span>}
              </span>
              <select value={form.market_id} onChange={set('market_id')} required={Boolean(template?.needsMarket)}>
                <option value="">— None —</option>
                {markets.data.markets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} · {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {products.data.products.length === 0 && (
            <p className="muted small">
              No products yet. <Link to="/products">Add one</Link> first, or create the project without a product.
            </p>
          )}
          {market && template && (
            <p className="muted small">
              The checklist will use {market.name}'s details: {market.required_marks.join(', ') || 'no'} certification
              {template.needsMarket && (
                <>
                  , type {market.plug_types.join('/') || '?'} plug, {market.voltage || 'local voltage'}, and {market.languages.join(', ') || 'local'} translations
                </>
              )}
              .
            </p>
          )}

          <label>
            Project name
            <input
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              placeholder="Lightbulb Camera — UK launch"
            />
          </label>

          <div className="form-row">
            <label>
              Type
              <select value={form.type} onChange={set('type')}>
                {Object.entries(PROJECT_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Owner
              <select value={form.owner_id} onChange={set('owner_id')}>
                <option value="">Unassigned</option>
                {users.data.users
                  .filter((u) => u.active)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name || u.email}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Target date
              <input type="date" value={form.target_date} onChange={set('target_date')} />
            </label>
          </div>

          <label>
            Description
            <textarea rows={3} value={form.description} onChange={set('description')} />
          </label>

          <div className="row">
            <button className="btn primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create project'}
            </button>
            <Link className="btn ghost" to="/projects">
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
