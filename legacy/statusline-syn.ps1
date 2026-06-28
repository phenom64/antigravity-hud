[Console]::InputEncoding  = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
if ($PSVersionTable.PSVersion.Major -ge 7) { $PSStyle.OutputRendering = "Ansi" }

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

$hudDir = Join-Path $env:USERPROFILE ".gemini\antigravity-cli"
try { Set-Content -Path (Join-Path $hudDir "statusline-last.json") -Value $raw -Encoding utf8 } catch {}

try { $j = $raw | ConvertFrom-Json } catch { Write-Output "Antigravity HUD: bad json"; exit 0 }

function FirstValue {
  foreach ($v in $args) {
    if ($null -ne $v -and "$v" -ne "") { return $v }
  }
  return $null
}

$SEP   = [string][char]0x2502
$DOT   = [string][char]0x25CF
$UP    = [string][char]0x2191
$DOWN  = [string][char]0x2193
$FAST  = [string][char]0x23E9
$WARN  = [string][char]0x26A0
$CHECK = [string][char]0x2714
$TIMES = [string][char]0x00D7
$FULL  = [string][char]0x2588
$EMPTY = [string][char]0x2591

$SPINNER = @(
  [string][char]0x280B,
  [string][char]0x2819,
  [string][char]0x2839,
  [string][char]0x2838,
  [string][char]0x283C,
  [string][char]0x2834,
  [string][char]0x2826,
  [string][char]0x2827,
  [string][char]0x2807,
  [string][char]0x280F
)

function SpinnerFrame {
  $tick = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 120)
  return $script:SPINNER[$tick % $script:SPINNER.Count]
}

function Bar($pct, $len) {
  if ($null -eq $pct) { $pct = 0 }
  $p = [int][math]::Max(0, [math]::Min(100, [double]$pct))
  $filled = [int][math]::Floor(($p / 100) * $len)
  if ($p -gt 0 -and $filled -lt 1) { $filled = 1 }
  return (($script:FULL * $filled) + ($script:EMPTY * ($len - $filled)))
}

function Num($n) {
  if ($null -eq $n) { return "0" }
  $x = [double]$n
  if ($x -ge 1000000) { return ("{0:N1}m" -f ($x / 1000000)).ToLower() }
  if ($x -ge 1000) { return ("{0:N1}k" -f ($x / 1000)).ToLower() }
  return [string][int]$x
}

function ResetIn($sec) {
  if ($null -eq $sec) { return "--" }
  $s = [int]$sec
  $d = [math]::Floor($s / 86400)
  $h = [math]::Floor(($s % 86400) / 3600)
  $m = [math]::Floor(($s % 3600) / 60)
  if ($d -gt 0) { return "${d}d${h}h" }
  if ($h -gt 0) { return "${h}h${m}m" }
  return "${m}m"
}

function QuotaRemaining($q) {
  if ($null -eq $q -or $null -eq $q.remaining_fraction) { return 100 }
  return [int][math]::Round([double]$q.remaining_fraction * 100)
}

function QuotaColour($remaining) {
  if ($remaining -le 0) { return $script:Red }
  if ($remaining -lt 15) { return $script:Red }
  if ($remaining -lt 25) { return $script:Orange }
  if ($remaining -lt 50) { return $script:Amber }
  return $script:Green
}

function QuotaSegment($label, $q, $barLen, $style) {
  $remaining = QuotaRemaining $q
  $reset = ResetIn $q.reset_in_seconds
  $colour = QuotaColour $remaining

  if ($remaining -le 0) {
    if ($style -eq "tiny") {
      return "${script:Gray}${label}${script:R} ${script:Red}${script:WARN} limit${script:R} ${script:Gray}${reset}${script:R}"
    }
    return "${script:Gray}${label}${script:R} ${script:Red}${script:WARN} Limit reached${script:R} ${script:Gray}${reset}${script:R}"
  }

  if ($style -eq "tiny") {
    return "${script:Gray}${label}${script:R} ${colour}${remaining}%${script:R} ${script:Gray}${reset}${script:R}"
  }

  $bar = Bar $remaining $barLen
  return "${script:Gray}${label}${script:R} ${colour}${bar}${script:R} ${script:White}${remaining}%${script:R} ${script:Gray}${reset}${script:R}"
}

function ResolveTranscript($candidate) {
  if ($candidate -and (Test-Path $candidate)) { return $candidate }

  $roots = @(
    (Join-Path $env:USERPROFILE ".gemini\antigravity-cli\brain"),
    (Join-Path $env:USERPROFILE ".gemini\antigravity\brain")
  )

  foreach ($root in $roots) {
    if (Test-Path $root) {
      try {
        $found = Get-ChildItem -Path $root -Filter "transcript.jsonl" -Recurse -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTime -Descending |
          Select-Object -First 1
        if ($found) { return $found.FullName }
      } catch {}
    }
  }

  return $null
}

