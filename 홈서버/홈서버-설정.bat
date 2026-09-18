@echo off
chcp 65001 > nul
title 홈서버 설정 - 보성군 통합돌봄 주문관리
cd /d "%~dp0.."

set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set LINK=%STARTUP%\보성-통합돌봄-홈서버.bat

:menu
cls
echo.
echo  ============================================
echo   홈서버 설정 - 보성군 통합돌봄 주문관리
echo  ============================================
echo.
if exist "%LINK%" (echo   현재 상태 : 컴퓨터를 켜면 자동으로 시작됩니다) else (echo   현재 상태 : 자동 시작이 꺼져 있습니다)
echo.
echo   [1] 컴퓨터 켤 때 자동으로 시작하게 하기
echo   [2] 자동 시작 끄기
echo   [3] 지금 바로 백업하기
echo   [4] 상태 확인 ^(서버가 살아 있는지, 마지막 백업이 언제인지^)
echo   [5] 설정 파일 열기 ^(포트 · 백업 시각 변경^)
echo   [6] 백업 폴더 열기
echo   [0] 닫기
echo.
set /p SEL=  번호를 누르고 Enter :

if "%SEL%"=="1" goto on
if "%SEL%"=="2" goto off
if "%SEL%"=="3" goto backup
if "%SEL%"=="4" goto status
if "%SEL%"=="5" goto config
if "%SEL%"=="6" goto folder
if "%SEL%"=="0" exit /b
goto menu

:on
> "%LINK%" echo @echo off
>> "%LINK%" echo start "" /min "%~dp0홈서버-켜기.bat"
echo.
echo   자동 시작을 켰습니다.
echo   다음에 컴퓨터를 켜고 로그인하면 홈서버가 최소화된 창으로 뜹니다.
echo.
pause
goto menu

:off
if exist "%LINK%" del "%LINK%"
echo.
echo   자동 시작을 껐습니다.
echo.
pause
goto menu

:backup
echo.
node "홈서버\홈서버.js" --backup-now
echo.
pause
goto menu

:status
echo.
node "홈서버\홈서버.js" --status
pause
goto menu

:config
if not exist "홈서버\설정.json" node "홈서버\홈서버.js" --status >nul 2>nul
start notepad "홈서버\설정.json"
echo.
echo   설정을 바꾼 뒤에는 홈서버를 껐다 켜야 반영됩니다.
echo.
pause
goto menu

:folder
if not exist "홈서버\backups" mkdir "홈서버\backups"
start explorer "%~dp0backups"
goto menu
