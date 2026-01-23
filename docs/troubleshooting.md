# Troubleshooting Guide

Common issues and debugging techniques for the OpenCode OpenAI Codex Auth Plugin.

---

> **Quick Reset**: Most issues can be resolved by deleting `~/.opencode/auth/openai.json` and running `opencode auth login` again.

---

## Authentication Issues

<details open>
<summary><b>401 Unauthorized Error</b></summary>

**Symptoms:**
```
Error: 401 Unauthorized
Failed to access Codex API
```

**Causes:**
1. Token expired
2. Not authenticated yet
3. Invalid credentials

**Solutions:**

1. **Re-authenticate:**
   ```bash
   opencode auth login
   ```

2. **Check auth file exists:**
   ```bash
   cat ~/.opencode/auth/openai.json
   # Should show OAuth credentials
   ```

3. **Check token expiration:**
   ```bash
   cat ~/.opencode/auth/openai.json | jq '.expires'
   date +%s000  # Compare to current timestamp
   ```

</details>

<details>
<summary><b>Browser Doesn't Open for OAuth</b></summary>

**Symptoms:**
- `opencode auth login` succeeds but no browser window
- OAuth callback times out

**Solutions:**

1. **Manual URL paste:**
   - Re-run `opencode auth login`
   - Select **"ChatGPT Plus/Pro (Manual URL Paste)"**
   - Paste the full redirect URL after login

2. **Check port 1455 availability:**
   ```bash
   # macOS/Linux
   lsof -i :1455
   
   # Windows
   netstat -ano | findstr :1455
   ```

3. **Stop Codex CLI if running** — both use port 1455

</details>

<details>
<summary><b>Authorization Session Expired</b></summary>

**Symptoms:**
- Browser shows: `Your authorization session was not initialized or has expired`