function RecordTool($category) {
  if (-not $category) { return }
  $script:toolSeq += 1

  if (-not $script:toolCounts.ContainsKey($category)) {
    $script:toolCounts[$category] = 0
  }

  $script:toolCounts[$category] = [int]$script:toolCounts[$category] + 1
  $script:toolLast[$category] = $script:toolSeq
}

function AddTool($name) {
  if (-not $name) { return }
  $n = "$name".ToLowerInvariant()

  if ($n -match "list_permissions|list_dir|view_file") {
    RecordTool "read"
  }
  elseif ($n -match "grep_search|search_web|read_url_content") {
    RecordTool "search"
  }
  elseif ($n -match "write_to_file") {
    RecordTool "write"
  }
  elseif ($n -match "replace_file_content|multi_replace_file_content") {
    RecordTool "edit"
  }
  elseif ($n -match "run_command") {
    RecordTool "bash"
    $script:shellCount += 1
  }
  elseif ($n -match "define_subagent|invoke_subagent|manage_subagents|send_message") {
    RecordTool "agent"
  }
  elseif ($n -match "manage_task|schedule") {
    RecordTool "task"
    $script:taskCount += 1
  }
  elseif ($n -match "ask_question|ask_permission") {
    RecordTool "ask"
  }
  elseif ($n -match "generate_image") {
    RecordTool "image"
  }
}

$esc = [char]27
$R="$esc[0m"; $B="$esc[1m"
$Green="$esc[92m"; $Yellow="$esc[93m"; $Blue="$esc[94m"; $Mag="$esc[95m"; $Cyan="$esc[96m"; $Gray="$esc[90m"; $White="$esc[97m"; $Red="$esc[91m"
$Amber="$esc[93m"
$Orange="$esc[38;5;208m"

$script:R=$R; $script:Green=$Green; $script:Amber=$Amber; $script:Orange=$Orange; $script:Red=$Red; $script:Gray=$Gray; $script:White=$White; $script:WARN=$WARN
$script:CHECK=$CHECK; $script:TIMES=$TIMES; $script:FULL=$FULL; $script:EMPTY=$EMPTY; $script:SPINNER=$SPINNER

$model = FirstValue $j.model.display_name $j.model.id "unknown model"
$project = FirstValue $j.workspace.project_dir $j.workspace.current_dir $j.cwd (Get-Location).Path
$repo = Split-Path $project -Leaf
$cols = [int](FirstValue $j.terminal_width 120)

$layout = "normal"
if ($cols -lt 118) { $layout = "compact" }
if ($cols -lt 92) { $layout = "tiny" }

if ($env:AGY_HUD_LAYOUT -match "normal|compact|tiny") {
  $layout = $env:AGY_HUD_LAYOUT
}

$SEP_PAD = " ${SEP} "
$TOOL_SEP = " ${Yellow}${SEP}${R} "

$barLen = 10
$toolMax = 6

if ($layout -eq "normal") {
  if ($cols -ge 145) { $barLen = 12 }
  if ($cols -ge 180) { $barLen = 16 }
  $toolMax = 6
}
elseif ($layout -eq "compact") {
  $barLen = 8
  $toolMax = 5
}
else {
  $barLen = 0
  $toolMax = 4
}

$branch = ""
$dirty = ""
try {
  $branch = git -C $project branch --show-current 2>$null
  $status = git -C $project status --porcelain 2>$null
  if ($status) { $dirty = "*" }
} catch {}

$state = FirstValue $j.agent_state "idle"

$inTok = FirstValue $j.context_window.total_input_tokens 0
$outTok = FirstValue $j.context_window.total_output_tokens 0
$ctxSize = FirstValue $j.context_window.context_window_size 0
$ctxPct = [int][math]::Round([double](FirstValue $j.context_window.used_percentage 0))

$isThirdParty = "$model" -match "Claude|Opus|Sonnet"
if ($isThirdParty) {
  $q5 = $j.quota.'3p-5h'
  $qw = $j.quota.'3p-weekly'
} else {
  $q5 = $j.quota.'gemini-5h'
  $qw = $j.quota.'gemini-weekly'
}

$script:toolCounts = @{}
$script:toolLast = @{}
$script:toolSeq = 0
$script:shellCount = 0
$script:taskCount = 0

$agentDefined = 0
$agentInvoked = 0
$activeAgents = $null

$transcript = ResolveTranscript $j.transcript_path
if ($transcript -and (Test-Path $transcript)) {
  try {
    $tail = Get-Content $transcript -Tail 320 -ErrorAction SilentlyContinue

    foreach ($line in $tail) {
      try { $entry = $line | ConvertFrom-Json } catch { continue }

      if ($entry.tool_calls) {
        foreach ($tc in $entry.tool_calls) {
          AddTool $tc.name
          $tn = "$($tc.name)".ToLowerInvariant()
          if ($tn -eq "define_subagent") { $agentDefined += 1 }
          if ($tn -eq "invoke_subagent") {
            if ($tc.args.Subagents) { $agentInvoked += $tc.args.Subagents.Count }
            else { $agentInvoked += 1 }
          }
        }
      }

      if ($entry.content -and "$($entry.content)" -match "You have\s+([0-9]+)\s+active subagent") {
        $activeAgents = [int]$Matches[1]
      }
    }
  } catch {}
}

