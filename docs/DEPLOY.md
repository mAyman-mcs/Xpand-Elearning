# Deployment runbook (AWS EC2)

How to run the portal on one EC2 instance with Docker, from a fresh host to routine upgrades. Follow it top to bottom for a first deployment.

The stack (`docker-compose.yml`):

```
Internet ──443/80──► caddy (HTTPS, Let's Encrypt) ──► app :8080 ──► db (Postgres 17, volume pgdata)
                                         migrate (one-shot) ──┘
```

On every `docker compose up`, the `migrate` container applies pending migrations and exits. The app starts only if that succeeded.

Only Caddy publishes ports. The app and the database are reachable only on Docker's private network.

---

## 1. One-time host setup

1. **Instance:** Ubuntu 24.04 LTS, at least 2 vCPU / 4 GB RAM (t3.medium), 30 GB gp3 disk.
2. **Security group (inbound):**

   | Port | Source | Why |
   |---|---|---|
   | 443 TCP + UDP | 0.0.0.0/0 | HTTPS (UDP for HTTP/3) |
   | 80 TCP | 0.0.0.0/0 | Certificate issuance and the redirect to HTTPS |
   | 22 TCP | Your office/VPN IP only | SSH |

   Never open 5432 (Postgres) or 8080 (app).
3. **IAM instance role** (only for the optional features):
   - S3 backups: `s3:PutObject` and `s3:GetObject` on the backup bucket prefix.
   - CloudWatch logs: `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`.
4. **DNS:** an `A` record for the portal hostname pointing at the instance's Elastic IP. Caddy needs it in place before the first start to get a certificate.
5. **Software:**
   ```sh
   sudo apt-get update && sudo apt-get install -y ca-certificates curl git awscli
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker "$USER"   # log out and back in
   ```

## 2. First deployment

```sh
sudo mkdir -p /opt/xpand && sudo chown "$USER" /opt/xpand
git clone https://github.com/mAyman-mcs/Xpand-Elearning.git /opt/xpand
cd /opt/xpand
cp .env.example .env && chmod 600 .env
```

Edit `.env`:
- `DOMAIN`: the hostname from step 1.4.
- `POSTGRES_PASSWORD`: generate one with `openssl rand -base64 32`, and use the same value inside `DATABASE_URL`.
- `TRUST_PROXY=1` and `COOKIE_SECURE=true`. Keep both as given; Caddy sits in front of the app.

Start the stack:

```sh
docker compose up -d --build
docker compose ps -a       # migrate "exited (0)"; db, app, caddy running; app becomes "healthy"
curl -fsS https://$DOMAIN/api/health/ready
```

Migrations run in the `migrate` service; read its output with `docker compose logs migrate`.

Create the first super admin; the temporary password is printed once:

```sh
docker compose exec app node dist/scripts/create-super-admin.js --username admin --name "Full Name"
```

Import students: copy the CSV to the host (never commit it), then:

```sh
docker compose cp students.csv app:/tmp/students.csv
docker compose exec app node dist/scripts/import-users.js --file /tmp/students.csv --out /tmp
docker compose cp app:/tmp/. ./imports/        # credentials-*.csv: hand out, then delete
docker compose exec app sh -c 'rm -f /tmp/students.csv /tmp/credentials-*.csv'
```

## 3. Logs and monitoring

- **Local:** `docker compose logs -f app`. Logs are JSON, one line per request, with a request ID. Passwords, tokens and cookies are redacted.
- **CloudWatch (optional):**
  ```sh
  docker compose -f docker-compose.yml -f docker-compose.aws.yml up -d
  ```
  The log group defaults to `xpand-portal`, in `AWS_REGION`.
- **Health:** `/api/health/live` (the process is up) and `/api/health/ready` (the database answers). Point an uptime monitor at `https://$DOMAIN/api/health/ready`.

## 4. Backups

Nightly cron entry (`crontab -e` as the deploy user):

```
15 2 * * *  cd /opt/xpand && ops/backup.sh >> backups/backup.log 2>&1
```

- The backup is a compressed `pg_dump`, checked for readability, kept 7 days in `backups/`, and uploaded to `BACKUP_S3_URI` when that is set.
- Configure an S3 lifecycle rule that expires objects after 30 days.

**Restore test (every release, and after any change to backups):**

```sh
ops/restore-test.sh "$(ls -t backups/*.dump | head -1)"
# or straight from S3:
ops/restore-test.sh s3://your-bucket/xpand-portal/xpand-20261002T021500Z.dump
```

It must end with `RESTORE TEST PASSED`. A backup that has never been restored isn't a backup.

**Real restore (disaster recovery):**

```sh
docker compose stop app
docker compose exec -T db dropdb -U "$POSTGRES_USER" "$POSTGRES_DB"
docker compose exec -T db createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner < backups/xpand-<stamp>.dump
docker compose start app
```

## 5. Upgrades

```sh
cd /opt/xpand
ops/backup.sh                      # always back up first
git fetch && git checkout <release tag or commit>
docker compose up -d --build       # migrate runs first; the app waits for it
docker compose ps && curl -fsS https://$DOMAIN/api/health/ready
```

**Rollback:** check out the previous release and run `docker compose up -d --build`. If the new release ran a migration that the old code can't work with, restore the pre-upgrade backup (§4). This is why every destructive schema change ships in two releases (stop using the column first, drop it in a later release).

## 6. Routine checks

| When | What |
|---|---|
| Daily (automatic) | Backup cron; uptime monitor on `/api/health/ready` |
| Every release | Restore test; read `docker compose logs app` for errors after the deployment |
| Monthly | `sudo apt-get upgrade`, then reboot the host; `docker compose pull caddy db && docker compose up -d` |
| Quarterly | Review super admins and instructor grants (`GET /api/rbac/grants`); remove what is no longer needed |

## 7. Troubleshooting

| Symptom | Check |
|---|---|
| Browser certificate errors | DNS points at the instance; ports 80/443 are open; `docker compose logs caddy` |
| `app` restarting | `docker compose logs app`: usually a `.env` mistake (config validation names the field) or the database is unreachable |
| `app` never starts | `docker compose logs migrate`: a migration failed; the app deliberately waits for a successful migration |
| Everyone's IP is the same in the audit log | `TRUST_PROXY=1` is missing |
| Login works over HTTP but not HTTPS | `COOKIE_SECURE` must be `true` behind Caddy (and `false` only for plain-HTTP test hosts) |
| `prisma migrate` "advisory lock" timeout | Another migration is still running (or hung). Find it with `SELECT pid, query FROM pg_stat_activity WHERE query LIKE '%advisory%'` and stop it |
