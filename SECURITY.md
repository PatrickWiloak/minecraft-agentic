# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub private vulnerability reporting](https://github.com/NoblerWorks-HQ/minecraft-agentic/security/advisories/new)
(preferred) or by email to patricklukewilson@gmail.com. Don't open a public issue for
anything exploitable.

You can expect an acknowledgement within a few days. There is no bug bounty - this is a
free research project.

## Scope and threat model

Things that are working as designed, not vulnerabilities:

- **The bundled server runs `online-mode=false` with opped bots.** That is the point - it
  is a private localhost sandbox. Pointing the bots at a server you don't control is
  misuse, and the README says not to.
- **Model output driving world edits.** LLM responses are treated as untrusted input and
  pass through validating layers (`expandOps`, `normalizePatch`) that clamp coordinates,
  cap volumes, and validate block names. Bypasses of those layers ARE in scope and are
  exactly the reports we want.
- **API keys live in `.env`**, which is gitignored. A code path that logs, commits, or
  transmits a key anywhere other than its own provider is in scope.

## Supported versions

Only the latest commit on `master` is supported.