**Solutions:**
- Re-run `opencode auth login` to generate a fresh URL
- Open the URL directly in browser (don't use a stale link)
- For SSH/WSL/remote, use **"Manual URL Paste"** option

</details>

<details>
<summary><b>403 Forbidden Error</b></summary>

**Cause:** ChatGPT subscription issue

**Check:**
1. Active ChatGPT Plus or Pro subscription
2. Subscription not expired
3. Billing is current

**Solution:** Visit [ChatGPT](https://chatgpt.com) and verify subscription status

</details>

---

## Model Issues

<details open>
<summary><b>Model Not Found</b></summary>

**Error:** `Model 'openai/gpt-5-codex-low' not found`

**Cause 1: Config key mismatch**

Check your config:
```json
{
  "models": {
    "gpt-5-codex-low": { ... }  // ← This is the key
  }
}
```

CLI must match exactly:
```bash
opencode run "test" --model=openai/gpt-5-codex-low  # Must match config key
```

**Cause 2: Missing provider prefix**

| Wrong | Correct |
|-------|---------|
| `--model=gpt-5-codex-low` | `--model=openai/gpt-5-codex-low` |

</details>

<details>
<summary><b>Per-Model Options Not Applied</b></summary>

**Symptom:** All models behave the same despite different `reasoningEffort`

**Debug:**
```bash
DEBUG_CODEX_PLUGIN=1 opencode run "test" --model=openai/your-model
```

**Look for:**
```
hasModelSpecificConfig: true  ← Should be true
resolvedConfig: { reasoningEffort: 'low', ... }  ← Should show your options
```

**Common causes:**
1. Model name in CLI doesn't match config key
2. Typo in config file
3. Wrong config file location

</details>

---

## Multi-Turn Issues

<details open>
<summary><b>Item Not Found Errors</b></summary>

**Error:**
```
AI_APICallError: Item with id 'msg_abc123' not found.
Items are not persisted when `store` is set to false.
```

**Cause:** Old plugin version (fixed in v2.1.2+)

**Solution:**
```bash
npx -y opencode-openai-codex-auth-multi@latest
opencode
```

**Verify fix:**
```bash
DEBUG_CODEX_PLUGIN=1 opencode
> write test.txt
> read test.txt
> what did you write?
```

Should see: `Successfully removed all X message IDs`

</details>

<details>
<summary><b>Context Not Preserved</b></summary>

**Symptom:** Model doesn't remember previous turns

**Check logs:**
```bash
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode
> first message
> second message
```

**Verify:**
```bash
cat ~/.opencode/logs/codex-plugin/request-*-after-transform.json | jq '.body.input | length'
# Should show increasing count (3, 5, 7, 9, ...)
```

**What to check:**
1. Full message history present (not just current turn)
2. No `item_reference` items (filtered out)
3. All IDs stripped

</details>

---

## Request Errors

<details open>
<summary><b>400 Bad Request</b></summary>

**Debug:**
```bash
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test"
cat ~/.opencode/logs/codex-plugin/request-*-error-response.json
```

**Common causes:**
1. Invalid options for model (e.g., `minimal` for gpt-5-codex)
2. Malformed request body
3. Unsupported parameter

</details>

<details>
<summary><b>Rate Limit Exceeded</b></summary>

**Error:**
```
Rate limit reached for gpt-5-codex
```

**Solutions:**

1. **Wait for reset:**
   ```bash
   cat ~/.opencode/logs/codex-plugin/request-*-response.json | jq '.headers["x-codex-primary-reset-after-seconds"]'
   ```

2. **Add more accounts:**
   ```bash
   opencode auth login  # Add another account
   ```

3. **Switch model family:**
   ```bash
   opencode run "task" --model=openai/gpt-5.1
   ```

</details>

<details>
<summary><b>Context Window Exceeded</b></summary>

**Error:**
```
Your input exceeds the context window
```

**Solutions:**
1. Exit and restart OpenCode (clears history)
2. Use compact mode (if OpenCode supports it)
3. Switch to model with larger context

</details>

---

## OAuth Callback Issues

<details>
<summary><b>Safari OAuth Callback Fails (macOS)</b></summary>

**Symptoms:**
- "fail to authorize" after successful login
- Safari shows "Safari can't open the page"

**Cause:** Safari's "HTTPS-Only Mode" blocks `http://localhost` callback.

**Solutions:**

1. **Use Chrome or Firefox** (easiest)

2. **Disable HTTPS-Only Mode temporarily:**
   - Safari > Settings (⌘,) > Privacy
   - Uncheck "Enable HTTPS-Only Mode"
   - Run `opencode auth login`
   - Re-enable after authentication

</details>

<details>
<summary><b>Port Conflict (Address Already in Use)</b></summary>

**macOS / Linux:**
```bash
lsof -i :1455
kill -9 <PID>
opencode auth login
```

**Windows (PowerShell):**
```powershell
netstat -ano | findstr :1455
taskkill /PID <PID> /F
opencode auth login
```

</details>

<details>
<summary><b>Docker / WSL2 / Remote Development</b></summary>

OAuth callback requires browser to reach `localhost` on the machine running OpenCode.

**WSL2:**
- Use VS Code's port forwarding, or
- Configure Windows → WSL port forwarding

**SSH / Remote:**
```bash
ssh -L 1455:localhost:1455 user@remote
```

**Docker / Containers:**
- OAuth with localhost redirect doesn't work in containers
- Use SSH port forwarding or manual URL flow

</details>

---

## Debug Techniques

<details open>
<summary><b>Enable Full Logging</b></summary>

```bash
DEBUG_CODEX_PLUGIN=1 ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test"
```

**What you get:**
- Console: Debug messages showing config resolution
- Files: Complete request/response logs

**Log locations:**
- `~/.opencode/logs/codex-plugin/request-*-before-transform.json`
- `~/.opencode/logs/codex-plugin/request-*-after-transform.json`
- `~/.opencode/logs/codex-plugin/request-*-response.json`

</details>

<details>
<summary><b>Inspect Actual API Requests</b></summary>

```bash
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test" --model=openai/gpt-5.2-low

cat ~/.opencode/logs/codex-plugin/request-*-after-transform.json | jq '{
  model: .body.model,
  reasoning: .body.reasoning,
  text: .body.text,
  store: .body.store,
  include: .body.include
}'
```

**Verify:**
- `model`: Normalized correctly?
- `reasoning.effort`: Matches your config?
- `store`: Should be `false`
- `include`: Should have `reasoning.encrypted_content`

</details>

---

## Getting Help

### Before Opening an Issue

1. **Enable logging:**
   ```bash
   DEBUG_CODEX_PLUGIN=1 ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "your command"
   ```

2. **Collect info:**
   - OpenCode version: `opencode --version`
   - Plugin version: Check `package.json` or npm
   - Error logs from `~/.opencode/logs/codex-plugin/`
   - Config file (redact sensitive info)

3. **Check existing issues:**
   [GitHub Issues](https://github.com/ndycode/opencode-openai-codex-auth-multi/issues)

### Reporting Bugs

Include:
- Error message
- Steps to reproduce
- Config file (redacted)
- Log files
- OpenCode version
- Plugin version

### Account or Subscription Issues

| Issue | Solution |
|-------|----------|
| Auth problems | Verify subscription at [ChatGPT Settings](https://chatgpt.com/settings) |
| Free tier | Not supported — requires Plus or Pro |
| Usage limits | Check subscription limits |
| Account flagged | Contact OpenAI support |

**To revoke and re-authorize:**
1. Revoke: [ChatGPT Settings → Authorized Apps](https://chatgpt.com/settings/apps)
2. Remove tokens: `opencode auth logout`
3. Re-authenticate: `opencode auth login`

---

**Next**: [Configuration Guide](configuration.md) | [Architecture](development/ARCHITECTURE.md) | [Back to Home](index.md)