if ($null -ne $activeAgents) { $agentCount = $activeAgents }
elseif ($agentInvoked -gt 0) { $agentCount = $agentInvoked }
elseif ($agentDefined -gt 0) { $agentCount = 0 }
else { $agentCount = 0 }

if ($j.subagents -and $j.subagents.Count -gt 0) { $agentCount = $j.subagents.Count }
if ($j.task_count -and $agentCount -eq 0) { $agentCount = $j.task_count }

$shellCount = [math]::Min(99, $script:shellCount)
$taskCount = [math]::Min(99, $script:taskCount)
$agentCount = [math]::Min(99, $agentCount)

$toolItems = @()
foreach ($k in $script:toolCounts.Keys) {
  $toolItems += [pscustomobject]@{
    Name = $k
    Count = [int]$script:toolCounts[$k]
    Last = [int]$script:toolLast[$k]
  }
}

$selectedTools = $toolItems |
  Sort-Object Last -Descending |
  Select-Object -First $toolMax |
  Sort-Object Last

$toolParts = @()
foreach ($it in $selectedTools) {
  if ($layout -eq "tiny") {
    $toolParts += "${Green}${CHECK}${R}${White}$($it.Name)${R}${Gray}${TIMES}$($it.Count)${R}"
  } else {
    $toolParts += "${Green}${CHECK}${R} ${White}$($it.Name)${R} ${Gray}${TIMES}$($it.Count)${R}"
  }
}

if ($toolParts.Count -eq 0) {
  $toolLine = "${Gray}--${R} ${Yellow}${SEP}${R}"
} else {
  $toolLine = ($toolParts -join $TOOL_SEP) + " ${Yellow}${SEP}${R}"
}

$modeRaw = FirstValue $j.auto_mode $j.planning_mode $j.automation_mode $j.approval_mode $j.mode
if ($null -eq $modeRaw) { $modeText = "--" } else { $modeText = "$modeRaw" }

$quotaStyle = "bar"
if ($layout -eq "tiny") { $quotaStyle = "tiny" }

$ctxBar = ""
if ($layout -eq "tiny") {
  $ctxSegment = "${Gray}ctx${R} ${Green}${ctxPct}%${R} ${Gray}($(Num $inTok)${UP}/$(Num $outTok)${DOWN})${R}"
} else {
  $ctxBar = Bar $ctxPct $barLen
  $ctxSegment = "${Gray}ctx${R} ${Green}${ctxBar}${R} ${White}${B}${ctxPct}%${R} ${Gray}($(Num $inTok) ${UP} / $(Num $outTok) ${DOWN} / $(Num $ctxSize))${R}"
}

$quota5 = QuotaSegment "5h" $q5 $barLen $quotaStyle
$quotaW = QuotaSegment "wk" $qw $barLen $quotaStyle

$stateColour = $Green
$statusGlyph = $DOT

if ($state -match "working|tool|running|thinking|busy") {
  $statusGlyph = SpinnerFrame
  $stateColour = $Cyan
}
elseif ($state -match "thinking") {
  $statusGlyph = SpinnerFrame
  $stateColour = $Yellow
}

$taskPart = ""
if ($taskCount -gt 0) {
  $taskPart = " ${Green}${DOT}${R} ${White}${taskCount} tasks${R}"
}

if ($layout -eq "tiny") {
  $shortModel = $model -replace "Gemini 3.5 Flash", "G3.5 Flash" -replace "Claude Opus 4.6", "Opus 4.6" -replace "Claude Sonnet 4.6", "Sonnet 4.6"
  $line1 = "${Cyan}${B}${shortModel}${R}${SEP_PAD}${Yellow}${repo}${R}"
  if ($branch) { $line1 += " ${Gray}(${Blue}${branch}${dirty}${Gray})${R}" }
  $line1 += "${SEP_PAD}${stateColour}${B}${statusGlyph}${R} ${stateColour}${state}${R}"
  $line2 = "${ctxSegment}${SEP_PAD}${quota5}${SEP_PAD}${quotaW}"
} else {
  $line1 = "${Cyan}${B}${model}${R}${SEP_PAD}${Yellow}${repo}${R}"
  if ($branch) { $line1 += " ${Gray}git:(${Blue}${branch}${dirty}${Gray})${R}" }
  $line1 += "${SEP_PAD}${stateColour}${B}${statusGlyph}${R} ${stateColour}${B}${state}${R}"
  $line2 = "${ctxSegment}${SEP_PAD}${quota5}${SEP_PAD}${quotaW}"
}

$line4 = "${Mag}${FAST}${R} ${Gray}auto mode${R} ${White}${modeText}${R} ${Green}${DOT}${R} ${White}${shellCount} shell${R}${taskPart} ${Green}${DOT}${R} ${White}${agentCount} agents${R}"

[Console]::Out.WriteLine($line1)
[Console]::Out.WriteLine($line2)
[Console]::Out.WriteLine($toolLine)
[Console]::Out.WriteLine($line4)
