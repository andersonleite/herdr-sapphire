// Fuzzy file search: a file matches when every letter of the query appears in its path, in
// order, however far apart. Best first: letters that sit together, start a word (after / . _ -
// or a capital), and fall in the file's name rather than its folders; shorter paths win ties.
// Words separated by spaces must all match ("page resume"); a word with a / matches folders.

const BOUNDARY = /[\/\\._\- ]/;
const IN_NAME = 40; // extra for a word matched inside the file's name

/** Paths, prepared once: lowercase copy and where the name starts. */
export function index(paths) {
  return paths.map(path => ({ path, lower: path.toLowerCase(), base: path.lastIndexOf("/") + 1 }));
}

// One word against one path from `start`: the tightest run of its letters ending at the
// first place the whole word fits, scored. Null when the letters aren't there in order.
function scan(file, word, start) {
  const { lower, path } = file;
  let at = 0, end = -1;
  for (let i = start; i < lower.length; i++) {
    if (lower[i] === word[at] && ++at === word.length) { end = i; break; }
  }
  if (end < 0) return null;
  const positions = new Array(word.length);
  at = word.length - 1;
  for (let i = end; at >= 0; i--) if (lower[i] === word[at]) positions[at--] = i;
  let score = 0, last = -2;
  for (const p of positions) {
    score += 16;
    if (p === last + 1) score += 18;
    else if (last >= 0) score -= Math.min(p - last - 1, 12);
    if (p === start || BOUNDARY.test(path[p - 1])) score += 24;
    else if (path[p] !== lower[p] && path[p - 1] === lower[p - 1]) score += 16; // camelCase
    last = p;
  }
  return { score, positions };
}

/** The best `limit` of `files` (from `index`) for `query`: [{ file, score, positions }]. */
export function search(files, query, limit = 200) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const file of files) {
    let score = 0;
    const positions = [];
    for (const word of words) {
      const anywhere = scan(file, word, 0);
      if (!anywhere) { score = null; break; }
      const named = word.includes("/") ? null : scan(file, word, file.base);
      const best = named && named.score + IN_NAME >= anywhere.score ? { score: named.score + IN_NAME, positions: named.positions } : anywhere;
      score += best.score;
      positions.push(...best.positions);
    }
    if (score === null) continue;
    hits.push({ file, score: score - file.path.length * 0.2, positions });
  }
  hits.sort((a, b) => b.score - a.score || a.file.path.length - b.file.path.length || (a.file.path < b.file.path ? -1 : 1));
  return hits.slice(0, limit);
}
