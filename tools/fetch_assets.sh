#!/usr/bin/env bash
# Download large third-party assets (not committed). All are free / open-licensed.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets/fonts assets/soundfonts assets/tts
# 1) GeneralUser GS SoundFont (S. Christian Collins, free license)
if [ ! -f assets/soundfonts/GeneralUser-GS.sf2 ]; then
  git clone --depth 1 https://github.com/mrbumpy409/GeneralUser-GS /tmp/gugs
  cp /tmp/gugs/GeneralUser-GS.sf2 assets/soundfonts/
fi
# 2) Noto Serif CJK SC (SIL OFL)
if [ ! -f assets/fonts/NotoSerifCJKsc-Regular.otf ]; then
  curl -sSL -o /tmp/serif.zip https://github.com/notofonts/noto-cjk/releases/download/Serif2.003/09_NotoSerifCJKsc.zip
  unzip -o -q /tmp/serif.zip -d /tmp/serif
  cp /tmp/serif/OTF/SimplifiedChinese/NotoSerifCJKsc-{Light,Regular,SemiBold}.otf assets/fonts/
fi
# 3) Cormorant Garamond (SIL OFL) via npm @fontsource
npm install --no-audit --no-fund >/dev/null
cp node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif.ttf assets/fonts/
cp node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-{300,400,500}-{normal,italic}.woff2 assets/fonts/ 2>/dev/null || true
# 4) Offline Chinese/English TTS model for sherpa-onnx (MeloTTS zh_en, MIT)
if [ ! -d assets/tts/vits-melo-tts-zh_en ]; then
  curl -sSL -o /tmp/melo.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2
  tar xjf /tmp/melo.tar.bz2 -C assets/tts
fi
echo "assets ready"
