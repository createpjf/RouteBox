#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# gcp-setup.sh — Create & configure GCP VM for RouteBox Cloud Gateway
#
# Run this in Google Cloud Shell or local terminal with gcloud CLI installed.
#
# Usage:
#   chmod +x scripts/gcp-setup.sh
#   ./scripts/gcp-setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

# ── Configuration ────────────────────────────────────────────────────────────
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
VM_NAME="routebox-gateway"
ZONE="asia-northeast1-b"        # Tokyo (low latency to OpenAI + China)
MACHINE_TYPE="e2-small"         # 2 vCPU / 2GB RAM
DISK_SIZE="30"                  # GB
IMAGE_FAMILY="ubuntu-2204-lts"
IMAGE_PROJECT="ubuntu-os-cloud"

echo "═══════════════════════════════════════════════════════════"
echo "  GCP Setup for RouteBox Cloud Gateway"
echo "  Project: ${PROJECT_ID}"
echo "  Zone:    ${ZONE}"
echo "  VM:      ${MACHINE_TYPE} (2 vCPU / 2GB)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── Step 1: Enable required APIs ─────────────────────────────────────────────
echo "→ Enabling Compute Engine API..."
gcloud services enable compute.googleapis.com

# ── Step 2: Create firewall rules ────────────────────────────────────────────
echo "→ Creating firewall rules..."

# Allow HTTP (80) and HTTPS (443)
gcloud compute firewall-rules create allow-http-https \
  --direction=INGRESS \
  --priority=1000 \
  --network=default \
  --action=ALLOW \
  --rules=tcp:80,tcp:443 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=web-server \
  2>/dev/null || echo "  (firewall rule already exists)"

# ── Step 3: Reserve static IP ────────────────────────────────────────────────
echo "→ Reserving static IP..."
gcloud compute addresses create routebox-ip \
  --region=$(echo $ZONE | rev | cut -d'-' -f2- | rev) \
  2>/dev/null || echo "  (IP already reserved)"

STATIC_IP=$(gcloud compute addresses describe routebox-ip \
  --region=$(echo $ZONE | rev | cut -d'-' -f2- | rev) \
  --format='get(address)' 2>/dev/null)
echo "  Static IP: ${STATIC_IP}"

# ── Step 4: Create VM instance ───────────────────────────────────────────────
echo "→ Creating VM instance..."
gcloud compute instances create ${VM_NAME} \
  --zone=${ZONE} \
  --machine-type=${MACHINE_TYPE} \
  --image-family=${IMAGE_FAMILY} \
  --image-project=${IMAGE_PROJECT} \
  --boot-disk-size=${DISK_SIZE}GB \
  --boot-disk-type=pd-ssd \
  --address=${STATIC_IP} \
  --tags=web-server \
  --metadata=startup-script='#!/bin/bash
    # Install Docker
    curl -fsSL https://get.docker.com | sh
    # Add default user to docker group
    usermod -aG docker $(ls /home/ | head -1)
    # Install docker-compose plugin
    apt-get install -y docker-compose-plugin
    # Enable Docker on boot
    systemctl enable docker
    echo "Docker installation complete" > /tmp/docker-ready
  '

echo ""
echo "→ Waiting for VM to start..."
sleep 10

# ── Step 5: Wait for Docker installation ─────────────────────────────────────
echo "→ Waiting for Docker to install (this takes ~60s)..."
for i in $(seq 1 30); do
  if gcloud compute ssh ${VM_NAME} --zone=${ZONE} --command="test -f /tmp/docker-ready" 2>/dev/null; then
    echo "  Docker is ready!"
    break
  fi
  sleep 5
  echo "  Waiting... (${i}/30)"
done

# ── Step 6: Print summary ────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ GCP VM Created Successfully!"
echo ""
echo "  VM Name:   ${VM_NAME}"
echo "  Zone:      ${ZONE}"
echo "  Static IP: ${STATIC_IP}"
echo "  Specs:     2 vCPU / 2GB RAM / ${DISK_SIZE}GB SSD"
echo ""
echo "  SSH into server:"
echo "    gcloud compute ssh ${VM_NAME} --zone=${ZONE}"
echo ""
echo "  Next steps:"
echo "    1. Set DNS: api.routebox.dev → ${STATIC_IP}"
echo "    2. Upload code to server"
echo "    3. Run deploy.sh init"
echo "═══════════════════════════════════════════════════════════"
