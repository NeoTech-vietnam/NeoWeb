$ErrorActionPreference = 'Stop'

if (-not $IsWindows) { throw 'This helper is for Windows runners only.' }
if (-not $env:GITHUB_PATH) { throw 'GITHUB_PATH is required to configure subsequent action steps.' }

# Use the Git installation already trusted by checkout, not the WSL app alias.
$gitExecutable = (Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$gitRoot = Split-Path (Split-Path $gitExecutable -Parent) -Parent
$unixTools = Join-Path $gitRoot 'usr/bin'
$bashExecutable = Join-Path $unixTools 'bash.exe'
$tarExecutable = Join-Path $unixTools 'tar.exe'
foreach ($executable in @($bashExecutable, $tarExecutable)) {
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw "Git for Windows Bash and GNU tar are required. Missing: $executable"
    }
}

& $bashExecutable --noprofile --norc -e -o pipefail -c 'echo Git-Bash-ready'
if ($LASTEXITCODE -ne 0) { throw 'Git Bash could not start.' }
$tarVersion = & $tarExecutable --version
if ($LASTEXITCODE -ne 0 -or $tarVersion[0] -notmatch 'GNU tar') {
    throw 'Pages archiving requires GNU tar, not the Windows BSD tar executable.'
}

# Composite actions choose their own shell. GITHUB_PATH affects that resolution;
# defaults.run.shell would not override upload-pages-artifact's shell: bash.
Add-Content -LiteralPath $env:GITHUB_PATH -Value $unixTools -Encoding utf8
Write-Output "Pages archive tools prepared: $unixTools"
