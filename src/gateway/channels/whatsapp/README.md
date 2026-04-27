# WhatsApp Gateway

Chat with Kryzov through WhatsApp by linking your phone to the gateway. Messages you send to yourself (self-chat) are processed by Kryzov and responses are sent back to the same chat.

## Table of Contents

- [✅ Prerequisites](#-prerequisites)
- [🔗 How to Link WhatsApp](#-how-to-link-whatsapp)
- [🚀 How to Run](#-how-to-run)
- [💬 How to Chat](#-how-to-chat)
- [⚙️ Configuration](#️-configuration)
- [🔄 How to Relink](#-how-to-relink)
- [🐛 Troubleshooting](#-troubleshooting)
- [🔧 Full Reset](#-full-reset)

## ✅ Prerequisites

- Kryzov installed and working (see main [README](../../../../README.md))
- WhatsApp installed on your phone
- Your phone connected to the internet

## 🔗 How to Link WhatsApp

Link your WhatsApp account to Kryzov by scanning a QR code:

```bash
bun run gateway:login
```

This will:
1. Display a QR code in your terminal
2. Open WhatsApp on your phone
3. Go to **Settings > Linked Devices > Link a Device**
4. Scan the QR code

Once linked, your phone number is automatically added to the allowed senders list and credentials are saved to `~/.kryzov/credentials/whatsapp/default/`.

## 🚀 How to Run

Start the gateway to begin receiving messages:

```bash
bun run gateway
```

You should see:
```
[whatsapp] Connected
Kryzov gateway running. Press Ctrl+C to stop.
```

The gateway will now listen for incoming WhatsApp messages and respond using Kryzov.

## 💬 How to Chat

Once the gateway is running:

1. Open WhatsApp on your phone
2. Go to your own chat (message yourself)
3. Send a message like "How is BTC trading right now?"
4. You'll see a typing indicator while Kryzov processes
5. Kryzov's response will appear prefixed with `[Kryzov]`

**Example conversation:**
```
You: How is BTC trading right now?
[Kryzov]: Measured facts first, then a short bounded read on the current BTC/USD Hyperliquid session.
```

## ⚙️ Configuration

The gateway configuration is stored at `~/.kryzov/gateway.json`. It's auto-created when you run `gateway:login`.

**Default configuration:**
```json
{
  "gateway": {
    "accountId": "default",
    "logLevel": "info"
  },
  "channels": {
    "whatsapp": {
      "enabled": true,
      "allowFrom": ["+1234567890"]
    }
  },
  "bindings": []
}
```

**Key settings:**

| Setting | Description |
|---------|-------------|
| `channels.whatsapp.allowFrom` | Phone numbers allowed to message Kryzov (E.164 format) |
| `channels.whatsapp.enabled` | Enable/disable the WhatsApp channel |
| `gateway.logLevel` | Log verbosity: `silent`, `error`, `info`, `debug` |

## 🔄 How to Relink

If you need to relink your WhatsApp (e.g., after logging out or switching phones):

1. Stop the gateway (Ctrl+C)
2. Delete the credentials:
   ```bash
   rm -rf ~/.kryzov/credentials/whatsapp/default
   ```
3. Run login again:
   ```bash
   bun run gateway:login
   ```
4. Scan the new QR code

## 🐛 Troubleshooting

**Gateway shows "Disconnected":**
- Check your internet connection
- Try relinking (see above)

**Messages not being received:**
- Verify your phone number is in `allowFrom` in `~/.kryzov/gateway.json`
- Make sure you're messaging yourself (self-chat mode)

**Debug logs:**
- Check `~/.kryzov/gateway-debug.log` for detailed logs

## 🔧 Full Reset

If you're experiencing persistent issues (connection problems, encryption errors, messages not sending), perform a full reset:

1. **Stop the gateway** (Ctrl+C if running)

2. **Unlink from WhatsApp:**
   - Open WhatsApp on your phone
   - Go to **Settings > Linked Devices**
   - Tap on the Kryzov device and select **Log Out**

3. **Clear all local data:**
   ```bash
   rm -rf ~/.kryzov/credentials/whatsapp/default
   rm -rf ~/.kryzov/gateway.json
   rm -rf ~/.kryzov/gateway-debug.log
   ```

4. **Relink and start fresh:**
   ```bash
   bun run gateway:login
   ```

5. **Scan the QR code** and start the gateway:
   ```bash
   bun run gateway
   ```

This clears all cached credentials and encryption sessions, which resolves most connection issues.
