export function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

export function setCookie(name, value, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

export function markSharedMaterial(material) {
  if (!material) return material;
  material.userData = material.userData || {};
  material.userData.shared = true;
  return material;
}

export function markSharedTexture(texture) {
  if (!texture) return texture;
  texture.userData = texture.userData || {};
  texture.userData.shared = true;
  return texture;
}

export function disposeObject3D(object, { disposeTextures = false } = {}) {
  if (!object) return;
  object.traverse((child) => {
    if (!child.isMesh) return;
    if (child.geometry && typeof child.geometry.dispose === 'function') {
      child.geometry.dispose();
    }
    const materials = Array.isArray(child.material)
      ? child.material
      : child.material
        ? [child.material]
        : [];
    materials.forEach((material) => {
      if (!material || material.userData?.shared) return;
      if (disposeTextures) {
        Object.values(material).forEach((value) => {
          if (value && value.isTexture && !value.userData?.shared) {
            value.dispose?.();
          }
        });
      }
      material.dispose?.();
    });
  });
}
