$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Assert-GuideIcon($file) {
    $actual = if ([IO.Path]::GetExtension($file) -ieq '.ico') {
        [System.Drawing.Icon]::new($file)
    } else {
        [System.Drawing.Icon]::ExtractAssociatedIcon($file)
    }
    if (!$actual) { throw "No icon was found in $file" }
    $expected = [System.Drawing.Icon]::new((Resolve-Path '.generated/icon.ico').Path, $actual.Size)
    $actualBitmap = $actual.ToBitmap()
    $expectedBitmap = $expected.ToBitmap()
    try {
        $matched = 0
        for ($y = 0; $y -lt $actual.Height; $y++) {
            for ($x = 0; $x -lt $actual.Width; $x++) {
                $a = $actualBitmap.GetPixel($x, $y)
                $e = $expectedBitmap.GetPixel($x, $y)
                if (($a.A -eq 0 -and $e.A -eq 0) -or
                    ([Math]::Abs($a.A - $e.A) -lt 24 -and
                     [Math]::Abs($a.R - $e.R) -lt 24 -and
                     [Math]::Abs($a.G - $e.G) -lt 24 -and
                     [Math]::Abs($a.B - $e.B) -lt 24)) {
                    $matched++
                }
            }
        }
        if ($matched -lt $actual.Width * $actual.Height * 0.8) {
            throw "The icon in $file differs from the guide icon"
        }
    } finally {
        $actualBitmap.Dispose()
        $expectedBitmap.Dispose()
        $actual.Dispose()
        $expected.Dispose()
    }
}

$setup = @(Get-ChildItem 'out/make/squirrel.windows' -Recurse -Filter '*Setup.exe')
if ($setup.Count -ne 1) { throw 'Expected one Squirrel installer' }
Assert-GuideIcon $setup[0].FullName
$installation = Start-Process -FilePath $setup[0].FullName -ArgumentList '--silent' -PassThru
if (!$installation.WaitForExit(90000) -or $installation.ExitCode -ne 0) {
    throw 'Squirrel did not complete the silent installation'
}

$programs = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
$shortcutFile = Get-ChildItem $programs -Recurse -Filter 'foodguide-app.lnk' | Select-Object -First 1
if (!$shortcutFile) { throw 'Food Guide has no Start menu shortcut' }
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutFile.FullName)
$iconPath = [Environment]::ExpandEnvironmentVariables(($shortcut.IconLocation -split ',')[0].Trim('"'))
if (!$iconPath -or !(Test-Path -LiteralPath $iconPath -PathType Leaf)) {
    throw 'The Start menu shortcut does not point to an installed application icon'
}
Assert-GuideIcon $iconPath
$installRoot = Join-Path $env:LOCALAPPDATA 'foodguide_app'
$installedExe = Get-ChildItem $installRoot -Directory -Filter 'app-*' |
    ForEach-Object { Get-ChildItem $_.FullName -Filter 'foodguide-app.exe' } |
    Select-Object -First 1
if (!$installedExe) { throw 'The installed application executable was not found' }
Assert-GuideIcon $installedExe.FullName
Write-Host 'The Squirrel installer, installed executable, and Start menu shortcut use the Food Guide icon.'
