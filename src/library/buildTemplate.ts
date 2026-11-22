import { BUILD_FORMAT, BUILD_LIMITS, BUILD_VERSION } from './buildFormat';
import { PAINTS } from './kit';

/**
 * The text a person gives their own AI so it can write a VormCraft build file: what the format
 * is, the rules that keep designs buildable, worked examples (every one is built by the tests)
 * and, at the end, what they want made.
 */

/** Worked examples, as the AI should write them. */
export const BUILD_EXAMPLES: { title: string; file: object }[] = [
  {
    title: 'A table with settings the person can change, and a shelf that can be switched off',
    file: {
      format: BUILD_FORMAT,
      version: BUILD_VERSION,
      name: 'Simple table',
      units: 'mm',
      settings: [
        { id: 'width', name: 'Width', kind: 'length', value: 1200, min: 400, max: 3000 },
        { id: 'depth', name: 'Depth', kind: 'length', value: 600, min: 300, max: 1500 },
        { id: 'height', name: 'Height', kind: 'length', value: 700, min: 300, max: 1200 },
        { id: 'shelf', name: 'Shelf underneath', kind: 'toggle', value: 1 },
      ],
      parts: [
        {
          name: 'Top',
          colour: 'oak',
          shapes: [
            { type: 'box', from: ['-width/2', '-depth/2', 'height - 30'], to: ['width/2', 'depth/2', 'height'] },
            { type: 'box', from: ['-width/2 + 80', '-depth/2 + 30', 150], to: ['width/2 - 80', 'depth/2 - 30', 170], when: 'shelf' },
          ],
        },
        {
          name: 'Legs',
          colour: 'black',
          shapes: [
            { type: 'box', from: ['-width/2 + 30', '-depth/2 + 30', 0], to: ['-width/2 + 80', '-depth/2 + 80', 'height - 30'], repeat: { count: 2, step: ['width - 110', 0, 0] } },
            { type: 'box', from: ['-width/2 + 30', 'depth/2 - 80', 0], to: ['-width/2 + 80', 'depth/2 - 30', 'height - 30'], repeat: { count: 2, step: ['width - 110', 0, 0] } },
          ],
        },
      ],
    },
  },
  {
    title: 'A phone stand drawn as a side outline (in the yz plane) and pushed across its width, with a slot that fits the phone',
    file: {
      format: BUILD_FORMAT,
      version: BUILD_VERSION,
      name: 'Phone stand',
      units: 'mm',
      settings: [
        { id: 'thickness', name: 'Phone thickness', kind: 'length', value: 10, min: 4, max: 30, note: 'Measure it in its case.' },
        { id: 'width', name: 'Stand width', kind: 'length', value: 70, min: 40, max: 200 },
      ],
      parts: [
        {
          name: 'Stand',
          colour: 'darkGrey',
          shapes: [
            {
              type: 'extrude',
              plane: 'yz',
              at: '-width/2',
              depth: 'width',
              outline: [
                [-40, 0],
                [60, 0],
                [60, 8],
                ['thickness - 23', 8],
                ['thickness + 11', 100],
                ['thickness + 3', 100],
                ['thickness - 32', 8],
                [-34, 8],
                [-34, 20],
                [-40, 20],
              ],
            },
          ],
          cuts: [{ type: 'box', from: [-7, -41, -1], to: [7, -33, 21] }],
        },
      ],
    },
  },
  {
    title: 'A hanging lamp: a shade turned from a profile (lathe), a cord and a ceiling cup; "hangs" places it from the point clicked',
    file: {
      format: BUILD_FORMAT,
      version: BUILD_VERSION,
      name: 'Pendant lamp',
      units: 'mm',
      hangs: true,
      parts: [
        {
          name: 'Shade',
          colour: '#e8dcc0',
          shapes: [
            {
              type: 'lathe',
              centre: [0, 0, 0],
              sides: 32,
              profile: [
                [140, 0],
                [146, 0],
                [60, 180],
                [10, 180],
                [10, 174],
                [55, 174],
              ],
            },
          ],
        },
        {
          name: 'Cord',
          colour: 'black',
          shapes: [
            { type: 'cylinder', base: [0, 0, 175], axis: 'z', radius: 4, length: 610, sides: 8 },
            { type: 'cylinder', base: [0, 0, 775], axis: 'z', radius: 50, length: 20, sides: 24 },
          ],
        },
      ],
    },
  },
];

/** The paints an AI may name, with their colours. */
const paintList = (): string =>
  Object.entries(PAINTS)
    .map(([id, p]) => `${id} (${p.color}${'opacity' in p ? ', see-through' : ''})`)
    .join(', ');

