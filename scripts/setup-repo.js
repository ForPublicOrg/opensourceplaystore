#!/usr/bin/env node
/*
 * One-time GitHub configuration for unattended publishing.
 *
 * The rule that "only new app listings merge on their own" lives in
 * .github/workflows/auto-merge.yml — this script just turns on the repo
 * settings that workflow relies on, so nobody has to click through Settings.
 *
 * Usage:
 *   node scripts/setup-repo.js            # show what would change
 *   node scripts/setup-repo.js --apply    # actually change it
 *   node scripts/setup-repo.js --apply --pages
 *                                         # ...and say the site is on GitHub Pages
 *
 * Needs the GitHub CLI (https://cli.github.com), logged in as someone with
 * admin rights on the repo: gh auth login
 */
'use strict';

const { execFileSync } = require('child_process');

const apply = process.argv.includes('--apply');
const pages = process.argv.includes('--pages');

function gh(args, { quiet = false } = {}) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'pipe'] });
  } catch (e) {
    const detail = (e.stderr || e.message || '').trim();
    throw new Error(`gh ${args.join(' ')}\n    ${detail}`);
  }
}

function repoSlug() {
  try {
    return JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
  } catch (e) {
    console.error('Could not work out which repo this is. Is the GitHub CLI installed and logged in?');
    console.error(`  ${e.message}`);
    process.exit(1);
  }
}

const steps = (repo) => [
  {
    what: 'Allow auto-merge, squash merges, and deleting the branch afterwards',
    why: 'auto-merge.yml falls back to GitHub\'s own auto-merge when checks are still running',
    run: () => gh([
      'api', '-X', 'PATCH', `repos/${repo}`,
      '-F', 'allow_auto_merge=true',
      '-F', 'allow_squash_merge=true',
      '-F', 'delete_branch_on_merge=true',
    ], { quiet: true }),
  },
  {
    what: 'Create the "needs-review" label',
    why: 'the workflow puts it on any pull request it will not merge by itself',
    run: () => gh([
      'label', 'create', 'needs-review', '--color', 'FBCA04',
      '--description', 'Waiting for a maintainer', '--force',
    ], { quiet: true }),
  },
  ...(pages ? [{
    what: 'Set the PAGES_DEPLOY variable to true',
    why: 'merges made by the Actions bot do not trigger push workflows, so Pages needs an explicit deploy',
    run: () => gh(['variable', 'set', 'PAGES_DEPLOY', '--body', 'true'], { quiet: true }),
  }] : []),
];

function main() {
  const repo = repoSlug();
  console.log(`Repo: ${repo}\n`);

  for (const step of steps(repo)) {
    if (!apply) {
      console.log(`would: ${step.what}\n       (${step.why})`);
      continue;
    }
    try {
      step.run();
      console.log(`✓ ${step.what}`);
    } catch (e) {
      console.error(`✗ ${step.what}\n    ${e.message}`);
      process.exitCode = 1;
    }
  }

  if (!apply) {
    console.log('\nNothing changed — re-run with --apply to make it so.');
    return;
  }

  console.log(`
Done. Publishing now runs itself:

  a pull request that only adds data/apps/<id>.json  ->  checked and merged automatically
  anything else                                      ->  labelled needs-review, left for you

Leave branch protection off on main, or add it only with a bypass for GitHub
Actions: the 6-hourly sync bot pushes data/live.json straight to main, and a
"require a pull request" rule would block it.`);
}

main();
