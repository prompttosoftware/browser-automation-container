function isLocalUrl(urlStr, knownLocalHosts = []) {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname;

    // Normalize comparison (IPv6 brackets, lowercase)
    const normalizedHost = hostname.replace(/^\[|\]$/g, '').toLowerCase();

    // Static local patterns
    const isStaticLocal =
      normalizedHost === 'localhost' ||
      normalizedHost === '127.0.0.1' ||
      normalizedHost === '::1' ||
      normalizedHost === '0.0.0.0' ||
      normalizedHost === 'host.docker.internal' ||
      normalizedHost.endsWith('.local') ||
      normalizedHost.startsWith('192.168.') ||
      normalizedHost.startsWith('10.') ||
      (normalizedHost.startsWith('172.') && (() => {
        const secondOctet = parseInt(normalizedHost.split('.')[1], 10);
        return secondOctet >= 16 && secondOctet <= 31;
      })());

    // User-provided overrides
    const isInKnownHosts = knownLocalHosts.includes(normalizedHost);

    return isStaticLocal || isInKnownHosts;
  } catch (e) {
    return false;
  }
}

module.exports = {
    isLocalUrl,
};