/** The whole template, ending with the request (or a line asking for it). */
export function aiTemplate(request = ''): string {
  const ask = request.trim() || '[Describe what you want here: what it is, what it is for, its main sizes, and anything it has to fit.]';
  return `You are designing a 3D object for VormCraft, a 3D modelling app. Write it as one VormCraft build file: a JSON object in the format below. VormCraft reads the file as data and builds the shapes itself.

Reply with the JSON only, in one \`\`\`json code block. No comments inside the JSON (JSON does not allow them).

HOW TO WORK
1. Think about the object's real-world sizes first. If something has to fit (a phone, a shelf, a cable), give it a little extra room (0.5 to 2 mm).
2. Make the main sizes "settings", so the person can change them in VormCraft afterwards, and write the shapes with formulas that use them.
3. Build it from simple shapes: boxes, cylinders, outlines pushed out (extrude), tapers, turned profiles (lathe) and spheres. Take material away with "cuts".
4. Check every number: shapes that should join must overlap, and nothing should float unless it is meant to.

COORDINATES
- Millimetres unless "units" says otherwise ("mm", "cm", "m", "in" or "ft").
- Z is up. X runs left to right, Y runs front to back. The front of the object faces -Y (towards the viewer).
- Stand the object on the ground (z = 0), centred on x = 0, y = 0. A hanging object ("hangs": true) has its top where it hangs from.

THE FILE
{
  "format": "${BUILD_FORMAT}",
  "version": ${BUILD_VERSION},
  "name": "Short name",
  "units": "mm",
  "hangs": false,                      (optional; true for lamps and other things hung from a ceiling)
  "settings": [ … ],                   (optional, see SETTINGS)
  "parts": [
    { "name": "Top", "colour": "oak", "shapes": [ … ], "cuts": [ … ] }
  ]
}

PARTS
- A part is one material: all its shapes are joined into one solid (or several solids apart), then its "cuts" are taken away from it.
- Shapes in one part that should join MUST OVERLAP by at least 1 mm. Shapes that only touch (along a face, an edge or at a corner) stay separate pieces.
- Different parts are kept apart (each becomes its own group). They may touch exactly, or overlap deeply (by more than 3 mm). Do not let one part sink just 1–2 mm into another, or stand just 1–2 mm off another's surface: put a screen, a door or a label exactly on the surface (touching), or set it into a pocket cut in the other part.
- "colour" is one of: ${paintList()}; or any colour as "#rrggbb", with "opacity" from 0.05 to 1 for glass and other see-through things.
- At most ${BUILD_LIMITS.parts} parts and ${BUILD_LIMITS.shapes} shapes (repeats count), about ${BUILD_LIMITS.faces.toLocaleString('en-GB')} faces in all, everything within ${BUILD_LIMITS.size / 1000} m of the centre.

SHAPES (in "shapes" or "cuts")
- { "type": "box", "from": [x, y, z], "to": [x, y, z] }  two opposite corners.
- { "type": "cylinder", "base": [x, y, z], "axis": "z", "radius": r, "length": l, "sides": 24 }  base is the centre of one end; it grows along +axis ("x", "y" or "z").
- { "type": "extrude", "plane": "xy", "at": 0, "outline": [[a, b], …], "depth": d }  a flat outline (3 to ${BUILD_LIMITS.points} points, not crossing itself) pushed out by depth. "xy": points are (x, y) at z = at, pushed up. "xz": points are (x, z) at y = at, pushed back (+y). "yz": points are (y, z) at x = at, pushed right (+x). Best for side profiles: brackets, stands, chair sides, L and U shapes.
- { "type": "taper", "base": [x, y, z], "bottom": [width, depth], "top": [width, depth], "height": h }  a box narrower or wider at the top (a trapezoid or pyramid frustum), centred on base.
- { "type": "lathe", "centre": [x, y, z], "profile": [[radius, height], …], "sides": 24 }  a closed profile turned round a vertical axis: vases, bowls, lamp shades, knobs, round legs. Radius 0 is on the axis. A hollow shape is a profile that goes up the outside and back down the inside.
- { "type": "sphere", "centre": [x, y, z], "radius": r, "sides": 24 }
- "sides" (3 to ${BUILD_LIMITS.sides}) sets how round a curve is; 24 is usual, 8–12 for small things like cords and legs.

ON ANY SHAPE (optional, applied in this order)
- "rotate": { "axis": "z", "degrees": 30, "about": [x, y, z] }  turn it (right-hand rule; "about" defaults to [0, 0, 0]). A list of turns is allowed.
- "move": [dx, dy, dz]  then move it.
- "repeat": { "count": 4, "step": [dx, dy, dz] }  copies in a row, each step further; or { "count": 5, "rotate": { "axis": "z", "degrees": 72, "about": [0, 0, 0] } } copies round a centre.
- "when": "shelf"  the shape is only made when this works out to something other than 0 (use it with toggles and choices).

NUMBERS AND FORMULAS
Any number can be a formula in quotes, using the settings: "width / 2 - 30", "if(shelf, 150, 0)", "max(height - 40, 100)", "sin(angle) * length".
Operators + - * / % ^ ( ) and < > <= >= == != (they give 1 or 0). Functions: min, max, abs, sqrt, round, floor, ceil, if(condition, a, b), sin, cos, tan (degrees), asin, acos, atan, atan2 (giving degrees). The constant pi.

SETTINGS
{ "id": "width", "name": "Width", "kind": "length", "value": 800, "min": 300, "max": 2000, "note": "Optional short help" }
- kind "length" (in the file's units; needs min and max), "angle" (degrees; min and max), "count" (whole number; min and max), "toggle" (1 on or 0 off), "choice" (with "choices": ["Square", "Round"]; the value is the index, 0 for the first).
- Ids are letters, digits and _, starting with a letter. Use 2 to 8 settings for what someone would want to change; keep the rest fixed.
- Choose min and max so that every setting in its range still builds. Formulas must never give a size of 0 or less.

EXAMPLES
${BUILD_EXAMPLES.map((e, i) => `Example ${i + 1}: ${e.title}.\n\`\`\`json\n${JSON.stringify(e.file, null, 1)}\n\`\`\``).join('\n\n')}

IF VORMCRAFT REPORTS PROBLEMS
The person may paste back a list of problems; each says where it is, like "parts[1] (Legs).shapes[0] (box)". Fix them and reply with the whole corrected file.

WHAT TO MAKE
${ask}
`;
}

/** The problems to paste back to the AI. */
export function problemsForAi(problems: readonly string[]): string {
  return `VormCraft could not build the design. Please fix these problems and reply with the whole corrected file:\n${problems.map((p) => `- ${p}`).join('\n')}`;
}
