# Playwright Setup for Design UX

## Playwright MCP Check

At skill start, check for Playwright MCP availability:

1. Look for Playwright MCP in available tools
2. If unavailable:
   - Inform user: "Playwright MCP not detected. Visual critique/iteration requires it."
   - Install from: https://github.com/anthropics/anthropic-cookbook/tree/main/misc/mcp_playwright
   - Offer: "Continue in generation-only mode? (No visual feedback)"
3. If available: proceed with full capabilities

## Local Server for Playwright

**Playwright cannot access file:// URLs directly.** Serve design systems over localhost.

### Start Server

From design system output directory:
```bash
python -m http.server 8000
```

Alternative options:
```bash
npx serve -p 8000        # if npm available
php -S localhost:8000    # if PHP available
```

### Use localhost URLs

```
Instead of: file:///path/to/preview.html
Use:        http://localhost:8000/preview.html
```

### Server Lifecycle

1. Start server before first Playwright operation
2. Keep running during all exploration iterations
3. Stop when exploration completes or user exits

### Parallel Explorations

Each exploration gets its own port:
```bash
cd {output_path}/v1-minimal && python -m http.server 8001 &
cd {output_path}/v2-playful && python -m http.server 8002 &
cd {output_path}/v3-bold && python -m http.server 8003 &
```

**Always use the correct port** - never navigate to the wrong port or you'll critique the wrong design system.
