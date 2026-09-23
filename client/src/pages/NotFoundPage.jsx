import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="page">
      <div className="card empty">
        <h1>Page not found</h1>
        <Link to="/" className="btn">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
