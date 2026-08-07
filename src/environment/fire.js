import * as THREE from 'three';

const DEFAULT_PULSE_SETTINGS = {
  base: 0.65,
  variance: 0.15,
  opacityRange: [0.35, 0.8],
  emissiveRange: [0.35, 0.9],
  lightIntensityRange: [0.75, 1.15]
};

export function createFire({
  particleCount = 6,
  spread = 1.2,
  sizeRange = [0.14, 0.39],
  colors = {},
  lightSettings = null,
  lightOffset = new THREE.Vector3(0, 0, 0),
  pulse = {}
} = {}) {
  const fireGroup = new THREE.Group();
  const yellowMaterial = new THREE.MeshStandardMaterial({
    color: colors.yellow ?? 0xffd166,
    emissive: colors.yellowEmissive ?? 0xffb703,
    emissiveIntensity: colors.yellowEmissiveIntensity ?? 0.6,
    transparent: true,
    opacity: colors.yellowOpacity ?? 0.65,
    depthWrite: false
  });
  const redMaterial = new THREE.MeshStandardMaterial({
    color: colors.red ?? 0xff7b54,
    emissive: colors.redEmissive ?? 0xff3b1f,
    emissiveIntensity: colors.redEmissiveIntensity ?? 0.5,
    transparent: true,
    opacity: colors.redOpacity ?? 0.55,
    depthWrite: false
  });
  const materials = [yellowMaterial, redMaterial];

  const createParticle = (material) => {
    const size = THREE.MathUtils.lerp(sizeRange[0], sizeRange[1], Math.random());
    const geometry = new THREE.SphereGeometry(size, 8, 6);
    const particle = new THREE.Mesh(geometry, material);
    particle.position.set(
      (Math.random() - 0.5) * spread,
      Math.random() * spread,
      (Math.random() - 0.5) * spread
    );
    particle.castShadow = false;
    particle.receiveShadow = false;
    return particle;
  };

  for (let i = 0; i < particleCount; i += 1) {
    fireGroup.add(createParticle(yellowMaterial));
  }
  for (let i = 0; i < Math.ceil(particleCount / 2); i += 1) {
    fireGroup.add(createParticle(redMaterial));
  }

  let light = null;
  if (lightSettings) {
    light = new THREE.PointLight(
      lightSettings.color,
      lightSettings.intensity,
      lightSettings.distance,
      lightSettings.decay
    );
    light.position.copy(lightOffset);
    fireGroup.add(light);
  }

  const baseLightIntensity = light?.intensity ?? 0;
  const pulseSettings = {
    ...DEFAULT_PULSE_SETTINGS,
    ...pulse
  };

  const update = (timeMs = performance.now()) => {
    const pulseValue = pulseSettings.base + Math.sin(timeMs * 0.004) * pulseSettings.variance;
    const opacity = THREE.MathUtils.clamp(pulseValue, ...pulseSettings.opacityRange);
    const emissiveIntensity = THREE.MathUtils.clamp(pulseValue, ...pulseSettings.emissiveRange);
    materials.forEach(material => {
      material.opacity = opacity;
      material.emissiveIntensity = emissiveIntensity;
    });
    if (light) {
      const intensityScale = THREE.MathUtils.clamp(pulseValue, ...pulseSettings.lightIntensityRange);
      light.intensity = baseLightIntensity * intensityScale;
    }
  };

  const dispose = () => {
    fireGroup.traverse(child => {
      if (!child.isMesh) return;
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) {
        child.material.forEach(material => material?.dispose?.());
      } else {
        child.material?.dispose?.();
      }
    });
  };

  return {
    group: fireGroup,
    materials,
    light,
    update,
    dispose
  };
}
