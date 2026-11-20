#!/bin/bash
# GCE startup script: installs Docker, builds Valhalla routing tiles for Wisconsin (with elevation,
# so the "hills" preference works), and fronts it with Caddy (CORS + an Origin allow-list).
# Runs as root on every boot; safe to re-run.
set -euo pipefail
exec > >(tee -a /var/log/valhalla-setup.log) 2>&1
echo "=== valhalla setup $(date -u) ==="

MD=http://metadata.google.internal/computeMetadata/v1/instance/attributes
meta() { curl -fs -H 'Metadata-Flavor: Google' "$MD/$1" || true; }

DOMAIN="$(meta domain)"                      # optional; empty = plain HTTP on the IP
ORIGINS_RE="$(meta origins_re)"              # which web pages may call this server (regex)
ORIGINS_RE="${ORIGINS_RE:-^http://localhost:5173$}"
PBF_URL="$(meta pbf_url)"
PBF_URL="${PBF_URL:-https://download.geofabrik.de/north-america/us/wisconsin-latest.osm.pbf}"
SITE="${DOMAIN:-:80}"                        # a domain makes Caddy get a real HTTPS certificate

# 4 GB swap: tile building can spike past the 4 GB of RAM on an e2-medium.
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile
fi
swapon /swapfile 2>/dev/null || true

if ! command -v docker >/dev/null; then
  apt-get update -y
  apt-get install -y docker.io curl
  systemctl enable --now docker
fi

# --- Valhalla --------------------------------------------------------------------------------
# A named volume (not a host folder) avoids file-ownership problems with the container's user.
if ! docker ps -a --format '{{.Names}}' | grep -qx valhalla; then
  docker volume create valhalla_data >/dev/null
  docker run -dt --name valhalla --restart unless-stopped \
    -p 127.0.0.1:8002:8002 \
    -v valhalla_data:/custom_files \
    -e tile_urls="$PBF_URL" \
    -e build_elevation=True \
    -e server_threads=2 \
    ghcr.io/valhalla/valhalla-scripted:latest
else
  docker start valhalla >/dev/null || true
fi

# --- Caddy: CORS + Origin allow-list in front of Valhalla ------------------------------------
mkdir -p /opt/caddy
cat > /opt/caddy/Caddyfile <<CADDY
${SITE} {
	encode zstd gzip

	# Only the web pages you allow may use this server (browsers always send Origin).
	@blocked {
		not header_regexp origin Origin "${ORIGINS_RE}"
	}
	respond @blocked "Forbidden" 403

	# Only what the app uses. The Origin check stops other web pages, not scripts (they can fake the header), so keep
	# the rest of Valhalla's API (isochrones, map matching, huge matrices...) and oversized requests away from them.
	request_body {
		max_size 1MB
	}
	@notapi {
		not path /route /sources_to_targets /height /trace_attributes /status
	}
	respond @notapi "Not found" 404

	header {
		Access-Control-Allow-Origin "{http.request.header.Origin}"
		Access-Control-Allow-Methods "GET, POST, OPTIONS"
		Access-Control-Allow-Headers "Content-Type"
		Access-Control-Max-Age "86400"
		Vary Origin
	}
	@preflight method OPTIONS
	respond @preflight 204

	reverse_proxy 127.0.0.1:8002 {
		# Valhalla sends its own CORS header; two of them make browsers reject the response.
		header_down -Access-Control-Allow-Origin
	}
}
CADDY

docker run --rm -v /opt/caddy/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2 \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

docker rm -f caddy >/dev/null 2>&1 || true
docker run -d --name caddy --restart unless-stopped --network host \
  -v /opt/caddy/Caddyfile:/etc/caddy/Caddyfile:ro \
  -v caddy_data:/data \
  caddy:2

echo "=== setup done; Valhalla keeps building tiles in the background (docker logs -f valhalla) ==="
