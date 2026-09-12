import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skill = join(root, 'security-regression-guard');
const read = (path) => readFileSync(path, 'utf8');

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? ['.git', 'node_modules'].includes(entry.name)
        ? []
        : files(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}

function localMarkdownTargets(file) {
  return [...read(file).matchAll(/\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !/^(https?:|mailto:|#)/.test(target));
}

test('the installable skill remains self-contained when copied on its own', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'security-skill-test-'));

  try {
    const copy = join(temporary, 'security-regression-guard');
    cpSync(skill, copy, { recursive: true });

    for (const file of files(copy)) {
      assert.ok(!read(file).includes('file:///'), file);

      for (const target of localMarkdownTargets(file)) {
        const path = resolve(dirname(file), target.split('#')[0]);
        const destination = relative(copy, path);
        assert.ok(
          destination !== '..' && !destination.startsWith(`..${sep}`),
          `${file}: local link escapes the installable folder: ${target}`,
        );
        assert.ok(existsSync(path), `${file}: missing local target: ${target}`);
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('repository Markdown links resolve to existing local files', () => {
  for (const file of files(root).filter((path) => path.endsWith('.md'))) {
    for (const target of localMarkdownTargets(file)) {
      const path = resolve(dirname(file), target.split('#')[0]);
      assert.ok(existsSync(path), `${file}: missing local target: ${target}`);
    }
  }
});

test('README files contain no emoji or decorative emoji symbols', () => {
  const emoji = /[🀀-🫿☀-➿]/u;

  for (const name of ['README.md', 'README.en.md']) {
    assert.doesNotMatch(read(join(root, name)), emoji, name);
  }
});

test('localized README banners are present and accessible', () => {
  for (const [readme, banner] of [
    ['README.md', 'assets/banner.svg'],
    ['README.en.md', 'assets/banner.en.svg'],
  ]) {
    assert.ok(read(join(root, readme)).includes(`src="${banner}"`), readme);

    const svg = read(join(root, banner));
    assert.match(svg, /^<svg /);
    assert.match(svg, /role="img"/);
    assert.match(svg, /<title /);
    assert.match(svg, /<desc /);
  }
});

test('repository governance files and contribution templates are present', () => {
  for (const path of [
    'CONTRIBUTING.md',
    'SECURITY.md',
    'PUBLICAR.md',
    '.github/pull_request_template.md',
    '.github/ISSUE_TEMPLATE/bug_report.md',
    '.github/ISSUE_TEMPLATE/proposal.md',
    '.github/ISSUE_TEMPLATE/config.yml',
  ]) {
    assert.ok(existsSync(join(root, path)), path);
  }
});

test('the canonical and standalone instruction copies are identical', () => {
  assert.equal(
    read(join(skill, 'SKILL.md')),
    read(join(root, 'skillSecurity.md')),
  );
});

test('release version, skill name, license and description are valid', () => {
  const source = read(join(skill, 'SKILL.md'));
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1];

  assert.ok(frontmatter, 'SKILL.md requires YAML frontmatter');
  assert.match(frontmatter, /^name: security-regression-guard$/m);
  assert.match(frontmatter, /^license: CC-BY-NC-4\.0$/m);

  const description = frontmatter.match(/^description: (.+)$/m)?.[1];
  assert.ok(description && description.length <= 1024, 'description must be present and concise');
  assert.equal(
    frontmatter.match(/^\s*version: "([^"]+)"$/m)?.[1],
    read(join(root, 'VERSION')).trim(),
  );
});

test('Markdown documents have balanced fenced code blocks', () => {
  for (const file of files(root).filter((path) => path.endsWith('.md'))) {
    const fences = read(file).match(/^```/gm)?.length ?? 0;
    assert.equal(fences % 2, 0, `${file}: unbalanced fenced code block`);
  }
});
