# Asset pipeline compatibility notes

## glTF `KHR_materials_pbrSpecularGlossiness`

If source assets still use `KHR_materials_pbrSpecularGlossiness`, re-export them to the modern metallic-roughness workflow in your DCC/export pipeline whenever possible.

If re-export is not possible, ensure your runtime loader stack includes extension support for `KHR_materials_pbrSpecularGlossiness` before shipping that asset.

## FBX skinning import warnings

To avoid FBX skinning warnings and keep deformation stable:

- Re-export rigs with **max 4 weights per vertex**.
- Ensure **weights are normalized** in the DCC tool before export.

Runtime code now normalizes skinned mesh weights as a safety net, but exporter-side cleanup is still recommended for deterministic results.
