$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$agentsPath = Join-Path $projectRoot 'AGENTS.md'
if (-not (Test-Path -LiteralPath $agentsPath -PathType Leaf)) {
    throw 'AGENTS.md is missing.'
}

$content = Get-Content -LiteralPath $agentsPath -Raw -Encoding UTF8
$requiredLines = @(
    '# 注意事项',
    '- 每次改动完成后，都必须创建一个对应的 Git commit，以便后续追踪和回滚。',
    '- 每次改动后，都必须编写或更新相关测试，并在交付给用户前，确保所有测试和验证全部通过。'
)
foreach ($line in $requiredLines) {
    if (-not ($content -split '\r?\n').Contains($line)) {
        throw "Missing required instruction: $line"
    }
}

Write-Output 'PASS: AGENTS.md contains all required instructions.'
