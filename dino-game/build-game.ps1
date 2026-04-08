# Build and export Dino Game
Set-Location -Path "C:\Users\adamm\Jurassic_Survival\dino-game"

Write-Host "Building Dino Game..." -ForegroundColor Cyan

npm run build

$source = "C:\Users\adamm\Jurassic_Survival\dino-game\dist"
$destination = "C:\Users\adamm\Jurassic_Survival\dino-game\DINO-GAME-READY-TO-PLAY"

if (Test-Path $destination) {
    Remove-Item $destination -Recurse -Force
}

New-Item -ItemType Directory -Path $destination | Out-Null
Copy-Item -Path "$source\*" -Destination $destination -Recurse

Write-Host ""
Write-Host "Done. Your game is in:" -ForegroundColor Green
Write-Host $destination -ForegroundColor Yellow
Write-Host ""
Write-Host "Copy that folder to a USB and run the .exe inside it." -ForegroundColor White