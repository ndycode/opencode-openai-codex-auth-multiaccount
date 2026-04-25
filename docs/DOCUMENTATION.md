# Documentation Structure

This file describes how docs are organized in this repository.

## Repository-level docs

- `README.md` - Main entry point for users
- `CHANGELOG.md` - Release history
- `CONTRIBUTING.md` - Contribution workflow
- `SECURITY.md` - Security reporting policy
- `AGENTS.md` - AI agent instructions for this codebase

## docs/ (site + user/developer guides)

```text
docs/
├── _config.yml                 # docs site config
├── DOCUMENTATION.md            # this repository documentation map
├── README.md                   # docs portal / navigation
├── index.md                    # documentation landing page
├── getting-started.md          # install + first-run guide
├── configuration.md            # full config reference
├── troubleshooting.md          # operational debugging guide
├── faq.md                      # short common answers
├── privacy.md                  # data handling notes
├── OPENCODE_PR_PROPOSAL.md     # upstream OpenCode proposal notes
├── development/
│   ├── ARCHITECTURE.md         # technical design and current module/docs layout
│   ├── CONFIG_FIELDS.md        # config field semantics
│   ├── CONFIG_FLOW.md          # config resolution internals
│   ├── TESTING.md              # testing strategy and commands
│   └── TUI_PARITY_CHECKLIST.md # auth dashboard UI parity checks
└── audits/
    ├── INDEX.md
    ├── 01-executive-summary.md ... 16-verdict.md
    ├── _findings/              # T01 through T16 detailed findings
    └── _meta/                  # audit rubric, ledger, environment, verification
```

## config/ (copy-paste templates)

- `config/opencode-modern.json` - OpenCode v1.0.210+ variant-based template
- `config/opencode-legacy.json` - OpenCode v1.0.209 and below template
- `config/minimal-opencode.json` - minimal debug template
- `config/README.md` - template-selection guide

## Notes

- `dist/` is build output and not a documentation source of truth.
- `tmp*` files are release scratch artifacts and not part of user docs.
- For user-facing guidance, start with `README.md` or `docs/getting-started.md`.
