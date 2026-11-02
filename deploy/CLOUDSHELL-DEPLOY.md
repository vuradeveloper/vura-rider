# Deploy from AWS CloudShell

CloudShell is already signed in to account `171180524226`; no access keys are
needed. Run every block from the CloudShell prompt in **af-south-1**.

The deploy ships the code in `server/dist`, and `deploy/deploy.sh` refuses to
run unless `server/dist/build-commit.txt` matches the last commit that touched
the server. For the driver-accept fix that value is `9aa298d`.

## 1. Install the EB CLI (once per CloudShell home)

CloudShell has the AWS CLI but not the Elastic Beanstalk CLI.

```bash
python3 -m venv ~/ebvenv
source ~/ebvenv/bin/activate
python -m pip install -q -U pip awsebcli
eb --version
```

Later shells must re-activate it:

```bash
source ~/ebvenv/bin/activate
```

## 2. Get the deploy branch

If this is the first time, clone it:

```bash
cd ~
[ -d vura-rider/.git ] || git clone https://github.com/vuradeveloper/vura-rider.git vura-rider
cd vura-rider
```

Then pin the checkout to the remote deploy branch. **This discards local
changes in the CloudShell clone**, which is what we want for a clean deploy:

```bash
git fetch origin
git checkout admin-v2-reconciled
git reset --hard origin/admin-v2-reconciled
git log --oneline -3
```

Confirm the build stamp before going further:

```bash
cat server/dist/build-commit.txt     # must print 9aa298d
git log -1 --format=%h -- server/src server/migrations server/package.json server/tsconfig.json
```

Both lines must be `9aa298d`. If not, stop and rebuild `server/dist` locally.

## 3. Point the EB CLI at the app

`.elasticbeanstalk/config.yml` is gitignored, so a fresh clone does not have it.
Create it once per clone:

```bash
mkdir -p .elasticbeanstalk
cat > .elasticbeanstalk/config.yml <<'YAML'
branch-defaults:
  admin-v2-reconciled:
    environment: vura-rider-prod
global:
  application_name: vura-rider
  default_region: af-south-1
  sc: git
  workspace_type: Application
YAML
```

Verify the account before deploying:

```bash
aws sts get-caller-identity
# Account must be 171180524226
```

## 4. Deploy

```bash
export AWS_REGION=af-south-1
bash deploy/deploy.sh
```

The wrapper removes slash-containing local tags, re-checks the dist stamp,
builds a slash-free version label, and runs:

```text
eb deploy vura-rider-prod --region af-south-1 --label vura-<sha>-<UTC timestamp>
```

It takes a few minutes. A successful run ends with `Environment update
completed` and `Update environment operation is complete`.

## 5. Prove the build that is live

```bash
eb status vura-rider-prod --region af-south-1
curl -s https://api.ridevura.com/health
```

`eb status` should show `Health: Green` and the new version label.

The diag endpoint reports the compiled build stamp. Its read key is set in the
EB environment, so read it instead of guessing:

```bash
KEY=$(eb printenv vura-rider-prod --region af-south-1 | awk -F' = ' '/DEV_LOG_READ_KEY/{print $2}')
[ -n "$KEY" ] || KEY=vura-devlog-key
curl -s "https://api.ridevura.com/api/dev/diag?key=$KEY" \
  | python3 -c 'import json,sys; b=json.load(sys.stdin)["build"]; print("commit", b.get("commit"), "builtAt", b.get("builtAt"))'
```

Expected: `commit 9aa298d`. If it still shows an older hash, the deploy did not
land; check `eb events vura-rider-prod` before retrying.

## 6. Functional checks (after the deploy)

These need the rider and driver apps on a test device.

1. **Rider continuity:** request a ride, then background the app while the
   search is running (including after `no_drivers`). Reopen it. The matching
   screen must return with the same ride and no second booking.
2. **Cancelled ride:** cancel while a driver holds an offer. The driver app must
   not reopen that ride, and must discard a poll response that raced the
   cancellation.
3. **Fresh offer:** a new request must still reach an online driver normally.

## Rollback

List the most recent versions:

```bash
aws elasticbeanstalk describe-application-versions \
  --application-name vura-rider --region af-south-1 \
  --query 'reverse(sort_by(ApplicationVersions,&DateCreated))[:8].[VersionLabel,DateCreated,Status]' \
  --output table
```

Redeploy the previous label:

```bash
eb deploy vura-rider-prod --region af-south-1 --version <previous-version-label>
```

No database migration and no environment-property change are part of this
deploy, so a rollback is code-only.
