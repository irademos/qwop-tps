export function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

export function setCookie(name, value, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

export function updateSkinnedMeshBounds(root) {
  if (!root || typeof root.traverse !== 'function') return;
  root.traverse((obj) => {
    if (!obj.isSkinnedMesh || !obj.geometry) return;
    obj.computeBoundingBox();
    obj.computeBoundingSphere();
  });
}
