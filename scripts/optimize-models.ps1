# Optimize an asset kit's glTF folder into small .glb files for the map editor.
#
# Copy this file into the kit's glTF folder (the one with the .gltf / .bin files) and run it:
#   right-click → Run with PowerShell, or in a terminal there:  .\optimize-models.ps1
# Set $Repo below to where your qwop-tps checkout is (it uses scripts/optimize-mappack.mjs,
# after `npm install` there). The .glb files land in a "glb" folder next to this one.
#
# Options:  .\optimize-models.ps1 -TextureSize 1024     (sharper textures, bigger files)
#           .\optimize-models.ps1 -Out C:\somewhere\else

param(
  [string]$Repo = "$HOME\qwop-tps",
  [int]$TextureSize = 512,
  [string]$Out = (Join-Path (Split-Path $PSScriptRoot -Parent) "glb")
)

$script = Join-Path $Repo "scripts\optimize-mappack.mjs"
if (-not (Test-Path $script)) {
  Write-Host "Can't find $script - set `$Repo at the top of this file (or pass -Repo C:\path\to\qwop-tps)." -ForegroundColor Red
  Read-Host "Press Enter to close"; exit 1
}
if (-not (Test-Path (Join-Path $Repo "node_modules\@gltf-transform"))) {
  Write-Host "Installing the repo's packages first (npm install)..."
  Push-Location $Repo; npm install; Pop-Location
}

Write-Host "Optimizing $PSScriptRoot -> $Out (textures up to $TextureSize px)"
node $script $PSScriptRoot -o $Out --texture-size $TextureSize
Write-Host "Done. Import the .glb files from $Out into the map editor." -ForegroundColor Green
Read-Host "Press Enter to close"
