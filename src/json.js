// Get JSON out of a model reply, whatever it wrapped it in.
//
// Every model call in this project asks for JSON and nothing else, and models honour that to
// varying degrees: some fence it in ```json, some fence it bare, some open with "Here is the
// plan:" and then the object. This was written out twice - once in coordinator.js as
// `parsePlan`, once in repair.js as `parseJson` - and two copies of the same tolerant parser is
// one copy too many, because the day one of them learns a new wrapper the other doesn't.
//
// It is deliberately NOT clever about repairing truncated JSON. A reply that got cut off
// mid-object is a budget problem (a reasoning model spends maxOutputTokens on thinking before
// it writes a character), and the providers now raise that as its own error saying *truncated*.
// Guessing the missing braces here would hide the one signal that names the real cause.

/**
 * @param {string} content raw model text
 * @returns {object} the parsed object
 * @throws if nothing in it parses as JSON
 */
export function parseJsonish(content) {
  const text = String(content ?? '');
  const candidates = [];
  const fenced = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/```\n?([\s\S]*?)\n?```/);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);
  // The widest {...} span - handles a model that wraps the object in prose.
  const first = text.indexOf('{'), last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.trim());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* try the next candidate */ }
  }
  throw new Error(`the model did not return valid JSON - ${diagnose(text)}`);
}

/**
 * Say WHICH failure this is, because "the model did not return valid JSON" is the single most
 * misleading message in this project: it reads as "the model refused" and is almost always a
 * TRUNCATION, whose fix is more budget, not a reworded prompt. The old message printed the
 * FIRST 200 characters, which is exactly the part that looks fine in both cases - the tail is
 * what tells you. An unclosed brace at the end of a 12k reply is a budget problem; a reply that
 * opens with prose is a format problem.
 */
export function diagnose(text) {
  const t = String(text ?? '').trim();
  if (!t) return 'the reply was empty';

  // Count structure depth outside of strings, so a `{` inside "a {cosy} hut" doesn't count.
  let depth = 0, inStr = false, esc = false;
  for (const ch of t) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }

  const tail = t.slice(-120).replace(/\s+/g, ' ');
  if (depth > 0 || inStr) {
    return `it is TRUNCATED, not refused - ${depth} unclosed ${depth === 1 ? 'level' : 'levels'}` +
      `${inStr ? ' and it stops mid-string' : ''} after ${t.length} characters. ` +
      `Raise maxTokens for this call (a reasoning model spends it on thinking first). Ends: ...${tail}`;
  }
  if (!/^[[{]/.test(t)) return `it does not start with { or [ (${t.length} chars). Starts: ${t.slice(0, 120).replace(/\s+/g, ' ')}...`;
  return `the structure is balanced but unparseable (${t.length} chars). Ends: ...${tail}`;
}
