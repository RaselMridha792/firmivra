Add-Type -AssemblyName System.Drawing
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$taskCases = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'exact/bounds.json') -Raw | ConvertFrom-Json
foreach ($taskCase in $taskCases) {
  $taskSource = [Drawing.Bitmap]::FromFile((Join-Path $taskRoot ('docs/mockups/' + $taskCase.reference)))
  $taskResult = [Drawing.Bitmap]::FromFile((Join-Path $PSScriptRoot ('exact/' + $taskCase.name + '.png')))
  $taskPair = [Drawing.Bitmap]::new(($taskSource.Width + $taskResult.Width + 16), ([Math]::Max($taskSource.Height, $taskResult.Height) + 48))
  $taskGraphics = [Drawing.Graphics]::FromImage($taskPair)
  $taskFont = [Drawing.Font]::new('Arial', 18)
  try {
    $taskGraphics.Clear([Drawing.Color]::White)
    $taskGraphics.DrawString('Supplied reference', $taskFont, [Drawing.Brushes]::Black, 12, 12)
    $taskGraphics.DrawString('Rendered HTML - synthetic records', $taskFont, [Drawing.Brushes]::Black, ($taskSource.Width + 28), 12)
    $taskGraphics.DrawImageUnscaled($taskSource, 0, 48)
    $taskGraphics.DrawImageUnscaled($taskResult, ($taskSource.Width + 16), 48)
    $taskPair.Save((Join-Path $PSScriptRoot ('exact/' + $taskCase.name + '-comparison.png')), [Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $taskFont.Dispose()
    $taskGraphics.Dispose()
    $taskPair.Dispose()
    $taskSource.Dispose()
    $taskResult.Dispose()
  }
}
