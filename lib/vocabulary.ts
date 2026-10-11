/** Words a structural site inspection uses, given to Whisper as a hint so
 *  it spells them as the engineer means them ("PFC", not "PFC's" or "P F C";
 *  "purlin", not "pearling"). Whisper reads only the last ~220 tokens of a
 *  hint, so it is kept short, with the note's own words first. */

const TERMS = [
  'gridline', 'reinforcement', 'rebar', 'stirrup', 'ligature', 'lap length', 'cover', 'starter bars',
  'slab', 'beam', 'column', 'footing', 'pile', 'bond beam', 'blockwork', 'lintel', 'grout', 'dowel',
  'purlin', 'girt', 'portal frame', 'knee', 'haunch', 'apex', 'base plate', 'cleat', 'stiffener',
  'PFC', 'UB', 'UC', 'SHS', 'RHS', 'CHS', 'M12', 'M16', 'M20', 'M24', 'fillet weld', 'butt weld',
  'chemset', 'epoxy anchor', 'bracing', 'flybrace', 'shear wall', 'diaphragm', 'precast', 'tilt panel',
  'NZS 3101', 'NZS 3404', 'NZS 3604', 'PS3', 'hold point', 'shop drawings',
]

/** The hint for one recording: the note's own names (zone, drawing,
 *  project), then the general terms. */
export function whisperPrompt(context: string[] = []): string {
  const own = context.map(c => c.trim()).filter(Boolean).slice(0, 8)
  return `Structural engineering site inspection notes. ${own.length ? own.join(', ') + '. ' : ''}${TERMS.join(', ')}.`
}
