import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

const loaderByRenderer = new WeakMap();

export function getKtx2Loader(renderer) {
  if (!renderer) {
    throw new Error("getKtx2Loader requires a valid THREE.WebGLRenderer instance.");
  }

  let loader = loaderByRenderer.get(renderer);
  if (!loader) {
    loader = new KTX2Loader();
    // Keep basis_transcoder.js/wasm in /public/basis for runtime loading.
    loader.setTranscoderPath("/basis/");
    loader.detectSupport(renderer);
    loaderByRenderer.set(renderer, loader);
  }

  return loader;
}
