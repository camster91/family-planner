# Native Windows checks

Use the existing Node 22+ installation and Git for Windows Bash. Do not install WSL, edit global PATH or skip shell safety tests to make the suite pass.

```powershell
node scripts/check-local.mjs
```

This runs `verify:app` (Prisma generation, typecheck, lint, full Jest, build and the production dependency audit). It removes duplicate PATH entries only from its child process. Windows CMD ignores inherited variables longer than 8,191 characters, so npm's added binary directories can otherwise make installed tools disappear. Reference: https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/command-line-string-limitation

For a focused check:

```powershell
node scripts/check-local.mjs test --runInBand src/__tests__/backup-script.test.ts
```

Shell tests execute the real backup/retention/recovery scripts using mock tools and disposable temporary directories. On Windows they use the existing native Git Bash with converted test paths; they never use the WSL launcher. Upload/deletion filesystem assertions use canonical native paths. Application APIs, upload storage conventions and Linux production scripts are unchanged.

Database integration tests still require the documented disposable database environment. This does not claim Windows production hosting or physical Android validation.
