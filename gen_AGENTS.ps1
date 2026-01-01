<# 
保存为：gen_AGENTS.ps1
推荐运行：
  powershell -NoProfile -ExecutionPolicy Bypass -File .\gen_AGENTS.ps1
#>

[CmdletBinding()]
param(
  [switch]$SkipRename
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p  = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Fail($msg) {
  Write-Host "[ERROR] $msg" -ForegroundColor Red
  throw $msg
}

# 脚本自身路径/目录（永远以这个目录作为工作目录）
$scriptPath = $MyInvocation.MyCommand.Path
if (-not $scriptPath) {
  Fail "无法获取脚本路径。请用：powershell -File .\gen_AGENTS.ps1 方式运行（不要 dot-sourcing）。"
}
$scriptDir = Split-Path -Parent $scriptPath

# 强制把当前会话工作目录切到脚本目录（避免你从别的目录调用导致偏差）
Set-Location -LiteralPath $scriptDir

# 记录日志到脚本目录
$logPath = Join-Path $scriptDir "gen_AGENTS.log"
try { Start-Transcript -Path $logPath -Append | Out-Null } catch {}

Write-Host "[INFO] 脚本路径：$scriptPath"
Write-Host "[INFO] 工作目录(固定)：$scriptDir"
Write-Host "[INFO] 日志输出：$logPath"

# --- Step 1: 确保 AGENTS.md 存在（必要时从 CLAUDE/GEMINI/IFLOW 重命名） ---
$agents = Join-Path $scriptDir 'AGENTS.md'

if (-not $SkipRename) {
  if (-not (Test-Path -LiteralPath $agents -PathType Leaf)) {
    $candidates = @('CLAUDE.md', 'GEMINI.md', 'IFLOW.md') | ForEach-Object { Join-Path $scriptDir $_ }
    $found = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1

    if (-not $found) {
      Fail "未找到 AGENTS.md，且 CLAUDE.md / GEMINI.md / IFLOW.md 均不存在，退出。"
    }

    Write-Host "[INFO] 找到：$(Split-Path -Leaf $found)，重命名为 AGENTS.md"
    Rename-Item -LiteralPath $found -NewName 'AGENTS.md' -Force
  } else {
    Write-Host "[INFO] 已存在 AGENTS.md，跳过重命名。"
  }
} else {
  if (-not (Test-Path -LiteralPath $agents -PathType Leaf)) {
    Fail "SkipRename 模式下未找到 AGENTS.md，无法继续。"
  }
}

# --- Step 2: 需要管理员权限执行删除与重建链接 ---
if (-not (Test-IsAdmin)) {
  Write-Host "[INFO] 正在申请管理员权限以执行删除与重建符号链接..." -ForegroundColor Yellow

  # 关键：WorkingDirectory 固定为脚本目录；参数加 -NoExit 便于看错误
  $argLine = '-NoProfile -ExecutionPolicy Bypass -NoExit -File "{0}" -SkipRename' -f $scriptPath
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -WorkingDirectory $scriptDir -ArgumentList $argLine

  try { Stop-Transcript | Out-Null } catch {}
  return
}

# --- 管理员阶段：再次确保处于脚本目录（RunAs 有时会改变初始位置） ---
Set-Location -LiteralPath $scriptDir

if (-not (Test-Path -LiteralPath $agents -PathType Leaf)) {
  Fail "管理员阶段未找到 AGENTS.md，无法创建符号链接。"
}

$targets = @('CLAUDE.md', 'GEMINI.md', 'IFLOW.md')

foreach ($name in $targets) {
  $path = Join-Path $scriptDir $name

  if (Test-Path -LiteralPath $path) {
    Write-Host "[INFO] 删除：$name"
    Remove-Item -LiteralPath $path -Force
  }

  Write-Host "[INFO] 创建符号链接：$name -> .\AGENTS.md"
  New-Item -ItemType SymbolicLink -Path $path -Target (Join-Path $scriptDir 'AGENTS.md') | Out-Null
}

Write-Host "[DONE] 完成：删除并重建 CLAUDE/GEMINI/IFLOW 符号链接。" -ForegroundColor Green
Write-Host "[DONE] 检查日志：$logPath" -ForegroundColor Green

try { Stop-Transcript | Out-Null } catch {}
