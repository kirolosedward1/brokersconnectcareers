import { catalogues } from '~/i18n/provider';

// Node's own modules, required as tests/server.ts does: the app's typings have no Node in them.
/* eslint-disable @typescript-eslint/no-require-imports */
const { readdirSync, readFileSync } = require('node:fs') as {
  readdirSync: (dir: string) => string[];
  readFileSync: (path: string, encoding: 'utf8') => string;
};
const { join } = require('node:path') as { join: (...parts: string[]) => string };
/* eslint-enable @typescript-eslint/no-require-imports */
declare const __dirname: string;

/*
  The iOS run (scripts/store-screens.sh, by hand on a Mac runner) finds each
  screen by its Arabic words. A phrase a flow waits for that the catalogue no
  longer says fails that run forty minutes in, long after the change that
  reworded it. So every phrase in maestro/*.yaml is held to the catalogue here:
  a literal must be one of its strings, a pattern must match one whole (Maestro
  matches the whole text). A phrase built from what the live site supplies
  (${JOB_TITLE}) is the site's, and iOS's own question before opening a link
  is the system's.
*/

const FLOWS = join(__dirname, '..', 'maestro');
const SYSTEM = new Set(['فتح|Open']);

function strings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') into.push(value);
  else if (value && typeof value === 'object') for (const child of Object.values(value)) strings(child, into);
  return into;
}

const said = strings(catalogues.ar);

const phrases = readdirSync(FLOWS)
  .filter((name) => name.endsWith('.yaml'))
  .flatMap((name) =>
    [
      ...readFileSync(join(FLOWS, name), 'utf8').matchAll(
        /^\s*-?\s*(?:visible|tapOn|assertVisible|assertNotVisible|element):\s*"(.*)"\s*$/gm,
      ),
    ].map((match) => ({ flow: name, phrase: match[1] })),
  )
  .filter(({ phrase }) => !phrase.includes('${') && !SYSTEM.has(phrase));

describe('the iOS run’s flows', () => {
  it('wait for words, and find some', () => {
    expect(phrases.length).toBeGreaterThan(20);
    expect(phrases.map(({ flow }) => flow)).toEqual(expect.arrayContaining(['checks.yaml', 'signed-out.yaml']));
  });

  it.each(phrases)('$flow: “$phrase” is what the app says', ({ phrase }) => {
    const whole = new RegExp(`^(?:${phrase})$`);
    expect(said.includes(phrase) || said.some((text) => whole.test(text))).toBe(true);
  });
});
