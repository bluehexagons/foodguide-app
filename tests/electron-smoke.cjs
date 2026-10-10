const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, Menu } = require('electron');

assert(process.env.FOODGUIDE_TEST_PROFILE, 'Run this test with npm run test:electron');
app.setPath('userData', process.env.FOODGUIDE_TEST_PROFILE);
const created = once(app, 'browser-window-created');
require('../dist/index.cjs');

async function waitFor(win, expression) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(expression)) {
      return;
    }
    await delay(50);
  }
  assert.fail(`Timed out waiting for ${expression}`);
}

async function clickElement(win, selector) {
  const position = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing mouse target');
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error('Mouse target is not visible');
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...position });
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...position });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...position });
}

async function main() {
  const [, win] = await created;
  await once(win.webContents, 'did-finish-load');
  await waitFor(win, "document.querySelectorAll('#navbar [role=tab]').length === 7");
  assert.equal(win.webContents.getLastWebPreferences().sandbox, true);
  assert.equal(win.webContents.getLastWebPreferences().contextIsolation, true);
  assert.equal(win.webContents.getLastWebPreferences().nodeIntegration, false);
  assert.equal(await win.webContents.executeJavaScript('typeof require'), 'undefined');
  assert.equal(
    await win.webContents.executeJavaScript('document.title'),
    "Don't Starve Food Guide",
  );

  const menu = Menu.getApplicationMenu();
  assert(menu);
  // Page load can precede showing/OS focus; native menu shortcuts need a focused window.
  if (!win.isVisible()) {
    await once(win, 'ready-to-show');
  }
  win.focus();
  win.webContents.focus();
  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  }
  await waitFor(win, 'document.hasFocus()');
  const originalScale = await win.webContents.executeJavaScript('devicePixelRatio');
  const modifier = process.platform === 'darwin' ? 'meta' : 'control';
  for (const type of ['keyDown', 'keyUp']) {
    win.webContents.sendInputEvent({ type, keyCode: '-', modifiers: [modifier] });
  }
  await waitFor(win, `devicePixelRatio < ${originalScale}`);
  assert(win.webContents.getZoomFactor() < 1);
  for (const type of ['keyDown', 'keyUp']) {
    win.webContents.sendInputEvent({ type, keyCode: '0', modifiers: [modifier] });
  }
  await waitFor(win, `Math.abs(devicePixelRatio - ${originalScale}) < 0.01`);
  assert.equal(win.webContents.getZoomFactor(), 1);
  menu.getMenuItemById('zoom-in').click(undefined, win, win.webContents);
  await waitFor(win, `devicePixelRatio > ${originalScale}`);
  assert(win.webContents.getZoomFactor() > 1);
  menu.getMenuItemById('reset-zoom').click(undefined, win, win.webContents);
  await waitFor(win, `Math.abs(devicePixelRatio - ${originalScale}) < 0.01`);

  const manifest = await win.webContents.executeJavaScript(`(async () => {
    const response = await fetch('img/sprites/sprites.json');
    if (!response.ok) throw new Error('Missing sprite manifest');
    const manifest = await response.json();
    for (const sheet of manifest.sheets) {
      const image = new Image();
      image.src = sheet;
      await image.decode();
    }
    return Object.keys(manifest.images).length;
  })()`);
  assert(manifest >= 300);

  const mushrooms = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#simulator .ingredientpicker');
    input.value = 'mushroom';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return Array.from(document.querySelectorAll('#simulator [role="option"]'),
      element => element.getAttribute('aria-label'));
  })()`);
  for (const name of ['Red Cap', 'Green Cap', 'Blue Cap']) {
    assert(mushrooms.includes(name), `Mushroom search is missing ${name}`);
  }

  for (const ingredient of ['Meat', 'Berries', 'Berries', 'Berries']) {
    await win.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('#simulator .ingredientpicker');
      input.focus();
      input.value = ${JSON.stringify(ingredient)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
    await waitFor(
      win,
      `document.querySelector('#simulator [role="option"][aria-selected="true"]')?.getAttribute('aria-label') === ${JSON.stringify(ingredient)}`,
    );
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await delay(50);
  }
  await waitFor(win, "document.querySelectorAll('#ingredients .icon').length === 4");
  await waitFor(
    win,
    "Array.from(document.querySelectorAll('#results a')).some(a => a.textContent === 'Meatballs')",
  );
  await waitFor(
    win,
    "document.querySelector('#ingredients .icon').style.backgroundImage.includes('sprites/sheet-0.png')",
  );

  const warnings = [];
  const recordWarning = details => {
    if (['warning', 'error'].includes(details.level)) {
      warnings.push(details.message);
    }
  };
  win.webContents.on('console-message', recordWarning);
  await clickElement(win, '#ingredients .ingredient:nth-child(4) .icon');
  await waitFor(win, "document.querySelectorAll('#ingredients .icon').length === 3");
  await clickElement(win, '#simulator [role="option"][aria-label="Berries"] .text');
  await waitFor(win, "document.querySelectorAll('#ingredients .icon').length === 4");
  win.webContents.removeListener('console-message', recordWarning);
  assert.deepEqual(warnings, []);

  const healthHeader = '#results table th[data-sort="health"]';
  await clickElement(win, `${healthHeader} button`);
  await waitFor(
    win,
    `document.querySelector(${JSON.stringify(healthHeader)})?.getAttribute('aria-sort') === 'descending'`,
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      `document.activeElement === document.querySelector(${JSON.stringify(`${healthHeader} button`)})`,
    ),
    true,
  );

  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  await waitFor(
    win,
    `document.querySelector(${JSON.stringify(healthHeader)})?.getAttribute('aria-sort') === 'ascending'`,
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      `document.activeElement === document.querySelector(${JSON.stringify(`${healthHeader} button`)})`,
    ),
    true,
  );

  await clickElement(win, '#navbar [data-tab=simulator]');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
  await waitFor(
    win,
    "document.activeElement?.dataset.tab === 'discovery' && document.querySelector('#tab-discovery').getAttribute('aria-selected') === 'true'",
  );
  assert.equal(
    await win.webContents.executeJavaScript("document.querySelector('#simulator').hidden"),
    true,
  );
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' });
  await waitFor(win, "document.activeElement?.dataset.tab === 'simulator'");
  await win.webContents.executeJavaScript(
    "document.querySelector('#ingredients .ingredient:nth-child(4)').focus()",
  );
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  await waitFor(win, "document.querySelectorAll('#ingredients [data-id]').length === 3");
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.activeElement === document.querySelector('#ingredients .ingredient:nth-child(4)')",
    ),
    true,
  );
  assert.equal(
    await win.webContents.executeJavaScript("document.activeElement.getAttribute('aria-label')"),
    'Add an ingredient',
  );
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  // Native button Enter activation uses keypress, emitted by Electron's char event.
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await waitFor(
    win,
    "document.activeElement === document.querySelector('#simulator .ingredientpicker')",
  );
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await waitFor(
    win,
    "document.querySelector('#simulator .ingredientdropdown').hidden && document.activeElement.getAttribute('aria-expanded') === 'false'",
  );
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await waitFor(win, "document.querySelectorAll('#ingredients [data-id]').length === 4");
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.querySelector('#simulator [role=status]').textContent",
    ),
    'Added Berries.',
  );

  await win.webContents.executeJavaScript(`(() => {
    document.querySelector('#theme-toggle').click();
    const select = document.querySelector('#language-picker');
    select.value = 'es';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const theme = await win.webContents.executeJavaScript(
    "document.documentElement.getAttribute('data-theme')",
  );
  assert.equal(await win.webContents.executeJavaScript('document.documentElement.lang'), 'es');
  const reloaded = once(win.webContents, 'did-finish-load');
  win.webContents.reload();
  await reloaded;
  await waitFor(
    win,
    "document.querySelector('[data-i18n=tabSimulator]')?.textContent === 'Simulador'",
  );
  assert.equal(
    await win.webContents.executeJavaScript("document.documentElement.getAttribute('data-theme')"),
    theme,
  );
  await win.webContents.executeJavaScript("window.open('file:///unrelated-file.htm')");
  await delay(100);
  assert.equal(BrowserWindow.getAllWindows().length, 1);

  const output = path.join(__dirname, '../out/test-results');
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, 'electron-smoke.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  console.log(
    `Electron smoke passed: ${manifest} sprites, native zoom menus and shortcuts, mushroom search, keyboard recipes, ingredient removal, picker dismissal, tab navigation, mouse ingredient entry, keyboard table sorting and focus, saved theme/language, sandbox, blocked popup.`,
  );
}

void main()
  .then(() => app.quit())
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
