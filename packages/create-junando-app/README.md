# create-junando-app

Scaffold a new [Junando](https://github.com/GerMoren/junando) alerting app in seconds. This package copies the `express-end-to-end` template into a new directory and wires up your project name — no configuration files to touch, no boilerplate to delete.

## Usage

```bash
pnpm create junando-app my-app
# or
npx create-junando-app my-app
```

After scaffolding:

```bash
cd my-app/app
cp .env.example .env  # edit with your LLM/Slack keys
pnpm dev
```

## What's next

See `my-app/app/README.md` (or the [example README](../../examples/express-end-to-end/README.md)) for a full walkthrough of what gets scaffolded, environment variables, and how to connect your LLM and Slack integrations.
