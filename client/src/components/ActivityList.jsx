import { Link } from 'react-router-dom';
import { activityLink, describeActivity } from '../lib/activity.js';
import { formatDateTime } from '../lib/format.js';

export default function ActivityList({ activity, linkRecords = true }) {
  if (!activity?.length) return <p className="muted">No activity yet.</p>;
  return (
    <ul className="activity">
      {activity.map((a) => {
        const href = linkRecords ? activityLink(a) : null;
        const text = describeActivity(a);
        return (
          <li key={a.id}>
            <span>{href ? <Link to={href}>{text}</Link> : text}</span>
            <time className="muted small" dateTime={a.created_at}>
              {formatDateTime(a.created_at)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
