# Exports the RealV workbook tables to data/excel/*.json so `npm run import:excel` can load them.
# Usage:  powershell -File scripts/export-excel.ps1 -Workbook "C:\path\RealV.xlsb"
# Employee personal data (PAN, Aadhaar, bank, family, salary) is NOT exported.
param([Parameter(Mandatory = $true)][string]$Workbook)

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "data\excel"
New-Item -ItemType Directory -Force $out | Out-Null

$empKeep = @('Emp','ReportingHead','Director','Status','Branch','Type','RevShare','ExpShare','DOJ','ChangeDateFrom','ChangeDateTo','Designation','Personal Mail ID')
$tables = [ordered]@{ Bkg='Bkg'; Exp='Exp'; Emp='Emp'; RCRAMaster='Master'; ExpType='Master'; OverrideRules='Master'; Project='Master'; Inventory='Master'; PriceList='Master' }

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AutomationSecurity = 3
try {
  $wb = $xl.Workbooks.Open($Workbook, 0, $true)
  foreach ($t in $tables.Keys) {
    $lo = $wb.Worksheets.Item($tables[$t]).ListObjects.Item($t)
    $hdr = @($lo.HeaderRowRange.Value2)
    $rows = New-Object System.Collections.Generic.List[object]
    if ($lo.DataBodyRange -ne $null) {
      $v = $lo.DataBodyRange.Value2
      for ($r = 1; $r -le $lo.ListRows.Count; $r++) {
        $o = [ordered]@{}
        for ($c = 1; $c -le $hdr.Count; $c++) {
          $name = $hdr[$c - 1]
          if ($t -eq 'Emp' -and $empKeep -notcontains $name) { continue }
          $x = $v[$r, $c]; if ($x -is [int]) { $x = [double]$x }
          $o[$name] = $x
        }
        $rows.Add($o)
      }
    }
    [IO.File]::WriteAllText((Join-Path $out "$t.json"), ($rows | ConvertTo-Json -Depth 3 -Compress), (New-Object Text.UTF8Encoding $false))
    Write-Output "$t : $($rows.Count) rows"
  }
  $wb.Close($false)
} finally { $xl.Quit() }
