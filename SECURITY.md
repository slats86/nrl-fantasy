# Security policy

## Reporting a vulnerability

Do not disclose suspected vulnerabilities, credentials, database URLs, reset tokens, session tokens, or backup passphrases in a public issue.

Use the repository's private vulnerability reporting page:

https://github.com/slats86/nrl-fantasy/security/advisories/new

Include the affected feature, reproduction steps, likely impact, and any suggested remediation. Remove real user data and secrets from screenshots and logs.

## Supported version

Only the version currently deployed from `main` is supported. Security fixes should include regression coverage and pass CI before production deployment. Rotate any exposed credential immediately rather than waiting for a code release.
