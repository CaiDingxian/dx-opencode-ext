# 创建导出目录
$exportDir = "$env:USERPROFILE\opencode-exports"
New-Item -ItemType Directory -Force -Path $exportDir

# 获取所有 sessions 并逐个导出为 JSON
opencode session list --format json | ConvertFrom-Json | ForEach-Object {
    $sessionId = $_.id
    $projectName = $_.projectSlug -replace '[\\/:*?"<>|]', '_'
    $timestamp = Get-Date -Format "yyyyMMdd"
    $fileName = "$projectName-$sessionId-$timestamp.json"
    
    Write-Host "Exporting: $sessionId"
    opencode export $sessionId 2>$null | Out-File -FilePath "$exportDir\$fileName" -Encoding UTF8
}

Write-Host "All sessions exported to: $exportDir"