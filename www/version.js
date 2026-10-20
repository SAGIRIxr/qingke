// Fallback for the browser preview. The Android shell reports its own versionName at runtime;
// tests/version.test.mjs keeps this equal to build.gradle, package.json and the website.
export const APP_VERSION = '3.3.2';
export const appVersion = () => { try { return globalThis.window?.Android?.getVersion?.() || APP_VERSION; } catch { return APP_VERSION; } };
