#!/bin/sh
# Startup script for Alertmanager - substitutes environment variables

# Substitute environment variables in config using sed
if [ -n "$JUNANDO_WEBHOOK_URL" ]; then
    sed "s|\${JUNANDO_WEBHOOK_URL}|$JUNANDO_WEBHOOK_URL|g" /etc/alertmanager/alertmanager.yml.template > /etc/alertmanager/alertmanager.yml
else
    sed "s|\${JUNANDO_WEBHOOK_URL}|http://host.docker.internal:4000/webhook/alert|g" /etc/alertmanager/alertmanager.yml.template > /etc/alertmanager/alertmanager.yml
fi

exec /bin/alertmanager --config.file=/etc/alertmanager/alertmanager.yml "$@"