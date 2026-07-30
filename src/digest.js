// A build plan, small enough to put in a prompt.
//
// A plan is 500-900 blocks. As raw JSON that is ~40k tokens, most of it punctuation, and an
// LLM reads it about as well as you would read a spreadsheet of pixel coordinates. What it
// reads WELL is a picture. So a plan digests to one ASCII floor map per y layer - the way an
// architect draws a building - plus a legend and the role assignments.
//
// This is the "blueprint" half of the two inputs the critic gets (the other half is a
// screenshot of the world). It is the same idea as APT's multimodal prompt
// (github.com/spearsheep/APT-Architectural-Planning-LLM-Agent): the model reasons about the
// structure from a textual layout AND sees the result, and the two together are what let it
// say "the north wall has a hole at y=4" in coordinates we can act on.
//
// It is also the format the coordinator shows as a worked example (see coordinator.js), so a
// model designing a new build sees what a good one looks like laid out layer by layer.

// Every distinct block type in a layer gets one character. Vowels and digits are avoided as
// first choices only so the maps stay readable; there's no meaning in a particular letter.
const CHARS = 'SWDGPTLCBRMKFHJNQVXYZaebcdfghjkmnpqrstuvwxyz0123456789';

/** Blocks with plan-relative coordinates, whatever the plan is carrying. */
function relativeBlocks(plan) {
  const o = plan.origin || { x: 0, y: 0, z: 0 };
  const out = [];
  for (const [role, a] of Object.entries(plan.assignments || {}))
    for (const b of a.blocks || [])
      out.push({ role, type: b.type, x: b.x - o.x, y: b.y - o.y, z: b.z - o.z });
  return out;
}

/**
 * Render a plan as a compact textual blueprint.
 *
 * @param {object} plan - a coordinator/library plan (absolute or relative coords)
 * @param {{ maps?: boolean, maxSpan?: number }} [opts]
 *   `maps: false` gives just the header (name, footprint, roles) - used when a whole preset is
 *   only there for flavour. `maxSpan` is the widest footprint that still gets floor maps; past
 *   that the maps are more tokens than they're worth and only the header is emitted.
 * @returns {string}
 */
export function planDigest(plan, opts = {}) {
  const { maps = true, maxSpan = 48 } = opts;
  const blocks = relativeBlocks(plan);
  const lines = [];

  lines.push(`Build: ${plan.name || '(unnamed)'}`);
  if (plan.description) lines.push(`Description: ${plan.description}`);

  if (!blocks.length) {
    lines.push('(empty plan - no blocks)');
    return lines.join('\n');
  }

  const span = (k) => {
    const vs = blocks.map((b) => b[k]);
    return [Math.min(...vs), Math.max(...vs)];
  };
  const [x0, x1] = span('x');
  const [y0, y1] = span('y');
  const [z0, z1] = span('z');

  lines.push(
    `Footprint (relative to origin): x ${x0}..${x1}, y ${y0}..${y1}, z ${z0}..${z1} - ${blocks.length} blocks`
  );
  lines.push('Roles (this is also the build order):');
  for (const role of plan.buildOrder || Object.keys(plan.assignments || {})) {
    const a = plan.assignments?.[role];
    if (!a) continue;
    lines.push(`  ${role}: ${a.blocks?.length || 0} blocks - ${a.task || ''}`);
  }

  if (!maps) return lines.join('\n');
  if (x1 - x0 > maxSpan || z1 - z0 > maxSpan) {
    lines.push(`(footprint too wide for floor maps - ${x1 - x0 + 1}x${z1 - z0 + 1})`);
    return lines.join('\n');
  }

  // One character per block type, most common first, so the busiest materials get the
  // easiest-to-scan letters.
  const counts = new Map();
  for (const b of blocks) counts.set(b.type, (counts.get(b.type) || 0) + 1);
  const types = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const char = new Map();
  types.forEach((t, i) => char.set(t, CHARS[i] ?? '?'));

  lines.push('');
  lines.push('Legend: ' + types.map((t) => `${char.get(t)}=${t}`).join(' '));
  lines.push(
    `Floor maps, one per y layer. Each row is a z (north to south), each column an x (west to east); ` +
      `'.' is air. Top-left of every map is (x=${x0}, z=${z0}).`
  );

  const byLayer = new Map();
  for (const b of blocks) {
    if (!byLayer.has(b.y)) byLayer.set(b.y, []);
    byLayer.get(b.y).push(b);
  }
  for (const y of [...byLayer.keys()].sort((a, b) => a - b)) {
    const grid = Array.from({ length: z1 - z0 + 1 }, () => Array(x1 - x0 + 1).fill('.'));
    // Last write wins, exactly as the build does - a coordinate written twice (wall, then
    // carved back to air) must digest to what the world will actually end up holding.
    for (const b of byLayer.get(y)) grid[b.z - z0][b.x - x0] = char.get(b.type);
    lines.push('');
    lines.push(`y=${y}`);
    for (const row of grid) lines.push('  ' + row.join(''));
  }

  return lines.join('\n');
}

/** One line per role: what it was asked to do and how much of it there is. */
export function planSummary(plan) {
  const total = Object.values(plan.assignments || {}).reduce((s, a) => s + (a.blocks?.length || 0), 0);
  return `"${plan.name}" - ${total} blocks`;
}
