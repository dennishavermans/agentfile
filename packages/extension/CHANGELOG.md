# Changelog

## [0.1.0] — 2026-04-08

### Added
- Sidebar with live agent status (`synced`, `stale`, `disabled`), rules, and skills overview
- `agentfile: Sync` — generates agent files via the integrated terminal; refreshes sidebar on completion
- `agentfile: Validate Contract` — validates `ai/contract.yaml` with inline diagnostics and Problems panel entries
- `agentfile: Initialize Project` — scaffolds contract, agent templates, and CI workflow
- `agentfile: Migrate Project` — imports existing instruction files into a draft contract
- `agentfile: Diff` — checks generated files against the manifest; exits non-zero on drift
- `agentfile: Clean` — removes orphaned generated files; offers dry-run preview before deleting
- `agentfile: Rollback` — restores files from a backup; supports listing available tags or restoring by tag
- `agentfile: Open Contract` — opens `ai/contract.yaml` in the editor
- `agentfile: Focus Sidebar` — opens and focuses the Activity Bar panel
- `agentfile: Refresh` — manually refreshes the sidebar state
- Status bar badge showing stale-output count or active agent count; clicking runs Sync
- Auto-sync prompt when `ai/contract.yaml` is saved or changed on disk
- Stale-file toast notification when switching to an editor whose outputs are out of date
- Click-to-open agent output files from the sidebar
- Click-to-navigate to individual contract rules in `contract.yaml`
- Enabling a disabled agent from the sidebar triggers an automatic sync
