param(
    [string]$SdkPath = '',
    [string]$GradlePath = '',
    [ValidateSet('Debug','Release')][string]$Configuration = 'Release',
    [string]$SigningConfigPath = '',
    [string]$InitScript = '',
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'www/index.html'))) { throw 'Missing www/index.html.' }
if (-not $SdkPath) {
    $sdkCandidates = @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME)
    if ($env:LOCALAPPDATA) { $sdkCandidates += Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
    if ($env:USERPROFILE) { $sdkCandidates += Join-Path $env:USERPROFILE 'android-sdk' }
    $SdkPath = $sdkCandidates | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'platforms')) } | Select-Object -First 1
}
if (-not $GradlePath) {
    $wrapper = Join-Path $ProjectRoot 'gradlew.bat'
    $gradleCommand = Get-Command gradle -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $wrapper) { $GradlePath = $wrapper }
    elseif ($gradleCommand) { $GradlePath = $gradleCommand.Source }
    elseif ($env:GRADLE_HOME) { $GradlePath = Join-Path $env:GRADLE_HOME 'bin/gradle.bat' }
    elseif ($env:USERPROFILE) {
        $distributionRoot = Join-Path $env:USERPROFILE 'gradle-dist'
        $knownVersion = Join-Path $distributionRoot 'gradle-8.11.1/bin/gradle.bat'
        if (Test-Path -LiteralPath $knownVersion) { $GradlePath = $knownVersion }
    }
}
if (-not $SdkPath -or -not (Test-Path -LiteralPath $SdkPath)) { throw 'Android SDK not found. Pass -SdkPath or set ANDROID_SDK_ROOT.' }
if (-not $GradlePath -or -not (Test-Path -LiteralPath $GradlePath)) { throw 'Gradle not found. Pass -GradlePath or set GRADLE_HOME/PATH.' }

$savedEnvironment = @{}
foreach ($name in @('ANDROID_HOME','ANDROID_SDK_ROOT','QINGKE_STORE_FILE','QINGKE_STORE_PASSWORD','QINGKE_KEY_ALIAS','QINGKE_KEY_PASSWORD')) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$directoryPushed = $false
try {
    $env:ANDROID_HOME = $SdkPath
    $env:ANDROID_SDK_ROOT = $SdkPath
    if (-not $env:QINGKE_STORE_FILE) {
        if (-not $SigningConfigPath -and $env:LOCALAPPDATA) { $SigningConfigPath = Join-Path $env:LOCALAPPDATA 'Qingke/signing/local-signing.json' }
        if ($SigningConfigPath -and (Test-Path -LiteralPath $SigningConfigPath)) {
            # Windows DPAPI is tied to the current OS account. CI uses environment secrets instead.
            $privateConfig = Get-Content -LiteralPath $SigningConfigPath -Raw | ConvertFrom-Json
            $securePassword = ConvertTo-SecureString $privateConfig.passwordDpapi
            $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
            try {
                $env:QINGKE_STORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
                $env:QINGKE_KEY_PASSWORD = $env:QINGKE_STORE_PASSWORD
            } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
            $env:QINGKE_STORE_FILE = $privateConfig.storeFile
            $env:QINGKE_KEY_ALIAS = $privateConfig.keyAlias
        }
    }
    if ($Configuration -eq 'Release' -and (-not $env:QINGKE_STORE_FILE -or -not $env:QINGKE_STORE_PASSWORD -or -not $env:QINGKE_KEY_ALIAS -or -not $env:QINGKE_KEY_PASSWORD)) { throw 'Private release signing is unavailable. Supply QINGKE signing environment variables.' }
    $TaskArgs = @('--no-daemon', '--console=plain', ('assemble' + $Configuration))
    if ($InitScript) {
        if ($Configuration -ne 'Debug') { throw 'An external init script is only permitted for local Debug verification.' }
        if (-not (Test-Path -LiteralPath $InitScript -PathType Leaf)) { throw 'Gradle init script not found.' }
        $TaskArgs += @('--init-script', [System.IO.Path]::GetFullPath($InitScript))
    }
    if ($Offline) { $TaskArgs += '--offline' }
    Push-Location -LiteralPath $ProjectRoot
    $directoryPushed = $true
    & $GradlePath @TaskArgs
    if ($LASTEXITCODE -ne 0) { throw "Android build failed: $LASTEXITCODE" }
    $buildFile = Get-Content -LiteralPath (Join-Path $ProjectRoot 'android/app/build.gradle') -Raw
    $versionMatch = [regex]::Match($buildFile, "versionName\s+'([0-9]+\.[0-9]+\.[0-9]+)'")
    if (-not $versionMatch.Success) { throw 'Cannot identify Android versionName.' }
    $variant = $Configuration.ToLowerInvariant()
    $sourceApk = Join-Path $ProjectRoot "android/app/build/outputs/apk/$variant/app-$variant.apk"
    if ($Configuration -eq 'Release') {
        $verifier = Get-ChildItem -LiteralPath (Join-Path $SdkPath 'build-tools') -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'apksigner.bat' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if (-not $verifier) { throw 'apksigner was not found in Android SDK build-tools.' }
        $verification = & $verifier verify --verbose --print-certs $sourceApk 2>&1
        if ($LASTEXITCODE -ne 0 -or -not (($verification -join "`n") -match 'certificate SHA-256 digest: 3a7b3de62c96fbb3dd5f5eb26c02bfe88efa1de88b09175cf83a58fb3a2641b9')) { throw 'Release certificate differs from the existing Qingke app; refusing incompatible output.' }
    }
    $OutputDirectory = Join-Path $ProjectRoot 'dist'
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $Apk = Join-Path $OutputDirectory ('qingke-' + $versionMatch.Groups[1].Value + '-' + $variant + '.apk')
    Copy-Item -LiteralPath $sourceApk -Destination $Apk -Force
    Write-Output "APK: $Apk"
    Write-Output ('SHA256: ' + (Get-FileHash -LiteralPath $Apk -Algorithm SHA256).Hash.ToLowerInvariant())
} finally {
    if ($directoryPushed) { Pop-Location }
    foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
