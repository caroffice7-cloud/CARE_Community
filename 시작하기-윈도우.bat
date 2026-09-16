@echo off
chcp 65001 > nul
title 보성군 통합돌봄 주문관리 시스템
cd /d "%~dp0"

echo.
echo  ============================================
echo   보성군 통합돌봄 주문관리 시스템
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [설치 필요] Node.js 가 없습니다.
  echo.
  echo   1. https://nodejs.org 에 접속
  echo   2. 왼쪽의 LTS 버전 내려받아 설치 ^(계속 "다음"만 누르면 됩니다^)
  echo   3. 설치가 끝나면 이 파일을 다시 실행
  echo.
  pause
  exit /b
)

for /f "tokens=1 delims=." %%v in ('node -v') do set NODEMAJOR=%%v
set NODEMAJOR=%NODEMAJOR:v=%
if %NODEMAJOR% LSS 22 (
  echo  [버전 확인] 설치된 Node.js 가 너무 낮습니다.
  node -v
  echo  https://nodejs.org 에서 LTS 버전으로 다시 설치해 주세요.
  echo.
  pause
  exit /b
)

rem 운영자 첫 로그인 정보 (내 PC 검토용)
set ADMIN_PASSWORD=boseong2026
set PORT=3000

rem node:sqlite 를 옵션 없이 쓸 수 있는지 확인
node -e "require('node:sqlite')" >nul 2>nul
if errorlevel 1 (set NODEOPT=--experimental-sqlite) else (set NODEOPT=)

echo  잠시 뒤 브라우저가 자동으로 열립니다.
echo.
echo   고객 화면   http://localhost:3000/
echo   운영자 화면 http://localhost:3000/admin   ^(아이디 admin / 비밀번호 boseong2026^)
echo.
echo  === 이 검은 창을 닫으면 프로그램이 종료됩니다 ===
echo.

start "" /b cmd /c "timeout /t 3 >nul && start http://localhost:3000/"
node %NODEOPT% server.js

echo.
echo  프로그램이 종료되었습니다.
pause
