import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APP_VERSION } from '../www/version.js';
import { RELEASE } from '../server/site/site-config.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('网页内核、Android、package.json 与官网使用同一个版本号', async () => {
  const gradle = (await read('android/app/build.gradle')).match(/versionName\s+'(\d+\.\d+\.\d+)'/)?.[1];
  const pkg = JSON.parse(await read('package.json')).version;
  assert.equal(gradle, APP_VERSION, 'android/app/build.gradle');
  assert.equal(pkg, APP_VERSION, 'package.json');
  assert.equal(RELEASE.version, APP_VERSION, 'server/site/site-config.js');
  const ios = await read('ios/project.yml');
  assert.equal(ios.match(/MARKETING_VERSION: (\S+)/)?.[1], APP_VERSION, 'ios/project.yml');
  assert.equal(ios.match(/CURRENT_PROJECT_VERSION: (\d+)/)?.[1], (await read('android/app/build.gradle')).match(/versionCode (\d+)/)?.[1], 'ios build number');
  for (const file of ['www/planner-ui.js', 'www/update-ui.js']) assert.doesNotMatch(await read(file), /'\d+\.\d+\.\d+'/, `${file} 不应再写死版本号`);
});
