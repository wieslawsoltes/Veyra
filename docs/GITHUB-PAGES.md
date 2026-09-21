# GitHub Pages deployment

Repository: https://github.com/wieslawsoltes/Veyra

Site address: https://wieslawsoltes.github.io/Veyra/

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

`Publish GitHub Pages` runs the Node tests, checks SQLite initialization, builds the `/Veyra/` site, and runs Chromium browser checks before uploading the Pages artifact. It also updates `gh-pages` using a fast-forward push so a ready-to-serve branch is retained. It never publishes server data.

The repository must have Pages enabled. The preferred repository setting is **Settings → Pages → Build and deployment → Source: GitHub Actions**. GitHub Pages enablement is an administration setting; a normal workflow `GITHUB_TOKEN` cannot grant that permission to itself. A deployment permission error must not be mistaken for a successful publication. If branch publishing is selected instead, use **gh-pages / (root)**; a token-generated branch commit may require an authorized branch update to trigger publication.

## Verification

`npm test` includes nested-base-path, output-boundary and static-entrypoint regression tests. `tests/browser-pages.py` checks application boot, real grade output changes, project/media persistence over reload, the local-storage UI, atomic revisions across connections, stale/concurrent conflicts, notes and snapshots, and the absence of backend requests or JavaScript exceptions.

```sh
python3 -m pip install playwright==1.57.0
npm run build:pages
python3 tests/browser-pages.py --screenshot pages-smoke.png
```

The script uses installed Chromium or Google Chrome (`CHROME_BIN` can select an executable). Software-backed headless execution is not a physical-GPU or production-scale qualification. Browser navigation was blocked by the preparation environment's managed browser policy; GitHub-hosted browser check results are the authoritative end-to-end gate.
