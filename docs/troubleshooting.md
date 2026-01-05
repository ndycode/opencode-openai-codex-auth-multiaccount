# Troubleshooting Guide

Common issues and debugging techniques for the OpenCode OpenAI Codex Auth Plugin.

## Authentication Issues

### "401 Unauthorized" Error

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

**1. Re-authenticate:**
```bash
opencode auth login
```

**2. Check auth file exists:**
```bash
cat ~/.opencode/auth/openai.json
# Should show OAuth credentials
```

**3. Check token expiration:**
```bash
# Token has "expires" timestamp
cat ~/.opencode/auth/openai.json | jq '.expires'

# Compare to current time
date +%s000  # Current timestamp in milliseconds
```

### Browser Doesn't Open for OAuth

**Symptoms:**
- `opencode auth login` succeeds but no browser window
- OAuth callback times out

**Solutions:**

**1. Manual browser open:**
```bash
# The auth URL is shown in console - copy and paste to browser manually
```

**1a. Manual URL Paste login:**
- Re-run `opencode auth login`
- Select **"ChatGPT Plus/Pro (Manual URL Paste)"**
- Paste the full redirect URL after login

**2. Check port 1455 availability:**
```bash
# See if something is using the OAuth callback port
lsof -i :1455
```

**3. Official Codex CLI conflict:**
- Stop Codex CLI if running
- Both use port 1455 for OAuth

### "Invalid Session" or "Authorization session expired"

**Symptoms:**
- Browser shows: `Your authorization session was not initialized or has expired`

**Solutions:**
- Re-run `opencode auth login` to generate a fresh URL
- Open the **"Go to"** URL directly in your browser (don’t use a stale link)
- If you’re on SSH/WSL/remote, choose **"ChatGPT Plus/Pro (Manual URL Paste)"**

### "403 Forbidden" Error

**Cause**: ChatGPT subscription issue

**Check:**
1. Active ChatGPT Plus or Pro subscription
2. Subscription not expired
3. Billing is current

