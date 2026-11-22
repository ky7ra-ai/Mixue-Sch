#!/usr/bin/env bash
# Bangun & tanda tangani satu APK: scripts/build-apk.sh admin|viewer TAG RUN_NUMBER
set -euo pipefail
ROLE="$1"; TAG="$2"; RUN="$3"
case "$ROLE" in admin) NAME=Mixue-Penguasa;; viewer) NAME=Mixue-Rakyat;; *) echo "peran salah"; exit 1;; esac
git checkout -- capacitor.config.json
npm run build:web
node scripts/prepare-role.js "$ROLE"
rm -rf android
npx cap add android
npx cap sync android
python3 scripts/patch-android.py
sed -i "s/versionCode 1/versionCode ${RUN}/; s/versionName \"1.0\"/versionName \"${TAG#v}\"/" android/app/build.gradle
(cd android && ./gradlew assembleRelease --no-daemon --stacktrace)
BT="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
SRC="$(find android/app/build/outputs/apk/release -name '*.apk' | head -1)"
mkdir -p dist
"$BT/zipalign" -f -p 4 "$SRC" "dist/aligned-$ROLE.apk"
"$BT/apksigner" sign --ks signing/mixue-sch.jks --ks-pass pass:mixuesch --key-pass pass:mixuesch \
  --out "dist/${NAME}-${TAG}.apk" "dist/aligned-$ROLE.apk"
"$BT/apksigner" verify --verbose "dist/${NAME}-${TAG}.apk"
rm -f dist/aligned-*.apk dist/*.idsig
git checkout -- capacitor.config.json
