#!/bin/bash
# Acumon Screen Capture Extension — Mac/Linux Installer

EXT_VERSION="1.0.0"
INSTALL_DIR="$HOME/.acumon-capture"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "========================================"
echo "  Acumon Screen Capture - Installer"
echo "  Version $EXT_VERSION"
echo "========================================"
echo ""

# 1. Create install directory
echo "[1/3] Creating install directory..."
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/icons"

# 2. Copy extension files
echo "[2/3] Copying extension files..."
cp "$SCRIPT_DIR/manifest.json" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/background.js" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/content.js" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/icons/"* "$INSTALL_DIR/icons/"
echo "       Installed to: $INSTALL_DIR"

# 3. Register with Chrome/Edge (external extensions JSON)
echo "[3/3] Registering with browsers..."

# Chrome on Mac
CHROME_EXT_DIR="$HOME/Library/Application Support/Google/Chrome/External Extensions"
if [ -d "$HOME/Library/Application Support/Google/Chrome" ]; then
    mkdir -p "$CHROME_EXT_DIR"
    cat > "$CHROME_EXT_DIR/acumon_screen_capture.json" << EOF
{
  "external_crx": "$INSTALL_DIR",
  "external_version": "$EXT_VERSION"
}
EOF
    echo "       Chrome: Registered"
else
    echo "       Chrome: Not found (skipped)"
fi

# Edge on Mac
EDGE_EXT_DIR="$HOME/Library/Application Support/Microsoft Edge/External Extensions"
if [ -d "$HOME/Library/Application Support/Microsoft Edge" ]; then
    mkdir -p "$EDGE_EXT_DIR"
    cat > "$EDGE_EXT_DIR/acumon_screen_capture.json" << EOF
{
  "external_crx": "$INSTALL_DIR",
  "external_version": "$EXT_VERSION"
}
EOF
    echo "       Edge:   Registered"
else
    echo "       Edge:   Not found (skipped)"
fi

# Chrome on Linux
CHROME_LINUX_DIR="$HOME/.config/google-chrome/External Extensions"
if [ -d "$HOME/.config/google-chrome" ]; then
    mkdir -p "$CHROME_LINUX_DIR"
    cat > "$CHROME_LINUX_DIR/acumon_screen_capture.json" << EOF
{
  "external_crx": "$INSTALL_DIR",
  "external_version": "$EXT_VERSION"
}
EOF
    echo "       Chrome (Linux): Registered"
fi

echo ""
echo "========================================"
echo "  Installation Complete!"
echo "========================================"
echo ""
echo "IMPORTANT: Please restart Chrome/Edge for the extension to appear."
echo ""
echo "To uninstall: rm -rf $INSTALL_DIR"
echo ""
