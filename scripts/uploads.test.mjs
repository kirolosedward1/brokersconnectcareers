/**
 * What the browser decides about a file before it uploads it, and whether the
 * path it builds is one the server will accept.
 *
 *   pnpm test:uploads
 *
 * Three uploaders (the apply form's CV, the consultant profile's CV, the
 * company's verification papers) do the same three things in the browser:
 * name the file's type (file-type.ts), mint a key (uuid.ts), and write to
 * `<owner>/<key>.<ext>`. The server actions then refuse any path that
 * isOwnStoragePath (storage-path.ts) does not call the owner's own. Each half
 * is small, and the two were only ever checked against each other by a person
 * applying for a job: a change to either that made them disagree would refuse
 * every CV, with nothing failing until somebody tried.
 */
import { fileType, fileExtension } from '../src/lib/file-type.ts';
import { uuid } from '../src/lib/uuid.ts';
import { isOwnStoragePath } from '../src/lib/storage-path.ts';

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// The types the CV uploaders accept (apply-form.tsx, agent-profile-form.tsx).
const CV_TYPES = [PDF, 'application/msword', DOCX];
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

console.log('\n— what a file is');
{
  check('the browser\'s answer is trusted when it gives one', fileType({ name: 'cv.pdf', type: PDF }) === PDF);
  check(
    'even when the name says otherwise — the bucket, not the name, decides',
    fileType({ name: 'cv.docx', type: PDF }) === PDF,
  );
  check('the reported type is read case-insensitively', fileType({ name: 'x', type: 'Application/PDF' }) === PDF);

  // Windows without Office: no MIME type registered for .docx.
  check('no type: the extension decides', fileType({ name: 'سيرة ذاتية.docx', type: '' }) === DOCX);
  // Some Android file providers answer every pick with this.
  check(
    'octet-stream is no answer either',
    fileType({ name: 'CV.PDF', type: 'application/octet-stream' }) === PDF,
  );
  check('an upper-case extension is still an extension', fileType({ name: 'SCAN.JPEG', type: '' }) === 'image/jpeg');

  for (const [alias, canonical] of [
    ['image/jpg', 'image/jpeg'],
    ['image/pjpeg', 'image/jpeg'],
    ['image/x-png', 'image/png'],
  ]) {
    check(`${alias} is named as the buckets know it, ${canonical}`, fileType({ name: 'x', type: alias }) === canonical);
  }

  // It names a file the browser failed to; it never makes one acceptable.
  check(
    'an unknown extension with no type stays unnamed',
    fileType({ name: 'payload.exe', type: '' }) === '',
  );
  check(
    'an unknown extension behind octet-stream stays octet-stream, which no list accepts',
    fileType({ name: 'payload.html', type: 'application/octet-stream' }) === 'application/octet-stream',
  );
  check('a name with no dot is not read as an extension', fileType({ name: 'pdf', type: '' }) === '');
  check(
    'a reported type is not overridden by a friendlier extension',
    fileType({ name: 'cv.pdf', type: 'text/html' }) === 'text/html',
  );
  check('so an HTML file named .pdf is refused by the CV check', !CV_TYPES.includes(fileType({ name: 'cv.pdf', type: 'text/html' })));
}

console.log('\n— the extension it is stored under');
{
  check('from the type, not the name', fileExtension({ name: 'cv.PDF', type: PDF }, 'bin') === 'pdf');
  check('jpeg is stored as jpg', fileExtension({ name: 'a.jpeg', type: 'image/jpeg' }, 'bin') === 'jpg');
  // An Android content provider's name for a picked image.
  check(
    'a name with no extension still gets the right one',
    fileExtension({ name: 'image:1000012345', type: 'image/png' }, 'bin') === 'png',
  );
  check(
    'a name built to escape the folder contributes nothing',
    fileExtension({ name: 'cv.pdf/../../other/x', type: PDF }, 'bin') === 'pdf',
  );
  check('an unknown type falls back', fileExtension({ name: 'x.exe', type: '' }, 'pdf') === 'pdf');
}

console.log('\n— the key');
{
  const original = globalThis.crypto;
  const swap = (value) => Object.defineProperty(globalThis, 'crypto', { value, configurable: true, writable: true });

  try {
    const native = uuid();
    check('crypto.randomUUID is used where it exists', V4.test(native), native);

    // An in-app browser on an older WebView: getRandomValues, no randomUUID.
    swap({ getRandomValues: (bytes) => original.getRandomValues(bytes) });
    const fallback = Array.from({ length: 200 }, () => uuid());
    check('without randomUUID, still a well-formed v4', fallback.every((id) => V4.test(id)), fallback.find((id) => !V4.test(id)));
    check('and 200 of them are 200 different keys', new Set(fallback).size === 200);

    // Neither: the last resort, still well-formed.
    swap(undefined);
    const last = Array.from({ length: 50 }, () => uuid());
    check('with no crypto at all, still a well-formed v4', last.every((id) => V4.test(id)), last.find((id) => !V4.test(id)));
    check('and still distinct', new Set(last).size === 50);
  } finally {
    swap(original);
  }
}

console.log('\n— the path the browser builds is one the server accepts');
{
  const owner = uuid();
  const someoneElse = uuid();
  const picks = [
    { name: 'cv.pdf', type: PDF },
    { name: 'CV.DOCX', type: '' },
    { name: 'resume.doc', type: 'application/octet-stream' },
    { name: 'document:4411', type: DOCX },
    { name: 'سيرتي الذاتية.pdf', type: PDF },
  ];
  for (const file of picks) {
    // As apply-form.tsx and agent-profile-form.tsx build it.
    const path = `${owner}/${uuid()}.${fileExtension(file, 'pdf')}`;
    check(`${JSON.stringify(file.name)} → an accepted CV and its owner's own path`,
      CV_TYPES.includes(fileType(file)) && isOwnStoragePath(owner, path), path);
    check(`and not anybody else's`, !isOwnStoragePath(someoneElse, path));
  }

  // As verification-panel.tsx builds it: the document kind before the key.
  const papers = `${owner}/commercial_register-${uuid()}.${fileExtension({ name: 'scan.jpg', type: '' }, 'pdf')}`;
  check('a verification document\'s path is the company\'s own', isOwnStoragePath(owner, papers), papers);

  for (const forged of [
    `${owner}/../${someoneElse}/cv.pdf`,
    `${owner}/${someoneElse}/cv.pdf`,
    `${owner}/.hidden.pdf`,
    `${owner}/`,
    `/${owner}/cv.pdf`,
    `${someoneElse}/cv.pdf`,
  ]) {
    check(`a forged path is refused: ${forged.replaceAll(owner, '<me>').replaceAll(someoneElse, '<them>')}`,
      !isOwnStoragePath(owner, forged));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
