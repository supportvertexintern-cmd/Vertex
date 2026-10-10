#!/bin/sh
# Prints the Go linker flags that stamp a release into a MinIO binary, the
# way upstream builds do, so `minio --version` shows the real release.
#   ldflags.sh <minio|mc> <RELEASE.YYYY-MM-DDTHH-MM-SSZ>   (run from the repo dir)
set -eu
module="$1"
tag="$2"
# RELEASE.2025-10-15T17-29-55Z -> 2025-10-15T17:29:55Z
version=$(echo "$tag" | sed -E 's/^RELEASE\.([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2})-([0-9]{2})-([0-9]{2})Z$/\1T\2:\3:\4Z/')
commit=$(git rev-parse HEAD)
short=$(echo "$commit" | cut -c1-12)
pkg="github.com/minio/$module/cmd"
echo "-s -w -X $pkg.Version=$version -X $pkg.ReleaseTag=$tag -X $pkg.CommitID=$commit -X $pkg.ShortCommitID=$short"
