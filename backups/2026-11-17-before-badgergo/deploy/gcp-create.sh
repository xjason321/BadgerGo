#!/usr/bin/env bash
# Run in Google Cloud Shell (https://shell.cloud.google.com) with startup.sh in the same folder:
#     bash gcp-create.sh
# Creates a static IP, a firewall rule (ports 80/443) and an e2-medium VM that builds and serves Valhalla.
set -euo pipefail

REGION=us-central1            # Iowa: closest GCP region to Madison
ZONE=us-central1-a
NAME=valhalla
# Which web pages may call your server. Add your deployed site later, e.g. '^(http://localhost:5173|https://bikes.example.com)$'
ORIGINS_RE='^http://localhost:5173$'
# Optional: a domain whose A record points at the static IP printed below (enables HTTPS). Leave empty for HTTP.
DOMAIN=''

cd "$(dirname "$0")"
[ -f startup.sh ] || { echo "startup.sh must be next to this script"; exit 1; }

gcloud config get-value project
gcloud services enable compute.googleapis.com

gcloud compute addresses describe "$NAME-ip" --region "$REGION" >/dev/null 2>&1 \
  || gcloud compute addresses create "$NAME-ip" --region "$REGION"
IP="$(gcloud compute addresses describe "$NAME-ip" --region "$REGION" --format='value(address)')"

gcloud compute firewall-rules describe "$NAME-web" >/dev/null 2>&1 \
  || gcloud compute firewall-rules create "$NAME-web" --allow=tcp:80,tcp:443 --target-tags="$NAME-web"

META="origins_re=$ORIGINS_RE"
[ -n "$DOMAIN" ] && META="$META,domain=$DOMAIN"

gcloud compute instances describe "$NAME" --zone "$ZONE" >/dev/null 2>&1 \
  && { echo "VM '$NAME' already exists. Delete it first to recreate."; exit 1; }

gcloud compute instances create "$NAME" \
  --zone "$ZONE" \
  --machine-type e2-medium \
  --image-family debian-12 --image-project debian-cloud \
  --boot-disk-size 30GB --boot-disk-type pd-balanced \
  --address "$IP" \
  --tags "$NAME-web" \
  --metadata "$META" \
  --metadata-from-file startup-script=startup.sh

cat <<MSG

VM created. Your server will be at:  http://$IP   (https://$DOMAIN if you set DOMAIN)

Building the routing tiles takes a while. Watch progress with:
  gcloud compute ssh $NAME --zone $ZONE --command 'sudo docker logs --tail 30 valhalla'

Ready when this prints JSON (not an error):
  curl -s -H 'Origin: http://localhost:5173' http://$IP/status

Then in your bike-nav folder create .env.local containing:
  VITE_VALHALLA_URL=http://$IP
MSG
