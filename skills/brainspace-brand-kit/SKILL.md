---
name: brainspace-brand-kit
description: Use when building or updating the brand kit in Brainspace (logos, colors, fonts, voice), or when producing anything visual or customer-facing that must match the brand. Covers where brand assets live and how to keep them usable by agents.
---

# Brand kit

The brand kit lives in `/team/brand/`:

- `/team/brand/brand-kit.md` covers logo usage, the color table and typography.
- `/team/brand/voice.md` is how we write.
- `/team/brand/assets/` holds the actual files: logos, icons, fonts, product shots.

## Using it

1. `read_many` with `/team/brand/brand-kit.md` and `/team/brand/voice.md` before producing copy or visuals.
2. `list` with path `/team/brand/assets` to see files and their descriptions. Pick assets by description, not by guessing from file names.
3. `read` an asset to get a temporary download URL.

## Filling it in from a website

If a Context.dev connection exists (`connections_list`), it can pull a company's logos, colors and fonts from its domain:

1. Call the Context.dev brand or styleguide tool for the company domain.
2. `upload` each logo from its URL into `/team/brand/assets/`, for example `logo-primary.svg` or `logo-icon-dark.png`.
3. `describe` each one: what it is, which background it's for, and its format.
4. `edit` the color and typography sections of `/team/brand/brand-kit.md` with the real values.
5. Ask the user to confirm before replacing anything a person already filled in.

## Rules

- Keep one source of truth. Colors belong in `brand-kit.md`, not repeated across docs.
- Re-upload to the same path to replace an asset. That creates a version, so the old logo is still recoverable.
- Every asset gets a description. An undescribed asset is invisible to search.
