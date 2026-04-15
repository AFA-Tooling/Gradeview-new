#!/bin/bash

# Deploy GradeView to GCP (eecs-gradeview project)
# Usage: bash deploy_to_gcp.sh [project_id] [region]
# Example: bash deploy_to_gcp.sh eecs-gradeview us-central1

set -e

# Defaults tuned for the eecs-gradeview project
PROJECT_ID="${1:-eecs-gradeview}"
REGION="${2:-us-central1}"
INSTANCE_NAME="gradeview-app"
MACHINE_TYPE="e2-standard-4"

echo "Deploying GradeView to project: $PROJECT_ID"
echo "Region: $REGION"
echo ""

# Step 0 — Ensure default VPC network exists
echo "[0/4] Checking VPC network..."
if ! gcloud compute networks describe default --project=$PROJECT_ID >/dev/null 2>&1; then
  echo "  Creating default network..."
  gcloud compute networks create default \
    --subnet-mode=auto \
    --project=$PROJECT_ID
  echo "  Default network created."
else
  echo "  Default network already exists."
fi

echo ""

# Step 1 — Create the GCE VM instance
echo "[1/4] Creating Compute Engine VM..."
gcloud compute instances create $INSTANCE_NAME \
  --project=$PROJECT_ID \
  --zone=${REGION}-a \
  --machine-type=$MACHINE_TYPE \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --scopes=cloud-platform \
  --network=default \
  --metadata-from-file startup-script=<(cat << 'EOF'
#!/bin/bash
set -e

# Update system and install Docker
apt-get update
apt-get install -y docker.io git curl

# Start and enable Docker
systemctl start docker
systemctl enable docker

# Allow current user to run Docker without sudo
usermod -aG docker $(whoami)

# Clone the project
cd /opt
git clone https://github.com/your-org/gradeview.git
cd gradeview

# Create a placeholder .env — edit this after the VM starts
cat > .env << 'ENVFILE'
# WARNING: Edit all values below before starting the application!
API_PORT=8000
PROGRESS_REPORT_PORT=8080
REVERSE_PROXY_LISTEN=0.0.0.0:80
REACT_APP_PROXY_SERVER="http://api:8000"
REACT_APP_PORT=3000
ENVIRONMENT=production

# Cloud SQL instance connection name — get from GCP Console > SQL > instance > Overview
INSTANCE_CONNECTION_NAME=your-project:REGION:gradeview-db

# Database credentials — use strong values in production
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change_me_please
POSTGRES_DB=gradesync

# JWT secret — replace with a long random string: openssl rand -hex 32
JWT_SECRET=replace_with_long_random_secret
JWT_EXPIRES_IN=12h

# GradeSync external source credentials
GRADESCOPE_EMAIL=you@berkeley.edu
GRADESCOPE_PASSWORD=your_gradescope_password
PL_API_TOKEN=your_pl_api_token
ICLICKER_USERNAME=your_iclicker_username
ICLICKER_PASSWORD=your_iclicker_password
ENVFILE

echo "VM initialization complete. Edit /opt/gradeview/.env before starting the stack."
EOF
) \
  --tags=gradeview-app

echo "VM created."
echo ""

# Step 2 — Get external IP
echo "[2/4] Resolving VM external IP..."
EXTERNAL_IP=$(gcloud compute instances describe $INSTANCE_NAME \
  --zone=${REGION}-a \
  --project=$PROJECT_ID \
  --format='value(networkInterfaces[0].accessConfigs[0].natIP)')

echo "VM external IP: $EXTERNAL_IP"
echo ""

# Step 3 — Configure firewall rules
echo "[3/4] Configuring firewall rules..."

gcloud compute firewall-rules create allow-ssh \
  --project=$PROJECT_ID \
  --network=default \
  --allow=tcp:22 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=gradeview-app \
  2>/dev/null || echo "  SSH firewall rule already exists."

gcloud compute firewall-rules create allow-gradeview \
  --project=$PROJECT_ID \
  --network=default \
  --allow=tcp:80,tcp:443 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=gradeview-app \
  2>/dev/null || echo "  HTTP/HTTPS firewall rule already exists."

echo "Firewall configured."
echo ""

# Step 4 — Create Cloud SQL instance (if it does not exist)
echo "[4/4] Checking Cloud SQL instance..."
if ! gcloud sql instances describe gradeview-db --project=$PROJECT_ID >/dev/null 2>&1; then
  echo "  Creating Cloud SQL instance (this may take a few minutes)..."
  gcloud sql instances create gradeview-db \
    --project=$PROJECT_ID \
    --database-version=POSTGRES_15 \
    --tier=db-f1-micro \
    --region=$REGION \
    --no-backup
else
  echo "  Cloud SQL instance already exists."
fi

echo "Cloud SQL ready."
echo ""

# Post-deploy instructions
echo "========================================"
echo "Deployment complete. Next steps:"
echo ""
echo "1. SSH into the VM to finish configuration:"
echo "   Option A (direct SSH):"
echo "     gcloud compute ssh $INSTANCE_NAME --zone=${REGION}-a --project=$PROJECT_ID"
echo "   Option B (IAP tunnel, recommended for production):"
echo "     gcloud compute ssh $INSTANCE_NAME --zone=${REGION}-a --project=$PROJECT_ID --tunnel-through-iap"
echo "   Option C (browser SSH):"
echo "     https://console.cloud.google.com/compute/instances?project=$PROJECT_ID"
echo ""
echo "2. Edit .env on the VM:"
echo "     cd /opt/gradeview && sudo nano .env"
echo "   Required changes:"
echo "     - POSTGRES_PASSWORD       (use a strong password)"
echo "     - INSTANCE_CONNECTION_NAME (should be: $PROJECT_ID:${REGION}:gradeview-db)"
echo "     - JWT_SECRET              (openssl rand -hex 32)"
echo "     - GRADESCOPE_EMAIL / GRADESCOPE_PASSWORD"
echo "     - PL_API_TOKEN"
echo "     - ICLICKER_USERNAME / ICLICKER_PASSWORD"
echo ""
echo "3. Upload your GCP service account key:"
echo "     scp key.json $INSTANCE_NAME:/opt/gradeview/secrets/key.json"
echo ""
echo "4. Edit config.json and add your courses:"
echo "     sudo nano /opt/gradeview/config.json"
echo ""
echo "5. Apply the database schema (first deploy only):"
echo "     cd /opt/gradeview"
echo "     docker compose up -d cloud-sql-proxy"
echo "     sleep 5"
echo "     docker run --rm --network=db -e PGPASSWORD=\$POSTGRES_PASSWORD postgres:16 \\"
echo "       psql -h cloud-sql-proxy -U \$POSTGRES_USER -d \$POSTGRES_DB -f /dev/stdin \\"
echo "       < docs/database/schema.sql"
echo ""
echo "6. Start the application:"
echo "     cd /opt/gradeview && docker compose up -d"
echo ""
echo "7. Verify:"
echo "     curl -fs http://$EXTERNAL_IP/api/health"
echo "     open http://$EXTERNAL_IP"
echo "========================================"
