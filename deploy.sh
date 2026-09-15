#!/usr/bin/env bash
# Quick entry point for deploying to Hostinger Cloud on a subdomain of autoneural.in
# Usage:
#   ./deploy.sh [subdomain] [--with-database]
# Examples:
#   ./deploy.sh crm
#   ./deploy.sh work
#   ./deploy.sh tasks
exec bash "$(dirname "$0")/scripts/deploy-hostinger.sh" "$@"
