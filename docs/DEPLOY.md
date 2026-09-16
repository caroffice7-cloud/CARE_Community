# 서버에 올리는 방법

이 문서는 개발자가 아닌 분이 따라 할 수 있도록 쓴 실제 배포 절차입니다.
필요한 것은 **Node.js 22.13 이상을 설치할 수 있는 리눅스 서버 한 대**뿐입니다.

권장: 카페24 Node.js 호스팅, AWS Lightsail, Naver Cloud, Vultr 등 월 1만원 내외의 소형 서버.
어르신 수십 명 규모에서는 가장 작은 사양(1 vCPU / 1GB)으로 충분합니다.

---

## 1. 준비물

| 항목 | 설명 |
| --- | --- |
| 서버 | Ubuntu 22.04 이상 권장 |
| 도메인 | 예) care.hismakers.kr — 없으면 IP로도 접속 가능하지만 HTTPS를 위해 권장 |
| 관리자 비밀번호 | 운영에 쓸 비밀번호를 미리 정해 두십시오 |

---

## 2. 설치

서버에 접속한 뒤 순서대로 실행합니다.

```bash
# Node.js 22 설치 (Ubuntu 기준)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node --version        # v22.13 이상인지 확인

# 소스 내려받기
sudo mkdir -p /opt/care && sudo chown $USER /opt/care
git clone https://github.com/caroffice7-cloud/CARE_Community.git /opt/care
cd /opt/care
```

---

## 3. 환경 설정

`.env.example` 을 보고 실제 값을 정합니다. 이 프로그램은 환경변수를 직접 읽으므로
systemd 서비스 파일에 값을 적어 넣는 방식이 가장 간단합니다.

| 변수 | 설명 |
| --- | --- |
| `ADMIN_PASSWORD` | 운영자 화면 비밀번호 — **반드시 바꾸십시오** |
| `PORT` | 서버 포트 (기본 3000) |
| `DB_PATH` | 데이터베이스 파일 경로 (기본 `data/care.db`) |
| `SECURE_COOKIE` | HTTPS로 운영하면 `1` |

---

## 4. 서비스로 등록 (항상 켜져 있게)

```bash
sudo tee /etc/systemd/system/care.service > /dev/null <<'EOF'
[Unit]
Description=보성군 통합돌봄 주문관리 시스템
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/care
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=SECURE_COOKIE=1
Environment=ADMIN_PASSWORD=여기에_실제_비밀번호

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now care
sudo systemctl status care          # active (running) 인지 확인
```

로그 확인: `sudo journalctl -u care -f`

---

## 5. HTTPS 연결 (도메인이 있는 경우)

개인정보(이름·연락처·주소·건강 관련 정보)를 다루므로 **HTTPS는 선택이 아니라 필수**입니다.

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx

sudo tee /etc/nginx/sites-available/care > /dev/null <<'EOF'
server {
    server_name care.example.kr;          # 실제 도메인으로 바꾸십시오
    client_max_body_size 4m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/care /etc/nginx/sites-enabled/care
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d care.example.kr   # 인증서 자동 발급·갱신
```

`X-Forwarded-For` 를 넘겨 주어야 개인정보 동의 기록에 접속 IP가 올바로 남습니다.

---

## 6. 백업 (중요)

모든 데이터는 `data/care.db` 파일 하나에 들어 있습니다. 이 파일만 지키면 됩니다.

```bash
sudo tee /opt/care/backup.sh > /dev/null <<'EOF'
#!/bin/bash
set -e
STAMP=$(date +%Y%m%d-%H%M)
DEST=/opt/care/backups
mkdir -p "$DEST"
# 실행 중에도 안전하게 복사하려면 sqlite3 의 백업 명령을 쓴다
sqlite3 /opt/care/data/care.db ".backup '$DEST/care-$STAMP.db'"
gzip -f "$DEST/care-$STAMP.db"
# 30일 지난 백업은 삭제
find "$DEST" -name 'care-*.db.gz' -mtime +30 -delete
EOF
sudo chmod +x /opt/care/backup.sh
sudo apt-get install -y sqlite3

# 매일 새벽 3시 자동 백업
( crontab -l 2>/dev/null; echo "0 3 * * * /opt/care/backup.sh" ) | crontab -
```

**백업 파일은 반드시 서버 밖(구글 드라이브, 외장 하드 등)에도 주기적으로 옮겨 두십시오.**
서버가 통째로 사라지면 서버 안의 백업도 함께 사라집니다.

---

## 7. 업데이트

```bash
cd /opt/care
git pull
sudo systemctl restart care
```

데이터베이스는 그대로 유지되며, 새로 추가된 항목이 있으면 시작할 때 자동으로 반영됩니다.

---

## 8. 운영 전 점검표

- [ ] `ADMIN_PASSWORD` 를 기본값(`boseong2026`)에서 바꿨는가
- [ ] HTTPS(`https://`)로 접속되는가, `SECURE_COOKIE=1` 을 켰는가
- [ ] 생활장터 가격표 30개 품목을 **실제 매입가**로 바꿨는가 (샘플 단가가 들어 있습니다)
- [ ] 돌봄 메뉴 항목의 **원가**를 입력했는가 (비워 두면 정산 마진이 과대 계상됩니다)
- [ ] 자동 백업이 도는지 확인했는가 (`ls /opt/care/backups`)
- [ ] 백업을 서버 밖으로 옮기는 방법을 정했는가
- [ ] 개인정보 처리방침·수집 동의 문구를 실제 운영 내용에 맞게 검토했는가

---

## 9. 서버리스(Vercel 등)에 올리려면

현재 구조는 서버가 계속 켜져 있고 파일로 데이터베이스를 쓰는 방식입니다.
Vercel 같은 서버리스에서는 파일이 유지되지 않으므로 그대로는 동작하지 않습니다.

옮기려면 `src/db.js` 한 파일만 외부 데이터베이스(Postgres 등)용으로 바꾸면 됩니다.
다른 코드는 모두 `get / all / run / tx` 네 개의 함수만 쓰도록 분리해 두었습니다.
