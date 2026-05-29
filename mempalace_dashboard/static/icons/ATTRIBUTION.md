# Third-party brand mono icons

The `.svg` files in this directory are from
[lobehub/lobe-icons](https://github.com/lobehub/lobe-icons), specifically the
monochrome (non-`-color`) variants from the `@lobehub/icons-static-svg` npm
package distributed via unpkg. They are used as the inner mark inside
Apricity's notification-bell brand avatars.

- License: MIT (see lobe-icons repo)
- Pulled from: `https://unpkg.com/@lobehub/icons-static-svg@latest/icons/`

## Current set (all monochrome variants)

| File | Represents | Notes |
|---|---|---|
| `claudecode.svg` | Claude Code (Anthropic) | CLI / coding-agent variant |
| `codex.svg` | OpenAI Codex | CLI variant, not the chat product |
| `geminicli.svg` | Google Gemini CLI | CLI variant |
| `grok.svg` | Grok (xAI) | No CLI variant ships in lobe-icons as of 2026-05-28 |

## Why monochrome (not the `-color` variants)

The dashboard composes each avatar as **white mark on brand-coloured circle** —
the brand colour stays dominant, the mark stays legible on both light and dark
surfaces. CSS achieves the white via `filter: brightness(0) invert(1)` on the
inner `<img>`. Picking the mono SVG means there's a single uniform colour to
invert; the `-color` variants would still survive the filter chain but the
underlying multi-colour pixel data is wasted work.

The brand backgrounds live in `NOTIFICATION_AVATARS` in `static/app.js`.

## To refresh

```
ICONS_DIR=mempalace_dashboard/static/icons
for name in claudecode.svg codex.svg geminicli.svg grok.svg; do
  curl -sL -o "$ICONS_DIR/$name" \
    "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/$name"
done
```

## Adding a new model

1. Probe lobe-icons for the mono slug (no `-color` suffix):
   `curl -sIL "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/<slug>.svg"`
2. Drop the SVG into this directory.
3. Add an entry to `NOTIFICATION_AVATARS` in `static/app.js` with the
   brand's primary background colour (or a gradient if appropriate).

Each icon represents the trademark of its respective owner (Anthropic, OpenAI,
Google, xAI). Apricity uses them only to identify the model that authored or
edited a given memory — no endorsement is implied.
