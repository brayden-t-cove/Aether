/** What keeps coming up in a set of buyers' notes: shared two-word phrases and words, by how many notes use them. */

// Words that carry no theme on their own.
const STOP = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both but by can cant
  could did didnt do does doesnt doing dont down during each even ever every few for from further get gets got had has have having he her
  here hers him his how i id if im in into is isnt it its itself ive just like make me more most my myself no nor not now of off on once only
  or other our ours out over own really same she should so some still such than that thats the their them then there these they this those
  through to too under until up very want wanted was wasnt we well were what when where which while who why will with wont would wouldnt
  you your yours yourself camera cameras cam product item items return returned returning luna one two use used using work works working
  worked thing things get getting bought buy order ordered need needed`.split(/\s+/),
);

/** Phrases (two words) and single words that come up in more than one note, most notes first. */
export function commonPhrases(notes, { min = 2, limit = 12 } = {}) {
  const counts = new Map();
  for (const n of notes) {
    const words = n.toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+/g) || [];
    const seen = new Set();
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!STOP.has(w) && w.length >= 4 && !/^\d+$/.test(w)) seen.add(w);
      const next = words[i + 1];
      if (next && !STOP.has(w) && !STOP.has(next) && w.length >= 3 && next.length >= 3) seen.add(`${w} ${next}`);
    }
    for (const p of seen) counts.set(p, (counts.get(p) || 0) + 1);
  }
  const phrases = [...counts].filter(([, c]) => c >= min);
  // A word that only ever appears inside one of the phrases adds nothing.
  const pairs = phrases.filter(([p]) => p.includes(' '));
  const kept = phrases.filter(([p, c]) => p.includes(' ') || !pairs.some(([q, qc]) => qc === c && q.split(' ').includes(p)));
  return kept
    .sort((a, b) => b[1] - a[1] || b[0].split(' ').length - a[0].split(' ').length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([phrase, count]) => ({ phrase, count }));
}