**Solution**: Visit [ChatGPT](https://chatgpt.com) and verify subscription status

---

## Model Issues

### "Model not found"

**Error**: `Model 'openai/gpt-5-codex-low' not found`

**Cause 1: Config key mismatch**

**Check your config:**
```json
{
  "models": {
    "gpt-5-codex-low": { ... }  // ← This is the key
  }
}
```

**CLI must match exactly:**
```bash
opencode run "test" --model=openai/gpt-5-codex-low  # Must match config key
```

**Cause 2: Missing provider prefix**

**❌ Wrong:**
```yaml
model: gpt-5-codex-low
```

**✅ Correct:**
```yaml
model: openai/gpt-5-codex-low
```

### Per-Model Options Not Applied

**Symptom**: All models behave the same despite different `reasoningEffort`

**Debug:**
```bash
DEBUG_CODEX_PLUGIN=1 opencode run "test" --model=openai/your-model
```

**Look for:**
```
hasModelSpecificConfig: true  ← Should be true
resolvedConfig: { reasoningEffort: 'low', ... }  ← Should show your options
```

**If `false`**: Config lookup failed

**Common causes:**
1. Model name in CLI doesn't match config key
2. Typo in config file
3. Wrong config file location

---

## Multi-Turn Issues

### "Item not found" Errors

**Error:**
```
AI_APICallError: Item with id 'msg_abc123' not found.
Items are not persisted when `store` is set to false.
```

**Cause**: Old plugin version (fixed in v2.1.2+)

**Solution:**
```bash
# Update plugin
npx -y opencode-openai-codex-auth-multi@latest

# Restart OpenCode
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

### Context Not Preserved

**Symptom**: Model doesn't remember previous turns

**Check logs:**
```bash
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode
> first message
> second message
```

**Verify:**
```bash
# Turn 2 should have full history
cat ~/.opencode/logs/codex-plugin/request-*-after-transform.json | jq '.body.input | length'
# Should show increasing count (3, 5, 7, 9, ...)
```

**What to check:**
1. Full message history present (not just current turn)
2. No `item_reference` items (filtered out)
3. All IDs stripped (`jq '.body.input[].id'` should all be `null`)

---

## Request Errors

### "400 Bad Request"

**Check error details:**
```bash
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test"

# Read error
cat ~/.opencode/logs/codex-plugin/request-*-error-response.json
```

**Common causes:**
1. Invalid options for model (e.g., `minimal` for gpt-5-codex)
2. Malformed request body
3. Unsupported parameter

### "Rate Limit Exceeded"

**Error:**
```
Rate limit reached for gpt-5-codex
```

**Solutions:**

**1. Wait for reset:**
Check headers in response logs:
```bash
cat ~/.opencode/logs/codex-plugin/request-*-response.json | jq '.headers["x-codex-primary-reset-after-seconds"]'
```

**2. Switch to different model:**
```bash
# If codex is rate limited, try gpt-5
opencode run "task" --model=openai/gpt-5
```

### "Context Window Exceeded"

**Error:**
```
Your input exceeds the context window
```

**Cause**: Too much conversation history

**Solutions:**

**1. Start new conversation:**
```bash
# Exit and restart OpenCode (clears history)
```

**2. Use compact mode** (if OpenCode supports it)

**3. Switch to model with larger context:**
- gpt-5-codex has larger context than gpt-5-nano

---

## GitHub API Issues

### Rate Limit Exhausted

**Error:**
```
Failed to fetch instructions from GitHub: Failed to fetch latest release: 403
Using cached instructions
```

**Cause**: GitHub API rate limit (60 req/hour for unauthenticated)

**Status**: **Fixed in v2.1.2** with 15-minute caching

**Verify fix:**
```bash
# Should only check GitHub once per 15 minutes
ls -lt ~/.opencode/cache/codex-instructions-meta.json

# Check lastChecked timestamp
cat ~/.opencode/cache/codex-instructions-meta.json | jq '.lastChecked'
```

**Manual workaround** (if on old version):
- Wait 1 hour for rate limit to reset
- Or use cached instructions (automatic fallback)

---

## Debug Techniques

### Enable Full Logging

```bash
# Both debug and request logging
DEBUG_CODEX_PLUGIN=1 ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test"
```

**What you get:**
- Console: Debug messages showing config resolution
- Files: Complete request/response logs

**Log locations:**
- `~/.opencode/logs/codex-plugin/request-*-before-transform.json`
- `~/.opencode/logs/codex-plugin/request-*-after-transform.json`
- `~/.opencode/logs/codex-plugin/request-*-response.json`

### Inspect Actual API Requests

```bash
# Run command with logging
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "test" --model=openai/gpt-5-codex-low

# Check what was sent to API
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
- `text.verbosity`: Matches your config?
- `store`: Should be `false`
- `include`: Should have `reasoning.encrypted_content`

### Compare with Expected

See [development/TESTING.md](development/TESTING.md) for expected values matrix.

---

## Performance Issues

### Slow Responses

**Possible causes:**
1. `reasoningEffort: "high"` - Uses more computation
2. `textVerbosity: "high"` - Generates longer outputs
3. Network latency

**Solutions:**
- Use lower reasoning effort for faster responses
- Check network connection
- Try different time of day (server load varies)

### High Token Usage

**Monitor usage:**
```bash
# Tokens shown in logs
cat ~/.opencode/logs/codex-plugin/request-*-stream-full.json | grep -o '"total_tokens":[0-9]*'
```

**Reduce tokens:**
1. Lower `textVerbosity`
2. Lower `reasoningEffort`
3. Shorter system prompts (disable CODEX_MODE if needed)

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
   - [GitHub Issues](https://github.com/ndycode/opencode-openai-codex-auth-multi/issues)

### Reporting Bugs

Include:
- ✅ Error message
- ✅ Steps to reproduce
- ✅ Config file (redacted)
- ✅ Log files
- ✅ OpenCode version
- ✅ Plugin version

### Account or Subscription Issues

If you're experiencing authentication problems:

- **Ensure active subscription:** Verify your ChatGPT Plus/Pro subscription is active at [ChatGPT Settings](https://chatgpt.com/settings)
- **Check subscription type:** This plugin requires Plus or Pro (Free tier is not supported)
- **Review usage limits:** Check if you've exceeded your subscription's usage limits
- **Revoke and re-authorize:**
  1. Revoke access: [ChatGPT Settings → Authorized Apps](https://chatgpt.com/settings/apps)
  2. Remove local tokens: `opencode auth logout`
  3. Re-authenticate: `opencode auth login`

**Note:** If OpenAI has flagged your account for unusual usage patterns, you may experience authentication issues. Contact OpenAI support if you believe your account has been incorrectly restricted.

### Compliance-Related Issues

If you receive errors related to terms of service violations:

- **Review your usage:** Ensure you're using the plugin for personal development only
- **Check rate limits:** Verify you haven't exceeded usage limits
- **Avoid automation:** Do not use for high-volume automated requests
- **Commercial use:** Switch to OpenAI Platform API for commercial applications

This plugin cannot help with TOS violations or account restrictions. Contact OpenAI support for account-specific issues.

---

**Next**: [Configuration Guide](configuration.md) | [Developer Docs](development/ARCHITECTURE.md) | [Back to Home](index.md)
