import test from 'node:test';
import assert from 'node:assert/strict';
import {deviceStatusLabel, deviceStatusStyle} from '../web/device-status.mjs';
import {readFileSync} from 'node:fs';

test('Status below device name follows running, stopped and error', () => {
  assert.deepEqual(
    ['running','stopped','error'].map(status => [deviceStatusLabel({status}),deviceStatusStyle({status})]),
    [['● Запущен','up'], ['● Остановлен','stopped'], ['● Ошибка','error']]
  );
});
test('Device status is shown inside hero, not duplicated in inspector header', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="inspectorDeviceName">СВОЙСТВА УСТРОЙСТВА/);
  assert.doesNotMatch(html, /id="inspectorDeviceStatus"/);
  assert.match(source, /'node-hero-status '\+deviceStatusStyle\(node\)/);
  assert.doesNotMatch(source, /el\('span','',img\?\.name\|\|'Нет образа'\)/);
});
test('Connect control never scales on hover; uses slate-blue theme', () => {
  const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
  const button = css.match(/\.node-connect-handle\{([\s\S]*?)\}/)?.[1];
  assert.ok(button);
  assert.match(button, /width:28px;height:28px/);
  assert.doesNotMatch(button, /transform:/);
  assert.match(css, /background:#355d78;color:#fff;border-color:#355d78/);
});
