const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow } = require('electron');

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
  await waitFor(win, "document.querySelectorAll('#navbar li[data-tab]').length === 7");
  assert.equal(win.webContents.getLastWebPreferences().sandbox, true);
  assert.equal(win.webContents.getLastWebPreferences().contextIsolation, true);
  assert.equal(win.webContents.getLastWebPreferences().nodeIntegration, false);
  assert.equal(await win.webContents.executeJavaScript('typeof require'), 'undefined');
  assert.equal(
    await win.webContents.executeJavaScript('document.title'),
    "Don't Starve Food Guide",
  );

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
    `Electron smoke passed: ${manifest} sprites, mushroom search, keyboard recipes, mouse ingredient entry, saved theme/language, sandbox, blocked popup.`,
  );
}

void main()
  .then(() => app.quit())
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
