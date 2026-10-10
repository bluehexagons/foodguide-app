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
  // Native input is asynchronous; wait for menus and panels before measuring the next target.
  await waitFor(
    win,
    `(() => {
		const element = document.querySelector(${JSON.stringify(selector)});
		const rect = element?.getBoundingClientRect();
		return !!rect?.width && !!rect.height && getComputedStyle(element).visibility === 'visible';
	})()`,
  );
  const position = await win.webContents
    .executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Missing mouse target');
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error('Mouse target is not visible');
    window.foodguideSmokeClickComplete = false;
    element.addEventListener('click', () => {
      queueMicrotask(() => { window.foodguideSmokeClickComplete = true; });
    }, { once: true, capture: true });
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
  await waitFor(win, 'window.foodguideSmokeClickComplete === true');
}

async function selectPageSize(win, action, value) {
  const selector = `[data-table-action="${action}"]`;
  const selectedValue = JSON.stringify(String(value));
  await win.webContents.executeJavaScript(
    `(() => { const select = document.querySelector('#makable .table-group-pagination ' + ${JSON.stringify(selector)}); select.focus(); select.value = ${selectedValue}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`,
  );
  await waitFor(
    win,
    `[...document.querySelectorAll('#makable .table-group-pagination')].every(bar => bar.querySelector(${JSON.stringify(selector)})?.value === ${selectedValue}) && document.activeElement.matches(${JSON.stringify(selector)})`,
  );
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
            ? Math.abs(rect.top - previous.bottom - parseFloat(getComputedStyle(groups[index - 1]).marginBottom)) < 1
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
  const iconWidths = {};
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
    iconWidths[density] = await win.webContents.executeJavaScript(
      'document.querySelector(\'#simulator [role=option][data-id="berries@together"]\').getBoundingClientRect().width',
    );
  }
  assert.ok(
    iconWidths.compact <= iconWidths.normal * 0.75 && iconWidths.normal < iconWidths.cozy,
    'Compact icons must be distinctly smaller than normal and cozy icons',
  );
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
  assert(
    await win.webContents.executeJavaScript(`(() => {
      const progress = document.querySelector('#makable progress');
      const n = document.querySelectorAll('#makable .foodFilter button').length;
      return progress.value === progress.max && progress.max === n * (n + 1) * (n + 2) * (n + 3) / 24 &&
        progress.getAttribute('aria-valuetext').includes('(100%)');
    })()`),
  );
  await waitFor(win, "document.querySelectorAll('#makable tbody tr[data-recipe]').length === 25");
  assert(
    await win.webContents.executeJavaScript(`(() => {
      const refreshButtons = [...document.querySelectorAll('#makable .table-group-pagination [data-table-action="refresh"]')];
      return refreshButtons.length === 2 && refreshButtons.every(button => button.hidden);
    })()`),
  );
  assert.equal(
    await win.webContents.executeJavaScript(`Number(
      document.querySelector('#makable .analysis-result-count').textContent
        .match(/; ([\\d,]+) matching combinations\\./)?.[1].replace(/\\D/g, '')
    )`),
    resultTotal,
  );
  assert(
    await win.webContents.executeJavaScript(`(() => {
      const navs = [...document.querySelectorAll('#makable .table-pagination.table-group-pagination')];
      return navs.length === 2 && navs.every(nav =>
        nav.querySelector('[data-table-action="page-next"]') &&
        nav.querySelector('.table-page-range')?.textContent &&
        nav.querySelector('.table-page-count')?.textContent === 'Page 1 of ' +
          nav.querySelector('.table-page-count')?.textContent.match(/Page 1 of (\\d+)/)?.[1]);
    })()`),
  );
  const overviewPages = await win.webContents.executeJavaScript(`(() => {
    const count = document.querySelector('#makable .table-group-pagination .table-page-count').textContent;
    return Number(count.match(/Page 1 of (\\d+)/)[1]);
  })()`);
  assert(overviewPages > 1);
  assert(
    await win.webContents.executeJavaScript(`(() => {
      const bars = [...document.querySelectorAll('#makable .table-pagination.table-group-pagination')];
      return bars.length === 2 && ['group-page-size', 'combination-page-size'].every(action =>
        bars.every(bar => {
          const select = bar.querySelector('[data-table-action="' + action + '"]');
          return select.value === '25' && [...select.options].map(option => option.value).join(',') === '10,25,50,100';
        }));
    })()`),
  );
  await selectPageSize(win, 'group-page-size', 10);
  await waitFor(win, "document.querySelectorAll('#makable tbody tr[data-recipe]').length === 10");
  await selectPageSize(win, 'group-page-size', 25);
  await waitFor(win, "document.querySelectorAll('#makable tbody tr[data-recipe]').length === 25");
  await clickElement(win, '#makable .table-group-pagination [data-table-action="page-next"]');
  await waitFor(
    win,
    "document.querySelector('#makable .table-group-pagination .table-page-count').textContent === 'Page 2 of ' + " +
      overviewPages,
  );
  await clickElement(win, '#makable .table-group-pagination [data-table-action="page-previous"]');
  await waitFor(
    win,
    "document.querySelector('#makable .table-group-pagination .table-page-count').textContent === 'Page 1 of ' + " +
      overviewPages,
  );
  await clickElement(win, '#makable .table-group-pagination [data-table-action="page-last"]');
  await waitFor(
    win,
    `document.querySelector('#makable .table-group-pagination .table-page-count').textContent === 'Page ${overviewPages} of ${overviewPages}'`,
  );
  await win.webContents.executeJavaScript(`(() => {
    const pager = document.querySelector('#makable .table-group-pagination');
    const input = pager.querySelector('[data-table-action="page-number"]');
    input.focus();
    input.value = '2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await waitFor(
    win,
    "document.querySelector('#makable .table-group-pagination .table-page-count').textContent === 'Page 2 of ' + " +
      overviewPages,
  );
  await clickElement(win, '#makable .table-group-pagination [data-table-action="page-first"]');
  await waitFor(
    win,
    "document.querySelector('#makable .table-group-pagination .table-page-count').textContent === 'Page 1 of ' + " +
      overviewPages,
  );
  await clickElement(win, '#makable .table-group-pagination [data-table-action="page-last"]');
  await waitFor(
    win,
    `document.querySelector('#makable .table-group-pagination .table-page-count').textContent === 'Page ${overviewPages} of ${overviewPages}'`,
  );
  const mainPageSummary = await win.webContents.executeJavaScript(`(() => {
    const pager = document.querySelector('#makable .table-group-pagination');
    const range = pager.querySelector('.table-page-range').textContent;
    return {
      range,
      bounds: range.match(/Recipe groups (\\d+)–(\\d+) of (\\d+)/)?.slice(1).map(Number),
      groups: document.querySelectorAll('#makable tbody tr[data-recipe]').length,
      rows: document.querySelectorAll('#makable tbody tr').length,
    };
  })()`);
  assert(mainPageSummary.groups > 0 && mainPageSummary.groups <= 25);
  assert(mainPageSummary.rows <= 50);
  assert.deepEqual(mainPageSummary.bounds?.slice(0, 2), [
    (overviewPages - 1) * 25 + 1,
    (overviewPages - 1) * 25 + mainPageSummary.groups,
  ]);
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#makable .table-group-pagination [data-table-action="page-number"]');
    input.focus();
    input.value = '2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickElement(win, '#makable .table-group-pagination [data-table-action="page-go"]');
  await waitFor(
    win,
    "document.querySelector('#makable .table-group-pagination .table-page-count').textContent === 'Page 2 of ' + " +
      overviewPages,
  );
  await clickElement(win, '#makable th[data-sort="name"] button');
  await waitFor(
    win,
    "document.querySelector('#makable th[data-sort=\"name\"]').getAttribute('aria-sort') === 'ascending'",
  );
  await clickElement(win, '#makable .recipeFilter button:has([title="Meatballs"])');
  await waitFor(win, "document.querySelectorAll('#makable tbody tr[data-recipe]').length > 0");
  const groupRecipeId = 'meatballs_dst';
  assert(
    await win.webContents.executeJavaScript(`(() => {
      const rows = [...document.querySelectorAll('#makable tbody tr[data-recipe]')];
      return rows.length > 0 && rows.length <= 25 && rows.every(row => row.dataset.recipe === '${groupRecipeId}');
    })()`),
  );
  const groupToggle = '#makable .table-group-toggle';
  const expectedGroupCount = await win.webContents.executeJavaScript(
    `window.analysis.made.filter(result => result.recipe.id === '${groupRecipeId}').length`,
  );
  const groupCount = await win.webContents.executeJavaScript(
    `Number(document.querySelector(${JSON.stringify(groupToggle)}).dataset.count)`,
  );
  assert.equal(groupCount, expectedGroupCount);
  assert(groupCount > 25);
  await clickElement(win, groupToggle);
  await waitFor(
    win,
    `document.querySelector(${JSON.stringify(groupToggle)}).getAttribute('aria-expanded') === 'true'`,
  );
  assert(
    await win.webContents.executeJavaScript(`(() => {
      const toggle = document.querySelector(${JSON.stringify(groupToggle)});
      const ids = toggle.getAttribute('aria-controls').split(/\\s+/);
      const details = document.getElementById(ids[0]);
      const pager = document.getElementById(ids.at(-1));
      return ids.length === 25 && details?.dataset.recipe === '${groupRecipeId}' &&
        pager?.classList.contains('table-group-pager') &&
        Number(toggle.dataset.count) === ${groupCount} &&
        document.querySelectorAll('#makable tbody tr[data-recipe="${groupRecipeId}"]').length === 25 &&
        document.querySelectorAll('#makable tbody tr:not(.table-group-pager)').length <= 25;
    })()`),
  );
  await selectPageSize(win, 'combination-page-size', 10);
  await waitFor(
    win,
    "document.querySelectorAll('#makable tbody tr[data-recipe=meatballs_dst]').length === 10",
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      "[...document.querySelectorAll('#makable .table-group-pagination [data-table-action=group-page-size]')].every(select => select.value === '25')",
    ),
    true,
  );
  await selectPageSize(win, 'combination-page-size', 25);
  await waitFor(
    win,
    "document.querySelectorAll('#makable tbody tr[data-recipe=meatballs_dst]').length === 25",
  );
  await clickElement(win, '#makable .table-combination-pagination [data-table-action="page-last"]');
  await waitFor(
    win,
    "document.querySelector('#makable .table-combination-pagination .table-page-count').textContent.startsWith('Page ') && " +
      "document.querySelector('#makable .table-combination-pagination .table-page-count').textContent !== 'Page 1 of 1'",
  );
  const lastCombinationPage = await win.webContents.executeJavaScript(`(() => {
    const pager = document.querySelector('#makable .table-combination-pagination');
    const rows = [...document.querySelectorAll('#makable tbody tr[data-recipe="${groupRecipeId}"]')];
    const toggle = document.querySelector(${JSON.stringify(groupToggle)});
    const header = toggle.closest('tr');
    const button = header.querySelector('.analysis-ingredients');
    const pagerRow = document.getElementById(toggle.getAttribute('aria-controls').split(/\\s+/).at(-1));
    const lastRow = rows.at(-1);
    const count = Number(toggle.dataset.count);
    const page = Number(pager.querySelector('.table-page-count').textContent.match(/Page (\\d+) of (\\d+)/)[1]);
    const pages = Number(pager.querySelector('.table-page-count').textContent.match(/Page (\\d+) of (\\d+)/)[2]);
    const range = pager.querySelector('.table-page-range').textContent;
    return {
      rows: rows.length,
      page,
      pages,
      count,
      range,
      bounds: range.match(/Combinations (\\d+)–(\\d+) of (\\d+)/)?.slice(1).map(Number),
      expandedBoundary: header.classList.contains('table-group-expanded') &&
        pagerRow.classList.contains('table-group-expanded') &&
        rows.every(row => row.classList.contains('table-group-expanded')),
      endBoundary: (rows.length > 1 ? lastRow : pagerRow).classList.contains('table-group-end'),
      ids: [...button.querySelectorAll('.icon')].map(icon => icon.dataset.id),
    };
  })()`);
  assert.equal(lastCombinationPage.count, groupCount);
  assert.equal(lastCombinationPage.page, lastCombinationPage.pages);
  assert(lastCombinationPage.rows <= 25 && lastCombinationPage.rows >= 1);
  assert.deepEqual(lastCombinationPage.bounds, [
    (lastCombinationPage.page - 1) * 25 + 1,
    groupCount,
    groupCount,
  ]);
  assert.equal(lastCombinationPage.expandedBoundary, true);
  assert.equal(lastCombinationPage.endBoundary, true);
  await win.webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(groupToggle)}).focus()`,
  );
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  await waitFor(
    win,
    `document.querySelector(${JSON.stringify(groupToggle)}).getAttribute('aria-expanded') === 'false'`,
  );
  assert(
    await win.webContents.executeJavaScript(`(() => {
      const toggle = document.querySelector(${JSON.stringify(groupToggle)});
      const ids = toggle.getAttribute('aria-controls').split(/\\s+/);
      const pager = document.getElementById(ids[0]);
      return ids.length === 1 && pager?.classList.contains('table-group-pager') && pager.hidden &&
        document.querySelectorAll('#makable tbody tr[data-recipe="${groupRecipeId}"]').length === 1;
    })()`),
  );
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await waitFor(
    win,
    `document.querySelector(${JSON.stringify(groupToggle)}).getAttribute('aria-expanded') === 'true'`,
  );
  await waitFor(
    win,
    `document.querySelector('#makable .table-combination-pagination .table-page-count').textContent === 'Page ${lastCombinationPage.page} of ${lastCombinationPage.pages}'`,
  );
  const analysisCombination = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector(${JSON.stringify(groupToggle)}).closest('tr').querySelector('.analysis-ingredients');
    button.focus();
    return [...button.querySelectorAll('.icon')].map(icon => icon.dataset.id);
  })()`);
  assert.deepEqual(analysisCombination, lastCombinationPage.ids);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await waitFor(
    win,
    "document.querySelector('#tab-simulator').getAttribute('aria-selected') === 'true'",
  );
  assert.deepEqual(
    await win.webContents.executeJavaScript(
      "[...document.querySelectorAll('#ingredients .ingredient')].map(slot => slot.dataset.id)",
    ),
    analysisCombination,
  );
  assert.deepEqual(
    await win.webContents.executeJavaScript(
      "JSON.parse(localStorage.getItem('foodGuideState')).pickers[0]",
    ),
    analysisCombination,
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.activeElement === document.querySelector('#ingredients .ingredient')",
    ),
    true,
  );
  await clickElement(win, '#tab-discovery');
  assert.equal(
    await win.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(groupToggle)}).getAttribute('aria-expanded')`,
    ),
    'true',
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
    "document.querySelectorAll('#makable tbody tr[data-recipe]').length > 0 && document.querySelector('#makable .table-group-pagination .table-page-count').textContent.startsWith('Page 1 of')",
  );
  await clickElement(win, recipe);
  await waitFor(
    win,
    "document.querySelector('#makable .analysis-result-count').textContent.includes('Recipe groups')",
  );
  await win.webContents.executeJavaScript(
    "document.querySelector('#makable .resetAnalysisFiltersButton').focus()",
  );
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  await waitFor(
    win,
    "document.querySelectorAll('#makable tbody tr[data-recipe]').length > 0 && document.querySelector('#makable .table-group-pagination .table-page-count').textContent.startsWith('Page 1 of')",
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.activeElement === document.querySelector('#makable .resetAnalysisFiltersButton')",
    ),
    true,
  );
  const englishResultCount = await win.webContents.executeJavaScript(`(() => {
    const countText = document.querySelector('#makable .analysis-result-count').textContent.match(/; ([\\d,]+) matching combinations\\./)?.[1];
    const count = Number(countText?.replace(/\\D/g, ''));
    const range = document.querySelector('#makable .table-group-pagination .table-page-range').textContent;
    const groups = new Set(window.analysis.made.map(result => result.recipe.id)).size;
    return { count, range, groups };
  })()`);
  assert.equal(englishResultCount.count, resultTotal);
  assert.equal(englishResultCount.groups, Number(englishResultCount.range.match(/of (\d+)$/)?.[1]));
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.querySelector('#makable .analysis-result-count').textContent",
    ),
    `Recipe groups 1–${englishResultCount.groups} of ${englishResultCount.groups}; ${resultTotal} matching combinations.`,
  );
  await win.webContents.executeJavaScript(
    "document.querySelector('#makable .resetAnalysisFiltersButton').focus()",
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
      'document.activeElement === document.querySelector("#makable .resetAnalysisFiltersButton")',
    ),
    true,
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.querySelector('#makable .analysis-result-count').textContent",
    ),
    await win.webContents.executeJavaScript(`(() => {
      const countText = document.querySelector('#makable .analysis-result-count').textContent.match(/; ([\\d.,]+) combinaciones coincidentes\\./)?.[1];
      const count = Number(countText?.replace(/\\D/g, ''));
      const groups = new Set(window.analysis.made.map(result => result.recipe.id)).size;
      if (count !== ${resultTotal}) return '';
      return 'Grupos de recetas 1–' + groups + ' de ' + groups + '; ' + count + ' combinaciones coincidentes.';
    })()`),
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.querySelector('#makable .resetAnalysisFiltersButton').textContent",
    ),
    'Restablecer filtros',
  );
  await clickElement(win, '#makable .deleteButton');
  await waitFor(win, "!document.querySelector('#makable .makableContainer')");
  await clickElement(win, '#tab-statistics');
  await clickElement(win, '#statistics .makablebutton');
  await waitFor(win, "document.querySelector('#statistics progress')?.value >= 10000");
  await clickElement(win, '#statistics .pauseButton');
  await waitFor(
    win,
    "document.querySelector('#statistics .pauseButton')?.textContent === 'Reanudar'",
  );
  const pausedProgress = await win.webContents.executeJavaScript(`(() => {
    const progress = document.querySelector('#statistics progress');
    return { value: progress.value, max: progress.max };
  })()`);
  assert(pausedProgress.value > 0 && pausedProgress.value < pausedProgress.max);
  assert.equal(
    await win.webContents.executeJavaScript(
      "document.querySelector('#statistics progress').getAttribute('aria-label')",
    ),
    'Progreso de comprobación de combinaciones',
  );
  const beforeRefresh = await win.webContents.executeJavaScript(`(() => ({
    rows: document.querySelectorAll('#statistics tbody tr[data-recipe]').length,
    range: document.querySelector('#statistics .table-group-pagination .table-page-range').textContent,
    summary: document.querySelector('#statistics .makableSummary').textContent,
  }))()`);
  assert(beforeRefresh.rows > 0);
  assert(
    await win.webContents.executeJavaScript(`(() => {
      const buttons = [...document.querySelectorAll('#statistics .table-group-pagination [data-table-action="refresh"]')];
      return buttons.length === 2 && buttons.every(button => !button.hidden) &&
        document.querySelector('#statistics .pauseButton').textContent === 'Reanudar';
    })()`),
  );
  await win.webContents.executeJavaScript(
    "document.querySelector('#statistics .table-group-pagination [data-table-action=refresh]').focus()",
  );
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  await waitFor(
    win,
    "document.querySelector('#statistics [role=status]').textContent.startsWith('Resultados actualizados.')",
  );
  assert.deepEqual(
    await win.webContents.executeJavaScript(`(() => ({
      rows: document.querySelectorAll('#statistics tbody tr[data-recipe]').length,
      range: document.querySelector('#statistics .table-group-pagination .table-page-range').textContent,
      summary: document.querySelector('#statistics .makableSummary').textContent,
    }))()`),
    beforeRefresh,
  );
  assert.deepEqual(
    await win.webContents.executeJavaScript(`({
      value: document.querySelector('#statistics progress').value,
      max: document.querySelector('#statistics progress').max,
    })`),
    pausedProgress,
  );
  assert(
    await win.webContents.executeJavaScript(`(() => {
      const buttons = [...document.querySelectorAll('#statistics .table-group-pagination [data-table-action="refresh"]')];
      return buttons.length === 2 && buttons.every(button => !button.hidden) &&
        document.querySelector('#statistics .pauseButton').textContent === 'Reanudar';
    })()`),
  );
  await waitFor(
    win,
    "document.querySelector('#statistics .table-group-pagination .table-page-count')?.textContent.startsWith('Página 1 de')",
  );
  const statisticsPages = await win.webContents.executeJavaScript(`Number(
    document.querySelector('#statistics .table-group-pagination .table-page-count').textContent.match(/Página 1 de (\\d+)/)[1]
  )`);
  assert(statisticsPages >= 1);
  assert(
    await win.webContents.executeJavaScript(
      "document.querySelectorAll('#statistics tbody tr[data-recipe]').length <= 25",
    ),
  );
  await clickElement(win, '#statistics .resetAnalysisFiltersButton');
  assert.deepEqual(
    await win.webContents.executeJavaScript(`(() => {
      const progress = document.querySelector('#statistics progress');
      return { value: progress.value, max: progress.max };
    })()`),
    pausedProgress,
  );
  await clickElement(win, '#statistics .deleteButton');
  await waitFor(win, "!document.querySelector('#statistics .makableContainer')");
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
    `Electron smoke passed: ${manifest} sprites, native zoom menus and shortcuts, cooking views and preserved pot selections, search and full-pot feedback, mushroom search, keyboard recipes, grouped ingredient removal and selected-only controls, picker dismissal, tab navigation, mouse ingredient entry, keyboard table sorting, column selection and focus recovery at 200% zoom, horizontal scrolling, immediate saved selections, expandable analysis recipes and Simulator handoff, Discovery filtering, live analysis refresh, independent page sizes and expanded run boundaries, localized pagination, saved theme/language and ingredients after reload, sandbox, blocked popup.`,
  );
}

void main()
  .then(() => app.quit())
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
