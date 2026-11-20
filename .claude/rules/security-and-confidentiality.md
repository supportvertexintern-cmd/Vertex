# Security and confidentiality

- Treat `.env` files, credentials, access tokens, private keys, session material, and test passwords as confidential. Do not read or display their values unless the user specifically requests a necessary, narrowly scoped inspection.
- Never place secrets or real credential values in source control, instructions, skills, agent prompts, examples, logs, or generated reports.
- Preserve server-side authorization and data scoping. Review the backend enforcement path for any security-sensitive UI change.
- Do not access production systems, databases, object storage, email, or external services without explicit authorization.
- Report suspected secret exposure without repeating the value. Prefer redaction and refer to the file and line only when useful.
