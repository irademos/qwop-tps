// Rapier (physics) — the plain @dimforge/rapier3d package with its .wasm loaded as a file.
//
// Its JS glue imports the binary as a WebAssembly ES module (`import * as wasm from
// './rapier_wasm3d_bg.wasm'`), which browsers / Vite don't do on their own; the
// `rapierWasmShim` plugin in vite.config.js swaps that import for the glue alone, and
// initRapier() below fetches the binary as an asset and streams it into WebAssembly — instead
// of rapier3d-compat, whose binary is base64 text in the JS (~40 % bigger to download and
// decoded on the main thread at startup). Same API: `import RAPIER from '…/physics/rapier.js'`
// everywhere, and await initRapier() once before making a World (bootstrapGameApp.js starts
// it as the module loads so the download runs alongside the rest of the boot).
import RAPIER from '@dimforge/rapier3d';
import * as glue from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import wasmUrl from '@dimforge/rapier3d/rapier_wasm3d_bg.wasm?url';

let _ready = null;

export function initRapier() {
  return (_ready ??= (async () => {
    const imports = { './rapier_wasm3d_bg.js': glue };
    let instance;
    try {
      // (streaming compiles while it downloads; needs the server to send application/wasm)
      ({ instance } = await WebAssembly.instantiateStreaming(fetch(wasmUrl), imports));
    } catch (err) {
      const res = await fetch(wasmUrl);
      if (!res.ok) throw new Error(`[rapier] couldn't fetch ${wasmUrl}: ${res.status}`);
      ({ instance } = await WebAssembly.instantiate(await res.arrayBuffer(), imports));
    }
    glue.__wbg_set_wasm(instance.exports);
  })().catch((err) => { _ready = null; throw err; }));
}

export default RAPIER;
