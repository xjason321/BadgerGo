# Self-hosting Valhalla on Google Cloud

Gives the app its own routing server (no shared rate limits) with road-type preferences, hills, and
the road-type bar. About **$25-30/month** (e2-medium VM in Iowa plus disk and a static IP); the
$300 / 90-day free trial covers a new account. Stop the VM when you're not biking to pause the compute charge.

## 1. Google Cloud account and project
1. Go to <https://console.cloud.google.com> and sign in. Accept the free trial (needs a card).
2. Create a project (top bar > project picker > New project), e.g. `bike-nav`. Make sure billing is linked to it.

## 2. Create the server (about 5 minutes of clicking)
1. In the console, click the **Cloud Shell** icon (`>_`, top right). A terminal opens in the browser.
2. Upload `startup.sh` and `gcp-create.sh` from this folder: Cloud Shell menu (three dots) > **Upload**.
3. Run: `bash gcp-create.sh` and approve any authorize prompts.

It prints your server address, e.g. `http://34.x.x.x`.

## 3. Wait for the map build
The VM downloads Wisconsin's OpenStreetMap data, builds routing tiles and downloads elevation data.
It is not ready until `/status` answers. Check from Cloud Shell:

    gcloud compute ssh valhalla --zone us-central1-a --command 'sudo docker logs --tail 30 valhalla'
    curl -s -H 'Origin: http://localhost:5173' http://YOUR_IP/status

(The `Origin` header is required: the server only answers the web pages you allow. A plain `curl` without it gets 403.)

If the build dies with "Killed" (out of memory), stop the VM, change its machine type to `e2-standard-2`
(console > VM > Edit), start it, wait for the build, then you can switch it back.

## 4. Point the app at it
In the `bike-nav` folder, create `.env.local`:

    VITE_VALHALLA_URL=http://YOUR_IP

then restart `npm run dev`. The "Preference router unavailable" warning should be gone, and the selected route
shows a road-type bar.

## Optional
- **HTTPS** (needed if you host the web app on https): point a domain's A record at the static IP, set
  `DOMAIN='routes.yourdomain.com'` in `gcp-create.sh` (or edit the `domain` metadata on the VM and reboot), and add
  your site to `ORIGINS_RE`. Caddy gets the certificate automatically. Free `sslip.io` names are unreliable for
  certificates (shared rate limits).
- **Lock it down further**: the server only answers browsers on your allowed origins, but anyone could still call it
  with a forged header. To restrict by network, edit the firewall rule `valhalla-web` and set `--source-ranges` to your IP.
- **Other regions**: change `PBF_URL` metadata to another Geofabrik `*-latest.osm.pbf`. Routes must be inside the extract.
- **Tear down** (stops all charges):
  `gcloud compute instances delete valhalla --zone us-central1-a && gcloud compute addresses delete valhalla-ip --region us-central1 && gcloud compute firewall-rules delete valhalla-web`
