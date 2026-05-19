#!/bin/sh
set -eu

awslocal sqs create-queue --queue-name junando-cenco-phase-a >/dev/null
