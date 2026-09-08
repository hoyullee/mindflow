<#
.SYNOPSIS
  MSIX 로컬 설치용 **개발 인증서**를 만들고 신뢰 저장소에 넣는다.

.DESCRIPTION
  Microsoft Store에 올리면 서명은 Microsoft가 해 준다. 하지만 그 전에 손으로
  설치해 보려면 패키지에 **어떤 서명이든** 있어야 하고, 그 서명의 발행자를
  Windows가 신뢰해야 한다. 이 스크립트가 그 둘을 만든다:

    1. `electron-builder.yml`의 `appx.publisher`를 **직접 읽어** 그 값과 똑같은
       Subject로 자가서명 인증서를 만든다. (두 값이 한 글자라도 다르면
       `Add-AppxPackage`가 서명/발행자 불일치로 거절한다 — 그래서 사람이 두 곳에
       적지 않게 여기서 읽는다.)
    2. .pfx(서명용)와 .cer(신뢰용)를 내보내고, .cer를
       `LocalMachine\TrustedPeople`에 넣는다 — MSIX 사이드로드가 보는 저장소다.

  끝나면 패키징·설치 명령을 그대로 붙여 쓸 수 있게 출력한다.

.NOTES
  - **관리자 PowerShell**에서 실행한다(LocalMachine 저장소에 넣어야 한다).
  - 여기서 만든 인증서는 **이 PC에서만** 뜻이 있다. 배포용이 아니다.
  - 만든 .pfx는 `build/dev-cert/`에 남고 git에 올라가지 않는다(.gitignore).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\dev-cert.ps1
#>
[CmdletBinding()]
param(
  # .pfx 암호. 생략하면 무작위로 만들어 출력한다(개발용이므로 기억할 필요 없다).
  [string] $Password
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$configPath = Join-Path $root 'electron-builder.yml'
$outDir = Join-Path $root 'build\dev-cert'

if (-not (Test-Path $configPath)) { throw "electron-builder.yml을 찾을 수 없어요: $configPath" }

# ── 1. publisher를 설정에서 읽는다(정본은 electron-builder.yml 하나다) ──────────
# `publisherDisplayName`이 아니라 `publisher`만 잡아야 하므로 콜론 바로 뒤를 본다.
$publisher = $null
foreach ($line in Get-Content -LiteralPath $configPath) {
  if ($line -match '^\s*publisher:\s*(\S.*?)\s*$') { $publisher = $Matches[1]; break }
}
if (-not $publisher) { throw "electron-builder.yml의 appx.publisher를 읽지 못했어요." }
# YAML의 따옴표는 값이 아니다.
$publisher = $publisher.Trim("'", '"')
Write-Host "publisher (인증서 Subject) : $publisher" -ForegroundColor Cyan

# ── 2. 인증서 — 같은 Subject가 이미 있으면 다시 만들지 않는다 ─────────────────
$cert = Get-ChildItem -Path 'Cert:\CurrentUser\My' |
  Where-Object { $_.Subject -eq $publisher } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if ($cert) {
  Write-Host "이미 있는 인증서를 다시 씁니다 (만료 $($cert.NotAfter.ToString('yyyy-MM-dd')))." -ForegroundColor Yellow
} else {
  # -Type Custom + 두 확장: 코드 서명 EKU(1.3.6.1.5.5.7.3.3)와
  # Basic Constraints(말단 엔티티). MSIX 서명이 요구하는 최소 조합이다.
  $cert = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $publisher `
    -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -FriendlyName 'Geurio MSIX dev signing' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -NotAfter (Get-Date).AddYears(2) `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
  Write-Host "인증서를 만들었어요: $($cert.Thumbprint)" -ForegroundColor Green
}

# ── 3. 내보내기 ───────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (-not $Password) {
  # 개발용이라 기억할 필요가 없다 — 아래에 그대로 출력한다.
  $Password = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(18))
}
$securePwd = ConvertTo-SecureString -String $Password -Force -AsPlainText
$pfxPath = Join-Path $outDir 'geurio-dev.pfx'
$cerPath = Join-Path $outDir 'geurio-dev.cer'

Export-PfxCertificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" -FilePath $pfxPath -Password $securePwd | Out-Null
Export-Certificate  -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" -FilePath $cerPath -Type CERT | Out-Null

# ── 4. 신뢰 — MSIX 사이드로드는 TrustedPeople을 본다 ──────────────────────────
$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if ($admin) {
  Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
  Write-Host '인증서를 LocalMachine\TrustedPeople에 넣었어요.' -ForegroundColor Green
} else {
  Write-Warning @"
관리자 권한이 아니라 신뢰 저장소에 넣지 못했어요. 설치는 이 한 줄이 있어야 됩니다 —
관리자 PowerShell에서:
  Import-Certificate -FilePath "$cerPath" -CertStoreLocation Cert:\LocalMachine\TrustedPeople
"@
}

# ── 5. 다음 명령 ──────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '── 패키징 (이 창에서 그대로) ─────────────────────────────' -ForegroundColor Cyan
Write-Host "`$env:CSC_LINK = '$pfxPath'"
Write-Host "`$env:CSC_KEY_PASSWORD = '$Password'"
Write-Host 'pnpm --filter @mindflow/desktop run pack:appx'
Write-Host ''
Write-Host '── 설치 ──────────────────────────────────────────────────' -ForegroundColor Cyan
Write-Host 'Add-AppxPackage -Path (Get-ChildItem apps\desktop\release\*.appx).FullName'
Write-Host ''
Write-Host '※ CSC_LINK이 설정된 창에서 `pack:win`을 돌리면 .exe도 이 개발 인증서로' -ForegroundColor DarkGray
Write-Host '   서명됩니다(신뢰되지 않는 서명이라 배포용이 아닙니다). 배포용 .exe는' -ForegroundColor DarkGray
Write-Host '   그 변수가 없는 창에서 만드세요.' -ForegroundColor DarkGray
