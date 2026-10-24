#!/bin/sh
# Runs inside the MinIO container (deploy.sh pipes it in), or in a one-shot
# container next to it (docker-compose.yml at the repo root, with MINIO_URL
# set). Idempotent: creates the environment's bucket and the app's own access
# key, limited by policy to objects in that one bucket. The root login is
# never given to an application. Credentials come from the container's
# environment, never argv.
set -eu
export MC_CONFIG_DIR=/tmp/.mc

mc alias set local "${MINIO_URL:-http://127.0.0.1:9000}" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc mb --ignore-existing "local/$VERTEX_S3_BUCKET" >/dev/null
mc anonymous set none "local/$VERTEX_S3_BUCKET" >/dev/null

# Read, write and delete objects in this bucket; list it (so a missing object
# is a clean 404). Nothing else: no other buckets, no bucket or admin changes.
policy=/tmp/vertex-app-policy.json
cat > "$policy" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::$VERTEX_S3_BUCKET/*"] },
    { "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::$VERTEX_S3_BUCKET"] }
  ]
}
EOF
mc admin policy create local vertex-app "$policy" >/dev/null
rm -f "$policy"

mc admin user add local "$VERTEX_S3_ACCESS_KEY_ID" "$VERTEX_S3_SECRET_ACCESS_KEY" >/dev/null
# Match the PolicyName line only: the key's own name contains "vertex-app".
if ! mc admin user info local "$VERTEX_S3_ACCESS_KEY_ID" | grep -qE '^PolicyName:.*(^|[ ,])vertex-app([ ,]|$)'; then
  mc admin policy attach local vertex-app --user "$VERTEX_S3_ACCESS_KEY_ID" >/dev/null
fi
rm -rf "$MC_CONFIG_DIR"
