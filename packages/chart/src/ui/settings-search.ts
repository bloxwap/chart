/** Search labels, section names, hints and choices without a runtime dependency. */
function words(value: string): string[] {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Bounded Damerau–Levenshtein: also accepts adjacent transpositions like gird/grid. */
function closeWord(query: string, word: string): boolean {
  const limit = query.length >= 7 ? 2 : query.length >= 4 ? 1 : 0;
  if (!limit || Math.abs(query.length - word.length) > limit) return false;
  let previous = Array.from({ length: word.length + 1 }, (_, i) => i);
  let beforePrevious = previous;
  for (let i = 1; i <= query.length; i++) {
    const current = [i];
    for (let j = 1; j <= word.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(query[i - 1] !== word[j - 1]));
      if (i > 1 && j > 1 && query[i - 1] === word[j - 2] && query[i - 2] === word[j - 1]) {
        current[j] = Math.min(current[j], beforePrevious[j - 2] + 1);
      }
    }
    beforePrevious = previous;
    previous = current;
  }
  return previous[word.length] <= limit;
}

function abbreviated(query: string, word: string): boolean {
  // Short queries use exact partial matches; scattered one/two-letter matches
  // would make nearly every setting appear. Longer abbreviations stay local.
  if (query.length < 3 || query[0] !== word[0] || word.length > query.length * 2) return false;
  let index = 0;
  for (const letter of word) if (letter === query[index]) index++;
  return index === query.length;
}

export function matchesSettingsSearch(query: string, fields: readonly string[]): boolean {
  const terms = words(query);
  const candidates = fields.flatMap(words);
  return terms.every((term) => candidates.some((word) => word.includes(term) || abbreviated(term, word) || closeWord(term, word)));
}
