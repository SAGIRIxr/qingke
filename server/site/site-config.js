// The release version is maintained here; URL parameters never select downloads.
export const RELEASE = Object.freeze({
  version: '3.2.0',
  repository: 'https://github.com/SAGIRIxr/qingke',
  proxy: 'https://gh-proxy.com/',
});
export const SHARE_PAGE = 'https://qk.sagiri.org/s';

export function releaseLinks() {
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(RELEASE.version)
      || RELEASE.repository !== 'https://github.com/SAGIRIxr/qingke'
      || RELEASE.proxy !== 'https://gh-proxy.com/') throw Error('发布配置无效');
  const release = `${RELEASE.repository}/releases/tag/v${RELEASE.version}`;
  const official = `${RELEASE.repository}/releases/download/v${RELEASE.version}/qingke-${RELEASE.version}-release.apk`;
  return {release, official, proxy: RELEASE.proxy + official};
}
