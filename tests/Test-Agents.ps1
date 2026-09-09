$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$content = Get-Content -LiteralPath (Join-Path $projectRoot 'AGENTS.md') -Raw -Encoding UTF8
foreach ($pattern in @('Git\s*commit', '编写或更新相关测试', '所有测试和验证全部通过')) {
    if ($content -notmatch $pattern) { throw "Missing project requirement: $pattern" }
}
Write-Output 'PASS: AGENTS.md preserves commit and testing requirements.'
