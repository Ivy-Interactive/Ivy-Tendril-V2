param (
    [Parameter(Mandatory=$true)]
    [string]$TargetFile
)

Write-Host "==> Checking Windows Authenticode Signing Credentials..."

if (-not $env:WINDOWS_CERTIFICATE_THUMBPRINT -and -not $env:WINDOWS_CERT_PATH) {
    Write-Warning "WINDOWS_CERTIFICATE_THUMBPRINT or WINDOWS_CERT_PATH not defined. Skipping signing with diagnostic warning."
    exit 0
}

$SigntoolPath = "signtool.exe"
if ($env:SIGNTOOL_PATH) {
    $SigntoolPath = $env:SIGNTOOL_PATH
}

Write-Host "==> Signing $TargetFile with Authenticode certificate..."

if ($env:WINDOWS_CERTIFICATE_THUMBPRINT) {
    & $SigntoolPath sign /sha1 $env:WINDOWS_CERTIFICATE_THUMBPRINT /fd SHA256 /tr "http://timestamp.digicert.com" /td SHA256 $TargetFile
} elseif ($env:WINDOWS_CERT_PATH) {
    & $SigntoolPath sign /f $env:WINDOWS_CERT_PATH /p $env:WINDOWS_CERT_PASSWORD /fd SHA256 /tr "http://timestamp.digicert.com" /td SHA256 $TargetFile
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "Signtool failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "==> Windows Authenticode signing completed successfully."
