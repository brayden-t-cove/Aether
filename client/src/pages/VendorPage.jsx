import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CERT_STATES, LIFECYCLES, VENDOR_STATUSES, VENDOR_TYPES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import ActivityList from '../components/ActivityList.jsx';
import ErrorNote from '../components/ErrorNote.jsx';
import OdysseyBadge from '../components/OdysseyBadge.jsx';
import VendorForm from '../components/VendorForm.jsx';
import { ProductSelect } from '../components/Pickers.jsx';

const EMPTY_CONTACT = { name: '', role: '', email: '', phone: '', messaging: '' };

export default function VendorPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const { data, error, reload } = useLoad(`/api/vendors/${id}`);
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState(null);
  const [link, setLink] = useState({ product_id: '', role: 'manufacturer' });
  const [actionError, setActionError] = useState(null);

  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;
  const { vendor: v, contacts, products, certifications, activity } = data;
  const editable = can('editor');
  const synced = v.source === 'odyssey';

  async function run(fn) {
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(err);
    }
  }

  return (
    <div className="page narrow-ish">
      <nav className="crumbs">
        <Link to="/vendors">Vendors</Link> /
      </nav>
      <header className="page-header row between">
        <div>
          <h1>
            {v.name} {synced && <OdysseyBadge />}
          </h1>
          <p className="muted">
            {VENDOR_TYPES[v.type]} · {VENDOR_STATUSES[v.status]}
            {v.country && ` · ${v.country}`}
            {v.website && (
              <>
                {' · '}
                <a href={v.website} target="_blank" rel="noreferrer noopener">
                  Website
                </a>
              </>
            )}
          </p>
        </div>
        {editable && !editing && (
          <button className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </header>
      <ErrorNote error={actionError} />

      {editing ? (
        <div className="card">
          <VendorForm
            vendor={v}
            onSubmit={async (payload) => {
              await api(`/api/vendors/${id}`, { method: 'PATCH', body: payload });
              setEditing(false);
              reload();
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        v.notes && <p className="pre">{v.notes}</p>
      )}

      <section className="card">
        <div className="row between">
          <h2>Contacts</h2>
          {editable && !synced && !contact && (
            <button className="btn small" onClick={() => setContact(EMPTY_CONTACT)}>
              Add contact
            </button>
          )}
        </div>
        {synced && <p className="muted small">Contacts come from Odyssey.</p>}
        {contacts.length === 0 && !contact && <p className="muted">No contacts yet.</p>}
        <ul className="dash-items">
          {contacts.map((c) => (
            <li key={c.id}>
              <div className="dash-item-main">
                <strong>{c.name}</strong>
                {c.role && <span className="muted small">{c.role}</span>}
                <span className="spacer" />
                {editable && !synced && (
                  <button className="btn ghost small danger" onClick={() => window.confirm(`Remove ${c.name}?`) && run(() => api(`/api/vendor-contacts/${c.id}`, { method: 'DELETE' }))}>
                    Remove
                  </button>
                )}
              </div>
              <div className="small">
                {[c.email && <a key="e" href={`mailto:${c.email}`}>{c.email}</a>, c.phone, c.messaging].filter(Boolean).map((x, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    {x}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {contact && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api(`/api/vendors/${id}/contacts`, { method: 'POST', body: contact });
                setContact(null);
              });
            }}
          >
            <div className="form-row">
              {['name', 'role', 'email', 'phone', 'messaging'].map((k) => (
                <label key={k}>
                  {k === 'messaging' ? 'WeChat / WhatsApp' : k[0].toUpperCase() + k.slice(1)}
                  <input required={k === 'name'} value={contact[k]} onChange={(e) => setContact({ ...contact, [k]: e.target.value })} />
                </label>
              ))}
            </div>
            <div className="row">
              <button className="btn primary">Add contact</button>
              <button type="button" className="btn ghost" onClick={() => setContact(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="card">
        <h2>Products</h2>
        {products.length === 0 && <p className="muted">Not linked to any products yet.</p>}
        <ul className="dash-items">
          {products.map((p) => (
            <li key={`${p.id}:${p.role}`}>
              <div className="dash-item-main">
                <Link to={`/products/${p.id}`}>{p.name}</Link>
                <span className="muted small">
                  {VENDOR_TYPES[p.role]} · {LIFECYCLES[p.lifecycle]}
                </span>
                <span className="spacer" />
                {editable && (
                  <button className="btn ghost small" onClick={() => run(() => api(`/api/vendors/${id}/products/${p.id}/${p.role}`, { method: 'DELETE' }))}>
                    Unlink
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {editable && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api(`/api/vendors/${id}/products`, { method: 'POST', body: link });
                setLink({ product_id: '', role: link.role });
              });
            }}
          >
            <ProductSelect value={link.product_id} onChange={(pid) => setLink({ ...link, product_id: pid })} required aria-label="Product to link" />
            <select value={link.role} onChange={(e) => setLink({ ...link, role: e.target.value })} aria-label="Role">
              {Object.entries(VENDOR_TYPES).map(([k, val]) => (
                <option key={k} value={k}>
                  as {val.toLowerCase()}
                </option>
              ))}
            </select>
            <button className="btn small">Link product</button>
          </form>
        )}
      </section>

      {certifications.length > 0 && (
        <section className="card">
          <h2>Certifications run by this lab</h2>
          <ul className="dash-items">
            {certifications.map((c) => (
              <li key={c.id}>
                <Link to={`/certifications/${c.id}`}>
                  {c.product_name} · {c.mark} ({c.market_code})
                </Link>{' '}
                <span className="muted small">{CERT_STATES[c.state]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>History</h2>
        <ActivityList activity={activity} linkRecords={false} />
      </section>

      {can('admin') && (
        <div className="danger-zone">
          <button
            className="btn ghost danger"
            onClick={() =>
              window.confirm(`Delete ${v.name}?`) &&
              api(`/api/vendors/${id}`, { method: 'DELETE' })
                .then(() => navigate('/vendors'))
                .catch(setActionError)
            }
          >
            Delete vendor
          </button>
        </div>
      )}
    </div>
  );
}
