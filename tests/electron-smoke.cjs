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
  const focus = await win.webContents.executeJavaScript(`({
    hasFocus: document.hasFocus(),
    activeElement: document.activeElement?.outerHTML.slice(0, 400),
    width: innerWidth,
    scrollKeys: window.scrollKeyEvents,
    scrollRegions: [...document.querySelectorAll('.table-scroll-wrapper[tabindex="0"]')].map(region => ({
      label: region.getAttribute('aria-label'),
      left: region.scrollLeft,
      width: region.clientWidth,
      contentWidth: region.scrollWidth,
    })),
    sortedHeaders: [...document.querySelectorAll('th[aria-sort]')].map(header => ({
      key: header.dataset.sort,
      direction: header.getAttribute('aria-sort'),
    })),
  })`);
  assert.fail(
    `Timed out waiting for ${expression}\n${JSON.stringify({
      windowFocused: win.isFocused(),
      contentsFocused: win.webContents.isFocused(),
      ...focus,
    })}`,
  );
}

async function clickElement(win, selector) {
  const position = await win.webContents
    .executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing mouse target');
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error('Mouse target is not visible');
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`)
    .catch(error => {
      throw new Error(`Unable to click ${selector}`, { cause: error });
    });
  // DOM rectangles use CSS pixels; Electron input uses window coordinates before page zoom.
  const zoom = win.webContents.getZoomFactor();
  const inputPosition = { x: Math.round(position.x * zoom), y: Math.round(position.y * zoom) };
  win.webContents.sendInputEvent({ type: 'mouseMove', ...inputPosition });
  win.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    ...inputPosition,
  });
  win.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    ...inputPosition,
  });
}

async function main() {
  const [, win] = await created;
  win.webContents.on('console-message', details => {
    if (details.level === 'error') {
      console.error(`Renderer error: ${details.message}`);
    }
  });
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
  const zoomCommand = (id, keyCode) => {
    const item = menu.getMenuItemById(id);
    assert(item);
    if (process.platform === 'darwin') {
      // Cocoa dispatches app-menu shortcuts; renderer input injection bypasses that path.
      assert.equal(item.accelerator, `CommandOrControl+${keyCode}`);
      item.click(undefined, win, win.webContents);
    } else {
      for (const type of ['keyDown', 'keyUp']) {
        win.webContents.sendInputEvent({ type, keyCode, modifiers: ['control'] });
      }
    }
  };
  zoomCommand('zoom-out', '-');
  await waitFor(win, `devicePixelRatio < ${originalScale}`);
  assert(win.webContents.getZoomFactor() < 1);
  zoomCommand('reset-zoom', '0');
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

  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#simulator .ingredientpicker');
    input.focus();
    input.value = 'zzzznomatches';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(
    win,
    "document.querySelector('#simulator [role=status]').textContent === 'No matching ingredients. Try another search or game selection.'",
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.querySelectorAll('#simulator [role=option]').length",
    ),
    0,
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.querySelector('#simulator .ingredient-search-summary').hidden",
    ),
    false,
  );

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
      `document.querySelector('#simulator [role="option"][aria-selected="true"] .text')?.textContent === ${JSON.stringify(ingredient)}`,
    );
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await delay(50);
  }
  await waitFor(win, "document.querySelectorAll('#ingredients .icon').length === 4");
  assert.deepEqual(
    await win.webContents.executeJavaScript(`(() => {
      const berries = document.querySelector('#simulator [role=option][aria-label="Berries 3"]');
      return {
        picked: berries.classList.contains('faded'),
        count: berries.querySelector('.ingredient-picked-marker').textContent,
        description: berries.getAttribute('aria-description'),
        name: berries.getAttribute('aria-label'),
      };
    })()`),
    { picked: true, count: '3', description: 'In the pot: 3.', name: 'Berries 3' },
  );
  await waitFor(
    win,
    "Array.from(document.querySelectorAll('#results a')).some(a => a.textContent === 'Meatballs')",
  );
  await waitFor(
    win,
    "document.querySelector('#ingredients .icon').style.backgroundImage.includes('sprites/sheet-0.png')",
  );

  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#simulator .ingredientpicker');
    input.focus();
    input.value = 'Carrot';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
  await waitFor(
    win,
    "document.querySelector('#simulator [role=option][aria-selected=true]')?.getAttribute('aria-label') === 'Carrot'",
  );
  const selectionTop = await win.webContents.executeJavaScript(
    "document.querySelector('#ingredients').getBoundingClientRect().top + scrollY",
  );
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await waitFor(
    win,
    "document.querySelector('#simulator [role=status]').textContent === 'The pot is full. Remove an ingredient before adding Carrot.'",
  );
  assert.equal(
    await win.webContents.executeJavaScript(`(() => {
      const status = document.querySelector('#simulator [role=status]');
      return getComputedStyle(status).clipPath === 'none' && status.clientWidth > 10 && status.clientHeight > 10;
    })()`),
    true,
  );
  assert.equal(
    await win.webContents.executeJavaScript(`(() => {
      const status = document.querySelector('#simulator [role=status]');
      const rect = status.getBoundingClientRect();
      return Math.abs(document.querySelector('#ingredients').getBoundingClientRect().top + scrollY - ${selectionTop}) < 1 &&
        rect.top >= document.querySelector('#simulator .ingredientdropdown').getBoundingClientRect().bottom &&
        rect.bottom <= document.querySelector('#simulator .selectionpanel').getBoundingClientRect().top;
    })()`),
    true,
    'Picker errors must occupy reserved space above the selected ingredients',
  );
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.querySelector('#simulator .ingredient-search-summary').hidden",
    ),
    false,
  );
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#simulator .ingredientpicker');
    input.value = 'Berries';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.equal(
    await win.webContents.executeJavaScript(
      'document.querySelector(\'#simulator [role=option][aria-label="Berries 3"] .ingredient-picked-marker\').textContent',
    ),
    '3',
    'A search rebuild must retain the picked quantity',
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.querySelector('#simulator [role=status]').classList.contains('ingredient-feedback')",
    ),
    false,
  );

  const warnings = [];
  const recordWarning = details => {
    if (['warning', 'error'].includes(details.level)) {
      warnings.push(details.message);
    }
  };
  win.webContents.on('console-message', recordWarning);
  await clickElement(win, '#simulator .cookingingredients');
  await waitFor(win, "document.activeElement?.dataset.value === 'all'");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
  await waitFor(win, "document.activeElement?.dataset.value === 'practical'");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await waitFor(
    win,
    "document.querySelector('#simulator .cookingingredients').textContent === 'Cooking: Practical'",
  );
  for (const query of ['*Cooked Meat', 'goatmilk']) {
    await win.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('#simulator .ingredientpicker');
      input.value = ${JSON.stringify(query)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    assert.equal(
      await win.webContents.executeJavaScript(`(() => {
        return document.querySelectorAll('#simulator [role=option]').length === 0 &&
          document.querySelector('#simulator .ingredient-search-summary').textContent.includes('Cooking: All') &&
          document.querySelectorAll('#ingredients .icon').length === 4;
      })()`),
      true,
      'Cooking filters must explain hidden matches without changing the selected pot',
    );
  }
  await clickElement(win, '#simulator .ingredient-show-all');
  await waitFor(win, "document.querySelectorAll('#simulator [role=option]').length === 1");
  assert.equal(
    await win.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('#simulator .ingredientpicker');
      return input === document.activeElement && input.value === 'goatmilk' &&
        document.querySelectorAll('#ingredients .icon').length === 4;
    })()`),
    true,
    'Recovery must preserve the query and selected pot and return focus to search',
  );
  await clickElement(win, '#simulator .cookingingredients');
  await waitFor(
    win,
    "document.querySelector('#simulator .cookingingredients').getAttribute('aria-expanded') === 'true'",
  );
  await clickElement(win, '#simulator [role=menuitemradio][data-value=everyday]');
  await waitFor(win, "document.querySelectorAll('#simulator [role=option]').length === 0");
  assert.equal(
    await win.webContents.executeJavaScript(
      "JSON.parse(localStorage.getItem('foodGuideCookingPreference'))[0]",
    ),
    'everyday',
  );
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#simulator .ingredientpicker');
    input.value = 'Butter';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.equal(
    await win.webContents.executeJavaScript(`(() => {
      return document.querySelectorAll('#simulator [role=option]').length === 1 &&
        document.querySelector('#simulator .ingredient-search-summary').textContent.includes('1 hidden by cooking view.');
    })()`),
    true,
    'Partially filtered native searches must disclose hidden matches',
  );
  await clickElement(win, '#simulator .ingredient-show-all');
  await waitFor(win, "document.querySelectorAll('#simulator [role=option]').length === 2");
  assert.equal(
    await win.webContents.executeJavaScript(
      "JSON.parse(localStorage.getItem('foodGuideCookingPreference'))[0]",
    ),
    'all',
  );
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#simulator .ingredientpicker');
    input.value = 'Berries';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickElement(win, '#simulator .groupingredients');
  await waitFor(win, "document.activeElement?.dataset.value === 'none'");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
  await waitFor(win, "document.activeElement?.dataset.value === 'type'");
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await waitFor(
    win,
    "document.querySelector('#simulator .groupingredients').textContent === 'Group by: Ingredient type'",
  );
  assert.equal(
    await win.webContents.executeJavaScript(`(() => {
      const group = document.querySelector('#simulator .ingredientdropdown [role=group]');
      const options = [...document.querySelectorAll('#simulator [role=option]')];
      return document.getElementById(group.getAttribute('aria-labelledby')).textContent ===
        'Fruit (' + options.length + ')' &&
        options.every((option, index) =>
          group.contains(option) && option.getAttribute('aria-posinset') === String(index + 1) &&
          option.getAttribute('aria-setsize') === String(options.length));
    })()`),
    true,
    'Grouped results must expose their label and global option positions',
  );
  await clickElement(win, '#simulator .clearsearchbtn');
  await waitFor(
    win,
    "document.querySelectorAll('#simulator .ingredientdropdown [role=group]').length > 1",
  );
  assert.equal(
    await win.webContents.executeJavaScript(`(() => {
      const picker = document.querySelector('#simulator .ingredientdropdown');
      const groups = [...picker.querySelectorAll('[role=group]')];
      const rects = groups.map(group => group.getBoundingClientRect());
      return rects.some(rect => rect.left > rects[0].right) &&
        rects.every((rect, index) => {
          if (index === 0) return true;
          const previous = rects[index - 1];
          return Math.abs(rect.left - previous.left) < 1
            ? Math.abs(rect.top - previous.bottom - 12) < 1
            : rect.left >= previous.right && Math.abs(rect.top - rects[0].top) < 1;
        }) &&
        picker.scrollWidth === picker.clientWidth &&
        groups.every(group => group.getClientRects().length === 1 &&
          getComputedStyle(group).overflowY === 'visible');
    })()`),
    true,
    'Wide grouped pickers must pack cards in reading order within one scroll area',
  );
  for (let i = 0; i < 4; i++) {
    const scaleBefore = await win.webContents.executeJavaScript('devicePixelRatio');
    menu.getMenuItemById('zoom-in').click(undefined, win, win.webContents);
    await waitFor(win, `devicePixelRatio > ${scaleBefore}`);
  }
  await waitFor(
    win,
    "getComputedStyle(document.querySelector('#simulator .ingredient-result-groups')).columnWidth === 'auto'",
  );
  assert.equal(
    await win.webContents.executeJavaScript(`(() => {
      const groups = document.querySelectorAll('#simulator .ingredientdropdown [role=group]');
      return groups[1].getBoundingClientRect().top >= groups[0].getBoundingClientRect().bottom &&
        document.activeElement === document.querySelector('#simulator .ingredientpicker');
    })()`),
    true,
    'Native zoom must stack group cards while retaining input focus',
  );
  menu.getMenuItemById('reset-zoom').click(undefined, win, win.webContents);
  await waitFor(win, `Math.abs(devicePixelRatio - ${originalScale}) < 0.01`);
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#simulator .ingredientpicker');
    input.value = 'Berries';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickElement(win, '#ingredients .ingredient:nth-child(4) .icon');
  await waitFor(win, "document.querySelectorAll('#ingredients .icon').length === 3");
  await clickElement(win, '#simulator [role="option"][aria-label="Berries 2"] .text');
  await waitFor(win, "document.querySelectorAll('#ingredients .icon').length === 4");
  // Native input and pointer shortcuts share the same removal paths.
  await win.webContents.executeJavaScript(
    "document.querySelector('#simulator .ingredientpicker').focus()",
  );
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers: ['shift'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return', modifiers: ['shift'] });
  await waitFor(win, "document.querySelectorAll('#ingredients .icon').length === 3");
  await clickElement(win, '#simulator [role=option][aria-label="Berries 2"] .ingredient-toggle');
  await waitFor(win, "document.querySelectorAll('#ingredients .icon').length === 1");
  assert.equal(
    await win.webContents.executeJavaScript(
      'getComputedStyle(document.querySelector(\'#simulator [data-id="berries@together"] .ingredient-option-actions\')).visibility',
    ),
    'hidden',
    'Unpicked ingredients must hide their removal controls',
  );
  for (let i = 0; i < 3; i++) {
    await clickElement(win, '#simulator [role=option][data-id="berries@together"] .text');
    await waitFor(win, `document.querySelectorAll('#ingredients .icon').length === ${i + 2}`);
    assert.equal(
      await win.webContents.executeJavaScript(
        'document.querySelector(\'#simulator [data-id="berries@together"] .ingredient-subtract\').getClientRects().length > 0',
      ),
      i > 0,
      'The minus must appear only when multiple copies are selected',
    );
    assert.equal(
      await win.webContents.executeJavaScript(`(() => {
        const option = document.querySelector('#simulator [data-id="berries@together"]');
        return Math.abs(option.getBoundingClientRect().right -
          option.querySelector('.ingredient-toggle').getBoundingClientRect().right) <= 1.1;
      })()`),
      true,
      'The checkbox must stay at the trailing edge for single and repeated ingredients',
    );
  }
  await clickElement(win, '#simulator .displaymodeingredients:not(.densityingredients)');
  await clickElement(win, '#simulator [role=menuitemradio][data-value=icons]');
  await waitFor(
    win,
    "document.querySelector('#simulator .ingredientdropdown').classList.contains('hidetext')",
  );
  for (const density of ['compact', 'normal', 'cozy']) {
    await clickElement(win, '#simulator .densityingredients');
    await clickElement(win, `#simulator [role=menuitemradio][data-value="${density}"]`);
    await waitFor(
      win,
      `document.querySelector('#simulator .ingredientdropdown').classList.contains('density-${density}') &&
        document.querySelector('#simulator .densityingredients').getAttribute('aria-expanded') === 'false'`,
    );
    assert.equal(
      await win.webContents.executeJavaScript(`(() => {
        const option = document.querySelector('#simulator [role=option][data-id="berries@together"]');
        const tile = option.getBoundingClientRect();
        const icon = option.querySelector('.icon').getBoundingClientRect();
        const checkbox = option.querySelector('.ingredient-toggle').getBoundingClientRect();
        const minus = option.querySelector('.ingredient-subtract').getBoundingClientRect();
        return Math.abs(tile.width - tile.height) < 1 &&
          Math.abs(icon.x + icon.width / 2 - tile.x - tile.width / 2) < 1 &&
          Math.abs(icon.y + icon.height / 2 - tile.y - tile.height / 2) < 1 &&
          Math.abs(checkbox.top - minus.top) < 1 && Math.abs(checkbox.top - tile.top) <= 1.1;
      })()`),
      true,
      `${density} icons must use centered square tiles with aligned shortcuts`,
    );
  }
  await clickElement(win, '#simulator .displaymodeingredients:not(.densityingredients)');
  await clickElement(win, '#simulator [role=menuitemradio][data-value=names]');
  await waitFor(
    win,
    "!document.querySelector('#simulator .ingredientdropdown').classList.contains('hidetext')",
  );
  await clickElement(win, '#simulator .densityingredients');
  await clickElement(win, '#simulator [role=menuitemradio][data-value=compact]');
  await waitFor(
    win,
    "document.querySelector('#simulator .ingredientdropdown').classList.contains('density-compact')",
  );
  await clickElement(win, '#simulator [role=option][aria-label="Berries 3"] .ingredient-subtract');
  await waitFor(win, "document.querySelectorAll('#ingredients .icon').length === 3");
  await clickElement(win, '#simulator [role=option][aria-label="Berries 2"] .ingredient-subtract');
  await waitFor(win, "document.querySelectorAll('#ingredients .icon').length === 2");
  assert.equal(
    await win.webContents.executeJavaScript(`(() => {
      const option = document.querySelector('#simulator [data-id="berries@together"]');
      return option.querySelector('.ingredient-subtract').getClientRects().length === 0 &&
        option.querySelector('.ingredient-toggle').getClientRects().length > 0;
    })()`),
    true,
    'Returning to one copy must hide the minus and retain the checkbox',
  );
  await win.webContents.executeJavaScript(
    "document.querySelector('#simulator .ingredientpicker').focus()",
  );
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
  await waitFor(
    win,
    "document.querySelector('#simulator [role=option][aria-selected=true] .text')?.textContent === 'Berries'",
  );
  const removeAllModifiers = process.platform === 'darwin' ? ['meta'] : ['control'];
  win.webContents.sendInputEvent({
    type: 'keyDown',
    keyCode: 'Return',
    modifiers: removeAllModifiers,
  });
  win.webContents.sendInputEvent({
    type: 'keyUp',
    keyCode: 'Return',
    modifiers: removeAllModifiers,
  });
  await waitFor(win, "document.querySelectorAll('#ingredients .icon').length === 1");
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.activeElement === document.querySelector('#simulator .ingredientpicker')",
    ),
    true,
  );
  for (let i = 0; i < 3; i++) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await delay(50);
  }
  await waitFor(win, "document.querySelectorAll('#ingredients .icon').length === 4");
  await clickElement(win, '#simulator .groupingredients');
  await waitFor(
    win,
    "document.querySelector('#simulator .groupingredients').getAttribute('aria-expanded') === 'true'",
  );
  await clickElement(win, '#simulator [role=menuitemradio][data-value=none]');
  await waitFor(
    win,
    "document.querySelector('#simulator .ingredientdropdown [role=group]') === null",
  );
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

  assert.equal(
    await win.webContents.executeJavaScript(
      "document.querySelector('#results table caption').textContent",
    ),
    'Crock pot results',
  );
  const cookTimeHeader = '#results table th[data-sort="cooktime"]';
  const columnBar = '#results .column-toggle-bar';
  assert.equal(
    await win.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(columnBar)}).getAttribute('aria-label')`,
    ),
    'Columns: Crock pot results',
  );
  await win.webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(`${cookTimeHeader} button`)}).focus()`,
  );
  await waitFor(
    win,
    `document.activeElement === document.querySelector(${JSON.stringify(`${cookTimeHeader} button`)})`,
  );
  win.webContents.setZoomFactor(2);
  await waitFor(
    win,
    `document.querySelector(${JSON.stringify(cookTimeHeader)}).classList.contains('col-hidden')`,
  );
  const autoToggle = `${columnBar} button[title]`;
  await waitFor(
    win,
    "document.activeElement.closest('#results .column-toggle-bar') && document.activeElement.textContent === 'Cook Time'",
  );
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await waitFor(
    win,
    `!document.querySelector(${JSON.stringify(cookTimeHeader)}).classList.contains('col-hidden')`,
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(autoToggle)}).getAttribute('aria-pressed')`,
    ),
    'false',
  );
  await clickElement(win, autoToggle);
  await waitFor(
    win,
    `document.querySelector(${JSON.stringify(autoToggle)}).getAttribute('aria-pressed') === 'true'`,
  );
  await waitFor(
    win,
    `document.querySelector(${JSON.stringify(cookTimeHeader)}).classList.contains('col-hidden')`,
  );
  await waitFor(win, "document.querySelector('#results .table-scroll-wrapper').tabIndex === 0");
  await win.webContents.executeJavaScript(`(async () => {
    const wrapper = document.querySelector('#results .table-scroll-wrapper');
    wrapper.scrollLeft = 0;
    window.scrollKeyEvents = [];
    wrapper.addEventListener('keydown', event => window.scrollKeyEvents.push(event.key));
    wrapper.focus();
    // Column changes and focus scrolling must reach the compositor before native key injection.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  await waitFor(
    win,
    "document.hasFocus() && document.activeElement === document.querySelector('#results .table-scroll-wrapper')",
  );
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
  await waitFor(win, "document.querySelector('#results .table-scroll-wrapper').scrollLeft > 0");
  win.webContents.setZoomFactor(1);
  await waitFor(win, `Math.abs(devicePixelRatio - ${originalScale}) < 0.01`);

  await win.webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(`${healthHeader} button`)}).focus()`,
  );
  await waitFor(
    win,
    `document.hasFocus() && document.activeElement === document.querySelector(${JSON.stringify(`${healthHeader} button`)})`,
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

  assert.deepEqual(
    await win.webContents.executeJavaScript(
      "JSON.parse(localStorage.getItem('foodGuideState')).pickers[0]",
    ),
    ['meat@together', 'berries@together', 'berries@together', 'berries@together'],
  );
  await clickElement(win, '#tab-discovery');
  await waitFor(
    win,
    "JSON.parse(localStorage.getItem('foodGuideState')).activeTab === 'discovery'",
  );
  const inventoryNames = [
    'Meat',
    'Berries',
    'Carrot',
    'Honey',
    'Twigs',
    'Ice',
    'Egg',
    'Monster Meat',
    'Banana',
    'Pumpkin',
    'Toma Root',
    'Potato',
    'Eggplant',
  ];
  for (const [index, ingredient] of inventoryNames.entries()) {
    await win.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('#discovery .ingredientpicker');
      input.focus();
      input.value = ${JSON.stringify(ingredient)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await waitFor(
      win,
      `JSON.parse(localStorage.getItem('foodGuideState')).pickers[1].length === ${index + 1}`,
    );
  }
  await clickElement(win, '#makable .makablebutton');
  await waitFor(
    win,
    "window.analysis?.made.length > 1000 && !document.querySelector('#makable .makablebutton').disabled",
  );
  const resultTotal = await win.webContents.executeJavaScript('window.analysis.made.length');
  assert(resultTotal > 1000);
  await waitFor(win, "document.querySelectorAll('#makable tbody tr').length === 500");
  await clickElement(win, '#makable .showMoreButton');
  await waitFor(win, "document.querySelectorAll('#makable tbody tr').length === 1000");
  await clickElement(win, '#makable .recipeFilter button:has([title="Meatballs"])');
  await waitFor(win, "document.querySelector('#makable .showMoreButton').hidden");
  assert(
    await win.webContents.executeJavaScript(`(() => {
    const rows = [...document.querySelectorAll('#makable tbody tr')];
    return rows.length > 0 && rows.length < 500 && rows.every(row => row.cells[1].textContent === 'Meatballs');
  })()`),
  );
  // Cycle the recipe through excluded and back to normal, preserving the expanded limit.
  const recipe = '#makable .recipeFilter button:has([title="Meatballs"])';
  await win.webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(recipe)}).focus()`,
  );
  for (const state of ['excluded', 'normal']) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await waitFor(
      win,
      `document.querySelector(${JSON.stringify(recipe)}).getAttribute('aria-label') === 'Meatballs: ${state === 'excluded' ? 'Excluded' : 'Normal'}'`,
    );
  }
  await waitFor(
    win,
    "document.querySelectorAll('#makable tbody tr').length === 1000 && !document.querySelector('#makable .showMoreButton').hidden",
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
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.querySelector('#makable .showMoreButton').textContent",
    ),
    `Mostrar más resultados (1000 de ${resultTotal})`,
  );
  await clickElement(win, '#makable .deleteButton');
  await waitFor(win, "!document.querySelector('#makable .makableContainer')");
  await clickElement(win, '#tab-simulator');
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
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.querySelectorAll('#ingredients [data-id]').length",
    ),
    4,
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.querySelectorAll('#inventory [data-id]').length",
    ),
    inventoryNames.length,
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
    `Electron smoke passed: ${manifest} sprites, native zoom menus and shortcuts, cooking views and preserved pot selections, search and full-pot feedback, mushroom search, keyboard recipes, grouped ingredient removal and selected-only controls, picker dismissal, tab navigation, mouse ingredient entry, keyboard table sorting, column selection and focus recovery at 200% zoom, horizontal scrolling, immediate saved selections, Discovery filtering and localized pagination, saved theme/language and ingredients after reload, sandbox, blocked popup.`,
  );
}

void main()
  .then(() => app.quit())
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
