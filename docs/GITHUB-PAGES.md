# GitHub Pages deployment

Repository: https://github.com/wieslawsoltes/Veyra

GitHub Pages address: https://wieslawsoltes.github.io/Veyra/

## Two deployment modes

The GitHub Pages build serves the same plain-JavaScript compositor, editorial workspace and modular controls without a server. A build-time metadata flag selects an IndexedDB adapter. The standalone Node server and the existing hosted API continue to use SQLite/object storage and retain their original collaboration implementation.

The static build is not a cloud collaboration service. On GitHub Pages, projects, imported media, named versions and review notes stay in the current browser profile on this origin. Other tabs can open the same local project; compare-and-swap revisions prevent silent overwrites. There are no simulated remote users, working invitations, cloud accounts or server-backed permissions in this mode. The storage dialog explains this distinction.

Project JSON exports do not embed media. Keep the original media files alongside exported project backups. Clearing browser site data removes the IndexedDB projects and media, and a project URL does not transfer data to another person or device. Browser quota and private-browsing policies can prevent storage. Failures are surfaced instead of reported as successful saves. Unreferenced media is retained rather than destructively garbage-collected; browser site-data controls can remove it after backups.

## Build and run

The Pages build does not need npm packages or a framework build:

```sh
node scripts/build-pages.mjs /Veyra/
```

This creates `dist-pages/`, including `index.html`, `.nojekyll`, scoped asset URLs and `deployment.json`. Only the `public/` tree is published; server code, database files, development configuration and hosted-site authentication are not copied into the website.

To preview at a local server root instead:

```sh
node scripts/build-pages.mjs /
python3 -m http.server 8080 --directory dist-pages
```

For the original local SQLite/server mode:

```sh
node standalone/server.mjs
```

## Continuous delivery

`Publish GitHub Pages` runs the Node tests, checks SQLite initialization, builds the `/Veyra/` site, and runs Chromium browser checks before uploading the Pages artifact. It uploads the built artifact directly to Pages. No `gh-pages` branch or repository-content write permission is needed by the workflow. Only the deployment job receives `pages: write` and `id-token: write`; it never publishes server data.

The repository must have Pages enabled. The preferred repository setting is **Settings → Pages → Build and deployment → Source: GitHub Actions**. GitHub Pages enablement is an administration setting; a normal workflow `GITHUB_TOKEN` cannot grant that permission to itself. A deployment permission error must not be mistaken for a successful publication. Select **GitHub Actions**, not branch publishing, for the included artifact-based workflow. The old partial `gh-pages` branch is not used or modified.

## Verification

`npm test` includes nested-base-path, output-boundary and static-entrypoint regression tests. `tests/browser-pages.py` checks application boot, real grade output changes, project/media persistence over reload, the local-storage UI, atomic revisions across connections, stale/concurrent conflicts, notes and snapshots, and the absence of backend requests or JavaScript exceptions.

```sh
python3 -m pip install playwright==1.57.0
python3 -m playwright install --with-deps chromium
npm run build:pages
python3 tests/browser-pages.py --managed-browser --screenshot pages-smoke.png
```

CI installs the Chromium revision matching the pinned Playwright package and uses `--managed-browser`. Without that flag, the script can use installed Chromium or Google Chrome (`CHROME_BIN` can select an executable). Software-backed headless execution is not a physical-GPU or production-scale qualification. Browser navigation was blocked by the preparation environment's managed browser policy; GitHub-hosted browser check results are the authoritative end-to-end gate.


## Publish the recovered complete source

The included publisher is intended for this recovered archive and the existing
`wieslawsoltes/Veyra` repository. The original preparation environment could not publish it. On September 21, 2026,
the complete source archive was verified and committed through GitHub Actions.
The CLI publisher remains available for authenticated development machines;
its end-to-end CLI path is separate from the connector-based publication.

Run on macOS, Linux or WSL with Git, Node.js 22.13+ and an authenticated GitHub CLI:

```sh
# First-time CLI authentication; do not paste access tokens into chat.
gh auth login --hostname github.com --git-protocol https --scopes repo,workflow

# Run from the root of the extracted complete source archive.
node scripts/publish-github.mjs
```

This verifies every source file against `release/source-manifest.json`, clones the
real repository, verifies that its `main` branch still matches the recorded base
(or already contains exactly the same imported source), and commits the complete
source on top of that remote history. It removes only the obsolete partial
`.source-import` files and `.github/workflows/import-archive.yml`. Unrelated files
are retained. A newer, different remote revision stops the import; no force push
or history rewrite is used.

The publisher runs the Node tests and static build, switches Pages to GitHub
Actions when necessary, pushes `main`, watches the actual Pages workflow, and
checks the live `deployment.json` commit after the workflow succeeds. A failed
browser gate, insufficient permissions, protected branch, missing workflow, or
mismatched live commit exits unsuccessfully. The cloned working copy and local
commit are retained on failure. It does not claim that an unverified deployment
is live.

The authenticated account needs repository-content and workflow write access,
Actions read/dispatch access, and permission to manage Pages. Pages settings
changes require the permissions documented by GitHub; the script does not grant
itself access or store tokens. Its Git credential helper is scoped to each Git
invocation rather than modifying global Git configuration.

To verify the archive locally without GitHub or changing remote data:

```sh
node scripts/publish-github.mjs --check
```

The separately supplied Git bundle preserves two local source commits. It is a
recovery snapshot, **not a replacement for the existing remote history**. Use the
publisher above instead of force-pushing the bundle's `main` branch.

Official references:
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub Pages REST API](https://docs.github.com/en/rest/pages/pages)
- [GitHub CLI authentication](https://cli.github.com/manual/gh_auth_login)

## Live publication verification

The Pages workflow requires browser checks before deployment, then checks the
live deployment.json commit and reruns the browser suite against the public URL.
Use the latest successful Publish GitHub Pages run as the publication record.
A URL alone or a successful source import is not a deployment verification.
