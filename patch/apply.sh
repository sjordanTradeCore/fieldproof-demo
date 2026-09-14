#!/bin/sh
set -eu
ROOT="${1:-/src}"
# Keep the field app usable after a JWT expires: any authenticated 401 clears the session and returns to sign-in.
sed -i "s#const api=useMemo(()=>new FieldProofApi(settings),\[settings\]);#const api=useMemo(()=>new FieldProofApi(settings,onLogout),[settings,onLogout]);#" "$ROOT/app/App.tsx"
sed -i 's#Secure demo access to commissioning, evidence, asset history, service, and handover.#Secure access to commissioning, evidence, asset history, service, and handover. Expired sessions return here automatically.#' "$ROOT/app/App.tsx"
