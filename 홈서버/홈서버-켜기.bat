@echo off
chcp 65001 > nul
title 홈서버 - 보성군 통합돌봄 주문관리
cd /d "%~dp0.."

echo.
echo  ============================================
echo   홈서버 - 보성군 통합돌봄 주문관리
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

node "홈서버\홈서버.js"

echo.
echo  홈서버가 종료되었습니다.
pause
