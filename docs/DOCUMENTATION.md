# Documentation Structure

This document explains the organization of documentation in this repository.

## Structure Overview

```
├── README.md                      # Main entry point (users)
├── CHANGELOG.md                   # Release history
├── AGENTS.md                      # AI agent guidance
├── docs/
│   ├── index.md                   # GitHub Pages home
│   ├── README.md                  # Documentation portal
│   ├── _config.yml                # GitHub Pages config
│   └── development/               # Developer documentation
│       ├── ARCHITECTURE.md        # Technical design
│       ├── CONFIG_FLOW.md         # Config system internals
│       ├── CONFIG_FIELDS.md       # Config field reference
│       └── TESTING.md             # Test procedures
├── config/
│   ├── README.md                  # Example configs guide
│   ├── opencode-legacy.json       # Legacy full config example (v1.0.209 and below)
│   ├── opencode-modern.json       # Variant config example (v1.0.210+)
│   └── minimal-opencode.json      # Minimal config example
└── tmp/release-notes/             # Detailed release artifacts
    ├── CHANGES.md                 # Detailed v2.1.2 changes
    ├── BUGS_FIXED.md              # Bug analysis
    ├── IMPLEMENTATION_SUMMARY.md  # Implementation details
    └── VERIFICATION.md            # Verification matrix
```

## Document Purposes

### Top Level (Users)
- **README.md** - Quick start, configuration basics, common usage
- **CHANGELOG.md** - Version history, what's new
- **AGENTS.md** - Guidance for AI coding agents

### docs/ (GitHub Pages)
- **index.md** - Landing page with quick links to user and dev docs
- **README.md** - Documentation portal overview
- **development/** - Technical deep dives for developers

### tmp/release-notes/ (Release Artifacts)
- Detailed bug analysis and implementation notes
- Used for preparing release announcements
- Not part of main documentation (too detailed for users)

##  GitHub Pages

Enable GitHub Pages in repository settings:
- **Source**: `main` branch, `/docs` folder
- **URL**: `https://your-username.github.io/opencode-codex-plugin/`

The site automatically serves:
- `docs/index.md` as homepage
- All docs in `docs/` directory
- Development docs prominently featured

## For Users

Start with **[README.md](../README.md)** for:
- Installation steps
- Basic configuration
- Quick examples
- Troubleshooting

## For Developers

Start with **[docs/development/ARCHITECTURE.md](development/ARCHITECTURE.md)** for:
- Technical design decisions
- Request transformation pipeline
- AI SDK compatibility layer
- Testing methodology

## Contributing

See development docs for:
- Code architecture
- Testing procedures
- Configuration system internals
