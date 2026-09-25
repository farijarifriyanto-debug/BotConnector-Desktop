param(
  [ValidateSet("vulkan","cpu")]
  [string]$Variant = "vulkan"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$plugin = Join-Path $root "vendor\jan\src-tauri\plugins\tauri-plugin-llamacpp"
$engineRoot = Join-Path $env:LOCALAPPDATA "BotConnectorDev\llama-b10582"
$workerDest = Join-Path $root "src-tauri\resources\bin\botconnector-local-worker.exe"

$tag = "b10582"
$commit = "e85caa81ea2b65797396018c179b87ad61fa38ab"

function Assert-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required developer tool is missing: $Name"
  }
}
Assert-Command git
Assert-Command cargo
Assert-Command cmake

$llvm = "C:\Program Files\LLVM\bin"
if (Test-Path $llvm) {
  $env:PATH = "$llvm;$env:PATH"
}
Assert-Command clang-cl

if (-not (Get-Command ninja -ErrorAction SilentlyContinue)) {
  $wingetNinja = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter ninja.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($wingetNinja) {
    $env:PATH = "$($wingetNinja.DirectoryName);$env:PATH"
  }
}
Assert-Command ninja
if (-not (Test-Path (Join-Path $engineRoot ".git"))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $engineRoot) | Out-Null
  git clone --depth 1 --branch $tag https://github.com/ggml-org/llama.cpp.git $engineRoot
  git -C $engineRoot config core.longpaths true
}

$head = (git -C $engineRoot rev-parse HEAD).Trim()
if ($head -ne $commit) {
  throw "llama.cpp pin mismatch. Expected $commit, found $head"
}

if ($Variant -eq "vulkan") {
  if (-not $env:VULKAN_SDK) {
    $candidate = "C:\VulkanSDK"
    if (Test-Path (Join-Path $candidate "Bin\glslc.exe")) {
      $env:VULKAN_SDK = $candidate
    }
  }
  if (-not $env:VULKAN_SDK) {
    throw "Developer Vulkan SDK is required to build the Vulkan release worker."
  }
  $env:PATH = "$(Join-Path $env:VULKAN_SDK 'Bin');$env:PATH"
  Assert-Command glslc
}
$env:JAN_LLAMA_CPP_DIR = $engineRoot
$env:JAN_ENGINE_VARIANT = $Variant
$feature = if ($Variant -eq "vulkan") { "engine-vulkan" } else { "engine" }

Push-Location $plugin
try {
  cargo build --release --features $feature --bin botconnector-local-worker
  $built = Join-Path $plugin "target\release\botconnector-local-worker.exe"
  if (-not (Test-Path $built)) {
    throw "Worker build finished but executable was not found."
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $workerDest) | Out-Null
  Copy-Item $built $workerDest -Force
  $hash = Get-FileHash $workerDest -Algorithm SHA256
  Write-Host "WORKER=$workerDest"
  Write-Host "SHA256=$($hash.Hash)"
  Write-Host "VARIANT=$Variant"
} finally {
  Pop-Location
}
