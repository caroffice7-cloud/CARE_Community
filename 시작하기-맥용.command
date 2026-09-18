#!/bin/bash
cd "$(dirname "$0")"

echo
echo " ============================================"
echo "  보성군 통합돌봄 주문관리 시스템"
echo " ============================================"
echo

if ! command -v node > /dev/null 2>&1; then
  echo " [설치 필요] Node.js 가 없습니다."
  echo "   https://nodejs.org 에서 LTS 버전을 내려받아 설치한 뒤 다시 실행해 주세요."
  echo
  read -n 1 -s -r -p " 아무 키나 누르면 닫힙니다."
  exit 1
fi

MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$MAJOR" -lt 22 ]; then
  echo " [버전 확인] Node.js $(node -v) 는 너무 낮습니다. LTS 버전으로 다시 설치해 주세요."
  read -n 1 -s -r -p " 아무 키나 누르면 닫힙니다."
  exit 1
fi

export ADMIN_PASSWORD=boseong2026
export PORT=3000

NODEOPT=""
node -e "require('node:sqlite')" > /dev/null 2>&1 || NODEOPT="--experimental-sqlite"

echo " 잠시 뒤 브라우저가 자동으로 열립니다."
echo
echo "   고객 화면   http://localhost:3000/"
echo "   운영자 화면 http://localhost:3000/admin   (아이디 admin / 비밀번호 boseong2026)"
echo
echo " === 이 창을 닫으면 프로그램이 종료됩니다 ==="
echo

( sleep 3; open http://localhost:3000/ ) &
node $NODEOPT server.js
