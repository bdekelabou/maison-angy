@echo off
title Maison Angy - Gestionnaire & Boutique
echo ========================================================
echo         LANCEMENT DU SYSTEME MAISON ANGY
echo ========================================================
echo.
echo Demarrage du serveur local...
cd /d "%~dp0"

start "" cmd /c "node server.js"

timeout /t 2 >nul

echo Ouverture du Back-Office Gestionnaire...
start http://localhost:3000/admin

echo Ouverture de la Boutique Cliente...
start http://localhost:3000/

echo.
echo ========================================================
echo  L'application est prete et tourne en arriere-plan !
echo  - Gestionnaire (Zoho Style) : http://localhost:3000/admin
echo  - Boutique Cliente           : http://localhost:3000/
echo ========================================================
echo Vous pouvez reduire cette fenetre.
pause
