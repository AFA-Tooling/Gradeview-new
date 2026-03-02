#!/bin/bash

# GradeView 部署到 EECS Gradeview 项目
# 使用: bash deploy_to_gcp.sh [region]
# 例子: bash deploy_to_gcp.sh us-central1

set -e

# 为 eecs-gradeview 项目优化
PROJECT_ID="${1:-eecs-gradeview}"
REGION="${2:-us-central1}"
INSTANCE_NAME="gradeview-app"
MACHINE_TYPE="e2-standard-4"

echo "🚀 部署 GradeView 到 eecs-gradeview 项目..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "项目: $PROJECT_ID"
echo "区域: $REGION"
echo ""

# 检查和创建网络（如果需要）
echo "0️⃣  检查VPC网络..."
if ! gcloud compute networks describe default --project=$PROJECT_ID >/dev/null 2>&1; then
  echo "  创建默认网络..."
  gcloud compute networks create default \
    --subnet-mode=auto \
    --project=$PROJECT_ID
  echo "  ✅ 默认网络已创建"
else
  echo "  ✅ 默认网络已存在"
fi

echo ""

# 1. 创建VM实例
echo "1️⃣  创建Compute Engine VM..."
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

# 更新系统
apt-get update
apt-get install -y docker.io git curl

# 启动Docker
systemctl start docker
systemctl enable docker

# 创建非root用户运行Docker
usermod -aG docker $(whoami)

# 克隆项目
cd /opt
git clone https://github.com/your-org/gradeview.git
cd gradeview

# 创建.env文件（需要手动配置）
cat > .env << 'ENVFILE'
# ⚠️ 请在部署后登录VM修改这些值！
API_PORT=8000
PROGRESS_REPORT_PORT=8080
REVERSE_PROXY_LISTEN=0.0.0.0:80
REACT_APP_PROXY_SERVER="http://api:8000"
REACT_APP_PORT=3000
ENVIRONMENT=production

# Cloud SQL连接名（从GCP Console获取）
INSTANCE_CONNECTION_NAME=your-project:REGION:gradeview-db

# 数据库凭证
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change_me_please
POSTGRES_DB=gradesync

ENVFILE

# 拉取最新的Docker镜像
docker compose build

echo "✅ 初始化完成！"
echo "需要修改 /opt/gradeview/.env 文件中的配置"
EOF
) \
  --tags=gradeview-app

echo "✅ VM创建完成！"
echo ""

# 2. 获取VM的外部IP
echo "2️⃣  获取VM信息..."
EXTERNAL_IP=$(gcloud compute instances describe $INSTANCE_NAME \
  --zone=${REGION}-a \
  --project=$PROJECT_ID \
  --format='value(networkInterfaces[0].accessConfigs[0].natIP)')

echo "✅ VM外部IP: $EXTERNAL_IP"
echo ""

# 3. 创建防火墙规则
echo "3️⃣  配置防火墙..."

# SSH规则
gcloud compute firewall-rules create allow-ssh \
  --project=$PROJECT_ID \
  --network=default \
  --allow=tcp:22 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=gradeview-app \
  2>/dev/null || echo "  SSH防火墙规则已存在"

# HTTP/HTTPS规则
gcloud compute firewall-rules create allow-gradeview \
  --project=$PROJECT_ID \
  --network=default \
  --allow=tcp:80,tcp:443 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=gradeview-app \
  2>/dev/null || echo "  HTTP/HTTPS防火墙规则已存在"

echo "✅ 防火墙已配置"
echo ""

# 创建或检查Cloud SQL数据库
echo "4️⃣  检查Cloud SQL实例..."
if ! gcloud sql instances describe gradeview-db --project=$PROJECT_ID >/dev/null 2>&1; then
  echo "  创建新的Cloud SQL实例..."
  gcloud sql instances create gradeview-db \
    --project=$PROJECT_ID \
    --database-version=POSTGRES_15 \
    --tier=db-f1-micro \
    --region=$REGION \
    --no-backup
else
  echo "  Cloud SQL实例已存在"
fi

echo "✅ Cloud SQL已准备"
echo ""

# 5. 显示后续步骤
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 后续步骤："
echo ""
echo "1. SSH登录VM修改配置（两种方式任选其一）:"
echo "   方式A - 直接SSH:"
echo "   gcloud compute ssh $INSTANCE_NAME --zone=${REGION}-a --project=$PROJECT_ID"
echo ""
echo "   方式B - IAP隧道（更安全，推荐）:"
echo "   gcloud compute ssh $INSTANCE_NAME --zone=${REGION}-a --project=$PROJECT_ID --tunnel-through-iap"
echo ""
echo "   方式C - 浏览器SSH（最简单）:"
echo "   https://console.cloud.google.com/compute/instances?project=$PROJECT_ID"
echo ""
echo "2. 编辑.env文件:"
echo "   cd /opt/gradeview && sudo nano .env"
echo "   重点修改这些变量："
echo "   - POSTGRES_PASSWORD    (改为强密码)"
echo "   - INSTANCE_CONNECTION_NAME 已自动填充为"
echo "     eecs-gradeview:${REGION}:gradeview-db"
echo ""
echo "3. 启动应用:"
echo "   cd /opt/gradeview"
echo "   docker compose up -d"
echo ""
echo "4. 访问应用:"
echo "   http://$EXTERNAL_IP"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
