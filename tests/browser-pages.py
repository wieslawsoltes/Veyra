#!/usr/bin/env python3
"""Headless Chromium checks for the static Pages build. pip install playwright==1.57.0."""
import argparse
import base64
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=')
parser = argparse.ArgumentParser()
parser.add_argument('--url', default=None, help='Test an already deployed site instead of the local dist-pages build.')
parser.add_argument('--screenshot', default=None)
parser.add_argument('--managed-browser', action='store_true', help='Use the Chromium version installed by Playwright, not a system browser.')
args = parser.parse_args()

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = None
with tempfile.TemporaryDirectory(prefix='veyra-pages-') as temporary:
    if args.url:
        url = args.url
    else:
        (Path(temporary) / 'Veyra').symlink_to(ROOT / 'dist-pages', target_is_directory=True)
        handler = functools.partial(QuietHandler, directory=temporary)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f'http://127.0.0.1:{server.server_address[1]}/Veyra/'
    try:
        with sync_playwright() as p:
            executable = None if args.managed_browser else (os.environ.get('CHROME_BIN') or shutil.which('chromium') or shutil.which('google-chrome'))
            # Match Chromium's VulkanSwiftShader pixel-test backend, including ANGLE.
            browser = p.chromium.launch(executable_path=executable, channel='chromium' if args.managed_browser else None, headless=True,
                args=['--no-sandbox', '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader',
                      '--enable-features=Vulkan,UseSkiaRenderer', '--use-angle=swiftshader',
                      '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader',
                      '--disable-vulkan-surface'])
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            page = context.new_page()
            failures = []
            api_requests = []
            def page_error(error):
                failures.append(str(error))
                print('BROWSER ERROR:', error, flush=True)
            page.on('pageerror', page_error)
            page.on('console', lambda message: print('BROWSER CONSOLE:', message.text, flush=True) if message.type == 'error' else None)
            page.on('request', lambda request: api_requests.append(request.url) if '/api/' in request.url else None)
            page.goto(url, wait_until='networkidle', timeout=60000)
            page.wait_for_function('!!window.veyra', timeout=60000)
            assert page.locator('.pill').inner_text() == 'LOCAL'
            assert page.locator('#save-state').inner_text() == 'Saved in this browser'
            assert page.locator('.asset-thumb').first.evaluate('(image) => image.complete && image.naturalWidth > 0')
            # WebGPU presentation textures are transient. Read the retained render
            # output after its queue completes, rather than a cleared canvas buffer.
            frame_digest = r'''async () => {
                await veyra.render();
                const error = document.getElementById('viewer-error');
                if (!error.hidden) throw new Error(error.textContent);
                const pixels = await veyra.renderer.readPixels();
                if (!pixels.data.some((value, index) => index % 4 === 3 && value > 0)) {
                    throw new Error('Rendered image has no visible pixels');
                }
                return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels.data)),
                    byte => byte.toString(16).padStart(2, '0')).join('');
            }'''
            if args.screenshot:
                page.screenshot(path=args.screenshot, full_page=True)
            print(json.dumps(page.evaluate('({backend: veyra.renderer.backend, adapter: {vendor: veyra.renderer._gpu?.adapter.info.vendor, device: veyra.renderer._gpu?.adapter.info.device, description: veyra.renderer._gpu?.adapter.info.description}, lost: veyra.renderer._lost?.message, error: document.getElementById("viewer-error").textContent})')), flush=True)
            assert page.evaluate('veyra.renderer.backend') == 'WebGPU', 'This gate must exercise WebGPU, not the Canvas fallback'
            before = page.evaluate(frame_digest)
            page.evaluate("veyra.document().setParam('node-grade', 'exposure', 0.75)")
            after = page.evaluate(frame_digest)
            print(json.dumps({'backend': page.locator('#backend-badge').inner_text(),
                'before': before, 'after': after}), flush=True)
            assert after != before, 'Grade must change the actual rendered pixel output'
            assert page.evaluate('veyra.actions.save()') is True
            page.reload(wait_until='networkidle')
            page.wait_for_function('!!window.veyra')
            assert page.evaluate("veyra.project.nodes.find(n => n.id === 'node-grade').params.exposure") == 0.75
            page.locator('#media-input').set_input_files({'name': 'persisted.png', 'mimeType': 'image/png', 'buffer': PNG})
            page.wait_for_function("veyra.project.assets.some(a => a.name === 'persisted.png')")
            page.wait_for_function("document.getElementById('save-state').textContent === 'Saved in this browser'")
            page.reload(wait_until='networkidle')
            page.wait_for_function('!!window.veyra')
            assert page.evaluate("veyra.project.assets.some(a => a.name === 'persisted.png' && a.url.startsWith('blob:'))")
            page.locator('header [data-action="share"]').click()
            assert page.locator('#modal-title').inner_text() == 'Browser-local storage'
            assert 'Nothing is uploaded' in page.locator('#modal-content').inner_text()
            page.locator('[data-action="close-modal"]').click()
            result = page.evaluate(r'''async () => {
                const {BrowserProjectStore} = await import(new URL('app/browser-storage.js', location.href));
                const {createProject} = await import(new URL('packages/core/index.js', location.href));
                const name = 'veyra-qa-' + crypto.randomUUID();
                const first = new BrowserProjectStore({name}), second = new BrowserProjectStore({name});
                const checks = [];
                const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
                const call = (store, route, method, body) => store.call(route, {method, body: JSON.stringify(body)});
                const rejects = async (fn, status, label) => {
                    try { await fn(); throw new Error('Expected rejection: ' + label); }
                    catch (error) { check(error.status === status, label); }
                };
                try {
                    check((await first.call('session')).mode === 'browser', 'Local storage mode is explicit');
                    check((await first.call('projects')).projects.length === 0, 'Empty browser database');
                    const project = await call(first, 'projects', 'POST', {state: createProject({demo: false})});
                    const route = 'projects/' + project.id;
                    check(project.revision === 1, 'Create project and initial revision');
                    check((await second.call('projects')).projects.length === 1, 'Second connection reads persisted project');
                    let state = (await second.call(route)).state;
                    state.name = 'Revision two';
                    const update = await call(first, route, 'PUT', {state, revision: 1});
                    check(update.revision === 2, 'Atomic revision increment');
                    await rejects(() => call(second, route, 'PUT', {state, revision: 1}), 409, 'Stale write is rejected');
                    check((await first.call(route)).state.name === 'Revision two', 'Stale write preserves the winner');
                    const concurrent = await Promise.allSettled([
                        call(first, route, 'PUT', {state, revision: 2}),
                        call(second, route, 'PUT', {state, revision: 2})]);
                    check(concurrent.filter(r => r.status === 'fulfilled').length === 1, 'Exactly one concurrent revision wins');
                    check(concurrent.find(r => r.status === 'rejected').reason.status === 409, 'Concurrent loser receives conflict');
                    const bytes = new Uint8Array([0, 1, 2, 3, 255]);
                    const asset = await first.call(route + '/assets', {method: 'POST', headers: {'X-File-Name': 'persist.bin'}, body: new Blob([bytes], {type: 'image/png'})});
                    state = (await first.call(route)).state;
                    state.assets.push(asset);
                    await call(first, route, 'PUT', {state, revision: 3});
                    const originalURL = asset.url;
                    await first.dispose();
                    const reopened = await second.call(route);
                    const restored = reopened.state.assets.find(a => a.id === asset.id);
                    check(restored.url.startsWith('blob:') && restored.url !== originalURL, 'Media URLs are recreated after connection disposal');
                    check([...new Uint8Array(await (await fetch(restored.url)).arrayBuffer())].join() === [...bytes].join(), 'Imported media bytes survive reopen');
                    const version = await call(second, route + '/versions', 'POST', {label: 'Approved comp'});
                    check((await second.call(route + '/versions')).versions.length === 2, 'Named snapshots persist');
                    check((await second.call(route + '/versions/' + version.id)).state.assets[0].url === restored.url, 'Snapshot media is hydrated');
                    const note = await call(second, route + '/comments', 'POST', {body: 'Review at frame 5', frame: 5, drawing: []});
                    check((await second.call(route + '/comments')).comments[0].body === 'Review at frame 5', 'Review note persists');
                    await call(second, route + '/comments/' + note.id, 'PATCH', {resolved: true});
                    check((await second.call(route + '/comments')).comments[0].resolved === 1, 'Review note resolves');
                    await call(second, route + '/comments/' + note.id, 'DELETE');
                    check((await second.call(route + '/comments')).comments.length === 0, 'Review note deletes');
                    await rejects(() => call(second, route + '/invite', 'POST', {role: 'editor'}), 501, 'No fake collaboration invitations');
                    await rejects(() => second.call('projects/missing'), 404, 'Missing local projects report clearly');
                    await rejects(() => new BrowserProjectStore({indexedDB: null}).call('session'), 503, 'Unavailable IndexedDB reports clearly');
                    await rejects(() => call(second, route + '/comments', 'POST', {body: 'Invalid frame', frame: -1}), 400, 'Invalid review frame rejected');
                    check((await call(second, route + '/presence', 'POST', {frame: 0})).presence.length === 0, 'No simulated remote collaborators');
                    await call(second, route, 'DELETE');
                    check((await second.call('projects')).projects.length === 0, 'Project deletion persists');
                    return checks;
                } finally {
                    await first.dispose(); await second.dispose();
                    await new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = resolve; r.onerror = () => reject(r.error); });
                }
            }''')
            assert not failures, failures
            assert not api_requests, api_requests
            if args.screenshot:
                page.screenshot(path=args.screenshot, full_page=True)
            print(json.dumps({'status': 'passed', 'backend': page.locator('#backend-badge').inner_text(),
                'storage_checks': result, 'ui_checks': ['Boot at project base path', 'Demo plate loads', 'Grade changes rendered pixels',
                'Project edits survive reload', 'Imported media survives reload', 'Honest local storage dialog', 'No JavaScript exceptions', 'No backend API requests']}, indent=2))
            context.close()
            browser.close()
    finally:
        if server:
            server.shutdown()
